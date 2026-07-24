# CRIPTA Sprite Forge v0.7.0-cloud

Editor colaborativo de sprites pixel art con generación IA integrada y Sprite Cutter.

## Flujo de trabajo recomendado

```
1. Referencia  — Sube 1-4 imágenes de referencia del personaje.
                 Marca una como "★ Referencia maestra" para que la IA
                 mantenga identidad, ropa, colores y proporciones.

2. Generar     — Elige animación, dirección, número de frames y variantes.
                 Pulsa "Generar variantes" para crear varias spritesheets completas.
                 La IA entrega una imagen por variante (fondo magenta, frames en fila).

3. Editor      — Abre cualquier variante en el Sprite Cutter integrado.
                 Ajusta columnas, filas, offsets y tamaño de celda hasta
                 que la malla encuadre cada frame perfectamente.
                 Selecciona los mejores frames (Ctrl+clic o Shift+clic).
                 Pulsa "Añadir seleccionados" o "Añadir todos" al timeline.
                 Repite con otras variantes para mezclar frames.

4. Exportar    — El timeline ensamblado se exporta como spritesheet PNG final.
```

## Funciones del Sprite Cutter integrado

- **Malla arrastrable** — arrastra la cuadrícula sobre la imagen para encuadrar
- **Ajuste de malla** — columnas, filas, separaciones, márgenes, offsets y tamaño de celda
- **Botones ◀▲▼▶** — nudge fino de ±1 px
- **Transparencia magenta** — convierte fondo #FF00FF a transparente automáticamente
- **Recorte interno** — elimina píxeles sobrantes transparentes o magenta
- **Preview animado** — Play/Pausa, FPS, Zoom hasta 6×
- **Selección múltiple** — Ctrl+clic (individual) · Shift+clic (rango)
- **Reordenación táctil** — mantén pulsado y arrastra en móvil
- **Flip, Duplicar, Borrar, Mover** por frame
- **Undo** hasta 20 pasos
- **Exportar PNG** (spritesheet), **Exportar frames individuales**, **Exportar JSON**

## Generación IA

- **Spritesheet completa** — una sola llamada genera todos los frames en una imagen
- **Varias variantes** — 1, 2, 4, 6 u 8 variantes en lote secuencial con progreso
- **Cancelar en cualquier momento** — las variantes ya generadas se conservan
- **Regenerar** — mismo seed (reproducible) o nuevo seed (variación)
- **Aprobar** — marca las mejores variantes para control de calidad
- **Referencia maestra ★** — siempre incluida como primera referencia en el prompt
- **Modo demostración** — genera muñecos provisionales sin gastar cuota de IA

## Modo frame a frame (Experimental)

Acceso: **Generar → Generación frame a frame (Experimental)**

> ⚠ Realiza una llamada por frame. Consume más cuota y produce más
> inconsistencias entre frames. Usa la generación de spritesheets completas
> cuando sea posible.

## Datos por variante guardados

```json
{
  "id": "uuid",
  "name": "Walk E #1",
  "seed": 123456789,
  "animationType": "Walk",
  "direction": "E",
  "targetFrameCount": 6,
  "width": 3072,
  "height": 512,
  "prompt": "...",
  "imagePath": "owner/project/sheets/anim/variant.png",
  "status": "ready",
  "approved": false,
  "createdAt": 1234567890,
  "cutterSettings": {
    "cols": "6", "rows": "1",
    "gapX": "0", "gapY": "0",
    "marginX": "0", "marginY": "0",
    "offsetX": "0", "offsetY": "0",
    "sizeAdjustX": "0", "sizeAdjustY": "0",
    "bgMode": "transparent", "trim": "off"
  }
}
```

## Storage

| Carpeta | Contenido |
|---------|-----------|
| `{owner}/{project}/references/` | Imágenes de referencia |
| `{owner}/{project}/sheets/{animId}/` | Spritesheets completas (variantes) |
| `{owner}/{project}/frames/{animId}/{dirId}/` | Frames del timeline (modo experimental) |

## Retrocompatibilidad

Los proyectos creados con versiones anteriores (v0.6.x) se cargan sin perder datos.
`normalizeAnimation()` añade automáticamente `variants: []` si no existe.

## Stack técnico

- Pure HTML/CSS/JS — sin frameworks, sin bundler
- Supabase (Auth anónimo, Storage, Edge Functions, Realtime)
- Cloudflare Workers AI `flux-2-klein-4b`
- PWA + Service Worker (cache v11)
- GitHub Pages compatible (scope: `/SkillEditor/sprite-forge/`)
