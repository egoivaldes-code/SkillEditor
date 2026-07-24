'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// app-sheets.js — Generación de variantes de spritesheet completa
// Galería de variantes, progreso, Storage (sheets/), integración con el Cutter
// ─────────────────────────────────────────────────────────────────────────────

// ── Fábrica de variante ────────────────────────────────────────────────────
function createVariant(animId, options = {}) {
  return {
    id: uid(),
    animationId: animId,
    name: options.name || 'Variante',
    seed: options.seed || randomSeed(),
    animationType: options.animationType || 'Walk',
    direction: options.direction || 'E',
    targetFrameCount: options.targetFrameCount || 6,
    width: options.width || 512,
    height: options.height || 512,
    prompt: options.prompt || '',
    imagePath: '',
    status: 'empty',   // empty | generating | ready | error
    approved: false,
    createdAt: Date.now(),
    cutterSettings: null  // guardado cuando el usuario abre esta variante en el Cutter
  };
}

// ── normalizeAnimation — añade variants:[] si falta ────────────────────────
// (llamado desde normalizeAnimation de app-cloud.js, que ya llama ésta)
function ensureVariants(anim) {
  if (!Array.isArray(anim.variants)) anim.variants = [];
}

// ── Storage helpers (sheets/) ──────────────────────────────────────────────
async function uploadVariantSheet(project, variant, blob) {
  if (!state.online || !state.currentUser) throw new Error('Sin sesión activa');
  const ext = blob.type?.includes('jpeg') ? 'jpg' : 'png';
  const path = `${project.ownerId}/${project.id}/sheets/${variant.animationId}/${variant.id}.${ext}`;
  const { error } = await sb.storage.from(CONFIG.assetsBucket).upload(path, blob, {
    contentType: blob.type || 'image/png', upsert: true, cacheControl: '3600'
  });
  if (error) throw error;
  variant.imagePath = path;
  return path;
}

async function deleteVariantSheet(variant) {
  if (!variant?.imagePath || !state.online) return;
  const { error } = await sb.storage.from(CONFIG.assetsBucket).remove([variant.imagePath]);
  if (error) console.warn('No se pudo borrar la hoja remota:', error);
  variant.imagePath = '';
}

// ── Construcción de prompt para spritesheet ────────────────────────────────
function buildSpritesheetPrompt(project, anim, variant) {
  const animLabels = {
    Idle: 'ciclo de idle', Walk: 'ciclo de walk', Attack: 'ataque',
    Cast: 'lanzamiento de hechizo', Hurt: 'recibir daño', Death: 'muerte',
    Activate: 'activación', Custom: 'animación'
  };
  const animLabel = animLabels[variant.animationType] || 'animación';
  const cols = variant.targetFrameCount;
  const loopTypes = ['Idle', 'Walk'];
  const isLoop = loopTypes.includes(variant.animationType);
  const loopHint = isLoop
    ? ` El último frame debe conectar visualmente con el primero para formar un loop perfecto.`
    : '';

  const base = project.basePrompt || '';
  return [
    `Spritesheet de pixel art con exactamente ${cols} frames en una sola fila (${cols} columnas, 1 fila).`,
    `Personaje de RPG con ${animLabel}, vista top-down 3/4, mirando al Este (derecha).`,
    `Fondo magenta uniforme #FF00FF en todas las celdas.`,
    `Frames claramente separados, mismo personaje, misma escala, misma perspectiva en todos los frames.`,
    `Sin texto, sin interfaz, sin suelo, sin sombras sobre el fondo.${loopHint}`,
    base
  ].filter(Boolean).join(' ').trim();
}

// ── Llamada a la Edge Function (mode: spritesheet) ─────────────────────────
async function generateSpritesheetVariant(project, anim, variant, { referenceUrls, masterUrl }) {
  const session = await sb.auth.getSession();
  const token = session?.data?.session?.access_token;
  if (!token) throw new Error('Sin token de sesión');

  const prompt = buildSpritesheetPrompt(project, anim, variant);

  const payload = {
    mode: 'spritesheet',
    projectId: project.id,
    animationId: anim.id,
    animationType: variant.animationType,
    direction: variant.direction,
    targetFrameCount: variant.targetFrameCount,
    width: variant.width,
    height: variant.height,
    seed: variant.seed,
    prompt,
    negativePrompt: project.negativePrompt || '',
    referenceUrls: masterUrl ? [masterUrl, ...referenceUrls.filter(u => u !== masterUrl)].slice(0, 4) : referenceUrls.slice(0, 4)
  };

  const fnUrl = `${CONFIG.supabaseUrl}/functions/v1/${CONFIG.generationFunction}`;
  const response = await fetch(fnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (!data.imageBase64) throw new Error('La función no devolvió imagen');

  // Convertir base64 a Blob
  const bin = atob(data.imageBase64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: data.mimeType || 'image/png' });
  return { blob, seed: data.seed ?? variant.seed };
}

