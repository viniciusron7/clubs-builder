import rawCatalog from "../../../data/ut_card_catalog.json" with {
  type: "json",
};

export const CARD_METADATA_VERSION = 1 as const;

type PlainObject = Record<string, unknown>;
type CatalogId = string | number;

export type CardCatalogPlayer = {
  id: number;
  eaId: number;
  name: string;
  cardName: string;
  height: number;
  weight: number;
  playerImagePath: string;
  positions: string[];
  nationId: CatalogId;
  leagueId: CatalogId;
  clubId: CatalogId | null;
  rarityId: CatalogId;
};

export type CardCatalog = {
  version: number;
  idType: string;
  players: CardCatalogPlayer[];
  rarities: Array<{ id: CatalogId; name: string }>;
  nations: Array<{ id: CatalogId; name: string }>;
  leagues: Array<{ id: CatalogId; name: string }>;
  clubs: Array<{ id: CatalogId; name: string; leagueId: CatalogId }>;
  clubsByLeague: Record<string, CatalogId[]>;
};

export type CardMetadata = {
  version: typeof CARD_METADATA_VERSION;
  athleteName: string;
  utPlayerId: number;
  utPlayerEaId: number;
  athleteImagePath: string;
  rarityId: string;
  leagueId: string;
  clubId: string;
  nationId: string;
};

export class CardMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardMetadataError";
  }
}

export const CARD_CATALOG = rawCatalog as unknown as CardCatalog;

const CARD_KEYS = new Set([
  "version",
  "athleteName",
  "utPlayerId",
  "utPlayerEaId",
  "athleteImagePath",
  "rarityId",
  "leagueId",
  "clubId",
  "nationId",
]);
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

function isObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function catalogId(value: unknown, label: string): string {
  if (
    typeof value === "number" && Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }
  if (
    typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value) &&
    Number(value) <= MAX_SAFE_ID
  ) {
    return value;
  }
  throw new CardMetadataError(`${label} is not a valid catalog id.`);
}

function positiveSafeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]{0,15}$/u.test(value)
    ? Number(value)
    : value;
  if (
    typeof parsed !== "number" || !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    throw new CardMetadataError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function safeImagePath(value: unknown): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:avif|jpe?g|png|webp)$/u.test(value) ||
    value.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) {
    throw new CardMetadataError(
      "athleteImagePath must be a safe relative image path.",
    );
  }
  return value;
}

function athleteName(value: unknown): string {
  if (typeof value !== "string") {
    throw new CardMetadataError("athleteName must be text.");
  }
  const normalized = value
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069<>]/gu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim();
  const length = Array.from(normalized).length;
  const spaces =
    Array.from(normalized).filter((character) => character === " ").length;
  if (length < 1 || length > 15) {
    throw new CardMetadataError(
      "athleteName must contain between 1 and 15 characters.",
    );
  }
  if (spaces > 2) {
    throw new CardMetadataError(
      "athleteName may contain at most two spaces.",
    );
  }
  return normalized;
}

function catalogConfigurationError(message: string): never {
  throw new Error(`Invalid UT card catalog: ${message}`);
}

if (
  CARD_CATALOG.version !== CARD_METADATA_VERSION ||
  CARD_CATALOG.idType !== "eaId" ||
  !Array.isArray(CARD_CATALOG.players) ||
  !Array.isArray(CARD_CATALOG.rarities) ||
  !Array.isArray(CARD_CATALOG.nations) ||
  !Array.isArray(CARD_CATALOG.leagues) ||
  !Array.isArray(CARD_CATALOG.clubs) ||
  !isObject(CARD_CATALOG.clubsByLeague)
) {
  catalogConfigurationError("unsupported shape or version");
}

const playersByPair = new Map<string, CardCatalogPlayer>();
for (const player of CARD_CATALOG.players) {
  if (
    !Number.isSafeInteger(player.id) || player.id < 1 ||
    !Number.isSafeInteger(player.eaId) || player.eaId < 1
  ) {
    catalogConfigurationError("a player id is invalid");
  }
  const imagePath = safeImagePath(player.playerImagePath);
  const key = `${player.id}:${player.eaId}`;
  if (playersByPair.has(key)) {
    catalogConfigurationError(`duplicate player pair ${key}`);
  }
  playersByPair.set(key, { ...player, playerImagePath: imagePath });
}

