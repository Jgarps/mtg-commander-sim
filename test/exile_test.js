const assert = require('assert');
const { Simulator } = require('../app');

function makeSimpleDeck(name, commanderName) {
  return {
    name,
    commander: commanderName,
    commanderDetails: { name: commanderName, type: 'threat', cost: 1, power: 1 },
    cards: [],
  };
}

async function run() {
  console.log('Exile test: start');
  const deckA = makeSimpleDeck('Deck A', 'CmdA');
  const deckB = makeSimpleDeck('Deck B', 'CmdB');
  const sim = new Simulator(deckA, deckB, () => {});
  const player = sim.players[0];
  const opponent = sim.players[1];

  // Place a threat on opponent battlefield
  const threat = { name: 'Big Threat', type: 'threat', power: 5, toughness: 5 };
  opponent.battlefield.push(threat);

  // Cast a removal that exiles
  const removal = { name: 'Surgical Exile', type: 'removal', cost: 1, exiles: true };
  sim.resolveSpell(removal, player, opponent);

  // Check exile
  assert.strictEqual(opponent.exile.length, 1, 'Opponent should have 1 card in exile');
  assert.strictEqual(opponent.exile[0].name, 'Big Threat', 'Exiled card should be the threat');

  console.log('Exile test: passed');
}

run().catch((e) => { console.error('Exile test FAILED', e); process.exitCode = 2; });
