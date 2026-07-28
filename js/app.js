/* ============================================================================
 * app.js — Controller do FC 26 Pro Clubs Builder (estado + UI + eventos).
 * Layout fiel ao original: atributos sempre visíveis + painel de detalhe à direita;
 * as abas (Body / PlayStyles / Specializations) abrem MODAIS.
 * Depende de window.DATA, window.Calc, window.Share.
 * ========================================================================== */
(function () {
  const D = window.DATA, C = window.Calc, S = window.Share, L = window.DATA.labels;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // -------------------- estado --------------------
  function defaultBuild() {
    return {
      archetypeId: null, level: 1,
      height: D.defaultHeight, weight: D.defaultWeight,
      attributes: {}, playstyles: [], playstylePurchases: {}, signatures: {}, positions: [], disabledAttrs: [], sumExcluded: [],
    };
  }
  let build = defaultBuild();
  const ui = {
    filter: 'all', selectedAttr: null, modal: null,
    showWeights: false,
    optimizing: false, optimizeRunId: 0, optimizeController: null,
    psPicker: false,
    utPlayers: null, utLoading: false, utError: null, utQuery: '',
    utPositions: [], utOnlyBuildable: true, utPlanCache: null,
  };
  const OUTFIELD_POSITIONS = ['ST', 'RW', 'LW', 'CAM', 'RM', 'LM', 'CM', 'CDM', 'RB', 'LB', 'CB'];
  // ponytail: teto de linhas desenhadas por render; sobe se a lista virar virtualizada.
  const UT_RENDER_LIMIT = 250;
  const HISTORY_LIMIT = 100;
  const history = window.BuildHistory.create(HISTORY_LIMIT);

  // Recriar uma seção com innerHTML descarta o elemento focado — o campo de LVL e a busca de
  // atletas perdiam foco (e o resto do que estava sendo digitado) a cada tecla. Guarda id +
  // seleção antes da troca e devolve depois. Vale para qualquer input em região re-renderizada.
  function selectionOf(el) {
    try { return [el.selectionStart, el.selectionEnd]; } catch (e) { return null; } // type=number lança
  }
  function keepFocus(update) {
    const active = document.activeElement;
    const id = active && active.id;
    const range = id ? selectionOf(active) : null;
    update();
    if (!id) return;
    const next = document.getElementById(id);
    if (!next || next === active || next === document.activeElement) return;
    next.focus({ preventScroll: true });
    if (range && range[0] != null) { try { next.setSelectionRange(range[0], range[1]); } catch (e) {} }
  }

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
    bodyDragBefore = null; // um arrasto pendente não pode ser gravado contra um estado já descartado
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
    keepFocus(() => {
      renderSummary(d);
      renderArchetypes();
      renderPositions(d);
      renderTabs();
      renderAttributes(d);
      renderDetailPanel(d);
      renderModal(d);
    });
    syncUrl();
  }
  const refreshModal = () => keepFocus(() => renderModal(C.derive(build)));

  // -------------------- summary bar --------------------
  function renderSummary(d) {
    const arch = d.arch;
    const apClass = d.ap.available < 0 ? 'text-state-error' : 'text-accent-light';
    const accel = d.accel ? `<span class="summary-tag px-2 py-0.5 rounded text-xs font-bold ${accelClass(d.accel)}">${d.accel}</span>` : '';
    const undoDisabled = !history.canUndo();
    const redoDisabled = !history.canRedo();
    const archInfo = arch
      ? `<span class="summary-avatar"><img src="archetypes/${arch.iconFileName}" alt="" class="w-9 h-9 object-contain" /></span>
         <div class="leading-tight">
           <div class="summary-player-name font-bold text-sm text-white">${esc(archName(arch.id))}</div>
           <div class="summary-label text-xs text-t-muted uppercase">${L.position[arch.position.toLowerCase()] || arch.position}</div>
         </div>`
      : `<div class="text-sm text-t-muted">Select an archetype</div>`;
    const signatureIcons = C.signatureSlots(build, d.categories).map((slot) => {
      const id = slot.playStyleId;
      if (!id) return '<span class="summary-signature-slot is-empty" aria-hidden="true"></span>';
      const state = slot.isPlus ? 'is-unlocked' : 'is-locked';
      const icon = `playstyles/${slot.isPlus ? 'plus/' : ''}${psIcon(id)}`;
      const status = slot.isPlus ? 'PlayStyle+ unlocked' : `Unlocks as PlayStyle+ at level ${slot.plusLevel}`;
      return `<button type="button" data-modal="playStyles" class="summary-signature-slot ${state}"
        title="${esc(psName(id))}: ${status}" aria-label="${esc(psName(id))}, ${status}">
        <img src="${icon}" alt="" aria-hidden="true" />
      </button>`;
    }).join('');
    $('#summary-bar').innerHTML = `
      <div class="summary-player flex items-center gap-2.5">${archInfo}</div>
      <div class="summary-physique flex items-center gap-4">
        <div class="summary-metric text-center leading-tight">
          <div class="summary-label text-xs text-t-muted uppercase">Height / Weight</div>
          <div class="font-bold text-sm text-white">${build.height}cm / ${build.weight}kg</div>
        </div>
        ${accel ? `<div class="summary-metric text-center leading-tight"><div class="summary-label text-xs text-t-muted uppercase">AcceleRATE</div>${accel}</div>` : ''}
      </div>
      <div class="summary-signatures">
        <span class="summary-label">PlayStyles+</span>
        <div class="summary-signature-slots">${signatureIcons}</div>
      </div>
      <div class="summary-controls flex items-center gap-3">
        <div class="summary-progress flex items-center gap-3">
          <div class="summary-level flex items-center gap-1.5">
            <span class="summary-label text-xs text-t-muted uppercase">LVL</span>
            <input id="level-input" type="text" inputmode="numeric" maxlength="3" autocomplete="off"
              aria-label="Player level, 1 to ${D.maxLevel}" value="${build.level}"
              class="w-14 px-2 py-1 bg-app-card border border-b-primary rounded text-lg font-bold text-white text-center" />
            <button id="level-max" class="level-max px-2 py-1 bg-btn-purple hover:bg-btn-purple-hover text-white rounded font-bold text-xs transition-colors">MAX</button>
          </div>
          <div class="summary-ap text-center min-w-[54px] leading-none">
            <div class="summary-label text-xs text-t-muted uppercase mb-0.5">AP left</div>
            <div class="text-xl font-bold ${apClass}">${d.ap.available}</div>
            <div class="text-[10px] text-t-muted mt-0.5">${d.ap.spent} / ${d.ap.total}</div>
          </div>
        </div>
        <div class="summary-actions flex items-center gap-2">
          <div class="summary-history flex items-center gap-1">
            <button id="btn-undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" ${undoDisabled ? 'disabled' : ''} class="px-2 py-1.5 rounded-lg font-bold text-xs transition-colors active:scale-95 ${undoDisabled ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}">↶ <span>Undo</span></button>
            <button id="btn-redo" title="Redo (Ctrl/Cmd+Y)" aria-label="Redo" ${redoDisabled ? 'disabled' : ''} class="px-2 py-1.5 rounded-lg font-bold text-xs transition-colors active:scale-95 ${redoDisabled ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}">↷ <span>Redo</span></button>
          </div>
          <div class="summary-export flex items-center gap-1">
            <button id="btn-share" class="bg-btn-blue hover:bg-btn-blue-hover text-white font-bold px-2.5 py-1.5 text-xs rounded-lg transition-colors">↗ Share</button>
            <button id="btn-image" class="bg-app-card hover:bg-app-hover text-t-secondary font-bold px-2.5 py-1.5 text-xs rounded-lg transition-colors">↓ Image</button>
          </div>
          <button id="btn-reset" class="summary-reset bg-btn-red hover:bg-btn-red-hover text-white border-2 border-btn-red-hover font-bold px-3 py-1.5 text-sm rounded-lg transition-all active:scale-95">Reset</button>
        </div>
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
      return `<button data-filter="${f}" aria-pressed="${active}" class="filter-chip px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors ${active ? 'bg-btn-blue text-white' : 'bg-app-panel text-t-muted hover:bg-app-card'}">${esc(label)}</button>`;
    }).join('');
    const list = D.archetypes.filter((a) => ui.filter === 'all' || a.position === ui.filter);
    $('#archetype-grid').innerHTML = list.map((a) => {
      const sel = build.archetypeId === a.id;
      return `
        <button data-arch="${a.id}" aria-pressed="${sel}" class="arch-card relative flex flex-col items-center gap-1.5 p-2 sm:p-3 rounded-xl border transition-all active:scale-95 ${sel ? 'bg-btn-blue border-state-info ring-2 ring-state-info shadow-lg' : 'bg-app-panel border-b-primary hover:bg-app-card hover:border-b-secondary'}">
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
    const weightProfile = build.positions.length ? C.overallWeightProfile(build.positions, d) : null;
    const weightContext = weightProfile && weightProfile.weightedPositions.join(' / ');
    const chips = availablePositions.map((p) => {
      const on = build.positions.includes(p);
      const automatic = d.arch.position === 'GK';
      const ovr = on ? C.overallForPosition(p, d) : null;
      return `<button data-pos="${p}" ${automatic ? 'disabled' : ''} aria-pressed="${on}" title="${automatic ? 'Goalkeeper position is automatic' : on ? `${p}: estimated OVR ${ovr} (expected tolerance ±1)` : 'Add position'}" class="position-chip px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${on ? 'bg-btn-blue text-white' : 'bg-app-panel text-t-muted hover:bg-app-card'} ${automatic ? 'cursor-default' : ''}">${p}${on ? `<span class="px-1 rounded bg-black/30 text-[11px]">${ovr}</span>` : ''}</button>`;
    }).join('');
    let summary = '';
    if (build.positions.length) {
      const ovr = C.overallForPositions(build.positions, d);
      summary = `<div class="overall-badge text-center leading-none" title="Estimate based on purchased attributes; expected tolerance ±1"><div class="text-[10px] text-t-muted uppercase mb-0.5">${build.positions.length > 1 ? 'Lowest Est. OVR' : 'Est. OVR'} <span class="normal-case">±1</span></div><div class="text-2xl font-bold text-accent-light">${ovr}</div></div>`;
    }
    bar.innerHTML = `
      <div class="position-picker flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-t-muted uppercase font-bold mr-1">Positions</span>${chips}
        <button id="btn-weights" role="switch" aria-checked="${ui.showWeights}" ${!build.positions.length ? 'disabled' : ''}
          title="${build.positions.length > 1 ? `Combined weights average all selected positions: ${esc(weightContext || 'selected positions')}` : 'Show each attribute coefficient in the selected-position OVR formula'}"
          class="weight-toggle ${ui.showWeights ? 'is-on' : ''}" type="button">
          <span class="weight-toggle-track" aria-hidden="true"><span></span></span>
          <span>Weights${ui.showWeights && weightContext ? ` · ${esc(weightContext)}` : ''}</span>
        </button>
      </div>
      <div class="position-actions flex items-center gap-2">
        ${summary}
        <button id="btn-optimize" ${!build.positions.length ? 'disabled' : ''} class="action-primary px-3 py-2 rounded-lg font-bold text-sm transition-colors ${build.positions.length ? 'bg-btn-purple hover:bg-btn-purple-hover text-white' : 'bg-app-panel text-t-disabled cursor-not-allowed'}">⚡ Optimize overall</button>
        <button id="btn-utplayers" class="action-secondary px-3 py-2 rounded-lg font-bold text-sm transition-colors bg-app-panel hover:bg-app-card text-white border border-b-primary">UT players</button>
        <button id="btn-maxsum" class="action-secondary px-3 py-2 rounded-lg font-bold text-sm transition-colors bg-app-panel hover:bg-app-card text-white border border-b-primary">Max sum</button>
      </div>`;
  }

  // -------------------- tabs (abrem modais) --------------------
  function renderTabs() {
    const tabs = [['playStyles', L.tabs.playStyles], ['specializations', L.tabs.specializations], ['body', L.tabs.body]];
    const disabled = !build.archetypeId;
    $('#tabs').innerHTML = tabs.map(([id, label]) =>
      `<button data-modal="${id}" ${disabled ? 'disabled' : ''} class="builder-tab px-4 py-2 rounded-lg font-bold text-sm transition-colors ${disabled ? 'bg-app-panel text-t-disabled cursor-not-allowed' : 'bg-app-panel text-t-secondary hover:bg-btn-blue hover:text-white'}">${esc(label)}</button>`
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
    const weightProfile = ui.showWeights && build.positions.length
      ? C.overallWeightProfile(build.positions, d)
      : null;
    $('#attributes').innerHTML = visibleCategories(d).map((cat) => `
      <section class="attribute-card bg-app-panel rounded-xl border border-b-primary overflow-hidden self-start" data-category="${esc(cat.id)}" aria-labelledby="attribute-category-${esc(cat.id)}">
        <header class="attribute-card-head w-full p-4 flex items-center justify-between min-h-[52px]">
          <h2 id="attribute-category-${esc(cat.id)}" class="text-base font-bold text-t-secondary tracking-wide">${esc(catName(cat.id))}</h2>
          ${weightProfile ? '<span class="attr-weight-label">OVR weight</span>' : ''}
        </header>
        <div class="attribute-card-body px-3 pb-3 space-y-1.5">${cat.attributes.map((a) => attributeRow(a, d, weightProfile)).join('')}</div>
      </section>`).join('');
  }
  function attributeRow(a, d, weightProfile) {
    const body = d.bodyAdj[a.id] || 0, cv = a.currentValue;
    const selected = ui.selectedAttr === a.id;
    const tag = (v) => v === 0 ? '' : `<span class="font-bold text-sm min-w-3 ${v < 0 ? 'text-state-error' : 'text-state-success'}">${v > 0 ? '+' : ''}${v}</span>`;
    const nameEl = a.isKeyAttribute
      ? `<span class="key-attribute-name text-accent-light text-sm font-medium">${esc(attrName(a.id))}</span><img src="assets/ui/key-attribute.png" alt="Key Attribute" class="key-attribute-icon" />`
      : `<span class="text-sm font-medium text-t-secondary">${esc(attrName(a.id))}</span>`;
    const weight = weightProfile ? (weightProfile.weights[a.id] || 0) : null;
    const weightText = weight == null ? '' : weight === 0 ? '0%' : `${(weight * 100).toFixed(weight * 100 >= 1 ? 1 : 2)}%`;
    const weightEl = weight == null ? '' : `<span class="attr-weight ${weight === 0 ? 'is-zero' : ''}"
      title="${weightProfile.mode === 'minmax' ? `Combined coefficient for ${esc(weightProfile.weightedPositions.join(' / '))}` : `OVR coefficient for ${esc(weightProfile.positions[0])}`}">${weightText}</span>`;
    return `
      <button type="button" data-attr="${a.id}" aria-pressed="${selected}" class="attribute-row w-full text-left p-2.5 rounded-lg min-h-[54px] flex flex-col justify-center transition-all ${selected ? 'bg-b-primary ring-2 ring-state-info' : 'hover:bg-app-card active:bg-b-primary'}">
        <span class="attribute-row-top flex items-center justify-between mb-1.5 w-full">
          <span class="attribute-row-name flex items-center gap-2">${nameEl}</span>
          <span class="attribute-row-metrics flex items-center gap-1.5">${weightEl}${tag(body)}<span class="attribute-value text-base font-bold text-white">${cv}</span></span>
        </span>
        ${attrMeter(a, cv)}
      </button>`;
  }
  // skill moves / weak foot valem 2..5 estrelas — na barra de 1-99 um 3/5 aparecia vazio.
  function attrMeter(a, cv) {
    if (a.displayType === 'stars') {
      return `<span class="attr-stars">${'★'.repeat(cv)}<span class="attr-stars-off">${'★'.repeat(Math.max(0, a.maxValue - cv))}</span></span>`;
    }
    return `<span class="attr-bar"><span class="attr-bar-fill" style="width:${((cv - 1) / 98) * 100}%;background-color:${C.barColor(cv)}"></span></span>`;
  }

  // -------------------- painel de detalhe do atributo (direita, sempre) --------------------
  const placeholder = (msg) => `<div class="p-6 h-full flex items-center justify-center min-h-[300px]"><p class="text-t-disabled text-sm text-center">${esc(msg)}</p></div>`;
  const panelHead = (title, accent) => `<header class="detail-panel-head ${accent ? 'is-accent' : ''} p-4 border-b border-b-primary"><h3 class="font-bold text-t-secondary tracking-wide">${esc(title)}</h3></header>`;
  const apIcon = (className = '') => `<img src="assets/ui/ap.png" alt="AP" class="ap-icon ${className}" />`;
  function renderDetailPanel(d) {
    const panel = $('#panel');
    if (!d.arch) { panel.dataset.kind = 'empty'; panel.innerHTML = placeholder('Select an archetype to begin.'); return; }
    if (ui.selectedAttr) { panel.dataset.kind = 'attribute'; panel.innerHTML = attrEditor(d); return; }
    panel.dataset.kind = 'summary';
    panel.innerHTML = buildSummary(d);
  }
  // Sem atributo selecionado a coluna de 400px ficava só com um aviso cinza — agora carrega
  // o que o usuário precisa pra decidir o próximo ponto de AP.
  function buildSummary(d) {
    const overalls = C.overallMapForValues(build.positions || [], d, null);
    const overallEntries = Object.entries(overalls);
    const overall = overallEntries.length ? Math.min(...overallEntries.map(([, value]) => value)) : '—';
    const ovrRows = overallEntries.length
      ? overallEntries.map(([pos, value]) =>
        `<span class="build-summary-position"><span>${pos}</span><strong>${value}</strong></span>`).join('')
      : '<span class="build-summary-empty">Pick a position to calculate OVR.</span>';
    const sigs = C.signatureSlots(build, d.categories).filter((s) => s.playStyleId);
    const equipped = build.playstyles || [];
    const row = (label, value, cls) => `<div class="flex items-center justify-between text-sm"><span class="text-t-muted">${label}</span><span class="font-bold ${cls || 'text-white'}">${value}</span></div>`;
    const playStyleItem = (id, plus) => `
      <span class="build-summary-playstyle">
        <img src="playstyles/${plus ? 'plus/' : ''}${psIcon(id)}" alt="" aria-hidden="true" />
        <span>${esc(psName(id))}${plus ? '+' : ''}</span>
      </span>`;
    return `
      ${panelHead('Build Summary', true)}
      <div class="build-summary-panel">
        <section class="build-summary-overall">
          <span class="build-summary-kicker">${overallEntries.length > 1 ? 'Lowest estimated OVR' : 'Estimated OVR'} <small>±1</small></span>
          <strong>${overall}</strong>
          <div class="build-summary-positions">${ovrRows}</div>
        </section>

        <section class="build-summary-ap">
          <div class="build-summary-ap-line">
            <span>Attribute Points available:</span>
            <strong>${apIcon()}${d.ap.available}</strong>
          </div>
          <p class="${d.ap.available < 0 ? 'is-warning' : ''}">
            <span aria-hidden="true">${d.ap.available < 0 ? '!' : '✓'}</span>
            ${d.ap.spent} of ${d.ap.total} AP used at level ${build.level}
          </p>
        </section>

        <section class="build-summary-details">
          ${row('Body', `${build.height}cm / ${build.weight}kg`)}
          ${d.accel ? row('AcceleRATE', d.accel, 'text-state-info') : ''}
          ${row('PlayStyle slots', `${equipped.length} / ${d.slots.unlocked}`)}
          ${row('Signature +', `${d.slots.signaturePlus} / 4`)}
        </section>

        <section class="build-summary-playstyles">
          <h4>Equipped PlayStyles</h4>
          ${sigs.length || equipped.length
            ? `<div>${sigs.map((s) => playStyleItem(s.playStyleId, s.isPlus)).join('')}${equipped.map((id) => playStyleItem(id, false)).join('')}</div>`
            : '<p>No PlayStyles equipped.</p>'}
        </section>
      </div>`;
  }
  function attrEditor(d) {
    let attr = C.findAttr(d.categories, ui.selectedAttr);
    if (!attr) return placeholder('Select an attribute.');
    const body = d.bodyAdj[attr.id] || 0, eff = d.effective[attr.id];
    const nextCost = C.apCostNextPoint(attr);
    const atMax = attr.currentValue >= attr.maxValue, atMin = attr.currentValue <= attr.baseValue;
    const canAfford = nextCost != null && d.ap.available >= nextCost;
    const relatedPlayStyles = D.playstyles.filter((playStyle) =>
      (playStyle.requirements || []).some((requirement) => requirement.attributeId === attr.id)
    );
    const adj = (label, v) => `<div class="flex justify-between text-sm"><span class="text-t-muted">${label}</span><span class="font-bold ${v < 0 ? 'text-state-error' : v > 0 ? 'text-state-success' : 'text-t-secondary'}">${v > 0 ? '+' : ''}${v}</span></div>`;
    const relatedItem = (playStyle) => {
      const eligible = C.playstyleEligible(playStyle, d.purchased);
      return `<span class="attribute-related-item ${eligible ? 'is-eligible' : ''}">
        <span class="attribute-related-icon">
          <img src="playstyles/${psIcon(playStyle.id)}" alt="" aria-hidden="true" />
          ${eligible ? '<span aria-label="Requirements met">✓</span>' : ''}
        </span>
        <span>${esc(psName(playStyle.id))}</span>
      </span>`;
    };
    return `
      ${panelHead(attrName(attr.id), true)}
      <div class="attribute-editor p-4 space-y-4">
        <div class="attribute-editor-overview flex items-end justify-between">
          <div><div class="attribute-editor-kicker text-xs text-t-muted uppercase">Current</div><div id="attr-readout" class="attribute-editor-value text-4xl font-bold" style="color:${C.barColor(attr.currentValue)}">${attr.currentValue}</div></div>
          <div class="attribute-editor-limits text-right text-sm text-t-muted"><div>Base ${attr.baseValue}</div><div>Max ${attr.maxValue}</div><div class="uppercase text-xs mt-1">tier ${attr.tier.replace('tier', '').replace('star', '★')}</div></div>
        </div>
        <div class="attribute-editor-controls flex items-center gap-2">
          <button data-attr-dec aria-label="Decrease ${esc(attrName(attr.id))}" class="flex-1 py-2 rounded-lg font-bold ${atMin ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-app-card hover:bg-b-primary text-white'}" ${atMin ? 'disabled' : ''}>−</button>
          <input data-attr-range type="range" aria-label="${esc(attrName(attr.id))}" min="${attr.baseValue}" max="${attr.maxValue}" value="${attr.currentValue}" class="flex-[3] accent-btn-blue" />
          <button data-attr-inc aria-label="Increase ${esc(attrName(attr.id))}" class="flex-1 py-2 rounded-lg font-bold ${atMax || !canAfford ? 'bg-app-card text-t-disabled cursor-not-allowed' : 'bg-btn-blue hover:bg-btn-blue-hover text-white'}" ${atMax || !canAfford ? 'disabled' : ''}>+</button>
        </div>
        <div class="attribute-editor-next-cost">
          <span>Next upgrade cost:</span>
          <strong>${apIcon()}${atMax || nextCost == null ? '—' : nextCost}</strong>
        </div>
        <div class="attribute-editor-cost ${!atMax && !canAfford ? 'is-warning' : ''}">
          <span aria-hidden="true">${atMax || canAfford ? '✓' : '!'}</span>
          ${atMax ? 'Attribute is at maximum' : !canAfford ? 'Not enough Attribute Points' : `${d.ap.available} Attribute Points available`}
        </div>
        <div class="attribute-editor-actions flex gap-2">
          <button data-attr-base class="flex-1 py-1.5 text-xs rounded-lg bg-app-card hover:bg-b-primary text-t-secondary font-bold">Reset to base</button>
          <button data-attr-maximize class="flex-1 py-1.5 text-xs rounded-lg bg-app-card hover:bg-b-primary text-t-secondary font-bold">Max out</button>
        </div>
        ${relatedPlayStyles.length ? `
          <section class="attribute-related">
            <h4>Related PlayStyles</h4>
            <div>${relatedPlayStyles.map(relatedItem).join('')}</div>
          </section>` : ''}
        <div class="attribute-editor-breakdown bg-app-bg rounded-lg p-3 space-y-1.5 border border-b-primary">
          ${adj('Body', body)}
          <div class="flex justify-between text-sm border-t border-b-primary pt-1.5 mt-1.5"><span class="text-t-secondary font-medium">Effective</span><span class="font-bold text-white">${eff}</span></div>
        </div>
      </div>`;
  }

  // ==================== MODAIS ====================
  function modalShell(title, bodyHtml) {
    return `
      <div class="flex items-center justify-between p-4 sm:p-5 border-b border-b-primary flex-shrink-0">
        <h2 id="modal-title" class="text-xl sm:text-2xl font-bold text-white tracking-wider uppercase">${esc(title)}</h2>
        <button data-modal-close aria-label="Close ${esc(title)}" class="w-11 h-11 flex items-center justify-center rounded-lg bg-app-card hover:bg-b-primary text-t-muted text-lg transition-colors">✕</button>
      </div>
      <div class="overflow-y-auto p-4 sm:p-6">${bodyHtml}</div>`;
  }
  function renderModal(d) {
    const root = $('#modal-root'), box = $('#modal-box');
    if (!ui.modal || !d.arch) {
      root.classList.add('hidden');
      root.classList.remove('flex');
      box.innerHTML = '';
      delete box.dataset.modalKind;
      return;
    }
    let title = '', body = '';
    if (ui.modal === 'body') { title = L.tabs.body; body = bodyModal(d); }
    else if (ui.modal === 'playStyles') { title = L.tabs.playStyles; body = playStylesModal(d); }
    else if (ui.modal === 'specializations') { title = L.tabs.specializations; body = specializationsModal(d); }
    else if (ui.modal === 'optimize') { title = 'Optimize Overall'; body = optimizeModal(d); }
    else if (ui.modal === 'maxsum') { title = 'Maximize Attribute Sum'; body = maxSumModal(d); }
    else if (ui.modal === 'utplayers') { title = 'UT Players'; body = utPlayersModal(d); }
    box.dataset.modalKind = ui.modal;
    box.innerHTML = modalShell(title, body);
    root.classList.remove('hidden'); root.classList.add('flex');
    if (!box.contains(document.activeElement)) box.focus({ preventScroll: true }); // keepFocus devolve depois se havia um campo
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
        <input data-body="${kind}" type="range" aria-label="${esc(label)}" min="${min}" max="${max}" value="${value}" class="w-full accent-btn-blue" />
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
    const signatureById = new Map(C.signatureSlots(build, d.categories)
      .filter((slot) => slot.playStyleId)
      .map((slot) => [slot.playStyleId, slot]));

    // SLOTS (9 por nível) — clicar num slot vazio abre o seletor; clicar num cheio libera o slot.
    const unlockedSlotCount = d.slots.unlocked;
    const equippedCount = build.playstyles.length;
    const freeSlots = Math.max(0, unlockedSlotCount - equippedCount);
    const slotCells = D.slotUnlockLevels.map((lvl, i) => {
      const id = build.playstyles[i];
      if (id) return `<button data-ps-slot="${i}" title="Remove ${esc(psName(id))} from slot ${i + 1}" class="ps-slot ps-slot-filled">
        <img src="playstyles/${psIcon(id)}" alt="" />
        <span class="ps-slot-name">${esc(psName(id))}</span>
        <span class="ps-slot-x" aria-hidden="true">✕</span></button>`;
      if (build.level >= lvl) return `<button data-ps-slot="${i}" title="Choose a PlayStyle for slot ${i + 1}" class="ps-slot ps-slot-empty">
        <span class="ps-slot-plus">+</span><span class="ps-slot-hint">${esc(L.playStyles.slot)}</span></button>`;
      return `<div class="ps-slot ps-slot-locked" title="Unlocks at level ${lvl}"><span class="ps-slot-plus">🔒</span><span class="ps-slot-hint">Lvl ${lvl}</span></div>`;
    }).join('');

    // seletor: só o que já está desbloqueado e ainda não equipado
    const pickable = D.playstyles.filter((p) => !signatureById.has(p.id)
      && !build.playstyles.includes(p.id)
      && C.playstyleEligible(p, d.purchased));
    const picker = !ui.psPicker ? '' : `
      <div class="ps-picker">
        <div class="ps-picker-head">
          <span>Choose a PlayStyle <span class="ps-picker-count">${pickable.length} unlocked · ${freeSlots} slot${freeSlots === 1 ? '' : 's'} free</span></span>
          <button data-ps-picker-close class="ps-picker-close" aria-label="Close picker">✕</button>
        </div>
        ${pickable.length
          ? `<div class="ps-picker-grid">${pickable.map((p) => `<button data-ps-pick="${p.id}" title="${esc(psDesc(p.id))}" class="ps-pick">
              <img src="playstyles/${p.iconFileName}" alt="" />
              <span class="ps-pick-name">${esc(psName(p.id))}</span></button>`).join('')}</div>`
          : `<p class="ps-picker-empty">Nothing unlocked yet — meet a PlayStyle's requirements below (or use Quick Unlock) and it will appear here.</p>`}
      </div>`;

    const byCat = {};
    D.playstyles.forEach((p) => { (byCat[p.category] = byCat[p.category] || []).push(p); });
    const psRow = (p) => {
      const signature = signatureById.get(p.id);
      const eligible = !!signature || C.playstyleEligible(p, d.purchased);
      const regularSlot = build.playstyles.indexOf(p.id);
      const on = !!signature || regularSlot >= 0;
      const receipt = build.playstylePurchases && build.playstylePurchases[p.id];
      const sale = !signature && (receipt || regularSlot >= 0) ? playstyleSalePlan(p.id, d) : null;
      const unlockPlan = C.requirementUnlockPlan(p, d.categories);
      const canAffordUnlock = unlockPlan.feasible && unlockPlan.cost <= d.ap.available;
      const reqText = (p.requirements || []).map((r) => `${attrName(r.attributeId)} ${r.minValue}`).join(' · ');
      const status = signature
        ? 'Signature PlayStyle equipped'
        : regularSlot >= 0
          ? `Equipped in slot ${regularSlot + 1}`
          : receipt
            ? `Purchased · sell for ${sale.refund} AP`
        : eligible
          ? 'Unlocked'
          : !unlockPlan.feasible
            ? 'Unavailable'
            : canAffordUnlock
              ? `Quick Unlock for ${unlockPlan.cost} AP`
              : `Need ${unlockPlan.cost} AP`;
      const state = signature ? 'is-signature' : sale ? 'is-sellable' : on ? 'is-on' : eligible ? 'is-ready' : canAffordUnlock ? 'is-unlockable' : '';
      const tag = sale || (!on && !eligible && unlockPlan.feasible) ? 'button' : 'div';
      const action = sale
        ? `type="button" data-ps-sell="${p.id}" data-refund="${sale.refund}"`
        : tag === 'button'
          ? `type="button" data-ps-unlock="${p.id}" data-cost="${unlockPlan.cost}" ${canAffordUnlock ? '' : 'disabled'}`
          : '';
      const costInfo = signature
        ? '<span class="ps-row-cost is-signature"><strong>0 AP</strong><small>✓ Equipped</small></span>'
        : sale
          ? `<span class="ps-row-cost is-sellable">
              <span class="ps-sale-idle"><strong>0 AP</strong><small>✓ Unlocked</small></span>
              <span class="ps-sale-action"><strong>${sale.refund} AP</strong><small>Sell · refund</small></span>
            </span>`
          : on || eligible
            ? '<span class="ps-row-cost is-affordable"><strong>0 AP</strong><small>✓ Unlocked</small></span>'
        : !unlockPlan.feasible
          ? '<span class="ps-row-cost is-unavailable"><strong>— AP</strong><small>Unavailable</small></span>'
          : canAffordUnlock
            ? `<span class="ps-row-cost is-affordable"><strong>${unlockPlan.cost} AP</strong><small>✓ AP available</small></span>`
            : `<span class="ps-row-cost is-insufficient"><strong>${unlockPlan.cost} AP</strong><small>Need ${Math.max(0, unlockPlan.cost - d.ap.available)} more</small></span>`;
      return `<${tag} ${action} class="ps-row ${state}" title="${esc(`${psName(p.id)} · ${status} · ${reqText || 'No requirements'} · ${psDesc(p.id)}`)}" aria-label="${esc(`${psName(p.id)}. ${status}`)}">
        <img src="${signature && signature.isPlus ? 'playstyles/plus/' : 'playstyles/'}${p.iconFileName}" alt="" class="ps-row-icon ${!eligible && !on ? 'is-locked' : ''}" />
        ${costInfo}
      </${tag}>`;
    };

    return `
      <div class="space-y-6">
        <div class="playstyle-slots-section">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-white font-bold tracking-wider">PlayStyle Slots</h3>
            <span class="text-sm ${equippedCount > unlockedSlotCount ? 'text-state-error' : 'text-t-muted'}">${equippedCount} / ${unlockedSlotCount} used</span>
          </div>
          <div class="ps-slot-grid">${slotCells}</div>
          ${picker}
          <p class="text-[11px] text-t-disabled mt-2">Click an empty slot to pick a PlayStyle · click a filled slot to free it. Quick Unlock only buys the requirements.</p>
        </div>
        <div>
          <h3 class="text-white font-bold tracking-wider mb-3">${esc(L.playStyles.available)}</h3>
          <div class="available-playstyles-list space-y-3">
            ${Object.keys(byCat).map((cat) => `<div><div class="text-[11px] text-t-muted uppercase mb-2 font-bold">${esc(catName(cat))}</div><div class="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">${byCat[cat].map(psRow).join('')}</div></div>`).join('')}
          </div>
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
      return `<button data-disable-attr="${id}" aria-pressed="${!off}" class="opt-chip ${off ? 'opt-attr-off' : ''}">${esc(attrName(id))}</button>`;
    };
    return `
      <div class="space-y-5 max-w-2xl">
        <div class="text-sm text-t-muted">Positions: <span class="text-white font-bold">${esc(posText)}</span>${multi ? ' <span class="text-[11px] text-feat-special">· optimizer maximizes the lowest listed-position OVR</span>' : ''}</div>
        <div class="space-y-3">
          <label class="block bg-app-bg border border-b-primary rounded-xl p-3 cursor-pointer">
            <div class="flex items-center gap-2 mb-2"><input type="radio" name="opt-mode" value="max" checked class="accent-btn-blue" /><span class="font-bold text-white">${multi ? 'Maximize lowest overall' : 'Maximize overall'} — given AP</span></div>
            <div class="flex items-center gap-2 pl-6"><span class="text-sm text-t-muted">Additional AP to spend:</span>
              <input id="opt-ap" type="number" min="0" value="${remaining}" aria-label="Additional AP to spend" class="w-28 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center" /></div>
            <div class="text-[11px] text-t-disabled pl-6 mt-1">You have ${remaining} AP remaining at level ${build.level}.</div>
          </label>
          <label class="block bg-app-bg border border-b-primary rounded-xl p-3 cursor-pointer">
            <div class="flex items-center gap-2 mb-2"><input type="radio" name="opt-mode" value="min" class="accent-btn-blue" /><span class="font-bold text-white">Minimum AP — given overall</span></div>
            <div class="flex items-center gap-2 pl-6"><span class="text-sm text-t-muted">Target overall${multi ? ' (selected position set)' : ''}:</span>
              <input id="opt-ovr" type="number" min="1" max="99" value="85" aria-label="Target overall" class="w-20 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center" /></div>
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
      let over = '';
      if (res.feasible && res.spent > remaining) {
        const need = d.ap.spent + res.spent;
        let lvl = build.level;
        while (lvl < D.maxLevel && C.totalAP(lvl) < need) lvl++;
        over = ` (over budget by ${res.spent - remaining} — needs level ${C.totalAP(lvl) >= need ? lvl : D.maxLevel + '+'})`;
      }
      msg = res.feasible
        ? `Est. OVR ${opts.targetOverall} reached · needs ${res.spent} AP${over} · ${proof}`
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
      return `<button data-sum-attr="${id}" aria-pressed="${!off}" class="opt-chip ${off ? 'opt-attr-off' : ''}">${esc(attrName(id))}</button>`;
    };
    const included = considered.filter((id) => !build.sumExcluded.includes(id)).length;
    return `
      <div class="space-y-5 max-w-2xl">
        <p class="text-sm text-t-muted">Distributes AP to <span class="text-white font-bold">maximize the total</span> of the chosen attributes — buys the cheapest points first (each archetype has its own per-attribute AP costs).</p>
        <div class="flex items-center gap-2">
          <span class="text-sm text-t-secondary font-medium">AP to spend:</span>
          <input id="sum-ap" type="number" min="0" value="${remaining}" aria-label="AP to spend" class="w-28 px-2 py-1 bg-app-card border border-b-primary rounded text-white text-center" />
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
  // targetPlan depende só do archetype (base/max/tier por atributo), nunca dos valores atuais —
  // então dá pra calcular uma vez por jogador em vez de 4k+ planos a cada tecla digitada.
  function utPlan(player, d) {
    if (!d.arch) return { cost: 0, capped: 0, values: {} };
    const cache = ui.utPlanCache && ui.utPlanCache.archetypeId === d.arch.id
      ? ui.utPlanCache
      : (ui.utPlanCache = { archetypeId: d.arch.id, byPlayer: new Map() });
    let plan = cache.byPlayer.get(player.id);
    if (!plan) { plan = C.targetPlan(d, player.attributes); cache.byPlayer.set(player.id, plan); }
    return plan;
  }
  function utBuildable(player, d) {
    const plan = utPlan(player, d);
    return { ...plan, buildable: plan.cost <= d.ap.total };
  }
  function utPlayersModal(d) {
    ensureUtPlayers();
    if (ui.utLoading) return `<div class="p-8 text-center text-t-muted">Loading UT players…</div>`;
    if (ui.utError) return `<div class="p-8 text-center text-state-error">Could not load UT players: ${esc(ui.utError)}</div>`;
    // Um archetype de linha não compra atributos de goleiro (e vice-versa), então cartas fora da
    // família de posições do archetype seriam aplicadas pela metade — melhor nem listar.
    const allowed = d.arch && d.arch.position === 'GK' ? ['GK'] : OUTFIELD_POSITIONS;
    const rows = (ui.utPlayers || []).filter((p) => p.positions.some((x) => allowed.includes(x)));
    const totalAP = d.ap.total;
    const q = ui.utQuery.trim().toLowerCase();
    const picked = ui.utPositions.filter((x) => allowed.includes(x));
    const matches = rows.filter((p) => {
      if (picked.length && !p.positions.some((x) => picked.includes(x))) return false;
      if (ui.utOnlyBuildable && utPlan(p, d).cost > totalAP) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.positions.join(' ').toLowerCase().includes(q) || String(p.overall) === q;
    });
    const buildableCount = matches.reduce((n, p) => n + (utPlan(p, d).cost <= totalAP ? 1 : 0), 0);
    const shown = matches.slice(0, UT_RENDER_LIMIT);

    const posChips = [`<button data-ut-pos="all" aria-pressed="${!picked.length}" class="ut-chip ${picked.length ? '' : 'is-on'}">All</button>`]
      .concat(allowed.map((p) => `<button data-ut-pos="${p}" aria-pressed="${picked.includes(p)}" class="ut-chip ${picked.includes(p) ? 'is-on' : ''}">${p}</button>`))
      .join('');
    const card = (p) => {
      const info = utBuildable(p, d);
      return `
        <button data-ut-player="${p.id}" ${info.buildable ? '' : 'disabled'} class="ut-card ${info.buildable ? 'ut-card-buildable' : 'ut-card-locked'}"
          data-ut-positions="${esc(p.positions.join(' '))}"
          aria-label="${esc(`${p.name}, overall ${p.overall}, ${p.positions.join(' / ')}, ${info.cost} AP${info.buildable ? ', buildable' : ', not enough AP'}`)}"
          title="${esc(p.name)} · ${esc(p.positions.join(' / '))} · ${info.cost} AP of ${totalAP} available${info.capped ? ` · ${info.capped} attribute(s) capped by the archetype` : ''}">
          <img loading="lazy" src="${esc(utImage(p))}" alt="${esc(`${p.name} — ${p.overall} ${p.positions.join(' / ')}`)}" />
        </button>`;
    };
    const list = shown.length
      ? `<div class="ut-list">${shown.map(card).join('')}</div>
         ${matches.length > shown.length ? `<p class="ut-more">Showing the first ${shown.length} of ${matches.length} — narrow it down with the search or the position filter.</p>` : ''}`
      : `<p class="ut-empty">No player matches these filters.${ui.utOnlyBuildable ? ' Try “All” to include players you cannot afford yet.' : ''}</p>`;

    return `
      <div class="space-y-3">
        <div class="ut-toolbar">
          <div class="ut-chips">${posChips}</div>
          <div class="flex items-center gap-2">
            <div class="seg">
              <button data-ut-only="1" aria-pressed="${ui.utOnlyBuildable}" class="${ui.utOnlyBuildable ? 'is-on' : ''}" title="Only players you can afford at level ${build.level}">Buildable</button>
              <button data-ut-only="0" aria-pressed="${!ui.utOnlyBuildable}" class="${ui.utOnlyBuildable ? '' : 'is-on'}" title="Every player in the 80+ dataset">All</button>
            </div>
            <input id="ut-search" type="search" value="${esc(ui.utQuery)}" placeholder="Search name, position, OVR"
              class="ut-search" />
          </div>
        </div>
        <div class="text-sm text-t-muted">
          <span class="text-white font-bold">${matches.length}</span> player${matches.length === 1 ? '' : 's'} listed ·
          buildable at level ${build.level}: <span class="text-state-success font-bold">${buildableCount}</span> ·
          AP total <span class="text-white font-bold">${totalAP}</span>
        </div>
        ${list}
      </div>`;
  }

  // -------------------- mutações --------------------
  function setArchetype(id) {
    const arch = C.archetype(id);
    const hadWork = Object.keys(build.attributes).length || build.playstyles.length || Object.keys(build.playstylePurchases || {}).length;
    const outcome = commitBuildChange(() => {
      build.archetypeId = id;
      build.attributes = {}; build.playstyles = []; build.playstylePurchases = {}; build.signatures = {};
      build.height = C.clamp(build.height, Math.ceil(arch.minHeight), Math.floor(arch.maxHeight));
      build.weight = C.clamp(build.weight, Math.ceil(arch.minWeight), Math.floor(arch.maxWeight));
      ui.selectedAttr = null;
    });
    if (outcome.changed && hadWork) toast('Archetype changed — attributes and PlayStyles reset · Ctrl+Z to undo');
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
  function playstyleSalePlan(id, d) {
    const receipt = build.playstylePurchases && build.playstylePurchases[id];
    if (!receipt) return { refund: 0, values: {} };

    const floors = {};
    const protectRequirements = (item) => {
      for (const requirement of (item && item.requirements) || []) {
        floors[requirement.attributeId] = Math.max(floors[requirement.attributeId] || 0, requirement.minValue);
      }
    };
    for (const playstyleId of build.playstyles) {
      if (playstyleId !== id) protectRequirements(C.playstyle(playstyleId));
    }
    for (const playstyleId of Object.keys(build.playstylePurchases || {})) {
      if (playstyleId !== id) protectRequirements(C.playstyle(playstyleId));
    }
    for (const specId of Object.values(build.signatures || {})) {
      protectRequirements(D.specializations.find((spec) => spec.id === specId));
    }

    let refund = 0;
    const values = {};
    for (const attrId of Object.keys(receipt.after || {})) {
      const attr = C.findAttr(d.categories, attrId);
      if (!attr) continue;
      const before = Number(receipt.before && receipt.before[attrId]);
      const after = Number(receipt.after[attrId]);
      const delta = Math.max(0, after - before);
      const target = Math.max(attr.baseValue, floors[attrId] || 0, attr.currentValue - delta);
      if (target >= attr.currentValue) continue;
      values[attrId] = target;
      refund += C.apCost(attr.tier, target, attr.currentValue);
    }
    return { refund, values };
  }
  function sellPlaystyle(id) {
    const d = C.derive(build);
    if (C.signatureSlots(build, d.categories).some((slot) => slot.playStyleId === id)) {
      return toast('Signature PlayStyles are equipped automatically and cannot be sold.');
    }
    const purchased = !!(build.playstylePurchases && build.playstylePurchases[id]);
    const equipped = build.playstyles.includes(id);
    if (!purchased && !equipped) return;
    const plan = playstyleSalePlan(id, d);
    commitBuildChange(() => {
      build.playstyles = build.playstyles.filter((playstyleId) => playstyleId !== id);
      if (build.playstylePurchases) delete build.playstylePurchases[id];
      for (const attrId of Object.keys(plan.values)) {
        const attr = C.findAttr(d.categories, attrId);
        if (!attr) continue;
        if (plan.values[attrId] <= attr.baseValue) delete build.attributes[attrId];
        else build.attributes[attrId] = plan.values[attrId];
      }
    });
    toast(`${psName(id)} sold · ${plan.refund} AP refunded`);
  }
  // Equipar é sempre explícito: o usuário clica um slot e escolhe. Quick Unlock só compra requisitos.
  function equipPlaystyle(id) {
    const d = C.derive(build);
    const ps = C.playstyle(id);
    if (!ps) return;
    if (C.signatureSlots(build, d.categories).some((slot) => slot.playStyleId === id)) {
      return toast('This Signature PlayStyle is already equipped.');
    }
    if (build.playstyles.includes(id)) return toast('Already equipped.');
    if (!C.playstyleEligible(ps, d.purchased)) return toast('Requirements not met yet.');
    if (build.playstyles.length >= d.slots.unlocked) return toast('No free PlayStyle slot.');
    commitBuildChange(() => { build.playstyles.push(id); ui.psPicker = false; });
    toast(`${psName(id)} equipped`);
  }
  function unequipPlaystyle(id) {
    const i = build.playstyles.indexOf(id);
    if (i < 0) return;
    commitBuildChange(() => { build.playstyles.splice(i, 1); });
    toast(`${psName(id)} removed`);
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
    if (C.signatureSlots(build, d.categories).some((slot) => slot.playStyleId === playstyleId)) {
      return toast('This Signature PlayStyle is already unlocked and equipped.');
    }
    if (build.playstyles.includes(playstyleId)) return toast('This PlayStyle is already equipped.');
    const plan = C.requirementUnlockPlan(ps, d.categories);
    if (!plan.feasible) return toast('This PlayStyle cannot be unlocked with this archetype.');
    if (plan.cost > d.ap.available) return toast(`Not enough AP (need ${plan.cost}, have ${Math.max(0, d.ap.available)})`);
    // Só compra os requisitos — NÃO ocupa slot. Equipar continua sendo uma escolha do usuário.
    const before = {}, after = {};
    for (const id of Object.keys(plan.values)) {
      const attr = C.findAttr(d.categories, id);
      if (!attr || plan.values[id] <= attr.currentValue) continue;
      before[id] = attr.currentValue;
      after[id] = plan.values[id];
    }
    commitBuildChange(() => {
      build.playstylePurchases = build.playstylePurchases || {};
      build.playstylePurchases[playstyleId] = { before, after };
      for (const id of Object.keys(plan.values)) {
        const attr = C.findAttr(d.categories, id);
        if (attr && plan.values[id] > attr.currentValue) build.attributes[id] = plan.values[id];
      }
    });
    toast(`${psName(playstyleId)} unlocked · ${plan.cost} AP · pick a slot to equip it`);
  }
  function assignSpec(specId, slot) {
    const specName = (id) => { const s = D.specializations.find((x) => x.id === id); return s ? s.name : id; };
    const previous = Object.values(build.signatures || {})[0];
    commitBuildChange(() => { build.signatures = { [slot]: specId }; });
    toast(previous && previous !== specId
      ? `Only one Specialization at a time — ${specName(previous)} was replaced`
      : `${specName(specId)} → signature slot ${slot + 1}`);
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
      build.playstylePurchases = {};
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

  // O slider de atributo é recriado a cada render, o que mataria o arrasto: durante o arrasto só
  // atualizamos o número; o valor entra no build (e no histórico) quando o usuário solta.
  function liveAttrRange(input) {
    const d = C.derive(build);
    const attr = C.findAttr(d.categories, ui.selectedAttr);
    if (!attr) return;
    const value = C.affordableTarget(attr, d.ap.available, parseInt(input.value, 10) || attr.baseValue);
    if (String(value) !== input.value) input.value = value;
    const readout = $('#attr-readout');
    if (readout) { readout.textContent = value; readout.style.color = C.barColor(value); }
  }

  // Mesma ideia pro corpo: um arrasto vira UMA entrada de histórico, não vinte.
  let bodyDragBefore = null;
  function commitBodyDrag() {
    if (!bodyDragBefore) return;
    const before = bodyDragBefore;
    bodyDragBefore = null;
    if (rememberBuildChange(before)) render();
  }
  function liveBody(kind, value) {
    if (!bodyDragBefore) bodyDragBefore = cloneBuild();
    if (build[kind] === value) return;
    build[kind] = value;
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
  function openModal(id) { ui.modal = id; ui.selectedAttr = null; ui.psPicker = false; render(); }
  function closeModal() {
    commitBodyDrag(); // fechar no meio de um arrasto (Esc) não pode deixar o snapshot pendurado
    if (ui.modal === 'optimize' && ui.optimizeController) {
      ui.optimizeRunId++;
      ui.optimizeController.abort();
      ui.optimizeController = null;
      ui.optimizing = false;
    }
    ui.modal = null;
    ui.psPicker = false;
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
      const t = e.target.closest('[data-arch],[data-filter],[data-pos],[data-modal],[data-modal-close],[data-attr],[data-disable-attr],[data-sum-attr],[data-ps-slot],[data-ps-pick],[data-ps-picker-close],[data-ps-unlock],[data-ps-sell],[data-spec-unlock],[data-spec-assign],[data-spec-revert],[data-ut-player],[data-ut-pos],[data-ut-only],[data-attr-inc],[data-attr-dec],[data-attr-base],[data-attr-maximize],#level-max,#btn-reset,#btn-undo,#btn-redo,#btn-share,#btn-image,#btn-weights,#btn-optimize,#opt-run,#btn-utplayers,#btn-maxsum,#sum-run,#sum-all,#sum-none');
      if (e.target.id === 'modal-root') return closeModal(); // clique no backdrop
      if (!t) return;
      // Os chips são preferência de otimizador, não estado de build: mudam a URL mas não gastam
      // uma entrada de desfazer (antes, marcar 20 atributos apagava o histórico real).
      if (t.dataset.disableAttr) { // alterna sem re-render (preserva inputs do modal)
        const id = t.dataset.disableAttr, i = build.disabledAttrs.indexOf(id);
        if (i >= 0) build.disabledAttrs.splice(i, 1); else build.disabledAttrs.push(id);
        t.classList.toggle('opt-attr-off');
        t.setAttribute('aria-pressed', String(!t.classList.contains('opt-attr-off')));
        syncUrl();
        return;
      }
      if (t.dataset.sumAttr) { // alterna inclusão no max-sum (sem re-render)
        const id = t.dataset.sumAttr, i = build.sumExcluded.indexOf(id);
        if (i >= 0) build.sumExcluded.splice(i, 1); else build.sumExcluded.push(id);
        t.classList.toggle('opt-attr-off');
        t.setAttribute('aria-pressed', String(!t.classList.contains('opt-attr-off')));
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.id === 'btn-maxsum') return openModal('maxsum');
      if (t.id === 'btn-utplayers') return openModal('utplayers');
      if (t.id === 'sum-run') return runMaxSum();
      if (t.id === 'sum-all') {
        build.sumExcluded = [];
        document.querySelectorAll('[data-sum-attr]').forEach((c) => { c.classList.remove('opt-attr-off'); c.setAttribute('aria-pressed', 'true'); });
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.id === 'sum-none') {
        build.sumExcluded = sumConsidered(C.derive(build)).slice();
        document.querySelectorAll('[data-sum-attr]').forEach((c) => { c.classList.add('opt-attr-off'); c.setAttribute('aria-pressed', 'false'); });
        updateSumCount();
        syncUrl();
        return;
      }
      if (t.dataset.arch) return setArchetype(t.dataset.arch);
      if (t.dataset.filter) { ui.filter = t.dataset.filter; return renderArchetypes(); }
      if (t.dataset.pos) return togglePosition(t.dataset.pos);
      if (t.id === 'btn-weights') { ui.showWeights = !ui.showWeights; return render(); }
      if (t.id === 'btn-optimize') return openModal('optimize');
      if (t.id === 'opt-run') return runOptimize();
      if (t.hasAttribute('data-modal')) return openModal(t.dataset.modal);
      if (t.hasAttribute('data-modal-close')) return closeModal();
      if (t.hasAttribute('data-attr')) {
        ui.selectedAttr = ui.selectedAttr === t.dataset.attr ? null : t.dataset.attr;
        render();
        // fora do desktop o painel fica embaixo de toda a grade — sem isso o toque parece não fazer nada
        if (ui.selectedAttr && !matchMedia('(min-width: 1024px)').matches) $('#panel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      if (t.hasAttribute('data-attr-inc')) return adjustAttr(ui.selectedAttr, +1);
      if (t.hasAttribute('data-attr-dec')) return adjustAttr(ui.selectedAttr, -1);
      if (t.hasAttribute('data-attr-base')) return adjustAttr(ui.selectedAttr, 0, 'base');
      if (t.hasAttribute('data-attr-maximize')) return adjustAttr(ui.selectedAttr, 0, 'max');
      if (t.dataset.psUnlock) return quickUnlockPlaystyle(t.dataset.psUnlock);
      if (t.dataset.psSell) return sellPlaystyle(t.dataset.psSell);
      if (t.dataset.psSlot != null) {
        const equipped = build.playstyles[+t.dataset.psSlot];
        if (equipped) return unequipPlaystyle(equipped);
        ui.psPicker = true;
        return refreshModal();
      }
      if (t.dataset.psPick) return equipPlaystyle(t.dataset.psPick);
      if (t.hasAttribute('data-ps-picker-close')) { ui.psPicker = false; return refreshModal(); }
      if (t.dataset.utPos) {
        const p = t.dataset.utPos;
        if (p === 'all') ui.utPositions = [];
        else {
          const i = ui.utPositions.indexOf(p);
          if (i >= 0) ui.utPositions.splice(i, 1); else ui.utPositions.push(p);
        }
        return refreshModal();
      }
      if (t.dataset.utOnly) { ui.utOnlyBuildable = t.dataset.utOnly === '1'; return refreshModal(); }
      if (t.dataset.specUnlock) return quickUnlockSpec(t.dataset.specUnlock);
      if (t.dataset.specAssign) return assignSpec(t.dataset.specAssign, +t.dataset.slot);
      if (t.dataset.specRevert) return revertSpec(t.dataset.specRevert);
      if (t.dataset.utPlayer) return applyUtPlayer(t.dataset.utPlayer);
      if (t.id === 'level-max') return commitBuildChange(() => { build.level = D.maxLevel; });
      if (t.id === 'btn-undo') return undoBuild();
      if (t.id === 'btn-redo') return redoBuild();
      if (t.id === 'btn-reset') {
        if (!confirm('Reset attributes, PlayStyles and Specializations? Player level is kept.')) return;
        commitBuildChange(() => {
          const { archetypeId, level } = build;
          build = Object.assign(defaultBuild(), { archetypeId, level });
        });
        return toast('Build reset · Ctrl+Z to undo');
      }
      if (t.id === 'btn-share') return doShare();
      if (t.id === 'btn-image') return doImage();
    });
    document.body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'level-input') {
        // Campo de texto (não number) pra poder devolver o cursor depois do re-render — Chrome
        // proíbe setSelectionRange em input[type=number] e o cursor voltava pro início a cada tecla.
        const raw = t.value.replace(/\D/g, '');
        if (raw !== t.value) t.value = raw;
        if (!raw) return; // vazio = apagando pra redigitar; só confirma quando há número
        return commitBuildChange(() => { build.level = C.clamp(parseInt(raw, 10) || 1, 1, D.maxLevel); });
      }
      if (t.id === 'ut-search') { ui.utQuery = t.value; return refreshModal(); }
      if (t.dataset.body) return liveBody(t.dataset.body, parseInt(t.value, 10));
      if (t.hasAttribute('data-attr-range')) return liveAttrRange(t);
    });
    document.body.addEventListener('change', (e) => {
      if (e.target.id === 'level-input') return render(); // devolve o valor normalizado ao sair do campo
      if (e.target.dataset.body) return commitBodyDrag();
      if (e.target.hasAttribute('data-attr-range')) return adjustAttr(ui.selectedAttr, parseInt(e.target.value, 10), 'set');
    });
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // só campos de digitação: com um slider focado Ctrl+Z continua desfazendo o build
      const typing = e.target.matches && e.target.matches('input:not([type="range"]), textarea, select');
      if (mod && key === 'z' && !e.shiftKey && !typing) { e.preventDefault(); return undoBuild(); }
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey)) && !typing) { e.preventDefault(); return redoBuild(); }
      if (e.key === 'Enter' && e.target.id === 'level-input') return e.target.blur();
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
