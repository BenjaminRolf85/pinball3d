// ROTORSTURM — its own table layout (Vietnam 1968). Millimetres, origin bottom-left, +y up-table.
// The lower third (flippers, slings, in/outlanes, shooter lane, arch and orbits) is the proven
// geometry of the first table; everything above it is new:
//   - helipad (level 2, +60 mm) upper left with the helicopter and a physical 3-ball lock,
//     reached by the "Hueyeinsatz" wire ramp that spirals around it
//   - supply ramp on the right with an M16 diverter at its apex (returns to either inlane)
//   - Khe Sanh base scoop in the right island, village scoop upper right, sunken helmet saucer
//   - Cu Chi tunnel entrance in the right orbit, leading into a tunnel under glass (level 0)
//     with its own mini flipper
//   - third flipper on the right orbit wall, star pop bumpers, E-V-A-C drops, radio standups

import { buildLayout } from './layout.js';

const rad = (d) => (d * Math.PI) / 180;
const r1 = (v) => +v.toFixed(1);

export const ROTOR = {
  padZ: 60,
  padPoly: [[50, 835], [195, 835], [195, 955], [150, 990], [85, 975], [50, 930]],
  lockSlots: [[150, 872], [125, 870], [100, 868]],
  heli: { x: 130, y: 918 },
  tunnel: { x0: 182, x1: 298, y0: 300, y1: 420, z: -36 },
};

