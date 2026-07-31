(function (root, factory) {
  'use strict';

  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FacilityPresets = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function facilityPresetsModule(root) {
  'use strict';

  const STORAGE_KEY = 'fc26-player-facility-presets-v1';
  const VERSION = 1;
  const MAX_PRESETS = 20;
  const MAX_NAME_LENGTH = 40;
  let fallbackIdCounter = 0;

  function normalizeName(value) {
    if (typeof value !== 'string') return '';
    return value
      .normalize('NFKC')
      .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  function characterLength(value) {
    return Array.from(value).length;
  }

  function validId(value) {
    return typeof value === 'string'
      && value.length >= 1
      && value.length <= 100
      && /^[A-Za-z0-9_-]+$/.test(value);
  }

  function normalizeDefinitions(input) {
    const source = Array.isArray(input)
      ? input
      : input && Array.isArray(input.facilities)
        ? input.facilities
        : [];
    const ids = new Set();
    const clean = [];
    source.forEach((definition) => {
      if (!definition
        || !validId(definition.id)
        || ids.has(definition.id)
        || !Array.isArray(definition.levels)) return;
      ids.add(definition.id);
      clean.push({
        id: definition.id,
        maximum: definition.levels.length - 1,
      });
    });
    return clean;
  }

  function create(definitions, options = {}) {
    const playerDefinitions = normalizeDefinitions(definitions);

    function getStorage() {
      try {
        if (Object.prototype.hasOwnProperty.call(options, 'storage')) {
          return options.storage || null;
        }
        return root && root.localStorage ? root.localStorage : null;
      } catch (error) {
        return null;
      }
    }

    function sanitizeFacilities(input) {
      const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const clean = {};
      playerDefinitions.forEach((definition) => {
        const star = Number(source[definition.id]);
        if (!Number.isInteger(star) || star < 1 || star > definition.maximum) return;
        clean[definition.id] = star;
      });
      return clean;
    }

    function sanitizePreset(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const name = normalizeName(value.name);
      if (!validId(value.id) || !name || characterLength(name) > MAX_NAME_LENGTH) return null;
      const createdAt = Number(value.createdAt);
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
      return {
        id: value.id,
        name,
        facilities: sanitizeFacilities(value.facilities),
        createdAt,
      };
    }

    function cleanPayload(raw) {
      if (!raw) return [];
      try {
        const payload = JSON.parse(raw);
        if (!payload || payload.v !== VERSION || !Array.isArray(payload.presets)) return [];
        const ids = new Set();
        const names = new Set();
        const clean = [];
        for (const candidate of payload.presets) {
          const preset = sanitizePreset(candidate);
          if (!preset) continue;
          const nameKey = preset.name.toLocaleLowerCase('en-US');
          if (ids.has(preset.id) || names.has(nameKey)) continue;
          ids.add(preset.id);
          names.add(nameKey);
          clean.push(preset);
          if (clean.length >= MAX_PRESETS) break;
        }
        return clean;
      } catch (error) {
        return [];
      }
    }

    function readState() {
      const storage = getStorage();
      if (!storage || typeof storage.getItem !== 'function') {
        return { ok: false, presets: [], error: 'storage_unavailable' };
      }
      try {
        return {
          ok: true,
          presets: cleanPayload(storage.getItem(STORAGE_KEY)),
        };
      } catch (error) {
        return { ok: false, presets: [], error: 'storage_read_failed' };
      }
    }

    function writePresets(presets) {
      const storage = getStorage();
      if (!storage || typeof storage.setItem !== 'function') {
        return { ok: false, error: 'storage_unavailable' };
      }
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, presets }));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: 'storage_write_failed' };
      }
    }

    function clonePreset(preset) {
      return {
        id: preset.id,
        name: preset.name,
        facilities: { ...preset.facilities },
        createdAt: preset.createdAt,
      };
    }

    function clonePresets(presets) {
      return presets.map(clonePreset);
    }

    function generatedName(presets) {
      const names = new Set(presets.map((preset) => preset.name.toLocaleLowerCase('en-US')));
      for (let index = 1; index <= MAX_PRESETS + 1; index++) {
        const candidate = `Club ${index}`;
        if (!names.has(candidate.toLocaleLowerCase('en-US'))) return candidate;
      }
      return 'Club';
    }

    function generatedId(presets) {
      const ids = new Set(presets.map((preset) => preset.id));
      try {
        const id = root && root.crypto && typeof root.crypto.randomUUID === 'function'
          ? root.crypto.randomUUID()
          : '';
        if (validId(id) && !ids.has(id)) return id;
      } catch (error) {}
      let id;
      do {
        fallbackIdCounter += 1;
        id = `preset-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
      } while (ids.has(id));
      return id;
    }

    function failure(error, presets = []) {
      return {
        ok: false,
        preset: null,
        presets: clonePresets(presets),
        error,
      };
    }

    function list() {
      const state = readState();
      return state.ok ? clonePresets(state.presets) : [];
    }

    function save(name, facilities) {
      const state = readState();
      if (!state.ok) return failure(state.error);
      const presets = state.presets;
      const cleanName = normalizeName(name) || generatedName(presets);
      if (characterLength(cleanName) > MAX_NAME_LENGTH) {
        return failure('name_too_long', presets);
      }
      const cleanFacilities = sanitizeFacilities(facilities);
      const nameKey = cleanName.toLocaleLowerCase('en-US');
      const existingIndex = presets.findIndex((preset) =>
        preset.name.toLocaleLowerCase('en-US') === nameKey);
      let saved;
      if (existingIndex >= 0) {
        saved = {
          ...presets[existingIndex],
          name: cleanName,
          facilities: cleanFacilities,
        };
        presets[existingIndex] = saved;
      } else {
        if (presets.length >= MAX_PRESETS) return failure('limit_reached', presets);
        saved = {
          id: generatedId(presets),
          name: cleanName,
          facilities: cleanFacilities,
          createdAt: Date.now(),
        };
        presets.push(saved);
      }
      const write = writePresets(presets);
      if (!write.ok) return failure(write.error, state.presets);
      return {
        ok: true,
        preset: clonePreset(saved),
        presets: clonePresets(presets),
      };
    }

    function remove(id) {
      if (!validId(id)) return failure('invalid_id');
      const state = readState();
      if (!state.ok) return failure(state.error);
      const index = state.presets.findIndex((preset) => preset.id === id);
      if (index < 0) return failure('not_found', state.presets);
      const presets = state.presets.slice();
      const [removed] = presets.splice(index, 1);
      const write = writePresets(presets);
      if (!write.ok) return failure(write.error, state.presets);
      return {
        ok: true,
        preset: clonePreset(removed),
        presets: clonePresets(presets),
      };
    }

    function isAvailable() {
      const storage = getStorage();
      if (!storage
        || typeof storage.getItem !== 'function'
        || typeof storage.setItem !== 'function'
        || typeof storage.removeItem !== 'function') return false;
      const probeKey = `${STORAGE_KEY}-probe`;
      let previous;
      try {
        previous = storage.getItem(probeKey);
        storage.setItem(probeKey, '1');
        if (previous === null) storage.removeItem(probeKey);
        else storage.setItem(probeKey, previous);
        return true;
      } catch (error) {
        try {
          if (previous === null) storage.removeItem(probeKey);
          else if (typeof previous === 'string') storage.setItem(probeKey, previous);
        } catch (cleanupError) {}
        return false;
      }
    }

    return Object.freeze({
      list,
      save,
      remove,
      delete: remove,
      isAvailable,
      storageAvailable: isAvailable,
      sanitizeFacilities,
      storageKey: STORAGE_KEY,
      limits: Object.freeze({
        maxPresets: MAX_PRESETS,
        maxNameLength: MAX_NAME_LENGTH,
      }),
    });
  }

  return Object.freeze({
    create,
    storageKey: STORAGE_KEY,
    limits: Object.freeze({
      maxPresets: MAX_PRESETS,
      maxNameLength: MAX_NAME_LENGTH,
    }),
  });
});
