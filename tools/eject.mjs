// Where does the skull kick-out land if nobody flips? (should reach a flipper, not the drain gap)
import { buildLayout } from '../src/layout.js';
import { Game } from '../src/game.js';
let seed = 1; const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const res = {};
for (let i = 0; i < 60; i++) {
  const g = new Game(buildLayout(), rng);
  g.startGame(); for (const b of [...g.phys.balls]) g.phys.removeBall(b);
  g.ballSaveArmed = false; g.skillActive = false;
  const b = g.phys.addBall(240, 566); g.phys.ejectSkull(b);
  let first = null, t = 0;
  g.on((e) => { if (!first && ['flipperHit', 'sling', 'drainBall', 'rollover'].includes(e.type)) first = e.type + (e.id || ''); });
  let minGapY = null;
  while (t < 4 && !first) { g.update(1 / 240); t += 1 / 240; if (b.y < 0.125 && minGapY === null) minGapY = b.x; }
  const k = first || `rest@${(b.x * 1000) | 0},${(b.y * 1000) | 0}`;
  res[k] = (res[k] || 0) + 1;
}
console.log(res);
