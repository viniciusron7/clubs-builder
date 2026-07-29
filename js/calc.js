/* ============================================================================
 * calc.js — Mecânicas do FC 26 Pro Clubs Builder (lógica pura, sem DOM).
 * Tudo revertido fielmente do app original (clubsbuilder.com).
 * Expõe window.Calc. Depende de window.DATA (data.js).
 * ========================================================================== */
window.Calc = (function () {
  const D = window.DATA;
  const byId = (arr, id) => arr.find((x) => x.id === id) || null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const NON_KEY_ATTRIBUTES = new Set(['skill_moves', 'weak_foot']);

  const archetype = (id) => byId(D.archetypes, id);
  const playstyle = (id) => byId(D.playstyles, id);

  // ---- atributos: categorias base com modifiers do archetype + desconto de tier p/ key ----
  function baseCategories(arch) {
    return D.categories.map((cat) => ({
      id: cat.id,
      attributes: cat.attributes.map((attr) => {
        const mod = arch ? arch.modifiers.find((m) => m.attributeId === attr.id) : null;
        const isKey = !!(arch && arch.keyAttributes.includes(attr.id) && !NON_KEY_ATTRIBUTES.has(attr.id));
        const noDiscount = !!(arch && (arch.noDiscountKeyAttributes || []).includes(attr.id));
        let tier = attr.tier;
        if (isKey && !noDiscount && D.keyTierDiscount[tier]) tier = D.keyTierDiscount[tier];
        return {
          id: attr.id,
          baseValue: mod ? mod.baseValue : attr.baseValue,
          maxValue: mod ? mod.maxValue : attr.maxValue,
          tier,
          isKeyAttribute: isKey,
          displayType: attr.displayType, // 'stars' em skill moves / weak foot (escala 2..5, não 1..99)
        };
      }),
    }));
  }

  // ---- AP (attribute points) ----
  function apCostAt(tier, value) {
    const t = D.apCostTable[tier];
    if (!t) return 1;
    const r = t.costRanges.find((x) => value >= x.minValue && value <= x.maxValue);
    return r ? r.apCost : 1;
  }
  // custo (com sinal) de mover um atributo de `base` para `current`
  function apCost(tier, base, current) {
    if (base === current) return 0;
    const up = current > base;
    const lo = up ? base + 1 : current + 1;
    const hi = up ? current : base;
    let sum = 0;
    for (let v = lo; v <= hi; v++) sum += apCostAt(tier, v);
    return up ? sum : -sum;
  }
  // total de AP disponível para um nível (100 base + ganho por nível, cap no nível 100)
  function totalAP(level) {
    if (level < 1) return D.apBase;
    const cap = Math.min(level, D.apLevelCap);
    let t = D.apBase;
    for (let a = 2; a <= cap; a++) t += D.levelApTable[a] || 0;
    return t;
  }
  // AP necessário para subir +1 a partir do valor atual (ou null se já no max)
  function apCostNextPoint(attr) {
    if (attr.currentValue >= attr.maxValue) return null;
    return apCostAt(attr.tier, attr.currentValue + 1);
  }
  // maior valor alcançável a partir do atual dado o AP disponível (não deixa o AP ficar negativo).
  // baixar sempre é permitido (devolve AP).
  function affordableTarget(attr, available, requested) {
    const target = Math.min(requested, attr.maxValue);
    if (target <= attr.currentValue) return Math.max(target, attr.baseValue);
    let reached = attr.currentValue, spent = 0;
    for (let v = attr.currentValue + 1; v <= target; v++) {
      const c = apCostAt(attr.tier, v);
      if (spent + c > available) break;
      spent += c; reached = v;
    }
    return reached;
  }

  // ---- corpo (altura/peso) -> ajuste por atributo afetado ----
  function bodyAdjustments(arch, height, weight) {
    const map = {};
    if (!arch) return map;
    const isGK = arch.position === 'GK';
    const affected = isGK ? D.gkAffectedAttributes : D.affectedAttributes;
    const refH = (arch.minHeight + arch.maxHeight) / 2;
    const refW = (arch.minWeight + arch.maxWeight) / 2;
    const dh = height - refH;
    const dw = weight - refW;
    const t = Math.ceil(Math.abs(dh) / 4) * Math.sign(dh);
    const s = Math.ceil(Math.abs(dw) / 8) * Math.sign(dw);
    // ordem dos arrays casa com AFFECTED/GK_AFFECTED_ATTRIBUTE_IDS
    const hp = isGK ? [t, -t, t, -t, t, t] : [-t, -t, -t, t, t, t];
    const wp = isGK ? [-s, s, -s, -s, -s, s] : [-s, -s, s, s, -s, s];
    affected.forEach((id, i) => { map[id] = hp[i] + wp[i]; });
    return map;
  }

  // AcceleRATE — portado verbatim. Recebe valores JÁ ajustados pelo corpo + altura.
  function accelType(agility, strength, acceleration, height) {
    if (agility >= 65 && agility - strength >= 10 && acceleration >= 80 && height <= 184) return 'EXPLOSIVE';
    if (strength >= 65 && strength - agility >= 4 && acceleration >= 40 && height >= 185) return 'LENGTHY';
    return 'CONTROLLED';
  }

  // ---- playstyles ----
  function playstyleEligible(ps, purchased) {
    if (!ps.requirements || !ps.requirements.length) return true;
    return ps.requirements.every((r) => (purchased[r.attributeId] || 0) >= r.minValue);
  }
  const unlockedSlots = (level) => D.slotUnlockLevels.filter((l) => level >= l).length;
  // índice do slot de signature (0-3) que vira "+" para o nível dado
  function signaturePlusCount(level) {
    return D.signaturePlusLevels.filter((l) => level >= l).length;
  }

  // ---- signature playstyles + specializations ----
  const archetypeSpecializations = (archetypeId) => D.specializations.filter((s) => s.archetypeId === archetypeId);

  function curVal(cats, id) {
    for (const c of cats) for (const a of c.attributes) if (a.id === id) return a.currentValue;
    return 0;
  }
  function findAttr(cats, id) {
    for (const c of cats) for (const a of c.attributes) if (a.id === id) return a;
    return null;
  }
  // specialization desbloqueada quando os requisitos (valor atual >= min) são atingidos
  function specializationUnlocked(spec, cats) {
    return spec.requirements.every((r) => curVal(cats, r.attributeId) >= r.minValue);
  }
  // Plano central de Quick Unlock para PlayStyles e Specializations.
  function requirementUnlockPlan(item, cats) {
    const targets = {};
    for (const requirement of (item && item.requirements) || []) {
      const attr = findAttr(cats, requirement.attributeId);
      const required = Math.round(+requirement.minValue);
      if (!attr || !Number.isFinite(required) || required > attr.maxValue) {
        return { feasible: false, cost: 0, values: {}, missing: requirement.attributeId };
      }
      targets[attr.id] = Math.max(targets[attr.id] || attr.currentValue, required);
    }

    let cost = 0;
    const values = {};
    for (const id of Object.keys(targets)) {
      const attr = findAttr(cats, id);
      const target = Math.max(attr.currentValue, targets[id]);
      values[id] = target;
      cost += apCost(attr.tier, attr.currentValue, target);
    }
    return { feasible: true, cost, values, missing: null };
  }

  function quickUnlockCost(item, cats) {
    return requirementUnlockPlan(item, cats).cost;
  }
  // os 4 slots de signature: default = recomendados; podem ser trocados por specialization
  function signatureSlots(build, cats) {
    const rec = D.recommended[build.archetypeId] || [];
    const sigs = build.signatures || {};
    return [0, 1, 2, 3].map((slot) => {
      let playStyleId = rec[slot] || null;
      let specialization = null;
      const specId = sigs[slot];
      if (specId) {
        const sp = D.specializations.find((s) => s.id === specId);
        if (sp && specializationUnlocked(sp, cats)) { playStyleId = sp.playStyleId; specialization = sp; }
      }
      return { slot, playStyleId, specialization, isPlus: build.level >= D.signaturePlusLevels[slot], plusLevel: D.signaturePlusLevels[slot] };
    });
  }

  // ---- cor da barra por valor ----
  function barColor(v) {
    for (const [threshold, color] of D.barColors) if (v >= threshold) return color;
    return D.barColors[D.barColors.length - 1][1];
  }

  // ---- OVR estimate by highlighted position (weights.js v2) ----
  // Builder ids differ from the model for two historical attributes.
  const PESO_KEY = { att_position: 'att_positioning', def_aware: 'defensive_awareness' };
  const OVR_EPS = 1e-9;
  const OVR_MICRO_SCALE = 1000000;
  const overallModel = () => window.OVERALL_MODEL || {};
  const legacyWeights = () => window.OVERALL_WEIGHTS || {};
  function overallOffset() {
    const offset = Number(overallModel().gameCalibrationOffset);
    return Number.isFinite(offset) ? offset : 0;
  }
  function rawThresholdForOverall(overall) {
    return overall - overallOffset();
  }
  function normalizePositions(positions) {
    if (!positions) return [];
    const list = Array.isArray(positions) ? positions : [positions];
    const out = [];
    list.forEach((p) => { if (p && formulaFor(p) && !out.includes(p)) out.push(p); });
    return out;
  }
  function formulaFor(pos) {
    const M = overallModel();
    if (M.positions && M.positions[pos]) return M.positions[pos];
    const W = legacyWeights()[pos];
    if (!W) return null;
    return { intercept: W.intercepto_b || 0, weights: W.pesos || {} };
  }
  function pesoFor(pos, attrId) {
    const f = formulaFor(pos);
    if (!f) return 0;
    return f.weights[PESO_KEY[attrId] || attrId] || 0;
  }
  function pesoForPositions(positions, attrId) {
    const first = normalizePositions(positions)[0];
    return first ? pesoFor(first, attrId) : 0;
  }
  function overallRawForPosition(pos, derived, values) {
    const f = formulaFor(pos);
    if (!f) return 0;
    let s = f.intercept || 0;
    for (const c of derived.categories) for (const a of c.attributes) {
      const w = f.weights[PESO_KEY[a.id] || a.id] || 0;
      if (w) s += w * (values && values[a.id] != null ? values[a.id] : a.currentValue);
    }
    return s;
  }
  function overallRawForPositions(positions, derived) {
    const list = normalizePositions(positions);
    return list.length ? Math.min(...list.map((pos) => overallRawForPosition(pos, derived))) : 0;
  }
  function overallRawForValues(positions, derived, values) {
    const list = normalizePositions(positions);
    return list.length ? Math.min(...list.map((pos) => overallRawForPosition(pos, derived, values))) : 0;
  }
  function overallFromRaw(raw) {
    const limits = overallModel().limits || { min: 1, max: 99 };
    return clamp(Math.floor(raw + OVR_EPS) + overallOffset(), limits.min, limits.max);
  }
  function overallForPositions(positions, derived) {
    const map = overallMapForValues(positions, derived, null);
    return minOverallFromMap(map);
  }
  function overallForPosition(pos, derived) {
    return overallFromRaw(overallRawForPosition(pos, derived));
  }
  function overallIfPrimary(pos, positions, derived) {
    return overallForPosition(pos, derived);
  }
  function overallMapForValues(positions, derived, values) {
    const overalls = {};
    normalizePositions(positions).forEach((pos) => {
      overalls[pos] = overallFromRaw(overallRawForPosition(pos, derived, values));
    });
    return overalls;
  }
  // Perfil de peso exibido pela interface. Em seleção múltipla, combina todas as
  // posições pela média dos coeficientes. Assim o perfil representa o ganho conjunto
  // de OVR e nunca muda silenciosamente para apenas uma das posições selecionadas.
  function overallWeightProfile(positions, derived) {
    const list = normalizePositions(positions);
    const overalls = derived ? overallMapForValues(list, derived, null) : {};
    const minimum = list.length && derived ? Math.min(...list.map((pos) => overalls[pos])) : 0;
    const limitingPositions = list.length <= 1 || !derived
      ? list.slice()
      : list.filter((pos) => overalls[pos] === minimum);
    const weightedPositions = list.slice();
    const weights = {};
    if (derived) {
      for (const category of derived.categories) for (const attr of category.attributes) {
        weights[attr.id] = weightedPositions.length
          ? weightedPositions.reduce((sum, pos) => sum + pesoFor(pos, attr.id), 0) / weightedPositions.length
          : 0;
      }
    }
    return {
      mode: list.length > 1 ? 'minmax' : 'single',
      positions: list,
      weightedPositions,
      limitingPositions,
      overalls,
      minimum,
      weights,
    };
  }
  function minOverallFromMap(overalls) {
    const vals = Object.values(overalls);
    return vals.length ? Math.min(...vals) : 0;
  }

  function upgradeOptions(a) {
    const options = [{ k: 0, cost: 0, gain: 0, gains: (a.weights || []).map(() => 0) }];
    let cost = 0, gain = 0;
    const gains = (a.weights || []).map(() => 0);
    for (let v = a.val + 1; v <= a.max; v++) {
      cost += apCostAt(a.tier, v);
      gain += a.w;
      (a.weights || []).forEach((w, i) => { gains[i] += w; });
      options.push({ k: v - a.val, cost, gain, gains: gains.slice() });
    }
    return options;
  }
  function exactUpgradePlan(attrs, budget, requiredGain) {
    const cappedBudget = Math.max(0, Math.floor(budget));
    const dpRows = [];
    const prevRows = [];
    let dp = Array(cappedBudget + 1).fill(-Infinity);
    dp[0] = 0;
    dpRows.push(dp);

    attrs.forEach((a, idx) => {
      const prev = dp;
      const next = Array(cappedBudget + 1).fill(-Infinity);
      const back = Array(cappedBudget + 1).fill(null);
      for (let b = 0; b <= cappedBudget; b++) {
        const baseGain = prev[b];
        if (baseGain === -Infinity) continue;
        for (const opt of upgradeOptions(a)) {
          const nb = b + opt.cost;
          if (nb > cappedBudget) break;
          const gain = baseGain + opt.gain;
          if (gain > next[nb] + OVR_EPS) {
            next[nb] = gain;
            back[nb] = { prevBudget: b, k: opt.k };
          }
        }
      }
      dp = next;
      dpRows.push(dp);
      prevRows[idx] = back;
    });

    let chosenBudget = -1;
    let feasible = true;
    if (requiredGain != null) {
      for (let b = 0; b <= cappedBudget; b++) {
        if (dp[b] >= requiredGain - OVR_EPS) { chosenBudget = b; break; }
      }
    } else {
      let bestGain = -Infinity;
      for (let b = 0; b <= cappedBudget; b++) {
        if (dp[b] > bestGain + OVR_EPS) {
          bestGain = dp[b];
          chosenBudget = b;
        }
      }
    }
    if (chosenBudget < 0) {
      feasible = false;
      let bestGain = -Infinity;
      for (let b = 0; b <= cappedBudget; b++) {
        if (dp[b] > bestGain + OVR_EPS) {
          bestGain = dp[b];
          chosenBudget = b;
        }
      }
    }
    if (chosenBudget < 0) return { feasible: false, added: 0, gain: 0, values: {} };

    const increments = Array(attrs.length).fill(0);
    let b = chosenBudget;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const step = prevRows[i][b];
      if (!step) return { feasible: false, added: 0, gain: 0, values: {} };
      increments[i] = step.k;
      b = step.prevBudget;
    }
    const values = {};
    attrs.forEach((a, i) => { values[a.id] = a.val + increments[i]; });
    return { feasible, added: chosenBudget, gain: dpRows[attrs.length][chosenBudget], values };
  }
  function exactMaxOverallPlan(attrs, budget, baseRaw) {
    const cappedBudget = Math.max(0, Math.floor(budget));
    const dpRows = [];
    const prevRows = [];
    let dp = Array(cappedBudget + 1).fill(-Infinity);
    dp[0] = 0;
    dpRows.push(dp);

    attrs.forEach((a, idx) => {
      const prev = dp;
      const next = Array(cappedBudget + 1).fill(-Infinity);
      const back = Array(cappedBudget + 1).fill(null);
      for (let b = 0; b <= cappedBudget; b++) {
        const baseGain = prev[b];
        if (baseGain === -Infinity) continue;
        for (const opt of upgradeOptions(a)) {
          const nb = b + opt.cost;
          if (nb > cappedBudget) break;
          const gain = baseGain + opt.gain;
          if (gain > next[nb] + OVR_EPS) {
            next[nb] = gain;
            back[nb] = { prevBudget: b, k: opt.k };
          }
        }
      }
      dp = next;
      dpRows.push(dp);
      prevRows[idx] = back;
    });

    let chosenBudget = 0;
    let bestOverall = overallFromRaw(baseRaw);
    let bestGain = 0;
    for (let b = 0; b <= cappedBudget; b++) {
      if (dp[b] === -Infinity) continue;
      const ovr = overallFromRaw(baseRaw + dp[b]);
      if (ovr > bestOverall || (ovr === bestOverall && b < chosenBudget) || (ovr === bestOverall && b === chosenBudget && dp[b] > bestGain)) {
        bestOverall = ovr;
        chosenBudget = b;
        bestGain = dp[b];
      }
    }

    const increments = Array(attrs.length).fill(0);
    let b = chosenBudget;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const step = prevRows[i][b];
      if (!step) return { feasible: false, added: 0, gain: 0, values: {} };
      increments[i] = step.k;
      b = step.prevBudget;
    }
    const values = {};
    attrs.forEach((a, i) => { values[a.id] = a.val + increments[i]; });
    return { feasible: true, added: chosenBudget, gain: bestGain, values };
  }
  function fastMaxMinPlan(attrs, budget, baseRaws, targetOverall) {
    const cappedBudget = Math.max(0, Math.floor(budget));
    const work = attrs.map((a) => ({ ...a, weights: (a.weights || []).slice() }));
    const raws = baseRaws.slice();
    let added = 0;
    const currentValues = Object.fromEntries(work.map((a) => [a.id, a.val]));
    const minFloor = () => Math.min(...raws.map(overallFromRaw));
    const minRaw = () => Math.min(...raws);
    const rawSum = () => raws.reduce((s, v) => s + v, 0);

    while (targetOverall == null || minFloor() < targetOverall) {
      let best = null;
      const beforeFloor = minFloor();
      const beforeRawMin = minRaw();
      const beforeSum = rawSum();
      for (const a of work) {
        if (a.val >= a.max) continue;
        const cost = apCostAt(a.tier, a.val + 1);
        if (added + cost > cappedBudget) continue;
        const nextRaws = raws.map((r, i) => r + (a.weights[i] || 0));
        const nextFloor = Math.min(...nextRaws.map(overallFromRaw));
        const nextRawMin = Math.min(...nextRaws);
        const nextSum = nextRaws.reduce((s, v) => s + v, 0);
        const score = ((nextFloor - beforeFloor) * 1000000)
          + ((nextRawMin - beforeRawMin) * 1000)
          + (nextSum - beforeSum);
        const ratio = score / cost;
        if (score <= OVR_EPS) continue;
        if (!best || ratio > best.ratio + OVR_EPS || (Math.abs(ratio - best.ratio) <= OVR_EPS && score > best.score)) {
          best = { a, cost, score, ratio, nextRaws };
        }
      }
      if (!best) break;
      best.a.val++;
      currentValues[best.a.id] = best.a.val;
      best.nextRaws.forEach((v, i) => { raws[i] = v; });
      added += best.cost;
    }

    return {
      feasible: targetOverall == null || minFloor() >= targetOverall,
      added,
      values: currentValues,
      rawScore: Math.min(...raws),
    };
  }

  function multiWorkerProblem(attrs, budget, baseRaws, mode, targetOverall) {
    // Outfield weights/intercepts use six decimal places. Keeping a parallel
    // integer representation lets the exact AP-polish phase avoid solver
    // tolerances at OVR floor boundaries.
    const exactMicro = Number.isInteger(overallOffset())
      && baseRaws.every((raw) =>
      Math.abs(raw * OVR_MICRO_SCALE - Math.round(raw * OVR_MICRO_SCALE)) < 1e-4)
      && attrs.every((attr) => attr.weights.every((weight) =>
        Math.abs(weight * OVR_MICRO_SCALE - Math.round(weight * OVR_MICRO_SCALE)) < 1e-6));
    return {
      mode,
      budget: Math.max(0, Math.floor(budget)),
      baseRaws,
      baseRawUnits: exactMicro ? baseRaws.map((raw) => Math.round(raw * OVR_MICRO_SCALE)) : null,
      exactMicro,
      overallOffset: overallOffset(),
      targetOverall: targetOverall == null ? null : clamp(Math.floor(targetOverall), 1, 99),
      stateLimit: 250000,
      timeLimitMs: 2000,
      attrs: attrs.map((a) => ({
        id: a.id,
        value: a.val,
        options: upgradeOptions(a).map((opt) => ({
          value: a.val + opt.k,
          cost: opt.cost,
          gains: opt.gains,
          gainUnits: exactMicro
            ? a.weights.map((weight) => Math.round(weight * OVR_MICRO_SCALE) * opt.k)
            : null,
        })),
      })),
    };
  }

  function multiPlanEvaluation(attrs, baseRaws, values) {
    const raws = baseRaws.slice();
    attrs.forEach((attr) => {
      const delta = Math.max(0, (values[attr.id] == null ? attr.val : values[attr.id]) - attr.val);
      attr.weights.forEach((weight, index) => { raws[index] += delta * weight; });
    });
    const overalls = raws.map(overallFromRaw);
    return {
      min: overalls.length ? Math.min(...overalls) : 0,
      sum: overalls.reduce((total, overall) => total + overall, 0),
    };
  }

  // Resolve exatamente uma combinação linear dos OVRs. Embora uma única combinação linear
  // não prove o ótimo max-min discreto, ela produz candidatos Pareto fortes e determinísticos
  // em O(atributos × AP × opções), sem explodir o espaço multidimensional.
  function exactWeightedMultiPlan(attrs, budget, coefficients) {
    const cappedBudget = Math.max(0, Math.floor(budget));
    let dp = new Float64Array(cappedBudget + 1);
    dp.fill(-Infinity);
    dp[0] = 0;
    const backRows = [];
    const optionRows = [];

    attrs.forEach((attr) => {
      const options = upgradeOptions(attr);
      const scalarOptions = options.map((option) => ({
        ...option,
        scalarGain: option.gains.reduce((sum, gain, index) => sum + gain * (coefficients[index] || 0), 0),
      }));
      const next = new Float64Array(cappedBudget + 1);
      next.fill(-Infinity);
      const back = new Int16Array(cappedBudget + 1);
      back.fill(-1);
      for (let currentBudget = 0; currentBudget <= cappedBudget; currentBudget++) {
        const currentGain = dp[currentBudget];
        if (currentGain === -Infinity) continue;
        for (let optionIndex = 0; optionIndex < scalarOptions.length; optionIndex++) {
          const option = scalarOptions[optionIndex];
          const nextBudget = currentBudget + option.cost;
          if (nextBudget > cappedBudget) break;
          const nextGain = currentGain + option.scalarGain;
          if (nextGain > next[nextBudget]) {
            next[nextBudget] = nextGain;
            back[nextBudget] = optionIndex;
          }
        }
      }
      dp = next;
      backRows.push(back);
      optionRows.push(scalarOptions);
    });

    let chosenBudget = 0;
    for (let currentBudget = 1; currentBudget <= cappedBudget; currentBudget++) {
      if (dp[currentBudget] > dp[chosenBudget]) chosenBudget = currentBudget;
    }
    const values = {};
    let remainingBudget = chosenBudget;
    for (let index = attrs.length - 1; index >= 0; index--) {
      const optionIndex = backRows[index][remainingBudget];
      if (optionIndex < 0) {
        return {
          feasible: true,
          added: 0,
          values: Object.fromEntries(attrs.map((attr) => [attr.id, attr.val])),
        };
      }
      const option = optionRows[index][optionIndex];
      values[attrs[index].id] = option.value == null ? attrs[index].val + option.k : option.value;
      remainingBudget -= option.cost;
    }
    return { feasible: true, added: chosenBudget, values, scalarGain: dp[chosenBudget] };
  }

  function fallbackMultiPlan(attrs, budget, baseRaws, mode, targetOverall) {
    const greedyPlan = fastMaxMinPlan(attrs, budget, baseRaws, mode === 'min' ? targetOverall : null);
    if (mode !== 'max' || !baseRaws.length) return { ...greedyPlan, status: 'best-found' };

    const monotoneWeights = attrs.every((attr) => attr.weights.every((weight) => weight >= 0));
    const candidates = [greedyPlan];
    const equal = baseRaws.map(() => 1);
    const coefficientSets = [equal];
    if (baseRaws.length <= 3) {
      // Duplas precisam de razões mais finas; trios usam a grade simplex completa de
      // 45 pontos. Isso cobre distribuições não encontradas por "peso igual + um destaque".
      const total = baseRaws.length === 2 ? 16 : 8;
      const compose = (remaining, index, values) => {
        if (index === baseRaws.length - 1) {
          coefficientSets.push(values.concat(remaining));
          return;
        }
        for (let value = 0; value <= remaining; value++) compose(remaining - value, index + 1, values.concat(value));
      };
      compose(total, 0, []);
    } else {
      for (let index = 0; index < baseRaws.length; index++) {
        const medium = equal.slice();
        medium[index] = 2;
        coefficientSets.push(medium);
        const strong = equal.slice();
        strong[index] = 4;
        coefficientSets.push(strong);
      }
      // Para seleções maiores, cobre também interações entre pares limitantes sem
      // gerar a grade simplex combinatória inteira.
      for (let first = 0; first < baseRaws.length; first++) {
        for (let second = first + 1; second < baseRaws.length; second++) {
          const pair = equal.slice();
          pair[first] = 3;
          pair[second] = 3;
          coefficientSets.push(pair);
        }
      }
    }
    const seenCoefficients = new Set();
    let rawSumUpper = null;
    coefficientSets.forEach((coefficients) => {
      const key = coefficients.join(',');
      if (seenCoefficients.has(key)) return;
      seenCoefficients.add(key);
      const candidate = exactWeightedMultiPlan(attrs, budget, coefficients);
      candidates.push(candidate);
      if (monotoneWeights && coefficients.every((coefficient) => coefficient === 1)) {
        rawSumUpper = baseRaws.reduce((sum, raw) => sum + raw, 0) + candidate.scalarGain;
      }
    });

    let best = null;
    let bestEvaluation = null;
    candidates.forEach((candidate) => {
      const evaluation = multiPlanEvaluation(attrs, baseRaws, candidate.values);
      const spent = optimizerAddedCost(attrs, candidate.values);
      if (!best
        || evaluation.min > bestEvaluation.min
        || (evaluation.min === bestEvaluation.min && evaluation.sum > bestEvaluation.sum)
        || (evaluation.min === bestEvaluation.min && evaluation.sum === bestEvaluation.sum && spent < best.added)) {
        best = { ...candidate, added: spent };
        bestEvaluation = evaluation;
      }
    });
    let sumUpper = null;
    if (rawSumUpper != null) {
      const limits = overallModel().limits || { min: 1, max: 99 };
      const offset = overallOffset();
      // Σfloor(rawᵢ + EPS) <= floor(Σrawᵢ + n·EPS). The lower-clamp
      // correction makes this a universal upper bound, including synthetic
      // formulas whose baseline raw score is below the model minimum.
      const lowerClampCorrection = baseRaws.reduce((correction, raw) => {
        const baselineUnclamped = Math.floor(raw + OVR_EPS) + offset;
        return correction + Math.max(0, limits.min - baselineUnclamped);
      }, 0);
      const rawFloorUpper = Math.floor(rawSumUpper + baseRaws.length * OVR_EPS)
        + baseRaws.length * offset;
      sumUpper = Math.min(baseRaws.length * limits.max, rawFloorUpper + lowerClampCorrection);
    }
    return { ...best, sumUpper, status: 'best-found' };
  }

  function optimizerAbortError() {
    const error = new Error('Optimization cancelled');
    error.name = 'AbortError';
    return error;
  }

  function runMultiWorker(problem, fallback, signal) {
    if (signal && signal.aborted) return Promise.reject(optimizerAbortError());
    if (typeof Worker === 'undefined') return Promise.resolve(fallback());
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/optimizer-worker.js');
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', cancel);
        worker.terminate();
      };
      const finish = (result, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve(result);
      };
      const workerGraceMs = problem.polish ? 10000 : 750;
      const timer = setTimeout(() => finish(fallback()), problem.timeLimitMs + workerGraceMs);
      const cancel = () => finish(null, optimizerAbortError());
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      worker.onmessage = (event) => finish(event.data && event.data.ok ? event.data.result : fallback());
      worker.onerror = () => finish(fallback());
      worker.postMessage(problem);
    });
  }

  function normalizedOptimizerValues(attrs, source) {
    return Object.fromEntries(attrs.map((attr) => {
      const requested = source && Number.isFinite(+source[attr.id]) ? Math.round(+source[attr.id]) : attr.val;
      return [attr.id, clamp(requested, attr.val, attr.max)];
    }));
  }

  function optimizerAddedCost(attrs, values) {
    return attrs.reduce((total, attr) => total + apCost(attr.tier, attr.val, values[attr.id]), 0);
  }

  function optimizerObjective(positions, derived, values) {
    const overalls = overallMapForValues(positions, derived, values);
    const list = Object.values(overalls);
    return {
      overalls,
      min: list.length ? Math.min(...list) : 0,
      sum: list.reduce((total, overall) => total + overall, 0),
    };
  }

  function trimOptimizerValues(attrs, positions, derived, sourceValues, mode, targetOverall) {
    const values = { ...sourceValues };
    let objective = optimizerObjective(positions, derived, values);
    while (true) {
      let selected = null;
      for (const attr of attrs) {
        const value = values[attr.id];
        if (value <= attr.val) continue;
        values[attr.id] = value - 1;
        const candidate = optimizerObjective(positions, derived, values);
        values[attr.id] = value;
        const preserves = mode === 'min'
          ? candidate.min >= targetOverall
          : candidate.min === objective.min && candidate.sum === objective.sum;
        if (!preserves) continue;
        const refund = apCostAt(attr.tier, value);
        if (!selected || refund > selected.refund
          || (refund === selected.refund && candidate.sum > selected.objective.sum)
          || (refund === selected.refund && candidate.sum === selected.objective.sum && attr.id < selected.attr.id)) {
          selected = { attr, refund, objective: candidate };
        }
      }
      if (!selected) break;
      values[selected.attr.id]--;
      objective = selected.objective;
    }
    return { values, ...objective, spent: optimizerAddedCost(attrs, values) };
  }

  // opts: { positions, mode:'max'|'min', additionalAP, targetOverall, disabled }
  async function optimize(derived, opts) {
    const positions = normalizePositions(opts.positions);
    const disabled = new Set(opts.disabled || []);
    if (!positions.length) return { values: {}, added: 0, spent: 0, feasible: false, status: 'optimal', overalls: {}, objective: { min: 0, sum: 0 }, min: 0, overall: 0 };
    const multi = positions.length > 1;
    const attrs = [];
    for (const c of derived.categories) for (const a of c.attributes) {
      const weights = positions.map((pos) => pesoFor(pos, a.id));
      const w = weights[0] || 0;
      if (weights.some((x) => x > 0) && !disabled.has(a.id)) {
        attrs.push({ id: a.id, tier: a.tier, max: a.maxValue, base: a.baseValue, val: a.currentValue, w, weights });
      }
    }
    const maxPossibleCost = attrs.reduce((sum, a) => sum + apCost(a.tier, a.val, a.max), 0);
    const baseRaws = positions.map((pos) => overallRawForPosition(pos, derived));
    const currentValues = Object.fromEntries(attrs.map((attr) => [attr.id, attr.val]));
    const maximumValues = Object.fromEntries(attrs.map((attr) => [attr.id, attr.max]));
    const currentObjective = optimizerObjective(positions, derived, currentValues);
    const maximumObjective = optimizerObjective(positions, derived, maximumValues);
    const mode = opts.mode === 'min' ? 'min' : 'max';
    const target = mode === 'min' ? clamp(Math.floor(opts.targetOverall || 1), 1, 99) : null;
    let plan;
    let planBudget;
    let repaired = false;
    let maxSumUpper = null;
    if (mode === 'min' && currentObjective.min >= target) {
      plan = { feasible: true, values: currentValues, added: 0, status: 'optimal' };
      planBudget = 0;
    } else if (mode === 'min' && maximumObjective.min < target) {
      plan = multi
        ? { feasible: false, values: maximumValues, added: maxPossibleCost, status: 'optimal' }
        : { ...exactMaxOverallPlan(attrs, maxPossibleCost, baseRaws[0]), feasible: false, status: 'optimal' };
      planBudget = maxPossibleCost;
    } else if (mode === 'max' && multi) {
      const budget = Math.min(Math.max(0, opts.additionalAP || 0), maxPossibleCost);
      const problem = multiWorkerProblem(attrs, budget, baseRaws, 'max', null);
      const fallback = fallbackMultiPlan(attrs, budget, baseRaws, 'max', null);
      problem.seedValues = fallback.values;
      maxSumUpper = fallback.sumUpper;
      if (problem.exactMicro && maxSumUpper != null) {
        problem.polish = {
          targetMin: maximumObjective.min,
          targetSum: maxSumUpper,
          maximumOveralls: positions.map((position) => maximumObjective.overalls[position]),
          scale: OVR_MICRO_SCALE,
          timeLimitSeconds: 5,
        };
      }
      planBudget = budget;
      plan = await runMultiWorker(problem, () => fallback, opts.signal);
    } else if (mode === 'max') {
      planBudget = Math.min(Math.max(0, opts.additionalAP || 0), maxPossibleCost);
      plan = { ...exactMaxOverallPlan(attrs, planBudget, baseRaws[0]), status: 'optimal' };
    } else if (multi) {
      const problem = multiWorkerProblem(attrs, maxPossibleCost, baseRaws, 'min', target);
      planBudget = maxPossibleCost;
      plan = await runMultiWorker(problem, () => fallbackMultiPlan(attrs, maxPossibleCost, baseRaws, 'min', target), opts.signal);
    } else {
      planBudget = maxPossibleCost;
      const requiredGain = rawThresholdForOverall(target) - baseRaws[0];
      plan = requiredGain <= OVR_EPS
        ? { feasible: true, added: 0, gain: 0, values: Object.fromEntries(attrs.map((a) => [a.id, a.val])), status: 'optimal' }
        : { ...exactUpgradePlan(attrs, maxPossibleCost, requiredGain), status: 'optimal' };
    }

    let values = normalizedOptimizerValues(attrs, plan.values);
    let spent = optimizerAddedCost(attrs, values);
    if (spent > planBudget) {
      const fallback = multi
        ? fallbackMultiPlan(attrs, planBudget, baseRaws, mode, target)
        : { feasible: true, values: currentValues, added: 0, status: 'best-found' };
      values = normalizedOptimizerValues(attrs, fallback.values);
      plan = fallback;
      spent = optimizerAddedCost(attrs, values);
      repaired = true;
    }

    let objective = optimizerObjective(positions, derived, values);
    let feasible = mode === 'max' || objective.min >= target;
    if (mode === 'min' && !feasible && maximumObjective.min >= target) {
      values = { ...maximumValues };
      objective = { ...maximumObjective };
      feasible = true;
      repaired = true;
    }

    const trimMode = mode === 'min' && feasible ? 'min' : 'max';
    const trimmed = trimOptimizerValues(attrs, positions, derived, values, trimMode, target);
    values = trimmed.values;
    spent = trimmed.spent;
    objective = { overalls: trimmed.overalls, min: trimmed.min, sum: trimmed.sum };
    feasible = mode === 'max' || objective.min >= target;
    let status = repaired ? 'best-found' : (plan.status || 'best-found');
    // Todos os atributos no máximo limitam o melhor menor OVR; a DP de pesos
    // iguais limita a soma inteira. Se o Worker também terminou o polish exato,
    // "optimal" inclui o desempate por menor AP. Caso contrário, os OVRs estão
    // provados, mas o custo continua identificado separadamente.
    if (mode === 'max' && multi
      && objective.min === maximumObjective.min
      && maxSumUpper != null
      && objective.sum === maxSumUpper) {
      status = status === 'optimal' ? 'optimal' : 'ovr-optimal';
    }
    return {
      values,
      added: spent,
      spent,
      feasible,
      status,
      overalls: objective.overalls,
      objective: { min: objective.min, sum: objective.sum },
      min: objective.min,
      overall: objective.min,
    };
  }

  // ---- maximizar a SOMA de atributos escolhidos dado um orçamento de AP ----
  // cada +1 soma 1 ao total e custa apCostAt(tier, valor); ótimo = comprar sempre o
  // próximo ponto mais barato entre os escolhidos (maximiza o nº de pontos = a soma).
  // mantém os níveis atuais como piso (só sobe), respeita o max do arquétipo.
  function maximizeSum(derived, opts) {
    const include = new Set(opts.include);
    const attrs = [];
    for (const c of derived.categories) for (const a of c.attributes) {
      if (include.has(a.id)) attrs.push({ id: a.id, tier: a.tier, max: a.maxValue, base: a.baseValue, val: a.currentValue });
    }
    const startSum = attrs.reduce((s, a) => s + a.val, 0);
    let added = 0;
    while (true) {
      let best = null, bestCost = Infinity;
      for (const a of attrs) {
        if (a.val >= a.max) continue;
        const cost = apCostAt(a.tier, a.val + 1);
        if (cost < bestCost) { bestCost = cost; best = a; }
      }
      if (!best || added + bestCost > opts.budget) break;
      best.val++; added += bestCost;
    }
    const values = {}; let sum = 0;
    attrs.forEach((a) => { values[a.id] = a.val; sum += a.val; });
    return { values, added, sum, points: sum - startSum };
  }

  function targetPlan(derived, targets) {
    let cost = 0;
    let capped = 0;
    const values = {};
    for (const category of derived.categories) {
      if (derived.arch && derived.arch.position !== 'GK' && category.id === 'goalkeeping') continue;
      for (const attr of category.attributes) {
        const requested = targets && targets[attr.id];
        if (requested == null || !Number.isFinite(+requested)) continue;
        const target = clamp(Math.round(+requested), attr.baseValue, attr.maxValue);
        if (+requested > attr.maxValue) capped++;
        values[attr.id] = target;
        cost += apCost(attr.tier, attr.baseValue, target);
      }
    }
    return { cost, capped, values };
  }

  function normalizeBuild(input) {
    const source = input && typeof input === 'object' ? input : {};
    const arch = archetype(source.archetypeId);
    const out = {
      archetypeId: arch ? arch.id : null,
      level: clamp(Number.isFinite(+source.level) ? Math.round(+source.level) : 1, 1, D.maxLevel),
      height: D.defaultHeight,
      weight: D.defaultWeight,
      attributes: {},
      playstyles: [],
      playstylePurchases: {},
      signatures: {},
      positions: [],
      disabledAttrs: [],
      sumExcluded: [],
    };

    if (arch) {
      out.height = clamp(Number.isFinite(+source.height) ? Math.round(+source.height) : D.defaultHeight, Math.ceil(arch.minHeight), Math.floor(arch.maxHeight));
      out.weight = clamp(Number.isFinite(+source.weight) ? Math.round(+source.weight) : D.defaultWeight, Math.ceil(arch.minWeight), Math.floor(arch.maxWeight));
      const cats = baseCategories(arch);
      const attrs = cats.flatMap((category) => category.attributes);
      const attrById = Object.fromEntries(attrs.map((attr) => [attr.id, attr]));
      const values = {};
      attrs.forEach((attr) => {
        const raw = source.attributes && Number.isFinite(+source.attributes[attr.id]) ? Math.round(+source.attributes[attr.id]) : attr.baseValue;
        values[attr.id] = clamp(raw, attr.baseValue, attr.maxValue);
      });

      let spent = attrs.reduce((total, attr) => total + apCost(attr.tier, attr.baseValue, values[attr.id]), 0);
      const available = totalAP(out.level);
      while (spent > available) {
        let selected = null;
        attrs.forEach((attr, index) => {
          const value = values[attr.id];
          if (value <= attr.baseValue) return;
          const refund = apCostAt(attr.tier, value);
          if (!selected || refund > selected.refund || (refund === selected.refund && index < selected.index)) selected = { attr, refund, index };
        });
        if (!selected) break;
        values[selected.attr.id]--;
        spent -= selected.refund;
      }
      attrs.forEach((attr) => { if (values[attr.id] > attr.baseValue) out.attributes[attr.id] = values[attr.id]; });

      const purchased = Object.fromEntries(attrs.map((attr) => [attr.id, values[attr.id]]));
      const slots = unlockedSlots(out.level);
      const seenPlaystyles = new Set();
      for (const id of Array.isArray(source.playstyles) ? source.playstyles : []) {
        const ps = playstyle(id);
        if (!ps || seenPlaystyles.has(id) || out.playstyles.length >= slots) continue;
        if (!playstyleEligible(ps, purchased)) continue;
        seenPlaystyles.add(id);
        out.playstyles.push(id);
      }

      const currentCategories = cats.map((category) => ({
        ...category,
        attributes: category.attributes.map((attr) => ({ ...attr, currentValue: values[attr.id] })),
      }));
      const sourceSignatures = source.signatures && typeof source.signatures === 'object' ? source.signatures : {};
      const signatureKeys = Object.keys(sourceSignatures).sort((a, b) => +a - +b);
      for (const slot of signatureKeys) {
        const numericSlot = +slot;
        const spec = D.specializations.find((entry) => entry.id === sourceSignatures[slot]);
        if (!Number.isInteger(numericSlot) || numericSlot < 0 || numericSlot > 3 || !spec || spec.archetypeId !== arch.id || !specializationUnlocked(spec, currentCategories)) continue;
        out.signatures[numericSlot] = spec.id;
        break;
      }

      // Arquétipo/especialização já equipam esses PlayStyles fora dos slots regulares.
      const signatureIds = new Set(signatureSlots(out, currentCategories)
        .filter((slot) => slot.playStyleId)
        .map((slot) => slot.playStyleId));
      out.playstyles = out.playstyles.filter((id) => !signatureIds.has(id));

      // Guarda apenas a parcela de atributos efetivamente comprada por cada Quick Unlock.
      // O recibo permite vender depois sem apagar melhorias manuais feitas antes ou depois.
      const sourcePurchases = source.playstylePurchases && typeof source.playstylePurchases === 'object'
        ? source.playstylePurchases
        : {};
      for (const id of Object.keys(sourcePurchases)) {
        if (!playstyle(id)) continue;
        const receipt = sourcePurchases[id];
        if (!receipt || typeof receipt !== 'object') continue;
        const before = {}, after = {};
        const sourceBefore = receipt.before && typeof receipt.before === 'object' ? receipt.before : {};
        const sourceAfter = receipt.after && typeof receipt.after === 'object' ? receipt.after : {};
        for (const attrId of Object.keys(sourceAfter)) {
          const attr = attrById[attrId];
          if (!attr || !Number.isFinite(+sourceAfter[attrId])) continue;
          const afterValue = clamp(Math.round(+sourceAfter[attrId]), attr.baseValue, values[attrId]);
          const beforeRaw = Number.isFinite(+sourceBefore[attrId]) ? Math.round(+sourceBefore[attrId]) : attr.baseValue;
          const beforeValue = clamp(beforeRaw, attr.baseValue, afterValue);
          if (afterValue <= beforeValue) continue;
          before[attrId] = beforeValue;
          after[attrId] = afterValue;
        }
        if (Object.keys(after).length) out.playstylePurchases[id] = { before, after };
      }

      if (arch.position === 'GK') {
        out.positions = ['GK'];
      } else {
        const validPositions = new Set(Object.keys((overallModel().positions || legacyWeights())).filter((position) => position !== 'GK'));
        for (const position of Array.isArray(source.positions) ? source.positions : []) {
          if (validPositions.has(position) && !out.positions.includes(position)) out.positions.push(position);
        }
      }
      const validAttrIds = new Set(Object.keys(attrById));
      out.disabledAttrs = [...new Set(Array.isArray(source.disabledAttrs) ? source.disabledAttrs : [])].filter((id) => validAttrIds.has(id));
      out.sumExcluded = [...new Set(Array.isArray(source.sumExcluded) ? source.sumExcluded : [])].filter((id) => validAttrIds.has(id));
    }

    const comparable = {
      archetypeId: source.archetypeId || null,
      level: source.level != null ? source.level : 1,
      height: source.height != null ? source.height : D.defaultHeight,
      weight: source.weight != null ? source.weight : D.defaultWeight,
      attributes: source.attributes || {},
      playstyles: source.playstyles || [],
      playstylePurchases: source.playstylePurchases || {},
      signatures: source.signatures || {},
      positions: source.positions || [],
      disabledAttrs: source.disabledAttrs || [],
      sumExcluded: source.sumExcluded || [],
    };
    return { build: out, adjusted: JSON.stringify(comparable) !== JSON.stringify(out) };
  }

  // ---- estado derivado completo do build ----
  function derive(build) {
    const arch = archetype(build.archetypeId);
    const cats = baseCategories(arch).map((cat) => ({
      id: cat.id,
      attributes: cat.attributes.map((a) => {
        const raw = build.attributes && build.attributes[a.id] != null ? build.attributes[a.id] : a.baseValue;
        return { ...a, currentValue: clamp(raw, a.baseValue, a.maxValue) };
      }),
    }));
    const bodyAdj = bodyAdjustments(arch, build.height, build.weight);

    const purchased = {};
    const eff = {};
    cats.forEach((c) => c.attributes.forEach((a) => {
      purchased[a.id] = a.currentValue;
      eff[a.id] = clamp(a.currentValue + (bodyAdj[a.id] || 0), 1, 99);
    }));

    // AP gasto
    let spent = 0;
    cats.forEach((c) => c.attributes.forEach((a) => { spent += apCost(a.tier, a.baseValue, a.currentValue); }));
    const total = totalAP(build.level);

    // AcceleRATE usa agility/strength/acceleration ajustados só pelo corpo (como no original)
    const cur = (id) => { for (const c of cats) for (const a of c.attributes) if (a.id === id) return a.currentValue; return 0; };
    const accAttr = (id) => cur(id) + (bodyAdj[id] || 0);
    const accel = arch && arch.position !== 'GK'
      ? accelType(accAttr('agility'), accAttr('strength'), accAttr('acceleration'), build.height)
      : null;

    return {
      arch,
      categories: cats,
      bodyAdj,
      purchased,
      effective: eff,
      ap: { total, spent, available: total - spent },
      accel,
      slots: { unlocked: unlockedSlots(build.level), signaturePlus: signaturePlusCount(build.level) },
    };
  }

  return {
    archetype, playstyle,
    baseCategories, apCostAt, apCost, totalAP, apCostNextPoint, affordableTarget,
    bodyAdjustments, accelType,
    playstyleEligible, unlockedSlots, signaturePlusCount, barColor,
    archetypeSpecializations, specializationUnlocked, requirementUnlockPlan, quickUnlockCost, signatureSlots, curVal, findAttr,
    pesoFor, pesoForPositions, overallWeightProfile, overallRawForPosition, overallRawForPositions, overallRawForValues,
    overallForPosition, overallForPositions, overallIfPrimary, overallMapForValues, optimize, maximizeSum, targetPlan,
    normalizeBuild, derive, clamp,
  };
})();
