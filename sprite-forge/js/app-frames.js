'use strict';

// ---------------------------------------------------------------------------
// Preview player state (persists across renders)
// ---------------------------------------------------------------------------

const previewState = {
  active: false,
  fps: 8,
  loop: true,
  onionSkin: false,
  frameIndex: 0,
  timer: null
};

// Persistent state for the adjust-offset drag modal
const adjustState = {
  frameId: null,
  origOffsetX: 0,
  origOffsetY: 0,
  origScale: 1,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartOX: 0,
  dragStartOY: 0,
};

// ---------------------------------------------------------------------------
// Render frames step
// ---------------------------------------------------------------------------

function renderFramesStep() {
  const anim = getActiveAnimation();
  if (!state.selectedDirection || !anim.directions.some(d => d.id === state.selectedDirection))
    state.selectedDirection = anim.directions[0]?.id;
  const dir = getSelectedDirection();

  const hasMaster = !!state.currentProject.masterReferenceId &&
    state.currentProject.references.some(r => r.id === state.currentProject.masterReferenceId);
  const anchorCount = dir.frames.filter(f => f.isAnchor && assetHasImage(f)).length;
  const consistencyLabel = (hasMaster && anchorCount >= 2)
    ? '<span style="color:var(--accent)">Alta ⭐</span>'
    : (hasMaster || anchorCount >= 1)
      ? '<span style="color:#c8b84d">Media</span>'
      : '<span style="color:var(--danger)">Baja</span>';

  const tabs = anim.directions.map(d =>
    `<button data-dir="${d.id}" class="${d.id === dir.id ? 'active' : ''}">${escapeHtml(d.name)} · ${d.frames.length}</button>`
  ).join('');
  const frames = dir.frames.map((frame, index) => frameCardHtml(frame, index, isPreviewFlipped(dir.id))).join('');
  const generatedDirectionCount = anim.directions.length;
  const directionMeta = anim.mirror
    ? `${generatedDirectionCount}/${anim.directionCount} direcciones · espejo`
    : `${anim.directionCount} direcciones · orden libre`;
  const noMasterWarning = hasMaster ? '' :
    `<p class="muted small" style="margin:6px 0 0">⚠️ Sin referencia maestra — márcala en la pestaña Base para mejorar la consistencia.</p>`;

  els.main.innerHTML = `
    <section class="section">
      <div class="card">
        <div class="section-head">
          <div><h3 style="margin:0">${escapeHtml(anim.name)}</h3><p class="muted small" style="margin:4px 0 0">${directionMeta}</p></div>
          <button id="generateAllBtn" class="primary-btn">Generar todo</button>
        </div>
        <p class="muted small" style="margin:10px 0 0">Motor: ${state.settings.demoMode || !state.online ? 'demostración local' : 'Cloudflare FLUX mediante Supabase'}</p>
      </div>

      <div class="card">
        <div class="section-head" style="flex-wrap:wrap;gap:8px">
          <div><span class="muted small">Consistencia:</span> <strong>${consistencyLabel}</strong></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="generateAnchorsBtn" class="secondary-btn" style="min-height:38px;font-size:.83rem">⚓ Generar anclas</button>
            <button id="generateIntermediatesBtn" class="secondary-btn" style="min-height:38px;font-size:.83rem">🔗 Generar intermedios</button>
            <button id="togglePreviewBtn" class="secondary-btn" style="min-height:38px;font-size:.83rem">▶ Vista previa</button>
          </div>
        </div>
        ${noMasterWarning}
        <details style="margin-top:8px">
          <summary class="muted small" style="cursor:pointer;user-select:none">Opciones avanzadas (seeds · alineación · cebolla)</summary>
          <div style="display:grid;gap:10px;margin-top:10px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="muted small">Semilla animación:</span>
              <code class="muted small">${anim.baseSeed ?? '—'}</code>
              <button id="rerollAnimSeedBtn" class="mini-btn" style="font-size:.78rem">↺</button>
              <span class="muted small" style="margin-left:8px">Semilla dirección:</span>
              <code class="muted small">${dir.directionSeed ?? '—'}</code>
              <button id="rerollDirSeedBtn" class="mini-btn" style="font-size:.78rem">↺</button>
            </div>
            <label class="muted small" style="display:flex;gap:8px;align-items:center">
              <input type="checkbox" id="onionSkinCheck" ${previewState.onionSkin ? 'checked' : ''}>
              Piel de cebolla en previsualización (25% opacidad)
            </label>
          </div>
        </details>
      </div>

      <div id="previewPlayerSection" style="display:none">
        <div class="card" style="gap:10px">
          <div class="section-head"><strong>Vista previa</strong><button id="closePreviewBtn" class="mini-btn">✕</button></div>
          <canvas id="previewCanvas" style="max-width:100%;border-radius:10px;background:#ff00ff;image-rendering:pixelated;display:block;margin:0 auto"></canvas>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">
            <button id="previewPlayBtn" class="secondary-btn" style="min-height:38px">▶ Play</button>
            <button id="previewPauseBtn" class="secondary-btn" style="min-height:38px">⏸ Pausa</button>
            <label class="muted small">FPS: <select id="previewFpsSelect" style="margin-left:4px;background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px">
              ${[4, 6, 8, 10, 12].map(f => `<option value="${f}" ${previewState.fps === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select></label>
            <label class="muted small"><input type="checkbox" id="previewLoopCheck" ${previewState.loop ? 'checked' : ''}> Loop</label>
          </div>
        </div>
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

  // Direction tabs
  els.main.querySelectorAll('[data-dir]').forEach(btn =>
    btn.addEventListener('click', () => { state.selectedDirection = btn.dataset.dir; stopPreview(); renderEditor(); }));

  // Toolbar
  document.getElementById('addFrameBtn').addEventListener('click', () => {
    const f = createFrame(dir.frames.length + 1);
    f.seed = (dir.directionSeed || 0) + dir.frames.length;
    dir.frames.push(f); renumberFrames(dir); scheduleSave(); renderEditor();
  });
  document.getElementById('applySlotCountBtn').addEventListener('click', () => {
    const wanted = clampInt(document.getElementById('slotCountInput').value, 1, 48, dir.frames.length || 1);
    while (dir.frames.length < wanted) {
      const f = createFrame(dir.frames.length + 1);
      f.seed = (dir.directionSeed || 0) + dir.frames.length;
      dir.frames.push(f);
    }
    if (dir.frames.length > wanted) dir.frames.splice(wanted);
    renumberFrames(dir); scheduleSave(); renderEditor();
  });
  document.getElementById('generateAllBtn').addEventListener('click', () => generateAnimation(false));
  document.getElementById('generateMissingBtn').addEventListener('click', () => generateDirectionMissing(dir));
  document.getElementById('duplicateDirectionBtn').addEventListener('click', duplicateSelectedDirectionToTarget);
  document.getElementById('flipPreviewBtn').addEventListener('click', () => { toggleDirectionPreviewFlip(dir.id); renderEditor(); });
  document.getElementById('goExportBtn').addEventListener('click', () => { state.currentStep = 'export'; renderEditor(); });

  // Consistency panel
  document.getElementById('generateAnchorsBtn').addEventListener('click', () => generateAnchors());
  document.getElementById('generateIntermediatesBtn').addEventListener('click', () => generateIntermediates());
  document.getElementById('togglePreviewBtn').addEventListener('click', () => {
    const section = document.getElementById('previewPlayerSection');
    if (section.style.display === 'none') {
      section.style.display = '';
      startPreview();
    } else {
      stopPreview();
      section.style.display = 'none';
    }
  });

  // Advanced seeds
  document.getElementById('rerollAnimSeedBtn').addEventListener('click', () => {
    anim.baseSeed = randomSeed();
    scheduleSave(); renderEditor();
  });
  document.getElementById('rerollDirSeedBtn').addEventListener('click', () => {
    dir.directionSeed = randomSeed();
    dir.frames.forEach((f, i) => { if (!f.approved) f.seed = dir.directionSeed + i; });
    scheduleSave(); renderEditor();
  });
  document.getElementById('onionSkinCheck').addEventListener('change', e => {
    previewState.onionSkin = e.target.checked;
  });

  // Preview player controls
  document.getElementById('closePreviewBtn').addEventListener('click', () => {
    stopPreview();
    document.getElementById('previewPlayerSection').style.display = 'none';
  });
  document.getElementById('previewPlayBtn').addEventListener('click', startPreview);
  document.getElementById('previewPauseBtn').addEventListener('click', pausePreview);
  document.getElementById('previewFpsSelect').addEventListener('change', e => {
    previewState.fps = Number(e.target.value);
    if (previewState.active) { stopPreviewTimer(); startPreviewTimer(); }
  });
  document.getElementById('previewLoopCheck').addEventListener('change', e => { previewState.loop = e.target.checked; });

  bindFrameActions();
  bindPointerReorder();
}

// ---------------------------------------------------------------------------
// Frame card HTML
// ---------------------------------------------------------------------------

function frameCardHtml(frame, index, flipped = false) {
  const src = assetSrc(frame);
  const image = src
    ? `<img src="${escapeAttr(src)}" alt="${escapeHtml(frame.label)}" style="transform:${flipped ? 'scaleX(-1)' : 'none'}">`
    : `${index + 1}`;
  const anchorActive = frame.isAnchor ? 'style="color:var(--accent);border-color:var(--accent)"' : '';
  const approveActive = frame.approved ? 'style="color:var(--success);border-color:var(--success)"' : '';
  const anchorBadge = frame.isAnchor ? '<span style="color:var(--accent);font-size:.68rem"> ⚓</span>' : '';
  const approvedBadge = frame.approved ? '<span style="color:var(--success);font-size:.68rem"> ✓</span>' : '';
  const seedTip = frame.seed != null ? ` 🎲${frame.seed}` : '';
  const alignTip = frame.autoAligned ? ` Δ(${frame.offsetX},${frame.offsetY})` : '';

  return `
    <article class="frame-card" data-frame-id="${frame.id}">
      <div class="frame-card-top">
        <div class="drag-handle" title="Arrastrar">⋮⋮</div>
        <button class="mini-btn" data-toggle-anchor="${frame.id}" title="${frame.isAnchor ? 'Quitar ancla' : 'Marcar como ancla'}" ${anchorActive}>⚓</button>
        <button class="mini-btn" data-toggle-approve="${frame.id}" title="${frame.approved ? 'Quitar aprobación' : 'Aprobar'}" ${approveActive}>✓</button>
      </div>
      <button class="frame-preview" data-upload-frame="${frame.id}">${image}</button>
      <div class="frame-body">
        <div class="frame-title">
          <strong>${escapeHtml(frame.label)}${anchorBadge}${approvedBadge}</strong>
          <span class="frame-status ${frame.status}">${statusLabel(frame.status)}</span>
        </div>
        ${seedTip || alignTip ? `<div class="muted" style="font-size:.65rem;margin-top:2px">${seedTip}${alignTip}</div>` : ''}
        <div class="frame-actions">
          <button class="mini-btn" data-move-left="${frame.id}" title="Mover antes">←</button>
          <button class="mini-btn" data-move-right="${frame.id}" title="Mover después">→</button>
          <button class="mini-btn" data-duplicate-frame="${frame.id}" title="Duplicar">⧉</button>
          <button class="mini-btn" data-generate-frame="${frame.id}" title="Regenerar mismo seed">↻</button>
          <button class="mini-btn" data-generate-new-seed="${frame.id}" title="Regenerar nuevo seed">↺+</button>
          <button class="mini-btn" data-auto-align="${frame.id}" title="Autoalinear">⊹</button>
          <button class="mini-btn" data-adjust-frame="${frame.id}" title="Ajustar posición manualmente">✥</button>
          <button class="mini-btn" data-delete-frame="${frame.id}" title="Eliminar">🗑</button>
        </div>
      </div>
    </article>`;
}

// ---------------------------------------------------------------------------
// Bind frame card actions
// ---------------------------------------------------------------------------

function bindFrameActions() {
  els.main.querySelectorAll('[data-upload-frame]').forEach(btn => btn.addEventListener('click', () => {
    state.pendingFrameUploadId = btn.dataset.uploadFrame;
    els.frameInput.click();
  }));
  els.main.querySelectorAll('[data-move-left]').forEach(btn => btn.addEventListener('click', () => moveFrame(btn.dataset.moveLeft, -1)));
  els.main.querySelectorAll('[data-move-right]').forEach(btn => btn.addEventListener('click', () => moveFrame(btn.dataset.moveRight, 1)));
  els.main.querySelectorAll('[data-duplicate-frame]').forEach(btn => btn.addEventListener('click', () => duplicateFrame(btn.dataset.duplicateFrame)));
  els.main.querySelectorAll('[data-generate-frame]').forEach(btn => btn.addEventListener('click', () => generateFrameById(btn.dataset.generateFrame, false)));
  els.main.querySelectorAll('[data-generate-new-seed]').forEach(btn => btn.addEventListener('click', () => generateFrameById(btn.dataset.generateNewSeed, true)));
  els.main.querySelectorAll('[data-delete-frame]').forEach(btn => btn.addEventListener('click', () => deleteFrame(btn.dataset.deleteFrame)));
  els.main.querySelectorAll('[data-toggle-anchor]').forEach(btn => btn.addEventListener('click', () => toggleFrameAnchor(btn.dataset.toggleAnchor)));
  els.main.querySelectorAll('[data-toggle-approve]').forEach(btn => btn.addEventListener('click', () => toggleFrameApprove(btn.dataset.toggleApprove)));
  els.main.querySelectorAll('[data-auto-align]').forEach(btn => btn.addEventListener('click', () => autoAlignFrame(btn.dataset.autoAlign)));
  els.main.querySelectorAll('[data-adjust-frame]').forEach(btn => btn.addEventListener('click', () => openAdjustOverlay(btn.dataset.adjustFrame)));
}

// ---------------------------------------------------------------------------
// Frame mutations
// ---------------------------------------------------------------------------

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
  copy.id = uid(); copy.label = 'Frame';
  copy.isAnchor = false; copy.approved = false;
  copy.createdAt = copy.updatedAt = Date.now();
  dir.frames.splice(index + 1, 0, copy);
  renumberFrames(dir); scheduleSave(); renderEditor();
}

