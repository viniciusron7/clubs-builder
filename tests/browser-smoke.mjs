import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const cdpBase = process.env.CDP_URL || 'http://127.0.0.1:9222';
const appUrl = process.env.APP_URL || 'http://127.0.0.1:4173/';
const target = await fetch(`${cdpBase}/json/new?about:blank`, { method: 'PUT' }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const errors = [];
const requests = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && !message.params.entry.text.startsWith('Failed to load resource:')) errors.push(message.params.entry.text);
  if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
  if (message.method === 'Network.loadingFailed' && !message.params.canceled && message.params.errorText !== 'net::ERR_ABORTED') {
    errors.push(`${message.params.errorText}: ${requests.get(message.params.requestId) || 'unknown resource'}`);
  }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Evaluation failed');
  return response.result.value;
};
const waitFor = async (expression, timeout = 5000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};
const click = async (selector) => {
  const clicked = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  assert.equal(clicked, true, `Missing element: ${selector}`);
  await delay(75);
};
const hover = async (selector) => {
  const point = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `Missing element: ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await delay(180);
};
const typeText = async (text) => {
  for (const character of text) {
    await send('Input.insertText', { text: character });
    await delay(60);
  }
};
const screenshot = async (file) => {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(file, Buffer.from(result.data, 'base64'));
};

await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable')]);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.COMMUNITY_CONFIG = { apiUrl: '', turnstileSiteKey: '' };`,
});
await send('Page.navigate', { url: appUrl });
await waitFor(`document.readyState === 'complete' && !!window.Calc && !!window.Share && !!window.Community`);
assert.equal(await evaluate('window.OVERALL_MODEL.version'), 2);

