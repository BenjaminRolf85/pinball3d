// RIFFGEWITTER — the hard-rock table, made denser: on top of the original geometry it gets
// a third flipper, a backstage scoop (setlist songs), a spinning turntable that flings the ball,
// a microphone-stand bash target, a second spinner and chase lights up both orbits.

import { buildLayout } from './layout.js';

const r1 = (v) => +v.toFixed(1);
const rad = (d) => (d * Math.PI) / 180;

export function buildRiffLayout() {
  const L = buildLayout({ targets: 'ROCK', lanes: 'AMP' });
  L.id = 'riff';

  // drums moved a little so the backstage pocket fits in the upper right
  L.bumpers = [
    { id: 0, x: 210, y: 858, r: 26 },
    { id: 1, x: 310, y: 866, r: 26 },
    { id: 2, x: 260, y: 792, r: 26 },
  ];

  // ------------------------------------------------------------ backstage scoop (upper right pocket)
  L.walls.push({ pts: [[344, 860], [344, 975], [390, 962]], r: 2, e: 0.35, kind: 'wall', h: 24 });
  L.backstage = { x: 377, y: 896 };
  L.scoops = [{ id: 'backstage', x: L.backstage.x, y: L.backstage.y, r: 13, minVy: -0.3 }];
  L.ejects = { backstage: { x: 368, y: 872, vx: -0.35, vy: -1.0 } };

  // ------------------------------------------------------------ third flipper on the right orbit wall
  L.flippers.push({ id: 'U', button: 'R', side: 1, x: 402, y: 708, len: 62, rBase: 10, rTip: 6.5, rest: rad(200), up: rad(162) });

  // ------------------------------------------------------------ turntable and microphone stand
  L.discs = [{ id: 'vinyl', x: 118, y: 792, r: 32, omega: 7 }];
  L.bashes = [{ id: 'mic', x: 196, y: 738, r: 7 }];

  // ------------------------------------------------------------ second spinner in the right orbit
  L.sensors.push({ id: 'spinnerR', x: 429, y: 600, r: 14 });
  L.spinners = [L.spinner, { x: 429, y: 600, w: 34 }];

  // ------------------------------------------------------------ extra lamps
  const Lt = (id, x, y, o = {}) => L.lights.push({ id, x, y, r: 9, color: 'orange', shape: 'circle', ...o });
  for (let i = 0; i < 5; i++) Lt(`song${i}`, 142, 442 - i * 22, { r: 7, color: 'amber' });
  Lt('backstageArrow', 372, 838, { r: 10, shape: 'arrow', color: 'red', rot: 0 });
  Lt('vinylArrow', 150, 742, { r: 9, shape: 'arrow', color: 'blue', rot: 40 });
  Lt('micLamp', 196, 712, { r: 6, color: 'white' });
  for (let i = 0; i < 7; i++) {
    Lt(`chaseL${i}`, 51, 470 + i * 46, { r: 7, shape: 'arrow', color: 'red', rot: 0 });
    Lt(`chaseR${i}`, 429, 470 + i * 42, { r: 7, shape: 'arrow', color: 'red', rot: 0 });
  }
  // the original orbit arrows sit inside the new chase rows
  L.lights = L.lights.filter((l) => l.id !== 'orbLArrow' && l.id !== 'orbRArrow');

  // decoration anchors for Blender
  L.decor = { ...L.decor, truss: { x: 260, y: 1010, span: 470, height: 150 } };
  void r1;
  return L;
}

export default buildRiffLayout;
