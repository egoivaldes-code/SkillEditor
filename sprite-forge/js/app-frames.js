'use strict';

function renderFramesStep() {
    const anim = getActiveAnimation();
    if (!state.selectedDirection || !anim.directions.some(d => d.id === state.selectedDirection)) state.selectedDirection = anim.directions[0]?.id;
    const dir = getSelectedDirection();
    const tabs = anim.directions.map(d => `<button data-dir="${d.id}" class="${d.id===dir.id?'active':''}">${escapeHtml(d.name)} · ${d.frames.length}</button>`).join('');
    const frames = dir.frames.map((frame, index) => frameCardHtml(frame, index, isPreviewFlipped(dir.id))).join('');
    const generatedDirectionCount = anim.directions.length;
    const directionMeta = anim.mirror ? `${generatedDirectionCount}/${anim.directionCount} direcciones · espejo` : `${anim.directionCount} direcciones · orden libre`;

    els.main.innerHTML = `
      <section class="section">
        <div class="card">
          <div class="section-head"><div><h3 style="margin:0">${escapeHtml(anim.name)}</h3><p class="muted small" style="margin:4px 0 0">${directionMeta}</p></div><button id="generateAllBtn" class="primary-btn">Generar todo</button></div>
          <p class="muted small" style="margin:10px 0 0">Motor: ${state.settings.demoMode || !state.online ? 'demostración local' : 'Cloudflare FLUX mediante Supabase'}</p>
        </div>
        <div class="direction-tabs">${tabs}</div>
        <div class="frame-toolbar">
          <button id="addFrameBtn" class="mini-btn" title="Añadir hueco">＋</button>
          <input id="slotCountInput" class="slot-count-input" type="number" min="1" max="48" value="${dir.frames.length}" aria-label="Número de huecos">
          <button id="applySlotCountBtn" class="secondary-btn">Ajustar huecos</button>
          <button id="generateMissingBtn" class="mini-btn" title="Generar vacíos">⚡</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
          <button id="duplicateDirectionBtn" class="secondary-btn">Duplicar dir.</button>
          <button id="flipPreviewBtn" class="secondary-btn">${isPreviewFlipped(dir.id) ? 'Quitar espejo' : 'Ver espejo'}</button>
          <button id="goExportBtn" class="secondary-btn">Ir a exportar</button>
        </div>
        <div id="frameList" class="frame-list">${frames || '<div class="empty-state">No hay frames. Añade un hueco.</div>'}</div>
      </section>`;

    els.main.querySelectorAll('[data-dir]').forEach(btn => btn.addEventListener('click', () => { state.selectedDirection = btn.dataset.dir; renderEditor(); }));
    document.getElementById('addFrameBtn').addEventListener('click', () => { dir.frames.push(createFrame(dir.frames.length + 1)); renumberFrames(dir); scheduleSave(); renderEditor(); });
    document.getElementById('applySlotCountBtn').addEventListener('click', () => {
      const wanted = clampInt(document.getElementById('slotCountInput').value, 1, 48, dir.frames.length || 1);
      while (dir.frames.length < wanted) dir.frames.push(createFrame(dir.frames.length + 1));
      if (dir.frames.length > wanted) dir.frames.splice(wanted);
      renumberFrames(dir); scheduleSave(); renderEditor();
    });
    document.getElementById('generateAllBtn').addEventListener('click', () => generateAnimation(false));
    document.getElementById('generateMissingBtn').addEventListener('click', () => generateDirectionMissing(dir));
    document.getElementById('duplicateDirectionBtn').addEventListener('click', duplicateSelectedDirectionToTarget);
    document.getElementById('flipPreviewBtn').addEventListener('click', () => { toggleDirectionPreviewFlip(dir.id); renderEditor(); });
    document.getElementById('goExportBtn').addEventListener('click', () => { state.currentStep = 'export'; renderEditor(); });

    bindFrameActions();
    bindPointerReorder();
  }

  function frameCardHtml(frame, index, flipped = false) {
    const src = assetSrc(frame);
    const image = src ? `<img src="${escapeAttr(src)}" alt="${escapeHtml(frame.label)}" style="transform:${flipped ? 'scaleX(-1)' : 'none'};">` : `${index + 1}`;
    return `
      <article class="frame-card" data-frame-id="${frame.id}">
        <div class="drag-handle" title="Arrastrar">⋮⋮</div>
        <button class="frame-preview" data-upload-frame="${frame.id}">${image}</button>
        <div class="frame-body">
          <div class="frame-title"><strong>${escapeHtml(frame.label)}</strong><span class="frame-status ${frame.status}">${statusLabel(frame.status)}</span></div>
          <div class="frame-actions">
            <button class="mini-btn" data-move-left="${frame.id}" title="Mover antes">←</button>
            <button class="mini-btn" data-move-right="${frame.id}" title="Mover después">→</button>
            <button class="mini-btn" data-duplicate-frame="${frame.id}" title="Duplicar">⧉</button>
            <button class="mini-btn" data-generate-frame="${frame.id}" title="Regenerar">↻</button>
            <button class="mini-btn" data-delete-frame="${frame.id}" title="Eliminar">🗑</button>
          </div>
        </div>
      </article>`;
  }

  function bindFrameActions() {
    els.main.querySelectorAll('[data-upload-frame]').forEach(btn => btn.addEventListener('click', () => {
      state.pendingFrameUploadId = btn.dataset.uploadFrame;
      els.frameInput.click();
    }));
    els.main.querySelectorAll('[data-move-left]').forEach(btn => btn.addEventListener('click', () => moveFrame(btn.dataset.moveLeft, -1)));
    els.main.querySelectorAll('[data-move-right]').forEach(btn => btn.addEventListener('click', () => moveFrame(btn.dataset.moveRight, 1)));
    els.main.querySelectorAll('[data-duplicate-frame]').forEach(btn => btn.addEventListener('click', () => duplicateFrame(btn.dataset.duplicateFrame)));
    els.main.querySelectorAll('[data-generate-frame]').forEach(btn => btn.addEventListener('click', () => generateFrameById(btn.dataset.generateFrame)));
    els.main.querySelectorAll('[data-delete-frame]').forEach(btn => btn.addEventListener('click', () => deleteFrame(btn.dataset.deleteFrame)));
  }

  function moveFrame(id, delta) {
    const dir = getSelectedDirection();
    const index = dir.frames.findIndex(f => f.id === id);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= dir.frames.length) return;
    [dir.frames[index], dir.frames[next]] = [dir.frames[next], dir.frames[index]];
    renumberFrames(dir); scheduleSave(); renderEditor();
  }

  function duplicateFrame(id) {
    const dir = getSelectedDirection();
    const index = dir.frames.findIndex(f => f.id === id);
    if (index < 0) return;
    const copy = structuredClone(dir.frames[index]);
    copy.id = uid(); copy.label = 'Frame'; copy.createdAt = copy.updatedAt = Date.now();
    dir.frames.splice(index + 1, 0, copy);
    renumberFrames(dir); scheduleSave(); renderEditor();
  }

  function deleteFrame(id) {
    const dir = getSelectedDirection();
    dir.frames = dir.frames.filter(f => f.id !== id);
    renumberFrames(dir); scheduleSave(); renderEditor();
  }

  function renumberFrames(dir) {
    dir.frames.forEach((f, i) => f.label = `Frame ${i + 1}`);
  }

  function bindPointerReorder() {
    const list = document.getElementById('frameList');
    if (!list) return;
    list.querySelectorAll('.drag-handle').forEach(handle => {
      handle.addEventListener('pointerdown', (event) => {
        const card = handle.closest('.frame-card');
        if (!card) return;
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        state.drag = { id: card.dataset.frameId, pointerId: event.pointerId };
        card.classList.add('dragging');
      });
      handle.addEventListener('pointermove', (event) => {
        if (!state.drag || state.drag.pointerId !== event.pointerId) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.frame-card');
        if (!target || target.dataset.frameId === state.drag.id) return;
        const dir = getSelectedDirection();
        const from = dir.frames.findIndex(f => f.id === state.drag.id);
        const to = dir.frames.findIndex(f => f.id === target.dataset.frameId);
        if (from < 0 || to < 0) return;
        const [moved] = dir.frames.splice(from, 1);
        dir.frames.splice(to, 0, moved);
        renumberFrames(dir);
        const movingEl = list.querySelector(`[data-frame-id="${state.drag.id}"]`);
        if (from < to) target.after(movingEl); else target.before(movingEl);
      });
      const end = (event) => {
        if (!state.drag || state.drag.pointerId !== event.pointerId) return;
        list.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
        state.drag = null;
        scheduleSave();
        renderEditor();
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }

  // ---------------------------------------------------------------------------
  // Generation — public entry points
  // ---------------------------------------------------------------------------

  /**
   * Generate all frames across all directions (or only missing ones).
   * Calls prepareGeneration ONCE before the loop.
   * Stops all remaining frames if a fatal error occurs.
   */
  async function generateAnimation(onlyMissing) {
    const anim = getActiveAnimation();
    let referenceUrls = [];

    if (!state.settings.demoMode && state.online && sb) {
      try {
        referenceUrls = await prepareGeneration();
      } catch (error) {
        toast(error.message || 'Error al preparar la generación');
        return; // do NOT mark any frame as error — leave them as they were
      }
    }

    for (const dir of anim.directions) {
      for (const frame of dir.frames) {
        if (onlyMissing && assetHasImage(frame)) continue;
        const stop = await generateFrame(frame, dir, anim, referenceUrls);
        if (stop) { scheduleSave(); renderEditor(); return; }
      }
    }
    scheduleSave(); renderEditor();
  }

  /**
   * Generate only missing frames in a single direction.
   * Calls prepareGeneration ONCE before the loop.
   */
  async function generateDirectionMissing(dir) {
    const anim = getActiveAnimation();
    let referenceUrls = [];

    if (!state.settings.demoMode && state.online && sb) {
      try {
        referenceUrls = await prepareGeneration();
      } catch (error) {
        toast(error.message || 'Error al preparar la generación');
        return;
      }
    }

    for (const frame of dir.frames) {
      if (assetHasImage(frame)) continue;
      const stop = await generateFrame(frame, dir, anim, referenceUrls);
      if (stop) { scheduleSave(); renderEditor(); return; }
    }
    scheduleSave(); renderEditor();
  }

  /**
   * Regenerate a single frame by its ID.
   * Calls prepareGeneration once before invoking the Edge Function.
   */
  async function generateFrameById(id) {
    const anim = getActiveAnimation();
    const dir = getSelectedDirection();
    const frame = dir.frames.find(f => f.id === id);
    if (!frame) return;

    let referenceUrls = [];
    if (!state.settings.demoMode && state.online && sb) {
      try {
        referenceUrls = await prepareGeneration();
      } catch (error) {
        toast(error.message || 'Error al preparar la generación');
        return;
      }
    }

    frame.status = 'loading'; renderEditor();
    await generateFrame(frame, dir, anim, referenceUrls);
    scheduleSave(); renderEditor();
  }

  // ---------------------------------------------------------------------------
  // Core generation — low level
  // ---------------------------------------------------------------------------

  /**
   * Generate a single frame.
   *
   * @param {object} frame         - Frame object (mutated in place)
   * @param {object} dir           - Direction the frame belongs to
   * @param {object} anim          - Animation the direction belongs to
   * @param {string[]} referenceUrls - Public Storage URLs, already uploaded by prepareGeneration
   * @returns {boolean}            - true = caller should stop the loop (fatal error)
   */
  async function generateFrame(frame, dir, anim, referenceUrls = []) {
    const previousStatus = frame.status;
    frame.status = 'loading';
    renderEditor();

    try {
      if (state.settings.demoMode || !state.online || !sb) {
        // Demo: generate a local placeholder — no network, no quota used
        frame.blob = await makeDemoFrame(anim.width, anim.height, dir.name, dir.frames.indexOf(frame) + 1, anim.type);
      } else {
        // Cloud: referenceUrls already prepared — do NOT call persistProjectAssets here
        const payload = {
          projectId: state.currentProject.id,
          animation: anim.type,
          direction: dir.name,
          directionKey: dir.key,
          logicalDirectionCount: anim.directionCount,
          generatedDirectionCount: anim.directions.length,
          mirror: !!anim.mirror,
          frameIndex: dir.frames.indexOf(frame),
          frameCount: dir.frames.length,
          width: anim.width,
          height: anim.height,
          seed: frame.seed || null,
          prompt: buildFramePrompt(frame, dir, anim),
          referenceUrls
        };

        const { data, error } = await sb.functions.invoke(CONFIG.generationFunction, { body: payload });

        if (error) {
          // Attempt to read a structured body from the edge function response
          let detail = error.message || 'La función de generación falló';
          try {
            const body = await error.context?.clone?.().json();
            if (body?.error) detail = body.error;
          } catch {}
          const translated = translateGenerationError(detail, error);
          throw Object.assign(new Error(translated), { fatal: true });
        }

        if (!data?.imageBase64) {
          const msg = data?.error || 'La función no devolvió una imagen';
          const isQuota = msg.toLowerCase().includes('cuota') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('neuron');
          throw Object.assign(new Error(translateGenerationError(msg, null)), { fatal: isQuota });
        }

        frame.blob = base64ToBlob(data.imageBase64, data.mimeType || 'image/png');
        if (data.seed != null) frame.seed = data.seed;
        if (data.remainingEstimatedNeurons != null) {
          toast(`Generado · cuota estimada restante: ${data.remainingEstimatedNeurons}`);
        }
      }

      // Success
      frame.imagePath = '';
      frame.status = 'ready';
      frame.updatedAt = Date.now();
      return false; // continue loop

    } catch (error) {
      console.error('generateFrame error:', error);
      frame.status = 'error';
      toast(error.message || String(error));
      return error.fatal ?? false; // true = stop remaining frames
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt builder
  // ---------------------------------------------------------------------------

  function buildFramePrompt(frame, dir, anim) {
    const base = state.currentProject.basePrompt;
    const movement = frame.prompt || `Animación ${anim.type}, dirección ${dir.name}, frame ${dir.frames.indexOf(frame)+1} de ${dir.frames.length}.`;
    const mirrorNote = anim.mirror ? 'Modo espejo activo. Solo generar las direcciones base necesarias; las direcciones opuestas se cubrirán con flip horizontal.' : '';
    const negative = state.currentProject.negativePrompt ? `Evitar estrictamente: ${state.currentProject.negativePrompt}.` : '';
    const referenceNote = state.currentProject.references?.length ? 'Usa las imágenes de referencia adjuntas para conservar exactamente el personaje, vestimenta, proporciones, cámara y estilo.' : '';
    return `${base}
${movement}
${referenceNote}
${mirrorNote}
${negative}
Mantener exactamente el mismo personaje, escala, encuadre, iluminación y paleta. Fondo magenta chroma puro #FF00FF, sin degradado hacia el fondo.`;
  }

  // ---------------------------------------------------------------------------
  // Demo frame generator
  // ---------------------------------------------------------------------------

  async function makeDemoFrame(width, height, direction, index, type) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(width, 512); canvas.height = Math.min(height, 512);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    const cx = canvas.width/2;
    const y = canvas.height*.66;
    const bob = Math.sin((index-1)/6*Math.PI*2)*canvas.height*.025;
    ctx.fillStyle = '#2a2430';
    ctx.beginPath(); ctx.ellipse(cx, y+bob, canvas.width*.12, canvas.height*.22, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#b89a61';
    ctx.beginPath(); ctx.arc(cx, y-canvas.height*.22+bob, canvas.width*.075, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#ded1b8'; ctx.lineWidth = Math.max(2, canvas.width*.012);
    ctx.beginPath();
    const phase = Math.sin((index-1)/6*Math.PI*2);
    ctx.moveTo(cx-canvas.width*.04, y-canvas.height*.02+bob); ctx.lineTo(cx-canvas.width*.15, y+canvas.height*(.12*phase)+bob);
    ctx.moveTo(cx+canvas.width*.04, y-canvas.height*.02+bob); ctx.lineTo(cx+canvas.width*.15, y-canvas.height*(.12*phase)+bob);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(10,10,canvas.width-20,44);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(14,canvas.width*.035)}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(`${type} · ${direction} · ${index}`, cx, 39);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  // ---------------------------------------------------------------------------
  // Export step
  // ---------------------------------------------------------------------------

  function renderExportStep() {
    const anim = getActiveAnimation();
    const total = anim.directions.reduce((n,d) => n+d.frames.length,0);
    const ready = anim.directions.reduce((n,d) => n+d.frames.filter(assetHasImage).length,0);
    const logicalDirections = anim.mirror ? anim.directionCount : anim.directions.length;
    els.main.innerHTML = `
      <section class="section">
        <div class="card">
          <div class="stats-grid">
            <div class="stat"><strong>${anim.directions.length}${anim.mirror ? `/${logicalDirections}` : ''}</strong><span>direcciones</span></div>
            <div class="stat"><strong>${total}</strong><span>huecos</span></div>
            <div class="stat"><strong>${ready}</strong><span>con imagen</span></div>
          </div>
        </div>
        <div class="card export-grid">
          <label class="field"><span>Orden de exportación</span>
            <select id="exportOrder"><option value="rows">Una fila por dirección</option><option value="flat">Todos seguidos</option></select>
          </label>
          ${anim.mirror ? `<label class="field"><span>Exportación espejo</span>
            <div style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;background:#141313;">
              <input id="expandMirrorExport" type="checkbox" checked style="width:20px;height:20px;accent-color: var(--accent);margin-top:2px;">
              <div><div style="font-weight:700">Expandir direcciones espejadas</div><div class="muted small">Al exportar, se crearán también las direcciones opuestas aplicando flip horizontal.</div></div>
            </div>
          </label>` : ''}
          <label class="field"><span>Espaciado entre frames (px)</span><input id="exportGap" type="number" min="0" max="64" value="0"></label>
          <button id="previewSheetBtn" class="secondary-btn">Crear vista previa</button>
          <button id="downloadSheetBtn" class="primary-btn">Descargar spritesheet PNG</button>
        </div>
        <div id="sheetPreview" class="canvas-wrap"><p class="muted small">La vista previa aparecerá aquí.</p></div>
      </section>`;

    document.getElementById('previewSheetBtn').addEventListener('click', previewSpritesheet);
    document.getElementById('downloadSheetBtn').addEventListener('click', downloadSpritesheet);
  }

  async function previewSpritesheet() {
    const canvas = await buildSpritesheetCanvas();
    const wrap = document.getElementById('sheetPreview');
    wrap.innerHTML = ''; wrap.appendChild(canvas);
  }

  async function downloadSpritesheet() {
    const canvas = await buildSpritesheetCanvas();
    canvas.toBlob(blob => {
      if (!blob) return;
      downloadBlob(blob, `${slugify(state.currentProject.name)}_${slugify(getActiveAnimation().name)}.png`);
    }, 'image/png');
  }

  async function buildSpritesheetCanvas() {
    const anim = getActiveAnimation();
    const order = document.getElementById('exportOrder')?.value || 'rows';
    const gap = clampInt(document.getElementById('exportGap')?.value, 0, 64, 0);
    const expandMirror = !!document.getElementById('expandMirrorExport')?.checked;
    const exportDirections = getExportDirections(anim, expandMirror);
    const frameW = anim.width, frameH = anim.height;
    let cols, rows, flatFrames;
    if (order === 'rows') {
      cols = Math.max(...exportDirections.map(d => d.frames.length), 1);
      rows = exportDirections.length;
      flatFrames = exportDirections.flatMap((d, row) => d.frames.map((entry, col) => ({ ...entry, row, col })));
    } else {
      const frames = exportDirections.flatMap(d => d.frames);
      cols = Math.ceil(Math.sqrt(frames.length || 1));
      rows = Math.ceil((frames.length || 1)/cols);
      flatFrames = frames.map((entry, i) => ({ ...entry, row: Math.floor(i/cols), col: i%cols }));
    }
    const canvas = document.createElement('canvas');
    canvas.width = cols*frameW + Math.max(0,cols-1)*gap;
    canvas.height = rows*frameH + Math.max(0,rows-1)*gap;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = anim.background || '#ff00ff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    for (const {frame, flip, row, col} of flatFrames) {
      if (!assetHasImage(frame)) continue;
      const blob = await assetToBlob(frame);
      if (!blob) continue;
      const img = await blobToImage(blob);
      const x = col*(frameW+gap);
      const y = row*(frameH+gap);
      if (flip) {
        ctx.save();
        ctx.translate(x + frameW, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, frameW, frameH);
        ctx.restore();
      } else {
        ctx.drawImage(img, x, y, frameW, frameH);
      }
    }
    return canvas;
  }
