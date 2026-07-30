(function (global) {
  'use strict';

  const TARGET_WIDTH = 1920;
  const TARGET_HEIGHT = 1080;
  const MAX_BYTES = 10 * 1024 * 1024;
  const MAX_PIXELS = 20 * 1024 * 1024;
  const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const inspectionCache = new WeakMap();

  const MAIN_X = [0.1737, 0.3230, 0.4725, 0.6216];
  const MAIN_Y = [0.2602, 0.3199, 0.3792, 0.4384, 0.4977, 0.5569];
  const SLOT_IDS = [
    'agility', 'att_position', 'vision', 'interceptions',
    'balance', 'finishing', 'crossing', 'heading_accuracy',
    'reactions', 'shot_power', 'fk_accuracy', 'def_aware',
    'ball_control', 'long_shots', 'short_passing', 'standing_tackle',
    'dribbling', 'volleys', 'long_passing', 'sliding_tackle',
    'composure', 'penalties', 'curve', null,
  ];
  const BOTTOM_SLOTS = [
    ['acceleration', 0.1737, 0.7051],
    ['jumping', 0.3230, 0.7051],
    ['stamina', 0.4725, 0.7051],
    ['sprint_speed', 0.1737, 0.7644],
    ['strength', 0.3230, 0.7644],
    ['aggression', 0.4725, 0.7644],
  ];

  const DIGIT_MASKS = {
    0: 'AAAAAAAAAAAAAAAAAP8AgMMBwAADYAAGMAAMMAAMMAAMEAAIEAAIMAAMMAAMMAAMYAAGwAADgIEBAP8AAAAAAAAAAAAAAAAA',
    1: 'AAAAAAAAAAAAAAAAACAAAD4AAD4AACAAACAAACAAACAAACAAACAAACAAACAAACAAACAAACAAACAAACAAAAAAAAAAAAAAAAAA',
    2: 'AAAAAAAAAAAAAAAAAP8AgMEBwAADYAADAAACAAACAAADAIABAMAAAGAAADgAAAwAAAYAgAMAwAAA4P8HAAAAAAAAAAAAAAAA',
    3: 'AAAAAAAAAAAAAAAAAP8AwIEBQAADYAACAAACAAADAIABAP4AAPwBAAADAAAGAAAGIAAGYAACwIEDgP8BABgAAAAAAAAAAAAAAAAA',
    4: 'AAAAAAAAAAAAAAAAAMAAAOAAAPgAAJwAAI4AAIcAgIEAwIAAYIAAMMAA+P8PQMAHAIAAAMAAAIAAAIAAAAAAAAAAAAAAAAAA',
    5: 'AAAAAAAAAAAAgP8DgAEAgAAAgAAAwAAAwHgAwP4BwAEDgAAGAAAEAAAEAAAEYAAEYAAGwIEDAP8BADgAAAAAAAAAAAAAAAAA',
    6: 'AAAAAAAAAAAAAAAAAP8BgIMDwAAGYAAAYAAAIDwAMP8BsAEDcAAGcAAEMAAEIAAEYAAEQAAGwIEDAP8BABAAAAAAAAAAAAAAAAAA',
    7: 'AAAAAAAAAAAAAAAA8P8HAAADAIABAIABAMAAAGAAADAAABAAABgAAAwAAAwAAAYAAAYAAAIAAAMAAAMAAAAAAAAAAAAAAAAA',
    8: 'AAAAAAAAAAAAAAAAAP8AwIEDwAADYAAGYAAGwAADgIEBAP8AwMMDYAAGIAAEIAAEIAAEYAAGwIEDgP8BABgAAAAAAAAAAAAAAAAA',
    9: 'AAAAAAAAAAAAgH8A4MEBYAADMAACMAAGEAAGMAAGMAAH4IAGgH8GAB4GAAAGAAADMAAD4MABgP8AAAwAAAAAAAAAAAAAAAAA',
  };

  const ARCHETYPE_KEYS = {
    gk_shot_stopper: ['gk_diving', 'gk_handling', 'gk_reflexes', 'acceleration'],
    gk_sweeper_keeper: ['gk_diving', 'gk_kicking', 'gk_positioning', 'long_passing'],
    def_progressor: ['long_passing', 'composure', 'def_aware', 'standing_tackle'],
    def_boss: ['heading_accuracy', 'sliding_tackle', 'strength', 'aggression'],
    def_engine: ['short_passing', 'interceptions', 'standing_tackle', 'stamina'],
    def_marauder: ['sprint_speed', 'crossing', 'sliding_tackle', 'stamina'],
    mid_recycler: ['long_shots', 'interceptions', 'def_aware', 'strength'],
    mid_maestro: ['vision', 'long_passing', 'ball_control', 'composure'],
    mid_creator: ['long_shots', 'vision', 'short_passing', 'curve'],
    mid_spark: ['acceleration', 'agility', 'ball_control', 'dribbling'],
    fwd_magician: ['acceleration', 'finishing', 'curve', 'balance'],
    fwd_finisher: ['finishing', 'volleys', 'reactions', 'composure'],
    fwd_target: ['shot_power', 'heading_accuracy', 'jumping', 'strength'],
  };

  const STAT_SLOTS = [];
  MAIN_Y.forEach((y, row) => {
    MAIN_X.forEach((x, column) => {
      const id = SLOT_IDS[(row * MAIN_X.length) + column];
      if (id) STAT_SLOTS.push({ id, x, y });
    });
  });
  BOTTOM_SLOTS.forEach(([id, x, y]) => STAT_SLOTS.push({ id, x, y }));

  function makeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function validateFile(file) {
    if (!file || typeof file.size !== 'number') {
      throw makeError('invalid-file', 'Choose a JPEG, PNG or WebP screenshot.');
    }
    if (!ALLOWED_TYPES.has(String(file.type || '').toLowerCase())) {
      throw makeError('invalid-type', 'The screenshot must be a JPEG, PNG or WebP image.');
    }
    if (file.size > MAX_BYTES) {
      throw makeError('file-too-large', 'The screenshot must be 10 MB or smaller.');
    }
  }

  async function decodeImage(file) {
    if (typeof global.createImageBitmap === 'function') {
      try {
        const bitmap = await global.createImageBitmap(file);
        return {
          width: bitmap.width,
          height: bitmap.height,
          draw(context) { context.drawImage(bitmap, 0, 0, TARGET_WIDTH, TARGET_HEIGHT); },
          release() { if (typeof bitmap.close === 'function') bitmap.close(); },
        };
      } catch (error) {}
    }

    if (!global.URL || typeof global.URL.createObjectURL !== 'function' || typeof global.Image !== 'function') {
      throw makeError('decode-unavailable', 'This browser cannot decode the selected screenshot.');
    }
    const url = global.URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new global.Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(makeError('decode-failed', 'The selected image could not be decoded.'));
        element.src = url;
      });
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        draw(context) { context.drawImage(image, 0, 0, TARGET_WIDTH, TARGET_HEIGHT); },
        release() {},
      };
    } finally {
      global.URL.revokeObjectURL(url);
    }
  }

  function validateDimensions(width, height) {
    if (width < 1200 || height < 675) {
      throw makeError('resolution-too-small', 'Use a full screenshot with a resolution of at least 1200 × 675.');
    }
    if ((width * height) > MAX_PIXELS) {
      throw makeError('resolution-too-large', 'The screenshot cannot exceed 20 megapixels.');
    }
    const aspect = width / height;
    const expected = 16 / 9;
    if (Math.abs(aspect - expected) / expected > 0.018) {
      throw makeError('invalid-aspect', 'Use the original full-screen 16:9 screenshot without cropping it.');
    }
  }

  function readUint24LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  }

  function readUint32LE(bytes, offset) {
    return (bytes[offset]
      | (bytes[offset + 1] << 8)
      | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24)) >>> 0;
  }

  function ascii(bytes, offset, length) {
    let value = '';
    for (let index = 0; index < length; index++) value += String.fromCharCode(bytes[offset + index]);
    return value;
  }

  function pngDimensions(bytes) {
    if (bytes.length < 24 || ascii(bytes, 1, 3) !== 'PNG' || ascii(bytes, 12, 4) !== 'IHDR') return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  function jpegDimensions(bytes) {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
      if (marker === 0xda || marker === 0xd9 || offset + 1 >= bytes.length) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if (startOfFrame.has(marker) && length >= 7) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += length;
    }
    return null;
  }

  function webpDimensions(bytes) {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const size = readUint32LE(bytes, offset + 4);
      const data = offset + 8;
      if (data + size > bytes.length) return null;
      if (type === 'VP8X' && size >= 10) {
        return {
          width: readUint24LE(bytes, data + 4) + 1,
          height: readUint24LE(bytes, data + 7) + 1,
        };
      }
      if (type === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
        const bits = readUint32LE(bytes, data + 1);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >>> 14) & 0x3fff) + 1,
        };
      }
      if (type === 'VP8 ' && size >= 10
        && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        return {
          width: (bytes[data + 6] | (bytes[data + 7] << 8)) & 0x3fff,
          height: (bytes[data + 8] | (bytes[data + 9] << 8)) & 0x3fff,
        };
      }
      offset = data + size + (size & 1);
    }
    return null;
  }

  async function inspect(file) {
    validateFile(file);
    if (inspectionCache.has(file)) return inspectionCache.get(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = file.type === 'image/png'
      ? pngDimensions(bytes)
      : file.type === 'image/jpeg'
        ? jpegDimensions(bytes)
        : webpDimensions(bytes);
    if (!dimensions || !dimensions.width || !dimensions.height) {
      throw makeError('decode-failed', 'The selected image could not be decoded.');
    }
    validateDimensions(dimensions.width, dimensions.height);
    const result = Object.freeze({ width: dimensions.width, height: dimensions.height, type: file.type });
    inspectionCache.set(file, result);
    return result;
  }

  function unpackTemplates() {
    const templates = {};
    Object.keys(DIGIT_MASKS).forEach((digit) => {
      const bytes = global.atob(DIGIT_MASKS[digit]);
      const mask = new Uint8Array(24 * 24);
      let area = 0;
      for (let index = 0; index < mask.length; index++) {
        const value = (bytes.charCodeAt(index >> 3) >> (index & 7)) & 1;
        mask[index] = value;
        area += value;
      }
      templates[digit] = { mask, area };
    });
    return templates;
  }

  function isTextPixel(data, index) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    return (red + green + blue) > 300
      && (Math.max(red, green, blue) - Math.min(red, green, blue)) < 65;
  }

  function glyphComponents(imageData, centerX, centerY) {
    const source = imageData.data;
    const sourceWidth = imageData.width;
    const x0 = Math.round((centerX * TARGET_WIDTH) - 36);
    const y0 = Math.round((centerY * TARGET_HEIGHT) - 16);
    const width = 66;
    const height = 31;
    const mask = new Uint8Array(width * height);
    const visited = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sourceIndex = (((y0 + y) * sourceWidth) + x0 + x) * 4;
        if (isTextPixel(source, sourceIndex)) mask[(y * width) + x] = 1;
      }
    }

    const components = [];
    const stack = new Int16Array(mask.length);
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || visited[start]) continue;
      let stackSize = 1;
      stack[0] = start;
      visited[start] = 1;
      const points = [];
      let minX = width, minY = height, maxX = -1, maxY = -1;
      while (stackSize) {
        const position = stack[--stackSize];
        const x = position % width;
        const y = (position / width) | 0;
        points.push(position);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const next = (nextY * width) + nextX;
            if (!mask[next] || visited[next]) continue;
            visited[next] = 1;
            stack[stackSize++] = next;
          }
        }
      }
      const glyphWidth = maxX - minX + 1;
      const glyphHeight = maxY - minY + 1;
      if (points.length < 15 || glyphWidth < 3 || glyphWidth > 25 || glyphHeight < 12 || glyphHeight > 22) continue;
      const glyph = new Uint8Array(24 * 24);
      const offsetX = ((24 - glyphWidth) / 2) | 0;
      const offsetY = ((24 - glyphHeight) / 2) | 0;
      points.forEach((position) => {
        const x = (position % width) - minX + offsetX;
        const y = ((position / width) | 0) - minY + offsetY;
        if (x >= 0 && x < 24 && y >= 0 && y < 24) glyph[(y * 24) + x] = 1;
      });
      components.push({ x: minX, mask: glyph, area: points.length });
    }
    return components.sort((left, right) => left.x - right.x);
  }

  function diceDistance(glyph, template, shiftX, shiftY) {
    let intersection = 0;
    for (let y = 0; y < 24; y++) {
      const templateY = y - shiftY;
      if (templateY < 0 || templateY >= 24) continue;
      for (let x = 0; x < 24; x++) {
        if (!glyph.mask[(y * 24) + x]) continue;
        const templateX = x - shiftX;
        if (templateX < 0 || templateX >= 24) continue;
        if (template.mask[(templateY * 24) + templateX]) intersection++;
      }
    }
    return 1 - ((2 * intersection) / (glyph.area + template.area));
  }

  function classifyGlyph(glyph, templates) {
    const scores = Object.keys(templates).map((digit) => {
      let distance = 1;
      for (let shiftY = -1; shiftY <= 1; shiftY++) {
        for (let shiftX = -1; shiftX <= 1; shiftX++) {
          distance = Math.min(distance, diceDistance(glyph, templates[digit], shiftX, shiftY));
        }
      }
      return { digit, distance };
    }).sort((left, right) => left.distance - right.distance);
    const best = scores[0];
    const margin = scores[1].distance - best.distance;
    const confidence = clamp(0.98 - (best.distance * 1.8) + Math.min(0.2, margin * 2), 0.05, 0.99);
    return { digit: best.digit, distance: best.distance, margin, confidence };
  }

  function readStat(imageData, slot, templates) {
    const components = glyphComponents(imageData, slot.x, slot.y);
    if (components.length !== 2) {
      return { value: null, status: 'missing', confidence: 0, components: components.length };
    }
    const digits = components.map((glyph) => classifyGlyph(glyph, templates));
    const value = Number(digits.map((entry) => entry.digit).join(''));
    const confidence = Math.min(...digits.map((entry) => entry.confidence));
    const reliable = digits.every((entry) => entry.distance <= 0.23 && entry.margin >= 0.012);
    return {
      value,
      status: reliable ? 'detected' : 'review',
      confidence,
      components: components.length,
      digits,
    };
  }

  function pixelCount(imageData, centerX, centerY, radiusX, radiusY, predicate) {
    const data = imageData.data;
    const width = imageData.width;
    const startX = Math.max(0, Math.round(centerX - radiusX));
    const endX = Math.min(width, Math.round(centerX + radiusX));
    const startY = Math.max(0, Math.round(centerY - radiusY));
    const endY = Math.min(imageData.height, Math.round(centerY + radiusY));
    let count = 0;
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const index = ((y * width) + x) * 4;
        if (predicate(data[index], data[index + 1], data[index + 2])) count++;
      }
    }
    return count;
  }

  function readStars(imageData, y) {
    const counts = [];
    for (let index = 0; index < 5; index++) {
      const x = (0.5927 + (index * 0.0101)) * TARGET_WIDTH;
      counts.push(pixelCount(imageData, x, y * TARGET_HEIGHT, 9, 9, (red, green, blue) =>
        red > 150 && green > 110 && blue < 150 && red > (blue * 1.35)));
    }
    const value = counts.filter((count) => count >= 25).length;
    const separation = Math.min(...counts.map((count) => Math.abs(count - 25)));
    const valid = value >= 2 && value <= 5;
    return {
      value: valid ? value : null,
      status: valid && separation >= 12 ? 'detected' : valid ? 'review' : 'missing',
      confidence: valid ? clamp(0.65 + (separation / 60), 0.65, 0.99) : 0,
      counts,
    };
  }

  function keyPixel(red, green, blue) {
    return green > 100 && green > (red * 1.45) && green > (blue * 1.2);
  }

  function detectKeyAttributes(imageData) {
    return STAT_SLOTS.filter((slot) => {
      const centerX = slot.x * TARGET_WIDTH;
      const centerY = slot.y * TARGET_HEIGHT;
      const left = centerX - (0.115 * TARGET_WIDTH);
      const right = centerX - (0.023 * TARGET_WIDTH);
      const top = centerY - (0.014 * TARGET_HEIGHT);
      const bottom = centerY + (0.014 * TARGET_HEIGHT);
      const data = imageData.data;
      let count = 0;
      for (let y = Math.round(top); y < Math.round(bottom); y++) {
        for (let x = Math.round(left); x < Math.round(right); x++) {
          const index = ((y * imageData.width) + x) * 4;
          if (keyPixel(data[index], data[index + 1], data[index + 2])) count++;
        }
      }
      return count >= 80;
    }).map((slot) => slot.id);
  }

  function inferArchetype(keyAttributes) {
    const detected = new Set(keyAttributes);
    const ranked = Object.entries(ARCHETYPE_KEYS).map(([id, keys]) => {
      const expected = new Set(keys);
      let intersection = 0;
      detected.forEach((key) => { if (expected.has(key)) intersection++; });
      const union = new Set([...detected, ...expected]).size;
      return { id, score: union ? intersection / union : 0 };
    }).sort((left, right) => right.score - left.score);
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (!best || best.score < 0.6 || (best.score - runnerUp.score) < 0.18) {
      return { id: null, confidence: best ? best.score : 0 };
    }
    return { id: best.id, confidence: best.score };
  }

  function cyanPixel(red, green, blue) {
    return green > 100 && blue > 100 && red < 100 && green > (red * 1.5) && blue > (red * 1.4);
  }

  function detectSelectedSlot(imageData) {
    const data = imageData.data;
    const scores = STAT_SLOTS.map((slot) => {
      const centerX = slot.x * TARGET_WIDTH;
      const centerY = slot.y * TARGET_HEIGHT;
      const x0 = Math.round(centerX - (0.122 * TARGET_WIDTH));
      const x1 = Math.round(centerX + (0.029 * TARGET_WIDTH));
      const y0 = Math.round(centerY - (0.027 * TARGET_HEIGHT));
      const y1 = Math.round(centerY + (0.034 * TARGET_HEIGHT));
      let count = 0;
      const inspect = (x, y) => {
        const index = ((y * imageData.width) + x) * 4;
        if (cyanPixel(data[index], data[index + 1], data[index + 2])) count++;
      };
      for (let x = x0; x < x1; x++) {
        for (let offset = 0; offset < 4; offset++) {
          inspect(x, y0 + offset);
          inspect(x, y1 - 1 - offset);
        }
      }
      for (let y = y0; y < y1; y++) {
        for (let offset = 0; offset < 4; offset++) {
          inspect(x0 + offset, y);
          inspect(x1 - 1 - offset, y);
        }
      }
      return { id: slot.id, count };
    }).sort((left, right) => right.count - left.count);
    if (!scores[0] || scores[0].count < 500 || scores[0].count < (scores[1].count * 1.8)) return null;
    return scores[0].id;
  }

  async function analyze(file) {
    const metadata = await inspect(file);
    const decoded = await decodeImage(file);
    try {
      if (!global.document || typeof global.document.createElement !== 'function') {
        throw makeError('canvas-unavailable', 'This browser cannot analyze screenshots locally.');
      }
      const canvas = global.document.createElement('canvas');
      canvas.width = TARGET_WIDTH;
      canvas.height = TARGET_HEIGHT;
      const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
      if (!context) throw makeError('canvas-unavailable', 'This browser cannot analyze screenshots locally.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      decoded.draw(context);
      const imageData = context.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
      const templates = unpackTemplates();
      const values = {};
      const fields = {};
      let recognizedStats = 0;
      STAT_SLOTS.forEach((slot) => {
        const result = readStat(imageData, slot, templates);
        if (Number.isFinite(result.value)) {
          values[slot.id] = result.value;
          recognizedStats++;
        }
        fields[slot.id] = {
          status: result.status,
          confidence: result.confidence,
        };
      });

      const skillMoves = readStars(imageData, 0.702);
      const weakFoot = readStars(imageData, 0.761);
      [['skill_moves', skillMoves], ['weak_foot', weakFoot]].forEach(([id, result]) => {
        if (Number.isFinite(result.value)) values[id] = result.value;
        fields[id] = { status: result.status, confidence: result.confidence };
      });

      const selectedId = detectSelectedSlot(imageData);
      if (selectedId && fields[selectedId]) {
        fields[selectedId].selected = true;
        if (fields[selectedId].status === 'detected' && fields[selectedId].confidence < 0.72) {
          fields[selectedId].status = 'review';
        }
      }

      const keyAttributes = detectKeyAttributes(imageData);
      const archetype = inferArchetype(keyAttributes);
      const starsFound = Number.isFinite(skillMoves.value) + Number.isFinite(weakFoot.value);
      const layoutConfidence = clamp(
        ((recognizedStats / STAT_SLOTS.length) * 0.84)
        + ((starsFound / 2) * 0.10)
        + (keyAttributes.length === 4 ? 0.06 : 0),
        0,
        1,
      );
      if (recognizedStats < 22 || layoutConfidence < 0.7) {
        throw makeError('layout-not-recognized', 'The image does not match the full outfield Attributes screen.');
      }

      return {
        values,
        fields,
        archetypeId: archetype.id,
        archetypeConfidence: archetype.confidence,
        keyAttributes,
        selectedAttributeId: selectedId,
        layoutConfidence,
        width: metadata.width,
        height: metadata.height,
      };
    } finally {
      decoded.release();
    }
  }

  global.ScreenshotImport = Object.freeze({
    analyze,
    inspect,
    limits: Object.freeze({
      maxBytes: MAX_BYTES,
      maxPixels: MAX_PIXELS,
      minimumWidth: 1200,
      minimumHeight: 675,
    }),
  });
})(window);
