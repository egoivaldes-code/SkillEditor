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

  init();

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
