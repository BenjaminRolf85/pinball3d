// Physics-only shot map for the rotor layout: ball rolls down an inlane, flipper fires after a delay.
import { buildRotorLayout } from '../src/layout-rotor.js';
import { Physics } from '../src/physics.js';
const L = buildRotorLayout();
const major = new Set(['scoop', 'rampEnter', 'rampDone', 'rampFail', 'drain']);
function run(side, delay, start) {
  const p = new Physics(L, () => 0.5);
  p.setScoop('cuchi', true);
  const b = p.addBall(start[0], start[1], 0, 0);
  const seen = [];
  let t = 0, fired = false, rel = false;
  while (t < 5 && p.balls.length) {
    if (!fired && t >= delay) { p.setFlipper(side, true); fired = true; }
    if (fired && !rel && t >= delay + 0.22) { p.setFlipper(side, false); rel = true; }
    p.step(1 / 240); t += 1 / 240;
    for (const e of p.events) {
      if (e.type === 'sensor' && /orb|spinner|lane|village/.test(e.id)) seen.push(e.id);
      if (major.has(e.type)) seen.push(e.type === 'scoop' ? 'SCOOP:' + e.id : e.type === 'rampEnter' ? 'RAMP:' + e.id : e.type);
      if (e.type === 'bumper') seen.push('pop');
      if (e.type === 'dropTarget') seen.push('drop');
      if (e.type === 'standup') seen.push('stand');
    }
    p.events.length = 0;
    if (seen.some((x) => x.startsWith('SCOOP') || x.startsWith('RAMP') || x === 'drain')) break;
    if (b.mode === 'held') break;
  }
  return seen.slice(0, 4).join(',');
}
const tally = {};
for (const [side, start] of [['L', [59, 300]], ['R', [421, 300]]]) {
  console.log('== flipper', side);
  let last = '';
  for (let d = 0.6; d < 1.35; d += 0.01) {
    const r = run(side, d, start);
    for (const k of r.split(',')) if (/SCOOP|RAMP|orb/.test(k)) tally[side + ' ' + k] = (tally[side + ' ' + k] || 0) + 1;
    if (r !== last) console.log(d.toFixed(2), r);
    last = r;
  }
}
console.log(tally);
