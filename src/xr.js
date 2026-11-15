// WebXR for Meta Quest (Quest 3: mixed reality with passthrough; otherwise VR).
// The cabinet is modelled at real size, so in the headset it stands in the room: playfield 0.92 m
// above the floor, the player in front of the lockdown bar.
// Controls: triggers (or a pinch with each hand) = flippers, right grip or A = plunger,
// B or left grip = nudge, thumbstick click = put the table in front of you again, X = leave.

import * as THREE from 'three';

const PLAYFIELD_H = 0.92; // floor to playfield (the cabinet legs end 0.92 m below the playfield)
const STAND_Z = 0.9; // player position in front of the table centre (scene +z is the player side)

export function createXR({ renderer: R, game, dmd, audio, onStartGame, onEnter, onExit }) {
  const gl = R.renderer;
  const xr = gl.xr;
  xr.enabled = true;
  const st = { mode: null, session: null, base: null, panel: null, panelTex: null, panelCv: null, held: { L: false, R: false }, plunge: false, pads: {} };

  async function supported() {
    if (!navigator.xr || !window.isSecureContext) return null;
    try {
      if (await navigator.xr.isSessionSupported('immersive-ar')) return 'immersive-ar';
      if (await navigator.xr.isSessionSupported('immersive-vr')) return 'immersive-vr';
    } catch { /* no XR */ }
    return null;
  }

  // ------------------------------------------------------------------ placement
  function place(viewer) {
    if (!st.base) return;
    // viewer: { x, z, yaw } in the base (floor) space; the table goes in front of it
    const v = viewer || { x: 0, z: 0, yaw: 0 };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
    const s = new THREE.Vector3(0, -PLAYFIELD_H, STAND_Z).applyQuaternion(q);
    const t = new THREE.Vector3(v.x, 0, v.z).sub(s);
    const off = st.base.getOffsetReferenceSpace(new XRRigidTransform({ x: t.x, y: t.y, z: t.z }, { x: q.x, y: q.y, z: q.z, w: q.w }));
    xr.setReferenceSpace(off);
  }

  function recenter(frame) {
    const pose = frame && st.base && frame.getViewerPose(st.base);
    if (!pose) return;
    const p = pose.transform.position, o = pose.transform.orientation;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
    place({ x: p.x, z: p.z, yaw: Math.atan2(-fwd.x, -fwd.z) });
    audio.sfx('uiClick');
  }

  // ------------------------------------------------------------------ the dot-matrix display floats above the backbox
  function makePanel() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 256;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.115), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    mesh.position.set(0, 0.47, -0.585);
    mesh.rotation.x = -0.12;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.135), new THREE.MeshBasicMaterial({ color: 0x0b0a10 }));
    frame.position.z = -0.002;
    mesh.add(frame);
    R.scene.add(mesh);
    st.panel = mesh; st.panelTex = tex; st.panelCv = cv;
    // dot mask, drawn once
    const mask = document.createElement('canvas');
    mask.width = 1024; mask.height = 256;
    const m = mask.getContext('2d');
    m.fillStyle = '#000';
    m.fillRect(0, 0, 1024, 256);
    m.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) { m.beginPath(); m.arc(x * 8 + 4, y * 8 + 4, 3.1, 0, Math.PI * 2); m.fill(); }
    st.mask = mask;
  }

  function drawPanel() {
    if (!st.panel || !dmd.canvas) return;
    const c = st.panelCv.getContext('2d');
    c.imageSmoothingEnabled = false;
    c.drawImage(dmd.canvas, 0, 0, 1024, 256);
    c.drawImage(st.mask, 0, 0);
    st.panelTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ input
  const side = (src) => (src.handedness === 'left' ? 'L' : 'R');
  function flip(id, down) {
    if (st.held[id] === down) return;
    st.held[id] = down;
    if (down && game.state !== 'playing' && game.state !== 'bonus') { onStartGame(); return; }
    game.flipper(id, down);
  }
  function plunger(down) {
    if (st.plunge === down) return;
    st.plunge = down;
    if (down) game.plungerDown(); else game.plungerUp();
  }
  function pulse(id, strength, ms) {
    if (!st.session) return;
    for (const src of st.session.inputSources) {
      if (!src.gamepad || (id && side(src) !== id)) continue;
      const h = src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
      try { if (h && h.pulse) h.pulse(strength, ms); } catch { /* optional */ }
    }
  }

  function onSelect(e, down) { flip(side(e.inputSource), down); }
  function onSqueeze(e, down) {
    if (side(e.inputSource) === 'R') plunger(down);
    else if (down) game.nudge(0);
  }

  // buttons that have no XR events: A/X, B/Y, thumbstick click (xr-standard mapping)
  function pollPads(frame) {
    for (const src of st.session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const id = side(src);
      const prev = st.pads[id] || [];
      const now = gp.buttons.map((b) => b.pressed);
      const edge = (i) => now[i] && !prev[i];
      const rel = (i) => !now[i] && prev[i];
      if (id === 'R' && edge(4)) plunger(true);
      if (id === 'R' && rel(4)) plunger(false);
      if (edge(5)) game.nudge(0);
      if (edge(3)) recenter(frame);
      if (id === 'L' && edge(4)) st.session.end();
      st.pads[id] = now;
    }
  }

  // ------------------------------------------------------------------ haptics follow the game
  game.on((e) => {
    if (!st.session) return;
    switch (e.type) {
      case 'flipperUp': pulse(e.id === 'L' ? 'L' : 'R', 0.25, 18); break;
      case 'bumper': pulse(null, 0.45, 35); break;
      case 'sling': pulse(e.id === 'L' ? 'L' : 'R', 0.4, 30); break;
      case 'launch': pulse('R', 0.8, 60); break;
      case 'jackpot': case 'superJackpot': case 'multiballStart': pulse(null, 1, 160); break;
      case 'drain': pulse(null, 0.6, 120); break;
      default: break;
    }
  });

  // ------------------------------------------------------------------ session
  async function enter(mode) {
    if (st.session) return;
    const session = await navigator.xr.requestSession(mode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'layers'],
    });
    st.session = session; st.mode = mode;
    session.addEventListener('selectstart', (e) => onSelect(e, true));
    session.addEventListener('selectend', (e) => onSelect(e, false));
    session.addEventListener('squeezestart', (e) => onSqueeze(e, true));
    session.addEventListener('squeezeend', (e) => onSqueeze(e, false));
    session.addEventListener('end', () => {
      st.session = null; st.mode = null; st.base = null; st.pads = {};
      flip('L', false); flip('R', false); plunger(false);
      if (st.panel) { R.scene.remove(st.panel); st.panel = null; }
      gl.setAnimationLoop(null);
      R.xrEnd();
      onExit();
    });
    xr.setReferenceSpaceType('local-floor');
    xr.setFoveation(1);
    await xr.setSession(session);
    st.base = xr.getReferenceSpace();
    place();
    R.xrBegin(mode);
    makePanel();
    onEnter(mode);
  }

  /** Per-frame work while in the headset (called from the XR animation loop). */
  function frame(xrFrame) {
    if (!st.session) return;
    if (xrFrame) pollPads(xrFrame);
    drawPanel();
  }

  return { supported, enter, frame, get active() { return !!st.session; }, exit() { if (st.session) st.session.end(); } };
}
