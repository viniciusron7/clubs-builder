import {
  GAME_CALC,
  GAME_DATA,
  GAME_OVERALL_MODEL,
  type GameBuild,
} from "./game-rules.ts";

export class BuildCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildCodeError";
  }
}

type PlainObject = Record<string, unknown>;
type PurchaseReceipt = {
  before: Record<string, number>;
  after: Record<string, number>;
};
type Purchases = Record<string, PurchaseReceipt>;
type ArchetypeRule = {
  height: readonly [number, number];
  weight: readonly [number, number];
  goalkeeper: boolean;
  specializations: ReadonlySet<string>;
};

const specializationsByArchetype = new Map<string, Set<string>>();
for (const specialization of GAME_DATA.specializations) {
  const current = specializationsByArchetype.get(specialization.archetypeId) ??
    new Set<string>();
  current.add(specialization.id);
  specializationsByArchetype.set(specialization.archetypeId, current);
}

const ARCHETYPES: Readonly<Record<string, ArchetypeRule>> = Object.fromEntries(
  GAME_DATA.archetypes.map((archetype) => [
    archetype.id,
    {
      height: [archetype.minHeight, archetype.maxHeight] as const,
      weight: [archetype.minWeight, archetype.maxWeight] as const,
      goalkeeper: archetype.position === "GK",
      specializations: specializationsByArchetype.get(archetype.id) ??
        new Set<string>(),
    },
  ]),
);

const ATTRIBUTES = new Set(
  GAME_DATA.categories.flatMap((category) =>
    category.attributes.map((attribute) => attribute.id)
  ),
);

const PLAYSTYLES = new Set(
  GAME_DATA.playstyles.map((playstyle) => playstyle.id),
);

const PLAYER_FACILITIES = new Map(
  GAME_DATA.facilities.map((facility) => [
    facility.id,
    facility.levels.length - 1,
  ]),
);
const AI_FACILITIES = new Map(
  GAME_DATA.aiFacilities.map((facility) => [
    facility.id,
    facility.levels.length - 1,
  ]),
);
const CLUB_LEVELS = new Set(
  Object.keys(GAME_DATA.clubLevelBudgets).map(Number),
);
const DEFAULT_CLUB_LEVEL = Math.min(...CLUB_LEVELS);

const OUTFIELD_POSITIONS = new Set(
  Object.keys(GAME_OVERALL_MODEL.positions).filter((position) =>
    position !== "GK"
  ),
);

function isObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    !Number.isInteger(value) || (value as number) < min ||
    (value as number) > max
  ) {
    throw new BuildCodeError(`${label} is invalid`);
  }
  return value as number;
}

function assertKnownKeys(
  value: PlainObject,
  allowed: ReadonlySet<string>,
  label: string,
  maxKeys: number,
): void {
  const keys = Object.keys(value);
  if (keys.length > maxKeys || keys.some((key) => !allowed.has(key))) {
    throw new BuildCodeError(`${label} contains unsupported keys`);
  }
}

function attributeValue(value: unknown, id: string, label: string): number {
  const stars = id === "skill_moves" || id === "weak_foot";
  return integer(
    value,
    label,
    stars ? 2 : 1,
    stars ? 5 : 99,
  );
}

function sanitizeAttributeMap(
  value: unknown,
  label: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new BuildCodeError(`${label} must be an object`);
  assertKnownKeys(value, ATTRIBUTES, label, ATTRIBUTES.size);
  return Object.fromEntries(
    Object.keys(value).sort().map((id) => [
      id,
      attributeValue(value[id], id, `${label}.${id}`),
    ]),
  );
}

function sanitizeStringArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
  maxItems: number,
): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new BuildCodeError(`${label} must be an array`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" || !allowed.has(item) || result.includes(item)
    ) {
      throw new BuildCodeError(`${label} contains an invalid value`);
    }
    result.push(item);
  }
  return result;
}

