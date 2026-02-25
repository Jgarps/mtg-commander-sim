const { spawnSync } = require('child_process');
const path = require('path');

const tests = [
  'test/commander_tax_test.js',
  'test/exile_test.js',
  'test/mulligan_test.js',
  'test/commander_recast_test.js',
  'test/multi_block_test.js',
  'test/smoke.js',
];

console.log('Running test suite:', tests.join(', '));
let failures = 0;
for (const t of tests) {
  console.log('\n--- Running', t, '---');
  const res = spawnSync(process.execPath, [path.resolve(t)], { stdio: 'inherit' });
  if (res.error) {
    console.error('Failed to spawn test:', res.error);
    failures += 1;
    continue;
  }
  if (res.status !== 0) {
    console.error(`Test ${t} failed with exit code ${res.status}`);
    failures += 1;
  } else {
    console.log(`Test ${t} passed`);
  }
}

console.log('\nTest suite finished. Failures:', failures);
process.exitCode = failures > 0 ? 1 : 0;
