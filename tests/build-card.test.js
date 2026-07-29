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

test('renderer escapes metadata and includes build-specific positions, stars and PlayStyles', () => {
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
      rarities: [{ id: 1, name: 'Rare', dominantColor: 'dd9c79', textColor: ['3e281c'], lineColor: ['f4ca91'] }],
      leagues: [{ id: 13, name: 'Premier League' }],
      clubs: [{ id: 1, name: 'Arsenal' }],
      nations: [{ id: 14, name: 'England' }],
    },
    playstyles: [{ name: 'Quick Step', icon: 'playstyles/quick-step.png', plus: true }],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /92/);
  assert.match(html, /ST/);
  assert.match(html, /CAM/);
  assert.match(html, />4<.*WF/s);
  assert.match(html, />5<.*SM/s);
  assert.match(html, /quick-step\.png/);
  assert.match(html, /Premier League/);
});
