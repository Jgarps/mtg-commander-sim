const assert = require('assert');
const { Simulator } = require('../app');

function makeDeckWithCommander(name, commanderName, cmdCost = 1) {
  return {
    name,
    commander: commanderName,
    commanderDetails: { name: commanderName, type: 'threat', cost: cmdCost, power: 3 },
    cards: [],
  };
}

async function run() {
  console.log('Commander recast test: start');
  const deckA = makeDeckWithCommander('Deck A', 'CmdA', 1);
  const deckB = makeDeckWithCommander('Deck B', 'CmdB', 1);
  const sim = new Simulator(deckA, deckB, () => {});
  const player = sim.players[0];
  const opp = sim.players[1];

  // Cast from command zone twice and ensure tax increments
  const cmdCard1 = { name: player.commander, type: 'threat', cost: player.commanderDetails.cost, power: player.commanderDetails.power, source: 'command' };
  sim.resolveSpell(cmdCard1, player, opp);
  assert.strictEqual(player.commanderTimesCasted, 1, 'times cast should be 1 after first cast');
  // Simulate commander dies and returns
  const idx = player.battlefield.findIndex((c) => c.isCommander);
  if (idx >= 0) player.battlefield.splice(idx, 1);
  player.commandZone = { name: player.commander };

  const cmdCard2 = { name: player.commander, type: 'threat', cost: player.commanderDetails.cost + 2, power: player.commanderDetails.power, source: 'command' };
  sim.resolveSpell(cmdCard2, player, opp);
  assert.strictEqual(player.commanderTimesCasted, 2, 'times cast should be 2 after second cast');

  // tax should now be 4
  assert.strictEqual(2 * player.commanderTimesCasted, 4, 'tax should be 4 after two casts');

  console.log('Commander recast test: passed');
}

run().catch((e) => { console.error('Commander recast test: FAILED', e); process.exitCode = 2; });
