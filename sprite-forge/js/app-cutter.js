'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CRIPTA Sprite Cutter — módulo integrado en Sprite Forge
// Extraído y adaptado de Sprite Cutter v5.
// Expone window.CutterModule con API pública para el flujo principal.
// ─────────────────────────────────────────────────────────────────────────────

window.CutterModule = (() => {
  // ── Estado interno ──────────────────────────────────────────────────────────
  const cs = { // cutterState
    source: null,
    sourceName: '',
    frames: [],
    selected: 0,
    playing: false,
    timer: null,
    history: [],
    currentVariantId: null,
    multiSelected: new Set()
  };

  let _container = null;
  let _gridDrag = null;
  let _touchDrag = null;

  // Callback que Sprite Forge asigna para recibir frames importados
  let _onAddToTimeline = null;

  // ── Helpers de DOM (scoped al contenedor) ──────────────────────────────────
  function q(id) {
    return _container ? _container.querySelector('[data-cc="' + id + '"]') : null;
  }

  // ── Utilidades de canvas ───────────────────────────────────────────────────
  function cloneCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function isMagenta(r, g, b, a) {
    return a > 10 && r > 220 && b > 220 && g < 45;
  }

  function makeTransparentMagenta(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (isMagenta(d[i], d[i + 1], d[i + 2], d[i + 3])) d[i + 3] = 0;
    }
    ctx.putImageData(img, 0, 0);
  }

  function trimCanvas(canvas, mode) {
    if (mode === 'off') return canvas;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const a = data[i + 3];
        const empty = mode === 'transparent'
          ? a < 10
          : (a < 10 || isMagenta(data[i], data[i + 1], data[i + 2], a));
        if (!empty) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return canvas;
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function cleanName(name) {
    return (name || 'sprite')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/, '')
      .toLowerCase();
  }

  // ── Métricas de la malla ───────────────────────────────────────────────────
  function getGridMetrics() {
    if (!cs.source) return null;
    const v = id => {
      const el = q(id);
      return el ? (parseFloat(el.value) || 0) : 0;
    };
    const cols = Math.max(1, Math.round(v('cols')) || 1);
    const rows = Math.max(1, Math.round(v('rows')) || 1);
    const gapX = Math.max(0, v('gapX'));
    const gapY = Math.max(0, v('gapY'));
    const marginX = Math.max(0, v('marginX'));
    const marginY = Math.max(0, v('marginY'));
    const offsetX = v('offsetX');
    const offsetY = v('offsetY');
    const sizeAdjX = v('sizeAdjustX');
    const sizeAdjY = v('sizeAdjustY');
    const usableW = cs.source.width - marginX * 2 - gapX * (cols - 1);
    const usableH = cs.source.height - marginY * 2 - gapY * (rows - 1);
    return {
      cols, rows, gapX, gapY, marginX, marginY, offsetX, offsetY,
      fw: Math.max(1, Math.floor(usableW / cols) + sizeAdjX),
      fh: Math.max(1, Math.floor(usableH / rows) + sizeAdjY)
    };
  }

  // ── Historial ──────────────────────────────────────────────────────────────
  function snapshot() {
    cs.history.push(cs.frames.map(f => ({
      canvas: cloneCanvas(f.canvas),
      flipped: f.flipped,
      sourceVariantId: f.sourceVariantId,
      sourceFrameIndex: f.sourceFrameIndex
    })));
    if (cs.history.length > 20) cs.history.shift();
    const btn = q('undoBtn');
    if (btn) btn.disabled = cs.history.length === 0;
  }

  function undo() {
    const prev = cs.history.pop();
    if (!prev) return;
    cs.frames = prev;
    cs.selected = Math.min(cs.selected, cs.frames.length - 1);
    cs.multiSelected.clear();
    const btn = q('undoBtn');
    if (btn) btn.disabled = cs.history.length === 0;
    renderFrames();
    drawPreview();
  }

  // ── Cargar imagen ──────────────────────────────────────────────────────────
  function loadImageFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        cs.source = img;
        cs.sourceName = file.name;
        const baseName = q('baseName');
        if (baseName) baseName.value = cleanName(file.name);
        const status = q('fileStatus');
        if (status) status.textContent = `${file.name} · ${img.width}×${img.height}px`;
        drawGridPreview();
        dispatchSettingsChange();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function loadImageFromUrl(url, variantId, settings) {
    cs.currentVariantId = variantId || null;
    cs.frames = [];
    cs.history = [];
    cs.multiSelected.clear();
    cs.selected = 0;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      cs.source = img;
      cs.sourceName = variantId ? `variante_${variantId}` : 'imagen';

      // Restore cutter settings for this variant
      if (settings) {
        const fields = ['cols','rows','gapX','gapY','marginX','marginY','offsetX','offsetY','sizeAdjustX','sizeAdjustY','bgMode','trim'];
        fields.forEach(id => {
          const el = q(id);
          if (el && settings[id] !== undefined) el.value = settings[id];
        });
      }

      const status = q('fileStatus');
      if (status) status.textContent = `${img.width}×${img.height}px · cargada desde Storage`;
      drawGridPreview();
      renderFrames();
      drawPreview();
    };
    img.onerror = () => {
      const status = q('fileStatus');
      if (status) status.textContent = 'Error al cargar la imagen desde Storage.';
    };
    img.src = url;
  }

  // ── Preview de malla ───────────────────────────────────────────────────────
  function drawGridPreview() {
    const gridCanvas = q('gridCanvas');
    if (!gridCanvas) return;
    const gctx = gridCanvas.getContext('2d');
    gctx.imageSmoothingEnabled = false;

    const box = gridCanvas.parentElement;
    const cssW = Math.max(280, box.clientWidth - 2);
    const cssH = Math.min(360, Math.max(220, cssW * 0.55));
    gridCanvas.width = Math.round(cssW * devicePixelRatio);
    gridCanvas.height = Math.round(cssH * devicePixelRatio);
    gridCanvas.style.width = cssW + 'px';
    gridCanvas.style.height = cssH + 'px';
    gctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    gctx.clearRect(0, 0, cssW, cssH);

    if (!cs.source) {
      gctx.fillStyle = '#282325';
      gctx.fillRect(0, 0, cssW, cssH);
      gctx.fillStyle = '#8f969d';
      gctx.font = '14px system-ui';
      gctx.textAlign = 'center';
      gctx.fillText('Importa o abre una variante para ver la malla', cssW / 2, cssH / 2);
      return;
    }

    // Checkerboard bg
    gctx.fillStyle = '#191919';
    gctx.fillRect(0, 0, cssW, cssH);

    const scale = Math.min(cssW / cs.source.width, cssH / cs.source.height);
    const dw = cs.source.width * scale;
    const dh = cs.source.height * scale;
    const ox = (cssW - dw) / 2;
    const oy = (cssH - dh) / 2;
    gctx.drawImage(cs.source, ox, oy, dw, dh);

    const m = getGridMetrics();
    if (!m || m.fw <= 0 || m.fh <= 0) return;

    gctx.save();
    gctx.strokeStyle = '#ffd15c';
    gctx.lineWidth = 2;
    gctx.fillStyle = 'rgba(255,209,92,.08)';
    for (let r = 0; r < m.rows; r++) {
      for (let c = 0; c < m.cols; c++) {
        const x = ox + (m.marginX + m.offsetX + c * (m.fw + m.gapX)) * scale;
        const y = oy + (m.marginY + m.offsetY + r * (m.fh + m.gapY)) * scale;
        const w = m.fw * scale;
        const h = m.fh * scale;
        gctx.fillRect(x, y, w, h);
        gctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
        gctx.fillStyle = 'rgba(0,0,0,.72)';
        gctx.fillRect(x + 3, y + 3, 22, 17);
        gctx.fillStyle = '#fff';
        gctx.font = '11px system-ui';
        gctx.textAlign = 'center';
        gctx.fillText(String(r * m.cols + c + 1), x + 14, y + 15);
        gctx.fillStyle = 'rgba(255,209,92,.08)';
      }
    }
    gctx.restore();
    gridCanvas.dataset.scale = scale;
    dispatchSettingsChange();
  }

  function nudgeGrid(dx, dy) {
    const ox = q('offsetX'), oy = q('offsetY');
    if (ox) ox.value = (parseFloat(ox.value) || 0) + dx;
    if (oy) oy.value = (parseFloat(oy.value) || 0) + dy;
    drawGridPreview();
    updateFramesSlider();
  }

  // ── Separar frames ─────────────────────────────────────────────────────────
  function splitFrames() {
    if (!cs.source) {
      const s = q('splitStatus'); if (s) s.textContent = 'Primero importa una imagen.'; return;
    }
    const m = getGridMetrics();
    if (!m || m.fw <= 0 || m.fh <= 0) {
      const s = q('splitStatus'); if (s) s.textContent = 'La cuadrícula no cabe en la imagen.'; return;
    }
    const { cols, rows, gapX, gapY, marginX, marginY, offsetX, offsetY, fw, fh } = m;
    snapshot();
    cs.frames = [];
    cs.multiSelected.clear();
    const trimMode = q('trim')?.value || 'off';
    const bgMode = q('bgMode')?.value || 'transparent';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const frame = document.createElement('canvas');
        frame.width = fw; frame.height = fh;
        const ctx = frame.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const sx = marginX + offsetX + c * (fw + gapX);
        const sy = marginY + offsetY + r * (fh + gapY);
        ctx.fillStyle = '#ff00ff';
        ctx.fillRect(0, 0, fw, fh);
        ctx.drawImage(cs.source, sx, sy, fw, fh, 0, 0, fw, fh);
        if (bgMode === 'transparent') makeTransparentMagenta(frame);
        const finalCanvas = trimCanvas(frame, trimMode);
        cs.frames.push({
          canvas: finalCanvas,
          flipped: false,
          sourceVariantId: cs.currentVariantId,
          sourceFrameIndex: r * cols + c
        });
      }
    }
    cs.selected = 0;
    const exportCols = q('exportCols');
    if (exportCols) exportCols.value = cols;
    const s = q('splitStatus');
    if (s) s.textContent = `${cs.frames.length} frames creados de ${fw}×${fh}px.`;
    renderFrames();
    drawPreview();
  }

  // ── Preview de animación ───────────────────────────────────────────────────
  function drawPreview() {
    const preview = q('previewCanvas');
    if (!preview) return;
    const pctx = preview.getContext('2d');
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, preview.width, preview.height);
    const frame = cs.frames[cs.selected];
    if (!frame) return;
    const zoom = parseFloat(q('zoom')?.value) || 3;
    const w = frame.canvas.width * zoom;
    const h = frame.canvas.height * zoom;
    preview.width = Math.max(128, w);
    preview.height = Math.max(128, h);
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, preview.width, preview.height);
    pctx.drawImage(frame.canvas, (preview.width - w) / 2, (preview.height - h) / 2, w, h);
  }

  // ── Timeline horizontal de frames ──────────────────────────────────────────
  function updateFramesSlider() {
    const box = q('frames');
    const slider = q('framesScroll');
    if (!box || !slider) return;
    const max = Math.max(0, Math.round(box.scrollWidth - box.clientWidth));
    slider.max = String(max);
    slider.value = String(Math.min(max, Math.round(box.scrollLeft)));
    slider.disabled = max <= 0;
  }

  function scrollFramesToSelected() {
    const box = q('frames');
    if (!box) return;
    const sel = box.querySelector('.cc-frame.selected');
    if (!sel) return;
    const left = sel.offsetLeft;
    const right = left + sel.offsetWidth;
    if (left < box.scrollLeft) box.scrollLeft = left - 8;
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth + 8;
    updateFramesSlider();
  }

  function renderFrames() {
    const box = q('frames');
    if (!box) return;
    box.innerHTML = '';
    cs.frames.forEach((f, i) => {
      const el = document.createElement('div');
      const isMulti = cs.multiSelected.has(i);
      el.className = 'cc-frame' + (i === cs.selected ? ' selected' : '') + (isMulti ? ' multi-sel' : '');
      el.draggable = true;
      el.dataset.index = i;

      const c = cloneCanvas(f.canvas);
      c.style.width = '100%';
      c.style.height = '66px';
      c.style.objectFit = 'contain';
      c.style.borderRadius = '6px';
      c.style.background = '#0a0b0c';

      const badge = document.createElement('div');
      badge.className = 'cc-badge';
      badge.textContent = f.flipped ? 'FLIP' : '';

      const num = document.createElement('div');
      num.className = 'cc-num';
      num.textContent = String(i + 1).padStart(2, '0');

      // Source info
      if (f.sourceVariantId) {
        const src = document.createElement('div');
        src.className = 'cc-src';
        src.textContent = `V·${String(f.sourceFrameIndex + 1).padStart(2, '0')}`;
        el.append(c, badge, num, src);
      } else {
        el.append(c, badge, num);
      }

      el.addEventListener('click', e => {
        if (e.shiftKey && cs.selected !== i) {
          // Shift-click: range selection
          const lo = Math.min(cs.selected, i), hi = Math.max(cs.selected, i);
          for (let j = lo; j <= hi; j++) cs.multiSelected.add(j);
        } else if (e.ctrlKey || e.metaKey) {
          if (cs.multiSelected.has(i)) cs.multiSelected.delete(i);
          else cs.multiSelected.add(i);
        } else {
          cs.multiSelected.clear();
        }
        cs.selected = i;
        renderFrames();
        drawPreview();
        updateAddButtons();
      });

      el.addEventListener('dragstart', e => { el.classList.add('cc-dragging'); e.dataTransfer.setData('text/plain', String(i)); });
      el.addEventListener('dragend', () => el.classList.remove('cc-dragging'));
      el.addEventListener('dragover', e => e.preventDefault());
      el.addEventListener('drop', e => {
        e.preventDefault();
        const from = +e.dataTransfer.getData('text/plain');
        if (from === i) return;
        snapshot();
        const [moved] = cs.frames.splice(from, 1);
        cs.frames.splice(i, 0, moved);
        cs.selected = i;
        cs.multiSelected.clear();
        renderFrames(); drawPreview();
      });
      addTouchReorder(el, i);
      box.appendChild(el);
    });
    requestAnimationFrame(() => { scrollFramesToSelected(); updateFramesSlider(); });
    updateAddButtons();
  }

  function addTouchReorder(el, index) {
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      _touchDrag = { from: index, startX: e.clientX, startY: e.clientY, active: false, el };
      el.setPointerCapture(e.pointerId);
      setTimeout(() => { if (_touchDrag && _touchDrag.el === el) { _touchDrag.active = true; el.classList.add('cc-dragging'); } }, 250);
    });
    el.addEventListener('pointermove', e => {
      if (!_touchDrag || !_touchDrag.active) return;
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cc-frame');
      if (!target) return;
      const to = +target.dataset.index;
      if (to === _touchDrag.from) return;
      snapshot();
      const [moved] = cs.frames.splice(_touchDrag.from, 1);
      cs.frames.splice(to, 0, moved);
      _touchDrag.from = to; cs.selected = to;
      cs.multiSelected.clear();
      renderFrames(); drawPreview();
    });
    el.addEventListener('pointerup', () => { if (_touchDrag?.el === el) el.classList.remove('cc-dragging'); _touchDrag = null; });
  }

  function updateAddButtons() {
    const selBtn = q('addSelectedBtn');
    const allBtn = q('addAllBtn');
    const multiCount = cs.multiSelected.size;
    if (selBtn) {
      const count = multiCount > 0 ? multiCount : (cs.frames.length > 0 ? 1 : 0);
      selBtn.textContent = multiCount > 1 ? `Añadir ${multiCount} seleccionados` : 'Añadir seleccionado';
      selBtn.disabled = cs.frames.length === 0;
    }
    if (allBtn) {
      allBtn.textContent = `Añadir todos (${cs.frames.length})`;
      allBtn.disabled = cs.frames.length === 0;
    }
  }

  // ── Acciones sobre frames ──────────────────────────────────────────────────
  function transformFlip() {
    const f = cs.frames[cs.selected]; if (!f) return;
    snapshot();
    const c = document.createElement('canvas');
    c.width = f.canvas.width; c.height = f.canvas.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(f.canvas, 0, 0);
    f.canvas = c; f.flipped = !f.flipped;
    renderFrames(); drawPreview();
  }

  function duplicate() {
    const f = cs.frames[cs.selected]; if (!f) return;
    snapshot();
    cs.frames.splice(cs.selected + 1, 0, {
      canvas: cloneCanvas(f.canvas),
      flipped: f.flipped,
      sourceVariantId: f.sourceVariantId,
      sourceFrameIndex: f.sourceFrameIndex
    });
    cs.selected++;
    cs.multiSelected.clear();
    renderFrames(); drawPreview();
  }

  function remove() {
    if (!cs.frames.length) return;
    snapshot();
    cs.frames.splice(cs.selected, 1);
    cs.selected = Math.max(0, Math.min(cs.selected, cs.frames.length - 1));
    cs.multiSelected.clear();
    renderFrames(); drawPreview();
  }

  function move(delta) {
    const i = cs.selected, j = i + delta;
    if (j < 0 || j >= cs.frames.length) return;
    snapshot();
    [cs.frames[i], cs.frames[j]] = [cs.frames[j], cs.frames[i]];
    cs.selected = j;
    cs.multiSelected.clear();
    renderFrames(); drawPreview();
  }

  function step(delta) {
    if (!cs.frames.length) return;
    cs.selected = (cs.selected + delta + cs.frames.length) % cs.frames.length;
    renderFrames(); drawPreview();
  }

  function togglePlay() {
    cs.playing = !cs.playing;
    const btn = q('playBtn');
    if (btn) btn.textContent = cs.playing ? '⏸' : '▶';
    clearInterval(cs.timer);
    if (cs.playing) {
      const fps = Math.max(1, parseFloat(q('fps')?.value) || 8);
      cs.timer = setInterval(() => step(1), 1000 / fps);
    }
  }

  // ── Exportación ────────────────────────────────────────────────────────────
  function getOutputFrameSize() {
    let w = 1, h = 1;
    cs.frames.forEach(f => { w = Math.max(w, f.canvas.width); h = Math.max(h, f.canvas.height); });
    return { w, h };
  }

  function paintBackground(ctx, w, h) {
    const mode = q('bgMode')?.value;
    if (mode === 'magenta') { ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, w, h); }
  }

  function buildSheet() {
    if (!cs.frames.length) return null;
    const cols = Math.max(1, parseInt(q('exportCols')?.value) || cs.frames.length);
    const rows = Math.ceil(cs.frames.length / cols);
    const pad = Math.max(0, parseInt(q('padding')?.value) || 0);
    const { w, h } = getOutputFrameSize();
    const c = document.createElement('canvas');
    c.width = cols * w + (cols - 1) * pad;
    c.height = rows * h + (rows - 1) * pad;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    paintBackground(ctx, c.width, c.height);
    cs.frames.forEach((f, i) => {
      const cellX = (i % cols) * (w + pad);
      const cellY = Math.floor(i / cols) * (h + pad);
      const x = cellX + (w - f.canvas.width) / 2;
      const y = cellY + (h - f.canvas.height);
      ctx.drawImage(f.canvas, Math.round(x), Math.round(y));
      const numEl = q('numberFrames');
      if (numEl && numEl.checked) {
        const label = String(i + 1);
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(cellX + 3, cellY + 3, Math.max(18, 9 + label.length * 9), 16);
        ctx.fillStyle = '#ffffff';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(label, cellX + 8, cellY + 5);
        ctx.restore();
      }
    });
    return c;
  }

  function downloadCanvas(canvas, name) {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  function exportSheet() {
    const c = buildSheet();
    const statusEl = q('exportStatus');
    if (!c) { if (statusEl) statusEl.textContent = 'No hay frames para exportar.'; return; }
    const name = cleanName(q('baseName')?.value) || 'spritesheet';
    downloadCanvas(c, `${name}.png`);
    if (statusEl) statusEl.textContent = `Exportado ${name}.png`;
  }

  function exportFrames() {
    const statusEl = q('exportStatus');
    if (!cs.frames.length) { if (statusEl) statusEl.textContent = 'No hay frames.'; return; }
    const name = cleanName(q('baseName')?.value) || 'frame';
    cs.frames.forEach((f, i) => {
      setTimeout(() => downloadCanvas(f.canvas, `${name}_${String(i + 1).padStart(2, '0')}.png`), i * 120);
    });
    if (statusEl) statusEl.textContent = 'Los frames se descargarán uno a uno.';
  }

  function exportJson() {
    if (!cs.frames.length) return;
    const name = cleanName(q('baseName')?.value) || 'animation';
    const { w, h } = getOutputFrameSize();
    const data = {
      name,
      fps: parseFloat(q('fps')?.value) || 8,
      frameCount: cs.frames.length,
      frameWidth: w,
      frameHeight: h,
      columns: parseInt(q('exportCols')?.value) || cs.frames.length,
      frames: cs.frames.map((f, i) => ({
        index: i,
        file: `${name}_${String(i + 1).padStart(2, '0')}.png`,
        width: f.canvas.width,
        height: f.canvas.height,
        flipped: f.flipped,
        sourceVariantId: f.sourceVariantId || null,
        sourceFrameIndex: f.sourceFrameIndex ?? null
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ── Añadir al timeline de Sprite Forge ─────────────────────────────────────
  function addSelectedToTimeline() {
    if (!_onAddToTimeline || !cs.frames.length) return;
    let toAdd;
    if (cs.multiSelected.size > 0) {
      toAdd = [...cs.multiSelected].sort((a, b) => a - b).map(i => cs.frames[i]);
    } else {
      toAdd = cs.frames[cs.selected] ? [cs.frames[cs.selected]] : [];
    }
    if (!toAdd.length) return;
    _onAddToTimeline(toAdd);
    if (typeof toast === 'function') toast(`${toAdd.length} frame${toAdd.length > 1 ? 's' : ''} añadido${toAdd.length > 1 ? 's' : ''} al timeline`);
    cs.multiSelected.clear();
    renderFrames();
  }

  function addAllToTimeline() {
    if (!_onAddToTimeline || !cs.frames.length) return;
    _onAddToTimeline([...cs.frames]);
    if (typeof toast === 'function') toast(`${cs.frames.length} frames añadidos al timeline`);
    cs.multiSelected.clear();
    renderFrames();
  }

  // ── Dispatch: notifica cambios de settings al exterior ─────────────────────
  function dispatchSettingsChange() {
    if (_container) {
      _container.dispatchEvent(new CustomEvent('cutter:settingsChange', {
        bubbles: true,
        detail: getSettings()
      }));
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  function resetAll() {
    clearInterval(cs.timer);
    Object.assign(cs, { source: null, frames: [], history: [], selected: 0, playing: false, timer: null, currentVariantId: null });
    cs.multiSelected.clear();
    const fields = ['cols','rows','gapX','gapY','marginX','marginY','offsetX','offsetY','sizeAdjustX','sizeAdjustY'];
    const defaults = [6,1,0,0,0,0,0,0,0,0];
    fields.forEach((id, i) => { const el = q(id); if (el) el.value = defaults[i]; });
    const playBtn = q('playBtn'); if (playBtn) playBtn.textContent = '▶';
    const undoBtn = q('undoBtn'); if (undoBtn) undoBtn.disabled = true;
    const fileStatus = q('fileStatus'); if (fileStatus) fileStatus.textContent = 'No hay ninguna imagen cargada.';
    const splitStatus = q('splitStatus'); if (splitStatus) splitStatus.textContent = '';
    renderFrames();
    drawGridPreview();
    updateFramesSlider();
  }

  // ── HTML del Cutter ─────────────────────────────────────────────────────────
  function getCutterHTML() {
    return `
<div class="cc-wrap">
  <div class="cc-card">
    <h3 class="cc-title">Importar spritesheet</h3>
    <div class="cc-row">
      <input data-cc="fileInput" type="file" accept="image/png,image/jpeg,image/webp" style="flex:1;min-width:0;background:#0e1012;border:1px solid var(--line);color:var(--text);border-radius:9px;padding:10px;">
      <button data-cc="pasteBtn" class="secondary-btn" style="flex:0 0 auto">Pegar</button>
    </div>
    <div data-cc="fileStatus" class="cc-status">No hay ninguna imagen cargada.</div>
  </div>

  <div class="cc-card">
    <h3 class="cc-title">Dividir en frames</h3>
    <div class="cc-grid-form">
      <label class="field"><span>Columnas</span><input data-cc="cols" type="number" min="1" value="6"></label>
      <label class="field"><span>Filas</span><input data-cc="rows" type="number" min="1" value="1"></label>
      <label class="field"><span>Sep. horizontal</span><input data-cc="gapX" type="number" min="0" value="0"></label>
      <label class="field"><span>Sep. vertical</span><input data-cc="gapY" type="number" min="0" value="0"></label>
      <label class="field"><span>Margen lateral</span><input data-cc="marginX" type="number" min="0" value="0"></label>
      <label class="field"><span>Margen vertical</span><input data-cc="marginY" type="number" min="0" value="0"></label>
      <label class="field"><span>Mover malla X</span><input data-cc="offsetX" type="number" step="1" value="0"></label>
      <label class="field"><span>Mover malla Y</span><input data-cc="offsetY" type="number" step="1" value="0"></label>
      <label class="field"><span>Ancho celda ±</span><input data-cc="sizeAdjustX" type="number" step="1" value="0"></label>
      <label class="field"><span>Alto celda ±</span><input data-cc="sizeAdjustY" type="number" step="1" value="0"></label>
      <label class="field"><span>Fondo al exportar</span>
        <select data-cc="bgMode">
          <option value="transparent">Transparente</option>
          <option value="keep">Original</option>
          <option value="magenta">Magenta</option>
        </select>
      </label>
      <label class="field"><span>Recorte interno</span>
        <select data-cc="trim">
          <option value="off">No recortar</option>
          <option value="transparent">Recortar transparencia</option>
          <option value="magenta">Recortar magenta</option>
        </select>
      </label>
    </div>
    <div class="cc-grid-preview-box">
      <canvas data-cc="gridCanvas" style="max-width:100%;max-height:360px;touch-action:none;cursor:grab;image-rendering:pixelated"></canvas>
    </div>
    <div class="cc-nudge-grid">
      <span></span>
      <button data-cc="gridUpBtn" class="secondary-btn">▲</button>
      <span></span>
      <button data-cc="gridLeftBtn" class="secondary-btn">◀</button>
      <button data-cc="gridResetBtn" class="secondary-btn">Centrar</button>
      <button data-cc="gridRightBtn" class="secondary-btn">▶</button>
      <span></span>
      <button data-cc="gridDownBtn" class="secondary-btn">▼</button>
      <span></span>
    </div>
    <p class="muted small" style="text-align:center;margin:8px 0">Arrastra la malla o usa las flechas. Ctrl+clic / Shift+clic para selección múltiple de frames.</p>
    <div class="cc-row" style="margin-top:10px">
      <button data-cc="splitBtn" class="primary-btn" style="flex:1">Separar frames</button>
      <button data-cc="undoBtn" class="secondary-btn" disabled style="flex:0 0 auto">Deshacer</button>
    </div>
    <div data-cc="splitStatus" class="cc-status"></div>
  </div>

  <div class="cc-card">
    <h3 class="cc-title">Previsualización</h3>
    <div class="cc-preview-wrap">
      <div class="cc-canvas-box">
        <canvas data-cc="previewCanvas" width="256" height="256" style="image-rendering:pixelated"></canvas>
      </div>
      <div>
        <div class="cc-grid-form" style="grid-template-columns:1fr 1fr">
          <label class="field"><span>FPS</span><input data-cc="fps" type="number" min="1" max="60" value="8"></label>
          <label class="field"><span>Zoom</span>
            <select data-cc="zoom">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="3" selected>3x</option>
              <option value="4">4x</option>
              <option value="6">6x</option>
            </select>
          </label>
        </div>
        <div class="cc-controls">
          <button data-cc="prevBtn" class="secondary-btn">◀</button>
          <button data-cc="playBtn" class="primary-btn">▶</button>
          <button data-cc="nextBtn" class="secondary-btn">▶|</button>
          <button data-cc="flipBtn" class="secondary-btn">Flip</button>
          <button data-cc="duplicateBtn" class="secondary-btn">Dup.</button>
          <button data-cc="deleteBtn" class="danger-btn">Borrar</button>
          <button data-cc="leftBtn" class="secondary-btn">← Mover</button>
          <button data-cc="rightBtn" class="secondary-btn">Mover →</button>
        </div>
        <div style="margin-top:10px;display:grid;gap:6px">
          <button data-cc="addSelectedBtn" class="primary-btn" disabled>Añadir seleccionado</button>
          <button data-cc="addAllBtn" class="secondary-btn" disabled>Añadir todos (0)</button>
        </div>
      </div>
    </div>
  </div>

  <div class="cc-card">
    <h3 class="cc-title">Frames separados</h3>
    <div data-cc="frames" class="cc-frames"></div>
    <div class="cc-timeline-controls">
      <label class="field" style="margin-top:8px">
        <span>Desplazar vista</span>
        <input data-cc="framesScroll" type="range" min="0" max="0" value="0" step="1">
      </label>
    </div>
    <p class="muted small">Toca para seleccionar · Ctrl+clic multi-selección · Shift+clic rango · Arrastra para reordenar</p>
  </div>

  <div class="cc-card">
    <h3 class="cc-title">Exportar</h3>
    <div class="cc-grid-form">
      <label class="field" style="grid-column:1/-1"><span>Nombre de archivo</span><input data-cc="baseName" type="text" value="animacion" placeholder="animacion"></label>
      <label class="field"><span>Columnas de salida</span><input data-cc="exportCols" type="number" min="1" value="6"></label>
      <label class="field"><span>Separación</span><input data-cc="padding" type="number" min="0" value="0"></label>
      <label class="field" style="grid-column:1/-1">
        <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--line);border-radius:9px;background:#0e1012">
          <input data-cc="numberFrames" type="checkbox" checked style="width:auto">
          <span>Numerar frames en la spritesheet exportada</span>
        </div>
      </label>
    </div>
    <div class="cc-row" style="margin-top:10px">
      <button data-cc="exportSheetBtn" class="primary-btn" style="flex:1">Exportar PNG</button>
      <button data-cc="exportFramesBtn" class="secondary-btn" style="flex:1">Frames PNG</button>
      <button data-cc="exportJsonBtn" class="secondary-btn" style="flex:0 0 auto">JSON</button>
    </div>
    <div data-cc="exportStatus" class="cc-status"></div>
  </div>
</div>`;
  }

  // ── Init — inyectar HTML y vincular eventos ─────────────────────────────────
  function init(container, onAddToTimeline) {
    _container = container;
    _onAddToTimeline = onAddToTimeline || null;
    container.innerHTML = getCutterHTML();

    // File input
    q('fileInput').addEventListener('change', e => loadImageFile(e.target.files[0]));
    q('pasteBtn').addEventListener('click', async () => {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find(t => t.startsWith('image/'));
          if (type) {
            const blob = await item.getType(type);
            loadImageFile(new File([blob], 'imagen_pegada.png', { type }));
            return;
          }
        }
        q('fileStatus').textContent = 'El portapapeles no contiene una imagen.';
      } catch { q('fileStatus').textContent = 'Tu navegador no permite pegar imágenes aquí.'; }
    });

    // Grid controls
    ['cols','rows','gapX','gapY','marginX','marginY','offsetX','offsetY','sizeAdjustX','sizeAdjustY'].forEach(id => {
      q(id).addEventListener('input', () => { drawGridPreview(); updateFramesSlider(); });
    });
    ['bgMode','trim'].forEach(id => { q(id).addEventListener('change', drawGridPreview); });

    q('gridUpBtn').addEventListener('click', () => nudgeGrid(0, -1));
    q('gridDownBtn').addEventListener('click', () => nudgeGrid(0, 1));
    q('gridLeftBtn').addEventListener('click', () => nudgeGrid(-1, 0));
    q('gridRightBtn').addEventListener('click', () => nudgeGrid(1, 0));
    q('gridResetBtn').addEventListener('click', () => {
      q('offsetX').value = 0; q('offsetY').value = 0;
      drawGridPreview(); updateFramesSlider();
    });

    // Grid drag
    const gridCanvas = q('gridCanvas');
    gridCanvas.addEventListener('pointerdown', e => {
      if (!cs.source) return;
      gridCanvas.setPointerCapture(e.pointerId);
      gridCanvas.style.cursor = 'grabbing';
      _gridDrag = {
        x: e.clientX, y: e.clientY,
        ox: parseFloat(q('offsetX').value) || 0,
        oy: parseFloat(q('offsetY').value) || 0
      };
    });
    gridCanvas.addEventListener('pointermove', e => {
      if (!_gridDrag) return;
      const scale = parseFloat(gridCanvas.dataset.scale) || 1;
      q('offsetX').value = Math.round(_gridDrag.ox + (e.clientX - _gridDrag.x) / scale);
      q('offsetY').value = Math.round(_gridDrag.oy + (e.clientY - _gridDrag.y) / scale);
      drawGridPreview(); updateFramesSlider();
    });
    const endGridDrag = () => { _gridDrag = null; gridCanvas.style.cursor = 'grab'; };
    gridCanvas.addEventListener('pointerup', endGridDrag);
    gridCanvas.addEventListener('pointercancel', endGridDrag);

    // Frames scroll slider
    q('framesScroll').addEventListener('input', e => { q('frames').scrollLeft = +e.target.value || 0; });
    q('frames').addEventListener('scroll', updateFramesSlider);

    // Split / undo
    q('splitBtn').addEventListener('click', splitFrames);
    q('undoBtn').addEventListener('click', undo);

    // Preview controls
    q('flipBtn').addEventListener('click', transformFlip);
    q('duplicateBtn').addEventListener('click', duplicate);
    q('deleteBtn').addEventListener('click', remove);
    q('leftBtn').addEventListener('click', () => move(-1));
    q('rightBtn').addEventListener('click', () => move(1));
    q('prevBtn').addEventListener('click', () => step(-1));
    q('nextBtn').addEventListener('click', () => step(1));
    q('playBtn').addEventListener('click', togglePlay);
    q('fps').addEventListener('change', () => { if (cs.playing) { togglePlay(); togglePlay(); } });
    q('zoom').addEventListener('change', drawPreview);

    // Add to timeline
    q('addSelectedBtn').addEventListener('click', addSelectedToTimeline);
    q('addAllBtn').addEventListener('click', addAllToTimeline);

    // Export
    q('exportSheetBtn').addEventListener('click', exportSheet);
    q('exportFramesBtn').addEventListener('click', exportFrames);
    q('exportJsonBtn').addEventListener('click', exportJson);

    // Resize
    const ro = new ResizeObserver(() => { drawGridPreview(); updateFramesSlider(); });
    ro.observe(container);

    drawGridPreview();
    updateFramesSlider();
  }

  // ── API pública ─────────────────────────────────────────────────────────────
  function getSettings() {
    if (!_container) return {};
    const v = id => { const el = q(id); return el ? el.value : undefined; };
    return {
      cols: v('cols'), rows: v('rows'),
      gapX: v('gapX'), gapY: v('gapY'),
      marginX: v('marginX'), marginY: v('marginY'),
      offsetX: v('offsetX'), offsetY: v('offsetY'),
      sizeAdjustX: v('sizeAdjustX'), sizeAdjustY: v('sizeAdjustY'),
      bgMode: v('bgMode'), trim: v('trim')
    };
  }

  function getFrameCount() { return cs.frames.length; }
  function getCurrentVariantId() { return cs.currentVariantId; }

  function setOnAddToTimeline(cb) { _onAddToTimeline = cb; }

  return {
    init,
    loadUrl: loadImageFromUrl,
    getSettings,
    getFrameCount,
    getCurrentVariantId,
    setOnAddToTimeline,
    reset: resetAll
  };
})();
