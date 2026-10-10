# AGENTS.md

Instructions for AI coding agents that work on ascii-worm.

## What this is

A 3D worm drawn with ASCII characters. `worm.js` runs it in a terminal. `index.html` runs it in a browser. Both use one engine, `worm-core.js`. There are no dependencies and no build step.

## Files

| File | Job |
|---|---|
| `worm-core.js` | Simulation, steering, shading and colours. A classic script: `module.exports` in Node, `window.WormCore` in the browser. |
| `worm.js` | Terminal runner: options, ANSI output, resize, keys. Prints one plain-text frame when stdout is not a terminal. |
| `index.html` | Browser runner: canvas drawing, URL options `?worms=` and `?color=`. |
| `check.js` | Self-check. Run it after every change. |
| `media/` | The GIFs in the README. |

## Commands

```bash
node check.js                # must end with "check passed"
node worm.js -h              # options and examples
node worm.js -3 > frame.txt  # one 100x30 frame as plain text, for agents without a terminal
```

For the web version, open `index.html` in a browser. It needs no server.

## Deploy

Every push to `main` deploys the web version to https://worm.davidvrba.me (a Vercel project linked to this repo). There is no build step. Never commit `.env*` or `.vercel/`: the Vercel CLI writes a token there. Both are in `.gitignore` and `.vercelignore`.

## Rules

- Keep it dependency-free. Node 16+ and a browser are the only runtimes.
- `worm-core.js` must load in Node and in a browser `<script>` tag. Do not use `require`, `import` or DOM APIs in it.
- Put shared behaviour (colours, sizes, shading) in `worm-core.js`. Then the terminal and web versions stay the same.
- Sizes are in screen units: 1 unit is the shorter side of the screen. A terminal cell is 1 wide and 2 tall (`ASPECT`).
- Never write the bottom-right terminal cell. Some terminals scroll when it is written.
- `check.js` asserts that the screen edge almost never cuts a body. It also tests coverage, crowding, tiny and zero sizes, and resize recovery. If you change steering or sizes, run it.

## Common changes

- **Add a colour:** add a `name: [r, g, b]` entry to `COLORS` in `worm-core.js`. The help text lists it on its own. Add it to the colour list in `README.md`.
- **Change the worm limit:** `MAX_WORMS` in `worm.js` and in `index.html`, plus one entry per count in `SIZE_BY_COUNT` in `worm-core.js`. `check.js` tests 1 and 3 worms. Add the new count there.
- **Change the look:** `RADIUS`, `LENGTH`, `RING`, `LIGHT` and `AMBIENT` at the top of `worm-core.js`.
- **Change the movement:** `SPEED`, `MAX_TURN`, `HOMING_TURN`, `LOOKAHEAD`, `EDGE`, `AHEAD_EDGE`, `SAFE`, `SEPARATION`, `BODY_SEPARATION` and `wander()` in `worm-core.js`. Then run `node check.js`.
