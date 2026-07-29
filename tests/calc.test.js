const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext, defaultBuild } = require('./helpers');

test('OVR model v2 exposes independent outfield and goalkeeper formulas', () => {
  const { OVERALL_MODEL } = createContext();
  assert.equal(OVERALL_MODEL.version, 2);
  assert.deepEqual(Object.keys(OVERALL_MODEL.positions), ['ST', 'RW', 'LW', 'CAM', 'RM', 'LM', 'CM', 'CDM', 'RB', 'LB', 'CB', 'GK']);
  assert.equal(OVERALL_MODEL.rounding, 'floor');
  assert.equal(OVERALL_MODEL.gameCalibrationOffset, -1);
  assert.equal(OVERALL_MODEL.metrics.crossValidation5Fold.outfield75Plus.within1 > 0.999, true);
  assert.equal(OVERALL_MODEL.metrics.crossValidation5Fold.goalkeeper.within1, 1);
});

test('displayed OVR applies the in-game minus-one calibration', () => {
  const { Calc, OVERALL_MODEL } = createContext();
  const derived = Calc.derive(defaultBuild({
    archetypeId: 'fwd_finisher',
    positions: ['ST'],
    attributes: { finishing: 92, reactions: 90, acceleration: 88 },
  }));
  const raw = Calc.overallRawForPosition('ST', derived);
  const expected = Math.max(
    OVERALL_MODEL.limits.min,
    Math.min(OVERALL_MODEL.limits.max, Math.floor(raw + 1e-9) - 1),
  );
  assert.equal(Calc.overallForPosition('ST', derived), expected);
});

test('level, AP and specialization tables match the level-100 ruleset', () => {
  const { Calc, DATA } = createContext();
  assert.equal(DATA.maxLevel, 100);
  assert.equal(Calc.totalAP(100), 3167);
  DATA.archetypes.forEach((arch) => assert.equal(DATA.specializations.filter((spec) => spec.archetypeId === arch.id).length, 3));
  assert.equal(DATA.specializations.some((spec) => spec.id === 'spider' && spec.archetypeId === 'gk_shot_stopper'), true);
});

test('attribute bar colors follow the four configured value ranges', () => {
  const { Calc } = createContext();
  assert.equal(Calc.barColor(0), '#F87E0B');
  assert.equal(Calc.barColor(69), '#F87E0B');
  assert.equal(Calc.barColor(70), '#F7B702');
  assert.equal(Calc.barColor(79), '#F7B702');
  assert.equal(Calc.barColor(80), '#268535');
  assert.equal(Calc.barColor(89), '#268535');
  assert.equal(Calc.barColor(90), '#07F468');
  assert.equal(Calc.barColor(99), '#07F468');
});

test('position order and body do not change estimated OVR', () => {
  const { Calc } = createContext();
  const base = defaultBuild({ positions: ['ST', 'CAM'], attributes: { finishing: 92, reactions: 90, short_passing: 88 } });
  const changedBody = { ...base, height: 190, weight: 90 };
  const first = Calc.derive(base);
  const second = Calc.derive(changedBody);
  assert.deepEqual(Calc.overallMapForValues(['ST', 'CAM'], first, null), Calc.overallMapForValues(['CAM', 'ST'], first, null));
  assert.equal(Calc.overallForPosition('ST', first), Calc.overallForPosition('ST', second));
  assert.equal(Calc.overallForPosition('CAM', first), Calc.overallForPosition('CAM', second));
});

test('displayed OVR weights use the selected position or average every selected position', () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({
    archetypeId: 'fwd_finisher',
    positions: ['ST', 'CAM'],
    attributes: { finishing: 86, short_passing: 82, reactions: 80 },
  }));

  const single = Calc.overallWeightProfile(['ST'], derived);
  assert.equal(single.mode, 'single');
  assert.deepEqual([...single.limitingPositions], ['ST']);
  assert.equal(single.weights.finishing, Calc.pesoFor('ST', 'finishing'));

  const multi = Calc.overallWeightProfile(['ST', 'CAM'], derived);
  const minimum = Math.min(multi.overalls.ST, multi.overalls.CAM);
  const expectedLimiters = ['ST', 'CAM'].filter((position) => multi.overalls[position] === minimum);
  const expectedFinishing = ['ST', 'CAM'].reduce(
    (sum, position) => sum + Calc.pesoFor(position, 'finishing'),
    0,
  ) / 2;
  assert.deepEqual([...multi.weightedPositions], ['ST', 'CAM']);
  assert.deepEqual([...multi.limitingPositions], expectedLimiters);
  assert.equal(Math.abs(multi.weights.finishing - expectedFinishing) < 1e-12, true);

  const reversed = Calc.overallWeightProfile(['CAM', 'ST'], derived);
  assert.equal(JSON.stringify(reversed.weights), JSON.stringify(multi.weights));
});

