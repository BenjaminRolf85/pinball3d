// ERDABWEHR — aliens attack Earth. Millimetres, origin bottom-left, +y up-table.
// Only the lower frame (flippers, slings, in/outlanes, shooter lane, arch and the orbit walls) is the
// shared geometry; the middle and the top are rebuilt from scratch and look nothing like the other tables:
//   - an attack axis straight up the centre: the E-R-D-E alien bank blocks it, behind it the giant war
//     robot stands astride the axis (shoot between its legs), behind the robot the tractor-beam pad
//   - two crossing laser ramps: the left one climbs the left side and comes down the right, the right
//     one climbs higher, crosses over it and comes down the left side
//   - a formation of three saucer bumpers flying in line below the top lanes
//   - shield targets on the left wall, the laser battery on the right wall
//   - the tank emplacement in the upper left pocket; the mothership hovers over the back

import { buildLayout } from './layout.js';

const rad = (d) => (d * Math.PI) / 180;
const r1 = (v) => +v.toFixed(1);

export const ALIEN = {
  ship: { x: 260, y: 985, z: 175, r: 105 },
  beamPad: { x: 240, y: 752 },
  robot: { x: 240, y: 640, legs: 26 },
  tank: { x: 116, y: 904 },
};

// standup helper: centre, direction the face looks at (deg)
function standup(id, x, y, faceDeg, w = 24) {
  const n = [Math.cos(rad(faceDeg)), Math.sin(rad(faceDeg))];
  const u = [-n[1], n[0]];
  return { id, x, y, ux: u[0], uy: u[1], nx: n[0], ny: n[1], w, r: 3, angle: Math.atan2(n[0], -n[1]) };
}

// ramp mouth: an open U of steel facing down the table; returns the rail's entry sensor
function mouth(L, c, dir, halfW = 24, len = 58) {
  const perp = [dir[1], -dir[0]];
  const a0 = [c[0] - perp[0] * halfW, c[1] - perp[1] * halfW];
  const b0 = [c[0] + perp[0] * halfW, c[1] + perp[1] * halfW];
  const a1 = [a0[0] + dir[0] * len, a0[1] + dir[1] * len];
  const b1 = [b0[0] + dir[0] * len, b0[1] + dir[1] * len];
  L.walls.push({ pts: [a0, a1, b1, b0].map((p) => [r1(p[0]), r1(p[1])]), r: 2, e: 0.42, kind: 'wall', h: 22 });
  L.posts.push({ x: r1(a0[0]), y: r1(a0[1]), r: 4.5, e: 0.7 }, { x: r1(b0[0]), y: r1(b0[1]), r: 4.5, e: 0.7 });
  return { x: r1(c[0] + dir[0] * 24), y: r1(c[1] + dir[1] * 24), r: 15, dir };
}

