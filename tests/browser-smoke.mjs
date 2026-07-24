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
await evaluate(`(() => { const el = document.querySelector('#level-input'); el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await delay(75);
await click('[data-pos="ST"]');
const attributesBeforeImpossibleTarget = await evaluate(`JSON.stringify(Share.fromUrl().attributes)`);
await click('#btn-optimize');
await click('input[name="opt-mode"][value="min"]');
await evaluate(`document.querySelector('#opt-ovr').value = '99'`);
await click('#opt-run');
await waitFor(`/unreachable/i.test(document.querySelector('#toast').innerText)`);
const unreachableToast = await evaluate(`document.querySelector('#toast').innerText`);
assert.match(unreachableToast, /best is OVR 97/i);
assert.equal(await evaluate(`JSON.stringify(Share.fromUrl().attributes)`), attributesBeforeImpossibleTarget);
await click('[data-modal-close]');
await click('[data-pos="CAM"]');
const positionText = await evaluate(`document.querySelector('#positions-bar').innerText`);
assert.match(positionText, /Lowest Est\. OVR/i);
assert.doesNotMatch(positionText, /PRIMARY|ALT/i);
assert.equal(await evaluate(`(() => { const b = Share.fromUrl(); const d = Calc.derive(b); const a = Calc.overallMapForValues(['ST','CAM'], d, null); const z = Calc.overallMapForValues(['CAM','ST'], d, null); return JSON.stringify(a) === JSON.stringify({ ST: z.ST, CAM: z.CAM }); })()`), true);

const buildBeforePlaystyleUnlock = await evaluate(`JSON.stringify(Share.fromUrl())`);
const spentBeforePlaystyleUnlock = await evaluate(`Calc.derive(Share.fromUrl()).ap.spent`);
await click('[data-modal="playStyles"]');
const playstyleQuickUnlock = await evaluate(`(() => { const button = document.querySelector('[data-ps-unlock]:not([disabled])'); return button ? { id: button.dataset.psUnlock, cost: Number(button.dataset.cost) } : null; })()`);
assert.ok(playstyleQuickUnlock);
await click(`[data-ps-unlock="${playstyleQuickUnlock.id}"]`);
assert.equal(await evaluate(`Share.fromUrl().playstyles.includes(${JSON.stringify(playstyleQuickUnlock.id)})`), true);
assert.equal(await evaluate(`Calc.derive(Share.fromUrl()).ap.spent`), spentBeforePlaystyleUnlock + playstyleQuickUnlock.cost);
await screenshot('/tmp/clubs-builder-playstyles-quick-unlock.png');
await click('[data-modal-close]');
await click('#btn-undo');
assert.equal(await evaluate(`JSON.stringify(Share.fromUrl())`), buildBeforePlaystyleUnlock);
await click('#btn-redo');
assert.equal(await evaluate(`Share.fromUrl().playstyles.includes(${JSON.stringify(playstyleQuickUnlock.id)})`), true);
await click('#btn-undo');

await click('[data-modal="facilities"]');
await click('[data-fac-view="ai"]');
assert.match(await evaluate(`document.querySelector('#modal-box').innerText`), /AI Facilities share the club budget/);
const selectedAi = await evaluate(`(() => { const el = document.querySelector('[data-fac-kind="ai"][data-star="1"]:not([disabled])'); if (!el) return null; const id = el.dataset.fac; el.click(); return id; })()`);
assert.ok(selectedAi);
await delay(100);
assert.equal(await evaluate(`Object.keys(Share.fromUrl().aiFacilities).length`), 1);
await click('[data-modal-close]');
await click('#btn-undo');
assert.equal(await evaluate(`Object.keys(Share.fromUrl().aiFacilities).length`), 0);
await click('#btn-redo');
assert.equal(await evaluate(`Object.keys(Share.fromUrl().aiFacilities).length`), 1);

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
await screenshot('/tmp/clubs-builder-desktop.png');

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
  playstyleQuickUnlock,
  selectedAi,
  exportCanvas,
  mobileLayout,
  mobilePlaystylesLayout,
  screenshots: ['/tmp/clubs-builder-desktop.png', '/tmp/clubs-builder-mobile.png', '/tmp/clubs-builder-playstyles-quick-unlock.png', '/tmp/clubs-builder-mobile-playstyles.png'],
}, null, 2));

socket.close();
await fetch(`${cdpBase}/json/close/${target.id}`);
