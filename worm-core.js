// worm-core.js — the worm: a 3D tube that crawls around the screen, drawn as shaded ASCII.
// Shared by the terminal version (worm.js) and the web version (index.html).
(function () {
  const RAMP = ' .:-=+*#%@';
  const ASPECT = 2; // a terminal cell is twice as tall as it is wide

  // Sizes are in screen units: 1 unit = the shorter side of the screen.
  const RADIUS = 0.075;
  const LENGTH = 2.6;
  const SPEED = 0.42; // units per second
  const STEP = 0.004; // the head records its path every STEP units
  const STEPS_PER_POINT = 5; // spine points sit 0.02 units apart
  const POINTS = Math.round(LENGTH / (STEP * STEPS_PER_POINT));
  const MAX_TURN = 1.3; // radians per second while wandering; loop radius = SPEED / MAX_TURN ≈ 0.32
  const HOMING_TURN = 2.2; // tighter turn near an edge (radius ≈ 0.19), so a U-turn fits in the screen height
  const LOOKAHEAD = 0.3; // turn home when this far ahead of the head is off screen
  const RING = 0.7 * RADIUS; // length of one body ring
  const AMBIENT = 0.2;
  const LIGHT = unit([-0.75, -0.15, 0.65]); // toward the light: left, a little up, toward the viewer

  // Main colours at full brightness. Red is sampled from the reference video; purple is the
  // second video's violet, brightened so its shadow side still reads on black.
  const COLORS = {
    red: [245, 30, 60],
    orange: [255, 122, 26],
    yellow: [255, 210, 31],
    green: [46, 232, 106],
    cyan: [31, 224, 240],
    blue: [47, 107, 255],
    purple: [96, 40, 255],
    pink: [255, 79, 184],
    white: [240, 240, 240],
  };
  const DEFAULT_COLORS = 'red,purple,cyan'; // worm 1, 2 and 3 when no colour is given

  // "purple", "red,green,blue", "#ff8800" or "ff8800" → [[r, g, b], ...]. Throws on an unknown colour.
  function parseColors(text) {
    return String(text)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((name) => {
        const key = name.toLowerCase();
        if (COLORS[key]) return COLORS[key];
        const hex = key.replace(/^#/, '');
        if (/^[0-9a-f]{6}$/.test(hex)) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
        throw new Error(`unknown colour "${name}". Use ${Object.keys(COLORS).join(', ')} or a hex like ff8800.`);
      });
  }

  // One colour per worm; a shorter list repeats.
  function wormColors(text, count) {
    const list = parseColors(text || DEFAULT_COLORS);
    if (!list.length) return wormColors(DEFAULT_COLORS, count);
    return Array.from({ length: count }, (_, i) => list[i % list.length]);
  }

  // The colour of one character: the worm colour, dimmed to 60% on the shadow side.
  function shade(rgb, level) {
    const k = 0.6 + (0.4 * (level - 2)) / 7;
    return rgb.map((v) => Math.round(v * k));
  }

  function unit(v) {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  }

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function smoothstep(a, b, x) {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function screen(cols, rows) {
    const scale = Math.min(cols, rows * ASPECT); // char widths per unit
    return { scale, width: cols / scale, height: (rows * ASPECT) / scale };
  }

  // `index` gives each worm its own wander route, so several worms do not move in step.
  function createWorm(cols, rows, index = 0) {
    const { width, height } = screen(cols, rows);
    const start = [width * (0.3 + 0.2 * index), height / 2, 0];
    const worm = { t: index * 41.3, carry: 0, heading: index * 2.1, homing: false, path: [start] };
    for (let i = 0; i < 220; i++) advance(worm, 1 / 30, cols, rows); // grow the full body before the first frame
    return worm;
  }

  function advance(worm, dt, cols, rows) {
    const { width, height } = screen(cols, rows);
    worm.carry += SPEED * dt;
    while (worm.carry >= STEP) {
      worm.carry -= STEP;
      stepHead(worm, width, height);
    }
  }

  function stepHead(worm, width, height) {
    const dt = STEP / SPEED;
    worm.t += dt;
    const head = worm.path[worm.path.length - 1];
    updateHoming(worm, head, width, height);
    const [tx, ty] = worm.homing ? [width / 2, height / 2] : wander(worm.t, width, height);
    const off = angleTo(worm.heading, head, tx, ty);
    const wobble = worm.homing ? 0 : 0.5 * Math.sin(worm.t * 1.7);
    const limit = worm.homing ? HOMING_TURN : MAX_TURN;
    const turn = clamp(2 * off + wobble, -limit, limit);
    worm.heading += turn * dt;
    worm.path.push([
      head[0] + Math.cos(worm.heading) * STEP,
      head[1] + Math.sin(worm.heading) * STEP,
      0.15 * Math.sin(worm.t * 0.9), // depth, decides which part is in front where the body crosses itself
    ]);
    if (worm.path.length > POINTS * STEPS_PER_POINT) worm.path.shift();
  }

  // Signed turn (radians) from the current heading toward point (tx, ty).
  function angleTo(heading, head, tx, ty) {
    const off = Math.atan2(ty - head[1], tx - head[0]) - heading;
    return Math.atan2(Math.sin(off), Math.cos(off));
  }

  // Homing starts when the point LOOKAHEAD in front of the head is off screen. Once that point
  // is back on screen, homing lasts until the head faces the centre or is near it.
  // The hysteresis stops it hugging the edge; the "near" exit stops it orbiting the centre.
  function updateHoming(worm, head, width, height) {
    const ax = head[0] + Math.cos(worm.heading) * LOOKAHEAD;
    const ay = head[1] + Math.sin(worm.heading) * LOOKAHEAD;
    const m = RADIUS;
    if (ax < m || ax > width - m || ay < m || ay > height - m) {
      worm.homing = true;
    } else if (worm.homing) {
      const facing = Math.abs(angleTo(worm.heading, head, width / 2, height / 2)) < 0.5;
      const near = Math.hypot(head[0] - width / 2, head[1] - height / 2) < 0.4;
      worm.homing = !facing && !near;
    }
  }

  // Where the head wants to go: a slow Lissajous point that sweeps the whole screen.
  function wander(t, width, height) {
    return [
      width * (0.5 + 0.45 * Math.sin(0.21 * t + 0.6 * Math.sin(0.13 * t))),
      height * (0.5 + 0.32 * Math.sin(0.33 * t + 1.1)),
    ];
  }

  // Thin at both ends, the tail tapers longer than the head.
  function taper(s) {
    const head = 0.55 + 0.45 * smoothstep(0, 0.06, s);
    const tail = 0.12 + 0.88 * (1 - smoothstep(0.7, 1, s));
    return head * tail;
  }

  function spine(worm, scale) {
    const path = worm.path;
    const count = Math.min(POINTS, Math.floor((path.length - 1) / STEPS_PER_POINT) + 1);
    const points = [];
    for (let i = 0; i < count; i++) {
      const p = path[path.length - 1 - i * STEPS_PER_POINT];
      const s = i / (POINTS - 1);
      points.push({
        x: p[0] * scale,
        y: p[1] * scale,
        z: p[2] * scale,
        r: RADIUS * taper(s) * (1 + 0.6 * p[2]) * scale, // nearer parts look thicker
        arc: i * STEP * STEPS_PER_POINT * scale,
      });
    }
    return points;
  }

  // Draws all worms into one grid. Per cell: `levels` = brightness (0 = empty, 2..9 = index into RAMP),
  // `owners` = index of the worm seen there.
  function render(worms, cols, rows) {
    const { scale } = screen(cols, rows);
    const grid = {
      cols,
      rows,
      levels: new Uint8Array(cols * rows),
      owners: new Uint8Array(cols * rows),
      depth: new Float32Array(cols * rows).fill(-Infinity),
    };
    worms.forEach((worm, owner) => {
      const points = spine(worm, scale);
      for (let i = 0; i + 1 < points.length; i++) {
        drawSegment(points[i], points[i + 1], RING * scale, owner, grid);
      }
    });
    return { levels: grid.levels, owners: grid.owners };
  }

  // Shades every cell covered by the capsule between spine points a and b.
  // The surface normal comes from the cell's offset to the nearest spine point,
  // so the union of capsules reads as one smooth lit tube.
  function drawSegment(a, b, ring, owner, { cols, rows, levels, owners, depth }) {
    const reach = Math.max(a.r, b.r);
    const c0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - reach));
    const c1 = Math.min(cols - 1, Math.ceil(Math.max(a.x, b.x) + reach));
    const r0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) / ASPECT));
    const r1 = Math.min(rows - 1, Math.ceil((Math.max(a.y, b.y) + reach) / ASPECT));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1e-9;
    for (let row = r0; row <= r1; row++) {
      const py = (row + 0.5) * ASPECT;
      for (let col = c0; col <= c1; col++) {
        const px = col + 0.5;
        const u = clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
        const r = a.r + u * (b.r - a.r);
        const nx = (px - (a.x + u * dx)) / r;
        const ny = (py - (a.y + u * dy)) / r;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;
        const nz = Math.sqrt(1 - d2);
        const z = a.z + u * (b.z - a.z) + nz * r;
        const cell = row * cols + col;
        if (z <= depth[cell]) continue;
        depth[cell] = z;
        // Wrapped diffuse: the shadow side fades to ':' instead of going black, like the reference.
        const wrap = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) * 0.5 + 0.5;
        const arc = a.arc + u * (b.arc - a.arc);
        const rings = 0.88 + 0.12 * Math.cos((2 * Math.PI * arc) / ring);
        const light = (AMBIENT + (1 - AMBIENT) * wrap * wrap) * rings;
        levels[cell] = clamp(Math.round(light * 9), 2, 9);
        owners[cell] = owner;
      }
    }
  }

  const api = { RAMP, ASPECT, COLORS, createWorm, advance, render, screen, parseColors, wormColors, shade };
  if (typeof module !== 'undefined') module.exports = api;
  else window.WormCore = api;
})();
