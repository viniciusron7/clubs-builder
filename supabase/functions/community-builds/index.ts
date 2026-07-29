import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BuildCodeError, sanitizeBuildCode } from "./build-code.ts";

const PUBLIC_COLUMNS = "id,author_name,build_name,build_code,created_at";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MANAGEMENT_TOKEN_PATTERN = /^cbm_[A-Za-z0-9_-]{43}$/;
const MAX_REQUEST_BYTES = 24576;

type PublicRow = {
  id: string;
  author_name: string;
  build_name: string;
  build_code: string;
  created_at: string;
};

type PublicBuild = {
  id: string;
  authorName: string;
  buildName: string;
  buildCode: string;
  createdAt: string;
};

type Cursor = {
  createdAt: string;
  id: string;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: HeadersInit = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function env(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new ApiError(500, "server_misconfigured", `Missing ${name}`);
  }
  return value;
}

function positiveIntegerEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(500, "server_misconfigured", `Invalid ${name}`);
  }
  return value;
}

function configuredList(name: string): string[] {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = configuredList("COMMUNITY_ALLOWED_ORIGINS");
  return allowed.includes("*") || allowed.includes(origin);
}

function responseHeaders(request: Request, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Origin");
  const origin = request.headers.get("origin");
  const allowed = configuredList("COMMUNITY_ALLOWED_ORIGINS");
  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    headers.set(
      "Access-Control-Allow-Origin",
      allowed.includes("*") ? "*" : origin,
    );
  }
  return headers;
}

function json(
  request: Request,
  value: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders(request, extraHeaders),
  });
}

function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof BuildCodeError) {
    return json(request, {
      error: { code: "invalid_build_code", message: error.message },
    }, 400);
  }
  if (error instanceof ApiError) {
    // Configuration details are logged but not exposed to public callers.
    if (error.status >= 500) {
      console.error(`[community-builds] ${error.message}`);
    }
    const publicMessage = error.status >= 500
      ? "The community service is temporarily unavailable."
      : error.message;
    return json(
      request,
      { error: { code: error.code, message: publicMessage } },
      error.status,
      error.headers,
    );
  }
  console.error("[community-builds] unexpected error", error);
  return json(
    request,
    {
      error: {
        code: "internal_error",
        message: "The community service is temporarily unavailable.",
      },
    },
    500,
  );
}

function serviceClient(): SupabaseClient {
  // Hosted projects may expose either the new sb_secret key or the legacy
  // service-role key. Both stay server-side and are never returned to callers.
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY")?.trim() ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!secretKey) {
    throw new ApiError(
      500,
      "server_misconfigured",
      "Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(env("SUPABASE_URL"), secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function publicBuild(row: PublicRow): PublicBuild {
  return {
    id: row.id,
    authorName: row.author_name,
    buildName: row.build_name,
    buildCode: row.build_code,
    createdAt: row.created_at,
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string): string {
  if (
    !value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new ApiError(
      400,
      "invalid_cursor",
      "The pagination cursor is invalid.",
    );
  }
  let base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  while (base64.length % 4) base64 += "=";
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(
      400,
      "invalid_cursor",
      "The pagination cursor is invalid.",
    );
  }
}

function encodeCursor(row: PublicRow): string {
  return textToBase64Url(
    JSON.stringify({ createdAt: row.created_at, id: row.id }),
  );
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(base64UrlToText(value)) as unknown;
    if (
      decoded === null || typeof decoded !== "object" ||
      typeof (decoded as Cursor).createdAt !== "string" ||
      !TIMESTAMP_PATTERN.test((decoded as Cursor).createdAt) ||
      Number.isNaN(Date.parse((decoded as Cursor).createdAt)) ||
      !UUID_PATTERN.test((decoded as Cursor).id)
    ) {
      throw new Error("invalid");
    }
    return decoded as Cursor;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      400,
      "invalid_cursor",
      "The pagination cursor is invalid.",
    );
  }
}

function routeSuffix(url: URL): string {
  const marker = "/community-builds";
  const index = url.pathname.lastIndexOf(marker);
  if (index < 0) return url.pathname.replace(/\/+$/u, "") || "/";
  return url.pathname.slice(index + marker.length).replace(/\/+$/u, "") || "/";
}