function deleteFrame(id) {
  const dir = getSelectedDirection();
  dir.frames = dir.frames.filter(f => f.id !== id);
  renumberFrames(dir); scheduleSave(); renderEditor();
}

function toggleFrameAnchor(id) {
  const dir = getSelectedDirection();
  const frame = dir.frames.find(f => f.id === id);
  if (!frame) return;
  frame.isAnchor = !frame.isAnchor;
  scheduleSave(); renderEditor();
}

function toggleFrameApprove(id) {
  const dir = getSelectedDirection();
  const frame = dir.frames.find(f => f.id === id);
  if (!frame) return;
  frame.approved = !frame.approved;
  scheduleSave(); renderEditor();
}

function renumberFrames(dir) {
  dir.frames.forEach((f, i) => f.label = `Frame ${i + 1}`);
}

// ---------------------------------------------------------------------------
// Auto-alignment (bounding-box foot anchor)
// ---------------------------------------------------------------------------

async function autoAlignFrame(id) {
  const dir = getSelectedDirection();
  const frame = dir.frames.find(f => f.id === id);
  if (!frame || !assetHasImage(frame)) return toast('El frame necesita imagen para alinearse.');
  const anchorFrame = dir.frames.find(f => f.isAnchor && assetHasImage(f) && f.id !== id) || null;
  try {
    await autoAlign(frame, anchorFrame);
    scheduleSave(); renderEditor();
  } catch (err) {
    toast('No se pudo alinear: ' + (err.message || err));
  }
}

