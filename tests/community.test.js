const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new Error('empty body');
      return body;
    },
  };
}

function localStorageFake(options = {}) {
  const values = new Map();
  return {
    getItem(key) {
      if (options.throwOnRead) throw new Error('storage unavailable');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (options.throwOnWrite) throw new Error('storage unavailable');
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    values,
  };
}

function createContext(options = {}) {
  const context = {
    console,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    localStorage: options.localStorage || localStorageFake(),
    COMMUNITY_CONFIG: Object.prototype.hasOwnProperty.call(options, 'config')
      ? options.config
      : {
          apiUrl: 'https://community.example/functions/v1/community-builds',
          turnstileSiteKey: 'public-site-key',
        },
    fetch: options.fetch || (async () => response(200, { items: [], nextCursor: null })),
    document: options.document,
    turnstile: options.turnstile,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const files = options.files || ['js/community.js'];
  files.forEach((file) => {
    vm.runInContext(
      fs.readFileSync(path.join(rootDir, file), 'utf8'),
      context,
      { filename: file },
    );
  });
  return context;
}

test('checked-in config contains only the expected public identifiers', async () => {
  const context = createContext({
    files: ['js/community-config.js', 'js/community.js'],
    config: {},
  });
  assert.equal(
    context.COMMUNITY_CONFIG.apiUrl,
    'https://czfstgqqkjewbzbcblle.supabase.co/functions/v1/community-builds',
  );
  assert.equal(context.COMMUNITY_CONFIG.turnstileSiteKey, '0x4AAAAAAEAjy-lSiXjfRYb1');
  assert.deepEqual(Object.keys(context.COMMUNITY_CONFIG).sort(), ['apiUrl', 'turnstileSiteKey']);
  assert.equal(context.Community.isConfigured(), true);
});

test('checked-in config preserves public values injected by the deploy environment', () => {
  const context = createContext({
    files: ['js/community-config.js', 'js/community.js'],
    config: {
      apiUrl: 'https://injected.example/community',
      turnstileSiteKey: 'injected-public-site-key',
      requestTimeoutMs: 3210,
    },
  });
  assert.equal(context.COMMUNITY_CONFIG.apiUrl, 'https://injected.example/community');
  assert.equal(context.COMMUNITY_CONFIG.turnstileSiteKey, 'injected-public-site-key');
  assert.equal(context.COMMUNITY_CONFIG.requestTimeoutMs, 3210);
  assert.equal(context.Community.isConfigured(), true);
});

test('list uses the configured collection endpoint and normalizes pagination', async () => {
  const calls = [];
  const context = createContext({
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(200, { items: [{ id: 'one' }], nextCursor: 'next page' });
    },
  });

  const result = await context.Community.list({ cursor: 'a/b', limit: 24 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    items: [{ id: 'one' }],
    nextCursor: 'next page',
  });
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, 'https://community.example/functions/v1/community-builds');
  assert.equal(url.searchParams.get('cursor'), 'a/b');
  assert.equal(url.searchParams.get('limit'), '24');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(
    context.Community.list({ limit: 51 }),
    (error) => error.code === 'INVALID_LIMIT',
  );
});

test('publish validates, posts JSON, and saves author and management token', async () => {
  const calls = [];
  const storage = localStorageFake();
  const context = createContext({
    localStorage: storage,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response(201, {
        build: { id: 'build-42', authorName: 'John', buildName: 'Creator' },
        manageToken: 'a'.repeat(43),
      });
    },
  });

  const result = await context.Community.publish({
    authorName: '  John   Smith ',
    buildName: '  Creator   CAM ',
    buildCode: 'encoded-build',
    turnstileToken: 'verified-token',
  });
  assert.equal(result.build.id, 'build-42');
  assert.equal(result.manageToken, 'a'.repeat(43));
  assert.equal(calls[0].url, 'https://community.example/functions/v1/community-builds');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    authorName: 'John Smith',
    buildName: 'Creator CAM',
    buildCode: 'encoded-build',
    turnstileToken: 'verified-token',
  });
  assert.equal(context.Community.getSavedAuthor(), 'John Smith');
  assert.equal(context.Community.getManageToken('build-42'), 'a'.repeat(43));
  assert.equal(context.Community.saveAuthor('  New   name  '), true);
  assert.equal(context.Community.getSavedAuthor(), 'New name');
  assert.equal(context.Community.saveAuthor('A'), false);
  assert.equal(context.Community.getSavedAuthor(), 'New name');

  await assert.rejects(
    context.Community.publish({
      authorName: 'A',
      buildName: 'Build',
      buildCode: 'encoded-build',
      turnstileToken: 'verified-token',
    }),
    (error) => error.code === 'INVALID_AUTHOR_NAME',
  );
});