test('key attributes marked no-discount use their original AP tier', () => {
  const { Calc } = createContext();
  const cases = [
    ['def_engine', 'interceptions', 217, 'tier3'],
    ['fwd_target', 'strength', 318, 'tier2'],
  ];
  for (const [archetypeId, attrId, expectedCost, expectedTier] of cases) {
    const derived = Calc.derive(defaultBuild({ archetypeId, positions: ['CB'] }));
    const attr = Calc.findAttr(derived.categories, attrId);
    assert.equal(attr.tier, expectedTier);
    assert.equal(Calc.apCost(attr.tier, attr.baseValue, attr.maxValue), expectedCost);
  }
});

test('Skill Moves and Weak Foot are never treated as key attributes', () => {
  const { Calc, DATA } = createContext();
  for (const arch of DATA.archetypes) {
    const derived = Calc.derive(defaultBuild({ archetypeId: arch.id }));
    for (const id of ['skill_moves', 'weak_foot']) {
      const attr = Calc.findAttr(derived.categories, id);
      assert.equal(attr.isKeyAttribute, false, `${arch.id} must not mark ${id} as key`);
    }
  }
});

test('PlayStyle requirements use purchased values', () => {
  const { Calc } = createContext();
  const ps = { id: 'test', requirements: [{ attributeId: 'acceleration', minValue: 90 }] };
  assert.equal(Calc.playstyleEligible(ps, { acceleration: 89 }), false);
  assert.equal(Calc.playstyleEligible(ps, { acceleration: 90 }), true);
});

test('signature PlayStyles are equipped automatically and cannot occupy regular slots', () => {
  const { Calc } = createContext();
  const base = defaultBuild({ archetypeId: 'fwd_finisher' });
  const derived = Calc.derive(base);
  const signatureIds = Calc.signatureSlots(base, derived.categories).map((slot) => slot.playStyleId);
  const finessePlan = Calc.requirementUnlockPlan(Calc.playstyle('finesse_shot'), derived.categories);
  const normalized = Calc.normalizeBuild({
    ...base,
    attributes: finessePlan.values,
    playstyles: [signatureIds[0], 'finesse_shot'],
  }).build;
  assert.equal(normalized.playstyles.includes(signatureIds[0]), false);
  assert.equal(normalized.playstyles.includes('finesse_shot'), true);
});

test('PlayStyle Quick Unlock uses central AP costs and rejects impossible requirements', () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({ archetypeId: 'fwd_finisher' }));
  const playstyle = Calc.playstyle('finesse_shot');
  const plan = Calc.requirementUnlockPlan(playstyle, derived.categories);
  const expectedCost = Object.entries(plan.values).reduce((total, [id, target]) => {
    const attr = Calc.findAttr(derived.categories, id);
    return total + Calc.apCost(attr.tier, attr.currentValue, target);
  }, 0);
  assert.equal(plan.feasible, true);
  assert.equal(plan.cost, expectedCost);
  assert.equal(plan.cost > 0, true);
  playstyle.requirements.forEach((requirement) => {
    assert.equal(plan.values[requirement.attributeId] >= requirement.minValue, true);
  });

  const acceleration = Calc.findAttr(derived.categories, 'acceleration');
  const impossible = Calc.requirementUnlockPlan({
    requirements: [{ attributeId: 'acceleration', minValue: acceleration.maxValue + 1 }],
  }, derived.categories);
  assert.equal(impossible.feasible, false);
  assert.deepEqual(Object.keys(impossible.values), []);
});

test('normalization enforces AP, one specialization and GK position', () => {
  const { Calc, DATA } = createContext();
  const normalized = Calc.normalizeBuild(defaultBuild({
    archetypeId: 'gk_shot_stopper',
    level: 1,
    attributes: Object.fromEntries(DATA.categories.flatMap((category) => category.attributes.map((attr) => [attr.id, 99]))),
    playstyles: DATA.playstyles.slice(0, 9).map((ps) => ps.id),
    signatures: { 0: 'spider', 1: 'octopus' },
    positions: ['ST', 'CB'],
  })).build;
  const derived = Calc.derive(normalized);
  assert.equal(derived.ap.available >= 0, true);
  assert.equal(normalized.playstyles.length, 0);
  assert.equal(Object.keys(normalized.signatures).length <= 1, true);
  assert.deepEqual([...normalized.positions], ['GK']);
});

