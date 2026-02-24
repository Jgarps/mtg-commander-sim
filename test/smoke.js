const { Simulator } = require('../app');

function makeSimpleDeck(name, commanderName) {
  // 36 lands, 24 threats of varying cost
  const cards = [];
  for (let i = 0; i < 36; i++) cards.push({ name: 'Plains', count: 1, type: 'land', cost: 0, power: 0 });
  for (let i = 0; i < 12; i++) cards.push({ name: `Small Threat ${i+1}`, count: 1, type: 'threat', cost: 2, power: 2 });
  for (let i = 0; i < 8; i++) cards.push({ name: `Big Threat ${i+1}`, count: 1, type: 'threat', cost: 5, power: 5 });
  for (let i = 0; i < 4; i++) cards.push({ name: `Ramp ${i+1}`, count: 1, type: 'ramp', cost: 2, power: 0 });

  return {
    name,
    commander: commanderName,
    commanderDetails: { name: commanderName, type: 'threat', cost: 4, power: 4 },
    cards: cards.map((c) => ({ name: c.name, count: c.count, type: c.type, cost: c.cost, power: c.power })),
  };
}

async function runBatch(runs = 10) {
  let wins = { A: 0, B: 0 };
  for (let i = 0; i < runs; i++) {
    const deckA = makeSimpleDeck('Deck A', 'Commander A');
    const deckB = makeSimpleDeck('Deck B', 'Commander B');
    const aRoll = Math.floor(Math.random() * 20) + 1;
    const bRoll = Math.floor(Math.random() * 20) + 1;
    const starting = aRoll > bRoll ? 0 : 1;
    const sim = new Simulator(deckA, deckB, () => {}, starting);
    let ticks = 0;
    while (!sim.gameOver && ticks < 2000) {
      sim.tick();
      ticks += 1;
    }
    const winner = sim.winner?.id || 'none';
    wins[winner] = (wins[winner] || 0) + 1;
    console.log(`Run ${i+1}/${runs} finished in ${ticks} ticks - winner: ${winner}`);
    // brief yield
    await new Promise((r) => setTimeout(r, 0));
  }
  console.log('Batch results:', wins);
}

runBatch(10).catch((e) => { console.error('Smoke run failed', e); process.exit(1); });