function sanitizeText(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_input", `${label} must be text.`);
  }
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const length = Array.from(sanitized).length;
  if (length < minLength || length > maxLength) {
    throw new ApiError(
      400,
      "invalid_input",
      `${label} must contain between ${minLength} and ${maxLength} characters.`,
    );
  }
  return sanitized;
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "request_too_large", "The request is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "request_too_large", "The request is too large.");
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(
      400,
      "invalid_json",
      "The request body must be valid JSON.",
    );
  }
}

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]
    ?.trim();
  const value = forwarded ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return value.slice(0, 128);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  if (secret.length < 32) {
    throw new ApiError(
      500,
      "server_misconfigured",
      "An HMAC secret is too short",
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function createManagementToken(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return `cbm_${bytesToBase64Url(random)}`;
}

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

async function verifyTurnstile(
  token: unknown,
  ip: string,
): Promise<void> {
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) {
    throw new ApiError(
      400,
      "missing_challenge",
      "Please complete the verification challenge.",
    );
  }
  const form = new URLSearchParams();
  form.set("secret", env("TURNSTILE_SECRET_KEY"));
  form.set("response", token);
  form.set("idempotency_key", crypto.randomUUID());
  if (ip !== "unknown") form.set("remoteip", ip);

  let result: TurnstileResult;
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form, signal: AbortSignal.timeout(8000) },
    );
    result = await response.json() as TurnstileResult;
  } catch (error) {
    console.error("[community-builds] Turnstile unavailable", error);
    throw new ApiError(
      503,
      "challenge_unavailable",
      "Verification is temporarily unavailable.",
    );
  }

  if (result["error-codes"]?.includes("invalid-input-secret")) {
    console.error("[community-builds] Turnstile secret rejected");
    throw new ApiError(
      500,
      "server_misconfigured",
      "The verification service is not configured correctly.",
    );
  }

  const allowedHostnames = configuredList("COMMUNITY_TURNSTILE_HOSTNAMES");
  if (!allowedHostnames.length) {
    throw new ApiError(
      500,
      "server_misconfigured",
      "Missing COMMUNITY_TURNSTILE_HOSTNAMES",
    );
  }
  const hostnameAllowed = typeof result.hostname === "string" &&
    allowedHostnames.includes(result.hostname);
  const testMode = Deno.env.get("COMMUNITY_TURNSTILE_TEST_MODE")?.trim() ===
    "true";
  const actionAllowed = result.action === "publish_build" ||
    (testMode && result.action === "test");
  if (
    !result.success || !hostnameAllowed || !actionAllowed
  ) {
    throw new ApiError(
      403,
      "challenge_failed",
      "Verification failed. Please try again.",
    );
  }
}

async function listBuilds(request: Request, url: URL): Promise<Response> {
  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null ? 24 : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
    throw new ApiError(400, "invalid_limit", "limit must be between 1 and 50.");
  }
  const limit = parsedLimit;
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  let query = serviceClient()
    .from("community_builds")
    .select(PUBLIC_COLUMNS)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[community-builds] list failed", error.code);
    throw new ApiError(503, "storage_unavailable", "Unable to load builds.");
  }
  const rows = (data ?? []) as PublicRow[];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return json(
    request,
    {
      items: page.map(publicBuild),
      nextCursor: hasMore && page.length
        ? encodeCursor(page[page.length - 1])
        : null,
    },
    200,
    { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
  );
}

type RateLimitRow = {
  allowed: boolean;
  event_id: number | null;
  retry_after_seconds: number;
};

async function consumeRateLimit(
  client: SupabaseClient,
  action: "challenge" | "publish",
  actorHash: string,
  limit: number,
  windowSeconds: number,
  message: string,
): Promise<RateLimitRow> {
  const { data, error } = await client.rpc(
    "community_consume_rate_limit",
    {
      p_action: action,
      p_actor_hash: actorHash,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    },
  );
  if (error) {
    console.error(`[community-builds] ${action} rate limit failed`, error.code);
    throw new ApiError(
      503,
      "storage_unavailable",
      "Unable to publish the build.",
    );
  }
  const rate = ((data ?? []) as RateLimitRow[])[0];
  if (!rate?.allowed) {
    const retry = Math.max(
      1,
      Number(rate?.retry_after_seconds) || windowSeconds,
    );
    throw new ApiError(
      429,
      "rate_limited",
      message,
      { "Retry-After": String(retry) },
    );
  }
  return rate;
}

