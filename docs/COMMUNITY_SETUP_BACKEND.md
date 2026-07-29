# Community Builds backend

The community feed remains compatible with static GitHub Pages. Supabase stores
the data and exposes one public Edge Function:

```text
GET    /functions/v1/community-builds
POST   /functions/v1/community-builds
DELETE /functions/v1/community-builds/v1/builds/:id
```

Public reads return only public columns. Posting passes a coarse atomic attempt
limit before validating a fresh Cloudflare Turnstile token, then a stricter
network-scoped publication limit. A successful post returns a random management
token once. Only its keyed HMAC is stored, and the token is required to delete
that build.

## 1. Create and link the Supabase project

Install the Supabase CLI, authenticate, and link the local directory:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Apply the migration:

```sh
supabase db push
```

The migration creates:

- `community_builds`, with RLS and SELECT grants limited to public columns;
- `community_rate_limit_events`, inaccessible to public roles;
- an advisory-lock-protected rate-limit RPC;
- a service-role-only token deletion RPC.

Do not add INSERT, UPDATE or DELETE grants for `anon` or `authenticated`.
`management_token_hash` and network hashes must never be publicly selectable.

## 2. Configure Cloudflare Turnstile

Create a Turnstile widget for every production hostname that serves the site.
Use the public site key in the frontend and keep its secret only in Supabase.
Turnstile tokens are single-use; request a new token for every publication.
Render or execute the widget with the action name `publish_build`; the Edge
Function rejects tokens issued for any other action.

Cloudflare's documented testing keys can be used for local development with
`COMMUNITY_TURNSTILE_TEST_MODE=true`, as shown in `supabase/.env.example`.
Never enable that flag in production or put the production secret in the
repository or GitHub Pages configuration.

## 3. Configure secrets

Generate two independent random values of at least 32 characters. For example,
run `openssl rand -base64 48` twice and keep the outputs private.

Set production secrets, replacing every placeholder:

```sh
supabase secrets set \
  TURNSTILE_SECRET_KEY='YOUR_TURNSTILE_SECRET' \
  COMMUNITY_MANAGEMENT_TOKEN_SECRET='YOUR_FIRST_RANDOM_SECRET' \
  COMMUNITY_RATE_LIMIT_SECRET='YOUR_SECOND_RANDOM_SECRET' \
  COMMUNITY_ALLOWED_ORIGINS='https://YOUR_USER.github.io,https://YOUR_CUSTOM_DOMAIN' \
  COMMUNITY_TURNSTILE_HOSTNAMES='YOUR_USER.github.io,YOUR_CUSTOM_DOMAIN' \
  COMMUNITY_TURNSTILE_TEST_MODE='false' \
  COMMUNITY_CHALLENGE_LIMIT='20' \
  COMMUNITY_CHALLENGE_WINDOW_SECONDS='600' \
  COMMUNITY_PUBLISH_LIMIT='5' \
  COMMUNITY_PUBLISH_WINDOW_SECONDS='3600'
```

Notes:

- Origins include the scheme and no trailing slash.
- Turnstile hostnames contain no scheme or path and the list must not be empty;
  publication fails closed when it is missing.
- `COMMUNITY_ALLOWED_ORIGINS=*` is supported but not recommended.
- `SUPABASE_URL` and the legacy `SUPABASE_SERVICE_ROLE_KEY` are normally
  provided automatically to hosted Edge Functions. The function prefers the new
  `SUPABASE_SECRET_KEY` when you configure one and safely falls back to the
  legacy variable. Both are backend-only and must never appear in frontend code.
- Rotating `COMMUNITY_MANAGEMENT_TOKEN_SECRET` invalidates every previously
  issued deletion token. Back it up as an application secret.
- Rotating `COMMUNITY_RATE_LIMIT_SECRET` is safe, but temporarily resets the
  effective network quota because future HMACs change.

Use `supabase/.env.example` only as a local template. It contains no usable
credentials.

## 4. Deploy

The function is intentionally configured with JWT verification disabled because
GET and POST are public and DELETE uses its own high-entropy credential:

```sh
supabase functions deploy community-builds --use-api
```

`verify_jwt = false` is already set in `supabase/config.toml`. API bundling is
required because semantic validation imports the frontend's exact game-rule
modules from outside the `supabase/` directory.

The base URL is:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/community-builds
```

Configure the frontend with that URL and the public Turnstile site key. Neither
the Turnstile secret, the service-role key, nor either HMAC secret belongs in
GitHub Pages.

## 5. API contract

### List builds

```http
GET /functions/v1/community-builds?limit=24&cursor=OPAQUE_CURSOR
```

`limit` defaults to 24 and may be 1–50. Pass `nextCursor` unchanged to load the
next page.

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000000",
      "authorName": "Vinicius",
      "buildName": "Creator CAM",
      "buildCode": "BASE64URL_V2",
      "createdAt": "2026-07-29T12:00:00.000000+00:00"
    }
  ],
  "nextCursor": null
}
```

### Publish

```http
POST /functions/v1/community-builds
Content-Type: application/json

{
  "authorName": "Vinicius",
  "buildName": "Creator CAM",
  "buildCode": "BASE64URL_V2",
  "turnstileToken": "FRESH_SINGLE_USE_TOKEN"
}
```

The API accepts only the existing compact v2 build format. It validates the
archetype, body ranges, level, known attributes, PlayStyles, specializations and
positions; requires Skill Moves and Weak Foot values present in the compact
payload to be between 2 and 5; removes unknown top-level fields; and stores a
canonical encoding. Author names must contain 2–32 characters, and build names
2–60 characters.

A successful response has status `201`:

```json
{
  "build": {
    "id": "00000000-0000-4000-8000-000000000000",
    "authorName": "Vinicius",
    "buildName": "Creator CAM",
    "buildCode": "CANONICAL_BASE64URL_V2",
    "createdAt": "2026-07-29T12:00:00.000000+00:00"
  },
  "manageToken": "cbm_SAVE_THIS_VALUE"
}
```

Store `manageToken` in browser local storage under the build id. It is returned
only at publication time and cannot be recovered from the database. Losing it
does not remove the build; an administrator can still moderate it in Supabase.

### Delete

```http
DELETE /functions/v1/community-builds/v1/builds/BUILD_UUID
Authorization: Bearer cbm_MANAGEMENT_TOKEN
```

Success returns `{"deleted":true}`. A missing build and an incorrect token both
return `404`, so the endpoint does not reveal which part was wrong.

## 6. Local verification

Static validation and unit tests do not require database credentials:

```sh
deno fmt --check supabase/functions/community-builds
deno check --config supabase/functions/community-builds/deno.json \
  supabase/functions/community-builds/index.ts
deno test --config supabase/functions/community-builds/deno.json \
  supabase/functions/community-builds/build-code_test.ts
```

For an integration test, start the local Supabase stack, apply the migration and
serve the function with the template environment:

```sh
supabase start
supabase db reset
supabase functions serve community-builds \
  --env-file supabase/.env.example \
  --no-verify-jwt
```

Use Cloudflare's official Turnstile test secret locally instead of a production
secret. Confirm that:

1. direct public SELECT cannot request `management_token_hash`;
2. direct public INSERT and DELETE are denied;
3. a valid POST returns a token but subsequent GET never returns it;
4. the sixth POST within the default hour receives `429` and `Retry-After`;
5. excessive verification attempts are blocked before another Siteverify call;
6. DELETE succeeds only with the token returned for that exact build.
