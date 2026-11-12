// Cradle shots: ball held on a raised flipper, released, re-flipped after a delay (the way players aim).
import { buildRotorLayout } from '../src/layout-rotor.js';
import { Physics } from '../src/physics.js';
const L = buildRotorLayout();
const tally = {};
for (const side of ['L', 'R']) {
  for (let d = 0.02; d < 0.6; d += 0.01) {
    const p = new Physics(L, () => 0.5);
    p.setScoop('cuchi', true);
    p.addBall(side === 'L' ? 59 : 421, 300, 0, 0);
    p.setFlipper(side, true);
    for (let t = 0; t < 3; t += 1 / 240) p.step(1 / 240);
    p.setFlipper(side, false);
    let t = 0, fired = false, rel = false, res = 'none';
    p.events.length = 0;
    while (t < 5 && p.balls.length) {
      if (!fired && t >= d) { p.setFlipper(side, true); fired = true; }
      if (fired && !rel && t >= d + 0.25) { p.setFlipper(side, false); rel = true; }
      p.step(1 / 240); t += 1 / 240;
      const e = p.events.find((x) => ['scoop', 'rampEnter', 'drain'].includes(x.type) || (x.type === 'sensor' && /orb/.test(x.id)));
      p.events.length = 0;
      if (e) { res = e.type === 'sensor' ? e.id : e.type + ':' + (e.id || ''); if (e.type !== 'sensor') break; }
      if (p.balls[0] && p.balls[0].mode === 'held') break;
    }
    tally[side + ' ' + res] = (tally[side + ' ' + res] || 0) + 1;
  }
}
console.log(tally);
