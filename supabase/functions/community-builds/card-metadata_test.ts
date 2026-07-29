import {
  CARD_CATALOG,
  CardMetadataError,
  sanitizeCardMetadata,
} from "./card-metadata.ts";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertCardRejected(
  value: unknown,
  expected: RegExp,
): void {
  let error: unknown;
  try {
    sanitizeCardMetadata(value);
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof CardMetadataError, "expected CardMetadataError");
  assert(expected.test(error.message), `unexpected error: ${error.message}`);
}

function validCard(): Record<string, unknown> {
  const [leagueId, clubIds] = Object.entries(CARD_CATALOG.clubsByLeague)
    .find(([, ids]) => Array.isArray(ids) && ids.length > 0) ?? [];
  const player = CARD_CATALOG.players[0];
  const rarity = CARD_CATALOG.rarities[0];
  const nation = CARD_CATALOG.nations[0];
  assert(player, "catalog must contain a player");
  assert(rarity, "catalog must contain a rarity");
  assert(nation, "catalog must contain a nation");
  assert(leagueId && clubIds?.[0], "catalog must contain a league with a club");
  return {
    version: 1,
    athleteName: "  Alex   Morgan ",
    utPlayerId: player.id,
    utPlayerEaId: player.eaId,
    athleteImagePath: player.playerImagePath,
    rarityId: rarity.id,
    leagueId,
    clubId: clubIds[0],
    nationId: nation.id,
  };
}

Deno.test("accepts catalog-backed card metadata and normalizes public values", () => {
  const input = validCard();
  input.utPlayerId = String(input.utPlayerId);
  input.utPlayerEaId = String(input.utPlayerEaId);
  const card = sanitizeCardMetadata(input);
  assert(card !== null);
  assert(card.version === 1);
  assert(card.athleteName === "Alex Morgan");
  assert(typeof card.utPlayerId === "number");
  assert(typeof card.utPlayerEaId === "number");
  assert(typeof card.rarityId === "string");
  assert(typeof card.leagueId === "string");
  assert(typeof card.clubId === "string");
  assert(typeof card.nationId === "string");
});

Deno.test("keeps missing card metadata compatible with legacy publications", () => {
  assert(sanitizeCardMetadata(undefined) === null);
  assert(sanitizeCardMetadata(null) === null);
});

Deno.test("enforces the athlete name character and space limits", () => {
  const tooLong = validCard();
  tooLong.athleteName = "1234567890123456";
  assertCardRejected(tooLong, /between 1 and 15/u);

  const tooManySpaces = validCard();
  tooManySpaces.athleteName = "A B C D";
  assertCardRejected(tooManySpaces, /at most two spaces/u);

  const cleaned = validCard();
  cleaned.athleteName = "  Ada\tLovelace<script> ";
  assertCardRejected(cleaned, /between 1 and 15/u);
});

Deno.test("requires an exact catalog player and image pairing", () => {
  const unknownPlayer = validCard();
  unknownPlayer.utPlayerId = Number(unknownPlayer.utPlayerId) + 10_000_000;
  assertCardRejected(unknownPlayer, /does not exist/u);

  const wrongImage = validCard();
  const otherPlayer = CARD_CATALOG.players.find((player) =>
    player.playerImagePath !== wrongImage.athleteImagePath
  );
  assert(otherPlayer, "catalog must contain two different player images");
  wrongImage.athleteImagePath = otherPlayer.playerImagePath;
  assertCardRejected(wrongImage, /does not belong/u);

  const unsafeImage = validCard();
  unsafeImage.athleteImagePath = "../player.webp";
  assertCardRejected(unsafeImage, /safe relative image path/u);
});

Deno.test("validates rarity, nation and league-club dependencies", () => {
  const unknownRarity = validCard();
  unknownRarity.rarityId = "999999999999999";
  assertCardRejected(unknownRarity, /rarityId does not exist/u);

  const unknownNation = validCard();
  unknownNation.nationId = "999999999999999";
  assertCardRejected(unknownNation, /nationId does not exist/u);

  const entries = Object.entries(CARD_CATALOG.clubsByLeague)
    .filter(([, clubIds]) => clubIds.length > 0);
  const first = entries[0];
  const second = entries.find(([, clubIds]) =>
    !clubIds.map(String).includes(String(first[1][0]))
  );
  assert(
    first && second,
    "catalog must contain two distinct league club lists",
  );
  const wrongLeague = validCard();
  wrongLeague.leagueId = second[0];
  wrongLeague.clubId = first[1][0];
  assertCardRejected(wrongLeague, /does not belong/u);
});

Deno.test("rejects unsupported versions, missing fields and unknown fields", () => {
  const wrongVersion = validCard();
  wrongVersion.version = 2;
  assertCardRejected(wrongVersion, /version must be 1/u);

  const missing = validCard();
  delete missing.nationId;
  assertCardRejected(missing, /missing or unsupported/u);

  const extra = validCard();
  extra.imageUrl = "https://example.test/player.webp";
  assertCardRejected(extra, /missing or unsupported/u);
});
