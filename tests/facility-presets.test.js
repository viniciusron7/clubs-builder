const assert = require('node:assert/strict');
const test = require('node:test');

const FacilityPresets = require('../js/facility-presets.js');

const STORAGE_KEY = 'fc26-player-facility-presets-v1';
const PLAYER_FACILITIES = [
  { id: 'sports_scientist', levels: [{}, {}, {}, {}] },
  { id: 'equipment_manager', levels: [{}, {}, {}, {}] },
];

function storageFake(options = {}) {
  const values = new Map();
  if (options.initial != null) values.set(STORAGE_KEY, String(options.initial));
  return {
    getItem(key) {
      if (options.throwOnRead) throw new Error('read failed');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnWrite) throw new Error('write failed');
      values.set(key, String(value));
    },
    removeItem(key) {
      if (options.throwOnRemove) throw new Error('remove failed');
      values.delete(key);
    },
    values,
  };
}

function createApi(storage = storageFake()) {
  return FacilityPresets.create(PLAYER_FACILITIES, { storage });
}

test('sanitization keeps only valid Player Facility levels in definition order', () => {
  const api = createApi();
  assert.deepEqual(api.sanitizeFacilities({
    equipment_manager: 3,
    sports_scientist: 2,
    ai_gk_goalkeeping_coach: 2,
    unknown: 1,
  }), {
    sports_scientist: 2,
    equipment_manager: 3,
  });
  assert.deepEqual(api.sanitizeFacilities({
    sports_scientist: 0,
    equipment_manager: 4,
  }), {});
  assert.deepEqual(api.sanitizeFacilities(null), {});
});

test('save and list use the versioned schema and return defensive copies', () => {
  const storage = storageFake();
  const api = createApi(storage);
  const result = api.save('  Fast   winger  ', {
    sports_scientist: 2,
    ai_gk_goalkeeping_coach: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.preset.name, 'Fast winger');
  assert.deepEqual(result.preset.facilities, { sports_scientist: 2 });
  assert.equal(Number.isSafeInteger(result.preset.createdAt), true);
  const payload = JSON.parse(storage.values.get(api.storageKey));
  assert.deepEqual(Object.keys(payload), ['v', 'presets']);
  assert.equal(payload.v, 1);
  assert.equal(payload.presets.length, 1);
  assert.equal(Object.hasOwn(payload.presets[0].facilities, 'ai_gk_goalkeeping_coach'), false);

  result.preset.name = 'Changed';
  result.presets[0].facilities.sports_scientist = 1;
  const firstList = api.list();
  firstList[0].name = 'Changed again';
  assert.equal(api.list()[0].name, 'Fast winger');
  assert.equal(api.list()[0].facilities.sports_scientist, 2);
});

test('blank names receive unique Club names and case-insensitive duplicates update', () => {
  const api = createApi();
  const first = api.save('', { sports_scientist: 1 });
  const second = api.save('   ', { equipment_manager: 1 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.preset.name, 'Club 1');
  assert.equal(second.preset.name, 'Club 2');

  const updated = api.save('club 1', { equipment_manager: 3 });
  assert.equal(updated.ok, true);
  assert.equal(updated.preset.id, first.preset.id);
  assert.equal(updated.preset.createdAt, first.preset.createdAt);
  assert.deepEqual(updated.preset.facilities, { equipment_manager: 3 });
  assert.equal(api.list().length, 2);
});

test('names longer than 40 characters and saves beyond the limit fail closed', () => {
  const api = createApi();
  assert.deepEqual(api.save('x'.repeat(41), {}).error, 'name_too_long');
  for (let index = 1; index <= api.limits.maxPresets; index += 1) {
    assert.equal(api.save(`Named ${index}`, { sports_scientist: 1 }).ok, true);
  }
  assert.equal(api.list().length, 20);
  assert.equal(api.save('One too many', {}).error, 'limit_reached');
  assert.equal(api.save('named 1', { equipment_manager: 2 }).ok, true);
  assert.equal(api.list().length, 20);
});

test('remove deletes only the requested preset and reports missing ids', () => {
  const api = createApi();
  const first = api.save('First', { sports_scientist: 1 }).preset;
  const second = api.save('Second', { equipment_manager: 2 }).preset;
  assert.equal(api.remove('missing').error, 'not_found');
  const removed = api.remove(first.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.preset.id, first.id);
  assert.deepEqual(removed.presets.map((preset) => preset.id), [second.id]);
  assert.deepEqual(api.list().map((preset) => preset.id), [second.id]);
});

test('corrupt, stale and duplicate stored entries are ignored safely', () => {
  const corrupt = createApi(storageFake({ initial: '{' }));
  assert.deepEqual(corrupt.list(), []);

  const payload = {
    v: 1,
    presets: [
      { id: 'valid', name: 'Valid', facilities: { sports_scientist: 2 }, createdAt: 1 },
      { id: 'valid', name: 'Duplicate id', facilities: {}, createdAt: 2 },
      { id: 'other', name: 'valid', facilities: {}, createdAt: 3 },
      { id: 'bad space', name: 'Bad id', facilities: {}, createdAt: 4 },
      { id: 'ai-only', name: 'AI only', facilities: { ai_gk_goalkeeping_coach: 3 }, createdAt: 5 },
    ],
  };
  const api = createApi(storageFake({ initial: JSON.stringify(payload) }));
  assert.deepEqual(api.list().map(({ id, name, facilities }) => ({ id, name, facilities })), [
    { id: 'valid', name: 'Valid', facilities: { sports_scientist: 2 } },
    { id: 'ai-only', name: 'AI only', facilities: {} },
  ]);
});

test('storage availability probe is restored and failures never throw', () => {
  const storage = storageFake();
  storage.values.set(`${STORAGE_KEY}-probe`, 'original');
  const api = createApi(storage);
  assert.equal(api.isAvailable(), true);
  assert.equal(api.storageAvailable(), true);
  assert.equal(storage.values.get(`${STORAGE_KEY}-probe`), 'original');

  const readFailure = createApi(storageFake({ throwOnRead: true }));
  assert.equal(readFailure.isAvailable(), false);
  assert.deepEqual(readFailure.list(), []);
  assert.equal(readFailure.save('Club', {}).error, 'storage_read_failed');
  assert.equal(readFailure.remove('preset-id').error, 'storage_read_failed');

  const writeFailure = createApi(storageFake({ throwOnWrite: true }));
  assert.equal(writeFailure.isAvailable(), false);
  assert.equal(writeFailure.save('Club', {}).error, 'storage_write_failed');

  const blocked = FacilityPresets.create(PLAYER_FACILITIES, { storage: null });
  assert.equal(blocked.isAvailable(), false);
  assert.deepEqual(blocked.list(), []);
  assert.equal(blocked.save('Club', {}).error, 'storage_unavailable');
});