test('removed Facilities fields are ignored by normalization and derivation', () => {
  const { Calc } = createContext();
  const normalized = Calc.normalizeBuild(defaultBuild({
    clubLevel: 10,
    facilities: { legacy_player_facility: 3 },
    aiFacilities: { legacy_ai_facility: 3 },
  })).build;
  assert.equal('clubLevel' in normalized, false);
  assert.equal('facilities' in normalized, false);
  assert.equal('aiFacilities' in normalized, false);
  const derived = Calc.derive(normalized);
  assert.equal('facAdj' in derived, false);
  assert.equal('facilities' in derived, false);
});

test('UT target plans use the same tiers and cap values at archetype maximums', () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({ archetypeId: 'def_engine', positions: ['RB'] }));
  const attr = Calc.findAttr(derived.categories, 'interceptions');
  const plan = Calc.targetPlan(derived, { interceptions: 99 });
  assert.equal(plan.values.interceptions, attr.maxValue);
  assert.equal(plan.capped, 1);
  assert.equal(plan.cost, 217);
});

test('Max sum matches exact group knapsack across every archetype and AP curve', () => {
  const { Calc, DATA } = createContext();
  const visibleNumericAttributes = (derived) => derived.categories
    .filter((category) => derived.arch.position === 'GK' || category.id !== 'goalkeeping')
    .flatMap((category) => category.attributes)
    .filter((attr) => attr.displayType !== 'stars');
  const exactMaxPoints = (attrs, budget) => {
    let minimumCosts = [0];
    for (const attr of attrs) {
      const options = [{ points: 0, cost: 0 }];
      let cost = 0;
      for (let value = attr.currentValue + 1; value <= attr.maxValue; value++) {
        cost += Calc.apCostAt(attr.tier, value);
        options.push({ points: value - attr.currentValue, cost });
      }
      const next = Array(minimumCosts.length + options.length - 1).fill(Infinity);
      for (let currentPoints = 0; currentPoints < minimumCosts.length; currentPoints++) {
        if (!Number.isFinite(minimumCosts[currentPoints])) continue;
        for (const option of options) {
          const optionCost = minimumCosts[currentPoints] + option.cost;
          const nextPoints = currentPoints + option.points;
          if (optionCost < next[nextPoints]) next[nextPoints] = optionCost;
        }
      }
      minimumCosts = next;
    }
    let points = 0;
    for (let candidate = 0; candidate < minimumCosts.length; candidate++) {
      if (minimumCosts[candidate] <= budget) points = candidate;
    }
    return { points, cost: minimumCosts[points] };
  };

  for (const table of Object.values(DATA.apCostTable)) {
    let previousCost = -Infinity;
    for (const range of table.costRanges) {
      assert.equal(range.apCost >= previousCost, true, `${table.id} AP costs must be non-decreasing`);
      previousCost = range.apCost;
    }
  }

  let checked = 0;
  for (const arch of DATA.archetypes) {
    const positions = arch.position === 'GK' ? ['GK'] : ['ST'];
    const base = Calc.derive(defaultBuild({ archetypeId: arch.id, positions }));
    const evolvedAttributes = {};
    visibleNumericAttributes(base).forEach((attr, index) => {
      const value = Math.min(attr.maxValue, attr.baseValue + ((index * 7) % 9));
      if (value > attr.baseValue) evolvedAttributes[attr.id] = value;
    });

    const scenarios = [
      { name: 'base', values: {}, includeSubset: false },
      { name: 'evolved', values: evolvedAttributes, includeSubset: true },
    ];
    for (const scenario of scenarios) {
      const derived = Calc.derive(defaultBuild({ archetypeId: arch.id, positions, attributes: scenario.values }));
      const allAttrs = visibleNumericAttributes(derived);
      const attrs = scenario.includeSubset ? allAttrs.filter((attr, index) => index % 3 !== 1) : allAttrs;
      const include = attrs.map((attr) => attr.id);
      const startSum = attrs.reduce((total, attr) => total + attr.currentValue, 0);

      for (const budget of [0, 7, 29, 100, 333, 999]) {
        const expected = exactMaxPoints(attrs, budget);
        const actual = Calc.maximizeSum(derived, { include, budget });
        const label = `${arch.id} ${scenario.name} ${budget} AP`;
        assert.equal(actual.points, expected.points, `${label}: points`);
        assert.equal(actual.added, expected.cost, `${label}: cost`);
        assert.equal(actual.sum, startSum + expected.points, `${label}: sum`);
        assert.equal(actual.added <= budget, true, `${label}: budget`);
        checked++;
      }
    }
  }
  assert.equal(checked, DATA.archetypes.length * 12);
});

