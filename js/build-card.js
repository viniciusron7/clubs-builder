/*
 * Reusable FC-style card renderer for Community Builds.
 * It renders only trusted local build data and escaped catalog metadata.
 */
window.BuildCard = (function () {
  'use strict';

  const GAME_ASSET_ROOT = 'https://game-assets.fut.gg/';
  const CATEGORY_STATS = Object.freeze([
    ['pace', 'PAC'],
    ['scoring', 'SHO'],
    ['passing', 'PAS'],
    ['ball_control', 'DRI'],
    ['defending', 'DEF'],
    ['physical', 'PHY'],
  ]);

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

  function assetUrl(path) {
    const value = singleLine(path);
    if (!value) return '';
    if (/^https:\/\/game-assets\.fut\.gg(?:\/|$)/i.test(value)) return value;
    if (/^https?:\/\//i.test(value)) return '';
    return `${GAME_ASSET_ROOT}${value.replace(/^\/+/, '')}`;
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

  function itemAsset(item) {
    if (!item) return '';
    return assetUrl(
      item.imagePath
      || item.assetPath
      || item.logoPath
      || item.iconPath
      || item.image
      || item.logo
      || '',
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

    return {
      surface: safeColor(colorCandidate(rarity, ['backgroundColor', 'background', 'primary', 'dominantColor']), surface),
      border: safeColor(colorCandidate(rarity, ['borderColor', 'border', 'secondary', 'lineColor']), border),
      ink: safeColor(colorCandidate(rarity, ['textColor', 'text', 'foreground']), ink),
      accent: safeColor(colorCandidate(rarity, ['accentColor', 'accent', 'tertiary', 'overallColor']), accent),
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

  function identityBadge(item, fallback, className) {
    const image = itemAsset(item);
    const name = itemName(item, fallback);
    if (image) {
      return `<span class="fc-card-identity ${esc(className)}" title="${esc(name)}"><img src="${esc(image)}" alt="${esc(name)}" loading="lazy" /></span>`;
    }
    return `<span class="fc-card-identity ${esc(className)}" title="${esc(name)}"><b>${esc((name || fallback).slice(0, 3).toUpperCase())}</b></span>`;
  }

  function renderPlaystyles(playstyles) {
    const items = (Array.isArray(playstyles) ? playstyles : []).filter((item) => item && item.icon).slice(0, 13);
    if (!items.length) return '<span class="fc-card-no-playstyles">No PlayStyles</span>';
    return items.map((item) => `
      <span class="fc-card-playstyle ${item.plus ? 'is-plus' : ''}" title="${esc(item.name || 'PlayStyle')}${item.plus ? '+' : ''}">
        <img src="${esc(item.icon)}" alt="" loading="lazy" />
      </span>`).join('');
  }

  function render(options = {}) {
    const info = options.info || {};
    const metadata = normalizedMetadata(options.metadata);
    const catalog = options.catalog || {};
    const rarity = catalogItem(catalog, 'rarities', metadata.rarityId);
    const league = catalogItem(catalog, 'leagues', metadata.leagueId);
    const club = catalogItem(catalog, 'clubs', metadata.clubId);
    const nation = catalogItem(catalog, 'nations', metadata.nationId);
    const theme = rarityTheme(rarity);
    const positions = Array.isArray(info.positions) ? info.positions.slice(0, 4) : [];
    const primary = primaryPosition(info);
    const alternatives = positions.filter((position) => position !== primary);
    const image = assetUrl(metadata.athleteImagePath);
    const frame = itemAsset(rarity);
    const stars = info.derived && info.derived.effective || {};
    const skillMoves = Math.max(1, Math.min(5, Math.round(+stars.skill_moves || 0)));
    const weakFoot = Math.max(1, Math.min(5, Math.round(+stars.weak_foot || 0)));
    const stats = categoryStats(info);
    const style = [
      `--fc-surface:${theme.surface}`,
      `--fc-border:${theme.border}`,
      `--fc-ink:${theme.ink}`,
      `--fc-accent:${theme.accent}`,
    ].join(';');
    const accessibleName = `${metadata.athleteName}, ${cardOverall(info)} overall, ${positions.join(', ') || primary}`;

    return `
      <div class="fc-card" data-rarity="${esc(itemName(rarity, metadata.rarityId || 'custom'))}" style="${esc(style)}"
        role="img" aria-label="${esc(accessibleName)}">
        <div class="fc-card-surface">
          ${frame ? `<img class="fc-card-frame" src="${esc(frame)}" alt="" loading="lazy" />` : ''}
          <span class="fc-card-cut is-one" aria-hidden="true"></span>
          <span class="fc-card-cut is-two" aria-hidden="true"></span>
          <div class="fc-card-rating">
            <strong>${cardOverall(info) || '—'}</strong>
            <span>${esc(primary)}</span>
          </div>
          <div class="fc-card-alt-positions" aria-label="Alternative positions">
            ${alternatives.map((position) => `<span>${esc(position)}</span>`).join('')}
          </div>
          <div class="fc-card-art">
            ${image
              ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
              : '<span class="fc-card-art-placeholder" aria-hidden="true">◇</span>'}
          </div>
          <div class="fc-card-details">
            <strong class="fc-card-name">${esc(metadata.athleteName)}</strong>
            <div class="fc-card-stats">
              ${stats.map((stat) => `<span><b>${stat.value || '—'}</b><small>${stat.label}</small></span>`).join('')}
            </div>
            <div class="fc-card-meta">
              <span><b>${weakFoot}</b><small>WF</small></span>
              <span><b>${skillMoves}</b><small>SM</small></span>
              <span class="fc-card-identities">
                ${identityBadge(nation, metadata.nationId || 'NAT', 'is-nation')}
                ${identityBadge(league, metadata.leagueId || 'LG', 'is-league')}
                ${identityBadge(club, metadata.clubId || 'CLB', 'is-club')}
              </span>
            </div>
            <div class="fc-card-playstyles" aria-label="PlayStyles">
              ${renderPlaystyles(options.playstyles)}
            </div>
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
