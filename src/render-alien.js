// ERDABWEHR toys in the 3D scene: the hovering mothership with its tractor beam, the war robot,
// the tank in its emplacement, the human laser cannons, the radar and the small attack saucers.
// Installed by the renderer when the alien table's model is loaded; driven every frame.

const MM = 0.001;

export function installAlien(R, find) {
  const P = R.parts;
  const keep = (o) => { if (o) { o.rotation.reorder('YXZ'); o.userData.r0 = o.rotation.clone(); o.userData.p0 = o.position.clone(); } return o; };
  P.ship = { o: keep(find('mothership')), ring: keep(find('mothership_ring')), beam: find('mothership_beam'), glow: find('mothership_glow'), beamV: 0, hit: 0, spin: 0 };
  if (P.ship.beam) P.ship.beam.traverse((m) => {
    if (!m.isMesh) return;
    // additive, fading cone of light
    const col = m.material && m.material.emissive ? m.material.emissive.clone() : null;
    m.material = m.material.clone();
    m.material.transparent = true; m.material.depthWrite = false; m.material.opacity = 0;
    if (col) m.material.color = col;
    m.material.blending = 2; // THREE.AdditiveBlending
    m.renderOrder = 4; m.castShadow = false; m.receiveShadow = false;
    P.ship.beamMats = (P.ship.beamMats || []).concat(m.material);
  });
  P.robot = { torso: keep(find('robot_torso')), head: keep(find('robot_head')), arm: keep(find('robot_arm_R')), hit: 0, down: 0, fire: 0 };
  P.tank = { turret: keep(find('tank_turret')), barrel: keep(find('tank_barrel')), aim: 0, recoil: 0, target: 0 };
  P.lasers = [0, 1].map((i) => ({ head: keep(find(`laser_${i}_head`)), fire: 0 }));
  P.radar = keep(find('radar_dish'));
  P.saucers = [0, 1].map((i) => keep(find(`saucer_${i}`))).filter(Boolean);
  P.alienFigs = [0, 1, 2].map((i) => keep(find(`alien_${i}`))).filter(Boolean);
}

/** world position of a few alien-table anchors (metres, renderer space) */
export function alienAnchor(R, name) {
  const A = R.L.alien;
  switch (name) {
    case 'ship': case 'skull': { const s = A.ship; return R.wmm(s.x + (Math.random() - 0.5) * 60, s.y - 20, s.z - 6); }
    case 'beam': return R.wmm(A.beamPad.x, A.beamPad.y, 4);
    case 'robotGun': { const r = A.robot; return R.wmm(r.x + 34, r.y - 22, 120); }
    case 'roxy': case 'robot': { const r = A.robot; return R.wmm(r.x, r.y, 130); }
    case 'tank': { const t = A.tank; return R.wmm(t.x, t.y - 40, 52); }
    default: return null;
  }
}