const communitySetup = await evaluate(`({
  configured: Community.isConfigured(),
  hasTab: !!document.querySelector('[data-modal="community"]'),
  tabDisabled: document.querySelector('[data-modal="community"]').disabled,
  hasArchetype: !!Share.fromUrl(),
})`);
assert.equal(communitySetup.configured, false);
assert.equal(communitySetup.hasTab, true);
assert.equal(communitySetup.tabDisabled, false);
await click('[data-modal="community"]');
assert.equal(await evaluate(`document.querySelector('#modal-box').dataset.modalKind`), 'community');
assert.equal(await evaluate(`!document.querySelector('#modal-root').classList.contains('hidden')`), true);
assert.equal(await evaluate(`document.querySelector('#main-content').inert`), true);
assert.equal(await evaluate(`document.activeElement && document.activeElement.id`), 'modal-box');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))`);
assert.equal(await evaluate(`document.activeElement && document.activeElement.hasAttribute('data-modal-close')`), true);
assert.equal(await evaluate(`!!document.querySelector('[data-community-setup]')`), true);
assert.match(await evaluate(`document.querySelector('[data-community-setup]').innerText`), /not configured/i);
await click('[data-modal-close]');
assert.equal(await evaluate(`document.querySelector('#main-content').inert`), false);
assert.equal(await evaluate(`document.activeElement && document.activeElement.id`), 'tab-community');

await click('[data-arch="fwd_finisher"]');
assert.equal(await evaluate(`document.querySelectorAll('.summary-signature-slot').length`), 4);
assert.equal(await evaluate(`document.querySelectorAll('.summary-signature-slot.is-locked').length`), 4);
assert.equal(await evaluate(`[...document.querySelectorAll('.summary-signature-slot img')].every((image) => !image.src.includes('/plus/'))`), true);
const loadedFonts = await evaluate(`document.fonts.ready.then(async () => {
  const load = async (spec) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return (await document.fonts.load(spec)).length; }
      catch (error) { await new Promise((resolve) => setTimeout(resolve, 75)); }
    }
    return -1;
  };
  return {
    ui: await load('400 16px "Cruyff Sans"'),
    display: await load('500 16px "Cruyff Sans Condensed"'),
    body: getComputedStyle(document.body).fontFamily,
    heading: getComputedStyle(document.querySelector('#attributes h2')).fontFamily,
  };
})`);
assert.ok(loadedFonts.ui > 0);
assert.ok(loadedFonts.display > 0);
assert.match(loadedFonts.body, /Cruyff Sans/);
assert.match(loadedFonts.heading, /Cruyff Sans Condensed/);
assert.equal(await evaluate(`Number(document.querySelector('.build-summary-attribute-sum').textContent)`), 1947);
await click('#btn-maxsum');
assert.equal(await evaluate(`document.querySelectorAll('[data-sum-attr]').length`), 29);
assert.equal(await evaluate(`document.querySelectorAll('[data-sum-attr="skill_moves"], [data-sum-attr="weak_foot"]').length`), 0);
await click('[data-modal-close]');

// The LVL field must swallow a whole multi-digit number typed key by key without losing focus.
await evaluate(`(() => { const el = document.querySelector('#level-input'); el.focus(); el.select(); })()`);
await typeText('85');
assert.equal(await evaluate(`document.querySelector('#level-input').value`), '85');
assert.equal(await evaluate(`Share.fromUrl().level`), 85);
assert.equal(await evaluate(`document.activeElement && document.activeElement.id`), 'level-input');
await evaluate(`document.querySelector('#level-input').blur()`);
await evaluate(`(() => { const el = document.querySelector('#level-input'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await delay(75);
assert.equal(await evaluate(`document.querySelectorAll('.summary-signature-slot.is-unlocked').length`), 4);
assert.equal(await evaluate(`[...document.querySelectorAll('.summary-signature-slot img')].every((image) => image.src.includes('/plus/'))`), true);
await click('[data-pos="ST"]');
const attributesBeforeImpossibleTarget = await evaluate(`JSON.stringify(Share.fromUrl().attributes)`);
await click('#btn-optimize');
await click('input[name="opt-mode"][value="min"]');
await evaluate(`document.querySelector('#opt-ovr').value = '99'`);
await click('#opt-run');
await waitFor(`/unreachable/i.test(document.querySelector('#toast').innerText)`);
const unreachableToast = await evaluate(`document.querySelector('#toast').innerText`);
assert.match(unreachableToast, /best is OVR 96/i);
assert.equal(await evaluate(`JSON.stringify(Share.fromUrl().attributes)`), attributesBeforeImpossibleTarget);
await click('[data-modal-close]');
await click('[data-pos="CAM"]');
const positionText = await evaluate(`document.querySelector('#positions-bar').innerText`);
assert.match(positionText, /Lowest Est\. OVR/i);
assert.doesNotMatch(positionText, /PRIMARY|ALT/i);
assert.equal(await evaluate(`(() => { const b = Share.fromUrl(); const d = Calc.derive(b); const a = Calc.overallMapForValues(['ST','CAM'], d, null); const z = Calc.overallMapForValues(['CAM','ST'], d, null); return JSON.stringify(a) === JSON.stringify({ ST: z.ST, CAM: z.CAM }); })()`), true);
await click('#btn-weights');
assert.equal(await evaluate(`document.querySelector('#btn-weights').getAttribute('aria-checked')`), 'true');
const combinedWeightLabel = await evaluate(`document.querySelector('#btn-weights').innerText`);
assert.match(combinedWeightLabel, /ST/);
assert.match(combinedWeightLabel, /CAM/);
assert.equal(await evaluate(`document.querySelectorAll('.attr-weight').length > 0`), true);
assert.equal(await evaluate(`document.querySelectorAll('.attr-weight:not(.is-zero)').length > 0`), true);
assert.equal(await evaluate(`document.querySelectorAll('#attributes .key-attribute-icon').length > 0`), true);
assert.equal(await evaluate(`document.querySelector('#attributes .key-attribute-icon').naturalWidth > 0`), true);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('#attributes .key-attribute-name')).color`), 'rgb(7, 244, 104)');
assert.equal(await evaluate(`document.querySelector('[data-attr="skill_moves"] .key-attribute-icon')`), null);
assert.equal(await evaluate(`document.querySelector('[data-attr="weak_foot"] .key-attribute-icon')`), null);
assert.equal(await evaluate(`(() => {
  const pace = document.querySelector('[data-category="pace"]').getBoundingClientRect();
  const physical = document.querySelector('[data-category="physical"]').getBoundingClientRect();
  const other = document.querySelector('[data-category="other"]').getBoundingClientRect();
  const physicalBody = document.querySelector('[data-category="physical"] .attribute-card-body');
  const ids = [...physicalBody.querySelectorAll('[data-attr]')].map((el) => el.dataset.attr);
  return Math.abs(pace.top - physical.top) < 1
    && Math.abs(physical.top - other.top) < 1
    && physical.width > pace.width * 1.8
    && getComputedStyle(physicalBody).gridTemplateColumns.split(' ').length === 2
    && ids.join(',') === 'jumping,stamina,strength,aggression';
})()`), true);

const creatorOptimizerRegression = await evaluate(`(async () => {
  const build = {
    archetypeId: 'mid_creator',
    level: 100,
    height: 180,
    weight: 75,
    attributes: {},
    playstyles: [],
    playstylePurchases: {},
    signatures: {},
    positions: ['CAM', 'CM', 'CDM'],
    disabledAttrs: [],
    sumExcluded: [],
  };
  const derived = Calc.derive(build);
  const result = await Calc.optimize(derived, {
    positions: build.positions,
    mode: 'max',
    additionalAP: derived.ap.available,
    disabled: [],
  });
  return { overalls: result.overalls, objective: result.objective, spent: result.spent, status: result.status };
})()`);
assert.deepEqual(creatorOptimizerRegression.overalls, { CAM: 94, CM: 95, CDM: 92 });
assert.deepEqual(creatorOptimizerRegression.objective, { min: 92, sum: 281 });
assert.equal(creatorOptimizerRegression.spent, 3126);
assert.equal(creatorOptimizerRegression.status, 'optimal');

const buildBeforePlaystyleUnlock = await evaluate(`JSON.stringify(Share.fromUrl())`);
const spentBeforePlaystyleUnlock = await evaluate(`Calc.derive(Share.fromUrl()).ap.spent`);
await click('[data-modal="playStyles"]');
assert.equal(await evaluate(`document.querySelector('#modal-box').innerText.includes('Signature')`), false);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.playstyle-slots-section')).position`), 'static');
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.available-playstyles-list')).overflowY`), 'visible');
assert.equal(await evaluate(`document.querySelectorAll('.available-playstyles-list .ps-row.is-signature').length`), 4);
assert.equal(await evaluate(`[...document.querySelectorAll('.available-playstyles-list .ps-row.is-signature .ps-row-cost')].every((item) => /Equipped/.test(item.innerText))`), true);
const availablePlaystyleLayout = await evaluate(`(() => {
  const row = document.querySelector('.ps-row:not(.is-signature)');
  const icon = row && row.querySelector('.ps-row-icon');
  return row && icon ? {
    height: row.getBoundingClientRect().height,
    iconWidth: icon.getBoundingClientRect().width,
    childCount: row.children.length,
    onlyChildClass: row.firstElementChild.classList.contains('ps-row-icon'),
    costText: row.querySelector('.ps-row-cost')?.innerText || '',
    affordable: row.querySelector('.ps-row-cost')?.classList.contains('is-affordable') || false,
  } : null;
})()`);
assert.ok(availablePlaystyleLayout);
assert.equal(availablePlaystyleLayout.height >= 96, true);
assert.equal(Math.abs(availablePlaystyleLayout.iconWidth - 42) < 0.1, true);
assert.equal(availablePlaystyleLayout.childCount, 2);
assert.equal(availablePlaystyleLayout.onlyChildClass, true);
assert.match(availablePlaystyleLayout.costText, /AP/);
assert.equal(availablePlaystyleLayout.affordable, true);
const playstyleQuickUnlock = await evaluate(`(() => { const button = document.querySelector('[data-ps-unlock]:not([disabled])'); return button ? { id: button.dataset.psUnlock, cost: Number(button.dataset.cost) } : null; })()`);
assert.ok(playstyleQuickUnlock);
await click(`[data-ps-unlock="${playstyleQuickUnlock.id}"]`);
// Quick Unlock buys the requirements only — it must never consume a slot on its own.
assert.equal(await evaluate(`Share.fromUrl().playstyles.length`), 0);
assert.equal(await evaluate(`Calc.derive(Share.fromUrl()).ap.spent`), spentBeforePlaystyleUnlock + playstyleQuickUnlock.cost);
assert.equal(await evaluate(`!!Share.fromUrl().playstylePurchases[${JSON.stringify(playstyleQuickUnlock.id)}]`), true);
assert.equal(await evaluate(`(() => { const b = Share.fromUrl(); const d = Calc.derive(b); return Calc.playstyleEligible(Calc.playstyle(${JSON.stringify(playstyleQuickUnlock.id)}), d.purchased); })()`), true);
// Equipping is explicit: click an empty slot, then choose from the picker.
await click('[data-ps-slot="0"]');
assert.equal(await evaluate(`!!document.querySelector('.ps-picker')`), true);
assert.equal(await evaluate(`(() => {
  const b = Share.fromUrl(), d = Calc.derive(b);
  const signatures = new Set(Calc.signatureSlots(b, d.categories).map((slot) => slot.playStyleId));
  return [...document.querySelectorAll('[data-ps-pick]')].every((item) => !signatures.has(item.dataset.psPick));
})()`), true);
await click(`[data-ps-pick="${playstyleQuickUnlock.id}"]`);
assert.equal(await evaluate(`Share.fromUrl().playstyles.includes(${JSON.stringify(playstyleQuickUnlock.id)})`), true);
await screenshot('/tmp/clubs-builder-playstyles-quick-unlock.png');
const playstyleSale = await evaluate(`(() => {
  const button = document.querySelector('[data-ps-sell="${playstyleQuickUnlock.id}"]');
  return button ? {
    refund: Number(button.dataset.refund),
    idleText: button.querySelector('.ps-sale-idle')?.innerText || '',
    actionText: button.querySelector('.ps-sale-action')?.innerText || '',
    idleOpacity: getComputedStyle(button.querySelector('.ps-sale-idle')).opacity,
    actionOpacity: getComputedStyle(button.querySelector('.ps-sale-action')).opacity,
  } : null;
})()`);
assert.ok(playstyleSale);
assert.equal(playstyleSale.refund, playstyleQuickUnlock.cost);
assert.match(playstyleSale.idleText, /Unlocked/i);
assert.match(playstyleSale.actionText, /Sell/i);
assert.equal(Number(playstyleSale.idleOpacity) > 0.99, true);
assert.equal(Number(playstyleSale.actionOpacity) < 0.01, true);
await hover(`[data-ps-sell="${playstyleQuickUnlock.id}"]`);
await waitFor(`Number(getComputedStyle(document.querySelector('[data-ps-sell="${playstyleQuickUnlock.id}"] .ps-sale-idle')).opacity) < 0.01`);
await waitFor(`Number(getComputedStyle(document.querySelector('[data-ps-sell="${playstyleQuickUnlock.id}"] .ps-sale-action')).opacity) > 0.99`);
await screenshot('/tmp/clubs-builder-playstyles-sell-hover.png');
await click(`[data-ps-sell="${playstyleQuickUnlock.id}"]`);
assert.equal(await evaluate(`Share.fromUrl().playstyles.includes(${JSON.stringify(playstyleQuickUnlock.id)})`), false);
assert.equal(await evaluate(`!!Share.fromUrl().playstylePurchases[${JSON.stringify(playstyleQuickUnlock.id)}]`), false);
assert.equal(await evaluate(`Calc.derive(Share.fromUrl()).ap.spent`), spentBeforePlaystyleUnlock);
assert.match(await evaluate(`document.querySelector('#toast').innerText`), /sold.*refunded/i);
await click('#btn-undo');
assert.equal(await evaluate(`Share.fromUrl().playstyles.includes(${JSON.stringify(playstyleQuickUnlock.id)})`), true);
await click('#btn-redo');
assert.equal(await evaluate(`Share.fromUrl().playstyles.length`), 0);
await click('#btn-undo'); // undo the sale
await click('#btn-undo'); // undo the equip
await click('#btn-undo'); // undo the quick unlock
await click('[data-modal-close]');
assert.equal(await evaluate(`JSON.stringify(Share.fromUrl())`), buildBeforePlaystyleUnlock);