async function autoAlign(frame, anchorFrame) {
  const TOLERANCE = 30;
  function isMagenta(r, g, b) {
    return Math.abs(r - 255) <= TOLERANCE && g <= TOLERANCE && Math.abs(b - 255) <= TOLERANCE;
  }

  async function getBB(blob) {
    const img = await blobToImage(blob);
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, cvs.width, cvs.height);
    let minX = cvs.width, maxX = 0, minY = cvs.height, maxY = 0, found = false;
    for (let y = 0; y < cvs.height; y++) {
      for (let x = 0; x < cvs.width; x++) {
        const i = (y * cvs.width + x) * 4;
        if (!isMagenta(data[i], data[i + 1], data[i + 2])) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) return null;
    return { centerX: Math.round((minX + maxX) / 2), footY: maxY };
  }

  const frameBlob = await assetToBlob(frame);
  if (!frameBlob) return;
  const frameBB = await getBB(frameBlob);
  if (!frameBB) { toast('No se detectó personaje (sin píxeles no-magenta).'); return; }

  if (anchorFrame) {
    const anchorBlob = await assetToBlob(anchorFrame);
    if (anchorBlob) {
      const anchorBB = await getBB(anchorBlob);
      if (anchorBB) {
        frame.offsetX = anchorBB.centerX - frameBB.centerX;
        frame.offsetY = anchorBB.footY - frameBB.footY;
        frame.autoAligned = true;
        toast(`Alineado · Δx=${frame.offsetX} Δy=${frame.offsetY}`);
        return;
      }
    }
  }
  frame.offsetX = 0; frame.offsetY = 0; frame.autoAligned = true;
  toast('Sin ancla de referencia: offsets a cero.');
}