async function publishBuild(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const authorName = sanitizeText(body.authorName, "authorName", 2, 32);
  const buildName = sanitizeText(body.buildName, "buildName", 2, 60);
  const build = sanitizeBuildCode(body.buildCode);
  const ip = requestIp(request);
  const rateLimitSecret = env("COMMUNITY_RATE_LIMIT_SECRET");
  const client = serviceClient();

  // Consume a coarser quota before calling Siteverify so random invalid tokens
  // cannot generate unbounded third-party verification requests.
  const challengeHash = await hmacHex(
    rateLimitSecret,
    `challenge\u0000${ip}`,
  );
  await consumeRateLimit(
    client,
    "challenge",
    challengeHash,
    positiveIntegerEnv("COMMUNITY_CHALLENGE_LIMIT", 20, 1, 100),
    positiveIntegerEnv(
      "COMMUNITY_CHALLENGE_WINDOW_SECONDS",
      600,
      60,
      86400,
    ),
    "Too many verification attempts from this network. Please try again later.",
  );
  await verifyTurnstile(body.turnstileToken, ip);

  const actorHash = await hmacHex(
    rateLimitSecret,
    `publish\u0000${ip}`,
  );
  const publishLimit = positiveIntegerEnv("COMMUNITY_PUBLISH_LIMIT", 5, 1, 100);
  const windowSeconds = positiveIntegerEnv(
    "COMMUNITY_PUBLISH_WINDOW_SECONDS",
    3600,
    60,
    86400,
  );
  const rate = await consumeRateLimit(
    client,
    "publish",
    actorHash,
    publishLimit,
    windowSeconds,
    "Too many builds were published from this network. Please try again later.",
  );

  const manageToken = createManagementToken();
  const managementTokenHash = await hmacHex(
    env("COMMUNITY_MANAGEMENT_TOKEN_SECRET"),
    manageToken,
  );
  const { data, error } = await client
    .from("community_builds")
    .insert({
      author_name: authorName,
      build_name: buildName,
      build_code: build.code,
      build_version: 2,
      archetype_id: build.archetypeId,
      positions: build.positions,
      level: build.level,
      management_token_hash: managementTokenHash,
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[community-builds] insert failed", error?.code);
    throw new ApiError(
      503,
      "storage_unavailable",
      "Unable to publish the build.",
    );
  }

  if (rate.event_id) {
    // This is audit metadata only; a failure must not undo a valid publication.
    const { error: eventError } = await client
      .from("community_rate_limit_events")
      .update({ build_id: (data as PublicRow).id })
      .eq("id", rate.event_id)
      .eq("actor_hash", actorHash);
    if (eventError) {
      console.error("[community-builds] event link failed", eventError.code);
    }
  }

  return json(
    request,
    {
      build: publicBuild(data as PublicRow),
      manageToken,
    },
    201,
    { "Cache-Control": "no-store" },
  );
}

async function deleteBuild(
  request: Request,
  buildId: string,
): Promise<Response> {
  if (!UUID_PATTERN.test(buildId)) {
    throw new ApiError(404, "not_found", "Build not found.");
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  const token = match?.[1];
  if (!token || !MANAGEMENT_TOKEN_PATTERN.test(token)) {
    throw new ApiError(
      401,
      "invalid_management_token",
      "A valid management token is required.",
    );
  }
  const tokenHash = await hmacHex(
    env("COMMUNITY_MANAGEMENT_TOKEN_SECRET"),
    token,
  );
  const { data, error } = await serviceClient().rpc("community_delete_build", {
    p_build_id: buildId,
    p_management_token_hash: tokenHash,
  });
  if (error) {
    console.error("[community-builds] delete failed", error.code);
    throw new ApiError(
      503,
      "storage_unavailable",
      "Unable to delete the build.",
    );
  }
  if (data !== true) {
    // Same response for a missing build and an incorrect token.
    throw new ApiError(404, "not_found", "Build not found.");
  }
  return json(request, { deleted: true }, 200, { "Cache-Control": "no-store" });
}

export async function handler(request: Request): Promise<Response> {
  try {
    if (!originAllowed(request)) {
      throw new ApiError(
        403,
        "origin_not_allowed",
        "This origin is not allowed.",
      );
    }
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: responseHeaders(request, {
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "authorization, apikey, content-type, x-client-info",
          "Access-Control-Max-Age": "86400",
        }),
      });
    }

    const url = new URL(request.url);
    const suffix = routeSuffix(url);
    const collectionRoute = suffix === "/" || suffix === "/builds" ||
      suffix === "/v1/builds";
    if (request.method === "GET" && collectionRoute) {
      return await listBuilds(request, url);
    }
    if (request.method === "POST" && collectionRoute) {
      return await publishBuild(request);
    }

    if (request.method === "DELETE") {
      const match = /^\/(?:v1\/)?builds\/([^/]+)$/u.exec(suffix);
      if (match) return await deleteBuild(request, match[1]);
    }
    return json(
      request,
      { error: { code: "not_found", message: "Endpoint not found." } },
      404,
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}

if (import.meta.main) Deno.serve(handler);