// ── Generación demo (modo sin cuota) ──────────────────────────────────────
function generateDemoSpritesheet(variant) {
  const cols = variant.targetFrameCount || 6;
  const fw = variant.width || 512;
  const fh = variant.height || 512;
  const canvas = document.createElement('canvas');
  canvas.width = fw * cols; canvas.height = fh;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < cols; i++) {
    const hue = (i * 360 / cols) | 0;
    ctx.fillStyle = `hsl(${hue},70%,55%)`;
    ctx.fillRect(fw * i + 20, 20, fw - 40, fh - 40);
    ctx.fillStyle = '#111';
    ctx.font = `bold ${Math.min(fw / 4, 40)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`F${i + 1}`, fw * i + fw / 2, fh / 2);
  }
  return new Promise(resolve => canvas.toBlob(blob => resolve({ blob, seed: variant.seed }), 'image/png'));
}

// ── Estado de generación en curso ─────────────────────────────────────────
let _generationCancelled = false;

// ── Lanzar batch de variantes ─────────────────────────────────────────────
async function startVariantGeneration(animId, options) {
  const project = state.currentProject;
  const anim = project?.animations?.find(a => a.id === animId);
  if (!project || !anim) return;
  if (!canManageProject(project)) return toast('No puedes modificar este proyecto');

  const { animationType, direction, targetFrameCount, variantCount, width, height } = options;
  _generationCancelled = false;

  // Aseguramos variants[]
  if (!Array.isArray(anim.variants)) anim.variants = [];

  // Preparar proyecto y obtener URLs de referencia
  let refData;
  try {
    updateSheetProgress({ phase: 'preparing', current: 0, total: variantCount });
    refData = await prepareGeneration();
  } catch (err) {
    toast(`Error al preparar: ${err.message}`);
    hideSheetProgress();
    return;
  }

  for (let i = 0; i < variantCount; i++) {
    if (_generationCancelled) {
      toast('Generación cancelada');
      break;
    }

    const variant = createVariant(animId, {
      name: `${animationType} ${direction} #${anim.variants.length + 1}`,
      seed: randomSeed(),
      animationType, direction, targetFrameCount, width, height
    });
    variant.status = 'generating';
    anim.variants.push(variant);
    updateSheetProgress({ phase: 'generating', current: i + 1, total: variantCount, variantId: variant.id });
    renderEditor();

    try {
      let result;
      if (state.settings?.demoMode) {
        result = await generateDemoSpritesheet(variant);
      } else {
        result = await generateSpritesheetVariant(project, anim, variant, refData);
      }

      variant.seed = result.seed;
      variant.prompt = buildSpritesheetPrompt(project, anim, variant);

      // Subir al storage
      updateSheetProgress({ phase: 'uploading', current: i + 1, total: variantCount });
      await uploadVariantSheet(project, variant, result.blob);
      variant.status = 'ready';

    } catch (err) {
      variant.status = 'error';
      variant.errorMessage = err.message;
      toast(`Variante ${i + 1}: ${translateGenerationError('', err)}`);
    }

    scheduleSave();
    renderEditor();
  }

  hideSheetProgress();
  toast(_generationCancelled ? 'Generación cancelada' : 'Variantes generadas');
}