export function buildAlienLayout() {
  const L = buildLayout({ targets: 'ERDE', lanes: 'UFO' });
  L.id = 'alien';
  L.alien = ALIEN;

  // ------------------------------------------------------------ strip the first table's middle: islands, skull, pin-up, ramp
  L.skull = null;
  L.roxy = null;
  L.ramp = null;
  L.sensors = L.sensors.filter((s) => s.id !== 'tunnel');
  const isIslandWall = (w) => w.kind === 'island' && !(w.pts[0][0] === 480 && w.pts[0][1] === 385);
  L.walls = L.walls.filter((w) => !isIslandWall(w) && !(w.pts[0][0] === 82 && w.pts[0][1] === 675));
  L.islands = L.islands.filter((i) => i.id === 'strip');
  // keep the outlane/arch posts, drop the ones that belonged to the islands; cap the orbit walls instead
  L.posts = L.posts.filter((p) => (p.x === 38 && p.y === 343) || (p.x === 442 && p.y === 343) || p.y > 900);
  L.posts.push({ x: 84, y: 474, r: 5, e: 0.7 }, { x: 396, y: 474, r: 5, e: 0.7 });

  // ------------------------------------------------------------ the attack axis: alien bank, robot, beam pad
  // a shallow roof (^) so a ball coming down from above rolls off to either side
  const tilt = rad(20);
  L.dropTargets = [0, 1, 2, 3].map((i) => {
    const left = i < 2;
    const x = 207.5 + i * 21 + (left ? 0 : 0);
    const y = 530 - Math.abs(240 - x) * Math.tan(tilt);
    const u = left ? [Math.cos(tilt), Math.sin(tilt)] : [Math.cos(tilt), -Math.sin(tilt)];
    const n = [u[1], -u[0]];
    return { id: i, letter: 'ERDE'[i], x: r1(x), y: r1(y), ux: u[0], uy: u[1], nx: n[0], ny: n[1], w: 20, r: 3, angle: Math.atan2(u[1], u[0]) };
  });
  const Rb = ALIEN.robot;
  L.bashes = [
    { id: 'robotL', x: Rb.x - Rb.legs, y: Rb.y, r: 9 },
    { id: 'robotR', x: Rb.x + Rb.legs, y: Rb.y, r: 9 },
  ];
  L.sensors.push({ id: 'tunnel', x: Rb.x, y: Rb.y + 2, r: 10 });
  const P = ALIEN.beamPad;

  // ------------------------------------------------------------ saucer formation below the top lanes
  L.bumpers = [
    { id: 0, x: 198, y: 830, r: 26 },
    { id: 1, x: 262, y: 814, r: 26 },
    { id: 2, x: 326, y: 830, r: 26 },
  ];

  // ------------------------------------------------------------ tank emplacement (upper left pocket)
  L.walls.push({ pts: [[150, 848], [150, 966], [123, 954]], r: 2, e: 0.35, kind: 'wall', h: 24 });
  const T = ALIEN.tank;

  // ------------------------------------------------------------ scoops
  L.scoops = [
    { id: 'beam', x: P.x, y: P.y, r: 13, minVy: 0.1 },
    { id: 'tank', x: T.x, y: T.y, r: 13, minVy: -0.3 },
  ];
  L.ejects = {
    beamL: { x: 221, y: 742, vx: -0.75, vy: -0.35 },
    beamR: { x: 259, y: 742, vx: 0.75, vy: -0.35 },
    beam: { x: 221, y: 742, vx: -0.75, vy: -0.35 },
    tank: { x: 126, y: 872, vx: 0.32, vy: -1.05 },
  };

  // ------------------------------------------------------------ two crossing laser ramps
  const dL = [-0.13, 0.99], dR = [0.17, 0.985];
  const entryL = mouth(L, [140, 588], dL);
  const entryR = mouth(L, [340, 588], dR);
  L.rails = [
    {
      // left ramp: up the left side, across the top below the saucers' lanes, down the right side
      id: 'cross', entry: entryL, exit: { x: 421, y: 366, vx: 0 },
      path: [[140, 588, 0], [137, 612, 3], [133, 650, 16], [134, 700, 32], [142, 760, 48], [160, 820, 58], [196, 866, 63],
        [252, 884, 65], [312, 878, 65], [370, 856, 65], [418, 818, 63], [450, 750, 58], [462, 660, 48], [458, 560, 34],
        [448, 470, 18], [436, 410, 6], [424, 372, 0]],
    },
    {
      // right ramp: steeper and higher, crosses over the left ramp, round the top of the arch and down the left
      id: 'laser', entry: entryR, exit: { x: 60, y: 360, vx: 0 },
      path: [[340, 588, 0], [344, 612, 6], [350, 660, 30], [358, 720, 56], [374, 790, 82], [396, 850, 98], [414, 912, 102],
        [398, 968, 102], [340, 1006, 100], [250, 1016, 98], [160, 1000, 94], [96, 960, 88], [54, 890, 78], [36, 800, 66],
        [30, 700, 52], [32, 600, 38], [40, 500, 22], [54, 420, 8], [60, 362, 0]],
    },
  ];

  // ------------------------------------------------------------ shield targets (left wall) and laser battery (right wall)
  L.standups = [
    standup(0, 81, 716, 0),
    standup(1, 81, 762, 0),
    standup(2, 399, 704, 180),
    standup(3, 399, 744, 180),
    standup(4, 399, 784, 180),
  ];

  // ------------------------------------------------------------ second spinner in the right orbit
  L.sensors.push({ id: 'spinnerR', x: 429, y: 600, r: 14 });
  L.spinners = [L.spinner, { x: 429, y: 600, w: 34 }];

  // ------------------------------------------------------------ lamps: rebuilt for this table
  const keep = new Set(['shootAgain', 'laneA', 'laneM', 'laneP', 'inL', 'inR', 'outL', 'outR',
    'vu0', 'vu1', 'vu2', 'vu3', 'vu4', 'vu5', 'vu6', 'vu7', 'vu8', 'vu9', 'vu10']);
  const lights = L.lights.filter((l) => keep.has(l.id));
  const Lt = (id, x, y, o = {}) => lights.push({ id, x, y, r: 9, color: 'green', shape: 'circle', ...o });
  for (const l of lights) {
    if (l.id.startsWith('vu')) { const i = +l.id.slice(2); l.x = 240; l.y = 300 + i * 13; l.color = i < 6 ? 'blue' : i < 9 ? 'green' : 'red'; }
  }
  // the attack axis, bottom to top
  L.dropTargets.forEach((t) => Lt(`rock${t.id}`, r1(t.x + t.nx * 22), r1(t.y + t.ny * 22), { r: 7, color: 'green', label: t.letter, labelSide: 'in' }));
  Lt('extraBall', 240, 456, { r: 8, color: 'white' });
  Lt('robotArrow', 240, 572, { r: 12, shape: 'arrow', color: 'red', rot: 0 });
  Lt('superJackpot', 240, 600, { r: 6, color: 'white' });
  for (let i = 0; i < 5; i++) Lt(`armor${i}`, 216 + i * 12, 614, { r: 4, color: 'red' });
  Lt('beamArrow', 240, 690, { r: 11, shape: 'arrow', color: 'green', rot: 0 });
  Lt('lock1', 226, 716, { r: 5.5, color: 'green' });
  Lt('lock2', 240, 722, { r: 5.5, color: 'green' });
  Lt('lock3', 254, 716, { r: 5.5, color: 'green' });
  for (let i = 0; i < 5; i++) {
    const a = rad(25 + i * 32.5);
    Lt(`hull${i}`, r1(P.x + Math.cos(a) * 34), r1(P.y + Math.sin(a) * 34), { r: 5, color: 'red' });
  }
  // ramps, walls, tank
  Lt('crossArrow', 140, 556, { r: 12, shape: 'arrow', color: 'green', rot: 8 });
  Lt('laserArrow', 340, 556, { r: 12, shape: 'arrow', color: 'blue', rot: -10 });
  Lt('jackpot', 340, 528, { r: 7, color: 'white' });
  Lt('crossJackpot', 140, 528, { r: 7, color: 'white' });
  Lt('tankArrow', 128, 820, { r: 10, shape: 'arrow', color: 'amber', rot: 10 });
  Lt('eleven0', 100, 716, { r: 6, color: 'blue' });
  Lt('eleven1', 100, 762, { r: 6, color: 'blue' });
  for (let i = 0; i < 3; i++) Lt(`battery${i}`, 380, 704 + i * 40, { r: 6, color: 'blue' });
  // invasion waves: five lamps in a fan left of the bank
  for (let i = 0; i < 5; i++) Lt(`w${i}`, 178 - i * 4, 432 + i * 22, { r: 7.5, color: 'amber' });
  // chase lights up both orbits
  for (let i = 0; i < 7; i++) {
    Lt(`chaseL${i}`, 51, 470 + i * 46, { r: 7, shape: 'arrow', color: 'green', rot: 0 });
    Lt(`chaseR${i}`, 429, 470 + i * 42, { r: 7, shape: 'arrow', color: 'green', rot: 0 });
  }
  // bonus multipliers 2x 4x 6x 8x between the flippers
  [[186, 236], [222, 226], [258, 226], [294, 236]].forEach(([x, y], i) => Lt(`bonus${(i + 1) * 2}`, x, y, { r: 10, color: 'amber', label: `${(i + 1) * 2}X` }));
  L.lights = lights;

  // ------------------------------------------------------------ decoration anchors (renderer / Blender)
  L.decor = {
    ...L.decor,
    tesla: [{ x: 12, y: 990, z: 40 }, { x: 508, y: 990, z: 40 }],
    saucers: [
      { x: -14, y: 760, z: 120, r: 30 },
      { x: 534, y: 820, z: 135, r: 30 },
    ],
  };
  return L;
}

export default buildAlienLayout;
