# Checklist de lanzamiento

- [ ] Ejecutar `supabase/migrations/20260724_sprite_forge.sql`.
- [ ] Confirmar que Anonymous Sign-Ins está activado en Supabase Auth.
- [ ] Crear/desplegar la Edge Function `generate-sprite`.
- [ ] Crear token de Cloudflare Workers AI.
- [ ] Añadir `CLOUDFLARE_ACCOUNT_ID` y `CLOUDFLARE_API_TOKEN` a los secretos de Supabase.
- [ ] Abrir la web y anotar el UUID del dispositivo principal.
- [ ] Insertar ese UUID en `public.sprite_admins`.
- [ ] Probar primero con **Modo demostración**.
- [ ] Desactivar demostración y generar un frame real de 512 × 512.
- [ ] Probar desde un segundo móvil: ver biblioteca, duplicar proyecto y sincronización.
- [ ] Probar descarga de spritesheet con expansión espejo.
- [ ] Instalar la PWA desde Chrome en los móviles familiares.