// ---------------------------------------------------------------------------
// Adjust-offset overlay (drag / nudge to reposition a frame)
// ---------------------------------------------------------------------------

async function openAdjustOverlay(frameId) {
  const dir = getSelectedDirection();
  const anim = getActiveAnimation();
  const frame = dir.frames.find(f => f.id === frameId);
  if (!frame || !assetHasImage(frame)) return toast('El frame necesita imagen para ajustar.');

  // Persist originals so Cancel can restore them
  adjustState.frameId = frameId;
  adjustState.origOffsetX = frame.offsetX || 0;
  adjustState.origOffsetY = frame.offsetY || 0;
  adjustState.origScale = frame.scale ?? 1;

  // Reference ghost: nearest anchor-with-image (not self), else first frame with image
  const refFrame = dir.frames.find(f => f.isAnchor && assetHasImage(f) && f.id !== frameId)
    || dir.frames.find(f => assetHasImage(f) && f.id !== frameId)
    || null;

  const overlay = document.createElement('div');
  overlay.id = 'adjustOverlay';
  overlay.innerHTML = `
    <div class="adjust-modal">
      <div class="section-head" style="margin-bottom:8px">
        <strong>Ajustar posición · ${escapeHtml(frame.label)}</strong>
        <button id="adjCloseBtn" class="mini-btn" title="Cancelar">✕</button>
      </div>
      <p class="muted small" style="margin:0 0 8px">Arrastra el personaje · botones ± 1 px · ↺ para resetear.</p>
      <canvas id="adjCanvas" width="${anim.width}" height="${anim.height}"
        style="border-radius:10px;background:#ff00ff;image-rendering:pixelated;display:block;margin:0 auto;max-width:100%"></canvas>
      <div class="adj-readouts" style="margin-top:8px">
        <button class="mini-btn" id="adjLeft">←</button>
        <button class="mini-btn" id="adjRight">→</button>
        <button class="mini-btn" id="adjUp">↑</button>
        <button class="mini-btn" id="adjDown">↓</button>
        <span class="muted small">ΔX&nbsp;<code id="adjX">0</code></span>
        <span class="muted small">ΔY&nbsp;<code id="adjY">0</code></span>
        <button class="mini-btn" id="adjReset">↺&nbsp;0</button>
      </div>
      <label class="field" style="margin-top:6px">
        <span>Escala</span>
        <input id="adjScale" type="range" min="0.5" max="2" step="0.05" value="${frame.scale ?? 1}" style="flex:1">
        <code id="adjScaleVal">${(frame.scale ?? 1).toFixed(2)}×</code>
      </label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button id="adjCancelBtn" class="secondary-btn">Cancelar</button>
        <button id="adjSaveBtn" class="primary-btn">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = document.getElementById('adjCanvas');

  /** Pixel-to-canvas ratio (CSS px → logical canvas px). */
  function cssToCanvas() {
    return canvas.width / canvas.getBoundingClientRect().width;
  }

  async function redraw() {
    const f = dir.frames.find(f => f.id === frameId);
    if (!f) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Ghost reference frame at 40 % opacity, no offset, scale=1
    if (refFrame) {
      try {
        const rBlob = await assetToBlob(refFrame);
        if (rBlob) {
          const rImg = await blobToImage(rBlob);
          ctx.save(); ctx.globalAlpha = 0.4;
          ctx.drawImage(rImg, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
      } catch {}
    }

    // Current frame: center-pivot translate + scale
    try {
      const blob = await assetToBlob(f);
      if (blob) {
        const img = await blobToImage(blob);
        const s = f.scale ?? 1;
        const ox = f.offsetX || 0;
        const oy = f.offsetY || 0;
        ctx.save(); ctx.globalAlpha = 1;
        // Foot-bottom pivot — matches applyFrameTransform in renderPreviewFrame
        ctx.translate(canvas.width / 2 + ox, canvas.height + oy - s * canvas.height / 2);
        ctx.scale(s, s);
        ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
        ctx.restore();
      }
    } catch {}

    // Update numeric readouts
    const xEl = document.getElementById('adjX');
    const yEl = document.getElementById('adjY');
    if (xEl) xEl.textContent = f.offsetX || 0;
    if (yEl) yEl.textContent = f.offsetY || 0;
  }

  await redraw();

  // ── Pointer drag ──────────────────────────────────────────────────────────
  canvas.addEventListener('pointerdown', e => {
    adjustState.dragging = true;
    adjustState.dragStartX = e.clientX;
    adjustState.dragStartY = e.clientY;
    const f = dir.frames.find(f => f.id === frameId);
    adjustState.dragStartOX = f?.offsetX || 0;
    adjustState.dragStartOY = f?.offsetY || 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', async e => {
    if (!adjustState.dragging) return;
    const ratio = cssToCanvas();
    const dx = Math.round((e.clientX - adjustState.dragStartX) * ratio);
    const dy = Math.round((e.clientY - adjustState.dragStartY) * ratio);
    const f = dir.frames.find(f => f.id === frameId);
    if (!f) return;
    f.offsetX = adjustState.dragStartOX + dx;
    f.offsetY = adjustState.dragStartOY + dy;
    await redraw();
  });
  const endDrag = () => { adjustState.dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ── Fine-tune nudge buttons ───────────────────────────────────────────────
  async function nudge(dx, dy) {
    const f = dir.frames.find(f => f.id === frameId);
    if (!f) return;
    f.offsetX = (f.offsetX || 0) + dx;
    f.offsetY = (f.offsetY || 0) + dy;
    await redraw();
  }
  document.getElementById('adjLeft').addEventListener('click',  () => nudge(-1,  0));
  document.getElementById('adjRight').addEventListener('click', () => nudge( 1,  0));
  document.getElementById('adjUp').addEventListener('click',    () => nudge( 0, -1));
  document.getElementById('adjDown').addEventListener('click',  () => nudge( 0,  1));

  // ── Reset ─────────────────────────────────────────────────────────────────
  document.getElementById('adjReset').addEventListener('click', async () => {
    const f = dir.frames.find(f => f.id === frameId);
    if (!f) return;
    f.offsetX = 0; f.offsetY = 0; f.scale = 1;
    document.getElementById('adjScale').value = 1;
    document.getElementById('adjScaleVal').textContent = '1.00×';
    await redraw();
  });

  // ── Scale slider ──────────────────────────────────────────────────────────
  document.getElementById('adjScale').addEventListener('input', async e => {
    const val = parseFloat(e.target.value);
    document.getElementById('adjScaleVal').textContent = val.toFixed(2) + '×';
    const f = dir.frames.find(f => f.id === frameId);
    if (!f) return;
    f.scale = val;
    await redraw();
  });

  // ── Cancel / Close ────────────────────────────────────────────────────────
  const cancelAdjust = () => {
    const f = dir.frames.find(f => f.id === frameId);
    if (f) { f.offsetX = adjustState.origOffsetX; f.offsetY = adjustState.origOffsetY; f.scale = adjustState.origScale; }
    overlay.remove();
  };
  document.getElementById('adjCloseBtn').addEventListener('click', cancelAdjust);
  document.getElementById('adjCancelBtn').addEventListener('click', cancelAdjust);
  overlay.addEventListener('click', e => { if (e.target === overlay) cancelAdjust(); });

  // ── Save ──────────────────────────────────────────────────────────────────
  document.getElementById('adjSaveBtn').addEventListener('click', () => {
    const f = dir.frames.find(f => f.id === frameId);
    if (f) f.autoAligned = true;
    overlay.remove();
    scheduleSave(); renderEditor();
  });
}

// ---------------------------------------------------------------------------
// Preview player
// ---------------------------------------------------------------------------

function startPreview() {
  previewState.active = true;
  previewState.frameIndex = 0;
  renderPreviewFrame();
  startPreviewTimer();
}

function pausePreview() {
  previewState.active = false;
  stopPreviewTimer();
}

function stopPreview() {
  previewState.active = false;
  stopPreviewTimer();
}

function stopPreviewTimer() {
  if (previewState.timer) { clearInterval(previewState.timer); previewState.timer = null; }
}

function startPreviewTimer() {
  stopPreviewTimer();
  previewState.timer = setInterval(async () => {
    const dir = getSelectedDirection();
    const frames = dir.frames.filter(assetHasImage);
    if (!frames.length) return;
    previewState.frameIndex = (previewState.frameIndex + 1) % frames.length;
    if (!previewState.loop && previewState.frameIndex === 0) { pausePreview(); return; }
    await renderPreviewFrame();
  }, Math.round(1000 / previewState.fps));
}

async function renderPreviewFrame() {
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;
  const dir = getSelectedDirection();
  const anim = getActiveAnimation();
  const visibleFrames = dir.frames.filter(assetHasImage);
  if (!visibleFrames.length) return;

  const frame = visibleFrames[previewState.frameIndex % visibleFrames.length];
  const prevFrame = visibleFrames[((previewState.frameIndex - 1) + visibleFrames.length) % visibleFrames.length];
  const flipped = isPreviewFlipped(dir.id);

  canvas.width = anim.width; canvas.height = anim.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const W = canvas.width, H = canvas.height;

  /**
   * Apply center-pivot translate + scale (+ optional horizontal flip).
   * All three callers (onion skin, current frame, adjust overlay) use this
   * same math so the preview is always consistent with the adjust overlay.
   *
   *   flipped=false: origin at (W/2+ox, H/2+oy), scale(s, s)
   *   flipped=true:  origin at (W/2+ox, H/2+oy), scale(-s, s)  ← mirror X
   */
  function applyFrameTransform(ctx2d, f, flip) {
    const ox = f.offsetX || 0;
    const oy = f.offsetY || 0;
    const s  = f.scale   ?? 1;
    // Foot-bottom pivot: Y anchor is the bottom edge of the cell.
    // This keeps the character's feet fixed when scale changes.
    // At s=1: translate(W/2+ox, H+oy-H/2) = (W/2+ox, H/2+oy) — same as center ✓
    ctx2d.translate(W / 2 + ox, H + oy - s * H / 2);
    ctx2d.scale(flip ? -s : s, s);
  }

  // Onion skin
  if (previewState.onionSkin && prevFrame && prevFrame.id !== frame.id) {
    try {
      const pBlob = await assetToBlob(prevFrame);
      if (pBlob) {
        const pImg = await blobToImage(pBlob);
        ctx.save();
        ctx.globalAlpha = 0.27;
        applyFrameTransform(ctx, prevFrame, flipped);
        ctx.drawImage(pImg, -W / 2, -H / 2, W, H);
        ctx.restore();
      }
    } catch {}
  }

  // Current frame
  try {
    const blob = await assetToBlob(frame);
    if (blob) {
      const img = await blobToImage(blob);
      ctx.save();
      ctx.globalAlpha = 1;
      applyFrameTransform(ctx, frame, flipped);
      ctx.drawImage(img, -W / 2, -H / 2, W, H);
      ctx.restore();
    }
  } catch {}
}

// ---------------------------------------------------------------------------
// Drag-to-reorder
// ---------------------------------------------------------------------------

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
      scheduleSave(); renderEditor();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

// ---------------------------------------------------------------------------
// Generation — public entry points
// ---------------------------------------------------------------------------

async function generateAnimation(onlyMissing) {
  const anim = getActiveAnimation();
  let ctx = null;

  if (!state.settings.demoMode && state.online && sb) {
    try {
      ctx = await prepareGeneration();
    } catch (error) {
      toast(error.message || 'Error al preparar la generación');
      return;
    }
  }

  if (!state.currentProject.masterReferenceId) {
    toast('Sin referencia maestra — consistencia entre frames puede variar.');
  }

  const referenceUrls = ctx?.referenceUrls || [];

  for (const dir of anim.directions) {
    for (const frame of dir.frames) {
      if (onlyMissing && assetHasImage(frame)) continue;
      if (frame.approved && assetHasImage(frame)) continue;
      const stop = await generateFrame(frame, dir, anim, referenceUrls, []);
      if (stop) { scheduleSave(); renderEditor(); return; }
    }
  }
  scheduleSave(); renderEditor();
}

async function generateDirectionMissing(dir) {
  const anim = getActiveAnimation();
  let ctx = null;

  if (!state.settings.demoMode && state.online && sb) {
    try {
      ctx = await prepareGeneration();
    } catch (error) {
      toast(error.message || 'Error al preparar la generación');
      return;
    }
  }

  const referenceUrls = ctx?.referenceUrls || [];
  for (const frame of dir.frames) {
    if (assetHasImage(frame)) continue;
    const stop = await generateFrame(frame, dir, anim, referenceUrls, []);
    if (stop) { scheduleSave(); renderEditor(); return; }
  }
  scheduleSave(); renderEditor();
}

async function generateFrameById(id, newSeed = false) {
  const anim = getActiveAnimation();
  const dir = getSelectedDirection();
  const frame = dir.frames.find(f => f.id === id);
  if (!frame) return;

  let ctx = null;
  if (!state.settings.demoMode && state.online && sb) {
    try {
      ctx = await prepareGeneration();
    } catch (error) {
      toast(error.message || 'Error al preparar la generación');
      return;
    }
  }

  if (newSeed) { frame.seed = randomSeed(); scheduleSave(); }

  frame.status = 'loading'; renderEditor();
  const referenceUrls = ctx?.referenceUrls || [];
  await generateFrame(frame, dir, anim, referenceUrls, []);
  scheduleSave(); renderEditor();
}

// ---------------------------------------------------------------------------
// Anchor generation
// ---------------------------------------------------------------------------

async function generateAnchors() {
  const anim = getActiveAnimation();
  const dir = getSelectedDirection();
  const frames = dir.frames;

  const anchorIndices = getDefaultAnchorIndices(anim.type, frames.length);
  if (!anchorIndices.length) return toast('No hay suficientes frames para generar anclas.');

  // Mark as anchors without overwriting approved ones
  anchorIndices.forEach(i => { frames[i].isAnchor = true; });
  scheduleSave();

  let ctx = null;
  if (!state.settings.demoMode && state.online && sb) {
    try {
      ctx = await prepareGeneration();
    } catch (err) {
      toast(err.message || 'Error al preparar'); renderEditor(); return;
    }
  }

  for (const idx of anchorIndices) {
    const frame = frames[idx];
    if (frame.approved && assetHasImage(frame)) {
      toast(`Frame ${idx + 1} aprobado — omitido.`); continue;
    }

    const refUrls = buildAnchorRefs(ctx);
    const roles = ctx?.masterUrl ? ['master'] : [];

    frame.status = 'loading'; renderEditor();
    const stop = await generateFrame(frame, dir, anim, refUrls, roles);
    if (stop) { scheduleSave(); renderEditor(); return; }

    // Upload anchor immediately so it can serve as chained ref
    if (!state.settings.demoMode && state.online && sb && frame.blob && !frame.imagePath) {
      try {
        await uploadAsset(state.currentProject, frame, `frames/${anim.id}/${dir.id}`);
      } catch (err) { console.warn('Could not upload anchor:', err); }
    }
    scheduleSave();
  }

  renderEditor();
  toast(`Anclas generadas: frames ${anchorIndices.map(i => i + 1).join(', ')}`);
}

/** Return anchor indices for the given animation type and frame count. */
function getDefaultAnchorIndices(animType, frameCount) {
  if (frameCount < 1) return [];
  if (frameCount === 1) return [0];
  const cyclicTypes = ['Idle', 'Walk'];
  return cyclicTypes.includes(animType)
    ? [0, Math.floor(frameCount / 2)]   // first and middle
    : [0, frameCount - 1];               // first and last
}

function buildAnchorRefs(ctx) {
  if (!ctx) return [];
  const urls = [];
  if (ctx.masterUrl) urls.push(ctx.masterUrl);
  for (const url of (ctx.allRefUrls || [])) {
    if (!urls.includes(url) && urls.length < 4) urls.push(url);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Intermediate generation
// ---------------------------------------------------------------------------

async function generateIntermediates() {
  const anim = getActiveAnimation();
  const dir = getSelectedDirection();
  const frames = dir.frames;

  const anchorFrames = frames.filter(f => f.isAnchor && assetHasImage(f));
  if (anchorFrames.length < 2) {
    return toast('Necesitas al menos 2 anclas con imagen. Usa "Generar anclas" primero.');
  }

  const approvedCount = frames.filter(f => !f.isAnchor && f.approved && assetHasImage(f)).length;
  if (approvedCount > 0) {
    const ok = window.confirm(`${approvedCount} frame(s) aprobado(s) serían sobrescritos. ¿Continuar?`);
    if (!ok) return;
  }

  let ctx = null;
  if (!state.settings.demoMode && state.online && sb) {
    try {
      ctx = await prepareGeneration();
    } catch (err) {
      return toast(err.message || 'Error al preparar');
    }
  }

  const isCyclic = ['Idle', 'Walk'].includes(anim.type);
  const anchorIndices = anchorFrames.map(f => frames.indexOf(f));

  // Build segments: [startAnchorIdx, endAnchorIdx]
  const segments = [];
  for (let i = 0; i < anchorIndices.length - 1; i++) {
    segments.push([anchorIndices[i], anchorIndices[i + 1]]);
  }
  if (isCyclic && anchorIndices.length >= 2) {
    // Close the loop: last anchor → first anchor
    segments.push([anchorIndices[anchorIndices.length - 1], anchorIndices[0]]);
  }

  for (const [startIdx, endIdx] of segments) {
    const startAnchor = frames[startIdx];
    const endAnchor = frames[endIdx];

    // Ensure anchors are uploaded before chaining
    if (!state.settings.demoMode && state.online && sb) {
      for (const anchor of [startAnchor, endAnchor]) {
        if (anchor.blob && !anchor.imagePath) {
          try {
            await uploadAsset(state.currentProject, anchor, `frames/${anim.id}/${dir.id}`);
          } catch (err) { console.warn('Anchor upload failed:', err); }
        }
      }
    }

    const startAnchorUrl = startAnchor.imagePath ? publicAssetUrl(startAnchor.imagePath) : '';
    const endAnchorUrl = endAnchor.imagePath ? publicAssetUrl(endAnchor.imagePath) : '';

    // Intermediate indices: frames between startIdx and endIdx (exclusive)
    const intermediateIndices = [];
    if (endIdx > startIdx) {
      for (let i = startIdx + 1; i < endIdx; i++) intermediateIndices.push(i);
    } else {
      // Cyclic wrap: startIdx+1 to end of array, then 0 to endIdx-1
      for (let i = startIdx + 1; i < frames.length; i++) intermediateIndices.push(i);
      for (let i = 0; i < endIdx; i++) intermediateIndices.push(i);
    }

    if (!intermediateIndices.length) continue;

    let previousUrl = startAnchorUrl;

    for (const frameIdx of intermediateIndices) {
      const frame = frames[frameIdx];

      if (frame.approved && assetHasImage(frame)) {
        if (frame.imagePath) previousUrl = publicAssetUrl(frame.imagePath);
        continue;
      }

      const { urls: chainedUrls, roles: chainedRoles } = buildChainedRefs(
        ctx?.masterUrl || '', startAnchorUrl, previousUrl, endAnchorUrl
      );

      frame.status = 'loading'; renderEditor();
      const stop = await generateFrame(frame, dir, anim, chainedUrls, chainedRoles);
      if (stop) { scheduleSave(); renderEditor(); return; }

      // Upload immediately so the next frame can use this one as previousUrl.
      // Two cases: (a) blob exists and not yet uploaded → upload then use URL;
      //            (b) already uploaded (imagePath set, blob GC'd) → use URL directly.
      if (!state.settings.demoMode && state.online && sb) {
        if (frame.blob && !frame.imagePath) {
          try {
            await uploadAsset(state.currentProject, frame, `frames/${anim.id}/${dir.id}`);
          } catch (err) {
            console.warn('Intermediate upload failed:', err);
          }
        }
        if (frame.imagePath) previousUrl = publicAssetUrl(frame.imagePath);
      }

      scheduleSave();
    }
  }

  renderEditor();
  toast('Intermedios generados');
}

/**
 * Build deduped ordered reference list: master → start_anchor → previous_frame → end_anchor
 * Returns { urls: string[], roles: string[] } — at most 4 entries each.
 */
function buildChainedRefs(masterUrl, startAnchorUrl, previousUrl, endAnchorUrl) {
  const slots = [
    { url: masterUrl, role: 'master' },
    { url: startAnchorUrl, role: 'start_anchor' },
    { url: previousUrl, role: 'previous_frame' },
    { url: endAnchorUrl, role: 'end_anchor' },
  ];
  const seen = new Set();
  const filtered = slots.filter(s => {
    if (!s.url || seen.has(s.url)) return false;
    seen.add(s.url); return true;
  }).slice(0, 4);
  return { urls: filtered.map(s => s.url), roles: filtered.map(s => s.role) };
}

// ---------------------------------------------------------------------------
// Core generation — low level
// ---------------------------------------------------------------------------

/**
 * Generate a single frame.
 * @param {object} frame
 * @param {object} dir
 * @param {object} anim
 * @param {string[]} referenceUrls - Already uploaded reference URLs
 * @param {string[]} referenceRoles - Role labels ('master','start_anchor','previous_frame','end_anchor')
 * @returns {boolean} true = caller should stop the loop (fatal error)
 */
async function generateFrame(frame, dir, anim, referenceUrls = [], referenceRoles = []) {
  frame.status = 'loading';
  renderEditor();

  try {
    if (state.settings.demoMode || !state.online || !sb) {
      frame.blob = await makeDemoFrame(anim.width, anim.height, dir.name, dir.frames.indexOf(frame) + 1, anim.type);
    } else {
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
        seed: frame.seed ?? null,
        prompt: buildFramePrompt(frame, dir, anim, referenceRoles),
        referenceUrls,
        referenceRoles: referenceRoles.length ? referenceRoles : undefined
      };

      const { data, error } = await sb.functions.invoke(CONFIG.generationFunction, { body: payload });

      if (error) {
        let detail = error.message || 'La función de generación falló';
        try {
          const body = await error.context?.clone?.().json();
          if (body?.error) detail = body.error;
        } catch {}
        throw Object.assign(new Error(translateGenerationError(detail, error)), { fatal: true });
      }

      const imageBase64 =
        data?.imageBase64 ||
        data?.image ||
        data?.result?.image ||
        data?.data?.image ||
        '';

      if (typeof imageBase64 !== 'string' || imageBase64.length < 1000) {
        const msg = data?.error ||
          `Respuesta inválida de generate-sprite. Campos: ${Object.keys(data || {}).join(', ')}`;
        const isQuota = msg.toLowerCase().includes('cuota') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('neuron');
        throw Object.assign(new Error(translateGenerationError(msg, null)), { fatal: isQuota });
      }

      frame.blob = base64ToBlob(imageBase64, data.mimeType || 'image/png');
      if (data.seed != null) frame.seed = data.seed;
      if (data.remainingEstimatedNeurons != null) {
        toast(`Generado · cuota estimada restante: ${data.remainingEstimatedNeurons}`);
      }
    }

    frame.imagePath = '';
    frame.status = 'ready';
    frame.updatedAt = Date.now();
    return false;

  } catch (error) {
    console.error('generateFrame error:', error);
    frame.status = 'error';
    toast(error.message || String(error));
    return error.fatal ?? false;
  }
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildFramePrompt(frame, dir, anim, referenceRoles = []) {
  const base = state.currentProject.basePrompt;
  const movement = frame.prompt ||
    `Animación ${anim.type}, dirección ${dir.name}, frame ${dir.frames.indexOf(frame) + 1} de ${dir.frames.length}.`;
  const mirrorNote = anim.mirror
    ? 'Modo espejo activo. Solo generar las direcciones base necesarias; las direcciones opuestas se cubrirán con flip horizontal.'
    : '';
  const negative = state.currentProject.negativePrompt
    ? `Evitar estrictamente: ${state.currentProject.negativePrompt}.`
    : '';

  if (referenceRoles.length) {
    const roleLines = referenceRoles.map((role, i) => {
      switch (role) {
        case 'master':
          return `La imagen ${i} define exclusivamente la identidad, vestimenta, armas, proporciones, paleta, cámara, escala e iluminación del personaje.`;
        case 'start_anchor':
          return `La imagen ${i} es el comienzo del tramo de movimiento.`;
        case 'previous_frame':
          return `La imagen ${i} es el instante inmediatamente anterior.`;
        case 'end_anchor':
          return `La imagen ${i} es la postura de destino.`;
        default:
          return `La imagen ${i} es una referencia adicional.`;
      }
    }).join('\n');

    return `${roleLines}

Genera solamente el siguiente instante intermedio de la animación.
Mantén exactamente el mismo personaje y equipo.
No añadas ni elimines piezas.
No cambies la longitud de extremidades, altura, volumen, iluminación, encuadre ni paleta.
Mantén los pies en el mismo punto de apoyo.
Fondo magenta chroma puro #FF00FF.

${base}
${movement}
${mirrorNote}
${negative}`.trim();
  }

  // Default prompt (no roles)
  const referenceNote = state.currentProject.references?.length
    ? 'Usa las imágenes de referencia adjuntas para conservar exactamente el personaje, vestimenta, proporciones, cámara y estilo.'
    : '';
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
  ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2, y = canvas.height * .66;
  const bob = Math.sin((index - 1) / 6 * Math.PI * 2) * canvas.height * .025;
  ctx.fillStyle = '#2a2430';
  ctx.beginPath(); ctx.ellipse(cx, y + bob, canvas.width * .12, canvas.height * .22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#b89a61';
  ctx.beginPath(); ctx.arc(cx, y - canvas.height * .22 + bob, canvas.width * .075, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ded1b8'; ctx.lineWidth = Math.max(2, canvas.width * .012);
  ctx.beginPath();
  const phase = Math.sin((index - 1) / 6 * Math.PI * 2);
  ctx.moveTo(cx - canvas.width * .04, y - canvas.height * .02 + bob);
  ctx.lineTo(cx - canvas.width * .15, y + canvas.height * (.12 * phase) + bob);
  ctx.moveTo(cx + canvas.width * .04, y - canvas.height * .02 + bob);
  ctx.lineTo(cx + canvas.width * .15, y - canvas.height * (.12 * phase) + bob);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(10, 10, canvas.width - 20, 44);
  ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(14, canvas.width * .035)}px sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(`${type} · ${direction} · ${index}`, cx, 39);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// ---------------------------------------------------------------------------
// Export step (unchanged)
// ---------------------------------------------------------------------------

function renderExportStep() {
  const anim = getActiveAnimation();
  const total = anim.directions.reduce((n, d) => n + d.frames.length, 0);
  const ready = anim.directions.reduce((n, d) => n + d.frames.filter(assetHasImage).length, 0);
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
    const allFrames = exportDirections.flatMap(d => d.frames);
    cols = Math.ceil(Math.sqrt(allFrames.length || 1));
    rows = Math.ceil((allFrames.length || 1) / cols);
    flatFrames = allFrames.map((entry, i) => ({ ...entry, row: Math.floor(i / cols), col: i % cols }));
  }
  const canvas = document.createElement('canvas');
  canvas.width = cols * frameW + Math.max(0, cols - 1) * gap;
  canvas.height = rows * frameH + Math.max(0, rows - 1) * gap;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = anim.background || '#ff00ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const { frame, flip, row, col } of flatFrames) {
    if (!assetHasImage(frame)) continue;
    const blob = await assetToBlob(frame);
    if (!blob) continue;
    const img = await blobToImage(blob);
    const x  = col * (frameW + gap), y = row * (frameH + gap);
    const ox = frame.offsetX || 0;
    const oy = frame.offsetY || 0;
    const s  = frame.scale  ?? 1;
    ctx.save();
    // Clip to cell so a large offset doesn't bleed into adjacent frames
    ctx.beginPath(); ctx.rect(x, y, frameW, frameH); ctx.clip();
    // Foot-bottom pivot (same math as applyFrameTransform / renderPreviewFrame)
    ctx.translate(x + frameW / 2 + ox, y + frameH + oy - s * frameH / 2);
    ctx.scale(flip ? -s : s, s);
    ctx.drawImage(img, -frameW / 2, -frameH / 2, frameW, frameH);
    ctx.restore();
  }
  return canvas;
}
