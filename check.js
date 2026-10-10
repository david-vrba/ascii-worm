// check.js — sanity check for worm-core: worms stay fully on screen, roam it, keep apart,
// survive tiny and zero sizes, come back after a resize, and colours parse. Run: node check.js
const assert = require('assert');
const { RADIUS, createWorms, advanceAll, render, screen, wormColors, COLORS } = require('./worm-core.js');

// Distance from the closest point of a worm's centre line to the nearest screen edge, in screen units.
function edgeGap(worm, cols, rows) {
  const { width, height } = screen(cols, rows);
  return Math.min(...worm.path.map(([x, y]) => Math.min(x, width - x, y, height - y)));
}

// The body counts as cut when the edge hides more than 40% of the tube's width.
function bodyCut(worm, cols, rows) {
  return edgeGap(worm, cols, rows) < 0.6 * RADIUS * worm.size;
}

function headGap(worm, cols, rows) {
  const { width, height } = screen(cols, rows);
  const [x, y] = worm.path[worm.path.length - 1];
  return Math.min(x, width - x, y, height - y);
}

for (const [cols, rows] of [[160, 45], [80, 24], [60, 50], [240, 70]]) {
  for (const count of [1, 3]) {
    const worms = createWorms(cols, rows, count);
    const seen = new Uint8Array(cols * rows);
    let samples = 0;
    let cut = 0;
    let shared = 0;
    let lit = 0;
    for (let frame = 0; frame < 30 * 180; frame++) {
      advanceAll(worms, 1 / 30, cols, rows);
      if (frame % 10) continue;
      samples++;
      cut += worms.some((worm) => bodyCut(worm, cols, rows));
      const hits = new Uint8Array(cols * rows);
      worms.forEach((worm) => render([worm], cols, rows).levels.forEach((level, i) => level && hits[i]++));
      hits.forEach((n, i) => {
        if (!n) return;
        seen[i] = 1;
        lit++;
        if (n > 1) shared++;
      });
    }
    const coverage = seen.reduce((n, v) => n + v, 0) / seen.length;
    const label = `${cols}x${rows}, ${count} worm${count > 1 ? 's' : ''}`;
    console.log(`${label}: body cut by an edge ${((100 * cut) / samples).toFixed(1)}% of frames, screen covered ${(100 * coverage).toFixed(0)}%` + (count > 1 ? `, overlap ${((100 * shared) / lit).toFixed(0)}%` : ''));
    assert(cut / samples < 0.01, `${label}: the screen edge cuts the body too often`);
    assert(coverage > 0.55, `${label}: worms do not roam the screen`);
    if (count > 1) assert(shared / lit < 0.2, `${label}: worms are too crowded`);
  }
}

// Shrink the terminal under the worms, mildly and to a sliver: every head must be back on screen within 10 s.
for (const [cols, rows] of [[70, 20], [8, 60]]) {
  const worms = createWorms(240, 70, 3);
  for (let i = 0; i < 30 * 20; i++) advanceAll(worms, 1 / 30, 240, 70);
  let back = false;
  for (let i = 0; i < 30 * 10 && !back; i++) {
    advanceAll(worms, 1 / 30, cols, rows);
    back = worms.every((worm) => headGap(worm, cols, rows) > 0);
  }
  assert(back, `heads did not return after the terminal shrank to ${cols}x${rows}`);
}
console.log('resize: heads return on screen');

// Tiny, zero and portrait sizes: nothing throws, and no position turns into NaN, even after a 0x0 frame.
for (const [cols, rows] of [[0, 0], [0, 24], [1, 1], [10, 5], [20, 80]]) {
  const worms = createWorms(cols, rows, 3);
  for (let i = 0; i < 30 * 5; i++) advanceAll(worms, 1 / 30, cols, rows);
  render(worms, cols, rows);
  for (let i = 0; i < 30 * 5; i++) advanceAll(worms, 1 / 30, 80, 24);
  assert(worms.every((worm) => worm.path.every((p) => p.every(Number.isFinite))), `NaN after ${cols}x${rows}`);
}
console.log('tiny and zero sizes: no crash, no NaN');

// All three worms are drawn.
const trio = createWorms(160, 45, 3);
const frame = render(trio, 160, 45);
assert.deepStrictEqual(new Set(frame.owners.filter((_, i) => frame.levels[i])), new Set([0, 1, 2]), 'not all three worms are drawn');

// Colours: names, hex with or without #, lists that repeat, and a clear error for typos.
assert.deepStrictEqual(wormColors('', 3), [COLORS.red, COLORS.purple, COLORS.cyan]);
assert.deepStrictEqual(wormColors('Purple', 2), [COLORS.purple, COLORS.purple]);
assert.deepStrictEqual(wormColors('red,#00ff80', 3), [COLORS.red, [0, 255, 128], COLORS.red]);
assert.throws(() => wormColors('purpel', 1), /unknown colour "purpel"/);
console.log('colours: names, hex and lists parse');
console.log('check passed');
