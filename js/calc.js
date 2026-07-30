/* ============================================================================
 * calc.js — FC 26 Pro Clubs Builder mechanics.
 * Exposes window.Calc. Depends on window.DATA (data.js).
 * ========================================================================== */
window.Calc = (function () {
  const D = window.DATA;
  const byId = (arr, id) => arr.find((x) => x.id === id) || null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const NON_KEY_ATTRIBUTES = new Set(['skill_moves', 'weak_foot']);

  const archetype = (id) => byId(D.archetypes, id);
  const facility = (id) => byId(D.facilities, id) || byId(D.aiFacilities, id);
  const playstyle = (id) => byId(D.playstyles, id);

  // ---- attributes: base categories with archetype modifiers + key tier discount ----
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
          displayType: attr.displayType, // 'stars' for skill moves / weak foot (2..5 scale, not 1..99)
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
  // signed cost of moving an attribute from `base` to `current`
  function apCost(tier, base, current) {
    if (base === current) return 0;
    const up = current > base;
    const lo = up ? base + 1 : current + 1;
    const hi = up ? current : base;
    let sum = 0;
    for (let v = lo; v <= hi; v++) sum += apCostAt(tier, v);
    return up ? sum : -sum;
  }
  // total AP available at a level (100 base + per-level gain, capped at level 100)
  function totalAP(level) {
    if (level < 1) return D.apBase;
    const cap = Math.min(level, D.apLevelCap);
    let t = D.apBase;
    for (let a = 2; a <= cap; a++) t += D.levelApTable[a] || 0;
    return t;
  }
  // AP needed to increase by 1 from the current value (or null when already at max)
  function apCostNextPoint(attr) {
    if (attr.currentValue >= attr.maxValue) return null;
    return apCostAt(attr.tier, attr.currentValue + 1);
  }
  // highest reachable value from the current one with the available AP (never makes AP negative).
  // decreasing is always allowed (it refunds AP).
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

  // ---- body (height/weight) -> adjustment by affected attribute ----
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
    // array order matches AFFECTED/GK_AFFECTED_ATTRIBUTE_IDS
    const hp = isGK ? [t, -t, t, -t, t, t] : [-t, -t, -t, t, t, t];
    const wp = isGK ? [-s, s, -s, -s, -s, s] : [-s, -s, s, s, -s, s];
    affected.forEach((id, i) => { map[id] = hp[i] + wp[i]; });
    return map;
  }

  // AcceleRATE — ported verbatim. Receives values ALREADY adjusted by body + height.
  function accelType(agility, strength, acceleration, height) {
    if (agility >= 65 && agility - strength >= 10 && acceleration >= 80 && height <= 184) return 'EXPLOSIVE';
    if (strength >= 65 && strength - agility >= 4 && acceleration >= 40 && height >= 185) return 'LENGTHY';
    return 'CONTROLLED';
  }

  // ---- facilities ----
  function facilityLevel(fac, star) {
    return fac && fac.levels[star] ? fac.levels[star] : null;
  }
  function facilityAdjustments(facilities) {
    const adjustments = {};
    for (const id in facilities) {
      const level = facilityLevel(facility(id), facilities[id]);
      if (!level) continue;
      for (const boost of level.attributeBoosts) {
        adjustments[boost.attributeId] = (adjustments[boost.attributeId] || 0) + boost.value;
      }
    }
    return adjustments;
  }
  function facilityCost(facilities) {
    let total = 0;
    for (const id in facilities) {
      const level = facilityLevel(facility(id), facilities[id]);
      if (level) total += level.cost;
    }
    return total;
  }
  function facilityUnlocks(facilities) {
    const unlocks = new Set();
    for (const id in facilities) {
      const definition = facility(id);
      if (!definition) continue;
      for (let star = 1; star <= facilities[id]; star++) {
        const level = definition.levels[star];
        if (level && level.playstyle) unlocks.add(level.playstyle);
      }
    }
    return unlocks;
  }
  const budget = (clubLevel) => D.clubLevelBudgets[clubLevel] || 0;

  // ---- playstyles ----
  function playstyleEligible(ps, purchased, unlocks = new Set()) {
    if (unlocks.has(ps.id)) return true;
    if (!ps.requirements || !ps.requirements.length) return true;
    return ps.requirements.every((r) => (purchased[r.attributeId] || 0) >= r.minValue);
  }
  const unlockedSlots = (level) => D.slotUnlockLevels.filter((l) => level >= l).length;
  // number of signature slots (0–3) upgraded to "+" at the given level
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
  // a specialization unlocks when its requirements (current value >= minimum) are met
  function specializationUnlocked(spec, cats) {
    return spec.requirements.every((r) => curVal(cats, r.attributeId) >= r.minValue);
  }
  // Central Quick Unlock plan for PlayStyles and Specializations.
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
  // the 4 signature slots: default = recommended; each can be replaced by a specialization
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

  // ---- bar color by value ----
  function barColor(v) {
    for (const [threshold, color] of D.barColors) if (v >= threshold) return color;
    return D.barColors[D.barColors.length - 1][1];
  }

  // ---- category OVRs (PAC / SHOT / PAS / DRI / DEF / PHY) ----
  const CATEGORY_OVR_WEIGHTS = Object.freeze({
    pace: Object.freeze({ acceleration: 45, sprint_speed: 55 }),
    scoring: Object.freeze({
      att_position: 5, finishing: 45, shot_power: 20,
      long_shots: 20, volleys: 5, penalties: 5,
    }),
    passing: Object.freeze({
      vision: 20, crossing: 20, fk_accuracy: 5,
      short_passing: 35, long_passing: 15, curve: 5,
    }),
    ball_control: Object.freeze({
      agility: 10, balance: 5, reactions: 5,
      ball_control: 30, dribbling: 45, composure: 5,
    }),
    defending: Object.freeze({
      interceptions: 20, heading_accuracy: 10, def_aware: 30,
      standing_tackle: 30, sliding_tackle: 10,
    }),
    physical: Object.freeze({ jumping: 5, strength: 50, stamina: 25, aggression: 20 }),
  });

  function categoryOverall(categoryId, values) {
    const weights = CATEGORY_OVR_WEIGHTS[categoryId];
    if (!weights || !values) return null;
    let weightedSum = 0;
    for (const [attributeId, weight] of Object.entries(weights)) {
      const value = Number(values[attributeId]);
      if (!Number.isFinite(value)) return null;
      weightedSum += value * weight;
    }
    return Math.floor((weightedSum + 50) / 100);
  }

  function categoryOverallMap(values) {
    return Object.fromEntries(
      Object.keys(CATEGORY_OVR_WEIGHTS).map((categoryId) => [
        categoryId,
        categoryOverall(categoryId, values),
      ]),
    );
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
      if (!w) continue;
      const purchased = values && values[a.id] != null ? values[a.id] : a.currentValue;
      const adjustment = derived.inGameStats
        ? (derived.bodyAdj && derived.bodyAdj[a.id] || 0) + (derived.facAdj && derived.facAdj[a.id] || 0)
        : 0;
      s += w * clamp(purchased + adjustment, 1, 99);
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
  // Weight profile displayed by the interface. For multiple selections, combine all
  // positions by averaging their coefficients. This makes the profile represent the
  // shared OVR gain without silently switching to only one selected position.
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

  // Exactly solves a linear combination of OVRs. Although one linear combination does
  // not prove the discrete max-min optimum, it produces strong deterministic Pareto
  // candidates in O(attributes × AP × options) without exploding the multidimensional space.
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
      // Pairs need finer ratios; trios use the complete 45-point simplex grid. This
      // covers distributions not found by "equal weights + one highlighted position."
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
      // For larger selections, also cover interactions between limiting pairs without
      // generating the entire combinatorial simplex grid.
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
        const adjustment = derived.inGameStats
          ? (derived.bodyAdj[a.id] || 0) + (derived.facAdj[a.id] || 0)
          : 0;
        const usefulMax = Math.min(a.maxValue, 99 - Math.max(0, adjustment));
        attrs.push({
          id: a.id,
          tier: a.tier,
          max: Math.max(a.currentValue, usefulMax),
          base: a.baseValue,
          val: a.currentValue,
          w,
          weights,
        });
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
    // All attributes at maximum bound the best minimum OVR; equal-weight DP bounds the
    // full sum. If the Worker also completed exact polishing, "optimal" includes the
    // lower-AP tiebreak. Otherwise the OVRs are proven while cost remains identified separately.
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

  // ---- maximize the SUM of selected attributes for a given AP budget ----
  // each +1 adds 1 to the total and costs apCostAt(tier, value); the optimum always
  // buys the cheapest next point among the selected attributes (max points = max sum).
  // preserve current levels as a floor (increase only) and respect the archetype maximum.
  function maximizeSum(derived, opts) {
    const include = new Set(opts.include);
    const attrs = [];
    for (const c of derived.categories) for (const a of c.attributes) {
      if (!include.has(a.id)) continue;
      const adjustment = derived.inGameStats
        ? (derived.bodyAdj[a.id] || 0) + (derived.facAdj[a.id] || 0)
        : 0;
      const usefulMax = Math.min(a.maxValue, 99 - Math.max(0, adjustment));
      attrs.push({
        id: a.id,
        tier: a.tier,
        max: Math.max(a.currentValue, usefulMax),
        base: a.baseValue,
        val: a.currentValue,
        adjustment,
      });
    }
    const activeValue = (attr) => clamp(attr.val + attr.adjustment, 1, 99);
    const startSum = attrs.reduce((sum, attr) => sum + activeValue(attr), 0);
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
    attrs.forEach((a) => { values[a.id] = a.val; sum += activeValue(a); });
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
    const validClubLevels = Object.keys(D.clubLevelBudgets).map(Number).sort((a, b) => a - b);
    const requestedClubLevel = Number.isFinite(+source.clubLevel) ? Math.round(+source.clubLevel) : validClubLevels[0];
    const clubLevel = validClubLevels.reduce((best, level) =>
      Math.abs(level - requestedClubLevel) < Math.abs(best - requestedClubLevel) ? level : best,
    validClubLevels[0]);
    const arch = archetype(source.archetypeId);
    const out = {
      archetypeId: arch ? arch.id : null,
      level: clamp(Number.isFinite(+source.level) ? Math.round(+source.level) : 1, 1, D.maxLevel),
      clubLevel,
      inGameStats: source.inGameStats === true,
      height: D.defaultHeight,
      weight: D.defaultWeight,
      attributes: {},
      facilities: {},
      aiFacilities: {},
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

      let remainingFacilityBudget = budget(out.clubLevel);
      const sanitizeFacilities = (selected, definitions) => {
        const clean = {};
        Object.keys(selected || {}).forEach((id) => {
          const definition = definitions.find((entry) => entry.id === id);
          if (!definition) return;
          let star = clamp(Math.round(+selected[id] || 0), 0, definition.levels.length - 1);
          while (star > 0 && definition.levels[star].cost > remainingFacilityBudget) star--;
          if (star > 0) {
            clean[id] = star;
            remainingFacilityBudget -= definition.levels[star].cost;
          }
        });
        return clean;
      };
      out.facilities = sanitizeFacilities(source.facilities, D.facilities);
      out.aiFacilities = sanitizeFacilities(source.aiFacilities, D.aiFacilities);

      const purchased = Object.fromEntries(attrs.map((attr) => [attr.id, values[attr.id]]));
      const facilityGranted = facilityUnlocks(out.facilities);
      const slots = unlockedSlots(out.level);
      const seenPlaystyles = new Set();
      for (const id of Array.isArray(source.playstyles) ? source.playstyles : []) {
        const ps = playstyle(id);
        if (!ps || seenPlaystyles.has(id) || facilityGranted.has(id) || out.playstyles.length >= slots) continue;
        if (!playstyleEligible(ps, purchased, facilityGranted)) continue;
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

      // Archetypes/specializations already equip these PlayStyles outside regular slots.
      const signatureIds = new Set(signatureSlots(out, currentCategories)
        .filter((slot) => slot.playStyleId)
        .map((slot) => slot.playStyleId));
      out.playstyles = out.playstyles.filter((id) => !signatureIds.has(id));

      // Keep only the attributes actually purchased by each Quick Unlock. The receipt
      // allows a later sale without removing manual upgrades made before or afterward.
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
      clubLevel: source.clubLevel != null ? source.clubLevel : validClubLevels[0],
      inGameStats: source.inGameStats === true,
      height: source.height != null ? source.height : D.defaultHeight,
      weight: source.weight != null ? source.weight : D.defaultWeight,
      attributes: source.attributes || {},
      facilities: source.facilities || {},
      aiFacilities: source.aiFacilities || {},
      playstyles: source.playstyles || [],
      playstylePurchases: source.playstylePurchases || {},
      signatures: source.signatures || {},
      positions: source.positions || [],
      disabledAttrs: source.disabledAttrs || [],
      sumExcluded: source.sumExcluded || [],
    };
    return { build: out, adjusted: JSON.stringify(comparable) !== JSON.stringify(out) };
  }

  // ---- complete derived build state ----
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
    const facilities = build.facilities || {};
    const aiFacilities = build.aiFacilities || {};
    const facAdj = facilityAdjustments(facilities);

    const purchased = {};
    const eff = {};
    cats.forEach((c) => c.attributes.forEach((a) => {
      purchased[a.id] = a.currentValue;
      eff[a.id] = clamp(a.currentValue + (bodyAdj[a.id] || 0) + (facAdj[a.id] || 0), 1, 99);
    }));
    const inGameStats = build.inGameStats === true;
    const displayValues = inGameStats ? eff : purchased;
    const purchasedCategoryOveralls = categoryOverallMap(purchased);
    const inGameCategoryOveralls = categoryOverallMap(eff);
    const categoryOveralls = inGameStats ? inGameCategoryOveralls : purchasedCategoryOveralls;

    // AP spent
    let spent = 0;
    cats.forEach((c) => c.attributes.forEach((a) => { spent += apCost(a.tier, a.baseValue, a.currentValue); }));
    const total = totalAP(build.level);

    // AcceleRATE uses agility/strength/acceleration adjusted only by body (as in the original)
    const cur = (id) => { for (const c of cats) for (const a of c.attributes) if (a.id === id) return a.currentValue; return 0; };
    const accAttr = (id) => cur(id) + (bodyAdj[id] || 0);
    const accel = arch && arch.position !== 'GK'
      ? accelType(accAttr('agility'), accAttr('strength'), accAttr('acceleration'), build.height)
      : null;

    return {
      arch,
      categories: cats,
      bodyAdj,
      facAdj,
      purchased,
      effective: eff,
      displayValues,
      inGameStats,
      purchasedCategoryOveralls,
      inGameCategoryOveralls,
      categoryOveralls,
      ap: { total, spent, available: total - spent },
      accel,
      facilities: {
        playerCost: facilityCost(facilities),
        aiCost: facilityCost(aiFacilities),
        cost: facilityCost(facilities) + facilityCost(aiFacilities),
        budget: budget(build.clubLevel),
        unlocks: facilityUnlocks(facilities),
      },
      slots: { unlocked: unlockedSlots(build.level), signaturePlus: signaturePlusCount(build.level) },
    };
  }

  return {
    archetype, facility, playstyle,
    baseCategories, apCostAt, apCost, totalAP, apCostNextPoint, affordableTarget,
    bodyAdjustments, accelType,
    facilityAdjustments, facilityCost, facilityUnlocks, budget,
    playstyleEligible, unlockedSlots, signaturePlusCount, barColor,
    categoryOverall, categoryOverallMap,
    archetypeSpecializations, specializationUnlocked, requirementUnlockPlan, quickUnlockCost, signatureSlots, curVal, findAttr,
    pesoFor, pesoForPositions, overallWeightProfile, overallRawForPosition, overallRawForPositions, overallRawForValues,
    overallForPosition, overallForPositions, overallIfPrimary, overallMapForValues, optimize, maximizeSum, targetPlan,
    normalizeBuild, derive, clamp,
  };
})();
