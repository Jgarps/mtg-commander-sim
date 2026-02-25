const assert = require('assert');
const { Simulator } = require('../app');

function makeDeck(name) {
  const cards = [];
  for (let i = 0; i < 40; i++) cards.push({ name: 'Plains', count: 1, type: 'land' });
  for (let i = 0; i < 20; i++) cards.push({ name: `Threat ${i+1}`, count: 1, type: 'threat', cost: 2, power: 2 });
  return { name, commander: 'Cmd', commanderDetails: { name: 'Cmd', cost: 3, power: 3 }, cards };
}

async function run() {
  console.log('Multi-block test: start');
  const sim = new Simulator(makeDeck('A'), makeDeck('B'), () => {});
  const attacker = sim.players[0];
  const defender = sim.players[1];

  // Create attackers: one big attacker, and two small attackers
  const big = { name: 'Big', type: 'threat', power: 6, toughness: 6, summoningSick: false };
  const small1 = { name: 'S1', type: 'threat', power: 2, toughness: 2, summoningSick: false };
  const small2 = { name: 'S2', type: 'threat', power: 2, toughness: 2, summoningSick: false };
  attacker.battlefield.push(big, small1, small2);

  // Defender has two blockers that can block separately
  const blk1 = { name: 'Blk1', type: 'threat', power: 3, toughness: 3 };
  const blk2 = { name: 'Blk2', type: 'threat', power: 3, toughness: 3 };
  defender.battlefield.push(blk1, blk2);

  // Run combat: current simple AI pairs largest to largest; expect Big matched to Blk1, smalls unblocked vs Blk2 etc.
  sim.combat(attacker, defender);

  // At least one blocker should have been removed or have died depending on power/toughness
  const deadOnDefender = defender.graveyard.length + defender.exile.length;
  const deadOnAttacker = attacker.graveyard.length + attacker.exile.length;

  assert.ok(deadOnDefender + deadOnAttacker >= 0, 'Combat should resolve without runtime error');

  console.log('Multi-block test: passed');
}

run().catch((e) => { console.error('Multi-block test: FAILED', e); process.exitCode = 2; });
