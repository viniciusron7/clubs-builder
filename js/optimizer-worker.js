/* Multi-position OVR solver. Runs in a Worker and is also loadable by Node tests. */
(function (root) {
  const EPS = 1e-9;
  const EXACT_PRUNE_LIMIT = 600;
  const BEAM_WIDTH = 4000;
  const LAYER_EXPANSION_LIMIT = 40000;

  const overallOffset = (problem) => {
    const offset = Number(problem.overallOffset);
    return Number.isFinite(offset) ? offset : 0;
  };
  const clampOverall = (problem, raw) => Math.max(1, Math.min(99, Math.floor(raw + EPS) + overallOffset(problem)));
  const addVectors = (a, b) => a.map((value, index) => value + (b[index] || 0));

  function evaluate(problem, state) {
    const raws = addVectors(problem.baseRaws, state.gains);
    const overalls = raws.map((raw) => clampOverall(problem, raw));
    return {
      raws,
      overalls,
      min: Math.min(...overalls),
      sum: overalls.reduce((total, value) => total + value, 0),
    };
  }

  function compareChoices(a, b) {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff) return diff;
    }
    return 0;
  }

  function betterMax(problem, candidate, incumbent) {
    if (!incumbent) return true;
    const a = evaluate(problem, candidate);
    const b = evaluate(problem, incumbent);
    if (a.min !== b.min) return a.min > b.min;
    if (a.sum !== b.sum) return a.sum > b.sum;
    if (candidate.cost !== incumbent.cost) return candidate.cost < incumbent.cost;
    return compareChoices(candidate.choices, incumbent.choices) < 0;
  }

  function targetMet(problem, state) {
    return evaluate(problem, state).min >= problem.targetOverall;
  }

  function targetDeficit(problem, state) {
    const ev = evaluate(problem, state);
    const rawTarget = problem.targetOverall - overallOffset(problem);
    return ev.raws.reduce((total, raw) => total + Math.max(0, rawTarget - raw), 0);
  }

  function betterMin(problem, candidate, incumbent) {
    const candidateMet = targetMet(problem, candidate);
    const incumbentMet = incumbent && targetMet(problem, incumbent);
    if (candidateMet !== incumbentMet) return candidateMet;
    if (candidateMet) {
      if (!incumbent || candidate.cost !== incumbent.cost) return !incumbent || candidate.cost < incumbent.cost;
      const a = evaluate(problem, candidate);
      const b = evaluate(problem, incumbent);
      if (a.sum !== b.sum) return a.sum > b.sum;
      return compareChoices(candidate.choices, incumbent.choices) < 0;
    }
    if (!incumbent) return true;
    const aDeficit = targetDeficit(problem, candidate);
    const bDeficit = targetDeficit(problem, incumbent);
    if (aDeficit !== bDeficit) return aDeficit < bDeficit;
    if (candidate.cost !== incumbent.cost) return candidate.cost < incumbent.cost;
    return compareChoices(candidate.choices, incumbent.choices) < 0;
  }

  function greedy(problem, startState, startAttr) {
    const dimensions = problem.baseRaws.length;
    const choices = Array(problem.attrs.length).fill(0);
    if (startState) startState.choices.forEach((choice, index) => { choices[index] = choice; });
    const state = startState
      ? { cost: startState.cost, gains: startState.gains.slice(), choices }
      : { cost: 0, gains: Array(dimensions).fill(0), choices };
    let best = { cost: state.cost, gains: state.gains.slice(), choices: state.choices.slice() };
    const firstAttr = startAttr || 0;

    while (true) {
      let selected = null;
      const before = evaluate(problem, state);
      const beforeDeficit = problem.mode === 'min' ? targetDeficit(problem, state) : 0;
      for (let attrIndex = firstAttr; attrIndex < problem.attrs.length; attrIndex++) {
        const attr = problem.attrs[attrIndex];
        const optionIndex = state.choices[attrIndex] || 0;
        if (optionIndex + 1 >= attr.options.length) continue;
        const current = attr.options[optionIndex];
        const next = attr.options[optionIndex + 1];
        const pointCost = next.cost - current.cost;
        if (state.cost + pointCost > problem.budget) continue;
        const pointGains = next.gains.map((gain, index) => gain - current.gains[index]);
        const candidate = { cost: state.cost + pointCost, gains: addVectors(state.gains, pointGains) };
        const after = evaluate(problem, candidate);
        let score;
        if (problem.mode === 'min') {
          const deficitGain = beforeDeficit - targetDeficit(problem, candidate);
          score = deficitGain * 1000000 + (after.min - before.min) * 10000 + (after.sum - before.sum) * 100;
        } else {
          const rawMinGain = Math.min(...after.raws) - Math.min(...before.raws);
          const rawSumGain = after.raws.reduce((sum, value) => sum + value, 0) - before.raws.reduce((sum, value) => sum + value, 0);
          score = (after.min - before.min) * 1000000000 + (after.sum - before.sum) * 1000000 + rawMinGain * 1000 + rawSumGain;
        }
        if (score <= EPS) continue;
        const ratio = score / Math.max(1, pointCost);
        if (!selected || ratio > selected.ratio + EPS || (Math.abs(ratio - selected.ratio) <= EPS && attrIndex < selected.attrIndex)) {
          selected = { attrIndex, pointCost, pointGains, ratio };
        }
      }
      if (!selected) break;
      state.cost += selected.pointCost;
      state.gains = addVectors(state.gains, selected.pointGains);
      state.choices[selected.attrIndex]++;
      const better = problem.mode === 'min' ? betterMin(problem, state, best) : betterMax(problem, state, best);
      if (better) best = { cost: state.cost, gains: state.gains.slice(), choices: state.choices.slice() };
      if (problem.mode === 'min' && targetMet(problem, state)) break;
    }
    return best;
  }

  function dominates(a, b) {
    if (a.cost > b.cost) return false;
    for (let index = 0; index < a.gains.length; index++) {
      if (a.gains[index] < b.gains[index]) return false;
    }
    return true;
  }

  function dedupe(states) {
    const map = new Map();
    for (const state of states) {
      // Rounding gains here can merge states on opposite sides of an OVR
      // boundary and produce a false proof of optimality.
      const key = state.gains.map((gain) => String(gain)).join('|');
      const existing = map.get(key);
      if (!existing || state.cost < existing.cost || (state.cost === existing.cost && compareChoices(state.choices, existing.choices) < 0)) map.set(key, state);
    }
    return [...map.values()];
  }

  function exactPareto(states) {
    const sorted = states.sort((a, b) => a.cost - b.cost || compareChoices(a.choices, b.choices));
    const kept = [];
    for (const state of sorted) {
      if (kept.some((candidate) => dominates(candidate, state))) continue;
      for (let index = kept.length - 1; index >= 0; index--) {
        if (dominates(state, kept[index])) kept.splice(index, 1);
      }
      kept.push(state);
    }
    return kept;
  }

  function remainingMaximums(problem) {
    const rows = Array(problem.attrs.length + 1);
    rows[problem.attrs.length] = Array(problem.baseRaws.length).fill(0);
    for (let index = problem.attrs.length - 1; index >= 0; index--) {
      const options = problem.attrs[index].options;
      rows[index] = addVectors(rows[index + 1], options[options.length - 1].gains);
    }
    return rows;
  }

  function canBeat(problem, state, remaining, incumbent) {
    const optimistic = { cost: state.cost, gains: addVectors(state.gains, remaining), choices: state.choices };
    if (problem.mode === 'min') {
      if (incumbent && targetMet(problem, incumbent) && state.cost > incumbent.cost) return false;
      return targetMet(problem, optimistic);
    }
    if (!incumbent) return true;
    const upper = evaluate(problem, optimistic);
    const best = evaluate(problem, incumbent);
    return upper.min > best.min || (upper.min === best.min && upper.sum >= best.sum);
  }

  function beam(problem, states, remaining) {
    const scored = states.map((state) => {
      const current = evaluate(problem, state);
      const optimistic = evaluate(problem, { gains: addVectors(state.gains, remaining) });
      return { state, current, optimistic, deficit: problem.mode === 'min' ? targetDeficit(problem, state) : 0 };
    });
    scored.sort((a, b) => {
      if (problem.mode === 'min') return a.deficit - b.deficit || a.state.cost - b.state.cost || compareChoices(a.state.choices, b.state.choices);
      return b.optimistic.min - a.optimistic.min
        || b.optimistic.sum - a.optimistic.sum
        || b.current.min - a.current.min
        || b.current.sum - a.current.sum
        || a.state.cost - b.state.cost
        || compareChoices(a.state.choices, b.state.choices);
    });
    return scored.slice(0, BEAM_WIDTH).map((entry) => entry.state);
  }

  function valuesFor(problem, state) {
    return Object.fromEntries(problem.attrs.map((attr, index) => {
      const option = attr.options[state.choices[index] || 0];
      return [attr.id, option.value];
    }));
  }

  function stateForValues(problem, values) {
    if (!values || typeof values !== 'object') return null;
    const state = {
      cost: 0,
      gains: Array(problem.baseRaws.length).fill(0),
      choices: Array(problem.attrs.length).fill(0),
    };
    for (let attrIndex = 0; attrIndex < problem.attrs.length; attrIndex++) {
      const attr = problem.attrs[attrIndex];
      const requested = values[attr.id];
      let optionIndex = 0;
      if (Number.isFinite(+requested)) {
        const exact = attr.options.findIndex((option) => option.value === Math.round(+requested));
        if (exact >= 0) optionIndex = exact;
      }
      const option = attr.options[optionIndex];
      state.choices[attrIndex] = optionIndex;
      state.cost += option.cost;
      state.gains = addVectors(state.gains, option.gains);
    }
    return state.cost <= problem.budget ? state : null;
  }

  function lpExpression(terms) {
    const filtered = terms.filter((term) => Number.isFinite(term.coefficient) && term.coefficient !== 0);
    if (!filtered.length) return '0';
    return filtered.map((term, index) => {
      const negative = term.coefficient < 0;
      const sign = index === 0 ? (negative ? '- ' : '') : (negative ? ' - ' : ' + ');
      return `${sign}${Math.abs(term.coefficient)} ${term.name}`;
    }).join('');
  }

  function buildPolishModel(problem, incumbent) {
    const polish = problem.polish;
    const dimensions = problem.baseRaws.length;
    if (!polish || !problem.exactMicro || !Array.isArray(problem.baseRawUnits)
      || problem.baseRawUnits.length !== dimensions
      || !Array.isArray(polish.maximumOveralls)
      || polish.maximumOveralls.length !== dimensions
      || !problem.attrs.every((attr) => Array.isArray(attr.options)
        && attr.options.length > 0
        && attr.options.every((option) => Array.isArray(option.gainUnits)
          && option.gainUnits.length === dimensions
          && option.gainUnits.every(Number.isInteger)))) return null;

    const objectiveTerms = [];
    const budgetTerms = [];
    const targetSumTerms = [];
    const rawTerms = Array.from({ length: dimensions }, () => []);
    const constraints = [];
    const binaries = [];
    const optionVariables = [];

    problem.attrs.forEach((attr, attrIndex) => {
      const pickTerms = [];
      const variables = [];
      attr.options.forEach((option, optionIndex) => {
        const name = `x_${attrIndex}_${optionIndex}`;
        variables.push(name);
        binaries.push(name);
        pickTerms.push({ coefficient: 1, name });
        objectiveTerms.push({ coefficient: option.cost, name });
        budgetTerms.push({ coefficient: option.cost, name });
        option.gainUnits.forEach((gain, positionIndex) => {
          rawTerms[positionIndex].push({ coefficient: gain, name });
        });
      });
      optionVariables.push(variables);
      constraints.push(`pick_attr_${attrIndex}: ${lpExpression(pickTerms)} = 1`);
    });

    for (let positionIndex = 0; positionIndex < dimensions; positionIndex++) {
      const pickTerms = [];
      const maximum = Math.floor(polish.maximumOveralls[positionIndex]);
      if (maximum < polish.targetMin) return null;
      for (let overall = polish.targetMin; overall <= maximum; overall++) {
        const name = `y_${positionIndex}_${overall}`;
        const requiredUnits = (overall - overallOffset(problem)) * polish.scale
          - problem.baseRawUnits[positionIndex];
        binaries.push(name);
        pickTerms.push({ coefficient: 1, name });
        targetSumTerms.push({ coefficient: overall, name });
        rawTerms[positionIndex].push({ coefficient: -requiredUnits, name });
      }
      constraints.push(`pick_ovr_${positionIndex}: ${lpExpression(pickTerms)} = 1`);
      constraints.push(`raw_${positionIndex}: ${lpExpression(rawTerms[positionIndex])} >= 0`);
    }

    const costCeiling = Math.min(problem.budget, incumbent.added);
    constraints.push(`budget: ${lpExpression(budgetTerms)} <= ${costCeiling}`);
    constraints.push(`target_sum: ${lpExpression(targetSumTerms)} = ${polish.targetSum}`);
    const lp = [
      'Minimize',
      ` obj: ${lpExpression(objectiveTerms)}`,
      'Subject To',
      ...constraints.map((constraint) => ` ${constraint}`),
      'Binary',
      ...binaries.map((name) => ` ${name}`),
      'End',
    ].join('\n');
    return { lp, optionVariables };
  }

  let highsPromise = null;
  async function loadHighs() {
    if (highsPromise) return highsPromise;
    if (typeof root.importScripts !== 'function' || !root.location) return null;
    root.importScripts('../assets/vendor/highs/highs.js');
    if (typeof root.Module !== 'function') return null;
    highsPromise = root.Module({
      locateFile: () => new URL('../assets/vendor/highs/highs.wasm', root.location.href).href,
      print: () => {},
      printErr: () => {},
    });
    return highsPromise;
  }

  async function polishOptimalCost(problem, incumbent) {
    const polish = problem.polish;
    if (!polish || incumbent.status === 'optimal'
      || incumbent.objective.min !== polish.targetMin
      || incumbent.objective.sum !== polish.targetSum) return incumbent;
    const model = buildPolishModel(problem, incumbent);
    if (!model) return incumbent;

    try {
      const highs = await loadHighs();
      if (!highs) return incumbent;
      const solution = highs.solve(model.lp, {
        output_flag: false,
        mip_rel_gap: 0,
        time_limit: Math.max(0.1, Number(polish.timeLimitSeconds) || 5),
      });
      if (!solution || !solution.Columns) return incumbent;

      const choices = [];
      let cost = 0;
      let gains = Array(problem.baseRaws.length).fill(0);
      for (let attrIndex = 0; attrIndex < problem.attrs.length; attrIndex++) {
        const names = model.optionVariables[attrIndex];
        let selected = -1;
        for (let optionIndex = 0; optionIndex < names.length; optionIndex++) {
          const column = solution.Columns[names[optionIndex]];
          if (column && column.Primal > 0.5) {
            if (selected >= 0) return incumbent;
            selected = optionIndex;
          }
        }
        if (selected < 0) return incumbent;
        const option = problem.attrs[attrIndex].options[selected];
        choices[attrIndex] = selected;
        cost += option.cost;
        gains = addVectors(gains, option.gains);
      }

      const state = { cost, gains, choices };
      const evaluation = evaluate(problem, state);
      if (cost > problem.budget || cost > incumbent.added
        || evaluation.min !== polish.targetMin
        || evaluation.sum !== polish.targetSum) return incumbent;
      return {
        feasible: true,
        added: cost,
        values: valuesFor(problem, state),
        overalls: evaluation.overalls,
        objective: { min: evaluation.min, sum: evaluation.sum },
        status: solution.Status === 'Optimal' ? 'optimal' : incumbent.status,
        visited: incumbent.visited,
        polished: true,
      };
    } catch (error) {
      return incumbent;
    }
  }

  function solve(problem) {
    const started = Date.now();
    const dimensions = problem.baseRaws.length;
    const stateLimit = Math.max(1, problem.stateLimit || 250000);
    const timeLimitMs = Math.max(1, problem.timeLimitMs || 2000);
    const maxRemaining = remainingMaximums(problem);
    let incumbent = greedy(problem);
    const seeded = stateForValues(problem, problem.seedValues);
    if (seeded) {
      const completedSeed = greedy(problem, seeded, 0);
      if (problem.mode === 'min' ? betterMin(problem, completedSeed, incumbent) : betterMax(problem, completedSeed, incumbent)) {
        incumbent = completedSeed;
      }
    }
    let states = [{ cost: 0, gains: Array(dimensions).fill(0), choices: Array(problem.attrs.length).fill(0) }];
    let visited = 1;
    let bounded = false;
    let stoppedAt = problem.attrs.length;

    for (let attrIndex = 0; attrIndex < problem.attrs.length; attrIndex++) {
      const attr = problem.attrs[attrIndex];
      let expanded = [];
      let stopped = false;
      let layerTruncated = false;
      for (const state of states) {
        for (let optionIndex = 0; optionIndex < attr.options.length; optionIndex++) {
          const option = attr.options[optionIndex];
          const cost = state.cost + option.cost;
          if (cost > problem.budget) break;
          const candidate = {
            cost,
            gains: addVectors(state.gains, option.gains),
            choices: state.choices.slice(),
          };
          candidate.choices[attrIndex] = optionIndex;
          visited++;
          if (problem.mode === 'min' ? betterMin(problem, candidate, incumbent) : betterMax(problem, candidate, incumbent)) incumbent = candidate;
          if (canBeat(problem, candidate, maxRemaining[attrIndex + 1], incumbent)) expanded.push(candidate);
          if (visited >= stateLimit || Date.now() - started >= timeLimitMs) { stopped = true; break; }
          if (expanded.length >= LAYER_EXPANSION_LIMIT) {
            layerTruncated = true;
            expanded = beam(problem, dedupe(expanded), maxRemaining[attrIndex + 1]);
          }
        }
        if (stopped) break;
      }

      if (stopped) {
        bounded = true;
        // Expanded candidates have already selected the current attribute and can
        // still be completed greedily. The previous code discarded them and kept
        // only the initial incumbent, making the recovery below unreachable.
        if (expanded.length) {
          states = beam(problem, dedupe(expanded), maxRemaining[attrIndex + 1]);
          stoppedAt = attrIndex + 1;
        } else {
          stoppedAt = attrIndex;
        }
        break;
      }
      if (!expanded.length && !stopped) {
        states = [];
        stoppedAt = problem.attrs.length;
        break;
      }
      states = dedupe(expanded);
      if (layerTruncated) bounded = true;
      if (states.length <= EXACT_PRUNE_LIMIT) {
        states = exactPareto(states);
      } else {
        bounded = true;
        states = beam(problem, states, maxRemaining[attrIndex + 1]);
      }
    }

    if (stoppedAt < problem.attrs.length) {
      const seeds = beam(problem, states, maxRemaining[stoppedAt]).slice(0, 100);
      for (const seed of seeds) {
        const completed = greedy(problem, seed, stoppedAt);
        if (problem.mode === 'min' ? betterMin(problem, completed, incumbent) : betterMax(problem, completed, incumbent)) incumbent = completed;
      }
    } else {
      for (const state of states) {
        if (problem.mode === 'min' ? betterMin(problem, state, incumbent) : betterMax(problem, state, incumbent)) incumbent = state;
      }
    }

    const evaluation = evaluate(problem, incumbent);
    const feasible = problem.mode === 'max' || evaluation.min >= problem.targetOverall;
    return {
      feasible,
      added: incumbent.cost,
      values: valuesFor(problem, incumbent),
      overalls: evaluation.overalls,
      objective: { min: evaluation.min, sum: evaluation.sum },
      status: bounded ? 'best-found' : 'optimal',
      visited,
    };
  }

  root.MultiOverallSolver = { solve, buildPolishModel, polishOptimalCost };
  if (typeof root.addEventListener === 'function' && typeof root.postMessage === 'function') {
    root.addEventListener('message', async (event) => {
      try {
        const result = solve(event.data);
        root.postMessage({ ok: true, result: await polishOptimalCost(event.data, result) });
      } catch (error) {
        root.postMessage({ ok: false, error: error && error.message ? error.message : String(error) });
      }
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
