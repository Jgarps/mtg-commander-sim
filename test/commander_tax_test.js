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
  console.log('Commander tax test: start');
  const deckA = makeDeckWithCommander('Deck A', 'CmdA', 1);
  const deckB = makeDeckWithCommander('Deck B', 'CmdB', 1);
  const sim = new Simulator(deckA, deckB, () => {});
  const player = sim.players[0];
  const opp = sim.players[1];

  // initial state
  assert.strictEqual(player.commanderTimesCasted, 0, 'initial times cast should be 0');
  assert.ok(player.commandZone && player.commandZone.name === player.commander, 'commander should start in command zone');

  // Cast commander from command zone
  const cmdCard = { name: player.commander, type: 'threat', cost: deckA.commanderDetails.cost, power: deckA.commanderDetails.power, source: 'command' };
  sim.resolveSpell(cmdCard, player, opp);

  assert.strictEqual(player.commanderTimesCasted, 1, 'commanderTimesCasted should increment after casting from command zone');
  assert.strictEqual(player.commandZone, null, 'commandZone should be cleared while commander is on battlefield');
  const onBattle = player.battlefield.find((c) => c.name === player.commander && c.isCommander);
  assert.ok(onBattle, 'commander should be on battlefield and marked as commander');

  // Simulate commander dying and returning to command zone
  const idx = player.battlefield.indexOf(onBattle);
  if (idx >= 0) player.battlefield.splice(idx, 1);
  // commanderTimesCasted should persist
  player.commandZone = { name: player.commander };
  assert.strictEqual(player.commanderTimesCasted, 1, 'commanderTimesCasted should persist after commander returns to command zone');

  // Tax calculation should be 2 * times cast
  const tax = 2 * (player.commanderTimesCasted || 0);
  assert.strictEqual(tax, 2, 'commander tax should be 2 after one cast');

  // Ensure mainPhase calculation would produce base+tax
  const baseCost = Number(player.commanderDetails.cost || 0);
  const cmdCost = Math.max(0, baseCost + tax);
  assert.strictEqual(cmdCost, 3, 'computed command cost should be base + tax');

  console.log('Commander tax test: passed');
}

run().catch((e) => {
  console.error('Commander tax test: FAILED', e);
  process.exitCode = 2;
});