function sanitizePurchases(value: unknown): Purchases {
  if (value === undefined) return {};
  if (!isObject(value)) throw new BuildCodeError("pu must be an object");
  assertKnownKeys(value, PLAYSTYLES, "pu", 9);
  const output: Purchases = {};
  for (const playstyleId of Object.keys(value).sort()) {
    const receipt = value[playstyleId];
    if (!isObject(receipt)) {
      throw new BuildCodeError(`pu.${playstyleId} is invalid`);
    }
    assertKnownKeys(
      receipt,
      new Set(["before", "after"]),
      `pu.${playstyleId}`,
      2,
    );
    const before = sanitizeAttributeMap(
      receipt.before,
      `pu.${playstyleId}.before`,
    );
    const after = sanitizeAttributeMap(
      receipt.after,
      `pu.${playstyleId}.after`,
    );
    if (!Object.keys(after).length) {
      throw new BuildCodeError(`pu.${playstyleId}.after is empty`);
    }
    for (const [id, afterValue] of Object.entries(after)) {
      const beforeValue = before[id];
      if (beforeValue !== undefined && beforeValue > afterValue) {
        throw new BuildCodeError(`pu.${playstyleId}.${id} is invalid`);
      }
    }
    output[playstyleId] = { before, after };
  }
  return output;
}

function sanitizeFacilities(
  value: unknown,
  definitions: ReadonlyMap<string, number>,
  label: string,
): Record<string, number> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new BuildCodeError(`${label} must be an object`);
  assertKnownKeys(value, new Set(definitions.keys()), label, definitions.size);
  return Object.fromEntries(
    Object.keys(value).sort().map((id) => [
      id,
      integer(value[id], `${label}.${id}`, 1, definitions.get(id) as number),
    ]),
  );
}

function decodeBase64Url(value: string): string {
  if (
    !value || value.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  ) {
    throw new BuildCodeError("buildCode is not valid base64url");
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
    throw new BuildCodeError("buildCode could not be decoded");
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, ordered(value[key])]),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function currentAttributeValues(build: GameBuild): Record<string, number> {
  const archetype = build.archetypeId
    ? GAME_CALC.archetype(build.archetypeId)
    : null;
  if (!archetype) throw new BuildCodeError("archetype is invalid");

  const values: Record<string, number> = {};
  for (const category of GAME_CALC.baseCategories(archetype)) {
    for (const attribute of category.attributes) {
      values[attribute.id] = build.attributes[attribute.id] ??
        attribute.baseValue;
    }
  }
  return values;
}

function normalizeSemantically(source: GameBuild): GameBuild {
  const normalized = GAME_CALC.normalizeBuild(source).build;
  const sourceValues = currentAttributeValues(source);
  const normalizedValues = currentAttributeValues(normalized);
  const activeAttributes = new Set(Object.keys(sourceValues));

  const unchanged = source.archetypeId === normalized.archetypeId &&
    source.level === normalized.level &&
    source.clubLevel === normalized.clubLevel &&
    source.height === normalized.height &&
    source.weight === normalized.weight &&
    Object.keys(source.attributes).every((id) => activeAttributes.has(id)) &&
    sameValue(sourceValues, normalizedValues) &&
    sameValue(source.facilities, normalized.facilities) &&
    sameValue(source.aiFacilities, normalized.aiFacilities) &&
    sameValue(source.playstyles, normalized.playstyles) &&
    sameValue(source.playstylePurchases, normalized.playstylePurchases) &&
    sameValue(source.signatures, normalized.signatures) &&
    sameValue(source.positions, normalized.positions) &&
    sameValue(source.disabledAttrs, normalized.disabledAttrs) &&
    sameValue(source.sumExcluded, normalized.sumExcluded);

  if (!unchanged) {
    throw new BuildCodeError("buildCode violates the current game rules");
  }
  return normalized;
}

function compactBuild(build: GameBuild): PlainObject {
  if (!build.archetypeId) throw new BuildCodeError("archetype is invalid");
  const canonical: PlainObject = {
    v: 2,
    a: build.archetypeId,
    l: build.level,
    c: build.clubLevel,
    h: build.height,
    w: build.weight,
  };
  const attributes = sanitizeAttributeMap(build.attributes, "t");
  const facilities = sanitizeFacilities(
    build.facilities,
    PLAYER_FACILITIES,
    "f",
  );
  const aiFacilities = sanitizeFacilities(
    build.aiFacilities,
    AI_FACILITIES,
    "af",
  );
  const purchases = sanitizePurchases(build.playstylePurchases);
  const signatures = Object.fromEntries(
    Object.keys(build.signatures).sort().map((key) => [
      key,
      build.signatures[key],
    ]),
  );
  if (Object.keys(attributes).length) canonical.t = attributes;
  if (Object.keys(facilities).length) canonical.f = facilities;
  if (Object.keys(aiFacilities).length) canonical.af = aiFacilities;
  if (build.playstyles.length) canonical.p = build.playstyles;
  if (Object.keys(purchases).length) canonical.pu = purchases;
  if (Object.keys(signatures).length) canonical.s = signatures;
  if (build.positions.length) canonical.po = build.positions;
  if (build.disabledAttrs.length) canonical.da = build.disabledAttrs;
  if (build.sumExcluded.length) canonical.se = build.sumExcluded;
  return canonical;
}