assert.equal(await evaluate(`document.querySelectorAll('[data-modal="facilities"], [data-fac], [data-fac-view]').length`), 0);
assert.equal(await evaluate(`document.querySelector('#tabs').innerText.includes('Facilities')`), false);
assert.equal(await evaluate(`document.querySelector('#panel').innerText.includes('Facilities')`), false);

const attributesBeforeCancel = await evaluate(`JSON.stringify(Share.fromUrl().attributes)`);
await click('#btn-optimize');
await evaluate(`document.querySelector('#opt-ap').value = '250'`);
await click('#opt-run');
await click('[data-modal-close]');
await delay(900);
assert.equal(await evaluate(`JSON.stringify(Share.fromUrl().attributes)`), attributesBeforeCancel);
assert.equal(await evaluate(`document.querySelector('#modal-root').classList.contains('hidden')`), true);

await click('#btn-optimize');
await evaluate(`document.querySelector('#opt-ap').value = '250'`);
await click('#opt-run');
await waitFor(`document.querySelector('#modal-root').classList.contains('hidden')`, 6000);
const optimizerToast = await evaluate(`document.querySelector('#toast').innerText`);
assert.match(optimizerToast, /(optimal|best found)/);
assert.equal(await evaluate(`document.querySelector('#panel .ap-icon').getAttribute('src')`), 'assets/ui/ap.png');
assert.equal(await evaluate(`document.querySelector('#panel .ap-icon').naturalWidth > 0`), true);
assert.doesNotMatch(await evaluate(`document.querySelector('#panel').innerText`), /Select an attribute to edit/i);
const buildSummaryAttributeSum = await evaluate(`Number(document.querySelector('.build-summary-attribute-sum').textContent)`);
const expectedBuildSummaryAttributeSum = await evaluate(`(() => {
  const derived = Calc.derive(Share.fromUrl());
  return derived.categories
    .filter((category) => derived.arch.position === 'GK' || category.id !== 'goalkeeping')
    .flatMap((category) => category.attributes)
    .filter((attribute) => attribute.displayType !== 'stars')
    .reduce((total, attribute) => total + attribute.currentValue, 0);
})()`);
assert.equal(buildSummaryAttributeSum, expectedBuildSummaryAttributeSum);
await screenshot('/tmp/clubs-builder-desktop.png');
await click('[data-attr="vision"]');
assert.equal(await evaluate(`document.querySelector('#panel').dataset.kind`), 'attribute');
assert.match(await evaluate(`document.querySelector('#panel').innerText`), /Vision/i);
assert.equal(await evaluate(`document.querySelectorAll('#panel .attribute-related-item').length > 0`), true);
assert.equal(await evaluate(`document.querySelector('#panel .ap-icon').naturalWidth > 0`), true);
await screenshot('/tmp/clubs-builder-attribute-detail.png');

