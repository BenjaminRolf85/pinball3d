// Headless test: plays many games with a simple bot and reports statistics.
import { buildLayout } from '../src/layout.js';
import { buildRotorLayout } from '../src/layout-rotor.js';
import { Game } from '../src/game.js';
import { GameRotor } from '../src/game-rotor.js';
import { GameRiff } from '../src/game-riff.js';
import { buildRiffLayout } from '../src/layout-riff.js';
import { GameAlien } from '../src/game-alien.js';
import { buildAlienLayout } from '../src/layout-alien.js';
const TABLE = process.env.TABLE || 'riff';
const makeGame = (rng) => (TABLE === 'rotor' ? new GameRotor(buildRotorLayout(), rng) : TABLE === 'alien' ? new GameAlien(buildAlienLayout(), rng) : new GameRiff(buildRiffLayout(), rng));
import { layoutSvg } from './layout-svg.mjs';
import fs from 'node:fs';

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function playGame(seed, opts = {}) {
  const rng = mulberry(seed);
  const g = makeGame(rng);
  const counts = {};
  const trace = [];
  g.on((e) => { counts[e.type] = (counts[e.type] || 0) + 1; if (opts.log && !['score', 'lamps', 'wall', 'post', 'flipperUp', 'flipperDown', 'flipperHit', 'spinTick'].includes(e.type)) console.log(g.time.toFixed(2), e.type, e.key || '', e.points || ''); });
  g.startGame();
  const dt = 1 / 120;
  const hold = { L: 0, R: 0 };
  const skill = opts.skill ?? 0.7;
  let t = 0, maxT = opts.maxT || 1500, plungeT = 0;
  let tr = [];
  while (g.state !== 'gameover' && t < maxT) {
    // bot: generic for any flipper (main pair, third flipper, tunnel flipper)
    const want = {};
    for (const f of g.phys.flippers) {
      const a = f.rest, sgn = f.span > 0 ? 1 : -1;
      const ux = Math.cos(a), uy = Math.sin(a), nx = -Math.sin(a) * sgn, ny = Math.cos(a) * sgn;
      for (const b of g.phys.balls) {
        if (b.mode !== 'free' || b.level !== f.level) continue;
        const rx = b.x - f.x, ry = b.y - f.y;
        const t = (rx * ux + ry * uy) / f.len;
        if (t < 0.12 || t > 1.0) continue;
        const gap = rx * nx + ry * ny - (f.rB + (f.rT - f.rB) * t) - 0.0135;
        const vn = b.vx * nx + b.vy * ny;
        const lead = Math.max(0, -vn) * 0.018 + 0.004 + (1 - skill) * rng() * 0.02;
        if (gap < lead && gap > -0.02) want[f.button] = true;
      }
    }
    for (const id of ['L', 'R']) {
      if (want[id] && hold[id] <= 0) hold[id] = 0.14 + rng() * 0.1;
      if (hold[id] > 0) hold[id] -= dt;
      const press = hold[id] > 0.02;
      const cur = g.phys.flippers.find((f) => f.button === id).pressed;
      if (press !== cur) g.flipper(id, press);
    }
    if (g.state === 'playing' && g.phys.ballsInShooter() > 0 && !g.phys.balls.some((b) => b.auto)) {
      plungeT += dt;
      if (plungeT > 0.6 && !g.plunger.held) g.plungerDown();
      if (g.plunger.held && g.plunger.charge >= (opts.plunge ?? 0.45 + rng() * 0.5)) { g.plungerUp(); plungeT = 0; }
    } else plungeT = 0;
    g.update(dt);
    t += dt;
    if (opts.trace && g.phys.balls[0]) { const b = g.phys.balls[0]; tr.push([b.x, b.y]); if (tr.length > opts.trace) { trace.push(tr); tr = []; } }
  }
  if (tr.length) trace.push(tr);
  return { score: g.score, time: g.stats.time, stats: g.stats, counts, trace, timeout: t >= maxT };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = +(process.argv[2] || 60);
  const agg = {}; let scores = [], times = [], timeouts = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const r = playGame(1000 + i);
    scores.push(r.score); times.push(r.time); if (r.timeout) timeouts++;
    for (const k in r.counts) agg[k] = (agg[k] || 0) + r.counts[k];
  }
  scores.sort((a, b) => a - b);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`games ${N}  wall ${(Date.now() - t0) / 1000}s  timeouts ${timeouts}`);
  console.log(`score median ${scores[N >> 1]}  avg ${Math.round(avg(scores))}  max ${scores[N - 1]}  min ${scores[0]}`);
  console.log(`game time avg ${avg(times).toFixed(1)}s  per ball ${(avg(times) / 3).toFixed(1)}s`);
  const keys = TABLE === 'alien' ? ['bumper', 'sling', 'dropTarget', 'bankComplete', 'rampEnter', 'rampDone', 'orbit', 'spinner', 'scoopEnter', 'tunnel', 'frenzy', 'robotBash', 'robotDown', 'battery', 'laserReady', 'laserFire', 'shipHit', 'shipDown', 'abduct', 'multiballStart', 'jackpot', 'superJackpot', 'waveStart', 'waveDone', 'waveFail', 'counterStart', 'standup', 'outlane', 'drainBall', 'ballSaved', 'ballSearch', 'extraBall', 'kickback'] : TABLE === 'rotor' ? ['bumper', 'sling', 'dropTarget', 'bankComplete', 'rampEnter', 'rampDone', 'diverter', 'orbit', 'spinner', 'scoopEnter', 'kheSanh', 'village', 'missionStart', 'missionDone', 'missionFail', 'lock', 'multiballStart', 'jackpot', 'superJackpot', 'tunnelEnter', 'tunnelTarget', 'tunnelDone', 'tunnelExit', 'cuchiLit', 'laneComplete', 'outlane', 'drainBall', 'ballSaved', 'ballSearch', 'extraBall', 'kickback'] : ['bumper', 'sling', 'dropTarget', 'bankComplete', 'rampEnter', 'rampDone', 'rampFail', 'orbit', 'spinner', 'skullEat', 'lock', 'multiballStart', 'jackpot', 'superJackpot', 'rollover', 'laneComplete', 'skillShot', 'outlane', 'drainBall', 'ballSaved', 'ballSearch', 'extraBall', 'eleven', 'tunnel', 'frenzy', 'kickback', 'standup', 'elevenTargets', 'scoopEnter', 'songStart', 'songDone', 'songFail', 'finaleStart', 'disc', 'bash', 'scratch'];
  console.log(keys.map((k) => `${k}:${((agg[k] || 0) / N).toFixed(2)}`).join('  '));
  const r = playGame(7, { trace: 4000 });
  fs.writeFileSync(process.argv[3] || 'build/trace.svg', layoutSvg(r.trace.slice(0, 6), TABLE === 'rotor' ? buildRotorLayout() : TABLE === 'alien' ? buildAlienLayout() : buildRiffLayout()));
}