function catalogIdSet(
  values: Array<{ id: CatalogId }>,
  label: string,
): ReadonlySet<string> {
  const result = new Set<string>();
  for (const item of values) {
    const id = catalogId(item.id, `${label}.id`);
    if (result.has(id)) {
      catalogConfigurationError(`duplicate ${label} id ${id}`);
    }
    result.add(id);
  }
  if (!result.size) catalogConfigurationError(`${label} is empty`);
  return result;
}

const rarityIds = catalogIdSet(CARD_CATALOG.rarities, "rarity");
const nationIds = catalogIdSet(CARD_CATALOG.nations, "nation");
const leagueIds = catalogIdSet(CARD_CATALOG.leagues, "league");
const clubIds = catalogIdSet(CARD_CATALOG.clubs, "club");
const clubIdsByLeague = new Map<string, ReadonlySet<string>>();

for (
  const [rawLeagueId, rawClubIds] of Object.entries(
    CARD_CATALOG.clubsByLeague,
  )
) {
  const leagueId = catalogId(rawLeagueId, "clubsByLeague.leagueId");
  if (!leagueIds.has(leagueId) || !Array.isArray(rawClubIds)) {
    catalogConfigurationError(`invalid club list for league ${leagueId}`);
  }
  const clubs = new Set<string>();
  for (const rawClubId of rawClubIds) {
    const clubId = catalogId(rawClubId, "clubsByLeague.clubId");
    if (!clubIds.has(clubId)) {
      catalogConfigurationError(`unknown club ${clubId}`);
    }
    clubs.add(clubId);
  }
  clubIdsByLeague.set(leagueId, clubs);
}

export function sanitizeCardMetadata(value: unknown): CardMetadata | null {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new CardMetadataError("card must be an object.");
  }
  const keys = Object.keys(value);
  if (
    keys.length !== CARD_KEYS.size ||
    keys.some((key) => !CARD_KEYS.has(key))
  ) {
    throw new CardMetadataError(
      "card contains missing or unsupported fields.",
    );
  }
  if (value.version !== CARD_METADATA_VERSION) {
    throw new CardMetadataError(
      `card.version must be ${CARD_METADATA_VERSION}.`,
    );
  }

  const sanitized: CardMetadata = {
    version: CARD_METADATA_VERSION,
    athleteName: athleteName(value.athleteName),
    utPlayerId: positiveSafeInteger(value.utPlayerId, "utPlayerId"),
    utPlayerEaId: positiveSafeInteger(value.utPlayerEaId, "utPlayerEaId"),
    athleteImagePath: safeImagePath(value.athleteImagePath),
    rarityId: catalogId(value.rarityId, "rarityId"),
    leagueId: catalogId(value.leagueId, "leagueId"),
    clubId: catalogId(value.clubId, "clubId"),
    nationId: catalogId(value.nationId, "nationId"),
  };

  const player = playersByPair.get(
    `${sanitized.utPlayerId}:${sanitized.utPlayerEaId}`,
  );
  if (!player) {
    throw new CardMetadataError(
      "The selected UT player does not exist in the card catalog.",
    );
  }
  if (sanitized.athleteImagePath !== player.playerImagePath) {
    throw new CardMetadataError(
      "athleteImagePath does not belong to the selected UT player.",
    );
  }
  if (!rarityIds.has(sanitized.rarityId)) {
    throw new CardMetadataError("rarityId does not exist in the card catalog.");
  }
  if (!nationIds.has(sanitized.nationId)) {
    throw new CardMetadataError("nationId does not exist in the card catalog.");
  }
  if (!leagueIds.has(sanitized.leagueId)) {
    throw new CardMetadataError("leagueId does not exist in the card catalog.");
  }
  const leagueClubs = clubIdsByLeague.get(sanitized.leagueId);
  if (!leagueClubs?.has(sanitized.clubId)) {
    throw new CardMetadataError(
      "clubId does not belong to the selected league.",
    );
  }

  return sanitized;
}
