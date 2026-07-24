---
name: Sprite Forge GitHub deploy
description: Estado y contexto del PR de CRIPTA Sprite Forge en egoivaldes-code/SkillEditor
---

**PR:** https://github.com/egoivaldes-code/SkillEditor/pull/1  
**Rama:** feature/sprite-forge-cloud → main  
**URL pública post-merge:** https://egoivaldes-code.github.io/SkillEditor/sprite-forge/  
**Repo:** egoivaldes-code/SkillEditor (GitHub, conectado vía Replit integration)

## Contenido del PR

- Toda la app está en `sprite-forge/` — sin tocar la raíz (SkillEditor existente).
- 21 archivos nuevos (HTML, CSS, JS modular, SW, manifest, SQL, Edge Function Deno, docs).
- `gitPush` callback de Replit maneja la autenticación; `git push` directo falla (HTTPS token).

## Corrección incluida

`app-core.js` tenía `init()` en la línea 81 (antes de que otros scripts estuvieran cargados).  
Se eliminó. El único punto de entrada ahora es el `init()` al final de `app-utils.js`.  
**Why:** sin la corrección, `bindGlobalEvents()` se ejecutaba dos veces (listeners duplicados) y la primera llamada lanzaba `ReferenceError` porque `initSupabase`/`renderHome` no existían aún.

## Pasos post-merge que el usuario debe ejecutar

1. SQL: ejecutar `supabase/migrations/20260724_sprite_forge.sql` en Supabase Dashboard.
2. Auth: activar *Anonymous Sign-ins* en Supabase Auth → Providers.
3. Edge Function: desplegar `generate-sprite` (Deno) desde el Dashboard o CLI.
4. Secretos Cloudflare en Edge Function: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, opcionalmente `CLOUDFLARE_IMAGE_MODEL`.
5. GitHub Pages publica automáticamente `/sprite-forge/` — no requiere reconfiguración.
6. Hacerse admin: insertar UUID propio en `sprite_admins`.

## Supabase project ref

`tyilsfxqctrgozlchwxc` (en `supabase/config.toml` y `config.js`).
