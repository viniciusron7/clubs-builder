/*
 * Public configuration for the optional Community Builds feature.
 *
 * These values are public identifiers used by the deployed site. Never put
 * service-role, database, GitHub, Turnstile secret, or moderation credentials
 * in this file.
 */
(function (root) {
  'use strict';

  // Public endpoint and Turnstile site key for this deployment.
  const defaults = {
    apiUrl: 'https://czfstgqqkjewbzbcblle.supabase.co/functions/v1/community-builds',
    turnstileSiteKey: '0x4AAAAAAEAjy-lSiXjfRYb1',
  };
  const injected = root.COMMUNITY_CONFIG && typeof root.COMMUNITY_CONFIG === 'object'
    ? root.COMMUNITY_CONFIG
    : {};
  const publicConfig = {
    apiUrl: typeof injected.apiUrl === 'string' ? injected.apiUrl : defaults.apiUrl,
    turnstileSiteKey: typeof injected.turnstileSiteKey === 'string'
      ? injected.turnstileSiteKey
      : defaults.turnstileSiteKey,
  };
  if (Number.isFinite(Number(injected.requestTimeoutMs))) {
    publicConfig.requestTimeoutMs = Number(injected.requestTimeoutMs);
  }
  if (Number.isFinite(Number(injected.turnstileLoadTimeoutMs))) {
    publicConfig.turnstileLoadTimeoutMs = Number(injected.turnstileLoadTimeoutMs);
  }
  root.COMMUNITY_CONFIG = Object.freeze(publicConfig);
})(window);
