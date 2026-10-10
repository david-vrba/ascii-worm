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
  // Edge margins are in full-size body radii for every worm: the turn size does not shrink with
  // a thinner worm, so its margins must not either.
  const EDGE = 3; // ...or when the head itself is within this many body radii of an edge
  const AHEAD_EDGE = 2; // body radii between an edge and the LOOKAHEAD point before homing starts
  const SAFE = 0.3; // wander targets stay this far inside the screen
  const SIZE_BY_COUNT = [1, 0.7, 0.56]; // 2 or 3 worms are thinner and shorter, so they have room
  const SEPARATION = 0.5; // a wandering head turns away from other heads closer than this...
  const BODY_SEPARATION = 0.25; // ...and from other worms' bodies closer than this
  const RING = 0.7 * RADIUS; // length of one body ring
  const AMBIENT = 0.2;
  const LIGHT = unit([-0.75, -0.15, 0.65]); // toward the light: left, a little up, toward the viewer

  // Main colours at full brightness. Purple is a bright violet, so its shadow side still reads on black.
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

  // A 0-size terminal or window counts as 1x1: a zero scale would turn every position into NaN.
  function screen(cols, rows) {
    const c = Math.max(1, cols || 0);
    const r = Math.max(1, rows || 0);
    const scale = Math.min(c, r * ASPECT); // char widths per unit
    return { scale, width: c / scale, height: (r * ASPECT) / scale };
  }

  // Several worms split the long side of the screen into lanes, one lane each.
  function createWorms(cols, rows, count) {
    const size = SIZE_BY_COUNT[Math.min(count, SIZE_BY_COUNT.length) - 1];
    return Array.from({ length: count }, (_, i) => createWorm(cols, rows, { lane: i, lanes: count, size }));
  }

  // `lane` of `lanes` is the share of the screen this worm roams. `size` scales thickness and length.
  function createWorm(cols, rows, { lane = 0, lanes = 1, size = 1 } = {}) {
    const worm = { size, lane, lanes, t: lane * 10, carry: 0, heading: lane * 2.1, homing: false, push: [0, 0], hardTurn: 0, path: [] };
    const { width, height } = screen(cols, rows);
    const [x, y] = wander(worm, width, height);
    worm.path.push([x, y, 0]);
    for (let i = 0; i < 220; i++) advance(worm, 1 / 30, cols, rows); // grow the full body before the first frame
    return worm;
  }

  // Moves every worm by dt seconds; each one steers clear of the others. A worm whose head ends
  // up far off screen (the window shrank a lot) starts again inside it: steering back would take minutes.
  function advanceAll(worms, dt, cols, rows) {
    const { width, height } = screen(cols, rows);
    worms.forEach((worm, i) => {
      const [x, y] = worm.path[worm.path.length - 1];
      const lost = x < -0.5 || x > width + 0.5 || y < -0.5 || y > height + 0.5;
      if (lost) worms[i] = createWorm(cols, rows, worm);
    });
    for (const worm of worms) advance(worm, dt, cols, rows, worms);
  }

  function advance(worm, dt, cols, rows, flock = []) {
    const { width, height } = screen(cols, rows);
    worm.carry += SPEED * dt;
    while (worm.carry >= STEP) {
      worm.carry -= STEP;
      stepHead(worm, width, height, flock);
    }
  }

  function stepHead(worm, width, height, flock) {
    const dt = STEP / SPEED;
    worm.t += dt;
    const head = worm.path[worm.path.length - 1];
    updateHoming(worm, head, width, height);
    const turn = edgeTurn(worm, head, width, height) ?? steer(worm, head, width, height, flock);
    worm.heading += turn * dt;
    worm.path.push([
      head[0] + Math.cos(worm.heading) * STEP,
      head[1] + Math.sin(worm.heading) * STEP,
      0.15 * Math.sin(worm.t * 0.9), // depth, decides which part is in front where the body crosses itself
    ]);
    if (worm.path.length > spinePoints(worm) * STEPS_PER_POINT) worm.path.shift();
  }

  function spinePoints(worm) {
    return Math.round(POINTS * worm.size);
  }

  // Signed turn (radians) from the current heading toward point (tx, ty).
  function angleTo(heading, head, tx, ty) {
    const off = Math.atan2(ty - head[1], tx - head[0]) - heading;
    return Math.atan2(Math.sin(off), Math.cos(off));
  }

  // Steers toward the wander point, pushed away from other worms:
  // their heads within SEPARATION and their bodies (every spine point) within BODY_SEPARATION.
  function steer(worm, head, width, height, flock) {
    const [tx, ty] = wander(worm, width, height);
    const toTarget = Math.hypot(tx - head[0], ty - head[1]) || 1;
    const v = [(tx - head[0]) / toTarget, (ty - head[1]) / toTarget];
    for (const other of flock) {
      if (other === worm) continue;
      const path = other.path;
      repel(v, head, path[path.length - 1], SEPARATION, 3);
      // Every 25th path point (0.1 units apart): denser sampling adds up and swamps the target.
      for (let i = path.length - 26; i >= 0; i -= 25) repel(v, head, path[i], BODY_SEPARATION, 0.5);
    }
    const wobble = worm.homing ? 0 : 0.5 * Math.sin(worm.t * 1.7);
    // A smaller worm makes smaller loops, so it stays in its lane.
    const limit = worm.homing ? HOMING_TURN : MAX_TURN / worm.size;
    return clamp(2 * angleTo(worm.heading, head, head[0] + v[0], head[1] + v[1]) + wobble, -limit, limit);
  }

  // Adds to steering vector v a push from point p away toward head: 0 at distance `range`,
  // growing to `strength` per unit distance up close.
  function repel(v, head, p, range, strength) {
    const dx = head[0] - p[0];
    const dy = head[1] - p[1];
    const d = Math.hypot(dx, dy);
    if (d === 0 || d >= range) return;
    const push = (strength * (1 - d / range)) / d;
    v[0] += dx * push;
    v[1] += dy * push;
  }

  // While homing and pointing at a close edge, the head turns hard to the side with more room and
  // keeps that side until it no longer points at the edge. Returns null when no hard turn is due.
  // (Steering at the wander point alone sometimes swings the head through the edge when that point
  // is behind it; re-picking the side every step flip-flops in corners.)
  function edgeTurn(worm, head, width, height) {
    const dx = Math.cos(worm.heading);
    const dy = Math.sin(worm.heading);
    if (!worm.homing || dx * worm.push[0] + dy * worm.push[1] <= 0) {
      worm.hardTurn = 0;
      return null;
    }
    if (!worm.hardTurn) worm.hardTurn = roomierSide(head, dx, dy, width, height);
    return worm.hardTurn * HOMING_TURN;
  }

  // +1 or -1: the turn direction whose full turning circle stays further inside the screen.
  // (Only the start of the circle is travelled, but the full circle also counts the next edge
  // in a corner, which a shorter look misses.)
  function roomierSide(head, dx, dy, width, height) {
    const radius = SPEED / HOMING_TURN;
    const clearance = (side) => {
      const cx = head[0] - side * dy * radius; // a turn toward +heading circles around head + radius * (-dy, dx)
      const cy = head[1] + side * dx * radius;
      return Math.min(cx, width - cx, cy, height - cy);
    };
    return clearance(1) >= clearance(-1) ? 1 : -1;
  }

  // Homing starts when the point LOOKAHEAD in front of the head, or the head itself, gets close to
  // an edge. Once clear of every edge, homing lasts until the head faces its wander point or is near
  // it. The hysteresis stops it hugging the edge; the "near" exit stops it orbiting that point.
  function updateHoming(worm, head, width, height) {
    const ahead = [head[0] + Math.cos(worm.heading) * LOOKAHEAD, head[1] + Math.sin(worm.heading) * LOOKAHEAD];
    const a = outward(ahead, AHEAD_EDGE * RADIUS, width, height);
    const h = outward(head, EDGE * RADIUS, width, height);
    worm.push = [a[0] + h[0], a[1] + h[1]];
    if (worm.push[0] || worm.push[1]) {
      worm.homing = true;
    } else if (worm.homing) {
      const [hx, hy] = wander(worm, width, height);
      const facing = Math.abs(angleTo(worm.heading, head, hx, hy)) < 1;
      const near = Math.hypot(head[0] - hx, head[1] - hy) < 0.4;
      worm.homing = !facing && !near;
    }
  }

  // Sum of the outward directions of the edges that point (x, y) is within m of. [0, 0] means none.
  function outward([x, y], m, width, height) {
    return [Number(x > width - m) - Number(x < m), Number(y > height - m) - Number(y < m)];
  }

  // Where the head wants to go: a slow Lissajous point that sweeps the worm's lane, which is a
  // share of the screen's long side (the whole screen for a single worm). The point stays SAFE
  // units inside the screen: a target inside the edge zone keeps the worm homing.
  function wander(worm, width, height) {
    const t = worm.t;
    const along = (worm.lane + 0.5 + 0.45 * Math.sin(0.21 * t + 0.6 * Math.sin(0.13 * t))) / worm.lanes;
    const across = 0.5 + 0.32 * Math.sin(0.33 * t + 1.1);
    const [x, y] = width >= height ? [width * along, height * across] : [width * across, height * along];
    const mx = Math.min(SAFE, width / 2);
    const my = Math.min(SAFE, height / 2);
    return [clamp(x, mx, width - mx), clamp(y, my, height - my)];
  }

  // Thin at both ends, the tail tapers longer than the head.
  function taper(s) {
    const head = 0.55 + 0.45 * smoothstep(0, 0.06, s);
    const tail = 0.12 + 0.88 * (1 - smoothstep(0.7, 1, s));
    return head * tail;
  }

  function spine(worm, scale) {
    const path = worm.path;
    const total = spinePoints(worm);
    const count = Math.min(total, Math.floor((path.length - 1) / STEPS_PER_POINT) + 1);
    const points = [];
    for (let i = 0; i < count; i++) {
      const p = path[path.length - 1 - i * STEPS_PER_POINT];
      const s = i / (total - 1);
      points.push({
        x: p[0] * scale,
        y: p[1] * scale,
        z: p[2] * scale,
        r: RADIUS * worm.size * taper(s) * (1 + 0.6 * p[2]) * scale, // nearer parts look thicker
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
        drawSegment(points[i], points[i + 1], RING * worm.size * scale, owner, grid);
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

  const api = { RAMP, ASPECT, RADIUS, COLORS, createWorms, createWorm, advanceAll, advance, render, screen, parseColors, wormColors, shade };
  if (typeof module !== 'undefined') module.exports = api;
  else window.WormCore = api;
})();