export function frameAlien(R, dt, game) {
  const P = R.parts, t = R.time;
  const S = P.ship;
  // mothership: slow hover, the light ring turns (fast in multiball), shudders when hit
  if (S.o) {
    S.hit = Math.max(0, S.hit - dt * 1.6);
    const p0 = S.o.userData.p0, r0 = S.o.userData.r0;
    const sh = S.hit * S.hit;
    S.o.position.y = p0.y + Math.sin(t * 0.8) * 0.006 + Math.sin(t * 47) * 0.004 * sh;
    S.o.position.x = p0.x + Math.sin(t * 0.33) * 0.008 + Math.sin(t * 53) * 0.005 * sh;
    S.o.rotation.z = r0.z + Math.sin(t * 0.5) * 0.025 + Math.sin(t * 31) * 0.05 * sh;
    S.o.rotation.x = r0.x + Math.sin(t * 0.41) * 0.02;
  }
  S.spin += dt * (game.multiball ? 3.2 : 0.7);
  if (S.ring) S.ring.rotation.y = S.ring.userData.r0.y + S.spin;
  // tractor beam: on while a ball is abducted / dropped, breathing while the lock is lit
  const want = R.alienBeam > 0 ? 1 : game.lockLit || game.laserReady ? 0.32 + 0.12 * Math.sin(t * 4) : game.multiball ? 0.2 : 0.06;
  R.alienBeam = Math.max(0, (R.alienBeam || 0) - dt);
  S.beamV += (want - S.beamV) * Math.min(1, dt * 5);
  if (S.beamMats) for (const m of S.beamMats) { m.opacity = S.beamV * (0.55 + 0.15 * Math.sin(t * 23)); m.visible = m.opacity > 0.01; }
  // robot: idles, scans with its head, staggers when its feet are hit, slumps when knocked out
  const Rb = P.robot;
  Rb.hit = Math.max(0, Rb.hit - dt * 2.4);
  Rb.fire = Math.max(0, Rb.fire - dt);
  Rb.down += ((game.robotOut ? 1 : 0) - Rb.down) * Math.min(1, dt * 3);
  if (Rb.torso) {
    const r0 = Rb.torso.userData.r0;
    Rb.torso.rotation.y = r0.y + Math.sin(t * 0.6) * 0.18 * (1 - Rb.down) + Math.sin(t * 40) * 0.06 * Rb.hit;
    Rb.torso.rotation.x = r0.x + 0.5 * Rb.down + Math.sin(t * 33) * 0.05 * Rb.hit + R.beatPulse * 0.02;
    Rb.torso.rotation.z = r0.z + Math.sin(t * 27) * 0.05 * Rb.hit;
  }
  if (Rb.head) Rb.head.rotation.y = Rb.head.userData.r0.y + (Rb.fire > 0 ? 0 : Math.sin(t * 1.3) * 0.6) * (1 - Rb.down);
  if (Rb.arm) Rb.arm.rotation.x = Rb.arm.userData.r0.x - (Rb.fire > 0 ? 0.9 : 0.15 + 0.1 * Math.sin(t * 0.9)) * (1 - Rb.down);
  // tank: turret sweeps; on fire it aims, the barrel recoils
  const T = P.tank;
  T.recoil = Math.max(0, T.recoil - dt * 3);
  if (T.turret) {
    const idle = Math.sin(t * 0.35) * 0.5;
    T.aim += ((T.lock > 0 ? T.target : idle) - T.aim) * Math.min(1, dt * 4);
    T.lock = Math.max(0, (T.lock || 0) - dt);
    T.turret.rotation.y = T.turret.userData.r0.y + T.aim;
  }
  if (T.barrel) {
    const b0 = T.barrel.userData.p0;
    T.barrel.position.set(b0.x, b0.y, b0.z);
    T.barrel.translateZ(-T.recoil * T.recoil * 0.012);
    T.barrel.rotation.x = T.barrel.userData.r0.x - 0.15 - 0.1 * T.recoil;
  }
  // laser cannons track the mothership
  for (const L of P.lasers) {
    if (!L.head) continue;
    L.fire = Math.max(0, L.fire - dt);
    L.head.rotation.y = L.head.userData.r0.y + Math.sin(t * 0.7 + (L === P.lasers[0] ? 0 : 2)) * 0.35 * (L.fire > 0 ? 0.2 : 1);
  }
  if (P.radar) P.radar.rotation.y = P.radar.userData.r0.y + t * 1.6;
  P.saucers.forEach((o, i) => {
    const p0 = o.userData.p0;
    o.position.y = p0.y + Math.sin(t * 1.1 + i * 2) * 0.008;
    o.position.x = p0.x + Math.sin(t * 0.5 + i) * 0.012;
    o.rotation.y = o.userData.r0.y + t * (1.5 + i * 0.4);
  });
  P.alienFigs.forEach((o, i) => { o.rotation.y = o.userData.r0.y + Math.sin(t * 0.8 + i * 1.7) * 0.25; });
  // glows
  const set = (n, v) => R.glow(n, v);
  set('mothership_glow', 0.6 + S.beamV * 2.4 + Math.sin(t * 6) * 0.15);
  set('robot_eye_glow', Rb.down > 0.5 ? 0.15 + (Math.random() > 0.9 ? 0.8 : 0) : 1.2 + Math.sin(t * 3) * 0.3 + Rb.fire * 3);
  set('robot_gun_glow', 0.3 + Rb.fire * 6);
  set('tank_muzzle_glow', T.recoil * 8);
  set('tankpit_glow', 0.7 + 0.5 * (Math.sin(t * 5) > 0 ? 1 : 0) * (game.lamps && game.lamps.tankArrow === 2 ? 1.6 : 0.6));
  set('beampad_glow', 0.6 + S.beamV * 2 + 0.3 * Math.sin(t * 4));
  set('skyline_glow', 0.85 + 0.1 * Math.sin(t * 1.3) + (Math.random() > 0.98 ? -0.3 : 0));
  set('skyline_fire_glow', 0.9 + 0.4 * Math.sin(t * 9) * Math.sin(t * 5.3));
  for (let i = 0; i < 2; i++) set(`laser_${i}_glow`, 0.6 + P.lasers[i].fire * 5);
  for (let i = 0; i < 2; i++) set(`saucer_${i}_glow`, 0.8 + 0.5 * Math.sin(t * 7 + i * 3));
  for (let i = 0; i < 3; i++) set(`shield_${i}_glow`, (game.kick && (game.kick.L || game.kick.R)) ? 1 + 0.4 * Math.sin(t * 5 + i) : 0.2);
}

// ------------------------------------------------------------------ one-shot effects (called by the director)
export const alienFx = {
  robotBash(R) { R.parts.robot.hit = 1; R.shake(0.12); },
  robotFire(R, target) {
    R.parts.robot.fire = 0.8;
    const a = alienAnchor(R, 'robotGun'), b = target || R.anchor('table');
    R.lightning(a, b, { dur: 0.35, width: 0.008, amp: 0.02, color: 'red', flash: 4 });
  },
  tankFire(R) {
    const T = R.parts.tank;
    T.recoil = 1; T.target = 0.35; T.lock = 1.2;
    const p = alienAnchor(R, 'tank');
    R.sparksW(p, 22, R.colors.orange, 0);
    R.shake(0.35);
  },
  laserFire(R) {
    R.parts.lasers.forEach((L) => { L.fire = 1; });
    for (const side of ['teslaL', 'teslaR']) R.lightning(R.anchor(side), alienAnchor(R, 'ship'), { dur: 0.5, width: 0.01, amp: 0.012, color: 'cyan', flash: 6 });
  },
  shipHit(R, big) {
    R.parts.ship.hit = big ? 1.6 : 1;
    const p = alienAnchor(R, 'ship');
    R.sparksW(p, big ? 60 : 26, R.colors.orange, 0);
    R.sparksW(p, big ? 40 : 14, R.colors.white, 2);
    R.shake(big ? 0.9 : 0.35);
  },
  beam(R, sec) { R.alienBeam = Math.max(R.alienBeam || 0, sec); },
  rayStrike(R, from = 'ship') {
    // a green alien ray from the ship down to a random spot on the playfield
    R.lightning(alienAnchor(R, from), R.anchor('table'), { dur: 0.22, width: 0.007, amp: 0.02, color: 'green', flash: 3 });
  },
};

export { MM };