// ── Generación de referencia única ─────────────────────────────────────────
async function generateMasterReference() {
  const project = state.currentProject;
  if (!project) return;
  if (!canManageProject(project)) return toast('No puedes modificar este proyecto');

  toast('Generando referencia…');

  let refData;
  try {
    refData = await prepareGeneration();
  } catch (err) {
    return toast(`Error al preparar: ${err.message}`);
  }

  const session = await sb.auth.getSession();
  const token = session?.data?.session?.access_token;

  const prompt = [
    'Pixel art de referencia. Un único personaje de RPG mirando al Este (derecha).',
    'Vista top-down 3/4, cuerpo completo, centrado, misma escala que los sprites.',
    'Fondo magenta #FF00FF. Sin texto, sin interfaz, sin suelo.',
    project.basePrompt || ''
  ].join(' ');

  const payload = {
    mode: 'reference',
    width: 512, height: 512,
    seed: randomSeed(),
    prompt,
    negativePrompt: project.negativePrompt || '',
    referenceUrls: refData.referenceUrls
  };

  try {
    const fnUrl = `${CONFIG.supabaseUrl}/functions/v1/${CONFIG.generationFunction}`;
    const response = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.imageBase64) throw new Error(data.error || 'Sin imagen');

    const bin = atob(data.imageBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: data.mimeType || 'image/png' });

    // Añadir como referencia del proyecto
    const refBlob = await resizeImageBlob(blob, 480, 480);
    const ref = { id: uid(), name: 'referencia_generada.png', blob: refBlob, imagePath: '', status: 'ready' };
    project.references.push(ref);
    scheduleSave();
    toast('Referencia generada');
    state.currentStep = 'base';
    renderEditor();
  } catch (err) {
    toast(`Error al generar referencia: ${err.message}`);
  }
}

// ── Progreso de generación ─────────────────────────────────────────────────
function updateSheetProgress({ phase, current, total, variantId }) {
  state.sheetProgress = { phase, current, total, variantId, active: true };
}

function hideSheetProgress() {
  state.sheetProgress = { active: false };
}

// ── Abrir variante en el Cutter ───────────────────────────────────────────
function openVariantInCutter(variant) {
  if (!variant.imagePath) return toast('La variante no tiene imagen aún');
  const url = publicAssetUrl(variant.imagePath);
  if (!url) return toast('No se pudo obtener la URL de la imagen');

  // Guardar settings actuales de la variante que estaba abierta si corresponde
  if (window.CutterModule) {
    const prevId = window.CutterModule.getCurrentVariantId();
    if (prevId) {
      const prevVariant = findVariantById(prevId);
      if (prevVariant) {
        prevVariant.cutterSettings = window.CutterModule.getSettings();
        scheduleSave();
      }
    }
  }

  state.currentStep = 'cutter';
  state.pendingCutterVariant = { variant, url };
  renderEditor();
}

// ── Regenerar variante ─────────────────────────────────────────────────────
async function regenerateVariant(variant, newSeed) {
  const project = state.currentProject;
  const anim = project?.animations?.find(a => a.id === variant.animationId);
  if (!project || !anim) return;
  if (!canManageProject(project)) return toast('No puedes modificar este proyecto');

  variant.status = 'generating';
  if (newSeed) variant.seed = randomSeed();
  renderEditor();

  let refData;
  try {
    refData = await prepareGeneration();
  } catch (err) {
    variant.status = 'error';
    renderEditor();
    return toast(`Error al preparar: ${err.message}`);
  }

  try {
    let result;
    if (state.settings?.demoMode) {
      result = await generateDemoSpritesheet(variant);
    } else {
      result = await generateSpritesheetVariant(project, anim, variant, refData);
    }
    variant.seed = result.seed;
    variant.prompt = buildSpritesheetPrompt(project, anim, variant);

    // Borrar sheet anterior si existe
    if (variant.imagePath) await deleteVariantSheet(variant);

    await uploadVariantSheet(project, variant, result.blob);
    variant.status = 'ready';
    toast('Variante regenerada');
  } catch (err) {
    variant.status = 'error';
    variant.errorMessage = err.message;
    toast(`Error: ${translateGenerationError('', err)}`);
  }

  scheduleSave();
  renderEditor();
}

// ── Aprobar / desaprobar variante ─────────────────────────────────────────
function toggleVariantApproval(variant) {
  variant.approved = !variant.approved;
  scheduleSave();
  renderEditor();
}

// ── Eliminar variante ──────────────────────────────────────────────────────
async function deleteVariant(variant) {
  const project = state.currentProject;
  const anim = project?.animations?.find(a => a.id === variant.animationId);
  if (!anim) return;
  await deleteVariantSheet(variant);
  anim.variants = anim.variants.filter(v => v.id !== variant.id);
  scheduleSave();
  renderEditor();
}

