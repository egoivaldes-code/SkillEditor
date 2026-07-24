# CRIPTA Sprite Forge

Editor colaborativo, móvil-first, para crear referencias, animaciones, frames y spritesheets de CRIPTA.

## Incluido

- Biblioteca familiar compartida mediante Supabase.
- Identidad anónima por dispositivo y nombre visible.
- Proyectos propios editables; proyectos ajenos duplicables; administración familiar opcional.
- Imágenes en Supabase Storage y copia local en IndexedDB.
- Sincronización Realtime entre móviles y PC.
- Frames libres: añadir, eliminar, duplicar y reordenar.
- Animaciones de 2, 4 y 8 direcciones.
- Modo espejo: 1/3/5 direcciones base y expansión automática al exportar.
- Generación protegida mediante Supabase Edge Function.
- Workers AI con `@cf/black-forest-labs/flux-2-klein-4b`.
- Control diario de cuota global y por usuario.
- PWA instalable y modo demostración sin consumir IA.

## Dirección prevista

Una vez publicado el contenido de esta carpeta dentro de `SkillEditor/sprite-forge/`:

`https://egoivaldes-code.github.io/SkillEditor/sprite-forge/`

## Puesta en marcha

### 1. Base de datos y Storage

En el proyecto de Supabase usado por SkillEditor:

1. Abre **SQL Editor**.
2. Copia y ejecuta `supabase/migrations/20260724_sprite_forge.sql`.
3. Comprueba que existe el bucket público `sprite-assets`.

La migración crea tablas, RLS, Realtime, permisos de propietario/admin y el contador de cuota de IA.

### 2. Edge Function

En **Supabase → Edge Functions** crea una función llamada `generate-sprite` y pega el contenido de:

`supabase/functions/generate-sprite/index.ts`

Déjala con verificación JWT activada. El archivo `supabase/config.toml` ya refleja esa configuración para despliegues mediante CLI.

### 3. Cloudflare Workers AI

En Cloudflare:

1. Abre **Workers AI → Use REST API**.
2. Crea el token preconfigurado de Workers AI.
3. Copia el **Account ID** y el **API token**.

En **Supabase → Edge Functions → Secrets**, añade:

```text
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-2-klein-4b
```

`CLOUDFLARE_IMAGE_MODEL` es opcional porque la función ya usa ese modelo por defecto.

No guardes el token en `config.js`, GitHub ni el navegador.

### 4. Hacer administrador al propietario

Abre la aplicación, entra en el engranaje y copia el **ID de este dispositivo**. Después ejecuta en SQL Editor:

```sql
insert into public.sprite_admins(user_id)
values ('UUID-DEL-DISPOSITIVO')
on conflict do nothing;
```

Los administradores pueden editar y eliminar cualquier proyecto. El resto solo gestiona sus proyectos y puede duplicar los ajenos.

### 5. GitHub Pages

Los archivos web se publican dentro de la carpeta `sprite-forge/` del repositorio `SkillEditor`. No contienen claves privadas. Si SkillEditor ya se sirve desde `main / root`, la subcarpeta aparecerá automáticamente al terminar el despliegue de Pages.

## Seguridad

- `config.js` solo contiene la URL y la clave publicable de Supabase; son datos diseñados para cliente y están protegidos por RLS.
- La clave de Cloudflare solo vive como secreto de la Edge Function.
- El navegador no puede manipular directamente el contador de cuota: las funciones SQL de reserva y devolución solo son ejecutables por `service_role`.
- La biblioteca sigue el modelo de colaboración de SkillEditor: cualquier dispositivo con sesión anónima que conozca la URL puede entrar. Para una fase posterior se puede añadir un código familiar o lista de miembros aprobados.
- Las imágenes usan un bucket público para que Cloudflare pueda leer las referencias. Los nombres son rutas UUID, pero cualquiera que conozca una URL concreta puede abrirla.

## Desarrollo local

Sirve la carpeta mediante HTTP; no abras `index.html` directamente con `content://` o `file://`:

```bash
python -m http.server 8080
```

La aplicación mantiene un modo local si Supabase aún no está preparado y un modo demostración para revisar el editor sin consumir Workers AI.
