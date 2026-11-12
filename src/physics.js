// RIFFGEWITTER — 2-D pinball physics (SI units: metres, seconds).
// Deterministic fixed-step simulation, independent of rendering, runs in Node for tests.

const MM = 0.001;

export const PHYS = {
  h: 1 / 1200,
  gravity: 0.98, // effective acceleration down the playfield
  drag: 0.1,
  maxSpeed: 4.6,
  friction: 0.05,
  restThreshold: 0.22,
  flipper: { omegaUp: 40, omegaDown: 22, accel: 8000, e: 0.32, mu: 0.1 },
  bumperKick: 1.75,
  slingKick: 1.55,
  ramp: { gz: 5.2, drag: 0.55, minCruise: 0.75, max: 2.7, exitMax: 0.65 },
  plunger: { vMin: 1.15, vMax: 3.35 },
};

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Samples the ramp control points into an arc-length parametrised 3-D polyline (metres). */
export function sampleRampPath(ctrl, sub = 14) {
  const P = ctrl.map((p) => [p[0] * MM, p[1] * MM, p[2] * MM]);
  const pts = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t), Math.max(0, catmull(p0[2], p1[2], p2[2], p3[2], t))]);
    }
  }
  pts.push(P[P.length - 1]);
  const S = [0];
  for (let i = 1; i < pts.length; i++) {
    S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  }
  return { pts, S, total: S[S.length - 1] };
}

