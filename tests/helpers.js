const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function createContext(files = ['js/data.js', 'js/weights.js', 'js/calc.js']) {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function defaultBuild(overrides = {}) {
  return {
    archetypeId: 'fwd_finisher',
    level: 100,
    height: 180,
    weight: 75,
    attributes: {},
    playstyles: [],
    playstylePurchases: {},
    signatures: {},
    positions: ['ST'],
    disabledAttrs: [],
    sumExcluded: [],
    ...overrides,
  };
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

module.exports = { createContext, defaultBuild, parseCsvLine, root };
