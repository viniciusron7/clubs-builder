/* ============================================================================
 * app.js — Controller do FC 26 Pro Clubs Builder (estado + UI + eventos).
 * Layout fiel ao original: atributos sempre visíveis + painel de detalhe à direita;
 * as abas (Body / PlayStyles / Specializations / Facilities) abrem MODAIS.
 * Depende de window.DATA, window.Calc, window.Share.
 * ========================================================================== */
(function () {
  const D = window.DATA, C = window.Calc, S = window.Share, L = window.DATA.labels;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // -------------------- estado --------------------
  function defaultBuild() {
    return {
      archetypeId: null, level: 1, clubLevel: 1,
      height: D.defaultHeight, weight: D.defaultWeight,
      attributes: {}, facilities: {}, aiFacilities: {}, playstyles: [], signatures: {}, positions: [], disabledAttrs: [], sumExcluded: [],
    };
  }
  let build = defaultBuild();
  const ui = {
    filter: 'all', selectedAttr: null, modal: null, facilityKind: 'player',
    optimizing: false, optimizeRunId: 0, optimizeController: null,
    utPlayers: null, utLoading: false, utError: null, utQuery: '',
  };
  const OUTFIELD_POSITIONS = ['ST', 'RW', 'LW', 'CAM', 'RM', 'LM', 'CM', 'CDM', 'RB', 'LB', 'CB'];
  const HISTORY_LIMIT = 100;
  const history = window.BuildHistory.create(HISTORY_LIMIT);

  function cloneBuild(value = build) {
    return JSON.parse(JSON.stringify(value));
  }
  function sameBuild(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function rememberBuildChange(before) {
    return history.record(before, build);
  }
  function commitBuildChange(mutator, options = {}) {
    const before = cloneBuild();
    const result = mutator();
    const normalized = C.normalizeBuild(build);
    build = normalized.build;
    const changed = rememberBuildChange(before);
    if (changed && options.render !== false) render();
    if (changed && normalized.adjusted && options.notice !== false) toast('Build adjusted to the current game rules.');
    return { changed, result, adjusted: normalized.adjusted };
  }
  function restoreBuild(snapshot) {
    build = C.normalizeBuild(Object.assign(defaultBuild(), cloneBuild(snapshot))).build;
    ui.selectedAttr = null;
    render();
  }
  function undoBuild() {
    const result = history.undo(build);
    if (!result.changed) return false;
    restoreBuild(result.state);
    toast('Undone');
    return true;
  }
  function redoBuild() {
    const result = history.redo(build);
    if (!result.changed) return false;
    restoreBuild(result.state);
    toast('Redone');
    return true;
  }
  function syncUrl() {
    if (build.archetypeId) { S.replaceUrl(build); return; }
    try {
      const u = new URL(window.location.href);
      if (!u.searchParams.has('b')) return;
      u.searchParams.delete('b');
      window.history.replaceState(null, '', u.toString());
    } catch (e) {}
  }

  // -------------------- labels --------------------
  const attrName = (id) => L.attribute[id] || id;
  const catName = (id) => L.category[id] || id;
  const archName = (id) => L.archetype[id] || id;
  const psName = (id) => (L.playStyle[id] && L.playStyle[id].name) || id;
  const psDesc = (id) => (L.playStyle[id] && L.playStyle[id].desc) || '';
  const psIcon = (id) => { const p = C.playstyle(id); return p ? p.iconFileName : null; };

  // -------------------- render principal --------------------
  function render() {
    const d = C.derive(build);
    renderSummary(d);
    renderArchetypes();
    renderPositions(d);
    renderTabs();
    renderAttributes(d);
    renderDetailPanel(d);
    renderModal(d);
    syncUrl();
  }

  // -------------------- summary bar --------------------
  function renderSummary(d) {
    const arch = d.arch;
    const apClass = d.ap.available < 0 ? 'text-state-error' : 'text-accent-light';
    const accel = d.accel ? `<span class="px-2 py-0.5 rounded text-xs font-bold ${accelClass(d.accel)}">${d.accel}</span>` : '';
    const undoDisabled = !history.canUndo();
    const redoDisabled = !history.canRedo();
    const archInfo = arch
      ? `<img src="archetypes/${arch.iconFileName}" alt="" class="w-9 h-9 object-contain" />
         <div class="leading-tight">
           <div class="font-bold text-sm text-white">${esc(archName(arch.id))}</div>
           <div class="text-xs text-t-muted uppercase">${L.position[arch.position.toLowerCase()] || arch.position}</div>
         </div>`
      : `<div class="text-sm text-t-muted">Select an archetype</div>`;
    $('#summary-bar').innerHTML = `
      <div class="flex items-center gap-2.5">${archInfo}</div>
      <div class="flex items-center gap-4">
        <div class="text-center leading-tight">
          <div class="text-xs text-t-muted uppercase">Height / Weight</div>
          <div class="font-bold text-sm text-white">${build.height}cm / ${build.weight}kg</div>
        </div>
        ${accel ? `<div class="text-center leading-tight"><div class="text-xs text-t-muted uppercase">AcceleRATE</div>${accel}</div>` : ''}
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-t-muted uppercase">LVL</span>
          <input id="level-input" type="number" min="1" max="${D.maxLevel}" value="${build.level}"
            class="w-14 px-2 py-1 bg-app-card border border-b-primary rounded text-lg font-bold text-white text-center focus:outline-none focus:ring-2 focus:ring-accent" />
          <button id="level-max" class="px-2 py-1 bg-btn-purple hover:bg-btn-purple-hover text-white rounded font-bold text-xs transition-colors">MAX</button>
        </div>
        <div class="text-center min-w-[54px] leading-none">
          <div class="text-xs text-t-muted uppercase mb-0.5">AP</div>
          <div class="text-xl font-bold ${apClass}" title="${d.ap.spent} / ${d.ap.total}">${d.ap.available}</div>
        </div>
        <div class="flex items-center gap-1">
          <button id="btn-undo" title="Undo (Ctrl/Cmd+Z)" ${undoDisabled ? 'disabled' : ''} class="px-2 py-1.5 rounded-lg font-bold text-xs transition-colors active:scale-95 ${undoDisabled ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}">UNDO</button>
          <button id="btn-redo" title="Redo (Ctrl/Cmd+Y)" ${redoDisabled ? 'disabled' : ''} class="px-2 py-1.5 rounded-lg font-bold text-xs transition-colors active:scale-95 ${redoDisabled ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}">REDO</button>
        </div>
        <button id="btn-reset" class="bg-btn-red hover:bg-btn-red-hover text-white border-2 border-btn-red-hover font-bold px-3 py-1.5 text-sm rounded-lg transition-all active:scale-95">RESET</button>
      </div>`;
  }
  const accelClass = (t) => t === 'EXPLOSIVE' ? 'bg-state-error/20 text-state-error'
    : t === 'LENGTHY' ? 'bg-state-info/20 text-state-info' : 'bg-state-success/20 text-state-success';

  // -------------------- archetype selection --------------------
  function renderArchetypes() {
    const filters = ['all', 'GK', 'DEF', 'MID', 'FWD'];
    $('#archetype-filters').innerHTML = filters.map((f) => {
      const label = f === 'all' ? 'All' : (L.position[f.toLowerCase() + '_shorten'] || f);
      const active = ui.filter === f;
      return `<button data-filter="${f}" class="px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors ${active ? 'bg-btn-blue text-white' : 'bg-app-panel text-t-muted hover:bg-app-card'}">${esc(label)}</button>`;
    }).join('');
    const list = D.archetypes.filter((a) => ui.filter === 'all' || a.position === ui.filter);
    $('#archetype-grid').innerHTML = list.map((a) => {
      const sel = build.archetypeId === a.id;
      return `
        <button data-arch="${a.id}" class="relative flex flex-col items-center gap-1.5 p-2 sm:p-3 rounded-xl border transition-all active:scale-95 ${sel ? 'bg-btn-blue border-state-info ring-2 ring-state-info shadow-lg' : 'bg-app-panel border-b-primary hover:bg-app-card hover:border-b-secondary'}">
          <img src="archetypes/${a.iconFileName}" alt="${esc(archName(a.id))}" class="w-11 h-11 sm:w-14 sm:h-14 object-contain ${sel ? 'drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]' : ''}" />
          <span class="text-[10px] sm:text-xs font-medium text-center leading-tight ${sel ? 'text-white' : 'text-t-muted'}">${esc(archName(a.id))}</span>
        </button>`;
    }).join('');
  }

  // -------------------- positions + overall --------------------
  function renderPositions(d) {
    const bar = $('#positions-bar');
    if (!d.arch) { bar.innerHTML = '<div class="text-sm text-t-muted">Select an archetype to set positions and overall.</div>'; return; }
    const availablePositions = d.arch.position === 'GK' ? ['GK'] : OUTFIELD_POSITIONS;
    const chips = availablePositions.map((p) => {
      const on = build.positions.includes(p);
      const automatic = d.arch.position === 'GK';
      const ovr = on ? C.overallForPosition(p, d) : null;
      return `<button data-pos="${p}" ${automatic ? 'disabled' : ''} title="${automatic ? 'Goalkeeper position is automatic' : on ? `${p}: estimated OVR ${ovr} (expected tolerance ±1)` : 'Add position'}" class="px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${on ? 'bg-btn-blue text-white' : 'bg-app-panel text-t-muted hover:bg-app-card'} ${automatic ? 'cursor-default' : ''}">${p}${on ? `<span class="px-1 rounded bg-black/30 text-[11px]">${ovr}</span>` : ''}</button>`;
    }).join('');
    let summary = '';
    if (build.positions.length) {
      const ovr = C.overallForPositions(build.positions, d);
      summary = `<div class="text-center leading-none" title="Estimate based on purchased attributes; expected tolerance ±1"><div class="text-[10px] text-t-muted uppercase mb-0.5">${build.positions.length > 1 ? 'Lowest Est. OVR' : 'Est. OVR'} <span class="normal-case">±1</span></div><div class="text-2xl font-bold text-accent-light">${ovr}</div></div>`;
    }
    bar.innerHTML = `
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-t-muted uppercase font-bold mr-1">Positions</span>${chips}
      </div>
      <div class="position-actions flex items-center gap-2">
        ${summary}
        <button id="btn-optimize" ${!build.positions.length ? 'disabled' : ''} class="px-3 py-2 rounded-lg font-bold text-sm transition-colors ${build.positions.length ? 'bg-btn-purple hover:bg-btn-purple-hover text-white' : 'bg-app-panel text-t-disabled cursor-not-allowed'}">⚡ Optimize Overall</button>
        <button id="btn-utplayers" class="px-3 py-2 rounded-lg font-bold text-sm transition-colors bg-app-panel hover:bg-app-card text-white border border-b-primary">Atletas UT</button>
        <button id="btn-maxsum" class="px-3 py-2 rounded-lg font-bold text-sm transition-colors bg-btn-blue hover:bg-btn-blue-hover text-white">Σ Max Sum</button>
      </div>`;
  }

  // -------------------- tabs (abrem modais) --------------------
  function renderTabs() {
    const tabs = [['playStyles', L.tabs.playStyles], ['specializations', L.tabs.specializations], ['facilities', L.tabs.facilities], ['body', L.tabs.body]];
    const disabled = !build.archetypeId;
    $('#tabs').innerHTML = tabs.map(([id, label]) =>
      `<button data-modal="${id}" ${disabled ? 'disabled' : ''} class="px-4 py-2 rounded-lg font-bold text-sm transition-colors ${disabled ? 'bg-app-panel text-t-disabled cursor-not-allowed' : 'bg-app-panel text-t-secondary hover:bg-btn-blue hover:text-white'}">${esc(label)}</button>`
    ).join('');
  }

  // -------------------- attributes grid --------------------
  function visibleCategories(d) {
    if (!d.arch) return d.categories;
    return d.arch.position === 'GK' ? d.categories : d.categories.filter((c) => c.id !== 'goalkeeping');
  }
  function renderAttributes(d) {
    if (!d.arch) {
      $('#attributes').innerHTML = `<div class="col-span-full bg-app-panel rounded-xl border border-b-primary p-10 text-center text-t-muted">Select an archetype above to start building.</div>`;
      return;
    }
    $('#attributes').innerHTML = visibleCategories(d).map((cat) => `
      <div class="bg-app-panel rounded-xl border border-b-primary overflow-hidden self-start">
        <div class="w-full p-4 flex items-center justify-between min-h-[52px]">
          <h2 class="text-base font-bold text-t-secondary tracking-wide">${esc(catName(cat.id))}</h2>
        </div>
        <div class="px-3 pb-3 space-y-1.5">${cat.attributes.map((a) => attributeRow(a, d)).join('')}</div>
      </div>`).join('');
  }
  function attributeRow(a, d) {
    const body = d.bodyAdj[a.id] || 0, fac = d.facAdj[a.id] || 0, cv = a.currentValue;
    const width = ((cv - 1) / 98) * 100, color = C.barColor(cv);
    const selected = ui.selectedAttr === a.id;
    const tag = (v) => v === 0 ? '' : `<span class="font-bold text-sm min-w-3 ${v < 0 ? 'text-state-error' : 'text-state-success'}">${v > 0 ? '+' : ''}${v}</span>`;
    const nameEl = a.isKeyAttribute
      ? `<span class="text-accent-light text-sm font-medium">${esc(attrName(a.id))}</span><span class="text-accent-light text-sm">★</span>`
      : `<span class="text-sm font-medium text-t-secondary">${esc(attrName(a.id))}</span>`;
    return `
      <div data-attr="${a.id}" class="p-2.5 rounded-lg min-h-[54px] flex flex-col justify-center cursor-pointer transition-all ${selected ? 'bg-b-primary ring-2 ring-[#6366f1]' : 'hover:bg-app-card active:bg-b-primary'}">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-2">${nameEl}</div>
          <div class="flex items-center gap-1.5">${tag(body)}${tag(fac)}<span class="text-base font-bold text-white ml-auto">${cv}</span></div>
        </div>
        <div class="w-full h-3 bg-app-card rounded-full overflow-hidden border border-b-primary">
          <div class="h-full rounded-full transition-all duration-300" style="width:${width}%;background-color:${color}"></div>
        </div>
      </div>`;
  }

  // -------------------- painel de detalhe do atributo (direita, sempre) --------------------
  const placeholder = (msg) => `<div class="p-6 h-full flex items-center justify-center min-h-[300px]"><p class="text-t-disabled text-sm text-center">${esc(msg)}</p></div>`;
  const panelHead = (title) => `<div class="p-4 border-b border-b-primary"><h3 class="font-bold text-t-secondary tracking-wide">${esc(title)}</h3></div>`;
  function renderDetailPanel(d) {
    const panel = $('#panel');
    if (!d.arch) { panel.innerHTML = placeholder('Select an archetype to begin.'); return; }
    if (ui.selectedAttr) { panel.innerHTML = attrEditor(d); return; }
    panel.innerHTML = placeholder('Select an attribute to view details.');
  }
  function attrEditor(d) {
    let attr = C.findAttr(d.categories, ui.selectedAttr);
    if (!attr) return placeholder('Select an attribute.');
    const body = d.bodyAdj[attr.id] || 0, fac = d.facAdj[attr.id] || 0, eff = d.effective[attr.id];
    const nextCost = C.apCostNextPoint(attr);
    const atMax = attr.currentValue >= attr.maxValue, atMin = attr.currentValue <= attr.baseValue;
    const canAfford = nextCost != null && d.ap.available >= nextCost;
    const adj = (label, v) => `<div class="flex justify-between text-sm"><span class="text-t-muted">${label}</span><span class="font-bold ${v < 0 ? 'text-state-error' : v > 0 ? 'text-state-success' : 'text-t-secondary'}">${v > 0 ? '+' : ''}${v}</span></div>`;
    return `
      ${panelHead(attrName(attr.id) + (attr.isKeyAttribute ? ' ★' : ''))}
      <div class="p-4 space-y-4">
        <div class="flex items-end justify-between">
          <div><div class="text-xs text-t-muted uppercase">Current</div><div class="text-4xl font-bold" style="color:${C.barColor(attr.currentValue)}">${attr.currentValue}</div></div>
          <div class="text-right text-sm text-t-muted"><div>Base ${attr.baseValue}</div><div>Max ${attr.maxValue}</div><div class="uppercase text-xs mt-1">tier ${attr.tier.replace('tier', '').replace('star', '★')}</div></div>
        </div>
        <div class="flex items-center gap-2">
          <button data-attr-dec class="flex-1 py-2 rounded-lg font-bold ${atMin ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}" ${atMin ? 'disabled' : ''}>−</button>
          <input data-attr-range type="range" min="${attr.baseValue}" max="${attr.maxValue}" value="${attr.currentValue}" class="flex-[3] accent-btn-blue" />
          <button data-attr-inc class="flex-1 py-2 rounded-lg font-bold ${atMax || !canAfford ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-btn-blue hover:bg-btn-blue-hover text-white'}" ${atMax || !canAfford ? 'disabled' : ''}>+</button>
        </div>
        <div class="text-center text-xs ${!atMax && !canAfford ? 'text-state-error' : 'text-t-muted'}">${atMax ? 'At maximum' : !canAfford ? `Not enough AP (need ${nextCost})` : `Next +1 costs <span class="font-bold text-accent-light">${nextCost} AP</span>`}</div>
        <div class="flex gap-2">
          <button data-attr-base class="flex-1 py-1.5 text-xs rounded-lg bg-app-card hover:bg-b-primary text-t-secondary font-bold">Reset to base</button>
          <button data-attr-maximize class="flex-1 py-1.5 text-xs rounded-lg bg-app-card hover:bg-b-primary text-t-secondary font-bold">Max out</button>
        </div>
        <div class="bg-app-bg rounded-lg p-3 space-y-1.5 border border-b-primary">
          ${adj('Body', body)}${adj('Facilities', fac)}
          <div class="flex justify-between text-sm border-t border-b-primary pt-1.5 mt-1.5"><span class="text-t-secondary font-medium">Effective</span><span class="font-bold text-white">${eff}</span></div>
        </div>
      </div>`;
  }

  // ==================== MODAIS ====================
  function modalShell(title, bodyHtml) {
    return `
      <div class="flex items-center justify-between p-4 sm:p-5 border-b border-b-primary flex-shrink-0">
        <h2 class="text-xl sm:text-2xl font-bold text-white tracking-wider uppercase">${esc(title)}</h2>
        <button data-modal-close class="w-9 h-9 flex items-center justify-center rounded-lg bg-app-card hover:bg-b-primary text-t-muted text-lg transition-colors">✕</button>
      </div>
      <div class="overflow-y-auto p-4 sm:p-6">${bodyHtml}</div>`;
  }
  function renderModal(d) {
    const root = $('#modal-root'), box = $('#modal-box');
    if (!ui.modal || !d.arch) { root.classList.add('hidden'); root.classList.remove('flex'); box.innerHTML = ''; return; }
    let title = '', body = '';
    if (ui.modal === 'body') { title = L.tabs.body; body = bodyModal(d); }
    else if (ui.modal === 'playStyles') { title = L.tabs.playStyles; body = playStylesModal(d); }
    else if (ui.modal === 'specializations') { title = L.tabs.specializations; body = specializationsModal(d); }
    else if (ui.modal === 'facilities') { title = L.tabs.facilities; body = facilitiesModal(d); }
    else if (ui.modal === 'optimize') { title = 'Optimize Overall'; body = optimizeModal(d); }
    else if (ui.modal === 'maxsum') { title = 'Maximize Attribute Sum'; body = maxSumModal(d); }
    else if (ui.modal === 'utplayers') { title = 'Atletas UT'; body = utPlayersModal(d); }
    box.innerHTML = modalShell(title, body);
    root.classList.remove('hidden'); root.classList.add('flex');
  }

  // ---- Body modal ----
  function bodyModal(d) {
    const a = d.arch;
    const affected = a.position === 'GK' ? D.gkAffectedAttributes : D.affectedAttributes;
    const slider = (kind, label, value, min, max, unit) => `
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium text-t-secondary">${esc(label)}</span>
          <span class="font-bold text-white"><span data-readout="${kind}">${value}</span> ${unit}</span>
        </div>
        <input data-body="${kind}" type="range" min="${min}" max="${max}" value="${value}" class="w-full accent-btn-blue" />
        <div class="flex justify-between text-[10px] text-t-disabled mt-0.5"><span>${min}</span><span>${max}</span></div>
      </div>`;
    const affRow = (id) => { const v = d.bodyAdj[id] || 0, cv = C.curVal(d.categories, id), eff = d.effective[id]; const width = ((eff - 1) / 98) * 100;
      return `<div class="bg-app-bg rounded-lg p-2.5 border border-b-primary">
        <div class="flex items-center justify-between mb-1"><span class="text-sm ${v !== 0 ? 'text-accent-light' : 'text-t-secondary'}">${esc(attrName(id))}</span>
        <span class="flex items-center gap-1.5">${v !== 0 ? `<span class="text-xs font-bold ${v < 0 ? 'text-state-error' : 'text-state-success'}">${v > 0 ? '+' : ''}${v}</span>` : ''}<span class="font-bold text-white">${eff}</span></span></div>
        <div class="w-full h-2 bg-app-card rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${width}%;background-color:${C.barColor(eff)}"></div></div></div>`; };
    return `
      <div class="grid md:grid-cols-2 gap-5">
        <div class="space-y-5">
          ${slider('height', L.body.height, build.height, Math.ceil(a.minHeight), Math.floor(a.maxHeight), 'cm')}
          ${slider('weight', L.body.weight, build.weight, Math.ceil(a.minWeight), Math.floor(a.maxWeight), 'kg')}
          ${d.accel ? `<div class="bg-app-card rounded-lg p-3 border border-b-primary flex items-center justify-between"><span class="text-sm text-t-muted">${esc(L.body.accel_type)}</span><span id="accel-badge" class="px-2 py-0.5 rounded text-xs font-bold ${accelClass(d.accel)}">${d.accel}</span></div>` : ''}
        </div>
        <div>
          <div class="text-xs text-t-muted uppercase mb-2 font-bold">${esc(L.body.affected_attributes)}</div>
          <div id="body-affected" class="space-y-2">${affected.map(affRow).join('')}</div>
        </div>
      </div>`;
  }

  // ---- PlayStyles modal ----
  function playStylesModal(d) {
    const sigs = C.signatureSlots(build, d.categories);
    const unlocks = d.facilities.unlocks;

    // SIGNATURE (4 slots)
    const sigCell = (s) => {
      const id = s.playStyleId; if (!id) return '';
      const icon = `${s.isPlus ? 'playstyles/plus/' : 'playstyles/'}${psIcon(id)}`;
      return `<div class="bg-app-bg border ${s.specialization ? 'border-feat-special' : 'border-b-primary'} rounded-xl p-3 flex flex-col items-center gap-1.5 relative">
        ${s.specialization ? '<span class="absolute top-1 right-1 text-[9px] px-1 rounded bg-feat-special text-white font-bold">SPEC</span>' : ''}
        <img src="${icon}" alt="" class="w-12 h-12 object-contain" />
        <span class="text-xs text-center text-t-secondary font-medium leading-tight">${esc(psName(id))}${s.isPlus ? '+' : ''}</span>
        <span class="text-[9px] text-t-disabled">${s.isPlus ? 'PLAYSTYLE+' : 'Lvl ' + s.plusLevel + ' for +'}</span>
      </div>`;
    };

    // PLAYSTYLES (9 slots por nível) + lista de elegíveis
    const unlockedSlotCount = D.slotUnlockLevels.filter((level) => build.level >= level).length;
    const slotCells = D.slotUnlockLevels.map((lvl, i) => {
      const unlocked = build.level >= lvl;
      const id = build.playstyles[i];
      if (id) { const icon = `playstyles/${psIcon(id)}`;
        return `<div class="bg-btn-blue/20 border border-state-info rounded-xl p-2 flex flex-col items-center gap-1"><img src="${icon}" class="w-9 h-9 object-contain" /><span class="text-[10px] text-center text-white leading-tight">${esc(psName(id))}</span></div>`; }
      if (unlocked) return `<div class="bg-app-bg border border-dashed border-b-secondary rounded-xl p-2 flex flex-col items-center justify-center min-h-[64px] text-t-muted"><span class="text-2xl leading-none">+</span><span class="text-[9px]">${esc(L.playStyles.slot)}</span></div>`;
      return `<div class="bg-app-bg/40 border border-b-primary rounded-xl p-2 flex flex-col items-center justify-center min-h-[64px] text-t-disabled"><span>🔒</span><span class="text-[9px]">Lvl ${lvl}</span></div>`;
    }).join('');

    const equippedCount = build.playstyles.length;
    const byCat = {};
    D.playstyles.forEach((p) => { (byCat[p.category] = byCat[p.category] || []).push(p); });
    const psPick = (p) => {
      const automatic = unlocks.has(p.id);
      const eligible = C.playstyleEligible(p, d.purchased, unlocks);
      const on = build.playstyles.includes(p.id);
      const canAdd = equippedCount < unlockedSlotCount;
      const canToggle = on || (!automatic && eligible && canAdd);
      const unlockPlan = C.requirementUnlockPlan(p, d.categories);
      const canAffordUnlock = unlockPlan.feasible && unlockPlan.cost <= d.ap.available;
      const reqText = (p.requirements || []).map((r) => `${attrName(r.attributeId)} ${r.minValue}`).join(' · ');
      let action = '';
      if (automatic) {
        action = '<span class="px-2 text-[9px] font-bold text-state-success">FAC</span>';
      } else if (on) {
        action = '<span class="px-2 text-[9px] font-bold text-state-info">EQUIPPED</span>';
      } else if (eligible && !canAdd) {
        action = '<span class="px-2 text-[9px] font-bold text-t-disabled">SLOTS FULL</span>';
      } else if (!eligible && !unlockPlan.feasible) {
        action = '<span class="px-2 text-[9px] font-bold text-state-error">UNAVAILABLE</span>';
      } else if (!eligible && !canAdd) {
        action = '<span class="px-2 text-[9px] font-bold text-t-disabled">SLOTS FULL</span>';
      } else if (!eligible) {
        action = `<button data-ps-unlock="${p.id}" data-cost="${unlockPlan.cost}" ${canAffordUnlock ? '' : 'disabled'} title="${canAffordUnlock ? `Raise requirements and equip ${esc(psName(p.id))}` : `Need ${unlockPlan.cost} AP`}" class="flex-shrink-0 px-2 py-1.5 rounded-md text-[9px] leading-tight font-bold ${canAffordUnlock ? 'bg-btn-purple hover:bg-btn-purple-hover text-white' : 'bg-app-card text-t-disabled cursor-not-allowed'}"><span class="hidden sm:inline">QUICK </span>UNLOCK<br><span>${unlockPlan.cost} AP</span></button>`;
      } else {
        action = '<span class="px-2 text-[9px] font-bold text-state-success">READY</span>';
      }
      return `<div class="flex items-center gap-1 rounded-lg border transition-all ${on ? 'bg-btn-blue/20 border-state-info' : automatic ? 'bg-state-success/10 border-state-success/40' : eligible ? 'bg-app-bg border-b-primary' : 'bg-app-bg/60 border-b-primary'}">
        <button data-ps="${p.id}" ${canToggle ? '' : 'disabled'} class="min-w-0 flex-1 text-left flex items-center gap-2 p-2 rounded-lg ${canToggle ? 'hover:bg-app-card' : 'cursor-default'}">
          <img src="playstyles/${p.iconFileName}" class="w-7 h-7 object-contain flex-shrink-0 ${!eligible && !on ? 'grayscale opacity-60' : ''}" />
          <span class="min-w-0"><span class="block text-xs font-bold ${on ? 'text-white' : 'text-t-secondary'} truncate">${esc(psName(p.id))}</span><span class="block text-[9px] text-t-muted truncate">${esc(reqText)}</span></span>
        </button>
        ${action}
      </div>`;
    };

    const facList = [...unlocks];
    return `
      <div class="space-y-6">
        <div>
          <h3 class="text-accent-light font-bold tracking-wider mb-3">${esc(L.playStyles.signature)}</h3>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">${sigs.map(sigCell).join('')}</div>
          <p class="text-[11px] text-t-disabled mt-2">Replace a signature slot in the Specializations tab.</p>
        </div>
        <div>
          <div class="flex items-center justify-between mb-3"><h3 class="text-white font-bold tracking-wider">${esc(L.playStyles.available)}</h3><span class="text-sm ${equippedCount > unlockedSlotCount ? 'text-state-error' : 'text-t-muted'}">${equippedCount} / ${unlockedSlotCount}</span></div>
          <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-4">${slotCells}</div>
          <div class="space-y-3 max-h-[34vh] overflow-y-auto pr-1">
            ${Object.keys(byCat).map((cat) => `<div><div class="text-[11px] text-t-muted uppercase mb-1.5 font-bold">${esc(catName(cat))}</div><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5">${byCat[cat].map(psPick).join('')}</div></div>`).join('')}
          </div>
        </div>
        <div>
          <h3 class="text-white font-bold tracking-wider mb-2 text-center text-sm">CLUB FACILITIES PLAYSTYLES</h3>
          ${facList.length
            ? `<div class="grid grid-cols-3 sm:grid-cols-5 gap-2">${facList.map((id) => `<div class="bg-app-bg border border-state-success/40 rounded-lg p-2 flex flex-col items-center gap-1"><img src="playstyles/${psIcon(id)}" class="w-8 h-8 object-contain" /><span class="text-[10px] text-center text-t-secondary leading-tight">${esc(psName(id))}</span></div>`).join('')}</div>`
            : `<p class="text-center text-xs text-t-disabled uppercase tracking-wide py-3">No additional playstyles</p>`}
        </div>
      </div>`;
  }

  // ---- Specializations modal ----
  function specializationsModal(d) {
    const specs = C.archetypeSpecializations(build.archetypeId);
    if (!specs.length) return `<p class="text-center text-t-muted py-8">No specializations for this archetype.</p>`;
    const sigs = build.signatures || {};
    const card = (sp) => {
      const unlocked = C.specializationUnlocked(sp, d.categories);
      const unlockPlan = C.requirementUnlockPlan(sp, d.categories);
      const cost = unlockPlan.cost;
      const assignedSlot = Object.keys(sigs).find((k) => sigs[k] === sp.id);
      const reqRows = sp.requirements.map((r) => {
        const cur = C.curVal(d.categories, r.attributeId), met = cur >= r.minValue;
        return `<div class="flex items-center justify-between text-sm rounded px-2.5 py-1.5 ${met ? 'bg-state-success/20' : 'bg-state-error/20'}">
          <span class="${met ? 'text-state-success' : 'text-t-secondary'}">${esc(attrName(r.attributeId))}</span>
          <span class="font-bold ${met ? 'text-state-success' : 'text-state-error'}">${cur} / ${r.minValue}</span></div>`;
      }).join('');
      const slotBtns = [0, 1, 2, 3].map((slot) =>
        `<button data-spec-assign="${sp.id}" data-slot="${slot}" class="flex-1 py-1.5 text-xs rounded font-bold transition-colors ${String(slot) === assignedSlot ? 'bg-feat-special text-white' : 'bg-app-card hover:bg-b-primary text-t-secondary'}">${slot + 1}</button>`).join('');
      return `
        <div class="bg-app-bg border ${unlocked ? 'border-feat-special/60' : 'border-b-primary'} rounded-xl p-4 space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div><div class="font-bold text-white">${esc(sp.name)}</div>
              <div class="flex items-center gap-1.5 mt-0.5"><img src="playstyles/plus/${psIcon(sp.playStyleId)}" class="w-5 h-5 object-contain" /><span class="text-xs text-accent-light font-medium">${esc(psName(sp.playStyleId))}+</span></div></div>
            <span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase ${unlocked ? 'bg-state-success/20 text-state-success' : 'bg-app-card text-t-disabled'}">${unlocked ? 'Unlocked' : 'Locked'}</span>
          </div>
          <p class="text-[11px] text-t-muted leading-snug">${esc(sp.description)}</p>
          <div class="space-y-1">${reqRows}</div>
          ${unlocked
            ? `<div><div class="text-[10px] text-t-muted uppercase mb-1">${esc(L.specializations.replaceAvailable)} → slot</div><div class="flex gap-1.5">${slotBtns}${assignedSlot !== undefined ? `<button data-spec-revert="${sp.id}" class="px-2 py-1.5 text-xs rounded bg-app-card hover:bg-b-primary text-t-muted">✕</button>` : ''}</div></div>`
            : unlockPlan.feasible
              ? `<button data-spec-unlock="${sp.id}" class="w-full py-2 rounded-lg bg-btn-purple hover:bg-btn-purple-hover text-white font-bold text-sm">${esc(L.common.quickUnlock)} (${cost} AP)</button>`
              : '<button disabled class="w-full py-2 rounded-lg bg-app-card text-t-disabled font-bold text-sm cursor-not-allowed">Unavailable for this archetype</button>'}
        </div>`;
    };
    return `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">${specs.map(card).join('')}</div>`;
  }

  // ---- Facilities modal ----
  function facilitiesModal(d) {
    const remaining = d.facilities.budget - d.facilities.cost;
    const remClass = remaining < 0 ? 'text-state-error' : 'text-state-success';
    const clubOpts = Object.keys(D.clubLevelBudgets).map((l) => `<option value="${l}" ${+l === build.clubLevel ? 'selected' : ''}>Club Lv ${l}</option>`).join('');
    const kind = ui.facilityKind === 'ai' ? 'ai' : 'player';
    const definitions = kind === 'ai' ? D.aiFacilities : D.facilities;
    const selectedFacilities = kind === 'ai' ? build.aiFacilities : build.facilities;
    const facCard = (f) => {
      const star = selectedFacilities[f.id] || 0;
      const affected = (f.affectedAttributes || []).map(attrName).join(', ');
      const maxStar = f.levels.length - 1;
      const stars = [];
      for (let i = 0; i <= maxStar; i++) {
        const lv = f.levels[i];
        const wouldCost = lv.cost - (f.levels[star] ? f.levels[star].cost : 0);
        const over = i > star && wouldCost > remaining;
        stars.push(`<button data-fac="${f.id}" data-fac-kind="${kind}" data-star="${i}" ${over ? 'disabled' : ''} class="px-2 py-1 rounded text-xs font-bold transition-colors ${i === star ? 'bg-btn-blue text-white' : over ? 'bg-app-bg text-t-disabled cursor-not-allowed' : 'bg-app-bg text-t-muted hover:bg-app-card'}">${i === 0 ? '—' : '★'.repeat(i)}</button>`);
      }
      const unlocked = kind === 'player' && f.levels[star] && f.levels[star].playstyle;
      return `
        <div class="bg-app-bg rounded-lg p-3 border ${star > 0 ? 'border-state-info/40' : 'border-b-primary'}">
          <div class="flex items-center justify-between mb-1"><span class="text-sm font-bold text-t-secondary">${esc(f.name)}</span><span class="text-xs text-t-muted">${f.levels[star] ? f.levels[star].cost : 0}</span></div>
          <div class="text-[10px] text-t-muted mb-2 truncate" title="${esc(affected)}">${esc(affected || (kind === 'ai' ? 'AI teammates' : 'Player facility'))}</div>
          <div class="flex items-center gap-1">${stars.join('')}</div>
          ${unlocked ? `<div class="text-[10px] text-state-success mt-1.5">${esc(L.facilities.additionalPlaystyle)}: ${esc(psName(unlocked))}</div>` : ''}
        </div>`;
    };
    return `
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2 sticky top-0 bg-app-bg pb-2">
          <div class="flex items-center gap-2">
            <select id="club-level" class="bg-app-card border border-b-primary rounded px-2 py-1.5 text-sm text-white focus:outline-none">${clubOpts}</select>
            <div class="flex p-0.5 rounded-lg bg-app-card border border-b-primary">
              <button data-fac-view="player" class="px-3 py-1 rounded-md text-xs font-bold ${kind === 'player' ? 'bg-btn-blue text-white' : 'text-t-muted hover:text-white'}">Player</button>
              <button data-fac-view="ai" class="px-3 py-1 rounded-md text-xs font-bold ${kind === 'ai' ? 'bg-btn-blue text-white' : 'text-t-muted hover:text-white'}">AI</button>
            </div>
          </div>
          <div class="text-right leading-tight"><div class="text-xs text-t-muted uppercase">${esc(L.facilities.remainingBudget)}</div><div class="font-bold ${remClass}">${remaining} <span class="text-t-disabled text-xs">/ ${d.facilities.budget}</span></div><div class="text-[9px] text-t-disabled">Player ${d.facilities.playerCost} · AI ${d.facilities.aiCost}</div></div>
        </div>
        ${kind === 'ai' ? '<p class="text-[11px] text-t-muted">AI Facilities share the club budget and affect AI teammates only.</p>' : ''}
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">${definitions.map(facCard).join('')}</div>
      </div>`;
  }

  // ---- Optimize modal ----
  function optimizeModal(d) {
    const remaining = Math.max(0, d.ap.total - d.ap.spent);
    const multi = build.positions.length > 1;
    const posText = build.positions.map((position) => `${position} ${C.overallForPosition(position, d)}`).join(' · ');
    const considered = [];
    for (const c of d.categories) for (const a of c.attributes) {
      const relevant = build.positions.some((position) => C.pesoFor(position, a.id) > 0);
      if (relevant) considered.push(a.id);
    }
    const chip = (id) => {
      const off = build.disabledAttrs.includes(id);
      return `<button data-disable-attr="${id}" class="opt-chip ${off ? 'opt-attr-off' : ''}">${esc(attrName(id))}</button>`;
    };
    return `
      <div class="space-y-5 max-w-2xl">
        <div class="text-sm text-t-muted">Positions: <span class="text-white font-bold">${esc(posText)}</span>${multi ? ' <span class="text-[11px] text-feat-special">· optimizer maximizes the lowest listed-position OVR</span>' : ''}</div>
        <div class="space-y-3">
          <label class="block bg-app-bg border border-b-primary rounded-xl p-3 cursor-pointer">
            <div class="flex items-center gap-2 mb-2"><input type="radio" name="opt-mode" value="max" checked class="accent-btn-blue" /><span class="font-bold text-white">${multi ? 'Maximize lowest overall' : 'Maximize overall'} — given AP</span></div>
            <div class="flex items-center gap-2 pl-6"><span class="text-sm text-t-muted">Additional AP to spend:</span>
              <input id="opt-ap" type="number" min="0" value="${remaining}" class="w-28 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center focus:outline-none" /></div>
            <div class="text-[11px] text-t-disabled pl-6 mt-1">You have ${remaining} AP remaining at level ${build.level}.</div>
          </label>
          <label class="block bg-app-bg border border-b-primary rounded-xl p-3 cursor-pointer">
            <div class="flex items-center gap-2 mb-2"><input type="radio" name="opt-mode" value="min" class="accent-btn-blue" /><span class="font-bold text-white">Minimum AP — given overall</span></div>
            <div class="flex items-center gap-2 pl-6"><span class="text-sm text-t-muted">Target overall${multi ? ' (selected position set)' : ''}:</span>
              <input id="opt-ovr" type="number" min="1" max="99" value="85" class="w-20 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center focus:outline-none" /></div>
          </label>
        </div>
        <div>
          <div class="text-xs text-t-muted uppercase font-bold mb-2">Attributes to optimize <span class="text-t-disabled normal-case font-normal">— click to exclude (the optimizer won't raise them)</span></div>
          <div class="flex flex-wrap gap-1.5">${considered.length ? considered.map(chip).join('') : '<span class="text-sm text-t-disabled">No relevant attributes for the selected position(s).</span>'}</div>
        </div>
        <div class="flex gap-2">
          <button id="opt-run" ${ui.optimizing ? 'disabled' : ''} class="flex-1 py-2.5 rounded-lg ${ui.optimizing ? 'bg-app-card text-t-disabled cursor-wait' : 'bg-btn-blue hover:bg-btn-blue-hover text-white'} font-bold">${ui.optimizing ? 'Optimizing…' : 'Run &amp; Apply'}</button>
          <button data-modal-close class="px-4 py-2.5 rounded-lg bg-app-card hover:bg-b-primary text-t-muted font-bold">Cancel</button>
        </div>
        <p class="text-[11px] text-t-disabled">Keeps already-evolved attributes as a floor (only raises). Excluded attributes still count toward the overall at their current value. AP costs use this archetype's per-attribute tiers.</p>
      </div>`;
  }
  async function runOptimize() {
    if (ui.optimizing) return;
    const modeEl = document.querySelector('input[name=opt-mode]:checked');
    const mode = modeEl ? modeEl.value : 'max';
    const d = C.derive(build);
    const sourceBuild = cloneBuild();
    const remaining = Math.max(0, d.ap.total - d.ap.spent);
    const opts = { positions: build.positions.slice(), mode, disabled: build.disabledAttrs.slice() };
    if (mode === 'max') opts.additionalAP = Math.min(remaining, Math.max(0, parseInt(($('#opt-ap') || {}).value || '0', 10)));
    else opts.targetOverall = C.clamp(parseInt(($('#opt-ovr') || {}).value || '1', 10), 1, 99);
    const runId = ++ui.optimizeRunId;
    const controller = new AbortController();
    ui.optimizeController = controller;
    opts.signal = controller.signal;
    ui.optimizing = true;
    const button = $('#opt-run');
    if (button) { button.disabled = true; button.textContent = 'Optimizing…'; }
    let res;
    try {
      res = await C.optimize(d, opts);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.error(error);
      if (runId !== ui.optimizeRunId) return;
      ui.optimizing = false;
      ui.optimizeController = null;
      if (button) { button.disabled = false; button.textContent = 'Run & Apply'; }
      return toast('Optimizer failed. No changes were applied.');
    }
    if (runId !== ui.optimizeRunId) return;
    ui.optimizing = false;
    ui.optimizeController = null;
    if (button) { button.disabled = false; button.textContent = 'Run & Apply'; }
    if (!sameBuild(sourceBuild, build)) return toast('Build changed while optimizing. Run it again.');
    const proof = res.status === 'optimal' ? 'optimal' : 'best found';
    let msg;
    if (mode === 'max') {
      msg = `${build.positions.length > 1 ? 'Lowest Est. OVR' : 'Est. OVR'} → ${res.overall} · spent ${res.spent} AP · ${proof}`;
    } else {
      msg = res.feasible
        ? `Est. OVR ${opts.targetOverall} reached · needs ${res.spent} AP${res.spent > remaining ? ` (over budget by ${res.spent - remaining} — raise level)` : ''} · ${proof}`
        : `Target ${opts.targetOverall} unreachable; best is OVR ${res.overall}`;
    }
    if (!res.feasible || res.spent > remaining) return toast(msg);
    commitBuildChange(() => {
      for (const id in res.values) {
        const a = C.findAttr(d.categories, id);
        if (!a) continue;
        if (res.values[id] <= a.baseValue) delete build.attributes[id];
        else build.attributes[id] = res.values[id];
      }
      ui.modal = null;
      ui.selectedAttr = null;
    }, { render: false });
    render();
    toast(msg);
  }

  // ---- Maximize attribute sum modal ----
  function sumConsidered(d) {
    // atributos numéricos das categorias VISÍVEIS (exclui goalkeeping p/ linha e skill/weak stars)
    const ids = [];
    for (const c of visibleCategories(d)) for (const a of c.attributes) {
      if (!String(a.tier).startsWith('star')) ids.push(a.id);
    }
    return ids;
  }
  function maxSumModal(d) {
    const remaining = Math.max(0, d.ap.total - d.ap.spent);
    const considered = sumConsidered(d);
    const chip = (id) => {
      const off = build.sumExcluded.includes(id);
      return `<button data-sum-attr="${id}" class="opt-chip ${off ? 'opt-attr-off' : ''}">${esc(attrName(id))}</button>`;
    };
    const included = considered.filter((id) => !build.sumExcluded.includes(id)).length;
    return `
      <div class="space-y-5 max-w-2xl">
        <p class="text-sm text-t-muted">Distributes AP to <span class="text-white font-bold">maximize the total</span> of the chosen attributes — buys the cheapest points first (each archetype has its own per-attribute AP costs).</p>
        <div class="flex items-center gap-2">
          <span class="text-sm text-t-secondary font-medium">AP to spend:</span>
          <input id="sum-ap" type="number" min="0" value="${remaining}" class="w-28 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center focus:outline-none" />
          <span class="text-[11px] text-t-disabled">${remaining} remaining at level ${build.level}</span>
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs text-t-muted uppercase font-bold">Attributes to include <span id="sum-count" class="text-t-disabled normal-case font-normal">(${included} selected)</span></div>
            <div class="flex gap-1.5"><button id="sum-all" class="px-2 py-0.5 text-[11px] rounded bg-app-card hover:bg-b-primary text-t-secondary font-bold">All</button><button id="sum-none" class="px-2 py-0.5 text-[11px] rounded bg-app-card hover:bg-b-primary text-t-secondary font-bold">None</button></div>
          </div>
          <div class="flex flex-wrap gap-1.5">${considered.map(chip).join('')}</div>
        </div>
        <div class="flex gap-2">
          <button id="sum-run" class="flex-1 py-2.5 rounded-lg bg-btn-blue hover:bg-btn-blue-hover text-white font-bold">Run &amp; Apply</button>
          <button data-modal-close class="px-4 py-2.5 rounded-lg bg-app-card hover:bg-b-primary text-t-muted font-bold">Cancel</button>
        </div>
        <p class="text-[11px] text-t-disabled">Keeps already-evolved attributes as a floor (only raises). Unselected attributes are left untouched.</p>
      </div>`;
  }
  function runMaxSum() {
    const d = C.derive(build);
    const budget = Math.min(Math.max(0, d.ap.available), Math.max(0, parseInt(($('#sum-ap') || {}).value || '0', 10)));
    const include = sumConsidered(d).filter((id) => !build.sumExcluded.includes(id));
    if (!include.length) return toast('Select at least one attribute.');
    const res = C.maximizeSum(d, { include, budget });
    commitBuildChange(() => {
      for (const id in res.values) {
        const a = C.findAttr(d.categories, id);
        if (!a) continue;
        if (res.values[id] <= a.baseValue) delete build.attributes[id]; else build.attributes[id] = res.values[id];
      }
      ui.modal = null;
      ui.selectedAttr = null;
    }, { render: false });
    render();
    toast(`Sum → ${res.sum} (+${res.points} pts) · spent ${res.added} AP`);
  }
  function updateSumCount() {
    const el = $('#sum-count'); if (!el) return;
    const n = sumConsidered(C.derive(build)).filter((id) => !build.sumExcluded.includes(id)).length;
    el.textContent = `(${n} selected)`;
  }

  // ---- UT players modal ----
  function ensureUtPlayers() {
    if (ui.utPlayers || ui.utLoading) return;
    ui.utLoading = true; ui.utError = null;
    fetch('data/ut_players_80.json')
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((rows) => { ui.utPlayers = rows; })
      .catch((e) => { ui.utError = e.message || 'Failed to load players.'; })
      .finally(() => { ui.utLoading = false; if (ui.modal === 'utplayers') render(); });
  }
  const utImage = (p) => p.cardImagePath ? `https://game-assets.fut.gg/${p.cardImagePath}` : '';
  function utCost(player, d) {
    return d.arch ? C.targetPlan(d, player.attributes) : { cost: 0, capped: 0, values: {} };
  }
  function utBuildable(player, d) {
    const c = utCost(player, d);
    return { ...c, buildable: c.cost <= d.ap.total };
  }
  function utPlayersModal(d) {
    ensureUtPlayers();
    if (ui.utLoading) return `<div class="p-8 text-center text-t-muted">Loading UT athletes...</div>`;
    if (ui.utError) return `<div class="p-8 text-center text-state-error">Could not load UT athletes: ${esc(ui.utError)}</div>`;
    const rows = ui.utPlayers || [];
    const q = ui.utQuery.trim().toLowerCase();
    const filtered = q
      ? rows.filter((p) => p.name.toLowerCase().includes(q) || p.positions.join(' ').toLowerCase().includes(q) || String(p.overall) === q)
      : rows;
    const totalAP = d.ap.total;
    const card = (p) => {
      const info = utBuildable(p, d);
      const status = `${info.cost} AP${info.capped ? ` · cap ${info.capped}` : ''}`;
      const stateClass = info.buildable ? 'ut-card-buildable' : 'ut-card-locked';
      return `
        <button data-ut-player="${p.id}" ${info.buildable ? '' : 'disabled'} class="ut-card ${stateClass}">
          <div class="ut-card-img">${p.cardImagePath ? `<img loading="lazy" src="${esc(utImage(p))}" alt="" />` : ''}</div>
          <span class="ut-ovr">${p.overall}</span>
          <div class="ut-card-main">
            <span class="ut-name">${esc(p.name)}</span>
          </div>
          <div class="ut-pos">${esc(p.positions.join(' / '))}</div>
          <div class="ut-cost ${info.buildable ? 'text-state-success' : 'text-t-disabled'}">${esc(status)}</div>
        </button>`;
    };
    const buildableCount = filtered.reduce((n, p) => n + (utBuildable(p, d).buildable ? 1 : 0), 0);
    return `
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="text-sm text-t-muted">Showing <span class="text-white font-bold">${filtered.length}</span> athletes 80+ · buildable with level ${build.level}: <span class="text-state-success font-bold">${buildableCount}</span> · AP total <span class="text-white font-bold">${totalAP}</span></div>
          <input id="ut-search" type="search" value="${esc(ui.utQuery)}" placeholder="Search name, position, OVR"
            class="w-full sm:w-72 px-3 py-2 bg-app-card border border-b-primary rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div class="ut-list-head"><span></span><span>OVR</span><span>Player</span><span>Pos</span><span>Cost</span></div>
        <div class="ut-list">${filtered.map(card).join('')}</div>
      </div>`;
  }

  // -------------------- mutações --------------------
  function setArchetype(id) {
    const arch = C.archetype(id);
    commitBuildChange(() => {
      build.archetypeId = id;
      build.attributes = {}; build.facilities = {}; build.aiFacilities = {}; build.playstyles = []; build.signatures = {};
      build.height = C.clamp(build.height, Math.ceil(arch.minHeight), Math.floor(arch.maxHeight));
      build.weight = C.clamp(build.weight, Math.ceil(arch.minWeight), Math.floor(arch.maxWeight));
      ui.selectedAttr = null;
    });
  }
  function adjustAttr(id, delta, mode) {
    const d = C.derive(build);
    const attr = C.findAttr(d.categories, id);
    if (!attr) return;
    let req = attr.currentValue;
    if (mode === 'base') req = attr.baseValue;
    else if (mode === 'max') req = attr.maxValue;
    else if (mode === 'set') req = delta;
    else req += delta;
    // só aumenta até onde o AP disponível permite (nunca deixa o AP negativo)
    const v = C.affordableTarget(attr, d.ap.available, req);
    commitBuildChange(() => {
      if (v === attr.baseValue) delete build.attributes[id]; else build.attributes[id] = v;
    });
  }
  function togglePlaystyle(id) {
    const d = C.derive(build);
    commitBuildChange(() => {
      const i = build.playstyles.indexOf(id);
      if (i >= 0) build.playstyles.splice(i, 1);
      else {
        const ps = C.playstyle(id);
        const max = D.slotUnlockLevels.filter((l) => build.level >= l).length;
        if (ps && !d.facilities.unlocks.has(id) && C.playstyleEligible(ps, d.purchased, d.facilities.unlocks) && build.playstyles.length < max) build.playstyles.push(id);
      }
    });
  }
  function setFacility(id, star, kind) {
    commitBuildChange(() => {
      const selected = kind === 'ai' ? build.aiFacilities : build.facilities;
      if (star === 0) delete selected[id]; else selected[id] = star;
    });
  }
  function togglePosition(p) {
    if (C.derive(build).arch.position === 'GK') return;
    commitBuildChange(() => {
      const i = build.positions.indexOf(p);
      if (i >= 0) build.positions.splice(i, 1); else build.positions.push(p);
    });
  }
  function quickUnlockSpec(specId) {
    const sp = D.specializations.find((s) => s.id === specId); if (!sp) return;
    const d = C.derive(build);
    const plan = C.requirementUnlockPlan(sp, d.categories);
    if (!plan.feasible) return toast('This Specialization cannot be unlocked with this archetype.');
    if (plan.cost > d.ap.available) return toast(`Not enough AP (need ${plan.cost}, have ${Math.max(0, d.ap.available)})`);
    commitBuildChange(() => {
      for (const id of Object.keys(plan.values)) {
        const attr = C.findAttr(d.categories, id);
        if (attr && plan.values[id] > attr.currentValue) build.attributes[id] = plan.values[id];
      }
    });
  }
  function quickUnlockPlaystyle(playstyleId) {
    const ps = C.playstyle(playstyleId);
    if (!ps) return;
    const d = C.derive(build);
    if (d.facilities.unlocks.has(playstyleId)) return toast('This PlayStyle is already granted by a Facility.');
    if (build.playstyles.includes(playstyleId)) return toast('This PlayStyle is already equipped.');
    const slots = D.slotUnlockLevels.filter((level) => build.level >= level).length;
    if (build.playstyles.length >= slots) return toast('No available PlayStyle slot.');
    const plan = C.requirementUnlockPlan(ps, d.categories);
    if (!plan.feasible) return toast('This PlayStyle cannot be unlocked with this archetype.');
    if (plan.cost > d.ap.available) return toast(`Not enough AP (need ${plan.cost}, have ${Math.max(0, d.ap.available)})`);
    commitBuildChange(() => {
      for (const id of Object.keys(plan.values)) {
        const attr = C.findAttr(d.categories, id);
        if (attr && plan.values[id] > attr.currentValue) build.attributes[id] = plan.values[id];
      }
      build.playstyles.push(playstyleId);
    });
    toast(`${psName(playstyleId)} unlocked and equipped · ${plan.cost} AP`);
  }
  function assignSpec(specId, slot) {
    commitBuildChange(() => {
      build.signatures = { [slot]: specId };
    });
  }
  function revertSpec(specId) {
    commitBuildChange(() => {
      for (const k in build.signatures) if (build.signatures[k] === specId) delete build.signatures[k];
    });
  }
  function applyUtPlayer(playerId) {
    const player = (ui.utPlayers || []).find((p) => String(p.id) === String(playerId));
    if (!player) return;
    const d = C.derive(build);
    const info = utBuildable(player, d);
    if (!info.buildable) return toast(`Not enough AP (${info.cost} needed).`);
    commitBuildChange(() => {
      for (const c of visibleCategories(d)) for (const a of c.attributes) {
        const target = info.values[a.id];
        if (target == null || target <= a.baseValue) delete build.attributes[a.id];
        else build.attributes[a.id] = target;
      }
      const allowedPositions = d.arch.position === 'GK' ? ['GK'] : OUTFIELD_POSITIONS;
      const positions = player.positions.filter((p) => allowedPositions.includes(p));
      if (positions.length) build.positions = positions;
      ui.modal = null;
      ui.selectedAttr = null;
    }, { render: false });
    render();
    toast(`${player.name} applied · ${info.cost} AP`);
  }

  function liveBody(kind, value) {
    const before = cloneBuild();
    build[kind] = value;
    if (!rememberBuildChange(before)) return;
    const ro = document.querySelector(`[data-readout="${kind}"]`); if (ro) ro.textContent = value;
    const d = C.derive(build);
    renderSummary(d); renderAttributes(d);
    if (ui.modal === 'body') { // atualiza o conteúdo do modal sem recriar os sliders
      const aff = $('#body-affected');
      const badge = $('#accel-badge');
      const affected = d.arch.position === 'GK' ? D.gkAffectedAttributes : D.affectedAttributes;
      if (aff) aff.innerHTML = affected.map((id) => { const v = d.bodyAdj[id] || 0, eff = d.effective[id], width = ((eff - 1) / 98) * 100;
        return `<div class="bg-app-bg rounded-lg p-2.5 border border-b-primary"><div class="flex items-center justify-between mb-1"><span class="text-sm ${v !== 0 ? 'text-accent-light' : 'text-t-secondary'}">${esc(attrName(id))}</span><span class="flex items-center gap-1.5">${v !== 0 ? `<span class="text-xs font-bold ${v < 0 ? 'text-state-error' : 'text-state-success'}">${v > 0 ? '+' : ''}${v}</span>` : ''}<span class="font-bold text-white">${eff}</span></span></div><div class="w-full h-2 bg-app-card rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${width}%;background-color:${C.barColor(eff)}"></div></div></div>`; }).join('');
      if (badge && d.accel) { badge.textContent = d.accel; badge.className = `px-2 py-0.5 rounded text-xs font-bold ${accelClass(d.accel)}`; }
    }
    syncUrl();
  }

  function toast(msg) {
    const t = $('#toast'); t.firstElementChild.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  function openModal(id) { ui.modal = id; ui.selectedAttr = null; render(); }
  function closeModal() {
    if (ui.modal === 'optimize' && ui.optimizeController) {
      ui.optimizeRunId++;
      ui.optimizeController.abort();
      ui.optimizeController = null;
      ui.optimizing = false;
    }
    ui.modal = null;
    render();
  }

  // -------------------- eventos --------------------
  function init() {
    const fromUrl = S.fromUrl();
    let adjustedFromUrl = false;
    if (fromUrl && fromUrl.archetypeId) {
      const normalized = C.normalizeBuild(Object.assign(defaultBuild(), fromUrl));
      build = normalized.build;
      adjustedFromUrl = normalized.adjusted;
    }

    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-arch],[data-filter],[data-pos],[data-modal],[data-modal-close],[data-attr],[data-disable-attr],[data-sum-attr],[data-ps],[data-ps-unlock],[data-fac],[data-fac-view],[data-spec-unlock],[data-spec-assign],[data-spec-revert],[data-ut-player],[data-attr-inc],[data-attr-dec],[data-attr-base],[data-attr-maximize],#level-max,#btn-reset,#btn-undo,#btn-redo,#btn-share,#btn-image,#btn-optimize,#opt-run,#btn-utplayers,#btn-maxsum,#sum-run,#sum-all,#sum-none');
      if (e.target.id === 'modal-root') return closeModal(); // clique no backdrop
      if (!t) return;
      if (t.dataset.disableAttr) { // alterna sem re-render (preserva inputs do modal)
        const before = cloneBuild();
        const id = t.dataset.disableAttr, i = build.disabledAttrs.indexOf(id);
        if (i >= 0) build.disabledAttrs.splice(i, 1); else build.disabledAttrs.push(id);
        rememberBuildChange(before);
        t.classList.toggle('opt-attr-off');
        syncUrl();
        return;
      }
      if (t.dataset.sumAttr) { // alterna inclusão no max-sum (sem re-render)
        const before = cloneBuild();
        const id = t.dataset.sumAttr, i = build.sumExcluded.indexOf(id);
        if (i >= 0) build.sumExcluded.splice(i, 1); else build.sumExcluded.push(id);
        rememberBuildChange(before);
        t.classList.toggle('opt-attr-off');
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.id === 'btn-maxsum') return openModal('maxsum');
      if (t.id === 'btn-utplayers') return openModal('utplayers');
      if (t.id === 'sum-run') return runMaxSum();
      if (t.id === 'sum-all') {
        const before = cloneBuild();
        build.sumExcluded = [];
        rememberBuildChange(before);
        document.querySelectorAll('[data-sum-attr]').forEach((c) => c.classList.remove('opt-attr-off'));
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.id === 'sum-none') {
        const before = cloneBuild();
        build.sumExcluded = sumConsidered(C.derive(build)).slice();
        rememberBuildChange(before);
        document.querySelectorAll('[data-sum-attr]').forEach((c) => c.classList.add('opt-attr-off'));
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.dataset.arch) return setArchetype(t.dataset.arch);
      if (t.dataset.filter) { ui.filter = t.dataset.filter; return renderArchetypes(); }
      if (t.dataset.pos) return togglePosition(t.dataset.pos);
      if (t.id === 'btn-optimize') return openModal('optimize');
      if (t.id === 'opt-run') return runOptimize();
      if (t.hasAttribute('data-modal')) return openModal(t.dataset.modal);
      if (t.hasAttribute('data-modal-close')) return closeModal();
      if (t.hasAttribute('data-attr')) { ui.selectedAttr = ui.selectedAttr === t.dataset.attr ? null : t.dataset.attr; return render(); }
      if (t.hasAttribute('data-attr-inc')) return adjustAttr(ui.selectedAttr, +1);
      if (t.hasAttribute('data-attr-dec')) return adjustAttr(ui.selectedAttr, -1);
      if (t.hasAttribute('data-attr-base')) return adjustAttr(ui.selectedAttr, 0, 'base');
      if (t.hasAttribute('data-attr-maximize')) return adjustAttr(ui.selectedAttr, 0, 'max');
      if (t.dataset.psUnlock) return quickUnlockPlaystyle(t.dataset.psUnlock);
      if (t.dataset.ps) return togglePlaystyle(t.dataset.ps);
      if (t.dataset.facView) { ui.facilityKind = t.dataset.facView; return renderModal(C.derive(build)); }
      if (t.dataset.fac) return setFacility(t.dataset.fac, +t.dataset.star, t.dataset.facKind);
      if (t.dataset.specUnlock) return quickUnlockSpec(t.dataset.specUnlock);
      if (t.dataset.specAssign) return assignSpec(t.dataset.specAssign, +t.dataset.slot);
      if (t.dataset.specRevert) return revertSpec(t.dataset.specRevert);
      if (t.dataset.utPlayer) return applyUtPlayer(t.dataset.utPlayer);
      if (t.id === 'level-max') return commitBuildChange(() => { build.level = D.maxLevel; });
      if (t.id === 'btn-undo') return undoBuild();
      if (t.id === 'btn-redo') return redoBuild();
      if (t.id === 'btn-reset') {
        if (confirm('Reset all attribute upgrades and selections?')) {
          commitBuildChange(() => {
            const a = build.archetypeId;
            build = defaultBuild();
            build.archetypeId = a;
          });
        }
        return;
      }
      if (t.id === 'btn-share') return doShare();
      if (t.id === 'btn-image') return doImage();
    });
    document.body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'level-input') return commitBuildChange(() => { build.level = C.clamp(parseInt(t.value || '1', 10), 1, D.maxLevel); });
      if (t.id === 'ut-search') { ui.utQuery = t.value; return renderModal(C.derive(build)); }
      if (t.dataset.body) return liveBody(t.dataset.body, parseInt(t.value, 10));
      if (t.hasAttribute('data-attr-range')) return adjustAttr(ui.selectedAttr, parseInt(t.value, 10), 'set');
    });
    document.body.addEventListener('change', (e) => {
      if (e.target.id === 'club-level') return commitBuildChange(() => { build.clubLevel = parseInt(e.target.value, 10); });
    });
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); return undoBuild(); }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); return redoBuild(); }
      if (e.key === 'Escape' && ui.modal) closeModal();
    });

    render();
    if (adjustedFromUrl) toast('Shared build adjusted to the current game rules.');
  }

  async function doShare() {
    if (!build.archetypeId) return toast('Select an archetype first.');
    const url = S.toUrl(build);
    try { await navigator.clipboard.writeText(url); toast(L.common.linkCopySuccess); }
    catch (e) { prompt('Copy your build link:', url); }
  }
  async function doImage() {
    if (!build.archetypeId) return toast('Select an archetype first.');
    toast('Rendering image…');
    try { await S.saveImage(build, C.derive(build), `fc26-${build.archetypeId}.png`); }
    catch (e) { toast('Image export failed.'); console.error(e); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
