'use strict';

const CONFIG = window.CRIPTA_SPRITE_CONFIG || {};
  const sb = window.supabase?.createClient?.(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  const AUTHOR_KEY = 'cripta_sprite_author_v1';
  const SETTINGS_KEY = 'cripta_sprite_settings_v2';

  const DB_NAME = 'cripta-sprite-forge';
  const DB_VERSION = 1;
  const STORE = 'projects';
  const NORMAL_DIRECTION_DEFS = {
    2: [{ key: 'E', name: 'Derecha' }, { key: 'W', name: 'Izquierda' }],
    4: [{ key: 'S', name: 'Abajo' }, { key: 'W', name: 'Izquierda' }, { key: 'E', name: 'Derecha' }, { key: 'N', name: 'Arriba' }],
    8: [
      { key: 'S', name: 'Abajo' },
      { key: 'SW', name: 'Abajo-Izq' },
      { key: 'W', name: 'Izquierda' },
      { key: 'NW', name: 'Arriba-Izq' },
      { key: 'N', name: 'Arriba' },
      { key: 'NE', name: 'Arriba-Der' },
      { key: 'E', name: 'Derecha' },
      { key: 'SE', name: 'Abajo-Der' }
    ]
  };
  const MIRROR_DIRECTION_DEFS = {
    2: [{ key: 'E', name: 'Derecha' }],
    4: [{ key: 'E', name: 'Derecha' }, { key: 'N', name: 'Arriba' }, { key: 'S', name: 'Abajo' }],
    8: [{ key: 'N', name: 'Norte' }, { key: 'S', name: 'Sur' }, { key: 'E', name: 'Este' }, { key: 'NE', name: 'Noreste' }, { key: 'SE', name: 'Sureste' }]
  };

  const els = {
    main: document.getElementById('main'),
    pageTitle: document.getElementById('pageTitle'),
    pageSubtitle: document.getElementById('pageSubtitle'),
    backBtn: document.getElementById('backBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    editorNav: document.getElementById('editorNav'),
    referenceInput: document.getElementById('referenceInput'),
    frameInput: document.getElementById('frameInput'),
    settingsDialog: document.getElementById('settingsDialog'),
    authorNameInput: document.getElementById('authorNameInput'),
    connectionStatusText: document.getElementById('connectionStatusText'),
    deviceUserIdText: document.getElementById('deviceUserIdText'),
    roleStatusText: document.getElementById('roleStatusText'),
    demoModeInput: document.getElementById('demoModeInput'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    confirmDialog: document.getElementById('confirmDialog'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmText: document.getElementById('confirmText'),
    confirmOkBtn: document.getElementById('confirmOkBtn')
  };

  const state = {
    projects: [],
    currentProject: null,
    currentStep: 'base',
    selectedDirection: null,
    pendingFrameUploadId: null,
    drag: null,
    urls: new Set(),
    previewFlipByDirection: {},
    settings: loadSettings(),
    storageAvailable: true,
    currentUser: null,
    authorName: localStorage.getItem(AUTHOR_KEY) || '',
    isAdmin: false,
    online: false,
    syncing: false,
    setupError: '',
    realtimeChannel: null,
    saveStatus: 'idle',
    saveQueued: false
  };

  let dbPromise;
  let autosaveTimer;

  // NOTE: init() is called once at the end of app-utils.js, after all
  // script files are loaded and all functions are defined.

  async function init() {
    bindGlobalEvents();
    await requestPersistentStorage();
    try {
      await initSupabase();
      state.projects = await getAllProjects();
      state.online = true;
      subscribeRealtime();
    } catch (error) {
      console.error('No se pudo iniciar el modo colaborativo:', error);
      state.online = false;
      state.setupError = error?.message || String(error);
      try {
        state.projects = await getAllLocalProjects();
      } catch {
        state.storageAvailable = false;
        state.projects = [];
      }
    }
    renderHome();
    registerServiceWorker();
    if (!state.authorName) setTimeout(changeAuthorName, 250);
  }

  function bindGlobalEvents() {
    els.backBtn.addEventListener('click', async () => {
      if (state.currentProject) {
        await saveCurrentNow();
        state.currentProject = null;
        state.currentStep = 'base';
        cleanupUrls();
        renderHome();
      }
    });

    els.settingsBtn.addEventListener('click', () => {
      els.authorNameInput.value = state.authorName || '';
      els.demoModeInput.checked = !!state.settings.demoMode;
      els.connectionStatusText.textContent = state.online ? 'Supabase conectado' : 'Modo local / sin configurar';
      els.deviceUserIdText.textContent = state.currentUser?.id || 'Sin sesión';
      els.roleStatusText.textContent = state.isAdmin ? 'Administrador' : (state.currentUser ? 'Autor' : 'Local');
      els.settingsDialog.showModal();
    });

    els.saveSettingsBtn.addEventListener('click', () => {
      state.authorName = els.authorNameInput.value.trim() || 'Sin nombre';
      state.settings = { ...state.settings, demoMode: !!els.demoModeInput.checked };
      localStorage.setItem(AUTHOR_KEY, state.authorName);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      toast('Ajustes guardados');
      renderHome();
    });

    els.editorNav.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-step]');
      if (!btn || !state.currentProject) return;
      state.currentStep = btn.dataset.step;
      renderEditor();
    });

    els.referenceInput.addEventListener('change', async () => {
      if (!canManageProject(state.currentProject)) return toast('No puedes modificar este proyecto');
      const files = [...els.referenceInput.files].slice(0, Math.max(0, 4 - state.currentProject.references.length));
      for (const file of files) {
        const blob = await resizeImageBlob(file, 480, 480);
        state.currentProject.references.push({ id: uid(), name: file.name, blob, imagePath: '', status: 'ready' });
      }
      els.referenceInput.value = '';
      scheduleSave();
      renderEditor();
    });

    els.frameInput.addEventListener('change', async () => {
      if (!canManageProject(state.currentProject)) return toast('No puedes modificar este proyecto');
      const file = els.frameInput.files?.[0];
      if (!file || !state.pendingFrameUploadId) return;
      const frame = findFrameById(state.pendingFrameUploadId);
      if (frame) {
        frame.blob = file;
        frame.imagePath = '';
        frame.status = 'ready';
        frame.updatedAt = Date.now();
        scheduleSave();
      }
      state.pendingFrameUploadId = null;
      els.frameInput.value = '';
      renderEditor();
    });
  }

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { demoMode: false }; }
    catch { return { demoMode: false }; }
  }

  async function requestPersistentStorage() {
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {}
  }

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function getAllLocalProjects() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
      req.onerror = () => reject(req.error);
    });
  }

  async function putLocalProject(project) {
    if (!state.storageAvailable) return;
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(project);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      state.storageAvailable = false;
      console.warn('No se pudo guardar el proyecto:', error);
    }
  }

  async function deleteLocalProject(id) {
    if (!state.storageAvailable) return;
    try {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (error) {
      state.storageAvailable = false;
      console.warn('No se pudo eliminar el proyecto:', error);
    }
  }

  function createProject() {
    const now = Date.now();
    const project = {
      id: uid(),
      ownerId: state.currentUser?.id || 'local',
      author: state.authorName || 'Sin nombre',
      cloudPersisted: false,
      name: 'Nuevo personaje',
      category: 'Personaje',
      basePrompt: 'Pixel art detallado, RPG medieval oscuro, vista top-down 3/4, fondo magenta chroma #FF00FF, personaje centrado, misma escala y encuadre.',
      negativePrompt: 'texto, interfaz, suelo, sombras sobre el fondo, deformidades, frames unidos',
      references: [],
      animations: [createAnimation('Walk', 2, 6)],
      activeAnimationId: null,
      createdAt: now,
      updatedAt: now
    };
    project.activeAnimationId = project.animations[0].id;
    return project;
  }

  function createAnimation(type = 'Walk', directionCount = 2, frameCount = 6, mirror = false) {
    const directionDefs = getDirectionDefs(directionCount, mirror);
    return {
      id: uid(),
      name: type,
      type,
      directionCount,
      mirror,
      initialFrameCount: frameCount,
      width: 512,
      height: 512,
      background: '#FF00FF',
      directions: directionDefs.map(def => ({
        id: uid(),
        key: def.key,
        name: def.name,
        frames: Array.from({ length: frameCount }, (_, i) => createFrame(i + 1))
      }))
    };
  }

  function createFrame(index) {
    return {
      id: uid(),
      label: `Frame ${index}`,
      prompt: '',
      status: 'empty',
      blob: null,
      imagePath: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function getDirectionDefs(directionCount = 2, mirror = false) {
    const defs = mirror ? MIRROR_DIRECTION_DEFS[directionCount] : NORMAL_DIRECTION_DEFS[directionCount];
    return (defs || NORMAL_DIRECTION_DEFS[2]).map(def => ({ ...def }));
  }

  function directionKeyFromName(name = '') {
    const normalized = String(name).trim().toLowerCase();
    const map = {
      'derecha': 'E', 'este': 'E',
      'izquierda': 'W', 'oeste': 'W',
      'arriba': 'N', 'norte': 'N',
      'abajo': 'S', 'sur': 'S',
      'arriba-der': 'NE', 'noreste': 'NE',
      'arriba-izq': 'NW', 'noroeste': 'NW',
      'abajo-der': 'SE', 'sureste': 'SE',
      'abajo-izq': 'SW', 'suroeste': 'SW'
    };
    return map[normalized] || normalized.toUpperCase() || 'E';
  }

  function mirrorSummary(directionCount) {
    return ({
      2: '1 dirección generada: Derecha.',
      4: '3 direcciones generadas: Derecha, Arriba y Abajo.',
      8: '5 direcciones generadas: Norte, Sur, Este, Noreste y Sureste.'
    })[directionCount] || '';
  }

  function directionChipText(anim) {
    const generated = getDirectionDefs(anim?.directionCount || 2, !!anim?.mirror).length;
    return anim?.mirror ? `${generated}/${anim.directionCount} dir. espejo` : `${anim?.directionCount || generated} dir.`;
  }

  function normalizeAnimation(anim) {
    if (!anim) return;
    if (typeof anim.mirror !== 'boolean') anim.mirror = false;
    if (!Array.isArray(anim.directions)) anim.directions = [];
    anim.directions.forEach(dir => {
      dir.key = dir.key || directionKeyFromName(dir.name);
      if (!Array.isArray(dir.frames)) dir.frames = [];
      dir.frames.forEach(frame => { frame.imagePath = frame.imagePath || ''; });
      renumberFrames(dir);
    });
  }

  function normalizeProject(project) {
    if (!project) return;
    project.ownerId = project.ownerId || state.currentUser?.id || 'local';
    project.author = project.author || state.authorName || 'Sin nombre';
    project.references = Array.isArray(project.references) ? project.references : [];
    project.references.forEach(ref => { ref.imagePath = ref.imagePath || ''; });
    project.animations = Array.isArray(project.animations) ? project.animations : [];
    project.animations.forEach(normalizeAnimation);
  }

  function syncAnimationDirections(anim) {
    normalizeAnimation(anim);
    const oldByKey = new Map(anim.directions.map(dir => [dir.key || directionKeyFromName(dir.name), dir]));
    const defs = getDirectionDefs(anim.directionCount, !!anim.mirror);
    anim.directions = defs.map(def => {
      const existing = oldByKey.get(def.key);
      if (existing) {
        existing.key = def.key;
        existing.name = def.name;
        if (!Array.isArray(existing.frames) || !existing.frames.length) {
          existing.frames = Array.from({ length: anim.initialFrameCount }, (_, i) => createFrame(i + 1));
        }
        renumberFrames(existing);
        return existing;
      }
      return {
        id: uid(),
        key: def.key,
        name: def.name,
        frames: Array.from({ length: anim.initialFrameCount }, (_, i) => createFrame(i + 1))
      };
    });
    state.selectedDirection = anim.directions[0]?.id || null;
  }

  function getFullDirectionDefs(directionCount = 2) {
    return (NORMAL_DIRECTION_DEFS[directionCount] || NORMAL_DIRECTION_DEFS[2]).map(def => ({ ...def }));
  }

  function getMirrorSourceKey(targetKey) {
    return ({ W: 'E', NW: 'NE', SW: 'SE' })[targetKey] || null;
  }

  function isPreviewFlipped(directionId) {
    return !!state.previewFlipByDirection?.[directionId];
  }

  function toggleDirectionPreviewFlip(directionId) {
    state.previewFlipByDirection[directionId] = !state.previewFlipByDirection[directionId];
  }

  function duplicateSelectedDirectionToTarget() {
    const anim = getActiveAnimation();
    const source = getSelectedDirection();
    const targets = anim.directions.filter(d => d.id !== source.id);
    if (!targets.length) return toast('No hay otra dirección disponible');
    const message = targets.map((d, i) => `${i + 1}. ${d.name}`).join('\n');
    const answer = window.prompt(`Copiar todos los frames de "${source.name}" a:\n\n${message}\n\nEscribe el número del destino.`);
    if (answer == null) return;
    const idx = Number.parseInt(answer, 10) - 1;
    const target = targets[idx];
    if (!target) return toast('Dirección no válida');
    target.frames = source.frames.map((frame, i) => {
      const copy = structuredClone(frame);
      copy.id = uid();
      copy.label = `Frame ${i + 1}`;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      return copy;
    });
    renumberFrames(target);
    scheduleSave();
    toast(`Dirección copiada a ${target.name}`);
    renderEditor();
  }

  function getExportDirections(anim, expandMirror = false) {
    if (!(expandMirror && anim?.mirror)) {
      return anim.directions.map(dir => ({
        key: dir.key,
        name: dir.name,
        frames: dir.frames.map(frame => ({ frame, flip: false }))
      }));
    }

    const fullDefs = getFullDirectionDefs(anim.directionCount);
    const byKey = new Map(anim.directions.map(dir => [dir.key || directionKeyFromName(dir.name), dir]));
    return fullDefs.map(def => {
      const direct = byKey.get(def.key);
      if (direct) {
        return { key: def.key, name: def.name, frames: direct.frames.map(frame => ({ frame, flip: false })) };
      }
      const mirrorSourceKey = getMirrorSourceKey(def.key);
      const mirrorSource = mirrorSourceKey ? byKey.get(mirrorSourceKey) : null;
      if (mirrorSource) {
        return { key: def.key, name: def.name, frames: mirrorSource.frames.map(frame => ({ frame, flip: true })) };
      }
      return { key: def.key, name: def.name, frames: [] };
    });
  }
