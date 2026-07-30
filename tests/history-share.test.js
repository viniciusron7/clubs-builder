const assert = require('node:assert/strict');
const test = require('node:test');
const { createContext, defaultBuild } = require('./helpers');

test('history restores complete build state and clears redo after a new change', () => {
  const { BuildHistory } = createContext(['js/history.js']);
  const history = BuildHistory.create(3);
  const first = defaultBuild();
  const second = defaultBuild({ level: 100, facilities: { equipment_manager: 1 }, aiFacilities: { ai_gk_goalkeeping_coach: 1 } });
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

test('v2 share links preserve Facilities and PlayStyle purchases while v1 remains readable', () => {
  const { Share } = createContext(['js/data.js', 'js/share.js']);
  const build = defaultBuild({
    clubLevel: 10,
    facilities: { equipment_manager: 1 },
    aiFacilities: { ai_gk_goalkeeping_coach: 2 },
    positions: ['ST', 'CAM'],
    playstylePurchases: {
      finesse_shot: {
        before: { finishing: 75 },
        after: { finishing: 80 },
      },
    },
  });
  const decoded = Share.decode(Share.encode(build));
  assert.equal(decoded.clubLevel, build.clubLevel);
  assert.equal(JSON.stringify(decoded.facilities), JSON.stringify(build.facilities));
  assert.equal(JSON.stringify(decoded.aiFacilities), JSON.stringify(build.aiFacilities));
  assert.equal(JSON.stringify(decoded.positions), JSON.stringify(build.positions));
  assert.equal(JSON.stringify(decoded.playstylePurchases), JSON.stringify(build.playstylePurchases));

  const legacyJson = JSON.stringify({ a: 'fwd_finisher', l: 50, c: 10, f: { legacy: 1 }, af: { old_ai: 2 }, po: ['ST'] });
  const legacy = Buffer.from(legacyJson).toString('base64url');
  const decodedLegacy = Share.decode(legacy);
  assert.equal(JSON.stringify(decodedLegacy.facilities), JSON.stringify({ legacy: 1 }));
  assert.equal(JSON.stringify(decodedLegacy.aiFacilities), JSON.stringify({ old_ai: 2 }));
  assert.equal(decodedLegacy.clubLevel, 10);
  assert.equal(decodedLegacy.level, 50);
  assert.equal(Share.decode('not-valid-base64'), null);
});