// ── Helpers ────────────────────────────────────────────────────────────────
function findVariantById(id) {
  const project = state.currentProject;
  if (!project) return null;
  for (const anim of project.animations || []) {
    for (const v of anim.variants || []) {
      if (v.id === id) return v;
    }
  }
  return null;
}

// ── Render: pantalla "Generar" (tab generate) ─────────────────────────────
function renderGenerateStep() {
  const p = state.currentProject;
  const anim = getActiveAnimation();
  if (!Array.isArray(anim.variants)) anim.variants = [];

  // Progreso activo
  const prog = state.sheetProgress || {};
  const progressHtml = prog.active ? `
    <div class="batch-progress-banner">
      <div class="batch-progress-info">
        <span>${prog.phase === 'preparing' ? 'Preparando referencias…' :
               prog.phase === 'uploading' ? 'Guardando en Storage…' :
               `Generando variante ${prog.current} de ${prog.total}…`}</span>
        <button id="cancelGenBtn" class="danger-btn" style="min-height:34px;font-size:.8rem">Cancelar</button>
      </div>
      <div class="batch-progress-track">
        <div class="batch-progress-fill" style="width:${prog.total ? (prog.current / prog.total * 100) : 0}%"></div>
      </div>
    </div>` : '';

  // Galería de variantes
  const variantCards = (anim.variants || []).map(v => variantCardHtml(v)).join('');

  // Animaciones del proyecto (para selección)
  const animTabs = p.animations.map(a => `
    <button class="${a.id === anim.id ? 'active' : ''}" data-select-anim="${a.id}">${escapeHtml(a.name)}</button>
  `).join('');

  els.main.innerHTML = `
    <section class="section">
      ${progressHtml}

      <!-- Selección de animación -->
      <div class="card">
        <div class="section-head">
          <h3 style="margin:0">Animación activa</h3>
          <button id="addAnimSheetBtn" class="mini-btn">＋</button>
        </div>
        <div class="segmented" style="margin-top:12px">${animTabs}</div>
      </div>

      <!-- Configuración rápida + generación -->
      <div class="card">
        <h3>Generar variantes completas</h3>
        <div class="field-grid">
          <label class="field"><span>Tipo de animación</span>
            <select id="shAnimType">
              ${['Idle','Walk','Attack','Cast','Hurt','Death','Activate','Custom'].map(v => `<option ${anim.type===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
          <label class="field"><span>Dirección</span>
            <select id="shDirection">
              <option value="E" ${anim.directions[0]?.key==='E'?'selected':''}>Este (Derecha)</option>
              <option value="S">Sur (Abajo)</option>
              <option value="N">Norte (Arriba)</option>
              <option value="W">Oeste (Izquierda)</option>
            </select>
          </label>
          <label class="field"><span>Frames aprox.</span>
            <select id="shFrameCount">
              <option value="4">4 frames</option>
              <option value="6" selected>6 frames</option>
              <option value="8">8 frames</option>
            </select>
          </label>
          <label class="field"><span>Variantes a generar</span>
            <select id="shVariantCount">
              <option value="1">1 variante</option>
              <option value="2">2 variantes</option>
              <option value="4" selected>4 variantes</option>
              <option value="6">6 variantes</option>
              <option value="8">8 variantes</option>
            </select>
          </label>
          <label class="field"><span>Tamaño de spritesheet</span>
            <select id="shSize">
              <option value="512">512px por frame</option>
              <option value="768">768px por frame</option>
            </select>
          </label>
        </div>
        <button id="generateSheetsBtn" class="primary-btn full" style="margin-top:14px" ${prog.active ? 'disabled' : ''}>
          ◈ Generar variantes
        </button>
        <button id="genReferenceBtn" class="secondary-btn full" style="margin-top:8px" ${prog.active ? 'disabled' : ''}>
          ★ Generar referencia (imagen única)
        </button>
      </div>

      <!-- Configuración avanzada de la animación -->
      <details class="card" style="padding:14px">
        <summary style="cursor:pointer;font-weight:700;font-size:.9rem;color:var(--muted)">Configuración de la animación ▸</summary>
        <div class="field-grid" style="margin-top:12px">
          <label class="field"><span>Nombre</span><input id="shAnimName" value="${escapeAttr(anim.name)}"></label>
          <label class="field"><span>Tamaño de frame</span>
            <select id="shFrameSize">
              <option value="256" ${anim.width===256?'selected':''}>256×256</option>
              <option value="512" ${anim.width===512?'selected':''}>512×512</option>
              <option value="1024" ${anim.width===1024?'selected':''}>1024×1024</option>
            </select>
          </label>
          <label class="field"><span>Frames iniciales</span><input id="shInitFrames" type="number" min="1" max="24" value="${anim.initialFrameCount}"></label>
          <label class="field"><span>Direcciones</span>
            <div class="segmented">
              ${[2,4,8].map(n => `<button data-dir-count="${n}" class="${anim.directionCount===n?'active':''}">${n}</button>`).join('')}
            </div>
          </label>
        </div>
        <div class="inline-actions" style="margin-top:12px">
          <button id="shDeleteAnimBtn" class="danger-btn">Eliminar animación</button>
          <button id="shGoFramesBtn" class="secondary-btn">Modo frame a frame →</button>
        </div>
      </details>

      <!-- Modo experimental frame a frame -->
      <details class="card" style="padding:14px">
        <summary style="cursor:pointer;font-weight:700;font-size:.9rem;color:var(--muted)">⚗ Generación frame a frame (Experimental) ▸</summary>
        <div class="warning-note" style="margin-top:10px">
          ⚠ Este modo realiza una llamada por frame, puede consumir más cuota y produce más inconsistencias entre frames. Usa la generación de spritesheets completas cuando sea posible.
        </div>
        <button id="shGoOldFramesBtn" class="secondary-btn full" style="margin-top:10px">Abrir editor frame a frame</button>
      </details>

      <!-- Galería de variantes -->
      <div class="section-head">
        <h3 style="margin:0">Variantes generadas</h3>
        <span class="chip">${anim.variants.length}</span>
      </div>
      ${anim.variants.length ? `<div class="variants-grid">${variantCards}</div>` : `<div class="empty-state">Aún no hay variantes. Pulsa «Generar variantes» para crear spritesheets completas.</div>`}
    </section>`;

  // ── Bind events ────────────────────────────────────────────────────────
  document.getElementById('cancelGenBtn')?.addEventListener('click', () => { _generationCancelled = true; });

  document.getElementById('generateSheetsBtn')?.addEventListener('click', () => {
    const animType = document.getElementById('shAnimType')?.value || 'Walk';
    const direction = document.getElementById('shDirection')?.value || 'E';
    const targetFrameCount = parseInt(document.getElementById('shFrameCount')?.value) || 6;
    const variantCount = parseInt(document.getElementById('shVariantCount')?.value) || 4;
    const shSize = parseInt(document.getElementById('shSize')?.value) || 512;
    // Calcular width real (frame_size * frame_count para imagen horizontal)
    const frameW = shSize;
    const width = frameW * targetFrameCount;
    const height = frameW;
    startVariantGeneration(anim.id, { animationType: animType, direction, targetFrameCount, variantCount, width, height });
  });

  document.getElementById('genReferenceBtn')?.addEventListener('click', generateMasterReference);

  document.getElementById('addAnimSheetBtn')?.addEventListener('click', () => {
    const a = createAnimation('Idle', 2, 6);
    p.animations.push(a); p.activeAnimationId = a.id;
    state.selectedDirection = a.directions[0].id;
    scheduleSave(); renderEditor();
  });

  els.main.querySelectorAll('[data-select-anim]').forEach(btn => btn.addEventListener('click', () => {
    p.activeAnimationId = btn.dataset.selectAnim;
    state.selectedDirection = getActiveAnimation().directions[0]?.id;
    scheduleSave(); renderEditor();
  }));

  // Config avanzada
  document.getElementById('shAnimName')?.addEventListener('input', e => { anim.name = e.target.value || anim.type; scheduleSave(); });
  document.getElementById('shFrameSize')?.addEventListener('change', e => { anim.width = anim.height = Number(e.target.value); scheduleSave(); });
  document.getElementById('shInitFrames')?.addEventListener('change', e => { anim.initialFrameCount = Math.max(1, parseInt(e.target.value) || 6); scheduleSave(); });

  els.main.querySelectorAll('[data-dir-count]').forEach(btn => btn.addEventListener('click', () => {
    const count = Number(btn.dataset.dirCount);
    if (anim.directionCount === count) return;
    anim.directionCount = count;
    syncAnimationDirections(anim);
    scheduleSave(); renderEditor();
  }));

  document.getElementById('shDeleteAnimBtn')?.addEventListener('click', () => deleteActiveAnimation());
  document.getElementById('shGoFramesBtn')?.addEventListener('click', () => { state.currentStep = 'frames'; renderEditor(); });
  document.getElementById('shGoOldFramesBtn')?.addEventListener('click', () => { state.currentStep = 'frames'; renderEditor(); });

  // Botones de variante
  els.main.querySelectorAll('[data-open-cutter]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.openCutter);
    if (v) openVariantInCutter(v);
  }));
  els.main.querySelectorAll('[data-approve-variant]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.approveVariant);
    if (v) toggleVariantApproval(v);
  }));
  els.main.querySelectorAll('[data-regen-same]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.regenSame);
    if (v) regenerateVariant(v, false);
  }));
  els.main.querySelectorAll('[data-regen-new]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.regenNew);
    if (v) regenerateVariant(v, true);
  }));
  els.main.querySelectorAll('[data-download-variant]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.downloadVariant);
    if (!v?.imagePath) return toast('Sin imagen para descargar');
    const url = publicAssetUrl(v.imagePath);
    const a = document.createElement('a'); a.href = url; a.download = `${v.name}.png`; a.target = '_blank'; a.click();
  }));
  els.main.querySelectorAll('[data-delete-variant]').forEach(btn => btn.addEventListener('click', () => {
    const v = findVariantById(btn.dataset.deleteVariant);
    if (!v) return;
    els.confirmTitle.textContent = 'Eliminar variante';
    els.confirmText.textContent = `Se eliminará "${v.name}" y su imagen de Storage.`;
    els.confirmOkBtn.onclick = () => deleteVariant(v);
    els.confirmDialog.showModal();
  }));
}

function variantCardHtml(v) {
  const imgSrc = v.imagePath ? escapeAttr(publicAssetUrl(v.imagePath)) : '';
  const statusIcon = { empty: '○', generating: '⟳', ready: '✓', error: '✗' }[v.status] || '?';
  const statusColor = { ready: 'var(--success)', error: 'var(--danger)', generating: 'var(--accent)' }[v.status] || 'var(--muted)';
  const isReady = v.status === 'ready' && imgSrc;
  const approveLabel = v.approved ? '✓ Aprobada' : 'Aprobar';
  const approveStyle = v.approved ? 'color:var(--success);border-color:var(--success)' : '';

  return `
  <div class="variant-card ${v.approved ? 'approved' : ''} ${v.status === 'generating' ? 'loading' : ''}">
    <div class="variant-thumb">
      ${isReady
        ? `<img src="${imgSrc}" alt="${escapeHtml(v.name)}">`
        : `<div class="variant-placeholder" style="color:${statusColor}">${statusIcon}</div>`}
    </div>
    <div class="variant-meta">
      <strong>${escapeHtml(v.name)}</strong>
      <div class="muted small">${v.animationType} · ${v.direction} · ${v.targetFrameCount}f</div>
      <div class="muted small">seed: ${v.seed}</div>
      ${v.errorMessage ? `<div style="color:var(--danger);font-size:.75rem;margin-top:3px">${escapeHtml(v.errorMessage)}</div>` : ''}
    </div>
    <div class="variant-actions">
      ${isReady ? `<button class="primary-btn" data-open-cutter="${v.id}" style="grid-column:1/-1">✥ Abrir en Cutter</button>` : ''}
      ${isReady ? `<button class="mini-btn" data-approve-variant="${v.id}" style="${approveStyle}">${approveLabel}</button>` : ''}
      ${isReady ? `<button class="mini-btn" data-regen-same="${v.id}">↺ Mismo seed</button>` : ''}
      <button class="mini-btn" data-regen-new="${v.id}">↺ Nuevo seed</button>
      ${isReady ? `<button class="mini-btn" data-download-variant="${v.id}">⬇</button>` : ''}
      <button class="mini-btn danger-btn" data-delete-variant="${v.id}">🗑</button>
    </div>
  </div>`;
}

// ── Render: pantalla "Editor" (tab cutter) ────────────────────────────────
function renderCutterStep() {
  const anim = getActiveAnimation();

  els.main.innerHTML = `
    <section class="section">
      <div class="card" style="padding:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <strong style="font-size:.9rem">CRIPTA Sprite Cutter</strong>
          <span class="chip">Timeline: <strong id="timelineCount">${countTimelineFrames()}</strong> frames</span>
          <button id="goToTimelineBtn" class="secondary-btn" style="min-height:34px;font-size:.8rem;margin-left:auto">Ver timeline →</button>
        </div>
      </div>
      <div id="cutterContainer"></div>
    </section>`;

  document.getElementById('goToTimelineBtn')?.addEventListener('click', () => {
    // Guardar settings al salir
    if (window.CutterModule) {
      const vid = window.CutterModule.getCurrentVariantId();
      if (vid) {
        const variant = findVariantById(vid);
        if (variant) { variant.cutterSettings = window.CutterModule.getSettings(); scheduleSave(); }
      }
    }
    state.currentStep = 'frames'; renderEditor();
  });

  const cutterContainer = document.getElementById('cutterContainer');
  if (!cutterContainer || !window.CutterModule) return;

  // Callback: cuando se añaden frames al timeline
  window.CutterModule.init(cutterContainer, (frames) => {
    addCutterFramesToTimeline(anim, frames);
  });

  // Guardar cutterSettings al detectar cambios
  cutterContainer.addEventListener('cutter:settingsChange', () => {
    const vid = window.CutterModule.getCurrentVariantId();
    if (vid) {
      const variant = findVariantById(vid);
      if (variant) { variant.cutterSettings = window.CutterModule.getSettings(); scheduleSave(); }
    }
    // Actualizar conteo del timeline
    const tc = document.getElementById('timelineCount');
    if (tc) tc.textContent = countTimelineFrames();
  });

  // Si hay una variante pendiente de abrir, cargarla
  if (state.pendingCutterVariant) {
    const { variant, url } = state.pendingCutterVariant;
    state.pendingCutterVariant = null;
    window.CutterModule.loadUrl(url, variant.id, variant.cutterSettings);
  }
}

// ── Añadir frames del Cutter al timeline de la animación ──────────────────
function addCutterFramesToTimeline(anim, cutterFrames) {
  // Usar la primera dirección disponible (East por defecto)
  let dir = anim.directions.find(d => d.key === 'E') || anim.directions[0];
  if (!dir) return;

  cutterFrames.forEach(cf => {
    const frame = createFrame(dir.frames.length + 1);
    frame.blob = canvasToBlob(cf.canvas);
    frame.status = 'ready';
    frame.sourceVariantId = cf.sourceVariantId || null;
    frame.sourceFrameIndex = cf.sourceFrameIndex ?? null;
    frame.flipped = cf.flipped || false;
    dir.frames.push(frame);
  });

  renumberFrames(dir);
  scheduleSave();

  // Actualizar contador
  const tc = document.getElementById('timelineCount');
  if (tc) tc.textContent = countTimelineFrames();
}

function canvasToBlob(canvas) {
  // Convertir Canvas a Blob síncrono (para que pueda ser almacenado como frame.blob)
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const bin = atob(dataUrl.split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: 'image/png' });
  } catch { return null; }
}

function countTimelineFrames() {
  const anim = getActiveAnimation();
  if (!anim) return 0;
  return anim.directions.reduce((n, d) => n + (d.frames?.length || 0), 0);
}

// ── Persistir variantes al guardar el proyecto ─────────────────────────────
// Hook en persistProjectAssets (app-cloud.js) — se llama desde ahí
async function persistVariantAssets(project) {
  for (const anim of project.animations || []) {
    for (const variant of anim.variants || []) {
      // Si hay blob pendiente y no hay imagePath, subir
      if (variant._blob && !variant.imagePath) {
        await uploadVariantSheet(project, variant, variant._blob);
        delete variant._blob;
      }
    }
  }
}

// ── Serializar variantes (limpiar blobs) ────────────────────────────────────
function cleanVariantsForSerialization(animations) {
  for (const anim of animations || []) {
    for (const variant of anim.variants || []) {
      delete variant._blob;
    }
  }
}

// ── normalizeAnimation — asegurar variants[] ──────────────────────────────
// (parcheamos normalizeAnimation de app-cloud.js inyectando este wrapper)
const _origNormalizeAnimation = typeof normalizeAnimation === 'function' ? normalizeAnimation : null;
// Se sobreescribe en app-utils.js via init, pero aquí añadimos el hook de variants
// para que se llame siempre que se normalice una animación
if (window.__normalizeAnimationPatched !== true) {
  window.__normalizeAnimationPatched = true;
  // Escucha al init() para parchear; safe porque app-sheets carga después de app-cloud
}
