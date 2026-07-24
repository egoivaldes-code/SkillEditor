'use strict';

function renderHome() {
    cleanupUrls();
    els.pageTitle.textContent = 'Sprite Forge';
    els.pageSubtitle.textContent = state.online ? 'Biblioteca familiar' : 'Modo local';
    els.backBtn.classList.add('hidden');
    els.editorNav.classList.add('hidden');

    const projectCards = state.projects.map(projectCardHtml).join('');
    const connectionClass = state.online ? 'online' : (state.setupError ? 'error' : '');
    const connectionText = state.online ? 'Supabase conectado' : 'Modo local';
    els.main.innerHTML = `
      <section class="section">
        <div class="cloud-banner">
          <div class="cloud-user">
            <strong>${escapeHtml(state.authorName || 'Sin nombre')}</strong>
            <small>${state.isAdmin ? 'Administrador familiar' : 'Autor de este dispositivo'}</small>
          </div>
          <span class="connection-pill ${connectionClass}">${connectionText}</span>
        </div>
        ${state.setupError ? `<div class="setup-note"><strong>Falta terminar Supabase.</strong><br>${escapeHtml(state.setupError)}<br><small>La app continúa en modo local. Ejecuta la migración incluida y despliega la función <code>generate-sprite</code>.</small></div>` : ''}
        <div class="hero-card">
          <h2>Sprites compartidos con la familia</h2>
          <p>Cada dispositivo tiene su autor. Todos ven la biblioteca; el autor y los administradores pueden editar o eliminar.</p>
          <button id="newProjectBtn" class="primary-btn">＋ Nuevo proyecto</button>
        </div>
        <div class="section-head">
          <h2>Proyectos</h2>
          <span class="chip">${state.projects.length}</span>
        </div>
        <div class="project-list">
          ${projectCards || '<div class="empty-state">Todavía no hay proyectos.</div>'}
        </div>
      </section>`;

    document.getElementById('newProjectBtn').addEventListener('click', async () => {
      const project = createProject();
      state.projects.unshift(project);
      try {
        await putProject(project);
        openProject(project.id);
      } catch (error) {
        toast(`No se pudo crear: ${error.message || error}`);
        renderHome();
      }
    });

    els.main.querySelectorAll('[data-open-project]').forEach(btn => btn.addEventListener('click', () => openProject(btn.dataset.openProject)));
    els.main.querySelectorAll('[data-duplicate-project]').forEach(btn => btn.addEventListener('click', () => duplicateProject(btn.dataset.duplicateProject)));
    els.main.querySelectorAll('[data-delete-project]').forEach(btn => btn.addEventListener('click', () => confirmDeleteProject(btn.dataset.deleteProject)));
  }

  function projectCardHtml(project) {
    const thumbAsset = getProjectThumbAsset(project);
    const thumbSrc = assetSrc(thumbAsset) || (project.thumbnailPath ? publicAssetUrl(project.thumbnailPath) : '');
    const thumb = thumbSrc ? `<img src="${escapeAttr(thumbSrc)}" alt="">` : 'Sin imagen';
    const anim = project.animations?.find(a => a.id === project.activeAnimationId) || project.animations?.[0];
    const frameTotal = anim ? anim.directions.reduce((n,d) => n + d.frames.length, 0) : 0;
    const manageable = canManageProject(project);
    return `
      <article class="project-card ${manageable ? '' : 'readonly'}">
        <button class="project-thumb" ${manageable ? `data-open-project="${project.id}"` : ''}>${thumb}</button>
        <button class="project-info" ${manageable ? `data-open-project="${project.id}"` : ''} style="background:none;border:0;color:inherit;text-align:left;padding:0;" ${manageable ? '' : 'disabled'}>
          <h3>${escapeHtml(project.name)}</h3>
          <div class="meta-row">
            <span class="chip">${escapeHtml(anim?.type || 'Sin animación')}</span>
            <span class="chip">${directionChipText(anim)}</span>
            <span class="chip">${frameTotal} huecos</span>
            ${state.isAdmin && project.ownerId !== state.currentUser?.id ? '<span class="chip badge-admin">ADMIN</span>' : ''}
          </div>
          <div class="author-line">Por ${escapeHtml(project.author || 'Sin nombre')}${manageable ? ' · editable' : ' · solo lectura'}</div>
        </button>
        <div class="project-actions">
          <button class="mini-btn" data-duplicate-project="${project.id}" title="Duplicar">⧉</button>
          ${manageable ? `<button class="mini-btn" data-delete-project="${project.id}" title="Eliminar">🗑</button>` : ''}
        </div>
      </article>`;
  }

  function openProject(id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    if (!canManageProject(project)) return toast('Duplica el proyecto para trabajar sobre tu propia copia');
    normalizeProject(project);
    state.currentProject = project;
    state.currentStep = 'base';
    const anim = getActiveAnimation();
    state.selectedDirection = anim?.directions?.[0]?.id || null;
    renderEditor();
  }

  async function duplicateProject(id) {
    const original = state.projects.find(p => p.id === id);
    if (!original) return;
    toast('Duplicando proyecto e imágenes…');
    const clone = structuredClone(original);
    clone.id = uid();
    clone.ownerId = state.currentUser?.id || 'local';
    clone.author = state.authorName || 'Sin nombre';
    clone.cloudPersisted = false;
    clone.thumbnailPath = '';
    clone.name = `${original.name} copia`;
    clone.createdAt = clone.updatedAt = Date.now();
    remapProjectIds(clone);
    await hydrateCloneAssets(original, clone);
    state.projects.unshift(clone);
    await putProject(clone);
    toast('Proyecto duplicado');
    renderHome();
  }

  async function hydrateCloneAssets(original, clone) {
    for (let i = 0; i < clone.references.length; i++) {
      const source = original.references[i];
      clone.references[i].blob = await assetToBlob(source);
      clone.references[i].imagePath = '';
    }
    for (let a = 0; a < clone.animations.length; a++) {
      for (let d = 0; d < clone.animations[a].directions.length; d++) {
        const sourceFrames = original.animations[a]?.directions[d]?.frames || [];
        const targetFrames = clone.animations[a].directions[d].frames;
        for (let f = 0; f < targetFrames.length; f++) {
          targetFrames[f].blob = await assetToBlob(sourceFrames[f]);
          targetFrames[f].imagePath = '';
        }
      }
    }
  }

  function remapProjectIds(project) {
    const animMap = new Map();
    project.references.forEach(r => r.id = uid());
    project.animations.forEach(a => {
      const old = a.id;
      a.id = uid();
      animMap.set(old, a.id);
      a.directions.forEach(d => {
        d.id = uid();
        d.frames.forEach(f => f.id = uid());
      });
    });
    project.activeAnimationId = animMap.get(project.activeAnimationId) || project.animations[0]?.id;
  }

  function confirmDeleteProject(id) {
    const project = state.projects.find(p => p.id === id);
    if (!canManageProject(project)) return toast('No puedes eliminar este proyecto');
    els.confirmTitle.textContent = 'Eliminar proyecto';
    els.confirmText.textContent = `Se eliminará “${project?.name || ''}” y todas sus imágenes compartidas.`;
    els.confirmOkBtn.onclick = async () => {
      try {
        await deleteProjectDb(id);
        state.projects = state.projects.filter(p => p.id !== id);
        toast('Proyecto eliminado');
      } catch (error) {
        toast(`No se pudo eliminar: ${error.message || error}`);
      }
      renderHome();
    };
    els.confirmDialog.showModal();
  }

  function renderEditor() {
    cleanupUrls();
    const p = state.currentProject;
    if (!p) return renderHome();
    els.pageTitle.textContent = p.name;
    const saveLabel = state.online ? ({ pending: 'cambios pendientes', saving: 'guardando…', saved: 'guardado', error: 'error al guardar' }[state.saveStatus] || 'nube') : 'local';
    els.pageSubtitle.textContent = `${stepLabel(state.currentStep)} · ${saveLabel}`;
    els.backBtn.classList.remove('hidden');
    els.editorNav.classList.remove('hidden');
    els.editorNav.querySelectorAll('[data-step]').forEach(btn => btn.classList.toggle('active', btn.dataset.step === state.currentStep));

    if (state.currentStep === 'base') renderBaseStep();
    if (state.currentStep === 'config') renderConfigStep();
    if (state.currentStep === 'frames') renderFramesStep();
    if (state.currentStep === 'export') renderExportStep();
  }

  function renderBaseStep() {
    const p = state.currentProject;
    const refs = p.references.map(ref => `
      <div class="ref-card">
        <img src="${escapeAttr(assetSrc(ref))}" alt="${escapeHtml(ref.name || 'Referencia')}">
        <button class="remove-ref" data-remove-ref="${ref.id}">✕</button>
      </div>`).join('');

    els.main.innerHTML = `
      <section class="section">
        <div class="card">
          <label class="field"><span>Nombre del proyecto</span><input id="projectName" value="${escapeAttr(p.name)}"></label>
          <label class="field"><span>Tipo de sprite</span>
            <select id="projectCategory">
              ${['Personaje','Enemigo','NPC','Objeto','Efecto'].map(v => `<option ${p.category===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="card">
          <h3>Imágenes de referencia</h3>
          <div class="ref-grid">
            ${refs}
            ${p.references.length < 4 ? '<button id="addReferenceBtn" class="ref-add">＋<br>Añadir referencia</button>' : ''}
          </div>
        </div>
        <div class="card">
          <label class="field"><span>Prompt base</span><textarea id="basePrompt">${escapeHtml(p.basePrompt)}</textarea></label>
          <details style="margin-top:12px"><summary class="muted">Prompt negativo</summary>
            <label class="field"><textarea id="negativePrompt">${escapeHtml(p.negativePrompt || '')}</textarea></label>
          </details>
        </div>
        <button id="nextBaseBtn" class="primary-btn full">Continuar a configuración</button>
      </section>`;

    bindValue('projectName', value => { p.name = value || 'Sin nombre'; els.pageTitle.textContent = p.name; });
    bindValue('projectCategory', value => p.category = value);
    bindValue('basePrompt', value => p.basePrompt = value);
    bindValue('negativePrompt', value => p.negativePrompt = value);
    document.getElementById('addReferenceBtn')?.addEventListener('click', () => els.referenceInput.click());
    els.main.querySelectorAll('[data-remove-ref]').forEach(btn => btn.addEventListener('click', async () => {
      const ref = p.references.find(r => r.id === btn.dataset.removeRef);
      await removeAsset(ref);
      p.references = p.references.filter(r => r.id !== btn.dataset.removeRef);
      scheduleSave(); renderEditor();
    }));
    document.getElementById('nextBaseBtn').addEventListener('click', () => { state.currentStep = 'config'; renderEditor(); });
  }

  function renderConfigStep() {
    const p = state.currentProject;
    const anim = getActiveAnimation();
    const generatedDirectionCount = getDirectionDefs(anim.directionCount, !!anim.mirror).length;
    els.main.innerHTML = `
      <section class="section">
        <div class="card">
          <div class="section-head"><h3 style="margin:0">Animaciones</h3><button id="addAnimationBtn" class="mini-btn">＋</button></div>
          <div class="segmented" style="margin-top:12px">
            ${p.animations.map(a => `<button class="${a.id===anim.id?'active':''}" data-select-animation="${a.id}">${escapeHtml(a.name)}</button>`).join('')}
          </div>
        </div>
        <div class="card">
          <label class="field"><span>Nombre</span><input id="animationName" value="${escapeAttr(anim.name)}"></label>
          <label class="field"><span>Tipo de animación</span>
            <select id="animationType">
              ${['Idle','Walk','Attack','Cast','Hurt','Death','Activate','Custom'].map(v => `<option ${anim.type===v?'selected':''}>${v}</option>`).join('')}
            </select>
          </label>
          <div class="field" style="margin-top:12px"><span>Direcciones</span>
            <div class="segmented" id="directionCountSeg">
              ${[2,4,8].map(n => `<button data-dir-count="${n}" class="${anim.directionCount===n?'active':''}">${n}</button>`).join('')}
            </div>
          </div>
          <label class="field" style="margin-top:12px"><span>Espejo horizontal</span>
            <div style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;background:#141313;">
              <input id="mirrorMode" type="checkbox" ${anim.mirror ? 'checked' : ''} style="width:20px;height:20px;accent-color: var(--accent);margin-top:2px;">
              <div>
                <div style="font-weight:700">Activar espejo</div>
                <div class="muted small" id="mirrorHint">${anim.mirror ? `Se generarán ${generatedDirectionCount} direcciones base. ${mirrorSummary(anim.directionCount)}` : 'Desactivado: se generarán todas las direcciones completas.'}</div>
              </div>
            </div>
          </label>
          <div class="field-grid" style="margin-top:12px">
            <label class="field"><span>Frames iniciales por dirección</span><input id="initialFrameCount" type="number" min="1" max="24" value="${anim.initialFrameCount}"></label>
            <label class="field"><span>Tamaño de frame</span>
              <select id="frameSize"><option value="256" ${anim.width===256?'selected':''}>256 × 256</option><option value="512" ${anim.width===512?'selected':''}>512 × 512</option><option value="1024" ${anim.width===1024?'selected':''}>1024 × 1024</option></select>
            </label>
          </div>
          <p class="muted small">El número inicial solo crea los huecos. Después puedes añadir, duplicar, borrar y reordenar libremente cada dirección.</p>
        </div>
        <div class="inline-actions">
          <button id="deleteAnimationBtn" class="danger-btn">Eliminar animación</button>
          <button id="goFramesBtn" class="primary-btn">Ir a frames</button>
        </div>
      </section>`;

    bindValue('animationName', value => { anim.name = value || anim.type; });
    bindValue('animationType', value => { anim.type = value; if (!anim.name || anim.name === 'Custom') anim.name = value; });
    bindValue('initialFrameCount', value => { anim.initialFrameCount = clampInt(value, 1, 24, 6); });
    bindValue('frameSize', value => { anim.width = anim.height = Number(value); });

    els.main.querySelectorAll('[data-select-animation]').forEach(btn => btn.addEventListener('click', () => {
      p.activeAnimationId = btn.dataset.selectAnimation;
      state.selectedDirection = getActiveAnimation().directions[0]?.id;
      scheduleSave(); renderEditor();
    }));

    document.getElementById('addAnimationBtn').addEventListener('click', () => {
      const a = createAnimation('Idle', 2, 6);
      p.animations.push(a); p.activeAnimationId = a.id; state.selectedDirection = a.directions[0].id;
      scheduleSave(); renderEditor();
    });

    document.getElementById('mirrorMode').addEventListener('change', (event) => {
      anim.mirror = !!event.target.checked;
      syncAnimationDirections(anim);
      scheduleSave(); renderEditor();
    });

    els.main.querySelectorAll('[data-dir-count]').forEach(btn => btn.addEventListener('click', () => changeDirectionCount(Number(btn.dataset.dirCount))));
    document.getElementById('deleteAnimationBtn').addEventListener('click', () => deleteActiveAnimation());
    document.getElementById('goFramesBtn').addEventListener('click', () => { state.currentStep = 'frames'; renderEditor(); });
  }

  function changeDirectionCount(count) {
    const anim = getActiveAnimation();
    if (anim.directionCount === count) return;
    anim.directionCount = count;
    syncAnimationDirections(anim);
    scheduleSave(); renderEditor();
  }

  function deleteActiveAnimation() {
    const p = state.currentProject;
    if (p.animations.length === 1) return toast('Debe quedar al menos una animación');
    const current = getActiveAnimation();
    els.confirmTitle.textContent = 'Eliminar animación';
    els.confirmText.textContent = `Se eliminará “${current.name}”.`;
    els.confirmOkBtn.onclick = () => {
      p.animations = p.animations.filter(a => a.id !== current.id);
      p.activeAnimationId = p.animations[0].id;
      state.selectedDirection = p.animations[0].directions[0]?.id;
      scheduleSave(); renderEditor();
    };
    els.confirmDialog.showModal();
  }
