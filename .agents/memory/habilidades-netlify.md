---
name: Habilidades Netlify blocked
description: Estado del deploy de CRIPTA Habilidades a Netlify — bloqueado por créditos
---

**Site:** cripta-habilidades.netlify.app  
**Site ID:** 5b784fd4-b1bc-45e8-9f26-d9a78e49a7f5  
**Team:** aspirin / egoivaldes@gmail.com  
**Ruta local:** `cripta/` (subdir del workspace, añadido a pnpm-workspace.yaml)

## Estado

Todo listo para desplegar; bloqueado por `JSONHTTPError: Forbidden` — créditos de build agotados en la cuenta aspirin.  
El usuario debe añadir créditos en: https://app.netlify.com/teams/aspirin/billing

## Comando de deploy (una vez resueltos los créditos)

```bash
cd cripta && NETLIFY_AUTH_TOKEN=<token> npx netlify deploy --dir public --functions netlify/functions --prod
```

El token es el PAT de Netlify del usuario (pedir de nuevo — no se almacena en ningún archivo).

## Cambios aplicados al proyecto cripta/

- Eliminado `netlify-cli` de devDeps (bloqueado por Socket Security Policy en pnpm).
- Añadido `@types/node` a devDeps.
- Añadido `"node"` al array `types` en `tsconfig.json`.
- `cripta/.netlify/` creado por `netlify link`.
- `TEAM_PASSWORD` ya configurado en producción Netlify.

**Why:** `netlify-cli` en devDeps no se puede instalar en Replit (Socket Security firewall); se usa `npx netlify` que tiene v26.2.0 disponible globalmente.
