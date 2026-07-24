'use strict';

function bindValue(id, setter) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => { setter(el.value); scheduleSave(); });
    el.addEventListener('change', () => { setter(el.value); scheduleSave(); });
  }

  function getActiveAnimation() {
    const p = state.currentProject;
    return p.animations.find(a => a.id === p.activeAnimationId) || p.animations[0];
  }

  function getSelectedDirection() {
    const anim = getActiveAnimation();
    return anim.directions.find(d => d.id === state.selectedDirection) || anim.directions[0];
  }

  function findFrameById(id) {
    const anim = getActiveAnimation();
    for (const dir of anim.directions) {
      const frame = dir.frames.find(f => f.id === id);
      if (frame) return frame;
    }
    return null;
  }

  function getProjectThumbAsset(project) {
    for (const anim of project.animations || []) for (const dir of anim.directions || []) for (const frame of dir.frames || []) if (assetHasImage(frame)) return frame;
    return (project.references || []).find(assetHasImage) || null;
  }

  function scheduleSave() {
    if (!state.currentProject || !canManageProject(state.currentProject)) return;
    state.saveStatus = 'pending';
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveCurrentNow, 700);
  }

  async function saveCurrentNow() {
    if (!state.currentProject || !canManageProject(state.currentProject)) return;
    if (state.syncing) {
      state.saveQueued = true;
      return;
    }
    state.syncing = true;
    state.saveStatus = 'saving';
    const project = state.currentProject;
    try {
      project.updatedAt = Date.now();
      project.author = state.authorName || project.author;
      await putProject(project);
      const index = state.projects.findIndex(p => p.id === project.id);
      if (index >= 0) state.projects[index] = project;
      state.saveStatus = 'saved';
    } catch (error) {
      console.error(error);
      state.saveStatus = 'error';
      toast(error.message || 'No se pudo guardar el proyecto');
    } finally {
      state.syncing = false;
      if (state.saveQueued) {
        state.saveQueued = false;
        setTimeout(saveCurrentNow, 50);
      }
    }
  }

  function assetHasImage(asset) {
    return Boolean(asset && (asset.blob || asset.imagePath));
  }

  function assetSrc(asset) {
    if (!asset) return '';
    if (asset.blob instanceof Blob) return objectUrl(asset.blob);
    return asset.imagePath ? publicAssetUrl(asset.imagePath) : '';
  }

  async function assetToBlob(asset) {
    if (!asset) return null;
    if (asset.blob instanceof Blob) return asset.blob;
    const url = asset.imagePath ? publicAssetUrl(asset.imagePath) : '';
    if (!url) return null;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`No se pudo descargar una imagen (${response.status})`);
    return response.blob();
  }

  async function resizeImageBlob(file, maxWidth = 480, maxHeight = 480) {
    const image = await blobToImage(file);
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    if (scale >= 1 && file.type === 'image/png') return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo preparar la referencia')), 'image/png'));
  }

  function mimeExtension(type = 'image/png') {
    if (type.includes('jpeg')) return 'jpg';
    if (type.includes('webp')) return 'webp';
    if (type.includes('gif')) return 'gif';
    return 'png';
  }

  function objectUrl(blob) {
    const url = URL.createObjectURL(blob);
    state.urls.add(url);
    return url;
  }

  function cleanupUrls() {
    for (const url of state.urls) URL.revokeObjectURL(url);
    state.urls.clear();
  }

  function statusLabel(status) {
    return ({ empty:'vacío', loading:'generando', ready:'listo', error:'error' })[status] || status;
  }

  function stepLabel(step) {
    return ({ base:'Referencia', generate:'Generar', cutter:'Editor Cutter', frames:'Timeline', export:'Exportar' })[step] || '';
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }
  function clampInt(value, min, max, fallback) { const n = Number.parseInt(value,10); return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback; }
  function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escapeAttr(value='') { return escapeHtml(value); }
  function slugify(value='sprite') { return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'sprite'; }

  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen inválida')); };
      img.src = url;
    });
  }

  function base64ToBlob(base64, mime='image/png') {
    const clean = base64.includes(',') ? base64.split(',')[1] : base64;
    const bytes = atob(clean); const arr = new Uint8Array(bytes.length);
    for (let i=0;i<bytes.length;i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toast(message) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = message;
    document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
  }

// All scripts loaded — initialize the application.
init();
