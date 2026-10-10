#!/usr/bin/env node
// worm.js — the ASCII worm, full screen in the terminal. Run `worm -h` for options.
// When stdout is not a terminal (a pipe, a file, an AI agent) it prints one plain frame and exits.
const { RAMP, COLORS, createWorm, advance, render, wormColors, shade } = require('./worm-core.js');

const FPS = 30;
const MAX_WORMS = 3;
const SNAPSHOT_SIZE = [100, 30]; // cols, rows for the one-frame text output

const HELP = `worm - a 3D ASCII worm that crawls over your terminal

Usage
  worm [-1 | -2 | -3] [-c COLOURS] [-h]

Options
  -1, -2, -3         how many worms (default 1, max ${MAX_WORMS})
  -c, --color LIST   worm colours: one name, a hex code, or a comma list (one per worm)
                     names: ${Object.keys(COLORS).join(', ')}
                     hex:   ff8800 (or "#ff8800" in quotes)
  -h, --help         show this help

Examples
  worm                          one red worm
  worm -c purple                one purple worm
  worm -2                       two worms: red and purple
  worm -3                       three worms: red, purple and cyan
  worm -3 -c green              three green worms
  worm -3 -c red,yellow,blue    three worms, one colour each
  worm -2 -c pink,ff8800        a pink worm and an orange (hex) worm

Keys
  q, Esc or Ctrl+C   quit
  Resize the window at any time: the worms follow the new size.

Not a terminal?
  worm -2 > frame.txt           prints one ${SNAPSHOT_SIZE[0]}x${SNAPSHOT_SIZE[1]} plain-text frame and exits
`;

function fail(message) {
  console.error(`worm: ${message}\nRun "worm -h" for help.`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { count: 1, colors: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-c' || arg === '--color' || arg === '--colour') {
      const list = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) list.push(argv[++i]);
      if (!list.length) fail(`${arg} needs a colour, for example: worm ${arg} purple`);
      opts.colors = list.join(',');
    } else if (/^-?\d+$/.test(arg)) opts.count = Math.min(MAX_WORMS, Math.max(1, Math.abs(Number(arg))));
    else fail(`unknown option "${arg}"`);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

let colors;
try {
  colors = wormColors(opts.colors, opts.count);
} catch (error) {
  fail(error.message);
}

const out = process.stdout;
if (!out.isTTY) {
  printSnapshot();
  process.exit(0);
}

function printSnapshot() {
  const [cols, rows] = SNAPSHOT_SIZE;
  const worms = Array.from({ length: opts.count }, (_, i) => createWorm(cols, rows, i));
  const { levels } = render(worms, cols, rows);
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) line += RAMP[levels[row * cols + col]];
    out.write(line.trimEnd() + '\n');
  }
}

// Windows Terminal and most modern terminals do 24-bit colour; over ssh the env hint is often lost, so fall back to 256.
const truecolor =
  /truecolor|24bit/i.test(process.env.COLORTERM || '') ||
  Boolean(process.env.WT_SESSION) ||
  /iTerm|WezTerm|ghostty|vscode/i.test(process.env.TERM_PROGRAM || '');

// Escape codes indexed by [worm][level].
const PALETTE = colors.map((rgb) => RAMP.split('').map((_, level) => (level >= 2 ? colorCode(shade(rgb, level)) : '')));

function colorCode([r, g, b]) {
  if (truecolor) return `\x1b[38;2;${r};${g};${b}m`;
  const cube = (v) => Math.round((v / 255) * 5); // nearest step of the xterm 6x6x6 colour cube
  return `\x1b[38;5;${16 + 36 * cube(r) + 6 * cube(g) + cube(b)}m`;
}

function frameText({ levels, owners }, cols, rows) {
  let text = '';
  let current = '';
  for (let row = 0; row < rows; row++) {
    text += `\x1b[${row + 1};1H`;
    const width = row === rows - 1 ? cols - 1 : cols; // never write the bottom-right cell, so the screen never scrolls
    for (let col = 0; col < width; col++) {
      const cell = row * cols + col;
      const level = levels[cell];
      if (level) {
        const code = PALETTE[owners[cell]][level];
        if (code !== current) {
          text += code;
          current = code;
        }
      }
      text += RAMP[level];
    }
  }
  return text;
}

const input = process.stdin;
let [cols, rows] = out.getWindowSize();
const worms = Array.from({ length: opts.count }, (_, i) => createWorm(cols, rows, i));
let last = performance.now();
let waiting = false; // true while a slow terminal (ssh) is still taking the previous frame

function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const [c, r] = out.getWindowSize();
  for (const worm of worms) advance(worm, dt, c, r);
  if (waiting) return;
  let text = '';
  if (c !== cols || r !== rows) {
    cols = c;
    rows = r;
    text = '\x1b[2J';
  }
  text += frameText(render(worms, cols, rows), cols, rows);
  waiting = !out.write(text);
  if (waiting) out.once('drain', () => (waiting = false));
}

function quit() {
  clearInterval(timer);
  if (input.isTTY) input.setRawMode(false);
  out.write('\x1b[0m\x1b[?25h\x1b[?1049l', () => process.exit(0));
}

out.write('\x1b[?1049h\x1b[?25l\x1b[2J'); // alternate screen, hide cursor
if (input.isTTY) {
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.on('data', (key) => {
    if (key === 'q' || key === 'Q' || key === '\x1b' || key === '\x03') quit();
  });
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
process.on('SIGHUP', () => process.exit(0));
const timer = setInterval(tick, 1000 / FPS);
