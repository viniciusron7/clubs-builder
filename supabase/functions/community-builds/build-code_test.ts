import { BuildCodeError, sanitizeBuildCode } from "./build-code.ts";
import { GAME_CALC } from "./game-rules.ts";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

function decode(value: string): Record<string, unknown> {
  let base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  while (base64.length % 4) base64 += "=";
  return JSON.parse(atob(base64)) as Record<string, unknown>;
}

function assertRejected(
  value: unknown,
  expected = /current game rules/u,
): void {
  let error: unknown;
  try {
    sanitizeBuildCode(encode(value));
  } catch (caught) {
    error = caught;
  }
  assert(error instanceof BuildCodeError, "expected a BuildCodeError");
  assert(expected.test(error.message), `unexpected error: ${error.message}`);
}

Deno.test("canonicalizes a valid v2 build and removes unknown top-level fields", () => {
  const result = sanitizeBuildCode(encode({
    v: 2,
    a: "mid_creator",
    l: 100,
    h: 180,
    w: 75,
    ig: 1,
    t: { vision: 99, agility: 80 },
    po: ["CAM", "CM"],
    ignored: "<script>",
  }));
  assert(result.archetypeId === "mid_creator");
  assert(result.level === 100);
  assert(result.positions.join(",") === "CAM,CM");
  assert(decode(result.code).ig === 1);

  const second = sanitizeBuildCode(result.code);
  assert(second.code === result.code, "canonical code must be stable");
});

Deno.test("preserves valid player and AI Facilities with their shared club budget", () => {
  const result = sanitizeBuildCode(encode({
    v: 2,
    a: "mid_creator",
    l: 1,
    c: 10,
    h: 180,
    w: 75,
    f: { equipment_manager: 1 },
    af: { ai_gk_goalkeeping_coach: 1 },
    po: ["CAM"],
  }));
  const canonical = decode(result.code);
  assert(canonical.c === 10);
  assert(!("ig" in canonical));
  assert(
    JSON.stringify(canonical.f) === JSON.stringify({ equipment_manager: 1 }),
  );
  assert(
    JSON.stringify(canonical.af) ===
      JSON.stringify({ ai_gk_goalkeeping_coach: 1 }),
  );
});

Deno.test("rejects unknown, invalid and over-budget Facilities", () => {
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 1,
    c: 1,
    h: 180,
    w: 75,
    f: { unknown: 1 },
  }, /unsupported keys/u);
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 1,
    c: 1,
    h: 180,
    w: 75,
    af: { ai_gk_goalkeeping_coach: 4 },
  }, /invalid/u);
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 1,
    c: 1,
    h: 180,
    w: 75,
    f: { equipment_manager: 3 },
  });
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 1,
    c: 1,
    h: 180,
    w: 75,
    f: { equipment_manager: 2 },
    af: { ai_gk_goalkeeping_coach: 2 },
  });
});

Deno.test("normalizes goalkeeper position", () => {
  const result = sanitizeBuildCode(encode({
    v: 2,
    a: "gk_shot_stopper",
    l: 1,
    h: 190,
    w: 90,
  }));
  assert(result.positions.length === 1 && result.positions[0] === "GK");
});

Deno.test("rejects invalid versions, archetypes, ranges and nested keys", () => {
  const invalid = [
    { v: 1, a: "mid_creator", l: 1, h: 180, w: 75 },
    { v: 2, a: "unknown", l: 1, h: 180, w: 75 },
    { v: 2, a: "mid_creator", l: 101, h: 180, w: 75 },
    { v: 2, a: "mid_creator", l: 1, h: 200, w: 75 },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, t: { hacked: 99 } },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, t: { skill_moves: 1 } },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, p: ["hacked"] },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, ig: 0 },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, ig: true },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, ig: "1" },
    { v: 2, a: "mid_creator", l: 1, h: 180, w: 75, ig: 2 },
  ];
  for (const value of invalid) {
    let rejected = false;
    try {
      sanitizeBuildCode(encode(value));
    } catch (error) {
      rejected = error instanceof BuildCodeError;
    }
    assert(rejected, `expected rejection: ${JSON.stringify(value)}`);
  }
});

Deno.test("rejects a level-one build that normalization must reduce", () => {
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 1,
    h: 180,
    w: 75,
    t: {
      vision: 99,
      short_passing: 96,
      long_passing: 96,
    },
    po: ["CAM"],
  });
});

Deno.test("rejects an AP-over-budget build even at valid attribute maxima", () => {
  const archetype = GAME_CALC.archetype("mid_creator");
  assert(archetype, "mid_creator must exist");
  const attributes = Object.fromEntries(
    GAME_CALC.baseCategories(archetype).flatMap((category) =>
      category.attributes.map((attribute) => [
        attribute.id,
        attribute.maxValue,
      ])
    ),
  );

  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 100,
    h: 180,
    w: 75,
    t: attributes,
    po: ["CAM"],
  });
});

Deno.test("rejects more equipped PlayStyles than the current level unlocks", () => {
  assertRejected({
    v: 2,
    a: "def_boss",
    l: 1,
    h: 188,
    w: 90,
    t: { aggression: 80, interceptions: 80, sliding_tackle: 75 },
    p: ["intercept", "slide_tackle"],
    po: ["CB"],
  });
});

Deno.test("rejects unmet PlayStyle and specialization requirements", () => {
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 100,
    h: 180,
    w: 75,
    p: ["finesse_shot"],
    po: ["CAM"],
  });
  assertRejected({
    v: 2,
    a: "mid_creator",
    l: 100,
    h: 180,
    w: 75,
    s: { 0: "creator_plus" },
    po: ["CAM"],
  });
});

Deno.test("accepts a semantically valid build and removes redundant base values", () => {
  const result = sanitizeBuildCode(encode({
    v: 2,
    a: "def_boss",
    l: 1,
    h: 188,
    w: 90,
    t: { aggression: 80, sliding_tackle: 75 },
    p: ["slide_tackle"],
    po: ["CB"],
  }));
  const canonical = decode(result.code);

  assert(result.archetypeId === "def_boss");
  assert(result.level === 1);
  assert(result.positions.join(",") === "CB");
  assert(
    JSON.stringify(canonical.t) === JSON.stringify({ aggression: 80 }),
    "base-value attributes should be structurally canonicalized away",
  );
  assert(
    sanitizeBuildCode(result.code).code === result.code,
    "valid canonical code must be stable",
  );
});