test('single-position optimizer is exact and treats AP as a ceiling', async () => {
  const { Calc } = createContext();
  const build = defaultBuild({ archetypeId: 'fwd_finisher', positions: ['ST'] });
  const result = await Calc.optimize(Calc.derive(build), { positions: ['ST'], mode: 'max', additionalAP: 200, disabled: [] });
  assert.equal(result.status, 'optimal');
  assert.equal(result.feasible, true);
  assert.equal(result.spent <= 200, true);
  assert.equal(result.overall, result.overalls.ST);
});

test('optimizer reports the actual maximum when a single-position target is unreachable', async () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({ archetypeId: 'fwd_finisher', positions: ['ST'] }));
  const maximum = await Calc.optimize(derived, { positions: ['ST'], mode: 'max', additionalAP: 100000, disabled: [] });
  const unreachable = await Calc.optimize(derived, { positions: ['ST'], mode: 'min', targetOverall: 99, disabled: [] });
  assert.equal(unreachable.status, 'optimal');
  assert.equal(unreachable.feasible, false);
  assert.equal(unreachable.overall, maximum.overall);
  assert.equal(unreachable.spent, maximum.spent);
  assert.equal(unreachable.overall, 96);
});

test('multi-position optimizer validates cost, trims wasted AP and respects position order', async () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({ archetypeId: 'fwd_finisher', positions: ['ST', 'CAM'] }));
  const options = { mode: 'max', additionalAP: 250, disabled: [] };
  const first = await Calc.optimize(derived, { ...options, positions: ['ST', 'CAM'] });
  const reversed = await Calc.optimize(derived, { ...options, positions: ['CAM', 'ST'] });
  const attrs = derived.categories.flatMap((category) => category.attributes);
  const actualCost = attrs.reduce((total, attr) => {
    const value = first.values[attr.id] == null ? attr.currentValue : first.values[attr.id];
    return total + Calc.apCost(attr.tier, attr.currentValue, value);
  }, 0);
  assert.equal(first.feasible, true);
  assert.equal(first.spent, actualCost);
  assert.equal(first.spent <= 250, true);
  assert.equal(first.objective.min, reversed.objective.min);
  assert.equal(first.objective.sum, reversed.objective.sum);

  for (const attr of attrs) {
    const value = first.values[attr.id];
    if (value == null || value <= attr.currentValue) continue;
    const candidate = { ...first.values, [attr.id]: value - 1 };
    const overalls = Calc.overallMapForValues(['ST', 'CAM'], derived, candidate);
    const values = Object.values(overalls);
    assert.equal(
      Math.min(...values) < first.objective.min
        || values.reduce((total, overall) => total + overall, 0) < first.objective.sum,
      true,
      `${attr.id} contains removable AP`,
    );
  }
});

test('multi-position optimizer beats the reported Creator CAM CM CDM regression build', async () => {
  const { Calc } = createContext();
  const positions = ['CAM', 'CM', 'CDM'];
  const derived = Calc.derive(defaultBuild({
    archetypeId: 'mid_creator',
    positions,
  }));
  const referenceValues = {
    agility: 74,
    reactions: 98,
    ball_control: 96,
    dribbling: 96,
    finishing: 94,
    long_shots: 94,
    vision: 99,
    short_passing: 96,
    long_passing: 96,
    interceptions: 85,
    def_aware: 85,
    standing_tackle: 90,
    sliding_tackle: 84,
    acceleration: 84,
    sprint_speed: 81,
    stamina: 92,
    strength: 83,
    aggression: 90,
  };
  const referenceOveralls = Calc.overallMapForValues(positions, derived, referenceValues);
  const referenceList = Object.values(referenceOveralls);
  const referenceObjective = {
    min: Math.min(...referenceList),
    sum: referenceList.reduce((total, overall) => total + overall, 0),
  };
  const result = await Calc.optimize(derived, {
    positions,
    mode: 'max',
    additionalAP: derived.ap.available,
    disabled: [],
  });

  assert.equal(result.spent <= derived.ap.available, true);
  assert.equal(
    result.objective.min > referenceObjective.min
      || (result.objective.min === referenceObjective.min && result.objective.sum >= referenceObjective.sum),
    true,
  );
  assert.deepEqual({ ...result.overalls }, { CAM: 94, CM: 95, CDM: 92 });
  assert.deepEqual({ ...result.objective }, { min: 92, sum: 281 });
  // Without a browser Worker, the exact OVR pair is certified while the
  // separate minimum-AP polish remains unavailable.
  assert.equal(result.status, 'ovr-optimal');
});

