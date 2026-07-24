const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createContext, parseCsvLine, root } = require('./helpers');

test('fixed OVR formulas reproduce the expected base-card accuracy', (t) => {
  const { OVERALL_MODEL } = createContext();
  const fixture = process.env.EAFC26_VALIDATION_CSV
    ? path.resolve(process.env.EAFC26_VALIDATION_CSV)
    : path.resolve(root, '..', 'data/eafc26_ut_players.csv');
  if (!fs.existsSync(fixture)) {
    t.skip('Set EAFC26_VALIDATION_CSV to run the full statistical validation.');
    return;
  }
  const lines = fs.readFileSync(fixture, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift()).map((header) => header.replace(/^\uFEFF/, ''));
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const errors = { all: [], high: [], goalkeeper: [] };
  for (const line of lines) {
    const cells = parseCsvLine(line);
    if (!['Common', 'Rare'].includes(cells[index.rarity])) continue;
    if (['true', '1'].includes(String(cells[index.is_icon]).toLowerCase()) || ['true', '1'].includes(String(cells[index.is_hero]).toLowerCase())) continue;
    const position = cells[index.position];
    const formula = OVERALL_MODEL.positions[position];
    if (!formula) continue;
    const overall = Number(cells[index.overall]);
    let raw = formula.intercept;
    let valid = true;
    for (const [attr, weight] of Object.entries(formula.weights)) {
      const value = Number(cells[index[attr]]);
      if (!Number.isFinite(value)) { valid = false; break; }
      raw += weight * value;
    }
    if (!valid) continue;
    const error = Math.floor(raw + 1e-9) - overall;
    if (position === 'GK') errors.goalkeeper.push(error);
    else {
      errors.all.push(error);
      if (overall >= 75) errors.high.push(error);
    }
  }

  const metrics = (values) => ({
    exact: values.filter((error) => error === 0).length / values.length,
    within1: values.filter((error) => Math.abs(error) <= 1).length / values.length,
    bias: values.reduce((sum, error) => sum + error, 0) / values.length,
  });
  const all = metrics(errors.all);
  const high = metrics(errors.high);
  const goalkeeper = metrics(errors.goalkeeper);
  assert.equal(errors.all.length, 19363);
  assert.equal(errors.high.length, 2528);
  assert.equal(errors.goalkeeper.length, 2303);
  assert.equal(all.exact > 0.92 && all.within1 > 0.999, true);
  assert.equal(high.exact > 0.86 && high.within1 > 0.999, true);
  assert.equal(goalkeeper.exact > 0.97 && goalkeeper.within1 === 1, true);
  assert.equal(Math.abs(all.bias) < 0.05 && Math.abs(high.bias) < 0.05 && Math.abs(goalkeeper.bias) < 0.05, true);
});