export function rampPointAt(path, s, out = [0, 0, 0]) {
  const { pts, S } = path;
  if (s <= 0) { out[0] = pts[0][0]; out[1] = pts[0][1]; out[2] = pts[0][2]; return out; }
  if (s >= path.total) { const p = pts[pts.length - 1]; out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const f = (s - S[lo]) / (S[hi] - S[lo] || 1);
  for (let k = 0; k < 3; k++) out[k] = pts[lo][k] + (pts[hi][k] - pts[lo][k]) * f;
  out.i = lo;
  return out;
}

export class Physics {
  constructor(layout, rng = Math.random) {
    this.L = layout;
    this.rng = rng;
    this.R = layout.ballR * MM;
    this.events = [];
    this.time = 0;
    this.acc = 0;
    this.balls = [];
    this.nextBallId = 1;
    this.tilted = false;
    this._build();
  }

  // ------------------------------------------------------------------ build colliders
  _build() {
    const L = this.L;
    const segs = [];
    const addSeg = (a, b, o) => {
      const s = {
        ax: a[0] * MM, ay: a[1] * MM, bx: b[0] * MM, by: b[1] * MM,
        r: (o.r ?? 2) * MM, e: o.e ?? 0.42, tag: o.tag || 'wall', enabled: true, level: o.level ?? 1, ...o.extra,
      };
      const pad = s.r + this.R + 0.004;
      s.minx = Math.min(s.ax, s.bx) - pad; s.maxx = Math.max(s.ax, s.bx) + pad;
      s.miny = Math.min(s.ay, s.by) - pad; s.maxy = Math.max(s.ay, s.by) + pad;
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      s.len2 = dx * dx + dy * dy;
      segs.push(s);
      return s;
    };
    for (const w of L.walls) {
      for (let i = 0; i < w.pts.length - 1; i++) addSeg(w.pts[i], w.pts[i + 1], { r: w.r, e: w.e, tag: w.kind, level: w.level });
    }
    // plunger rest (floor of the shooter lane)
    addSeg([L.shooter.x0, L.plunger.restY], [L.shooter.x1, L.plunger.restY], { r: 0, e: 0.15, tag: 'plunger' });
    // Roxy's boots
    if (L.roxy) for (const j of L.roxy.boots) addSeg(j.a, j.b, { r: j.r, e: 0.5, tag: 'roxy' });
    // stand-up targets
    for (const t of L.standups || []) {
      const hw = t.w / 2;
      addSeg([t.x - t.ux * hw, t.y - t.uy * hw], [t.x + t.ux * hw, t.y + t.uy * hw], { r: t.r, e: 0.55, tag: 'standup', level: t.level, extra: { standup: t.id } });
    }
    // skull jaw
    if (L.skull) for (const j of L.skull.jaw) addSeg(j.a, j.b, { r: j.r, e: 0.4, tag: 'skull' });
    // slings
    this.slings = L.slings.map((s) => {
      addSeg(s.A, s.B, { r: s.r, e: 0.55, tag: 'slingBody' });
      addSeg(s.B, s.C, { r: s.r, e: 0.55, tag: 'slingBody' });
      const face = addSeg(s.A, s.C, { r: s.r, e: 0.5, tag: 'sling', extra: { sling: s.id } });
      return { id: s.id, face, cool: 0 };
    });
    // drop targets
    this.targets = L.dropTargets.map((t) => {
      const hw = t.w / 2;
      const seg = addSeg([t.x - t.ux * hw, t.y - t.uy * hw], [t.x + t.ux * hw, t.y + t.uy * hw], { r: t.r, e: 0.35, tag: 'drop', extra: { target: t.id } });
      return { id: t.id, seg, up: true };
    });
    // gates
    this.gates = {};
    for (const g of L.gates) {
      const seg = addSeg(g.a, g.b, { r: 1.5, e: g.e, tag: 'gate', extra: { gate: g.id, oneWay: g.oneWay, nx: g.n[0], ny: g.n[1] } });
      seg.enabled = !g.switchable;
      this.gates[g.id] = seg;
    }
    this.segs = segs;

    this.circles = [];
    for (const p of L.posts) this.circles.push({ x: p.x * MM, y: p.y * MM, r: p.r * MM, e: p.e, tag: 'post', level: p.level ?? 1 });
    if (L.skull) this.circles.push({ x: L.skull.x * MM, y: L.skull.y * MM, r: L.skull.r * MM, e: 0.4, tag: 'skull', level: 1 });
    this.bumpers = L.bumpers.map((b) => {
      const c = { x: b.x * MM, y: b.y * MM, r: b.r * MM, e: 0.5, tag: 'bumper', bumper: b.id, cool: 0, level: 1 };
      this.circles.push(c);
      return c;
    });
    this.arcs = L.arcs.map((a) => ({ cx: a.cx * MM, cy: a.cy * MM, r: a.r * MM, e: a.e }));
    for (const bsh of L.bashes || []) this.circles.push({ x: bsh.x * MM, y: bsh.y * MM, r: bsh.r * MM, e: 0.55, tag: 'bash', bash: bsh.id, level: bsh.level ?? 1, cool: 0 });
    // spinning discs (turntable): drag the ball along with the surface
    this.discs = (L.discs || []).map((d) => ({ id: d.id, x: d.x * MM, y: d.y * MM, r: d.r * MM, r2: (d.r * MM) ** 2, omega: d.omega, level: d.level ?? 1 }));

    this.flippers = L.flippers.map((f) => ({
      id: f.id, side: f.side, button: f.button || f.id, level: f.level ?? 1, x: f.x * MM, y: f.y * MM, len: f.len * MM, rB: f.rBase * MM, rT: f.rTip * MM,
      rest: f.rest, span: f.up - f.rest, p: 0, w: 0, pressed: false, angle: f.rest,
    }));

    this.sensors = L.sensors.map((s, i) => ({ id: s.id, x: s.x * MM, y: s.y * MM, r2: (s.r * MM) ** 2, bit: 1 << i, level: s.level ?? 1 }));
    // scoops / saucers / holes: a ball inside the circle (and moving the right way) is held
    const scoops = (L.scoops || []).map((c) => ({ ...c }));
    if (L.skull) scoops.push({ id: 'skull', event: 'skull', x: L.skull.mouth.x, y: L.skull.mouth.y, r: L.skull.mouth.r, minVy: -0.2 });
    this.scoops = scoops.map((c) => ({
      id: c.id, event: c.event || 'scoop', x: c.x * MM, y: c.y * MM, r2: (c.r * MM) ** 2, level: c.level ?? 1,
      minVy: c.minVy ?? -99, maxVy: c.maxVy ?? 99, into: c.into || null, enabled: c.enabled !== false,
    }));
    // wire/plastic ramps as 1-D rails; the riff table's single ramp becomes rail 'ramp'
    const rails = (L.rails || []).map((r) => ({ ...r }));
    if (L.ramp) rails.unshift({ id: 'ramp', path: L.ramp.path, entry: { ...L.ramp.sensor, dir: L.ramp.dir }, exit: L.ramp.exit });
    this.rails = rails.map((r) => {
      const path = sampleRampPath(r.path);
      // commit point: first sample where the rail is at least 56 mm up
      const ci = path.pts.findIndex((p) => p[2] >= 0.056);
      return {
        id: r.id, path, commitS: path.S[ci < 0 ? 0 : ci],
        entry: r.entry ? { x: r.entry.x * MM, y: r.entry.y * MM, r2: (r.entry.r * MM) ** 2, dir: r.entry.dir, min: r.entry.min ?? 0.35 } : null,
        exit: r.exit ? { x: r.exit.x * MM, y: r.exit.y * MM, vx: r.exit.vx ?? 0, vy: r.exit.vy, level: r.exit.level ?? 1 } : null,
        hold: !!r.hold,
      };
    });
    this.railById = Object.fromEntries(this.rails.map((r, i) => [r.id, i]));
    this.drainY = L.drainY * MM;
    this.shooterX = L.shooter.x0 * MM;
    this._tmp = [0, 0, 0];
  }

  emit(type, data) {
    const e = data || {};
    e.type = type;
    e.t = this.time;
    this.events.push(e);
  }

  // ------------------------------------------------------------------ public controls
  addBall(xmm, ymm, vx = 0, vy = 0) {
    const b = {
      id: this.nextBallId++, x: xmm * MM, y: ymm * MM, vx, vy, mode: 'free', s: 0, sv: 0, z: 0, level: 1, rail: 0,
      sens: 0, still: 0, inShooter: false, age: 0, spinA: 0, spinX: 0, spinY: 0,
    };
    this.balls.push(b);
    return b;
  }

  spawnInShooter() {
    const [x, y] = this.L.shooter.spawn;
    const b = this.addBall(x, y + 4 * this.balls.filter((o) => o.inShooter).length * 7, 0, 0);
    b.inShooter = true; // known before the first physics step, so an instant plunge works
    return b;
  }

  removeBall(ball) {
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
  }

  setFlipper(id, pressed) {
    if (this.tilted) pressed = false;
    let changed = false;
    for (const f of this.flippers) {
      if (f.button === id && pressed !== f.pressed) { f.pressed = pressed; changed = true; }
    }
    if (changed) this.emit(pressed ? 'flipperUp' : 'flipperDown', { id });
  }

  setDisc(id, omega) { for (const d of this.discs) if (d.id === id) d.omega = omega; }

  setScoop(id, enabled) { for (const c of this.scoops) if (c.id === id) c.enabled = enabled; }

  /** Put a ball somewhere (teleport), optionally on another playfield level. */
  placeBall(ball, xmm, ymm, o = {}) {
    ball.mode = o.mode || 'free';
    ball.x = xmm * MM; ball.y = ymm * MM; ball.z = (o.z ?? 0) * MM;
    ball.vx = o.vx ?? 0; ball.vy = o.vy ?? 0;
    ball.level = o.level ?? 1; ball.sens = 0; ball.still = 0;
    ball.show = o.show ?? ball.show;
  }

  /** Send a ball along a rail from its start (used for wire returns and lock releases). */
  sendToRail(ball, id, speed = 1, s = 0) {
    const ri = this.railById[id];
    if (ri === undefined) return false;
    ball.mode = 'ramp'; ball.rail = ri; ball.s = s; ball.sv = speed; ball.committed = true; ball.level = 1;
    return true;
  }

  setTilted(v) {
    this.tilted = v;
    if (v) for (const f of this.flippers) f.pressed = false;
  }

  setGate(id, closed) { if (this.gates[id]) this.gates[id].enabled = closed; }

  resetTargets() { for (const t of this.targets) { t.up = true; t.seg.enabled = true; } }

  /** Launch every ball that rests on the plunger. power 0..1. Returns number of balls launched. */
  launch(power) {
    let n = 0;
    const P = PHYS.plunger;
    for (const b of this.balls) {
      if (b.mode === 'free' && b.inShooter && b.y < 0.2 && Math.abs(b.vy) < 0.4) {
        b.vy = (P.vMin + (P.vMax - P.vMin) * Math.max(0, Math.min(1, power))) * (1 + (this.rng() - 0.5) * 0.02);
        b.vx = 0;
        n++;
      }
    }
    if (n) this.emit('launch', { power });
    return n;
  }

  ejectSkull(ball) {
    const E = this.L.skull.eject;
    ball.mode = 'free';
    ball.x = E.x * MM; ball.y = E.y * MM;
    ball.vx = E.vx * (1 + (this.rng() - 0.5) * 0.25);
    ball.vy = E.vy * (1 + (this.rng() - 0.5) * 0.08);
    ball.sens = 0; ball.still = 0;
    this.emit('skullEject', { ball });
  }

  nudge(dx, dy) {
    for (const b of this.balls) if (b.mode === 'free') { b.vx += dx; b.vy += dy; }
  }

  ballsInShooter() { return this.balls.filter((b) => b.mode === 'free' && b.inShooter && b.y < 0.2).length; }

  // ------------------------------------------------------------------ stepping
  step(dt) {
    this.acc += Math.min(dt, 0.05);
    const h = PHYS.h;
    let n = 0;
    while (this.acc >= h && n < 80) { this._sub(h); this.acc -= h; n++; }
    if (n === 80) this.acc = 0;
  }

  _sub(h) {
    this.time += h;
    // flippers
    const F = PHYS.flipper;
    for (const f of this.flippers) {
      const span = Math.abs(f.span);
      const target = f.pressed ? F.omegaUp / span : -F.omegaDown / span;
      const a = (F.accel / span) * h;
      if (f.w < target) f.w = Math.min(target, f.w + a); else f.w = Math.max(target, f.w - a);
      f.p += f.w * h;
      if (f.p >= 1) { f.p = 1; if (f.w > 0) f.w = 0; }
      if (f.p <= 0) { f.p = 0; if (f.w < 0) f.w = 0; }
      f.angle = f.rest + f.p * f.span;
      f.omega = f.w * f.span;
      f.dx = Math.cos(f.angle); f.dy = Math.sin(f.angle);
    }
    for (const s of this.slings) if (s.cool > 0) s.cool -= h;
    for (const b of this.bumpers) if (b.cool > 0) b.cool -= h;

    const balls = this.balls;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.age += h;
      if (b.mode === 'free') this._free(b, h);
      else if (b.mode === 'ramp') this._ramp(b, h);
      else if (b.mode === 'held' && b.release) this._release(b);
    }
    // ball-ball
    const R = this.R;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.mode !== 'free') continue;
      for (let j = i + 1; j < balls.length; j++) {
        const c = balls[j];
        if (c.mode !== 'free' || c.level !== a.level) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 4 * R * R && d2 > 1e-12) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = 2 * R - d;
          a.x -= nx * pen * 0.5; a.y -= ny * pen * 0.5; c.x += nx * pen * 0.5; c.y += ny * pen * 0.5;
          const rv = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rv < 0) {
            const j2 = -(1 + 0.85) * rv * 0.5;
            a.vx -= j2 * nx; a.vy -= j2 * ny; c.vx += j2 * nx; c.vy += j2 * ny;
            if (rv < -0.5) this.emit('ballHit', { speed: -rv, x: a.x + nx * R, y: a.y + ny * R });
          }
        }
      }
    }
  }

  _collide(b, nx, ny, pen, e, mu) {
    // generic static contact; returns impact speed (>=0)
    b.x += nx * pen; b.y += ny * pen;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return 0;
    const ee = -vn > PHYS.restThreshold ? e : 0;
    const j = -(1 + ee) * vn;
    b.vx += j * nx; b.vy += j * ny;
    // Coulomb friction on the tangential part
    const tx = -ny, ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    const f = Math.min(Math.abs(vt), mu * j);
    b.vx -= Math.sign(vt) * f * tx; b.vy -= Math.sign(vt) * f * ty;
    return -vn;
  }

  _free(b, h) {
    const R = this.R;
    b.vy -= PHYS.gravity * h;
    const dr = 1 - PHYS.drag * h;
    b.vx *= dr; b.vy *= dr;
    let sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > PHYS.maxSpeed * PHYS.maxSpeed) {
      const k = PHYS.maxSpeed / Math.sqrt(sp2);
      b.vx *= k; b.vy *= k; sp2 = PHYS.maxSpeed * PHYS.maxSpeed;
    }
    b.x += b.vx * h; b.y += b.vy * h;
    // rolling visual
    b.spinX = b.vx; b.spinY = b.vy;

    const mu = PHYS.friction;
    const lv = b.level;
    // arch
    for (const a of this.arcs) {
      if (lv === 1 && b.y >= a.cy) {
        const dx = b.x - a.cx, dy = b.y - a.cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const lim = a.r - R;
        if (d > lim) {
          const imp = this._collide(b, -dx / d, -dy / d, d - lim, a.e, mu);
          if (imp > 0.5) this.emit('wall', { speed: imp, x: b.x, y: b.y });
        }
      }
    }
    // segments
    const segs = this.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s.enabled || s.level !== lv || b.x < s.minx || b.x > s.maxx || b.y < s.miny || b.y > s.maxy) continue;
      const sx = s.bx - s.ax, sy = s.by - s.ay;
      let t = s.len2 > 0 ? ((b.x - s.ax) * sx + (b.y - s.ay) * sy) / s.len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + sx * t, py = s.ay + sy * t;
      const dx = b.x - px, dy = b.y - py;
      const lim = R + s.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= lim * lim || d2 < 1e-14) continue;
      const d = Math.sqrt(d2);
      let nx = dx / d, ny = dy / d;
      if (s.tag === 'gate' && s.oneWay) {
        const side = (b.x - s.ax) * s.nx + (b.y - s.ay) * s.ny;
        if (side <= 0 || b.vx * s.nx + b.vy * s.ny >= 0) continue;
        nx = s.nx; ny = s.ny;
        const pen = lim - side;
        if (pen <= 0) continue;
        const imp = this._collide(b, nx, ny, Math.min(pen, lim - d + 0.0005), s.e, mu);
        if (imp > 0.4) this.emit('gate', { id: s.gate, speed: imp });
        continue;
      }
      const vnIn = -(b.vx * nx + b.vy * ny);
      if (s.tag === 'sling') {
        const sl = this.slings.find((q) => q.id === s.sling);
        if (vnIn > 0.3 && t > 0.14 && t < 0.86 && sl.cool <= 0 && !this.tilted) {
          b.x += nx * (lim - d); b.y += ny * (lim - d);
          const vn = b.vx * nx + b.vy * ny;
          const out = PHYS.slingKick + 0.25 * vnIn;
          b.vx += (out - vn) * nx; b.vy += (out - vn) * ny;
          sl.cool = 0.09;
          this.emit('sling', { id: s.sling, speed: vnIn, x: px, y: py, nx, ny });
          continue;
        }
      }
      const imp = this._collide(b, nx, ny, lim - d, s.e, mu);
      if (s.tag === 'drop') {
        if (imp > 0.25) {
          const tg = this.targets[s.target];
          tg.up = false; s.enabled = false;
          this.emit('dropTarget', { id: s.target, speed: imp, x: px, y: py });
        }
      } else if (s.tag === 'standup') {
        if (imp > 0.25) this.emit('standup', { id: s.standup, speed: imp, x: px, y: py });
      } else if (imp > 0.45) {
        this.emit(s.tag === 'gate' ? 'gate' : 'wall', { speed: imp, x: px, y: py, id: s.gate, kind: s.tag });
      }
    }
    // circles
    const circles = this.circles;
    for (let i = 0; i < circles.length; i++) {
      const c = circles[i];
      if (c.level !== lv) continue;
      const dx = b.x - c.x, dy = b.y - c.y;
      const lim = R + c.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= lim * lim || d2 < 1e-14) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      if (c.tag === 'bumper') {
        const vnIn = -(b.vx * nx + b.vy * ny);
        if (vnIn > 0.18 && c.cool <= 0 && !this.tilted) {
          b.x += nx * (lim - d); b.y += ny * (lim - d);
          const vn = b.vx * nx + b.vy * ny;
          const out = PHYS.bumperKick + 0.3 * vnIn;
          b.vx += (out - vn) * nx; b.vy += (out - vn) * ny;
          // a touch of chaos so the ball does not ping-pong on one line
          const j = (this.rng() - 0.5) * 0.3;
          b.vx += -ny * j; b.vy += nx * j;
          c.cool = 0.07;
          this.emit('bumper', { id: c.bumper, speed: vnIn, x: c.x + nx * c.r, y: c.y + ny * c.r, nx, ny });
          continue;
        }
      }
      const imp = this._collide(b, nx, ny, lim - d, c.e, mu);
      if (c.tag === 'bash') { if (imp > 0.3) this.emit('bash', { id: c.bash, speed: imp, x: c.x + nx * c.r, y: c.y + ny * c.r, nx, ny }); continue; }
      if (imp > 0.45) this.emit(c.tag === 'post' ? 'post' : 'wall', { speed: imp, x: c.x + nx * c.r, y: c.y + ny * c.r, kind: c.tag });
    }
    // flippers
    const FP = PHYS.flipper;
    for (const f of this.flippers) {
      if (f.level !== lv) continue;
      const rx = b.x - f.x, ry = b.y - f.y;
      let t = (rx * f.dx + ry * f.dy) / f.len;
      if (t < -0.4 || t > 1.4) continue;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = f.x + f.dx * f.len * t, py = f.y + f.dy * f.len * t;
      const dx = b.x - px, dy = b.y - py;
      const fr = f.rB + (f.rT - f.rB) * t;
      const lim = R + fr;
      const d2 = dx * dx + dy * dy;
      if (d2 >= lim * lim || d2 < 1e-14) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
      b.x += nx * (lim - d); b.y += ny * (lim - d);
      const cx = px + nx * fr - f.x, cy = py + ny * fr - f.y;
      const fvx = -f.omega * cy, fvy = f.omega * cx;
      const rvx = b.vx - fvx, rvy = b.vy - fvy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const ee = -vn > PHYS.restThreshold ? FP.e : 0;
        const j = -(1 + ee) * vn;
        b.vx += j * nx; b.vy += j * ny;
        const tx = -ny, ty = nx;
        const vt = (b.vx - fvx) * tx + (b.vy - fvy) * ty;
        const fr2 = Math.min(Math.abs(vt), FP.mu * j);
        b.vx -= Math.sign(vt) * fr2 * tx; b.vy -= Math.sign(vt) * fr2 * ty;
        if (-vn > 0.8) this.emit('flipperHit', { id: f.id, speed: -vn, x: b.x, y: b.y });
      }
    }

    // turntables
    for (const d of this.discs) {
      if (d.level !== lv) continue;
      const dx = b.x - d.x, dy = b.y - d.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < d.r2) {
        const tvx = -d.omega * dy, tvy = d.omega * dx;
        const k = Math.min(1, 5.5 * h);
        b.vx += (tvx - b.vx) * k; b.vy += (tvy - b.vy) * k;
        if (!b.onDisc) { b.onDisc = d.id; this.emit('disc', { id: d.id, ball: b }); }
      } else if (b.onDisc === d.id) b.onDisc = null;
    }
    // sensors
    let mask = 0;
    for (const s of this.sensors) {
      if (s.level !== lv) continue;
      const dx = b.x - s.x, dy = b.y - s.y;
      if (dx * dx + dy * dy < s.r2) {
        mask |= s.bit;
        if (!(b.sens & s.bit)) this.emit('sensor', { id: s.id, ball: b, vx: b.vx, vy: b.vy });
      }
    }
    b.sens = mask;
    b.inShooter = lv === 1 && b.x > this.shooterX && b.y < 0.83;

    // scoops, saucers, holes
    for (const c of this.scoops) {
      if (!c.enabled || c.level !== lv) continue;
      const dx = b.x - c.x, dy = b.y - c.y;
      if (dx * dx + dy * dy < c.r2 && b.vy > c.minVy && b.vy < c.maxVy) {
        b.mode = 'held'; b.vx = 0; b.vy = 0;
        b.x = c.x; b.y = c.y;
        this.emit(c.event, { ball: b, id: c.id });
        return;
      }
    }
    // ramp entrances
    if (lv === 1) for (let ri = 0; ri < this.rails.length; ri++) {
      const rail = this.rails[ri], en = rail.entry;
      if (!en) continue;
      const dx = b.x - en.x, dy = b.y - en.y;
      if (dx * dx + dy * dy < en.r2) {
        const d = en.dir;
        const along = b.vx * d[0] + b.vy * d[1];
        if (along > en.min) {
          const p0 = rail.path.pts[0];
          b.mode = 'ramp'; b.rail = ri;
          b.sv = Math.min(along, PHYS.ramp.max);
          // nearest arc length to the current position
          b.s = Math.max(0.004, (b.x - p0[0]) * d[0] + (b.y - p0[1]) * d[1]);
          b.committed = false;
          this.emit('rampEnter', { ball: b, speed: along, id: rail.id });
          return;
        }
      }
    }
    // drain / lost (the tunnel level has no drain)
    if (lv === 1 && ((b.y < this.drainY && b.x < this.shooterX) || b.x < -0.03 || b.x > 0.55 || b.y > 1.1 || b.y < -0.03)) {
      this.emit('drain', { ball: b, lost: !(b.y < this.drainY) });
      this.removeBall(b);
      return;
    }
    // stillness tracking for ball search
    if (sp2 < 0.0016) b.still += h; else b.still = 0;
  }

  _release(b) {
    const r = b.release;
    b.release = null;
    this.placeBall(b, r.x, r.y, { vx: r.vx, vy: r.vy, level: r.level ?? 1 });
  }

  _ramp(b, h) {
    const rail = this.rails[b.rail || 0];
    const path = rail.path;
    const RP = PHYS.ramp;
    const p = rampPointAt(path, b.s, this._tmp);
    const i = Math.min(p.i ?? 0, path.pts.length - 2);
    const a = path.pts[i], c = path.pts[i + 1];
    const ds = path.S[i + 1] - path.S[i] || 1e-6;
    const dyds = (c[1] - a[1]) / ds, dzds = (c[2] - a[2]) / ds;
    b.sv += (-PHYS.gravity * dyds - RP.gz * dzds - RP.drag * b.sv) * h;
    if (!b.committed && b.s >= rail.commitS) { b.committed = true; this.emit('rampCommit', { ball: b, id: rail.id }); }
    if (b.committed && b.sv < RP.minCruise) b.sv = RP.minCruise;
    if (b.sv > RP.max) b.sv = RP.max;
    b.s += b.sv * h;
    if (b.s <= 0) {
      const d = rail.entry ? rail.entry.dir : [0, 1];
      b.mode = 'free';
      b.x = path.pts[0][0]; b.y = path.pts[0][1]; b.z = 0;
      const v = Math.max(0.2, -b.sv);
      b.vx = -d[0] * v; b.vy = -d[1] * v; b.sens = 0;
      this.emit('rampFail', { ball: b, id: rail.id });
      return;
    }
    if (b.s >= path.total) {
      const E = rail.exit;
      if (!E || rail.hold) {
        // the rail ends at a junction (lock, diverter): the rules decide where the ball goes next
        const q = path.pts[path.pts.length - 1];
        b.mode = 'held'; b.x = q[0]; b.y = q[1]; b.z = q[2]; b.vx = 0; b.vy = 0;
        this.emit('rampDone', { ball: b, id: rail.id, held: true, speed: b.sv });
        return;
      }
      b.mode = 'free'; b.x = E.x; b.y = E.y; b.z = 0; b.level = E.level;
      b.vx = E.vx; b.vy = E.vy === undefined ? -Math.min(b.sv, RP.exitMax) : E.vy; b.sens = 0;
      this.emit('rampDone', { ball: b, id: rail.id });
      return;
    }
    const q = rampPointAt(path, b.s, this._tmp);
    b.spinX = (q[0] - b.x) / h; b.spinY = (q[1] - b.y) / h;
    b.x = q[0]; b.y = q[1]; b.z = q[2];
  }
}
