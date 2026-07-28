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
await send('Page.navigate', { url: appUrl });
await waitFor(`document.readyState === 'complete' && !!window.Calc && !!window.Share`);
assert.equal(await evaluate('window.OVERALL_MODEL.version'), 2);

await click('[data-arch="fwd_finisher"]');
assert.equal(await evaluate(`document.querySelectorAll('.summary-signature-slot').length`), 4);
assert.equal(await evaluate(`document.querySelectorAll('.summary-signature-slot.is-locked').length`), 4);
assert.equal(await evaluate(`[...document.querySelectorAll('.summary-signature-slot img')].every((image) => !image.src.includes('/plus/'))`), true);
const loadedFonts = await evaluate(`document.fonts.ready.then(async () => ({
  ui: (await document.fonts.load('400 16px "Cruyff Sans"')).length,
  display: (await document.fonts.load('500 16px "Cruyff Sans Condensed"')).length,
  body: getComputedStyle(document.body).fontFamily,
  heading: getComputedStyle(document.querySelector('#attributes h2')).fontFamily,
}))`);
assert.ok(loadedFonts.ui > 0);
assert.ok(loadedFonts.display > 0);
assert.match(loadedFonts.body, /Cruyff Sans/);
assert.match(loadedFonts.heading, /Cruyff Sans Condensed/);

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
assert.equal(creatorOptimizerRegression.spent <= 3167, true);
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
assert.equal(playstyleSale.idleOpacity, '1');
assert.equal(playstyleSale.actionOpacity, '0');
await hover(`[data-ps-sell="${playstyleQuickUnlock.id}"]`);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-ps-sell="${playstyleQuickUnlock.id}"] .ps-sale-idle')).opacity`), '0');
assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-ps-sell="${playstyleQuickUnlock.id}"] .ps-sale-action')).opacity`), '1');
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

const relevantErrors = errors.filter((error) => !/favicon/i.test(error));
assert.deepEqual(relevantErrors, []);
console.log(JSON.stringify({
  appUrl,
  positionText,
  optimizerToast,
  unreachableToast,
  creatorOptimizerRegression,
  playstyleQuickUnlock,
  exportCanvas,
  mobileLayout,
  mobilePlaystylesLayout,
  screenshots: ['/tmp/clubs-builder-desktop.png', '/tmp/clubs-builder-mobile.png', '/tmp/clubs-builder-playstyles-quick-unlock.png', '/tmp/clubs-builder-playstyles-sell-hover.png', '/tmp/clubs-builder-mobile-playstyles.png'],
}, null, 2));

socket.close();
await fetch(`${cdpBase}/json/close/${target.id}`);
