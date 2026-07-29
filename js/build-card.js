/*
 * Reusable FC-style card renderer for Community Builds.
 * It renders only trusted local build data and escaped catalog metadata.
 */
window.BuildCard = (function () {
  'use strict';

  const GAME_ASSET_ROOT = 'https://game-assets.fut.gg/';
  const GAME_ASSET_TRANSFORM = 'cdn-cgi/image/quality=88,format=auto';
  const CATEGORY_STATS = Object.freeze([
    ['pace', 'PAC'],
    ['scoring', 'SHO'],
    ['passing', 'PAS'],
    ['ball_control', 'DRI'],
    ['defending', 'DEF'],
    ['physical', 'PHY'],
  ]);
  let renderSequence = 0;

  const esc = (value) => String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character]),
  );

  function singleLine(value) {
    return typeof value === 'string'
      ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
      : '';
  }

  function isValidCardName(value) {
    const name = singleLine(value);
    return Array.from(name).length >= 1
      && Array.from(name).length <= 15
      && (name.match(/ /g) || []).length <= 2;
  }

  function safeCardName(value, fallback = 'PLAYER') {
    const normalized = singleLine(value);
    if (isValidCardName(normalized)) return normalized;
    const words = normalized.split(' ').filter(Boolean).slice(0, 3);
    let shortened = words.join(' ');
    while (Array.from(shortened).length > 15 && words.length > 1) {
      words.shift();
      shortened = words.join(' ');
    }
    shortened = Array.from(shortened).slice(0, 15).join('').trim();
    return isValidCardName(shortened) ? shortened : fallback;
  }

  function assetUrl(path, width = 300) {
    const value = singleLine(path);
    if (!value) return '';
    const isGameAsset = /^https:\/\/game-assets\.fut\.gg(?:\/|$)/i.test(value);
    if (/^https?:\/\//i.test(value) && !isGameAsset) return '';
    const relative = value.replace(/^https:\/\/game-assets\.fut\.gg\//i, '').replace(/^\/+/, '');
    if (relative.startsWith('cdn-cgi/image/')) return `${GAME_ASSET_ROOT}${relative}`;
    const safeWidth = Math.max(40, Math.min(800, Math.round(+width || 300)));
    return `${GAME_ASSET_ROOT}${GAME_ASSET_TRANSFORM},width=${safeWidth}/${relative}`;
  }

  function catalogItems(catalog, collection) {
    const value = catalog && catalog[collection];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
  }

  function itemId(item) {
    if (!item || typeof item !== 'object') return '';
    return String(item.id ?? item.value ?? item.slug ?? '');
  }

  function catalogItem(catalog, collection, id) {
    const safeId = String(id == null ? '' : id);
    if (!safeId) return null;
    return catalogItems(catalog, collection).find((item) => itemId(item) === safeId) || null;
  }

  function itemName(item, fallback = '') {
    return singleLine(item && (item.name || item.label || item.displayName)) || fallback;
  }

  function itemAsset(item, width = 100) {
    if (!item) return '';
    return assetUrl(
      item.imagePath
      || item.assetPath
      || item.logoPath
      || item.iconPath
      || item.image
      || item.logo
      || '',
      width,
    );
  }

  function safeColor(value, fallback) {
    const color = singleLine(value);
    if (/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return `#${color}`;
    return /^(?:#[0-9a-f]{3,8}|rgb(?:a)?\([\d\s.,%]+\)|hsl(?:a)?\([\d\s.,%deg]+\))$/i.test(color)
      ? color
      : fallback;
  }

  function colorCandidate(item, keys) {
    for (const key of keys) {
      if (item && typeof item[key] === 'string') return item[key];
      if (item && Array.isArray(item[key]) && typeof item[key][0] === 'string') return item[key][0];
      if (item && item.colors && typeof item.colors[key] === 'string') return item.colors[key];
    }
    return '';
  }

  function colorAt(item, key, index = 0) {
    if (!item) return '';
    if (Array.isArray(item[key]) && typeof item[key][index] === 'string') return item[key][index];
    if (item.colors && Array.isArray(item.colors[key]) && typeof item.colors[key][index] === 'string') {
      return item.colors[key][index];
    }
    return '';
  }

  function rarityPaletteIndex(rarity) {
    if (!rarity) return 0;
    const paths = Array.isArray(rarity.imagePaths) ? rarity.imagePaths : [];
    const selected = singleLine(rarity.imagePath);
    const exact = paths.findIndex((path) => singleLine(path) === selected);
    if (exact >= 0) return exact;
    const level = selected.match(/rarities-level-(\d+)-/i);
    return level && +level[1] > 0 ? Math.max(0, +level[1] - 1) : 0;
  }

  function indexedColor(item, key, index, fallback = '') {
    return colorAt(item, key, index) || colorAt(item, key, 0) || colorCandidate(item, [key]) || fallback;
  }

  function rarityTheme(rarity) {
    const name = itemName(rarity, 'Gold').toLowerCase();
    let surface = '#d8c879';
    let border = '#f6e8a6';
    let ink = '#17170f';
    let accent = '#725e1f';

    if (/silver/.test(name)) {
      surface = '#bec4c6'; border = '#f0f3f4'; ink = '#15191a'; accent = '#4b565a';
    } else if (/bronze/.test(name)) {
      surface = '#ad744e'; border = '#e2ad80'; ink = '#20130d'; accent = '#62391f';
    } else if (/icon/.test(name)) {
      surface = '#e9e2cf'; border = '#fffaf0'; ink = '#332b1c'; accent = '#977b3c';
    } else if (/hero/.test(name)) {
      surface = '#39235e'; border = '#cf68ff'; ink = '#fff'; accent = '#f6cc4a';
    } else if (/toty|team of the year/.test(name)) {
      surface = '#10216f'; border = '#58c7ff'; ink = '#fff'; accent = '#ffd96b';
    } else if (/tots|team of the season/.test(name)) {
      surface = '#092b51'; border = '#3df0d0'; ink = '#fff'; accent = '#ffdf59';
    } else if (/inform|week|champion/.test(name)) {
      surface = '#16191b'; border = '#d9c783'; ink = '#fff'; accent = '#e3cc66';
    } else if (/evolution/.test(name)) {
      surface = '#4a1769'; border = '#ff82f3'; ink = '#fff'; accent = '#63f1c5';
    }

    const paletteIndex = rarityPaletteIndex(rarity);
    const text = safeColor(indexedColor(rarity, 'textColor', paletteIndex), ink);
    const fill = safeColor(indexedColor(rarity, 'lineColor', paletteIndex), surface);
    return {
      paletteIndex,
      fill,
      border: safeColor(indexedColor(rarity, 'lineColor', paletteIndex), border),
      text,
      overall: safeColor(indexedColor(rarity, 'overallColor', paletteIndex), text),
      position: safeColor(indexedColor(rarity, 'positionColor', paletteIndex), text),
      accent: fill || safeColor(colorCandidate(rarity, ['accentColor', 'accent', 'tertiary']), accent),
      shadow: safeColor(indexedColor(rarity, 'shadowColor', paletteIndex), '#000000'),
      bright: !!(rarity && rarity.isBrightColorScheme),
    };
  }

  function primaryPosition(info) {
    const positions = Array.isArray(info && info.positions) ? info.positions : [];
    return positions[0] || (info && info.derived && info.derived.arch && info.derived.arch.position === 'GK' ? 'GK' : '—');
  }

  function cardOverall(info) {
    const primary = primaryPosition(info);
    const overalls = info && info.overalls || {};
    if (Number.isFinite(+overalls[primary])) return +overalls[primary];
    const values = Object.values(overalls).filter((value) => Number.isFinite(+value)).map(Number);
    return values.length ? Math.max(...values) : 0;
  }

  function categoryStats(info) {
    const overalls = info && info.derived && info.derived.categoryOveralls || {};
    return CATEGORY_STATS.map(([id, label]) => ({
      id,
      label,
      value: Number.isFinite(+overalls[id]) ? +overalls[id] : 0,
    }));
  }

  function metadataValue(metadata, camel, snake) {
    if (!metadata) return '';
    return metadata[camel] ?? metadata[snake] ?? '';
  }

  function normalizedMetadata(metadata) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    return {
      version: 1,
      athleteName: safeCardName(metadataValue(source, 'athleteName', 'athlete_name')),
      utPlayerId: String(metadataValue(source, 'utPlayerId', 'ut_player_id') || ''),
      utPlayerEaId: String(metadataValue(source, 'utPlayerEaId', 'ut_player_ea_id') || ''),
      athleteImagePath: singleLine(metadataValue(source, 'athleteImagePath', 'athlete_image_path')),
      rarityId: String(metadataValue(source, 'rarityId', 'rarity_id') || ''),
      leagueId: String(metadataValue(source, 'leagueId', 'league_id') || ''),
      clubId: String(metadataValue(source, 'clubId', 'club_id') || ''),
      nationId: String(metadataValue(source, 'nationId', 'nation_id') || ''),
    };
  }

  function identityBadge(item, fallback, className, bright = false) {
    const alternatePath = bright && item && (
      item.imageLightPath
      || item.lightImagePath
      || item.logoLightPath
    );
    const image = alternatePath ? assetUrl(alternatePath, 80) : itemAsset(item, 80);
    const name = itemName(item, fallback);
    if (image) {
      return `<span class="fc-card-identity ${esc(className)}" title="${esc(name)}"><img src="${esc(image)}" alt="${esc(name)}" loading="lazy" referrerpolicy="no-referrer" /></span>`;
    }
    return `<span class="fc-card-identity ${esc(className)}" title="${esc(name)}"><b>${esc((name || fallback).slice(0, 3).toUpperCase())}</b></span>`;
  }

  function playstyleGlyph(item) {
    const localIcon = singleLine(item && item.icon).replace('/plus/', '/');
    return /^(?:\.\/)?playstyles\/[a-z0-9-]+\.png$/i.test(localIcon) ? localIcon : '';
  }

  function renderPlaystyles(playstyles, serial) {
    const source = (Array.isArray(playstyles) ? playstyles : []).filter((item) => item && item.icon);
    const signatures = source.filter((item) => item.signature);
    const items = (signatures.length ? signatures : source.filter((item) => item.plus)).slice(0, 4);
    return items.map((item, index) => {
      const glyph = playstyleGlyph(item);
      if (!glyph) return '';
      const locked = !item.plus;
      const filterId = `fc-playstyle-${serial}-${index}`;
      return `
        <span class="fc-card-playstyle ${locked ? 'is-locked' : 'is-plus'}"
          title="${esc(item.name || 'PlayStyle')}${item.plus ? '+' : ''}">
          <svg class="fc-card-playstyle-diamond" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            <path d="M12.813,104.953L68.157,21.862H188.143l55.045,83.091L128,235.138Z" />
          </svg>
          <svg class="fc-card-playstyle-glyph" viewBox="0 0 70 70" aria-hidden="true" focusable="false">
            <defs>
              <filter id="${filterId}" color-interpolation-filters="sRGB">
                <feColorMatrix in="SourceGraphic" type="matrix"
                  values="0 0 0 0 0
                          0 0 0 0 0
                          0 0 0 0 0
                         -0.2126 -0.7152 -0.0722 1 0" result="glyph-mask" />
                <feFlood flood-color="var(--fc-playstyle-ink)" result="glyph-color" />
                <feComposite in="glyph-color" in2="glyph-mask" operator="in" />
              </filter>
            </defs>
            <image href="${esc(glyph)}" width="70" height="70" filter="url(#${filterId})" />
          </svg>
        </span>`;
    }).join('');
  }

  function classifyAthleteArt(image) {
    const wrapper = image && image.closest && image.closest('.fc-card-art');
    if (!wrapper || !image.naturalWidth || !image.naturalHeight) return;
    wrapper.classList.toggle('is-dynamic', image.naturalHeight / image.naturalWidth > 1.15);
    wrapper.classList.add('is-ready');
  }

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('load', (event) => {
      if (event.target && event.target.matches && event.target.matches('.fc-card-art img')) {
        classifyAthleteArt(event.target);
      }
    }, true);
  }

  function render(options = {}) {
    const serial = ++renderSequence;
    const info = options.info || {};
    const metadata = normalizedMetadata(options.metadata);
    const catalog = options.catalog || {};
    const rarity = catalogItem(catalog, 'rarities', metadata.rarityId);
    const league = catalogItem(catalog, 'leagues', metadata.leagueId);
    const club = catalogItem(catalog, 'clubs', metadata.clubId);
    const nation = catalogItem(catalog, 'nations', metadata.nationId);
    const theme = rarityTheme(rarity);
    const positions = Array.isArray(info.positions) ? info.positions.slice(0, 5) : [];
    const primary = primaryPosition(info);
    const alternatives = positions.filter((position) => position !== primary);
    const image = assetUrl(metadata.athleteImagePath, 420);
    const frame = itemAsset(rarity, 420);
    const stars = info.derived && info.derived.effective || {};
    const skillMoves = Math.max(1, Math.min(5, Math.round(+stars.skill_moves || 0)));
    const weakFoot = Math.max(1, Math.min(5, Math.round(+stars.weak_foot || 0)));
    const stats = categoryStats(info);
    const style = [
      `--fc-fill:${theme.fill}`,
      `--fc-border:${theme.border}`,
      `--fc-ink:${theme.text}`,
      `--fc-overall:${theme.overall}`,
      `--fc-position:${theme.position}`,
      `--fc-accent:${theme.accent}`,
      `--fc-shadow:${theme.shadow}`,
    ].join(';');
    const accessibleName = `${metadata.athleteName}, ${cardOverall(info)} overall, ${positions.join(', ') || primary}`;

    return `
      <div class="fc-card" data-rarity="${esc(itemName(rarity, metadata.rarityId || 'custom'))}"
        data-rarity-tier="${theme.paletteIndex}" style="${esc(style)}"
        role="img" aria-label="${esc(accessibleName)}">
        <div class="fc-card-surface">
          ${frame ? `<img class="fc-card-frame" src="${esc(frame)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
          <div class="fc-card-art is-dynamic">
            ${image
              ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : '<span class="fc-card-art-placeholder" aria-hidden="true">◇</span>'}
          </div>
          <strong class="fc-card-name">${esc(metadata.athleteName)}</strong>
          <div class="fc-card-rating">
            <strong>${cardOverall(info) || '—'}</strong>
            <span>${esc(primary)}</span>
          </div>
          <div class="fc-card-alt-positions" aria-label="Alternative positions">
            ${alternatives.map((position) => `<span>${esc(position)}</span>`).join('')}
          </div>
          <div class="fc-card-side-meta" aria-label="Strong foot, Skill Moves and Weak Foot">
            <span>R</span>
            <span><b>${skillMoves}</b><i>★</i><b>${weakFoot}</b></span>
          </div>
          <div class="fc-card-stats">
            ${stats.map((stat) => `<span><small>${stat.label}</small><b>${stat.value || '—'}</b></span>`).join('')}
          </div>
          <div class="fc-card-identities">
            ${identityBadge(nation, metadata.nationId || 'NAT', 'is-nation', false)}
            ${identityBadge(league, metadata.leagueId || 'LG', 'is-league', theme.bright)}
            ${identityBadge(club, metadata.clubId || 'CLB', 'is-club', theme.bright)}
          </div>
          <div class="fc-card-playstyles" aria-label="Signature PlayStyles">
            ${renderPlaystyles(options.playstyles, serial)}
          </div>
        </div>
      </div>`;
  }

  return Object.freeze({
    assetUrl,
    cardOverall,
    categoryStats,
    catalogItem,
    catalogItems,
    isValidCardName,
    normalizedMetadata,
    render,
    safeCardName,
  });
})();
