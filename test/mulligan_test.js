const assert = require('assert');
const { Simulator } = require('../app');

function makeDeck(name) {
  // simple deck with many lands so draws are deterministic
  const cards = [];
  for (let i = 0; i < 40; i++) cards.push({ name: 'Plains', count: 1, type: 'land', cost: 0 });
  for (let i = 0; i < 20; i++) cards.push({ name: 'Small Threat', count: 1, type: 'threat', cost: 2, power: 2 });
  return { name, commander: 'Cmd', commanderDetails: { name: 'Cmd', cost: 3, power: 3 }, cards };
}

async function run() {
  console.log('Mulligan test: start');
  const sim = new Simulator(makeDeck('A'), makeDeck('B'), () => {});
  const p = sim.players[0];
  // ensure starting hand size was drawn
  assert.strictEqual(p.hand.length, 7, 'initial hand should be 7');
  // perform 2 mulligans (draw 7 each time, then put 2 cards to bottom total)
  sim.mulligan(p, 1); // first mulligan: put 1 card back
  assert.ok(p.hand.length >= 6 && p.hand.length <= 7, 'hand after 1 mulligan should be 6-7');
  sim.mulligan(p, 2); // second mulligan: put 2 cards back
  assert.ok(p.hand.length >= 5 && p.hand.length <= 7, 'hand after 2 mulligans should be 5-7');
  console.log('Mulligan test: passed');
}

run().catch((e) => { console.error('Mulligan test: FAILED', e); process.exitCode = 2; });