test('storage denial never turns a successful publication into an API failure', async () => {
  const context = createContext({
    localStorage: localStorageFake({ throwOnRead: true, throwOnWrite: true }),
    fetch: async () => response(201, {
      build: { id: 'build-1' },
      manageToken: 'b'.repeat(43),
    }),
  });
  const result = await context.Community.publish({
    authorName: 'Friend',
    buildName: 'Build',
    buildCode: 'code',
    turnstileToken: 'token',
  });
  assert.equal(result.build.id, 'build-1');
  assert.equal(context.Community.getSavedAuthor(), '');
  assert.equal(context.Community.getManageToken('build-1'), null);
});

test('remove requires a local token, sends it only as Bearer, then forgets it', async () => {
  const calls = [];
  const context = createContext({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') {
        return response(201, {
          build: { id: 'build/42' },
          manageToken: 'c'.repeat(43),
        });
      }
      return response(200, { deleted: true });
    },
  });
  await context.Community.publish({
    authorName: 'Friend',
    buildName: 'Build',
    buildCode: 'code',
    turnstileToken: 'token',
  });
  const result = await context.Community.remove('build/42');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { deleted: true });
  assert.equal(
    calls[1].url,
    'https://community.example/functions/v1/community-builds/v1/builds/build%2F42',
  );
  assert.equal(calls[1].options.method, 'DELETE');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${'c'.repeat(43)}`);
  assert.equal(calls[1].url.includes('c'.repeat(10)), false);
  assert.equal(context.Community.getManageToken('build/42'), null);

  await assert.rejects(
    context.Community.remove('unknown'),
    (error) => error.code === 'MANAGE_TOKEN_MISSING' && error.status === 401,
  );
});

test('HTTP, malformed response, and network failures expose friendly metadata', async () => {
  let mode = 'rate';
  const context = createContext({
    fetch: async () => {
      if (mode === 'rate') return response(429, { code: 'TOO_FAST', message: 'internal detail' });
      if (mode === 'challenge') {
        return response(403, {
          error: { code: 'challenge_failed', message: 'Verification failed. Please try again.' },
        });
      }
      if (mode === 'malformed') return response(200, { builds: [] });
      throw new Error('socket details must not be exposed');
    },
  });

  await assert.rejects(
    context.Community.list(),
    (error) => (
      error.status === 429
      && error.code === 'TOO_FAST'
      && /wait/i.test(error.message)
    ),
  );
  mode = 'challenge';
  await assert.rejects(
    context.Community.list(),
    (error) => (
      error.status === 403
      && error.code === 'challenge_failed'
      && /verification failed/i.test(error.message)
    ),
  );
  mode = 'malformed';
  await assert.rejects(
    context.Community.list(),
    (error) => error.code === 'INVALID_RESPONSE',
  );
  mode = 'network';
  await assert.rejects(
    context.Community.list(),
    (error) => error.code === 'NETWORK_ERROR' && !error.message.includes('socket'),
  );
});

test('request timeout aborts fetch and caller AbortSignal is preserved as cancellation', async () => {
  let observedSignal = null;
  const timeoutContext = createContext({
    config: {
      apiUrl: 'https://community.example/functions/v1/community-builds',
      turnstileSiteKey: 'public-site-key',
      requestTimeoutMs: 5,
    },
    fetch: (url, options) => {
      observedSignal = options.signal;
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
  });
  await assert.rejects(
    timeoutContext.Community.list(),
    (error) => error.code === 'REQUEST_TIMEOUT',
  );
  assert.equal(observedSignal.aborted, true);

  const caller = new AbortController();
  const abortContext = createContext({
    fetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      queueMicrotask(() => caller.abort());
    }),
  });
  await assert.rejects(
    abortContext.Community.list({ signal: caller.signal }),
    (error) => error.code === 'REQUEST_ABORTED',
  );
});

function turnstileDocument(onAppend) {
  let script = null;
  const container = {
    childrenCleared: 0,
    replaceChildren() {
      this.childrenCleared++;
    },
  };
  return {
    container,
    document: {
      head: {
        appendChild(value) {
          script = value;
          onAppend(value);
          return value;
        },
      },
      createElement(tag) {
        assert.equal(tag, 'script');
        const listeners = new Map();
        return {
          src: '',
          async: false,
          defer: false,
          attributes: {},
          setAttribute(name, value) {
            this.attributes[name] = value;
          },
          addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callback);
          },
          removeEventListener(type, callback) {
            if (listeners.has(type)) listeners.get(type).delete(callback);
          },
          emit(type) {
            for (const callback of listeners.get(type) || []) callback({ type });
          },
          remove() {
            this.removed = true;
          },
        };
      },
      querySelector(selector) {
        if (selector === '#turnstile') return container;
        if (selector === 'script[data-community-turnstile]') return script;
        return null;
      },
    },
    getScript: () => script,
  };
}

test('Turnstile loads lazily in explicit mode and wires render lifecycle safely', async () => {
  const renders = [];
  const removed = [];
  const resets = [];
  let context;
  const dom = turnstileDocument((script) => {
    queueMicrotask(() => {
      context.turnstile = {
        render(container, options) {
          renders.push({ container, options });
          return `widget-${renders.length}`;
        },
        remove(id) {
          removed.push(id);
        },
        reset(id) {
          resets.push(id);
        },
      };
      script.emit('load');
    });
  });
  context = createContext({ document: dom.document });

  const events = [];
  const firstId = await context.Community.mountTurnstile('#turnstile', {
    action: 'publish_build',
    onToken: (token) => events.push(['token', token]),
    onExpired: () => events.push(['expired']),
    onError: (error) => events.push(['error', error.code, error.detail]),
  });
  assert.equal(firstId, 'widget-1');
  assert.equal(dom.getScript().src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  assert.equal(dom.getScript().attributes['data-community-turnstile'], 'true');
  assert.equal(renders[0].options.sitekey, 'public-site-key');
  assert.equal(renders[0].options.theme, 'dark');
  assert.equal(renders[0].options.size, 'flexible');
  assert.equal(renders[0].options.appearance, 'interaction-only');
  assert.equal(renders[0].options.action, 'publish_build');

  renders[0].options.callback('human-token');
  renders[0].options['expired-callback']();
  renders[0].options['error-callback']('110200');
  assert.deepEqual(events, [
    ['token', 'human-token'],
    ['expired'],
    ['error', 'TURNSTILE_CHALLENGE_ERROR', '110200'],
  ]);
  assert.equal(context.Community.resetTurnstile(), true);
  assert.deepEqual(resets, ['widget-1']);

  const secondId = await context.Community.mountTurnstile(dom.container, {});
  assert.equal(secondId, 'widget-2');
  assert.deepEqual(removed, ['widget-1']);
  renders[0].options.callback('stale-token');
  assert.equal(events.some((event) => event[1] === 'stale-token'), false);
  assert.equal(context.Community.unmountTurnstile(), true);
  assert.deepEqual(removed, ['widget-1', 'widget-2']);
  renders[1].options.callback('unmounted-token');
  assert.equal(events.some((event) => event[1] === 'unmounted-token'), false);
});

test('Turnstile mounting can be cancelled while its script is still loading', async () => {
  let pendingScript = null;
  const renders = [];
  const dom = turnstileDocument((script) => {
    pendingScript = script;
  });
  const context = createContext({ document: dom.document });
  const mounting = context.Community.mountTurnstile(dom.container);

  assert.equal(context.Community.unmountTurnstile(), false);
  context.turnstile = {
    render(container, options) {
      renders.push({ container, options });
      return 'should-not-render';
    },
  };
  pendingScript.emit('load');

  assert.equal(await mounting, null);
  assert.equal(renders.length, 0);
});

test('Turnstile script failures reject cleanly and may be retried', async () => {
  const scripts = [];
  const dom = turnstileDocument((script) => {
    scripts.push(script);
    queueMicrotask(() => script.emit('error'));
  });
  const context = createContext({ document: dom.document });
  await assert.rejects(
    context.Community.mountTurnstile(dom.container),
    (error) => error.code === 'TURNSTILE_LOAD_FAILED',
  );
  assert.equal(scripts[0].removed, true);
  assert.equal(context.Community.resetTurnstile(), false);
});
