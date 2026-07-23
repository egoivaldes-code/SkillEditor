# SETUP — CRIPTA Sprite Forge

Guía completa para desplegar Sprite Forge sobre el proyecto Supabase existente de SkillEditor.

---

## 1. Base de datos (migración SQL)

En tu proyecto Supabase → **SQL Editor**:

1. Abre `supabase/migrations/20260724_sprite_forge.sql`.
2. Copia todo el contenido y ejecútalo.

La migración crea (sin tocar las tablas de SkillEditor):

| Objeto | Descripción |
|--------|-------------|
| `sprite_projects` | Proyectos de la biblioteca familiar |
| `sprite_admins` | UUIDs con permisos de administrador |
| `sprite_app_settings` | Límites diarios de cuota IA (globales) |
| `sprite_ai_daily_usage` | Neurons consumidos por día (global) |
| `sprite_ai_user_daily_usage` | Neurons consumidos por día y usuario |
| `is_sprite_admin()` | Función RLS para comprobar admin |
| `claim_sprite_ai_budget()` | Reserva atómica de cuota (solo service_role) |
| `refund_sprite_ai_budget()` | Devolución de cuota en caso de error |
| Bucket `sprite-assets` | Almacenamiento público de imágenes |
| Políticas RLS | Lectura global; escritura del propietario o admin |

> La migración es idempotente (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

---

## 2. Supabase Auth — Anonymous Sign-ins

En Supabase → **Authentication → Providers**:

- Activa **Anonymous Sign-ins** (o "Enable anonymous sign-ins").

Cada dispositivo obtendrá una sesión anónima persistente sin registrarse.

---

## 3. Realtime

En Supabase → **Database → Replication** (o ejecuta en SQL Editor):

```sql
-- La migración ya lo hace, pero puedes verificarlo:
select pubname, schemaname, tablename
from pg_publication_tables
where tablename = 'sprite_projects';
```

Si no aparece, ejecuta:

```sql
alter publication supabase_realtime add table public.sprite_projects;
```

---

## 4. Edge Function `generate-sprite`

### Opción A — Supabase Dashboard

1. Ve a **Edge Functions → New Function**.
2. Nombre: `generate-sprite`.
3. Pega el contenido de `supabase/functions/generate-sprite/index.ts`.
4. Activa "Enforce JWT verification".
5. Guarda y despliega.

### Opción B — Supabase CLI

```bash
# Desde la raíz del repo (con supabase/config.toml presente):
supabase login
supabase functions deploy generate-sprite --project-ref tyilsfxqctrgozlchwxc
```

---

## 5. Secretos de la Edge Function

En Supabase → **Edge Functions → Secrets** (o con CLI):

```bash
supabase secrets set \
  CLOUDFLARE_ACCOUNT_ID=tu_account_id \
  CLOUDFLARE_API_TOKEN=tu_workers_ai_token \
  CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-klein-4b \
  --project-ref tyilsfxqctrgozlchwxc
```

> `CLOUDFLARE_IMAGE_MODEL` es opcional; la función ya lo usa por defecto.

Para obtener el token de Cloudflare:

1. Ve a **Cloudflare → Workers AI → Use REST API**.
2. Crea un API Token con permisos de Workers AI.
3. Copia el **Account ID** y el **API Token**.

**Nunca pongas el token en `config.js`, GitHub ni el navegador.**

---

## 6. Configuración del frontend

Copia la plantilla y añade tus datos reales:

```bash
cp sprite-forge/config.example.js sprite-forge/config.js
```

Edita `sprite-forge/config.js`:

```js
window.CRIPTA_SPRITE_CONFIG = Object.freeze({
  supabaseUrl: 'https://tyilsfxqctrgozlchwxc.supabase.co',  // ya está
  supabaseKey: 'sb_publishable_...',                         // clave anon/publishable
  projectsTable: 'sprite_projects',
  assetsBucket: 'sprite-assets',
  generationFunction: 'generate-sprite',
  appVersion: '0.3.0-cloud'
});
```

La clave **anon/publishable** es pública por diseño (está protegida por RLS).  
La clave **service_role** nunca debe aparecer en el frontend.

---

## 7. Hacer administrador al propietario

1. Abre la app en el navegador.
2. Abre ⚙ Ajustes → copia el **ID de este dispositivo** (UUID).
3. Ejecuta en SQL Editor:

```sql
insert into public.sprite_admins(user_id)
values ('PEGA-AQUI-TU-UUID')
on conflict do nothing;
```

Los administradores pueden editar y eliminar cualquier proyecto.

---

## 8. GitHub Pages

Si `egoivaldes-code/SkillEditor` ya publica la rama `main` desde la raíz:

- La subcarpeta `sprite-forge/` quedará publicada automáticamente en
  `https://egoivaldes-code.github.io/SkillEditor/sprite-forge/`
  tras el merge del Pull Request.
- No es necesario cambiar la configuración de Pages.

Verifica en **GitHub → Settings → Pages** que la fuente es `main / root`.

---

## 9. CORS de la Edge Function

El archivo `supabase/functions/generate-sprite/index.ts` usa `'Access-Control-Allow-Origin': '*'` que permite llamadas desde cualquier origen, incluido GitHub Pages. Si en el futuro quieres restringirlo:

```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://egoivaldes-code.github.io',
  ...
}
```

---

## 10. Prueba post-despliegue

1. Abre `https://egoivaldes-code.github.io/SkillEditor/sprite-forge/`.
2. Abre ⚙ Ajustes → la conexión debe mostrar "Supabase conectado".
3. Crea un proyecto y verifica que aparece en la biblioteca.
4. Abre el mismo enlace en otro dispositivo → el proyecto debe aparecer.
5. Desde el segundo dispositivo, intenta editar → debe bloquearse (solo lectura).
6. Duplica el proyecto → el clon pertenece al segundo dispositivo.
7. Activa **Modo demostración** y genera un frame → muñeco local sin gastar API.
8. Desactiva demostración y genera un frame real de 512×512.
9. Descarga el spritesheet PNG y verifica el fondo magenta `#FF00FF`.
10. Instala la PWA desde Chrome → debe abrirse en modo standalone.

---

## Cuotas IA (valores por defecto)

| Límite | Neurons/día | Notas |
|--------|-------------|-------|
| Global | 9 000 | ~346 frames de 512px sin referencias |
| Por usuario | 3 500 | ~134 frames de 512px |

Puedes cambiarlos en cualquier momento:

```sql
update public.sprite_app_settings
set daily_neuron_limit = 9000,
    user_daily_neuron_limit = 3500
where singleton = true;
```

> Los valores son estimaciones basadas en el modelo FLUX-2 Klein 4B.  
> Cloudflare puede actualizar su tabla de precios en neurons.