export type SanitizedBuild = {
  code: string;
  archetypeId: string;
  level: number;
  positions: string[];
};

export function sanitizeBuildCode(value: unknown): SanitizedBuild {
  if (typeof value !== "string") {
    throw new BuildCodeError("buildCode must be a string");
  }
  const json = decodeBase64Url(value);
  if (new TextEncoder().encode(json).byteLength > 12288) {
    throw new BuildCodeError("buildCode payload is too large");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BuildCodeError("buildCode does not contain JSON");
  }
  if (!isObject(raw)) {
    throw new BuildCodeError("buildCode payload must be an object");
  }
  if (raw.v !== 2) throw new BuildCodeError("only buildCode v2 is supported");
  if (typeof raw.a !== "string" || !ARCHETYPES[raw.a]) {
    throw new BuildCodeError("archetype is invalid");
  }

  const archetypeId = raw.a;
  const rule = ARCHETYPES[archetypeId];
  const level = integer(raw.l, "level", 1, 100);
  const clubLevel = integer(
    raw.c ?? DEFAULT_CLUB_LEVEL,
    "club level",
    DEFAULT_CLUB_LEVEL,
    Math.max(...CLUB_LEVELS),
  );
  if (!CLUB_LEVELS.has(clubLevel)) {
    throw new BuildCodeError("club level is invalid");
  }
  const height = integer(raw.h, "height", rule.height[0], rule.height[1]);
  const weight = integer(raw.w, "weight", rule.weight[0], rule.weight[1]);
  const attributes = sanitizeAttributeMap(raw.t, "t");
  const facilities = sanitizeFacilities(raw.f, PLAYER_FACILITIES, "f");
  const aiFacilities = sanitizeFacilities(raw.af, AI_FACILITIES, "af");
  const playstyles = sanitizeStringArray(raw.p, PLAYSTYLES, "p", 9);
  const purchases = sanitizePurchases(raw.pu);
  const disabledAttrs = sanitizeStringArray(
    raw.da,
    ATTRIBUTES,
    "da",
    ATTRIBUTES.size,
  );
  const sumExcluded = sanitizeStringArray(
    raw.se,
    ATTRIBUTES,
    "se",
    ATTRIBUTES.size,
  );

  let positions = rule.goalkeeper
    ? sanitizeStringArray(raw.po, new Set(["GK"]), "po", 1)
    : sanitizeStringArray(
      raw.po,
      OUTFIELD_POSITIONS,
      "po",
      OUTFIELD_POSITIONS.size,
    );
  if (rule.goalkeeper) positions = ["GK"];

  const signatures: Record<string, string> = {};
  if (raw.s !== undefined) {
    if (!isObject(raw.s) || Object.keys(raw.s).length > 1) {
      throw new BuildCodeError("s must contain at most one specialization");
    }
    for (const key of Object.keys(raw.s)) {
      if (
        !/^[0-3]$/.test(key) || typeof raw.s[key] !== "string" ||
        !rule.specializations.has(raw.s[key] as string)
      ) {
        throw new BuildCodeError("s contains an invalid specialization");
      }
      signatures[key] = raw.s[key] as string;
    }
  }

  const source: GameBuild = {
    archetypeId,
    level,
    clubLevel,
    height,
    weight,
    attributes,
    facilities,
    aiFacilities,
    playstyles,
    playstylePurchases: purchases,
    signatures,
    positions,
    disabledAttrs,
    sumExcluded,
  };
  const normalized = normalizeSemantically(source);

  return {
    // Unknown fields and redundant base-value attributes are intentionally
    // omitted so equivalent accepted payloads have one stable encoding.
    code: encodeBase64Url(JSON.stringify(compactBuild(normalized))),
    archetypeId: normalized.archetypeId as string,
    level: normalized.level,
    positions: normalized.positions,
  };
}
