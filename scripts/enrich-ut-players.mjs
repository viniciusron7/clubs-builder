#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const PLAYERS_PATH = path.join(ROOT_DIR, 'data', 'ut_players_80.json');
const CATALOG_PATH = path.join(ROOT_DIR, 'data', 'ut_card_catalog.json');

const DEFINITION_ENDPOINT = 'https://www.fut.gg/api/fut/players/v2/definition-data/';
const CARD_ENDPOINT = 'https://www.fut.gg/api/fut/26/player-items/';
const BATCH_SIZE = 50;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 20_000;
const RETRY_BASE_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const supported = new Set(['--dry-run']);
  for (const argument of argv) {
    if (!supported.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { dryRun: argv.includes('--dry-run') };
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function requestUrl(endpoint, parameter, values) {
  const url = new URL(endpoint);
  url.searchParams.set(parameter, values.join(','));
  return url;
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchJson(url, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`${label}: HTTP ${response.status}`);
        error.retryable = retryableStatus(response.status);
        throw error;
      }
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.data)) {
        const error = new Error(`${label}: response does not contain a data array`);
        error.retryable = true;
        throw error;
      }
      return payload.data;
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError'
        || error instanceof TypeError
        || error.retryable === true;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(RETRY_BASE_MS * (2 ** (attempt - 1)) + jitter);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts`, { cause: lastError });
}

async function fetchBatches(batches, makeUrl, label) {
  const results = new Array(batches.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < batches.length) {
      const index = nextIndex++;
      results[index] = await fetchJson(makeUrl(batches[index]), `${label} batch ${index + 1}`);
      completed++;
      if (completed === batches.length || completed % 10 === 0) {
        process.stdout.write(`${label}: ${completed}/${batches.length} batches\n`);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(CONCURRENCY, batches.length) },
    () => worker(),
  ));
  return results.flat();
}

function playerSlug(player) {
  if (typeof player.url !== 'string') return '';
  const parts = player.url.split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function characterLength(value) {
  return Array.from(value).length;
}

function validCardName(value) {
  const normalized = cleanText(value);
  return normalized.length > 0
    && characterLength(normalized) <= 15
    && (normalized.match(/ /gu) || []).length <= 2;
}

function sliceCharacters(value, length) {
  return Array.from(value).slice(0, length).join('');
}

function fallbackCardName(player, definition, cardDefinition) {
  const name = cleanText(player.name);
  const candidates = [
    cardDefinition && cardDefinition.cardName,
    definition.nickname,
    definition.lastName,
    definition.commonName,
    name,
  ].map(cleanText).filter(Boolean);
  const valid = candidates.find(validCardName);
  if (valid) return valid;

  const tokens = name.split(' ').filter(Boolean);
  const shortGroups = [
    tokens.at(-1),
    tokens.slice(-2).join(' '),
    tokens.slice(0, 2).join(' '),
  ].map(cleanText).filter(Boolean);
  const validGroup = shortGroups.find(validCardName);
  if (validGroup) return validGroup;

  const compact = cleanText((tokens.at(-1) || name).replace(/\s+/gu, ''));
  const fallback = sliceCharacters(compact || `Player${player.eaId}`, 15);
  if (!validCardName(fallback)) {
    throw new Error(`Could not create a valid card name for player ${player.eaId}`);
  }
  return fallback;
}

function numericId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return id;
}

function nullableNumericId(value, label) {
  return value == null ? null : numericId(value, label);
}

function assetPath(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/^\/+/u, '') : '';
  if (!normalized || normalized.includes('..') || /^https?:/iu.test(normalized)) return null;
  return normalized;
}

function assetPaths(values) {
  if (!Array.isArray(values)) return [];
  return values.map(assetPath).filter(Boolean);
}

function colors(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => cleanText(value)).filter(Boolean);
}

function addCatalogEntry(map, entry, kind) {
  const previous = map.get(entry.id);
  if (!previous) {
    map.set(entry.id, entry);
    return;
  }
  if (JSON.stringify(previous) !== JSON.stringify(entry)) {
    throw new Error(`Conflicting ${kind} metadata for EA ID ${entry.id}`);
  }
}

function catalogNation(nation) {
  return {
    id: numericId(nation.eaId, 'Nation EA ID'),
    name: cleanText(nation.name),
    slug: cleanText(nation.slug),
    imagePath: assetPath(nation.imagePath),
  };
}

function catalogLeague(league) {
  return {
    id: numericId(league.eaId, 'League EA ID'),
    name: cleanText(league.name),
    slug: cleanText(league.slug),
    nationId: nullableNumericId(league.nationEaId, 'League nation EA ID'),
    imagePath: assetPath(league.imagePath),
    imageLightPath: assetPath(league.imageLightPath),
  };
}

function catalogClub(club) {
  return {
    id: numericId(club.eaId, 'Club EA ID'),
    name: cleanText(club.name),
    slug: cleanText(club.slug),
    leagueId: nullableNumericId(club.leagueEaId, 'Club league EA ID'),
    isWomen: !!club.isWomen,
    isIconClub: !!club.isIconClub,
    imagePath: assetPath(club.imagePath),
    lightImagePath: assetPath(club.lightImagePath),
  };
}

function catalogRarity(rarity) {
  return {
    id: numericId(rarity.eaId, 'Rarity EA ID'),
    name: cleanText(rarity.name),
    slug: cleanText(rarity.slug),
    isSpecial: !!rarity.isSpecial,
    isBrightColorScheme: !!rarity.isBrightColorScheme,
    dominantColor: cleanText(rarity.dominantColor) || null,
    textColor: colors(rarity.textColor),
    lineColor: colors(rarity.lineColor),
    shadowColor: colors(rarity.shadowColor),
    overallColor: cleanText(rarity.overallColor) || null,
    imagePath: assetPath(rarity.imagePath),
    imagePaths: assetPaths(rarity.imagePaths),
    compactImagePath: assetPath(rarity.compactImagePath),
  };
}

function sortedEntries(map) {
  return [...map.values()].sort((left, right) => left.id - right.id);
}

function validateInput(players) {
  if (!Array.isArray(players) || !players.length) {
    throw new Error('The UT player dataset must be a non-empty array');
  }
  const ids = new Set();
  const eaIds = new Set();
  const slugs = new Set();
  for (const player of players) {
    const id = numericId(player.id, 'Player ID');
    const eaId = numericId(player.eaId, 'Player EA ID');
    const slug = playerSlug(player);
    if (!/^26-[0-9]+$/u.test(slug)) throw new Error(`Invalid FUT.GG slug for player ${eaId}`);
    if (ids.has(id)) throw new Error(`Duplicate player ID ${id}`);
    if (eaIds.has(eaId)) throw new Error(`Duplicate player EA ID ${eaId}`);
    if (slugs.has(slug)) throw new Error(`Duplicate player slug ${slug}`);
    ids.add(id);
    eaIds.add(eaId);
    slugs.add(slug);
  }
}

function validateOutput(players, catalog, originalOrder) {
  if (players.length !== originalOrder.length) throw new Error('Player count changed during enrichment');
  if (players.some((player, index) => player.id !== originalOrder[index])) {
    throw new Error('Player order changed during enrichment');
  }

  const nationIds = new Set(catalog.nations.map((item) => item.id));
  const leagueIds = new Set(catalog.leagues.map((item) => item.id));
  const clubIds = new Set(catalog.clubs.map((item) => item.id));
  const rarityIds = new Set(catalog.rarities.map((item) => item.id));
  const playerEaIds = new Set();

  for (const player of players) {
    if (playerEaIds.has(player.eaId)) throw new Error(`Duplicate enriched EA ID ${player.eaId}`);
    playerEaIds.add(player.eaId);
    if (!Number.isInteger(player.height) || player.height < 100 || player.height > 250) {
      throw new Error(`Invalid height for player ${player.eaId}`);
    }
    if (!Number.isInteger(player.weight) || player.weight < 30 || player.weight > 200) {
      throw new Error(`Invalid weight for player ${player.eaId}`);
    }
    if (!assetPath(player.playerImagePath)) throw new Error(`Invalid player image for ${player.eaId}`);
    if (!validCardName(player.cardName)) throw new Error(`Invalid card name for ${player.eaId}`);
    if (!nationIds.has(player.nationId)) throw new Error(`Unknown nation for player ${player.eaId}`);
    if (!leagueIds.has(player.leagueId)) throw new Error(`Unknown league for player ${player.eaId}`);
    if (player.clubId !== null && !clubIds.has(player.clubId)) {
      throw new Error(`Unknown club for player ${player.eaId}`);
    }
    if (!rarityIds.has(player.rarityId)) throw new Error(`Unknown rarity for player ${player.eaId}`);
  }

  for (const club of catalog.clubs) {
    if (club.leagueId !== null && !leagueIds.has(club.leagueId)) {
      throw new Error(`Unknown league ${club.leagueId} for club ${club.id}`);
    }
  }
  for (const [leagueId, linkedClubIds] of Object.entries(catalog.clubsByLeague)) {
    if (!leagueIds.has(Number(leagueId))) throw new Error(`Unknown league index ${leagueId}`);
    for (const clubId of linkedClubIds) {
      const club = catalog.clubs.find((item) => item.id === clubId);
      if (!club || club.leagueId !== Number(leagueId)) {
        throw new Error(`Invalid club ${clubId} in league index ${leagueId}`);
      }
    }
  }
}

async function prepareAtomicWrite(filePath, text) {
  let current = null;
  try {
    current = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current === text) return null;
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, text, 'utf8');
  return temporaryPath;
}

async function commitAtomicWrites(writes) {
  try {
    for (const write of writes) {
      if (write.temporaryPath) await rename(write.temporaryPath, write.filePath);
    }
  } catch (error) {
    await Promise.all(writes.map(async (write) => {
      if (!write.temporaryPath) return;
      try { await unlink(write.temporaryPath); } catch {}
    }));
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const players = JSON.parse(await readFile(PLAYERS_PATH, 'utf8'));
  validateInput(players);
  const originalOrder = players.map((player) => player.id);

  const slugBatches = chunks(players.map(playerSlug), BATCH_SIZE);
  const eaIdBatches = chunks(players.map((player) => player.eaId), BATCH_SIZE);
  process.stdout.write(`Enriching ${players.length} UT players in ${slugBatches.length} batches.\n`);

  const [definitions, cardDefinitions] = await Promise.all([
    fetchBatches(
      slugBatches,
      (batch) => requestUrl(DEFINITION_ENDPOINT, 'slugs', batch),
      'Definitions',
    ),
    fetchBatches(
      eaIdBatches,
      (batch) => requestUrl(CARD_ENDPOINT, 'ids', batch),
      'Card names',
    ),
  ]);

  const definitionsBySlug = new Map();
  for (const definition of definitions) {
    if (!definition || typeof definition.slug !== 'string') continue;
    if (definitionsBySlug.has(definition.slug)) {
      throw new Error(`Duplicate definition for slug ${definition.slug}`);
    }
    definitionsBySlug.set(definition.slug, definition);
  }
  const cardsByEaId = new Map();
  for (const cardDefinition of cardDefinitions) {
    const eaId = Number(cardDefinition && cardDefinition.eaId);
    if (!Number.isSafeInteger(eaId)) continue;
    if (cardsByEaId.has(eaId)) throw new Error(`Duplicate card definition for EA ID ${eaId}`);
    cardsByEaId.set(eaId, cardDefinition);
  }

  const missingDefinitions = players.filter((player) => !definitionsBySlug.has(playerSlug(player)));
  const missingCards = players.filter((player) => !cardsByEaId.has(player.eaId));
  if (missingDefinitions.length || missingCards.length) {
    throw new Error(
      `Incomplete FUT.GG response: ${missingDefinitions.length} definitions and ${missingCards.length} card names missing`,
    );
  }

  const nations = new Map();
  const leagues = new Map();
  const clubs = new Map();
  const rarities = new Map();

  const enriched = players.map((player) => {
    const definition = definitionsBySlug.get(playerSlug(player));
    const cardDefinition = cardsByEaId.get(player.eaId);
    if (!definition.nation || !definition.league || !definition.rarity) {
      throw new Error(`Player ${player.eaId} is missing nation, league, or rarity metadata`);
    }
    addCatalogEntry(nations, catalogNation(definition.nation), 'nation');
    addCatalogEntry(leagues, catalogLeague(definition.league), 'league');
    addCatalogEntry(rarities, catalogRarity(definition.rarity), 'rarity');
    if (definition.club) addCatalogEntry(clubs, catalogClub(definition.club), 'club');

    const height = Math.round(Number(definition.height));
    const weight = Math.round(Number(definition.weight));
    const nationId = numericId(definition.nation.eaId, 'Player nation EA ID');
    const leagueId = numericId(definition.league.eaId, 'Player league EA ID');
    const clubId = definition.club
      ? numericId(definition.club.eaId, 'Player club EA ID')
      : null;
    const rarityId = numericId(definition.rarity.eaId, 'Player rarity EA ID');
    const playerImagePath = assetPath(definition.imagePath);
    if (!playerImagePath) throw new Error(`Player ${player.eaId} is missing a valid portrait`);

    return {
      ...player,
      cardName: fallbackCardName(player, definition, cardDefinition),
      height,
      weight,
      playerImagePath,
      nationId,
      leagueId,
      clubId,
      rarityId,
    };
  });

  const catalogClubs = sortedEntries(clubs);
  const clubsByLeague = {};
  for (const club of catalogClubs) {
    if (club.leagueId === null) continue;
    const key = String(club.leagueId);
    if (!clubsByLeague[key]) clubsByLeague[key] = [];
    clubsByLeague[key].push(club.id);
  }

  const catalogPlayers = enriched.map((player) => ({
    id: player.id,
    eaId: player.eaId,
    name: player.name,
    cardName: player.cardName,
    height: player.height,
    weight: player.weight,
    playerImagePath: player.playerImagePath,
    positions: player.positions,
    nationId: player.nationId,
    leagueId: player.leagueId,
    clubId: player.clubId,
    rarityId: player.rarityId,
  }));
  const catalog = {
    version: 1,
    idType: 'eaId',
    source: {
      players: 'data/ut_players_80.json',
      definitionEndpoint: DEFINITION_ENDPOINT,
      cardEndpoint: CARD_ENDPOINT,
      playerCount: enriched.length,
    },
    players: catalogPlayers,
    rarities: sortedEntries(rarities),
    nations: sortedEntries(nations),
    leagues: sortedEntries(leagues),
    clubs: catalogClubs,
    clubsByLeague,
  };

  validateOutput(enriched, catalog, originalOrder);

  const playersText = JSON.stringify(enriched);
  const catalogText = JSON.stringify(catalog);
  process.stdout.write(
    `Validated ${enriched.length} players, ${catalog.rarities.length} rarities, `
    + `${catalog.nations.length} nations, ${catalog.leagues.length} leagues, `
    + `${catalog.clubs.length} clubs.\n`,
  );

  if (options.dryRun) {
    process.stdout.write('Dry run complete; no files were written.\n');
    return;
  }

  const writes = [
    {
      filePath: PLAYERS_PATH,
      temporaryPath: await prepareAtomicWrite(PLAYERS_PATH, playersText),
    },
    {
      filePath: CATALOG_PATH,
      temporaryPath: await prepareAtomicWrite(CATALOG_PATH, catalogText),
    },
  ];
  await commitAtomicWrites(writes);
  const changed = writes.filter((write) => write.temporaryPath).map((write) => path.relative(ROOT_DIR, write.filePath));
  process.stdout.write(changed.length ? `Updated ${changed.join(', ')}.\n` : 'Files are already up to date.\n');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
