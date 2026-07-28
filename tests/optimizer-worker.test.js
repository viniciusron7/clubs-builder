const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext } = require('./helpers');

function enumerate(problem) {
  let best = null;
  const walk = (index, cost, gains, choices) => {
    if (index === problem.attrs.length) {
      const offset = Number.isFinite(problem.overallOffset) ? problem.overallOffset : 0;
      const overalls = problem.baseRaws.map((raw, i) => Math.max(1, Math.min(99, Math.floor(raw + gains[i] + 1e-9) + offset)));
      const candidate = { cost, choices: choices.slice(), min: Math.min(...overalls), sum: overalls.reduce((a, b) => a + b, 0) };
      if (problem.mode === 'min') {
        if (candidate.min < problem.targetOverall) return;
        if (!best || candidate.cost < best.cost || (candidate.cost === best.cost && candidate.sum > best.sum)) best = candidate;
      } else if (!best || candidate.min > best.min || (candidate.min === best.min && candidate.sum > best.sum) || (candidate.min === best.min && candidate.sum === best.sum && candidate.cost < best.cost)) best = candidate;
      return;
    }
    problem.attrs[index].options.forEach((option, optionIndex) => {
      if (cost + option.cost > problem.budget) return;
      choices[index] = optionIndex;
      walk(index + 1, cost + option.cost, gains.map((gain, i) => gain + option.gains[i]), choices);
    });
  };
  walk(0, 0, problem.baseRaws.map(() => 0), []);
  return best;
}

function fixture(mode, targetOverall = null) {
  return {
    mode,
    budget: 5,
    baseRaws: [79.3, 80.1],
    targetOverall,
    stateLimit: 250000,
    timeLimitMs: 2000,
    attrs: [
      { id: 'a', value: 70, options: [{ value: 70, cost: 0, gains: [0, 0] }, { value: 71, cost: 1, gains: [0.8, 0.2] }, { value: 72, cost: 3, gains: [1.6, 0.4] }] },
      { id: 'b', value: 70, options: [{ value: 70, cost: 0, gains: [0, 0] }, { value: 71, cost: 1, gains: [0.2, 0.8] }, { value: 72, cost: 3, gains: [0.4, 1.6] }] },
      { id: 'c', value: 70, options: [{ value: 70, cost: 0, gains: [0, 0] }, { value: 71, cost: 2, gains: [0.7, 0.7] }] },
    ],
  };
}

test('multi max solver matches exhaustive objective and proves optimality', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  const problem = fixture('max');
  const expected = enumerate(problem);
  const actual = MultiOverallSolver.solve(problem);
  assert.equal(actual.status, 'optimal');
  assert.equal(actual.objective.min, expected.min);
  assert.equal(actual.objective.sum, expected.sum);
  assert.equal(actual.added, expected.cost);
});

test('multi minimum-AP solver matches exhaustive search', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  const problem = fixture('min', 81);
  const expected = enumerate(problem);
  const actual = MultiOverallSolver.solve(problem);
  assert.equal(actual.status, 'optimal');
  assert.equal(actual.feasible, true);
  assert.equal(actual.added, expected.cost);
  assert.equal(actual.objective.min >= 81, true);
});

test('multi solver applies the same game OVR calibration as the main calculator', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  const problem = fixture('min', 80);
  problem.overallOffset = -1;
  const expected = enumerate(problem);
  const actual = MultiOverallSolver.solve(problem);
  assert.equal(actual.status, 'optimal');
  assert.equal(actual.feasible, true);
  assert.equal(actual.added, expected.cost);
  assert.equal(actual.objective.min, expected.min);
});

test('bounded solver labels results as best-found', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  const problem = fixture('max');
  problem.stateLimit = 2;
  const actual = MultiOverallSolver.solve(problem);
  assert.equal(actual.status, 'best-found');
  assert.equal(actual.feasible, true);
});

test('bounded solver keeps a stronger deterministic seed', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  const problem = fixture('max');
  const expected = enumerate(problem);
  problem.stateLimit = 2;
  problem.seedValues = Object.fromEntries(problem.attrs.map((attr, index) => [
    attr.id,
    attr.options[expected.choices[index]].value,
  ]));
  const actual = MultiOverallSolver.solve(problem);
  assert.equal(actual.status, 'best-found');
  assert.equal(actual.objective.min, expected.min);
  assert.equal(actual.objective.sum, expected.sum);
});

test('solver matches exhaustive search across deterministic reduced problems', () => {
  const { MultiOverallSolver } = createContext(['js/optimizer-worker.js']);
  let seed = 0x5eed1234;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  let checkedMinimumCases = 0;

  for (let iteration = 0; iteration < 200; iteration++) {
    const mode = iteration % 2 === 0 ? 'max' : 'min';
    const baseRaws = [70 + random(), 70 + random()];
    const problem = {
      mode,
      budget: 6 + Math.floor(random() * 5),
      baseRaws,
      targetOverall: Math.floor(Math.min(...baseRaws)) + 1,
      stateLimit: 250000,
      timeLimitMs: 2000,
      attrs: Array.from({ length: 5 }, (_, index) => {
        const first = [0.2 + random() * 0.8, 0.2 + random() * 0.8];
        return {
          id: `attr-${index}`,
          value: 70,
          options: [
            { value: 70, cost: 0, gains: [0, 0] },
            { value: 71, cost: 1 + Math.floor(random() * 2), gains: first },
            { value: 72, cost: 4 + Math.floor(random() * 2), gains: [first[0] + random() * 0.8, first[1] + random() * 0.8] },
          ],
        };
      }),
    };
    const expected = enumerate(problem);
    if (!expected) continue;
    if (mode === 'min') checkedMinimumCases++;
    const actual = MultiOverallSolver.solve(problem);
    assert.equal(actual.status, 'optimal');
    assert.equal(actual.feasible, true);
    assert.equal(actual.objective.min, expected.min);
    assert.equal(actual.objective.sum, expected.sum);
    assert.equal(actual.added, expected.cost);
  }

  assert.equal(checkedMinimumCases > 50, true);
});
