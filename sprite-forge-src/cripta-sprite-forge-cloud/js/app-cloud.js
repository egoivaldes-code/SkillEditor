'use strict';

async function initSupabase() {
    if (!sb || !CONFIG.supabaseUrl || !CONFIG.supabaseKey) throw new Error('Falta config.js de Supabase');
    const { data: { session }, error: sessionError } = await sb.auth.getSession();
    if (sessionError) throw sessionError;
    if (session?.user) state.currentUser = session.user;
    else {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      state.currentUser = data.user;
    }
    const { data: adminFlag, error: adminError } = await sb.rpc('is_sprite_admin');
    if (!adminError) state.isAdmin = Boolean(adminFlag);
    if (!state.authorName) state.authorName = `Familiar ${state.currentUser.id.slice(0, 4)}`;
  }

  async function getAllProjects() {
    if (!state.currentUser) return getAllLocalProjects();
    const { data, error } = await sb
      .from(CONFIG.projectsTable)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    const projects = (data || []).map(projectFromRow);
    for (const project of projects) await putLocalProject(project);
    return projects;
  }

  async function putProject(project) {
    normalizeProject(project);
    project.updatedAt = Date.now();
    await putLocalProject(project);
    if (!state.online || !state.currentUser) return;
    if (!canManageProject(project)) throw new Error('No tienes permiso para guardar este proyecto');
    await persistProjectAssets(project);
    const row = projectToRow(project);
    const { error } = project.cloudPersisted
      ? await sb.from(CONFIG.projectsTable).update(row).eq('id', project.id)
      : await sb.from(CONFIG.projectsTable).insert({ id: project.id, owner_id: project.ownerId, ...row });
    if (error) throw error;
    project.cloudPersisted = true;
    await putLocalProject(project);
  }

  async function deleteProjectDb(id) {
    const project = state.projects.find(item => item.id === id);
    if (project && state.online && state.currentUser) {
      if (!canManageProject(project)) throw new Error('No tienes permiso para eliminarlo');
      const paths = collectAssetPaths(project);
      if (paths.length) await sb.storage.from(CONFIG.assetsBucket).remove(paths);
      const { error } = await sb.from(CONFIG.projectsTable).delete().eq('id', id);
      if (error) throw error;
    }
    await deleteLocalProject(id);
  }

  function projectFromRow(row) {
    const project = structuredClone(row.payload || {});
    project.id = row.id;
    project.name = row.name || project.name || 'Sin nombre';
    project.ownerId = row.owner_id;
    project.author = row.author || 'Sin nombre';
    project.thumbnailPath = row.thumbnail_path || '';
    project.createdAt = new Date(row.created_at).getTime();
    project.updatedAt = new Date(row.updated_at).getTime();
    project.cloudPersisted = true;
    normalizeProject(project);
    return project;
  }

  function projectToRow(project) {
    const payload = serializeProject(project);
    const isOriginalOwner = project.ownerId === state.currentUser?.id;
    return {
      name: project.name,
      author: isOriginalOwner ? (state.authorName || project.author || 'Sin nombre') : (project.author || 'Sin nombre'),
      payload,
      thumbnail_path: getProjectThumbAsset(project)?.imagePath || project.thumbnailPath || '',
      updated_at: new Date().toISOString()
    };
  }

  function serializeProject(project) {
    const clone = structuredClone(project);
    delete clone.ownerId;
    delete clone.author;
    delete clone.thumbnailPath;
    delete clone.cloudPersisted;
    const cleanAsset = asset => {
      if (!asset) return;
      delete asset.blob;
      delete asset.imageUrl;
    };
    (clone.references || []).forEach(cleanAsset);
    for (const anim of clone.animations || []) for (const dir of anim.directions || []) for (const frame of dir.frames || []) cleanAsset(frame);
    return clone;
  }

  function canManageProject(project) {
    if (!project) return false;
    if (!state.online) return true;
    return Boolean(state.currentUser && (state.isAdmin || project.ownerId === state.currentUser.id));
  }

  async function persistProjectAssets(project) {
    const jobs = [];
    for (const ref of project.references || []) if (ref.blob && !ref.imagePath) jobs.push(uploadAsset(project, ref, 'references'));
    for (const anim of project.animations || []) {
      for (const dir of anim.directions || []) {
        for (const frame of dir.frames || []) if (frame.blob && !frame.imagePath) jobs.push(uploadAsset(project, frame, `frames/${anim.id}/${dir.id}`));
      }
    }
    for (const job of jobs) await job;
  }

  async function uploadAsset(project, asset, folder) {
    const ext = mimeExtension(asset.blob?.type || 'image/png');
    const path = `${project.ownerId}/${project.id}/${folder}/${asset.id}.${ext}`;
    const { error } = await sb.storage.from(CONFIG.assetsBucket).upload(path, asset.blob, {
      contentType: asset.blob.type || 'image/png', upsert: true, cacheControl: '3600'
    });
    if (error) throw error;
    asset.imagePath = path;
    return path;
  }

  async function removeAsset(asset) {
    if (!asset?.imagePath || !state.online) return;
    const { error } = await sb.storage.from(CONFIG.assetsBucket).remove([asset.imagePath]);
    if (error) console.warn('No se pudo borrar el asset remoto:', error);
    asset.imagePath = '';
  }

  function publicAssetUrl(path) {
    if (!path || !sb) return '';
    return sb.storage.from(CONFIG.assetsBucket).getPublicUrl(path).data?.publicUrl || '';
  }

  function collectAssetPaths(project) {
    const paths = [];
    for (const ref of project.references || []) if (ref.imagePath) paths.push(ref.imagePath);
    for (const anim of project.animations || []) for (const dir of anim.directions || []) for (const frame of dir.frames || []) if (frame.imagePath) paths.push(frame.imagePath);
    return [...new Set(paths)];
  }

  function subscribeRealtime() {
    if (!sb || state.realtimeChannel) return;
    state.realtimeChannel = sb.channel('sprite-projects-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: CONFIG.projectsTable }, async payload => {
        if (state.syncing) return;
        try {
          const fresh = await getAllProjects();
          state.projects = fresh;
          if (!state.currentProject) renderHome();
          else if (payload.new?.id === state.currentProject.id && !canManageProject(state.currentProject)) {
            state.currentProject = fresh.find(p => p.id === state.currentProject.id) || state.currentProject;
            renderEditor();
          }
        } catch (error) { console.warn(error); }
      })
      .subscribe();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function changeAuthorName() {
    const value = window.prompt('¿Qué nombre quieres mostrar a tu familia?', state.authorName || '');
    if (value?.trim()) {
      state.authorName = value.trim().slice(0, 40);
      localStorage.setItem(AUTHOR_KEY, state.authorName);
      renderHome();
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
    const answer = window.prompt(`Copiar todos los frames de “${source.name}” a:\n\n${message}\n\nEscribe el número del destino.`);
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
