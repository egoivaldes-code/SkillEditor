# Supabase — CRIPTA Sprite Forge

1. Ejecuta la migración SQL de `migrations/`.
2. Despliega `functions/generate-sprite/` con JWT activado.
3. Configura los secretos de Cloudflare descritos en `.env.example`.

Con CLI:

```bash
supabase link --project-ref tyilsfxqctrgozlchwxc
supabase db push
supabase secrets set --env-file supabase/.env
supabase functions deploy generate-sprite --use-api
```

También puede hacerse íntegramente desde el Dashboard de Supabase.
