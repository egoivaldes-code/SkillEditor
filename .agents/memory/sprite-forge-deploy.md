---
name: Sprite Forge GitHub deploy
description: Deployment context for Sprite Forge — post-merge steps and known gotchas
---

## Post-merge steps the user must run manually

1. SQL: run `supabase/migrations/20260724_sprite_forge.sql` in the Supabase Dashboard.
2. Auth: enable *Anonymous Sign-ins* in Supabase Auth → Providers.
3. Edge Function: deploy `generate-sprite` (Deno) from the Supabase Dashboard or CLI.
4. Cloudflare secrets on the Edge Function: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and optionally `CLOUDFLARE_IMAGE_MODEL`.
5. GitHub Pages publishes `/sprite-forge/` automatically — no reconfiguration needed.
6. Make yourself admin: insert your user UUID into `sprite_admins`.

## Known gotcha — duplicate event listeners

`app-core.js` previously called `init()` before other scripts loaded (line 81).
Removing it was required; the only entry-point is now the `init()` at the bottom of `app-utils.js`.
**Why:** without the fix, `bindGlobalEvents()` ran twice (duplicate listeners) and the first call threw `ReferenceError` because `initSupabase`/`renderHome` didn't exist yet.

## Known gotcha — gitPush vs direct git push

The Replit `gitPush` callback handles authentication. A plain `git push` over HTTPS fails because there is no stored token in the container.

## Image Transformation prerequisite

Reference image resizing in the Edge Function relies on Supabase Storage Image Transformation (`/storage/v1/render/image/public/…`). This feature must be enabled on the Supabase project plan; otherwise generation with reference images will return a hard error instead of silently forwarding full-size images.
