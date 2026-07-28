const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext, defaultBuild } = require('./helpers');

test('history restores complete build state and clears redo after a new change', () => {
  const { BuildHistory } = createContext(['js/history.js']);
  const history = BuildHistory.create(3);
  const first = defaultBuild();
  const second = defaultBuild({ level: 100, attributes: { finishing: 90 } });
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

test('v2 share links preserve PlayStyle purchases, ignore removed Facilities fields and v1 remains readable', () => {
  const { Share } = createContext(['js/data.js', 'js/share.js']);
  const build = defaultBuild({
    facilities: { player_fac: 1 },
    aiFacilities: { ai_fac: 2 },
    positions: ['ST', 'CAM'],
    playstylePurchases: {
      finesse_shot: {
        before: { finishing: 75 },
        after: { finishing: 80 },
      },
    },
  });
  const decoded = Share.decode(Share.encode(build));
  assert.equal('facilities' in decoded, false);
  assert.equal('aiFacilities' in decoded, false);
  assert.equal('clubLevel' in decoded, false);
  assert.equal(JSON.stringify(decoded.positions), JSON.stringify(build.positions));
  assert.equal(JSON.stringify(decoded.playstylePurchases), JSON.stringify(build.playstylePurchases));

  const legacyJson = JSON.stringify({ a: 'fwd_finisher', l: 50, c: 10, f: { legacy: 1 }, af: { old_ai: 2 }, po: ['ST'] });
  const legacy = Buffer.from(legacyJson).toString('base64url');
  const decodedLegacy = Share.decode(legacy);
  assert.equal('facilities' in decodedLegacy, false);
  assert.equal('aiFacilities' in decodedLegacy, false);
  assert.equal('clubLevel' in decodedLegacy, false);
  assert.equal(decodedLegacy.level, 50);
  assert.equal(Share.decode('not-valid-base64'), null);
});