// UT players: buildable/all toggle, position filter and a search box that keeps focus while typing.
await click('#btn-utplayers');
await waitFor(`!/Loading/.test(document.querySelector('#modal-box').innerText)`, 20000);
const utBuildableRows = await evaluate(`document.querySelectorAll('.ut-card').length`);
assert.equal(utBuildableRows > 0, true);
assert.equal(await evaluate(`document.querySelectorAll('.ut-card-locked').length`), 0);
const utCardLayout = await evaluate(`(() => {
  const card = document.querySelector('.ut-card');
  const image = card && card.querySelector(':scope > img');
  const rect = card && card.getBoundingClientRect();
  return card && image ? {
    childCount: card.children.length,
    width: rect.width,
    height: rect.height,
    imageWidth: image.getBoundingClientRect().width,
  } : null;
})()`);
assert.ok(utCardLayout);
assert.equal(utCardLayout.childCount, 1);
assert.equal(utCardLayout.width >= 180, true);
assert.equal(utCardLayout.height > utCardLayout.width, true);
assert.equal(Math.abs(utCardLayout.imageWidth - utCardLayout.width) < 1, true);
await click('[data-ut-only="0"]');
assert.equal(await evaluate(`document.querySelectorAll('.ut-card-locked').length`) > 0, true);
await click('[data-ut-only="1"]');
assert.equal(await evaluate(`document.querySelectorAll('.ut-card').length`), utBuildableRows);
await click('[data-ut-pos="CB"]');
assert.equal(await evaluate(`[...document.querySelectorAll('.ut-card')].every((el) => /\\bCB\\b/.test(el.dataset.utPositions))`), true);
await click('[data-ut-pos="all"]');
assert.equal(await evaluate(`document.querySelectorAll('.ut-card').length`), utBuildableRows);
await evaluate(`document.querySelector('#ut-search').focus()`);
await typeText('kane');
assert.equal(await evaluate(`document.querySelector('#ut-search').value`), 'kane');
assert.equal(await evaluate(`document.activeElement && document.activeElement.id`), 'ut-search');
await waitFor(`[...document.querySelectorAll('.ut-card > img')].every((image) => image.complete)`, 20000);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('.ut-card > img')].filter((image) => image.naturalWidth === 0).map((image) => image.src)`), []);
await screenshot('/tmp/clubs-builder-ut-players.png');
await evaluate(`(() => { const el = document.querySelector('#ut-search'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await delay(120);
await click('[data-modal-close]');

await click('[data-arch="gk_shot_stopper"]');
await evaluate(`(() => { const el = document.querySelector('#level-input'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await delay(100);
const goalkeeperText = await evaluate(`document.querySelector('#positions-bar').innerText`);
assert.match(goalkeeperText, /GK/);
assert.match(goalkeeperText, /Est\. OVR/i);
assert.equal(await evaluate(`document.querySelectorAll('[data-pos]:not([data-pos="GK"])').length`), 0);
assert.equal(await evaluate(`Number(document.querySelector('.build-summary-attribute-sum').textContent)`), 1885);
await click('#btn-maxsum');
assert.equal(await evaluate(`document.querySelectorAll('[data-sum-attr]').length`), 34);
assert.equal(await evaluate(`document.querySelectorAll('[data-sum-attr="skill_moves"], [data-sum-attr="weak_foot"]').length`), 0);
await click('[data-modal-close]');

await click('[data-modal="specializations"]');
await click('[data-spec-unlock="spider"]');
await click('[data-spec-assign="spider"][data-slot="0"]');
await click('[data-spec-unlock="octopus"]');
await click('[data-spec-assign="octopus"][data-slot="1"]');
assert.equal(await evaluate(`Object.keys(Share.fromUrl().signatures).length`), 1);
assert.equal(await evaluate(`Object.values(Share.fromUrl().signatures)[0]`), 'octopus');
await click('[data-modal-close]');

const encodedVersion = await evaluate(`(() => { let value = new URLSearchParams(location.search).get('b').replace(/-/g, '+').replace(/_/g, '/'); while (value.length % 4) value += '='; return JSON.parse(decodeURIComponent(escape(atob(value)))).v; })()`);
assert.equal(encodedVersion, 2);
const exportCanvas = await evaluate(`(async () => { const b = Share.fromUrl(); const canvas = await Share.renderCard(b, Calc.derive(b)); const pixel = [...canvas.getContext('2d').getImageData(20, 20, 1, 1).data]; return { width: canvas.width, height: canvas.height, pixel, positions: b.positions }; })()`);
assert.equal(exportCanvas.width > 1000 && exportCanvas.height > 500, true);
assert.equal(exportCanvas.pixel[3] > 0, true);
assert.deepEqual(exportCanvas.positions, ['GK']);
await waitFor(`[...document.images].every((image) => image.complete)`);
assert.deepEqual(await evaluate(`[...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.src)`), []);
assert.deepEqual(errors.filter((error) => !/favicon/i.test(error)), []);

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.reload', { ignoreCache: true });
await delay(100);
errors.length = 0;
await waitFor(`document.readyState === 'complete' && !!window.Calc && !!window.Share && document.querySelector('#positions-bar').children.length > 0 && [...document.images].every((image) => image.complete)`);
const brokenImagesAfterReload = await evaluate(`[...document.images].filter((image) => image.naturalWidth === 0).length`);
if (brokenImagesAfterReload) {
  await evaluate(`[...document.images].filter((image) => image.naturalWidth === 0).forEach((image) => { const url = new URL(image.src); url.searchParams.set('_retry', '1'); image.src = url.toString(); })`);
  await waitFor(`[...document.images].every((image) => image.complete)`);
  errors.length = 0;
}
assert.deepEqual(await evaluate(`[...document.images].filter((image) => image.naturalWidth === 0).map((image) => image.src)`), []);
const mobileLayout = await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, positionsHeight: document.querySelector('#positions-bar').getBoundingClientRect().height })`);
if (mobileLayout.width !== 390 || mobileLayout.scrollWidth > mobileLayout.width) {
  const overflow = await evaluate(`[...document.querySelectorAll('body *')].map((el) => { const r = el.getBoundingClientRect(); return { tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 120), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; }).filter((r) => r.right > 390 || r.width > 390).slice(0, 20)`);
  console.log(JSON.stringify({ mobileLayout, overflow }, null, 2));
}
assert.equal(mobileLayout.width, 390);
assert.equal(mobileLayout.scrollWidth <= mobileLayout.width, true);
assert.equal(mobileLayout.positionsHeight > 0, true);
await click('#btn-weights');
assert.equal(await evaluate(`document.querySelector('#btn-weights').getAttribute('aria-checked')`), 'true');
assert.equal(await evaluate(`document.querySelectorAll('.attr-weight').length > 0`), true);
assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
await screenshot('/tmp/clubs-builder-mobile.png');
await click('[data-modal="playStyles"]');
const mobilePlaystylesLayout = await evaluate(`(() => { const modal = document.querySelector('#modal-box'); return { clientWidth: modal.clientWidth, scrollWidth: modal.scrollWidth }; })()`);
assert.equal(mobilePlaystylesLayout.scrollWidth <= mobilePlaystylesLayout.clientWidth, true);
await waitFor(`[...document.querySelectorAll('#modal-box img')].every((image) => image.complete)`);
assert.deepEqual(await evaluate(`[...document.querySelectorAll('#modal-box img')].filter((image) => image.naturalWidth === 0).map((image) => image.src)`), []);
await delay(100);
errors.length = 0;
await screenshot('/tmp/clubs-builder-mobile-playstyles.png');
await click('[data-modal-close]');

// Community Builds configured state: gallery, cached author, publish and local-token deletion.
const communitySeedCode = Buffer.from(JSON.stringify({
  v: 2,
  a: 'mid_creator',
  l: 100,
  h: 180,
  w: 75,
  t: { vision: 99, short_passing: 96, long_passing: 96 },
  po: ['CAM', 'CM'],
})).toString('base64url');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    window.COMMUNITY_CONFIG = {
      apiUrl: 'https://community.test/functions/v1/community-builds',
      turnstileSiteKey: 'test-site-key',
    };
    const nativeFetch = window.fetch.bind(window);
    const seed = {
      id: '11111111-1111-4111-8111-111111111111',
      authorName: 'Alex',
      buildName: 'Creator control',
      buildCode: ${JSON.stringify(communitySeedCode)},
      createdAt: '2026-07-28T12:00:00.000Z',
    };
    window.__communityMock = { posts: 0, deletes: 0, items: [seed] };
    window.fetch = async (input, options = {}) => {
      const url = String(input && input.url || input);
      if (!url.startsWith(window.COMMUNITY_CONFIG.apiUrl)) return nativeFetch(input, options);
      const method = String(options.method || 'GET').toUpperCase();
      if (method === 'GET') {
        return new Response(JSON.stringify({ items: window.__communityMock.items, nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'POST') {
        const payload = JSON.parse(options.body);
        const build = {
          id: '22222222-2222-4222-8222-222222222222',
          authorName: payload.authorName,
          buildName: payload.buildName,
          buildCode: payload.buildCode,
          createdAt: '2026-07-29T12:00:00.000Z',
        };
        window.__communityMock.posts++;
        window.__communityMock.items.unshift(build);
        return new Response(JSON.stringify({ build, manageToken: 'cbm_' + 'a'.repeat(43) }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'DELETE') {
        window.__communityMock.deletes++;
        return new Response(JSON.stringify({ deleted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 405 });
    };
    window.turnstile = {
      render(container, options) {
        queueMicrotask(() => options.callback('test-turnstile-token'));
        return 'community-test-widget';
      },
      remove() {},
      reset() {},
    };
  })();`,
});
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.reload', { ignoreCache: true });
await waitFor(`document.readyState === 'complete' && !!window.Community && document.querySelector('[data-modal="community"]')`);
errors.length = 0;
await click('[data-modal="community"]');
await waitFor(`document.querySelectorAll('.community-card').length === 1`);
assert.match(await evaluate(`document.querySelector('.community-card').innerText`), /Creator control/);
assert.match(await evaluate(`document.querySelector('.community-card').innerText`), /Alex/);
assert.equal(await evaluate(`document.querySelectorAll('.community-card [data-community-delete]').length`), 0);
const communityDesktopLayout = await evaluate(`(() => {
  const modal = document.querySelector('#modal-box');
  const card = document.querySelector('.community-card');
  return {
    modalClientWidth: modal.clientWidth,
    modalScrollWidth: modal.scrollWidth,
    cardWidth: Math.round(card.getBoundingClientRect().width),
  };
})()`);
assert.equal(communityDesktopLayout.modalScrollWidth <= communityDesktopLayout.modalClientWidth, true);
assert.equal(communityDesktopLayout.cardWidth >= 300, true);
await click('[data-community-publish-toggle]');
await waitFor(`document.querySelector('#community-publish-submit') && !document.querySelector('#community-publish-submit').disabled`);
await evaluate(`(() => {
  const author = document.querySelector('#community-author');
  const name = document.querySelector('#community-build-name');
  author.value = 'Vinicius';
  name.value = 'GK community test';
  author.dispatchEvent(new Event('input', { bubbles: true }));
  name.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await click('#community-publish-submit');
await waitFor(`window.__communityMock.posts === 1 && document.querySelectorAll('.community-card').length === 2`);
assert.equal(await evaluate(`Community.getSavedAuthor()`), 'Vinicius');
assert.equal(await evaluate(`document.querySelectorAll('[data-community-delete]').length`), 1);
await click('[data-community-publish-toggle]');
assert.equal(await evaluate(`document.querySelector('#community-author').value`), 'Vinicius');
await click('[data-community-publish-cancel]');
await screenshot('/tmp/clubs-builder-community-desktop.png');
await evaluate(`window.confirm = () => true`);
await click('[data-community-delete="22222222-2222-4222-8222-222222222222"]');
await waitFor(`window.__communityMock.deletes === 1 && document.querySelectorAll('.community-card').length === 1`);

await click('[data-modal-close]');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.reload', { ignoreCache: true });
await waitFor(`document.readyState === 'complete' && !!window.Community && document.querySelector('[data-modal="community"]')`);
errors.length = 0;
await click('[data-modal="community"]');
await waitFor(`document.querySelectorAll('.community-card').length === 1`);
const communityMobileLayout = await evaluate(`(() => {
  const modal = document.querySelector('#modal-box');
  return {
    viewportWidth: innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    modalClientWidth: modal.clientWidth,
    modalScrollWidth: modal.scrollWidth,
  };
})()`);
assert.equal(communityMobileLayout.pageScrollWidth <= communityMobileLayout.viewportWidth, true);
assert.equal(communityMobileLayout.modalScrollWidth <= communityMobileLayout.modalClientWidth, true);
await screenshot('/tmp/clubs-builder-community-mobile.png');

const relevantErrors = errors.filter((error) => !/favicon/i.test(error));
assert.deepEqual(relevantErrors, []);
console.log(JSON.stringify({
  appUrl,
  communitySetup,
  positionText,
  optimizerToast,
  unreachableToast,
  creatorOptimizerRegression,
  playstyleQuickUnlock,
  exportCanvas,
  mobileLayout,
  mobilePlaystylesLayout,
  communityDesktopLayout,
  communityMobileLayout,
  screenshots: ['/tmp/clubs-builder-desktop.png', '/tmp/clubs-builder-mobile.png', '/tmp/clubs-builder-playstyles-quick-unlock.png', '/tmp/clubs-builder-playstyles-sell-hover.png', '/tmp/clubs-builder-mobile-playstyles.png', '/tmp/clubs-builder-community-desktop.png', '/tmp/clubs-builder-community-mobile.png'],
}, null, 2));

socket.close();
await fetch(`${cdpBase}/json/close/${target.id}`);
