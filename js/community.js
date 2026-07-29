/*
 * Client for the optional Community Builds API.
 *
 * No SDK is required. Network operations fail closed until COMMUNITY_CONFIG
 * contains the required public endpoint and site key.
 */
window.Community = (function (root) {
  'use strict';

  const AUTHOR_STORAGE_KEY = 'clubsBuilder.community.author.v1';
  const TOKENS_STORAGE_KEY = 'clubsBuilder.community.tokens.v1';
  const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  const DEFAULT_TIMEOUT_MS = 10000;
  const DEFAULT_TURNSTILE_TIMEOUT_MS = 15000;

  let turnstileScriptPromise = null;
  let turnstileWidgetId = null;
  let turnstileContainer = null;
  let turnstileGeneration = 0;
  let turnstileMountVersion = 0;

  class CommunityError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'CommunityError';
      this.code = options.code || 'COMMUNITY_ERROR';
      if (Number.isFinite(options.status)) this.status = options.status;
      if (options.cause) this.cause = options.cause;
      if (options.detail != null) this.detail = options.detail;
    }
  }

  function config() {
    return root.COMMUNITY_CONFIG && typeof root.COMMUNITY_CONFIG === 'object'
      ? root.COMMUNITY_CONFIG
      : {};
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizedSingleLine(value) {
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

  function configuredApiUrl() {
    const raw = cleanString(config().apiUrl);
    if (!raw) {
      throw new CommunityError(
        'Community builds are not available yet.',
        { code: 'COMMUNITY_NOT_CONFIGURED' },
      );
    }

    let parsed;
    try {
      const base = root.location && root.location.href ? root.location.href : undefined;
      parsed = base ? new URL(raw, base) : new URL(raw);
    } catch (cause) {
      throw new CommunityError(
        'The Community Builds API is not configured correctly.',
        { code: 'INVALID_CONFIGURATION', cause },
      );
    }

    const localHttp = parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1');
    if (parsed.protocol !== 'https:' && !localHttp) {
      throw new CommunityError(
        'The Community Builds API must use HTTPS.',
        { code: 'INVALID_CONFIGURATION' },
      );
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new CommunityError(
        'The Community Builds API is not configured correctly.',
        { code: 'INVALID_CONFIGURATION' },
      );
    }

    return parsed.toString().replace(/\/+$/, '');
  }

  function configuredSiteKey() {
    const siteKey = cleanString(config().turnstileSiteKey);
    if (!siteKey) {
      throw new CommunityError(
        'Publishing community builds is not available yet.',
        { code: 'TURNSTILE_NOT_CONFIGURED' },
      );
    }
    return siteKey;
  }

  function isConfigured() {
    try {
      configuredApiUrl();
      configuredSiteKey();
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeStorage() {
    try {
      return root.localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function storageGet(key) {
    const storage = safeStorage();
    if (!storage) return null;
    try {
      return storage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function storageSet(key, value) {
    const storage = safeStorage();
    if (!storage) return false;
    try {
      storage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getSavedAuthor() {
    const author = normalizedSingleLine(storageGet(AUTHOR_STORAGE_KEY));
    return characterLength(author) <= 32 ? author : '';
  }

  function saveAuthor(authorName) {
    const author = normalizedSingleLine(authorName);
    if (characterLength(author) < 2 || characterLength(author) > 32) return false;
    return storageSet(AUTHOR_STORAGE_KEY, author);
  }

  function readManageTokens() {
    const value = storageGet(TOKENS_STORAGE_KEY);
    if (!value) return Object.create(null);
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null);
      const tokens = Object.create(null);
      Object.keys(parsed).forEach((id) => {
        if (
          typeof parsed[id] === 'string'
          && parsed[id].length >= 16
          && parsed[id].length <= 512
        ) {
          tokens[id] = parsed[id];
        }
      });
      return tokens;
    } catch (error) {
      return Object.create(null);
    }
  }

  function writeManageTokens(tokens) {
    return storageSet(TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  }

  function saveManageToken(id, token) {
    const safeId = cleanString(id);
    const safeToken = cleanString(token);
    if (!safeId || safeId.length > 256 || safeToken.length < 16 || safeToken.length > 512) return false;
    const tokens = readManageTokens();
    tokens[safeId] = safeToken;
    return writeManageTokens(tokens);
  }

  function getManageToken(id) {
    const safeId = cleanString(id);
    if (!safeId) return null;
    const tokens = readManageTokens();
    return Object.prototype.hasOwnProperty.call(tokens, safeId) ? tokens[safeId] : null;
  }

  function forgetManageToken(id) {
    const safeId = cleanString(id);
    if (!safeId) return false;
    const tokens = readManageTokens();
    if (!Object.prototype.hasOwnProperty.call(tokens, safeId)) return false;
    delete tokens[safeId];
    writeManageTokens(tokens);
    return true;
  }

  function timeoutMs() {
    const configured = Number(config().requestTimeoutMs);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), 60000)
      : DEFAULT_TIMEOUT_MS;
  }

  function friendlyHttpError(status, body) {
    const bodyError = body && typeof body.error === 'object' ? body.error : null;
    const responseCode = cleanString((bodyError && bodyError.code) || (body && body.code));
    const responseMessage = normalizedSingleLine(
      (bodyError && bodyError.message) || (body && body.message) || (typeof body.error === 'string' && body.error),
    );

    let code = responseCode || 'HTTP_ERROR';
    let message = responseMessage && responseMessage.length <= 180 ? responseMessage : '';
    if (status === 400 || status === 422) {
      code = responseCode || 'INVALID_REQUEST';
      message = message || 'Please check the build details and try again.';
    } else if (status === 401 || status === 403) {
      code = responseCode || 'NOT_AUTHORIZED';
      if (responseCode === 'challenge_failed') {
        message = responseMessage || 'Verification failed. Please try again.';
      } else if (responseCode === 'origin_not_allowed') {
        message = 'This site is not allowed to use Community Builds.';
      } else {
        message = 'This publication cannot be managed from this browser.';
      }
    } else if (status === 404) {
      code = responseCode || 'BUILD_NOT_FOUND';
      message = 'This community build no longer exists.';
    } else if (status === 409) {
      code = responseCode || 'CONFLICT';
      message = message || 'This build has already been published.';
    } else if (status === 429) {
      code = responseCode || 'RATE_LIMITED';
      message = 'Too many attempts. Please wait a moment and try again.';
    } else if (status >= 500) {
      code = responseCode || 'SERVICE_UNAVAILABLE';
      message = 'Community Builds is temporarily unavailable. Please try again later.';
    }
    return new CommunityError(message || 'The Community Builds request failed.', { code, status });
  }

  async function responseBody(response) {
    if (!response || response.status === 204) return null;
    if (typeof response.json === 'function') {
      try {
        return await response.json();
      } catch (error) {
        // Some successful DELETE endpoints intentionally return an empty body.
      }
    }
    if (typeof response.text === 'function') {
      try {
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  async function request(url, options = {}) {
    if (typeof root.fetch !== 'function') {
      throw new CommunityError(
        'Community Builds is not supported by this browser.',
        { code: 'FETCH_UNAVAILABLE' },
      );
    }

    const externalSignal = options.signal || null;
    const Controller = root.AbortController;
    const controller = typeof Controller === 'function' ? new Controller() : null;
    let callerAborted = Boolean(externalSignal && externalSignal.aborted);
    let timedOut = false;
    let timeoutId = null;
    let abortListener = null;

    if (controller && externalSignal) {
      abortListener = () => {
        callerAborted = true;
        controller.abort(externalSignal.reason);
      };
      if (externalSignal.aborted) abortListener();
      else if (typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    const fetchOptions = {
      method: options.method || 'GET',
      headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller ? controller.signal : externalSignal || undefined,
    };
    if (options.body !== undefined) fetchOptions.body = options.body;

    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = root.setTimeout(() => {
        timedOut = true;
        if (controller) controller.abort();
        reject(new CommunityError(
          'The Community Builds request took too long. Please try again.',
          { code: 'REQUEST_TIMEOUT' },
        ));
      }, timeoutMs());
    });

    try {
      if (callerAborted) {
        throw new CommunityError('The request was cancelled.', { code: 'REQUEST_ABORTED' });
      }
      const fetchPromise = Promise.resolve().then(() => root.fetch(url, fetchOptions));
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      const body = await responseBody(response);
      if (!response || !response.ok) {
        throw friendlyHttpError(response ? response.status : 0, body);
      }
      return body;
    } catch (error) {
      if (error instanceof CommunityError) throw error;
      if (timedOut) {
        throw new CommunityError(
          'The Community Builds request took too long. Please try again.',
          { code: 'REQUEST_TIMEOUT', cause: error },
        );
      }
      if (callerAborted || (externalSignal && externalSignal.aborted)) {
        throw new CommunityError('The request was cancelled.', { code: 'REQUEST_ABORTED', cause: error });
      }
      throw new CommunityError(
        'Could not reach Community Builds. Check your connection and try again.',
        { code: 'NETWORK_ERROR', cause: error },
      );
    } finally {
      if (timeoutId != null) root.clearTimeout(timeoutId);
      if (
        externalSignal
        && abortListener
        && typeof externalSignal.removeEventListener === 'function'
      ) {
        externalSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  async function list(options = {}) {
    const apiUrl = configuredApiUrl();
    const url = new URL(apiUrl);
    if (options.cursor != null && cleanString(String(options.cursor))) {
      url.searchParams.set('cursor', cleanString(String(options.cursor)));
    }
    if (options.limit != null) {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new CommunityError('The requested page size is invalid.', { code: 'INVALID_LIMIT' });
      }
      url.searchParams.set('limit', String(limit));
    }

    const data = await request(url.toString(), { signal: options.signal });
    if (!data || !Array.isArray(data.items)) {
      throw new CommunityError(
        'Community Builds returned an unexpected response.',
        { code: 'INVALID_RESPONSE' },
      );
    }
    return {
      items: data.items,
      nextCursor: typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null,
    };
  }

  function validatePublishInput(input) {
    if (!input || typeof input !== 'object') {
      throw new CommunityError('Please complete the publication form.', { code: 'INVALID_PUBLISH_INPUT' });
    }
    const authorName = normalizedSingleLine(input.authorName);
    const buildName = normalizedSingleLine(input.buildName);
    const buildCode = cleanString(input.buildCode);
    const turnstileToken = cleanString(input.turnstileToken);

    if (characterLength(authorName) < 2 || characterLength(authorName) > 32) {
      throw new CommunityError('Enter a public name with 2 to 32 characters.', { code: 'INVALID_AUTHOR_NAME' });
    }
    if (characterLength(buildName) < 2 || characterLength(buildName) > 60) {
      throw new CommunityError('Enter a build name with 2 to 60 characters.', { code: 'INVALID_BUILD_NAME' });
    }
    if (!buildCode || buildCode.length > 16384) {
      throw new CommunityError('The current build cannot be published.', { code: 'INVALID_BUILD_CODE' });
    }
    if (!turnstileToken || turnstileToken.length > 2048) {
      throw new CommunityError('Complete the verification before publishing.', { code: 'TURNSTILE_REQUIRED' });
    }
    return { authorName, buildName, buildCode, turnstileToken };
  }

  async function publish(input) {
    configuredSiteKey();
    const apiUrl = configuredApiUrl();
    const payload = validatePublishInput(input);
    const data = await request(apiUrl, {
      method: 'POST',
      signal: input.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!data || !data.build || typeof data.build !== 'object' || !cleanString(data.build.id)) {
      throw new CommunityError(
        'Community Builds returned an unexpected response.',
        { code: 'INVALID_RESPONSE' },
      );
    }

    saveAuthor(payload.authorName);
    const manageToken = cleanString(data.manageToken);
    if (manageToken) saveManageToken(data.build.id, manageToken);
    return { build: data.build, manageToken: manageToken || undefined };
  }

  async function remove(id, options = {}) {
    const apiUrl = configuredApiUrl();
    const safeId = cleanString(id);
    if (!safeId || safeId.length > 256) {
      throw new CommunityError('This community build is invalid.', { code: 'INVALID_BUILD_ID' });
    }
    const manageToken = getManageToken(safeId);
    if (!manageToken) {
      throw new CommunityError(
        'This publication can only be deleted from the browser that published it or with its recovery code.',
        { code: 'MANAGE_TOKEN_MISSING', status: 401 },
      );
    }

    const data = await request(`${apiUrl}/v1/builds/${encodeURIComponent(safeId)}`, {
      method: 'DELETE',
      signal: options.signal,
      headers: { Authorization: `Bearer ${manageToken}` },
    });
    forgetManageToken(safeId);
    return data == null ? true : data;
  }

  function turnstileLoadTimeoutMs() {
    const configured = Number(config().turnstileLoadTimeoutMs);
    return Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), 60000)
      : DEFAULT_TURNSTILE_TIMEOUT_MS;
  }

  function hasTurnstileApi() {
    return Boolean(root.turnstile && typeof root.turnstile.render === 'function');
  }

  function loadTurnstile() {
    if (hasTurnstileApi()) return Promise.resolve(root.turnstile);
    if (turnstileScriptPromise) return turnstileScriptPromise;
    const document = root.document;
    if (!document || typeof document.createElement !== 'function') {
      return Promise.reject(new CommunityError(
        'Human verification is not supported in this browser.',
        { code: 'TURNSTILE_UNAVAILABLE' },
      ));
    }

    turnstileScriptPromise = new Promise((resolve, reject) => {
      let settled = false;
      let loadTimer = null;
      let script = typeof document.querySelector === 'function'
        ? document.querySelector('script[data-community-turnstile]')
        : null;
      const created = !script;

      function cleanupListeners() {
        if (loadTimer != null) root.clearTimeout(loadTimer);
        if (script && typeof script.removeEventListener === 'function') {
          script.removeEventListener('load', loaded);
          script.removeEventListener('error', failed);
        }
      }

      function fail(error) {
        if (settled) return;
        settled = true;
        cleanupListeners();
        turnstileScriptPromise = null;
        if (created && script && typeof script.remove === 'function') script.remove();
        reject(error instanceof CommunityError ? error : new CommunityError(
          'Human verification could not be loaded. Please try again.',
          { code: 'TURNSTILE_LOAD_FAILED', cause: error },
        ));
      }

      function loaded() {
        if (settled) return;
        if (!hasTurnstileApi()) {
          fail(new CommunityError(
            'Human verification could not be loaded. Please try again.',
            { code: 'TURNSTILE_LOAD_FAILED' },
          ));
          return;
        }
        settled = true;
        cleanupListeners();
        resolve(root.turnstile);
      }

      function failed(event) {
        fail(new CommunityError(
          'Human verification could not be loaded. Please try again.',
          { code: 'TURNSTILE_LOAD_FAILED', detail: event && event.type },
        ));
      }

      if (!script) {
        script = document.createElement('script');
        script.src = TURNSTILE_SRC;
        script.async = true;
        script.defer = true;
        if (typeof script.setAttribute === 'function') {
          script.setAttribute('data-community-turnstile', 'true');
        }
      }
      if (typeof script.addEventListener !== 'function') {
        fail(new CommunityError(
          'Human verification is not supported in this browser.',
          { code: 'TURNSTILE_UNAVAILABLE' },
        ));
        return;
      }
      script.addEventListener('load', loaded);
      script.addEventListener('error', failed);
      loadTimer = root.setTimeout(() => failed({ type: 'timeout' }), turnstileLoadTimeoutMs());

      if (created) {
        const parent = document.head || document.documentElement;
        if (!parent || typeof parent.appendChild !== 'function') {
          fail(new CommunityError(
            'Human verification is not supported in this browser.',
            { code: 'TURNSTILE_UNAVAILABLE' },
          ));
          return;
        }
        parent.appendChild(script);
      } else if (hasTurnstileApi()) {
        loaded();
      }
    });
    return turnstileScriptPromise;
  }

  function resolveContainer(container) {
    const document = root.document;
    const element = typeof container === 'string' && document && typeof document.querySelector === 'function'
      ? document.querySelector(container)
      : container;
    if (!element || typeof element !== 'object') {
      throw new CommunityError(
        'The verification area could not be found.',
        { code: 'TURNSTILE_CONTAINER_MISSING' },
      );
    }
    return element;
  }

  function clearContainer(container) {
    if (!container) return;
    if (typeof container.replaceChildren === 'function') container.replaceChildren();
    else while (container.firstChild && typeof container.removeChild === 'function') {
      container.removeChild(container.firstChild);
    }
  }

  function removeCurrentWidget(turnstile) {
    turnstileGeneration++;
    if (turnstileWidgetId != null && turnstile) {
      try {
        if (typeof turnstile.remove === 'function') turnstile.remove(turnstileWidgetId);
        else if (typeof turnstile.reset === 'function') turnstile.reset(turnstileWidgetId);
      } catch (error) {
        // A stale widget must not prevent a fresh verification attempt.
      }
    }
    clearContainer(turnstileContainer);
    turnstileWidgetId = null;
    turnstileContainer = null;
  }

  async function mountTurnstile(container, options = {}) {
    const sitekey = configuredSiteKey();
    const target = resolveContainer(container);
    const mountVersion = ++turnstileMountVersion;
    const turnstile = await loadTurnstile();
    if (mountVersion !== turnstileMountVersion) return null;
    removeCurrentWidget(turnstile);
    clearContainer(target);
    const generation = ++turnstileGeneration;
    const actionCandidate = cleanString(options.action) || 'publish_build';
    const action = /^[A-Za-z0-9_-]{1,32}$/.test(actionCandidate)
      ? actionCandidate
      : 'publish_build';

    const renderOptions = {
      sitekey,
      theme: 'dark',
      size: 'flexible',
      appearance: 'interaction-only',
      action,
      callback(token) {
        if (generation === turnstileGeneration && typeof options.onToken === 'function') {
          options.onToken(token);
        }
      },
      'expired-callback'() {
        if (generation === turnstileGeneration && typeof options.onExpired === 'function') {
          options.onExpired();
        }
      },
      'error-callback'(challengeCode) {
        if (generation === turnstileGeneration && typeof options.onError === 'function') {
          options.onError(new CommunityError(
            'Human verification failed. Please try again.',
            { code: 'TURNSTILE_CHALLENGE_ERROR', detail: challengeCode },
          ));
        }
      },
    };

    let widgetId;
    try {
      widgetId = turnstile.render(target, renderOptions);
    } catch (cause) {
      throw new CommunityError(
        'Human verification could not be displayed. Please try again.',
        { code: 'TURNSTILE_RENDER_FAILED', cause },
      );
    }
    if (widgetId == null) {
      throw new CommunityError(
        'Human verification could not be displayed. Please try again.',
        { code: 'TURNSTILE_RENDER_FAILED' },
      );
    }
    turnstileWidgetId = widgetId;
    turnstileContainer = target;
    return widgetId;
  }

  function unmountTurnstile() {
    const hadWidget = turnstileWidgetId != null || turnstileContainer != null;
    turnstileMountVersion++;
    removeCurrentWidget(root.turnstile);
    return hadWidget;
  }

  function resetTurnstile() {
    if (
      turnstileWidgetId == null
      || !root.turnstile
      || typeof root.turnstile.reset !== 'function'
    ) return false;
    try {
      root.turnstile.reset(turnstileWidgetId);
      return true;
    } catch (error) {
      return false;
    }
  }

  return Object.freeze({
    list,
    publish,
    remove,
    getSavedAuthor,
    saveAuthor,
    getManageToken,
    isConfigured,
    mountTurnstile,
    unmountTurnstile,
    resetTurnstile,
    CommunityError,
  });
})(window);
