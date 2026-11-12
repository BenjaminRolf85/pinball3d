// RIFFGEWITTER table layout — single source of truth for physics, Blender and renderer.
// All coordinates in millimetres. Origin: bottom-left corner of the playfield.
// +x right, +y up-table (away from the player), z up.

export const TABLE = { W: 520, L: 1080, playW: 480, wallH: 40 };
export const BALL_R = 13.5;
export const ARCH = { cx: 275, cy: 820, r: 245 };

const rad = (d) => (d * Math.PI) / 180;

/** Polyline approximation of an arc (degrees, counter-clockwise positive). */
export function arcPts(cx, cy, r, a0, a1, step = 8) {
  const len = Math.abs(rad(a1 - a0)) * r;
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = rad(a0 + ((a1 - a0) * i) / n);
    pts.push([+(cx + r * Math.cos(a)).toFixed(2), +(cy + r * Math.sin(a)).toFixed(2)]);
  }
  return pts;
}

const mirror = (pts) => pts.map(([x, y]) => [TABLE.playW - x, y]);

/**
 * opts.targets: four drop-target letters, opts.lanes: three top-lane letters (labels only;
 * the geometry is identical on every table so physics tuning carries over).
 */
export function buildLayout(opts = {}) {
  const targetLetters = (opts.targets || 'ROCK').slice(0, 4);
  const laneLetters = (opts.lanes || 'AMP').slice(0, 3);
  const L = {};
  L.table = TABLE;
  L.ballR = BALL_R;
  L.arch = ARCH;

  // ------------------------------------------------------------ walls
  // kind: outer (cabinet rail), wall (steel guide), island (solid block edge), rubber
  const walls = [];
  const W = (pts, o = {}) => walls.push({ pts, r: 2, e: 0.42, kind: 'wall', h: 24, ...o });

  // Outer boundary (the arch itself is a true arc collider, see L.arcs)
  W([[0, 0], [0, 385], [30, 420], [30, 820]], { kind: 'outer', r: 0, h: 40 });
  W([[520, 820], [520, 0]], { kind: 'outer', r: 0, h: 40 });
  W([[520, 0], [0, 0]], { kind: 'outer', r: 0, h: 40 });

  // Shooter lane divider
  W([[480, 0], [480, 800]], { kind: 'wall', h: 28 });
  // Right strip island between right orbit and shooter lane
  W([[480, 385], [450, 420], [450, 762], [480, 800]], { kind: 'island' });

  // Inlane / outlane guides
  const leftGuide = [[38, 343], [38, 225], [130, 160]];
  W(leftGuide, { kind: 'wall', h: 20 });
  W(mirror(leftGuide), { kind: 'wall', h: 20 });

  // Left island (drop target bank) + left orbit inner wall
  const bankA = [86, 512];
  const bankB = [142, 596];
  W([[84, 474], bankA, bankB, [72, 690]], { kind: 'island' });
  W([[84, 474], [72, 560], [72, 820], ...arcPts(ARCH.cx, ARCH.cy, 203, 180, 140).slice(1)], { kind: 'wall' });

  // Right island (ramp entrance) + right orbit inner wall
  const ramp = { mouth: [350, 555], dir: [0.309, 0.951], halfW: 25, len: 70 };
  const perp = [ramp.dir[1], -ramp.dir[0]];
  const Lw0 = [ramp.mouth[0] - perp[0] * ramp.halfW, ramp.mouth[1] - perp[1] * ramp.halfW];
  const Rw0 = [ramp.mouth[0] + perp[0] * ramp.halfW, ramp.mouth[1] + perp[1] * ramp.halfW];
  const Lw1 = [Lw0[0] + ramp.dir[0] * ramp.len, Lw0[1] + ramp.dir[1] * ramp.len];
  const Rw1 = [Rw0[0] + ramp.dir[0] * ramp.len, Rw0[1] + ramp.dir[1] * ramp.len];
  const r2 = (p) => [+p[0].toFixed(1), +p[1].toFixed(1)];
  W([[396, 474], r2(Rw0), r2(Rw1), r2(Lw1), r2(Lw0)], { kind: 'island' });
  W([r2(Lw1), [408, 650]], { kind: 'island' });
  W([[396, 474], [408, 560], [408, 930], [390, 962]], { kind: 'wall' });

  // Guide that feeds balls rolling off the left island over Roxy's boot into the tunnel
  W([[82, 675], [127, 657]], { kind: 'wall', h: 16 });

  // Top lane separators
  const laneX = [229, 275, 321];
  const sepX = [206, 252, 298, 344];
  for (const x of sepX) W([[x, 915], [x, 975]], { kind: 'guide', r: 4, e: 0.55, h: 18 });

  L.walls = walls;

  // True arc collider for the main arch (ball is inside the circle)
  L.arcs = [{ cx: ARCH.cx, cy: ARCH.cy, r: ARCH.r, a0: 0, a1: 180, e: 0.42 }];

  // Solid polygons, only used for visuals (Blender extrudes them)
  L.islands = [
    { id: 'left', pts: [[84, 474], bankA, bankB, [72, 690], [72, 560]], h: 24 },
    { id: 'right', pts: [[396, 474], r2(Rw0), r2(Rw1), r2(Lw1), [408, 650], [408, 560]], h: 24 },
    { id: 'strip', pts: [[480, 385], [450, 420], [450, 762], [480, 800]], h: 24 },
  ];

  // ------------------------------------------------------------ posts (rubber)
  L.posts = [
    { x: 38, y: 343, r: 5 },
    { x: 442, y: 343, r: 5 },
    { x: bankB[0], y: bankB[1], r: 5 },
    { x: r2(Lw0)[0], y: r2(Lw0)[1], r: 4.5 },
    { x: r2(Rw0)[0], y: r2(Rw0)[1], r: 4.5 },
    { x: 119.5, y: 950.5, r: 5 },
    { x: 390, y: 962, r: 5 },
  ].map((p) => ({ e: 0.7, ...p }));

  // ------------------------------------------------------------ one-way gates
  // A gate blocks a ball that sits on the side its normal n points to and moves against n.
  L.gates = [
    { id: 'shooter', a: [480, 800], b: [520, 852], n: [-0.793, 0.61], e: 0.25, oneWay: true },
    // Top gate: closed during the plunge so the ball drops into the A-M-P lanes.
    { id: 'top', a: [199.3, 1053], b: [213.2, 1010.2], n: [1, 0], e: 0.2, oneWay: false, switchable: true },
  ];

  // ------------------------------------------------------------ flippers
  const FL = { len: 84, rBase: 11.5, rTip: 7, rest: -30, up: 28 };
  L.flippers = [
    { id: 'L', side: -1, x: 141.5, y: 140, ...FL, rest: rad(-30), up: rad(28) },
    { id: 'R', side: 1, x: 338.5, y: 140, ...FL, rest: rad(210), up: rad(152) },
  ];

  // ------------------------------------------------------------ slingshots
  // tri: A top, B outer bottom, C inner bottom. The kicking face is A-C.
  const slingL = { A: [84, 348], B: [84, 242], C: [133, 208] };
  L.slings = [
    { id: 'L', side: -1, ...slingL, r: 5 },
    {
      id: 'R', side: 1, r: 5,
      A: [TABLE.playW - slingL.A[0], slingL.A[1]],
      B: [TABLE.playW - slingL.B[0], slingL.B[1]],
      C: [TABLE.playW - slingL.C[0], slingL.C[1]],
    },
  ];

  // ------------------------------------------------------------ pop bumpers (drums)
  L.bumpers = [
    { id: 0, x: 198, y: 852, r: 26 },
    { id: 1, x: 322, y: 852, r: 26 },
    { id: 2, x: 260, y: 785, r: 26 },
  ];

  // ------------------------------------------------------------ skull scoop
  L.skull = {
    x: 240, y: 655, r: 52,
    jaw: [
      { a: [213.25, 587], b: [213.25, 612], r: 6.25 },
      { a: [266.75, 587], b: [266.75, 612], r: 6.25 },
    ],
    mouth: { x: 240, y: 591, r: 11 },
    eject: { x: 240, y: 566, vx: -0.19, vy: -1.15 },
  };

  // ------------------------------------------------------------ Roxy: the frontwoman you shoot between the boots
  L.roxy = {
    x: 154, y: 641, half: 26,
    boots: [
      { a: [128, 632], b: [128, 650], r: 7.5 },
      { a: [180, 632], b: [180, 650], r: 7.5 },
    ],
  };

  // ------------------------------------------------------------ "11" stand-up targets on the right island
  {
    const A0 = [396, 474], A1 = r2(Rw0);
    const ux = A1[0] - A0[0], uy = A1[1] - A0[1];
    const len = Math.hypot(ux, uy);
    const u = [ux / len, uy / len];
    const n = [-u[1], u[0]]; // faces down-left, toward the left flipper
    L.standups = [0.3, 0.7].map((k, i) => {
      const c = [A0[0] + ux * k, A0[1] + uy * k];
      return {
        id: i, x: +(c[0] + n[0] * 6).toFixed(2), y: +(c[1] + n[1] * 6).toFixed(2),
        ux: u[0], uy: u[1], nx: n[0], ny: n[1], w: 26, r: 3, angle: Math.atan2(u[1], u[0]) + Math.PI,
      };
    });
  }

  // ------------------------------------------------------------ drop targets R-O-C-K
  {
    const ux = bankB[0] - bankA[0], uy = bankB[1] - bankA[1];
    const len = Math.hypot(ux, uy);
    const u = [ux / len, uy / len];
    const n = [u[1], -u[0]]; // faces down-right, toward the flippers
    const w = len / 4;
    L.dropTargets = targetLetters.split('').map((letter, i) => {
      const c = [bankA[0] + u[0] * w * (i + 0.5), bankA[1] + u[1] * w * (i + 0.5)];
      return {
        id: i, letter,
        x: +(c[0] + n[0] * 7).toFixed(2), y: +(c[1] + n[1] * 7).toFixed(2),
        ux: u[0], uy: u[1], nx: n[0], ny: n[1],
        w: w - 1.5, r: 3,
        angle: Math.atan2(u[1], u[0]),
      };
    });
  }

  // ------------------------------------------------------------ ramp (wire ramp, 1-D rail physics)
  L.ramp = {
    ...ramp,
    sensor: { x: +(ramp.mouth[0] + ramp.dir[0] * 26).toFixed(1), y: +(ramp.mouth[1] + ramp.dir[1] * 26).toFixed(1), r: 15 },
    // x, y, z (z = height of the ball centre above its resting height)
    path: [
      [350, 555, 0], [358, 581, 3], [372, 624, 20], [388, 680, 42], [400, 760, 58], [396, 860, 66],
      [356, 944, 70], [275, 984, 70], [192, 958, 68], [124, 896, 64], [92, 800, 58], [82, 660, 46],
      [74, 520, 31], [64, 414, 14], [60, 362, 0],
    ],
    exit: { x: 60, y: 356 },
  };

  // ------------------------------------------------------------ spinner, sensors
  L.spinner = { x: 51, y: 545, w: 34 };
  L.sensors = [
    { id: 'laneA', x: laneX[0], y: 945, r: 11 },
    { id: 'laneM', x: laneX[1], y: 945, r: 11 },
    { id: 'laneP', x: laneX[2], y: 945, r: 11 },
    { id: 'inL', x: 59, y: 292, r: 12 },
    { id: 'inR', x: 421, y: 292, r: 12 },
    { id: 'outL', x: 19, y: 292, r: 12 },
    { id: 'outR', x: 461, y: 292, r: 12 },
    { id: 'orbL', x: 51, y: 640, r: 14 },
    { id: 'orbR', x: 429, y: 640, r: 14 },
    { id: 'launched', x: 500, y: 880, r: 16 },
    { id: 'spinner', x: 51, y: 545, r: 14 },
    { id: 'tunnel', x: 154, y: 641, r: 9 },
  ];
  L.laneX = laneX;

  // ------------------------------------------------------------ plunger / drain
  L.plunger = { x: 500, y: 60, restY: 60, pull: 46 };
  L.shooter = { x0: 480, x1: 520, spawn: [500, 78] };
  L.drainY = 48;

  // ------------------------------------------------------------ playfield inserts (lights)
  const lights = [];
  const Lt = (id, x, y, o = {}) => lights.push({ id, x, y, r: 9, color: 'orange', shape: 'circle', ...o });
  // VU meter up the centre: volume 1..11
  for (let i = 0; i < 11; i++) {
    Lt(`vu${i}`, 240, 292 + i * 14.5, { r: 5.2, shape: 'bar', color: i < 6 ? 'green' : i < 9 ? 'amber' : 'red' });
  }
  Lt('shootAgain', 240, 176, { r: 11, color: 'red' });
  const bonusPos = [[174, 264], [206, 247], [240, 240], [274, 247], [306, 264]];
  [2, 3, 4, 5, 6].forEach((m, i) => {
    Lt(`bonus${m}`, bonusPos[i][0], bonusPos[i][1], { r: 8, color: 'amber', label: `${m}X` });
  });
  Lt('skullArrow', 240, 500, { r: 13, shape: 'arrow', color: 'red', rot: 0 });
  Lt('lock1', 222, 540, { r: 7, color: 'red' });
  Lt('lock2', 240, 546, { r: 7, color: 'red' });
  Lt('lock3', 258, 540, { r: 7, color: 'red' });
  Lt('extraBall', 240, 468, { r: 9, color: 'white' });
  Lt('rampArrow', 334, 508, { r: 13, shape: 'arrow', color: 'orange', rot: -18 });
  Lt('rampJackpot', 326, 482, { r: 8, color: 'white' });
  Lt('tunnelArrow', 166, 604, { r: 10, shape: 'arrow', color: 'white', rot: 8 });
  L.standups.forEach((t) => Lt(`eleven${t.id}`, t.x + t.nx * 17, t.y + t.ny * 17, { r: 6, color: 'amber' }));
  Lt('orbLArrow', 55, 446, { r: 12, shape: 'arrow', color: 'blue', rot: 6 });
  Lt('orbRArrow', 425, 446, { r: 12, shape: 'arrow', color: 'blue', rot: -6 });
  L.dropTargets.forEach((t) => Lt(`rock${t.id}`, t.x + t.nx * 24, t.y + t.ny * 24, { r: 8, color: 'orange', label: t.letter }));
  laneX.forEach((x, i) => Lt(`lane${'AMP'[i]}`, x, 990, { r: 8, color: 'blue', label: laneLetters[i] }));
  Lt('inL', 59, 262, { r: 8, color: 'blue' });
  Lt('inR', 421, 262, { r: 8, color: 'blue' });
  Lt('outL', 19, 262, { r: 8, color: 'red' });
  Lt('outR', 461, 262, { r: 8, color: 'red' });
  // Ring of stage lights around the bumper area
  for (let i = 0; i < 8; i++) {
    const a = rad(22.5 + i * 45);
    Lt(`stage${i}`, 260 + Math.cos(a) * 118, 830 + Math.sin(a) * 78, { r: 6, color: i % 2 ? 'orange' : 'red' });
  }
  // Runway lights towards the skull
  for (let i = 0; i < 4; i++) {
    Lt(`runL${i}`, 196 - i * 9, 470 + i * 26, { r: 5, color: 'orange' });
    Lt(`runR${i}`, 284 + i * 9, 470 + i * 26, { r: 5, color: 'orange' });
  }
  L.lights = lights;

  // ------------------------------------------------------------ decoration anchors
  L.decor = {
    amps: [
      { x: 66, y: 1034, z: 40, rot: 24 },
      { x: 484, y: 1034, z: 40, rot: -24 },
    ],
    tesla: [
      { x: 96, y: 606, z: 24 },
      { x: 465, y: 606, z: 24 },
    ],
    flamePots: [140, 222, 328, 410].map((x) => ({ x, y: 1076, z: 40 })),
    logo: { x: 260, y: 1092, z: 250, width: 420 },
    guitars: [
      { x: 260, y: 1086, z: 128, rot: 38 },
      { x: 260, y: 1084, z: 128, rot: -38 },
    ],
    parCans: [70, 190, 330, 450].map((x) => ({ x, y: 1090, z: 318 })),
    backPanel: { y: 1094, h: 330 },
  };

  return L;
}

export default buildLayout;
