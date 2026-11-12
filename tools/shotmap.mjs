// For each flipper: let a ball roll down the inlane, flip after a delay, and record the first feature hit.
import { buildLayout } from '../src/layout.js';
import { Game } from '../src/game.js';
const want = new Set(['rampEnter', 'rampDone', 'rampFail', 'orbit', 'skullEat', 'dropTarget', 'bumper', 'rollover', 'spinner', 'drainBall', 'sling']);
for (const side of ['L', 'R']) {
  const rows = [];
  for (let d = 0.2; d < 1.5; d += 0.01) {
    const g = new Game(buildLayout(), () => 0.5);
    g.startGame();
    for (const b of [...g.phys.balls]) g.phys.removeBall(b);
    g.skillActive = false; g.phys.setGate('top', false); g.ballSaveArmed = false;
    const b = g.phys.addBall(side === 'L' ? 59 : 421, 300, 0, 0);
    const seen = []; let maxY = 0, vAt = 0;
    g.on((e) => { if (want.has(e.type) && seen.length < 4) seen.push(e.type + (e.side || e.id || '')); });
    let t = 0, flipped = false, rel = false;
    while (t < 6 && g.phys.balls.length) {
      if (!flipped && t >= d) { g.flipper(side, true); flipped = true; }
      if (flipped && !rel && t >= d + 0.2) { g.flipper(side, false); rel = true; }
      g.update(1 / 240); t += 1 / 240;
      if (flipped && b.y > maxY) maxY = b.y;
      if (flipped && !vAt && t > d + 0.06) vAt = Math.hypot(b.vx, b.vy);
    }
    rows.push([d.toFixed(2), vAt.toFixed(2), (maxY * 1000).toFixed(0), seen.join(',')]);
  }
  console.log('== flipper', side);
  let last = '';
  for (const r of rows) { const k = r[3]; if (k !== last) console.log(r.join('  ')); last = k; }
}