export function buildRotorLayout() {
  const L = buildLayout({ targets: 'EVAC', lanes: 'SOS' });
  L.id = 'rotor';
  L.rotor = ROTOR;

  // ------------------------------------------------------------ remove the first table's centre pieces
  L.skull = null;
  L.roxy = null;
  L.ramp = null;
  L.sensors = L.sensors.filter((s) => s.id !== 'tunnel');
  // the first table's feeder guide toward the pin-up would point into the new ramp mouth
  L.walls = L.walls.filter((w) => !(w.pts[0][0] === 82 && w.pts[0][1] === 675));

  // ------------------------------------------------------------ pop bumpers (stars) moved right of the helipad
  L.bumpers = [
    { id: 0, x: 225, y: 858, r: 26 },
    { id: 1, x: 318, y: 866, r: 26 },
    { id: 2, x: 272, y: 796, r: 26 },
  ];

  // ------------------------------------------------------------ helmet saucer + two radio standups
  const helmet = { x: 240, y: 612 };
  L.helmet = helmet;
  L.standups = [
    { x: 262, y: 560, a: -37 },
    { x: 281, y: 585, a: -37 },
  ].map((t, i) => {
    const u = [Math.cos(rad(t.a)), Math.sin(rad(t.a))];
    const n = [-u[1], u[0]];
    const nn = n[1] < 0 ? n : [-n[0], -n[1]]; // face down toward the flippers
    // model front (-Y) must face nn
    return { id: i, x: t.x, y: t.y, ux: u[0], uy: u[1], nx: nn[0], ny: nn[1], w: 24, r: 3, angle: Math.atan2(nn[0], -nn[1]) };
  });

  // ------------------------------------------------------------ Hueyeinsatz ramp entrance (left, aimed by the right flipper)
  const hDir = [-0.2588, 0.9659];
  const hMouth = [176, 652];
  const hPerp = [hDir[1], -hDir[0]];
  const hL0 = [hMouth[0] - hPerp[0] * 25, hMouth[1] - hPerp[1] * 25];
  const hR0 = [hMouth[0] + hPerp[0] * 25, hMouth[1] + hPerp[1] * 25];
  const hL1 = [hL0[0] + hDir[0] * 62, hL0[1] + hDir[1] * 62];
  const hR1 = [hR0[0] + hDir[0] * 62, hR0[1] + hDir[1] * 62];
  L.walls.push({ pts: [hL0, hL1, hR1, hR0].map((p) => [r1(p[0]), r1(p[1])]), r: 2, e: 0.42, kind: 'wall', h: 22 });
  L.posts.push({ x: r1(hL0[0]), y: r1(hL0[1]), r: 4.5, e: 0.7 }, { x: r1(hR0[0]), y: r1(hR0[1]), r: 4.5, e: 0.7 });
  L.hueyMouth = { mouth: hMouth, dir: hDir, halfW: 25 };

  // ------------------------------------------------------------ village scoop pocket (upper right, between pops and orbit wall)
  L.walls.push({ pts: [[344, 860], [344, 975], [390, 962]], r: 2, e: 0.35, kind: 'wall', h: 24 });
  L.village = { x: 379, y: 896 };

  // ------------------------------------------------------------ third flipper on the right orbit wall
  L.flippers.push({ id: 'U', button: 'R', side: 1, x: 402, y: 708, len: 62, rBase: 10, rTip: 6.5, rest: rad(200), up: rad(162) });

  // ------------------------------------------------------------ scoops set into the island faces
  // left island: US base Khe Sanh (where the first table had its drop targets)
  // right island: Cu Chi tunnel entrance, opened by two orbits
  const faceScoop = (A0, A1, flip) => {
    const ux = A1[0] - A0[0], uy = A1[1] - A0[1];
    const len = Math.hypot(ux, uy);
    let n = [-uy / len, ux / len];
    if (flip) n = [-n[0], -n[1]];
    const mid = [(A0[0] + A1[0]) / 2, (A0[1] + A1[1]) / 2];
    return { x: r1(mid[0] + n[0] * 14), y: r1(mid[1] + n[1] * 14), fx: r1(mid[0]), fy: r1(mid[1]), nx: n[0], ny: n[1] };
  };
  L.kheSanh = faceScoop([86, 512], [142, 596], true);
  L.cuchi = faceScoop([396, 474], L.islands.find((i) => i.id === 'right').pts[1], false);

  // ------------------------------------------------------------ five star drop targets across the centre, the tunnel to the upper level behind them
  L.dropTargets = [0, 1, 2, 3, 4].map((i) => ({
    id: i, letter: '*', x: 196 + i * 22, y: 712, ux: 1, uy: 0, nx: 0, ny: -1, w: 20.5, r: 3, angle: 0,
  }));
  L.tunnelArch = { x: 240, y: 744 };

  // ------------------------------------------------------------ tunnel under glass (level 0)
  const T = ROTOR.tunnel;
  L.walls.push(
    { pts: [[T.x0, T.y0 + 30], [T.x0, T.y1], [T.x1, T.y1], [T.x1, T.y0 + 12]], r: 2, e: 0.4, kind: 'tunnel', h: 30, level: 0 },
    // floor: slopes from the mini flipper down to the exit hole
    { pts: [[T.x0, T.y0 + 30], [T.x0 + 8, T.y0 + 22]], r: 2, e: 0.3, kind: 'tunnel', h: 30, level: 0 },
    { pts: [[T.x0 + 52, T.y0 + 8], [T.x1 - 26, T.y0], [T.x1, T.y0 + 12]], r: 2, e: 0.3, kind: 'tunnel', h: 30, level: 0 },
    // a timber prop in the middle of the chamber
    { pts: [[240, 372], [252, 360]], r: 4, e: 0.5, kind: 'tunnel', h: 30, level: 0 },
  );
  L.flippers.push({ id: 'T', button: 'L', side: -1, level: 0, x: T.x0 + 10, y: T.y0 + 22, len: 44, rBase: 7.5, rTip: 5, rest: rad(-22), up: rad(26) });
  L.standups.push(
    ...[206, 240, 274].map((x, i) => ({ id: 10 + i, level: 0, x, y: T.y1 - 16, ux: 1, uy: 0, nx: 0, ny: -1, w: 22, r: 3, angle: 0 })),
  );
  L.tunnelEntry = { x: 224, y: 384 };

  // ------------------------------------------------------------ scoops (held → the rules decide what happens)
  L.scoops = [
    { id: 'helmet', x: helmet.x, y: helmet.y, r: 12, maxVy: 99, minVy: -1.25 },
    { id: 'kheSanh', x: L.kheSanh.x, y: L.kheSanh.y, r: 12 },
    { id: 'village', x: L.village.x, y: L.village.y, r: 13, minVy: -0.3 },
    { id: 'cuchi', x: L.cuchi.x, y: L.cuchi.y, r: 12, enabled: false },
    { id: 'arch', x: L.tunnelArch.x, y: L.tunnelArch.y, r: 16, minVy: 0.1 },
    { id: 'tunnelExit', level: 0, x: 272, y: 316, r: 12 },
  ];
  L.ejects = {
    helmet: { x: 236, y: 596, vx: -0.25, vy: -1.05 },
    kheSanh: { x: r1(L.kheSanh.x + L.kheSanh.nx * 26), y: r1(L.kheSanh.y + L.kheSanh.ny * 26), vx: L.kheSanh.nx * 0.9, vy: L.kheSanh.ny * 0.9 - 0.25 },
    village: { x: 370, y: 872, vx: -0.35, vy: -1.0 },
  };

  // ------------------------------------------------------------ rails (x, y, z in mm; z = height of the ball above its resting height)
  const supplyMouth = [350, 555];
  const supplyDir = [0.309, 0.951];
  L.rails = [
    {
      id: 'supply', hold: true,
      entry: { x: r1(supplyMouth[0] + supplyDir[0] * 26), y: r1(supplyMouth[1] + supplyDir[1] * 26), r: 15, dir: supplyDir },
      path: [[350, 555, 0], [358, 581, 3], [372, 624, 20], [395, 700, 40], [422, 775, 55], [440, 850, 64], [442, 915, 70]],
    },
    {
      id: 'retR', exit: { x: 421, y: 366, vx: 0 },
      path: [[442, 915, 70], [462, 880, 70], [468, 790, 62], [466, 660, 48], [458, 530, 30], [442, 430, 14], [424, 372, 0]],
    },
    {
      id: 'retL', exit: { x: 60, y: 360, vx: 0 },
      path: [[442, 915, 70], [422, 985, 80], [330, 1040, 86], [230, 1042, 88], [140, 1008, 86], [72, 950, 80], [40, 860, 70], [30, 760, 58], [30, 640, 40], [40, 500, 22], [54, 420, 8], [60, 362, 0]],
    },
    {
      id: 'huey', hold: true,
      entry: { x: r1(hMouth[0] + hDir[0] * 24), y: r1(hMouth[1] + hDir[1] * 24), r: 15, dir: hDir },
      path: [[176, 652, 0], [168, 690, 6], [153, 740, 22], [130, 790, 38], [100, 832, 52], [78, 872, 60], [74, 915, 63], [96, 950, 64], [138, 962, 64], [172, 940, 63], [180, 905, 62], [166, 880, 61]],
    },
    {
      id: 'padReturn', exit: { x: 62, y: 360, vx: 0 },
      path: [[166, 880, 61], [120, 864, 60], [84, 846, 58], [62, 805, 52], [56, 740, 44], [56, 640, 32], [58, 520, 18], [60, 430, 6], [62, 362, 0]],
    },
  ];
  L.rampExits = { huey: [166, 880, 61], supply: [442, 915, 70] };

  // ------------------------------------------------------------ extra sensors
  L.sensors.push({ id: 'spinnerR', x: 429, y: 600, r: 14 });
  L.spinners = [L.spinner, { x: 429, y: 600, w: 34 }];

  // ------------------------------------------------------------ lamps: rebuild the insert set for this table
  const keep = new Set(['shootAgain', 'laneA', 'laneM', 'laneP', 'inL', 'inR', 'outL', 'outR', 'eleven0', 'eleven1']);
  const lights = L.lights.filter((l) => keep.has(l.id));
  const Lt = (id, x, y, o = {}) => lights.push({ id, x, y, r: 9, color: 'orange', shape: 'circle', ...o });
  for (const l of lights) if (l.id.startsWith('eleven')) { const t = L.standups[+l.id.slice(-1)]; l.x = t.x + t.nx * 17; l.y = t.y + t.ny * 17; l.color = 'blue'; }
  // M-I-S-S-I-O-N ladder down the centre plus five mission lamps
  'MISSION'.split('').forEach((c, i) => Lt(`ladder${i}`, 168, 560 - i * 21, { r: 8, color: 'amber', label: c, labelSide: 'in' }));
  ['m0', 'm1', 'm2', 'm3', 'm4'].forEach((id, i) => Lt(id, 194, 548 - i * 30, { r: 8, color: 'orange' }));
  // shot arrows
  Lt('hueyArrow', 150, 600, { r: 13, shape: 'arrow', color: 'green', rot: 15 });
  Lt('helmetArrow', 240, 566, { r: 12, shape: 'arrow', color: 'red', rot: 0 });
  Lt('supplyArrow', 334, 508, { r: 13, shape: 'arrow', color: 'orange', rot: -18 });
  Lt('kheSanhArrow', r1(L.kheSanh.x + L.kheSanh.nx * 40), r1(L.kheSanh.y + L.kheSanh.ny * 40), { r: 10, shape: 'arrow', color: 'red', rot: r1((Math.atan2(-L.kheSanh.nx, -L.kheSanh.ny) * 180) / Math.PI) });
  Lt('villageArrow', 380, 840, { r: 9, shape: 'arrow', color: 'amber', rot: 0 });
  Lt('lock1', 190, 604, { r: 6, color: 'green' });
  Lt('lock2', 200, 592, { r: 6, color: 'green' });
  Lt('lock3', 210, 580, { r: 6, color: 'green' });
  // red alert: one lamp per task in an arc above the helmet (huey, supply, helmet, Khe Sanh, village, orbit)
  for (let i = 0; i < 6; i++) {
    const a = rad(28 + i * 24.8);
    Lt(`alarm${i}`, r1(helmet.x + Math.cos(a) * 38), r1(helmet.y + Math.sin(a) * 38), { r: 5, color: 'red' });
  }
  Lt('extraBall', 240, 538, { r: 8, color: 'white' });
  Lt('jackpot', 326, 482, { r: 8, color: 'white' });
  Lt('cuchiLit', r1(L.cuchi.x + L.cuchi.nx * 40), r1(L.cuchi.y + L.cuchi.ny * 40), { r: 10, color: 'amber', shape: 'arrow', rot: r1((Math.atan2(-L.cuchi.nx, -L.cuchi.ny) * 180) / Math.PI) });
  // star lamps under the bank, the arch arrow behind it
  L.dropTargets.forEach((t) => Lt(`star${t.id}`, t.x, 694, { r: 6, color: 'red' }));
  Lt('archArrow', 240, 676, { r: 9, shape: 'arrow', color: 'green', rot: 0 });
  // chase lights up both orbits (they run all the time, faster in multiball)
  for (let i = 0; i < 7; i++) {
    Lt(`chaseL${i}`, 51, 470 + i * 46, { r: 7, shape: 'arrow', color: 'amber', rot: 0 });
    Lt(`chaseR${i}`, 429, 470 + i * 42, { r: 7, shape: 'arrow', color: 'amber', rot: 0 });
  }
  // map of Indochina on the playfield (lon/lat -> mm), shared with the artwork
  L.map = { lon0: 102, lat0: 8.5, x0: 268, y0: 584, kx: 12.2, ky: 12.7, lon1: 110, lat1: 23.5 };
  const M = (lon, lat) => [r1(L.map.x0 + (lon - L.map.lon0) * L.map.kx), r1(L.map.y0 + (lat - L.map.lat0) * L.map.ky)];
  L.map.trail = [[105.6, 18.2], [106.4, 16.6], [106.9, 15.0], [107.0, 13.5], [106.7, 12.2]];
  // Ho Chi Minh trail: a chain of small lamps that fills with the orbit mission
  L.map.trail.forEach(([lo, la], i) => { const [x, y] = M(lo, la); Lt(`trail${i}`, x, y, { r: 4.5, color: 'red' }); });
  // bonus multipliers 2x 4x 6x 8x between the flippers
  [[186, 236], [222, 226], [258, 226], [294, 236]].forEach(([x, y], i) => Lt(`bonus${(i + 1) * 2}`, x, y, { r: 10, color: 'amber', label: `${(i + 1) * 2}X` }));
  // tunnel lamps (under glass)
  [206, 240, 274].forEach((x, i) => Lt(`tunnel${i}`, x, ROTOR.tunnel.y1 - 36, { r: 6, color: 'amber' }));
  L.lights = lights;

  // ------------------------------------------------------------ decoration anchors (renderer / Blender)
  L.decor = {
    ...L.decor,
    tesla: [{ x: 12, y: 990, z: 40 }, { x: 508, y: 990, z: 40 }],
    signs: [
      { id: 'huey', x: 40, y: 800, z: 0, rot: 18, w: 70 },
      { id: 'base', x: 438, y: 462, z: 24, rot: -24, w: 62 },
      { id: 'village', x: 372, y: 960, z: 0, rot: 0, w: 62 },
    ],
  };
  return L;
}

export default buildRotorLayout;
