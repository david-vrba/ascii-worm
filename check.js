// check.js — sanity check for worm-core: the worm stays on screen, roams it, and comes back after a resize.
// Run: node check.js
const assert = require('assert');
const { createWorm, advance, render, screen, wormColors, COLORS } = require('./worm-core.js');

// The head counts as on screen while some of it is visible: its centre may skim past the edge by up to one body radius.
const SKIM = 0.075;
function headInside(worm, cols, rows) {
  const { width, height } = screen(cols, rows);
  const [x, y] = worm.path[worm.path.length - 1];
  return x >= -SKIM && x <= width + SKIM && y >= -SKIM && y <= height + SKIM;
}

for (const [cols, rows] of [[160, 45], [80, 24], [60, 50], [240, 70]]) {
  const worm = createWorm(cols, rows);
  const seen = new Uint8Array(cols * rows);
  let samples = 0;
  let inside = 0;
  for (let frame = 0; frame < 30 * 180; frame++) {
    advance(worm, 1 / 30, cols, rows);
    if (frame % 10) continue;
    const { levels } = render([worm], cols, rows);
    const lit = levels.reduce((n, level) => n + (level > 0), 0);
    assert(lit > cols * rows * 0.03, `${cols}x${rows}: worm vanished (${lit} cells lit)`);
    levels.forEach((level, i) => level && (seen[i] = 1));
    samples++;
    inside += headInside(worm, cols, rows);
  }
  const coverage = seen.reduce((n, v) => n + v, 0) / seen.length;
  console.log(`${cols}x${rows}: head on screen ${((100 * inside) / samples).toFixed(1)}%, screen covered ${(100 * coverage).toFixed(0)}%`);
  assert(inside / samples > 0.99, 'head leaves the screen too often');
  assert(coverage > 0.6, 'worm does not roam the screen');
}

// Shrink the terminal under the worm: the head must find its way back on screen.
const worm = createWorm(240, 70);
for (let i = 0; i < 30 * 20; i++) advance(worm, 1 / 30, 240, 70);
let back = false;
for (let i = 0; i < 30 * 10 && !back; i++) {
  advance(worm, 1 / 30, 70, 20);
  back = headInside(worm, 70, 20);
}
assert(back, 'head did not return after the terminal shrank');
console.log('resize: head returns on screen');

// Three worms must each stay on screen too.
const trio = [0, 1, 2].map((i) => createWorm(160, 45, i));
let trioInside = 0;
for (let i = 0; i < 30 * 120; i++) {
  trio.forEach((w) => advance(w, 1 / 30, 160, 45));
  trioInside += trio.every((w) => headInside(w, 160, 45));
}
assert(trioInside / (30 * 120) > 0.97, 'one of three worms leaves the screen too often');
const trioFrame = render(trio, 160, 45);
assert.deepStrictEqual(new Set(trioFrame.owners.filter((_, i) => trioFrame.levels[i])), new Set([0, 1, 2]), 'not all three worms are drawn');
console.log(`three worms: all heads on screen ${((100 * trioInside) / (30 * 120)).toFixed(1)}%`);

// Colours: names, hex with or without #, lists that repeat, and a clear error for typos.
assert.deepStrictEqual(wormColors('', 3), [COLORS.red, COLORS.purple, COLORS.cyan]);
assert.deepStrictEqual(wormColors('Purple', 2), [COLORS.purple, COLORS.purple]);
assert.deepStrictEqual(wormColors('red,#00ff80', 3), [COLORS.red, [0, 255, 128], COLORS.red]);
assert.throws(() => wormColors('purpel', 1), /unknown colour "purpel"/);
console.log('colours: names, hex and lists parse');
console.log('check passed');
