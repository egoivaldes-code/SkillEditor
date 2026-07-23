# CRIPTA Sprite Forge

Editor colaborativo, móvil-first, para crear referencias, animaciones, frames y spritesheets de CRIPTA.

**URL pública:** `https://egoivaldes-code.github.io/SkillEditor/sprite-forge/`

## Características

- Biblioteca familiar compartida mediante Supabase Realtime.
- Identidad anónima por dispositivo y nombre visible.
- Proyectos propios editables; proyectos ajenos duplicables; administración familiar opcional.
- Imágenes en Supabase Storage + copia local en IndexedDB.
- Sincronización en tiempo real entre móviles y PC.
- Frames libres: añadir, eliminar, duplicar y reordenar (drag & drop táctil).
- Animaciones de 2, 4 y 8 direcciones con modo espejo.
- Generación de sprites protegida mediante Supabase Edge Function.
- Cloudflare Workers AI con `@cf/black-forest-labs/flux-2-klein-4b`.
- Control diario de cuota global y por usuario.
- PWA instalable y modo demostración sin consumir IA.

## Puesta en marcha

Consulta **SETUP.md** para instrucciones completas. Resumen:

1. Ejecuta la migración SQL en Supabase (`supabase/migrations/20260724_sprite_forge.sql`).
2. Despliega la Edge Function `generate-sprite`.
3. Añade los secretos de Cloudflare en Supabase.
4. Activa Anonymous Sign-ins en Supabase Auth.
5. Copia `config.example.js` → `config.js` con tu URL y clave publishable.
6. Publica en GitHub Pages (la subcarpeta `sprite-forge/` aparece automáticamente).

## Seguridad

- `config.js` solo contiene la URL y la clave **publishable** (anon) de Supabase.
- La clave de Cloudflare vive exclusivamente como secreto de la Edge Function.
- Los contadores de cuota IA solo son manipulables por `service_role`.
- Todas las tablas están protegidas con Row Level Security.

## Estructura de archivos

```
sprite-forge/
├── index.html            — shell HTML (PWA)
├── styles.css            — estilos mobile-first
├── config.js             — URL y clave pública de Supabase
├── config.example.js     — plantilla sin secretos
├── sw.js                 — Service Worker (caché offline)
├── manifest.webmanifest  — metadatos PWA
├── icon.svg              — icono de la app
├── js/
│   ├── app-core.js       — estado global, IndexedDB, estructuras de datos
│   ├── app-cloud.js      — integración Supabase (auth, DB, Storage, Realtime)
│   ├── app-ui.js         — renderizado de la biblioteca y el editor
│   ├── app-frames.js     — editor de frames, exportación
│   └── app-utils.js      — utilidades y punto de entrada (init)
├── supabase/
│   ├── migrations/       — SQL de tablas, RLS y cuotas IA
│   ├── functions/        — Edge Function generate-sprite
│   └── config.toml       — referencia del proyecto Supabase
├── .env.example          — plantilla de secretos para Supabase
├── SETUP.md              — guía completa de configuración
└── README.md             — este archivo
```

## Desarrollo local

Sirve la carpeta mediante HTTP (no `file://`):

```bash
python -m http.server 8080
# o
npx serve .
```

La app arranca en modo local/demo si Supabase no está configurado.
