const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext, defaultBuild } = require('./helpers');

test('history restores complete build state and clears redo after a new change', () => {
  const { BuildHistory } = createContext(['js/history.js']);
  const history = BuildHistory.create(3);
  const first = defaultBuild();
  const second = defaultBuild({ level: 100, aiFacilities: { ai_test: 2 } });
  const third = defaultBuild({ level: 90, positions: ['ST', 'CAM'] });
  assert.equal(history.record(first, second), true);
  let result = history.undo(second);
  assert.equal(result.changed, true);
  assert.equal(JSON.stringify(result.state), JSON.stringify(first));
  result = history.redo(first);
  assert.equal(JSON.stringify(result.state), JSON.stringify(second));
  history.record(second, third);
  assert.equal(history.canRedo(), false);
});

test('v2 share links round-trip AI facilities and v1 remains readable', () => {
  const { Share } = createContext(['js/data.js', 'js/share.js']);
  const build = defaultBuild({ facilities: { player_fac: 1 }, aiFacilities: { ai_fac: 2 }, positions: ['ST', 'CAM'] });
  const decoded = Share.decode(Share.encode(build));
  assert.equal(JSON.stringify(decoded.facilities), JSON.stringify(build.facilities));
  assert.equal(JSON.stringify(decoded.aiFacilities), JSON.stringify(build.aiFacilities));
  assert.equal(JSON.stringify(decoded.positions), JSON.stringify(build.positions));

  const legacyJson = JSON.stringify({ a: 'fwd_finisher', l: 50, f: { legacy: 1 }, po: ['ST'] });
  const legacy = Buffer.from(legacyJson).toString('base64url');
  const decodedLegacy = Share.decode(legacy);
  assert.equal(JSON.stringify(decodedLegacy.aiFacilities), '{}');
  assert.equal(decodedLegacy.level, 50);
  assert.equal(Share.decode('not-valid-base64'), null);
});