test('multi-position sum certificate accounts for lower clamping and never overclaims', async () => {
  const context = createContext();
  const { Calc } = context;
  const baseRaws = [2.9367021271, -0.7115444101, 1.7211302193];
  const definitions = [
    { id: 'a0', tier: 'tier0', maxValue: 62, weights: [0.073015, 0.170258, 1.007353] },
    { id: 'a1', tier: 'tier2', maxValue: 62, weights: [0.809725, 0.723341, 0.987745] },
    { id: 'a2', tier: 'tier1', maxValue: 61, weights: [1.263918, 0.215547, 0.025496] },
    { id: 'a3', tier: 'tier2', maxValue: 62, weights: [0.08947, 0.811624, 1.479769] },
  ];
  context.OVERALL_MODEL = {
    version: 2,
    gameCalibrationOffset: -1,
    limits: { min: 1, max: 99 },
    positions: Object.fromEntries(baseRaws.map((raw, positionIndex) => [
      `P${positionIndex}`,
      {
        intercept: raw - definitions.reduce((sum, attr) => sum + attr.weights[positionIndex] * 60, 0),
        weights: Object.fromEntries(definitions.map((attr) => [attr.id, attr.weights[positionIndex]])),
      },
    ])),
  };
  const derived = {
    arch: { position: 'MID' },
    categories: [{
      id: 'synthetic',
      attributes: definitions.map((attr) => ({
        id: attr.id,
        tier: attr.tier,
        baseValue: 60,
        currentValue: 60,
        maxValue: attr.maxValue,
      })),
    }],
    ap: { total: 7, spent: 0, available: 7 },
  };
  const positions = ['P0', 'P1', 'P2'];
  const result = await Calc.optimize(derived, {
    positions,
    mode: 'max',
    additionalAP: 7,
    disabled: [],
  });
  const exhaustiveCounterexample = Calc.overallMapForValues(positions, derived, {
    a0: 62,
    a1: 61,
    a2: 61,
    a3: 61,
  });

  assert.deepEqual({ ...result.overalls }, { P0: 4, P1: 1, P2: 4 });
  assert.deepEqual({ ...exhaustiveCounterexample }, { P0: 4, P1: 1, P2: 5 });
  assert.equal(result.status, 'best-found');
});

test('weighted multi-position search covers other archetypes and position sets', async () => {
  const { Calc } = createContext();
  const cases = [
    {
      archetypeId: 'mid_recycler',
      positions: ['CAM', 'CM', 'CDM'],
      expected: { CAM: 93, CM: 94, CDM: 93 },
    },
    {
      archetypeId: 'fwd_magician',
      positions: ['ST', 'CAM', 'RW'],
      expected: { ST: 94, CAM: 94, RW: 95 },
    },
    {
      archetypeId: 'def_boss',
      positions: ['CB', 'RB', 'CDM'],
      expected: { CB: 96, RB: 95, CDM: 95 },
    },
    {
      archetypeId: 'mid_recycler',
      positions: ['CAM', 'CDM'],
      expected: { CAM: 93, CDM: 93 },
    },
  ];

  for (const item of cases) {
    const derived = Calc.derive(defaultBuild({
      archetypeId: item.archetypeId,
      positions: item.positions,
    }));
    const result = await Calc.optimize(derived, {
      positions: item.positions,
      mode: 'max',
      additionalAP: derived.ap.available,
      disabled: [],
    });
    assert.deepEqual({ ...result.overalls }, item.expected, `${item.archetypeId} ${item.positions.join('/')}`);
    assert.equal(result.spent <= derived.ap.available, true);
  }
});

test('minimum-AP optimization returns a feasible, cost-consistent build', async () => {
  const { Calc } = createContext();
  const derived = Calc.derive(defaultBuild({ archetypeId: 'fwd_finisher', positions: ['ST', 'CAM'] }));
  const result = await Calc.optimize(derived, { positions: ['ST', 'CAM'], mode: 'min', targetOverall: 80, disabled: [] });
  const attrs = derived.categories.flatMap((category) => category.attributes);
  const actualCost = attrs.reduce((total, attr) => {
    const value = result.values[attr.id] == null ? attr.currentValue : result.values[attr.id];
    return total + Calc.apCost(attr.tier, attr.currentValue, value);
  }, 0);
  assert.equal(result.feasible, true);
  assert.equal(result.objective.min >= 80, true);
  assert.equal(result.spent, actualCost);
});
