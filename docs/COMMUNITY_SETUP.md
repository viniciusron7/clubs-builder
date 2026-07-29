# Enable Community Builds

The implementation is already part of the project. GitHub Pages continues to
serve static files only; Supabase stores publications and runs the API, while
Cloudflare Turnstile reduces spam without requiring an account.

## What you need to create

1. Create a project in [Supabase](https://database.new/) and copy the
   `Project ID` (also called the `project ref`).
2. In the Cloudflare dashboard, open **Turnstile**, create a **Managed** widget,
   and allow the hostnames that actually serve the page: `roncetti.com.br` and,
   if you also use the default Pages address, `viniciusron7.github.io`. Include
   `www.roncetti.com.br` as well if that version opens the site without first
   redirecting.
3. Save both widget values:
   - **Site key**: public; it is used by the JavaScript.
   - **Secret key**: private; it is stored only in Supabase.

Do not put the Turnstile secret key, a Supabase service-role/secret key, or the
HMAC secrets in any website file.

## Install and connect the CLI

On macOS:

```sh
brew install supabase/tap/supabase
cd /Users/viniciusroncetti/VSCODE/clubs-builder
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

The `supabase/` directory is already initialized, so do not run
`supabase init`.

## Create the secrets

Generate two different values and copy each result:

```sh
openssl rand -hex 32
openssl rand -hex 32
```

Then configure the function, replacing the uppercase placeholders:

```sh
supabase secrets set \
  TURNSTILE_SECRET_KEY='YOUR_TURNSTILE_SECRET_KEY' \
  COMMUNITY_MANAGEMENT_TOKEN_SECRET='FIRST_RANDOM_VALUE' \
  COMMUNITY_RATE_LIMIT_SECRET='SECOND_RANDOM_VALUE' \
  COMMUNITY_ALLOWED_ORIGINS='https://roncetti.com.br,https://viniciusron7.github.io' \
  COMMUNITY_TURNSTILE_HOSTNAMES='roncetti.com.br,viniciusron7.github.io' \
  COMMUNITY_TURNSTILE_TEST_MODE='false' \
  COMMUNITY_CHALLENGE_LIMIT='20' \
  COMMUNITY_CHALLENGE_WINDOW_SECONDS='600' \
  COMMUNITY_PUBLISH_LIMIT='5' \
  COMMUNITY_PUBLISH_WINDOW_SECONDS='3600'
```

If either domain does not serve the page, remove it from both lists. Origins
include `https://`; hostnames do not include a scheme or path.

## Create the database and deploy the function

From the project root:

```sh
supabase db push
supabase functions deploy community-builds --use-api
```

The first command applies
`supabase/migrations/20260729000000_community_builds.sql` and the additive card
metadata migration
`supabase/migrations/20260729010000_community_build_card_metadata.sql`.
Existing publications are preserved and appear with legacy card defaults. The
second command deploys the Edge Function using the public configuration in
`supabase/config.toml`. Keep `--use-api`: the function imports the same game
rules and UT card catalog used by the frontend, which live outside the
`supabase/` directory.

## Connect the frontend

The two public values are already set in `js/community-config.js`:

```js
const defaults = {
  apiUrl: 'https://czfstgqqkjewbzbcblle.supabase.co/functions/v1/community-builds',
  turnstileSiteKey: '0x4AAAAAAEAjy-lSiXjfRYb1',
};
```

Do not put the Turnstile Secret Key in this file. After deploying the backend,
commit and push the changes, then wait for GitHub Pages to update.

## Final verification

1. Open **Community Builds**. The "Setup required" screen should disappear.
2. Open a build, click **Publish current build**, enter your public and athlete
   names, select the card metadata and complete the verification.
3. Leave the optional build name empty and confirm that it falls back to the
   athlete name.
4. Reopen the publisher: the saved public name should no longer need to be
   entered.
5. The publication should appear in the gallery with the selected athlete,
   rarity, league, club and nation, and open the correct build.
6. In the same browser, the publication should show **Delete**. In another
   browser, it should be read-only.

The remembered name and deletion credentials are stored in `localStorage`. If
browser data is cleared, the delete button disappears. In that case, you can
still hide or delete the row through the Supabase administration panel. To
moderate without deleting, change `status` to `hidden` in the
`community_builds` table.

API, security, and local testing details are documented in
[COMMUNITY_SETUP_BACKEND.md](COMMUNITY_SETUP_BACKEND.md).
