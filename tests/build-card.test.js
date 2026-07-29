const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { window: {} };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.resolve(__dirname, '../js/build-card.js'), 'utf8'),
  context,
  { filename: 'js/build-card.js' },
);

const Card = context.window.BuildCard;

test('card names enforce the FC display limit', () => {
  assert.equal(Card.isValidCardName('Alex Morgan'), true);
  assert.equal(Card.isValidCardName('One Two Three'), true);
  assert.equal(Card.isValidCardName('One Two Three Four'), false);
  assert.equal(Card.isValidCardName('1234567890123456'), false);
  assert.equal(Card.safeCardName('Very Long Athlete Name'), 'Long Athlete');
});

test('card overall follows the primary selected position and stats use category OVRs', () => {
  const info = {
    positions: ['CAM', 'CM'],
    overalls: { CAM: 93, CM: 94 },
    derived: {
      categoryOveralls: {
        pace: 84,
        scoring: 91,
        passing: 96,
        ball_control: 95,
        defending: 82,
        physical: 85,
      },
      effective: { skill_moves: 5, weak_foot: 4 },
    },
  };
  assert.equal(Card.cardOverall(info), 93);
  assert.deepEqual(
    JSON.parse(JSON.stringify(Card.categoryStats(info))),
    [
      { id: 'pace', label: 'PAC', value: 84 },
      { id: 'scoring', label: 'SHO', value: 91 },
      { id: 'passing', label: 'PAS', value: 96 },
      { id: 'ball_control', label: 'DRI', value: 95 },
      { id: 'defending', label: 'DEF', value: 82 },
      { id: 'physical', label: 'PHY', value: 85 },
    ],
  );
});

test('FUT.GG assets use the image proxy without leaking the builder referrer', () => {
  assert.equal(
    Card.assetUrl('2026/player-item/player.webp', 420),
    'https://game-assets.fut.gg/cdn-cgi/image/quality=88,format=auto,width=420/2026/player-item/player.webp',
  );
  assert.equal(Card.assetUrl('https://example.com/player.png'), '');
});

test('renderer escapes metadata and includes build-specific positions, stars and signature PlayStyles', () => {
  const html = Card.render({
    info: {
      positions: ['ST', 'CAM'],
      overalls: { ST: 92, CAM: 91 },
      derived: {
        categoryOveralls: {
          pace: 90, scoring: 94, passing: 86, ball_control: 91, defending: 45, physical: 84,
        },
        effective: { skill_moves: 5, weak_foot: 4 },
      },
    },
    metadata: {
      version: 1,
      athleteName: '<script>',
      athleteImagePath: '2026/player-item/player.webp',
      rarityId: '1',
      leagueId: '13',
      clubId: '1',
      nationId: '14',
    },
    catalog: {
      rarities: [{
        id: 1,
        name: 'Rare',
        dominantColor: 'dd9c79',
        textColor: ['3e281c', '1e252a', '2d2410'],
        lineColor: ['dd9c79', 'bfccd1', 'e1b866'],
        imagePath: '2026/rarities-level-3-large/1.png',
        imagePaths: [
          '2026/rarities-level-1-large/1.png',
          '2026/rarities-level-2-large/1.png',
          '2026/rarities-level-3-large/1.png',
        ],
        isBrightColorScheme: true,
      }],
      leagues: [{
        id: 13,
        name: 'Premier League',
        imagePath: '2026/league/13.png',
        imageLightPath: '2026/league-light/13.png',
      }],
      clubs: [{
        id: 1,
        name: 'Arsenal',
        imagePath: '2026/club/1.png',
        lightImagePath: '2026/club-light/1.png',
      }],
      nations: [{ id: 14, name: 'England', imagePath: '2026/nation/14.png' }],
    },
    playstyles: [
      { id: 'quick_step', name: 'Quick Step', icon: 'playstyles/plus/quick-step.png', signature: true, plus: true },
      { id: 'rapid', name: 'Rapid', icon: 'playstyles/rapid.png', plus: false },
    ],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /92/);
  assert.match(html, /ST/);
  assert.match(html, /CAM/);
  assert.match(html, /Strong foot, Skill Moves and Weak Foot/);
  assert.match(html, /<b>5<\/b><i>★<\/i><b>4<\/b>/);
  assert.match(html, /playstyles\/quick-step\.png/);
  assert.doesNotMatch(html, /title="Rapid/);
  assert.match(html, /Premier League/);
  assert.match(html, /--fc-fill:#e1b866/);
  assert.match(html, /--fc-ink:#2d2410/);
  assert.match(html, /data-rarity-tier="2"/);
  assert.match(html, /cdn-cgi\/image\/quality=88,format=auto,width=420\/2026\/rarities-level-3-large\/1\.png/);
  assert.match(html, /cdn-cgi\/image\/quality=88,format=auto,width=80\/2026\/league-light\/13\.png/);
  assert.match(html, /cdn-cgi\/image\/quality=88,format=auto,width=80\/2026\/club-light\/1\.png/);
  assert.match(html, /referrerpolicy="no-referrer"/);
});

test('card front caps the signature rail at four and does not render regular PlayStyles', () => {
  const signatures = Array.from({ length: 5 }, (_, index) => ({
    id: `signature_${index}`,
    name: `Signature ${index}`,
    icon: 'playstyles/quick-step.png',
    signature: true,
    plus: index < 3,
  }));
  const html = Card.render({
    info: {
      positions: ['CAM'],
      overalls: { CAM: 90 },
      derived: {
        categoryOveralls: {},
        effective: { skill_moves: 4, weak_foot: 3 },
      },
    },
    metadata: { athleteName: 'Player' },
    playstyles: signatures.concat({
      id: 'rapid',
      name: 'Rapid',
      icon: 'playstyles/rapid.png',
      plus: false,
    }),
  });
  assert.equal((html.match(/class="fc-card-playstyle /g) || []).length, 4);
  assert.equal((html.match(/class="fc-card-playstyle is-plus"/g) || []).length, 3);
  assert.equal((html.match(/class="fc-card-playstyle is-locked"/g) || []).length, 1);
  assert.doesNotMatch(html, /title="Rapid/);
});
