// RIFFGEWITTER — three.js renderer: table from Blender (GLB), lights, particles, lightning, flames.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { paintPlayfield, shapeSprite, cssColor, LAMP_COLORS } from './playfieldArt.js';
import { installAlien, frameAlien, alienAnchor } from './render-alien.js';
import { rampPointAt } from './physics.js';

const MM = 0.001;
const TW = 0.52, TL = 1.08;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Renderer {
  constructor(canvas, layout, opts = {}) {
    this.canvas = canvas;
    this.L = layout;
    this.reduced = !!opts.reducedMotion;
    this.theme = opts.theme || { id: 'riff', art: 'riff', jets: 'flame', figure: 'pinup' };
    this.quality = opts.quality || 'high';
    this.time = 0;
    this.trauma = 0;
    this.camMix = 0; // 0 attract, 1 play
    this.camMixTarget = 0;
    this.insets = { top: 0, bottom: 0 };
    this.gi = 1; this.giTarget = 1;
    this.storm = 0;
    this.beatPulse = 0; this.snarePulse = 0;
    this.lampFlash = 0;
    this.multiball = false;
    this.glows = {};
    this.parts = {};
    this.ballMeshes = new Map();
    this.jets = [];
    this.ready = false;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(cssColor('--scene-bg', '#050408'));
    this.scene.background = this.bg;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.camPlay = { pos: V(0, 1.6, 1.4), tgt: V(0, 0, 0) };
    this.camAttract = { pos: V(0, 1.2, 1.9), tgt: V(0, 0.05, -0.1) };

    this.table = new THREE.Group();
    this.table.position.set(-TW / 2, 0, TL / 2);
    this.scene.add(this.table);
    this.fx = new THREE.Group();
    this.scene.add(this.fx);

    this.colors = {};
    for (const k in LAMP_COLORS) this.colors[k] = new THREE.Color(cssColor(LAMP_COLORS[k]));

    this._env();
    this._lights();
    this._floor();
    this._particles();
    this._bolts();
    this._composer();
  }

  // table mm/m helpers -> world
  w(x, y, h = 0, out = new THREE.Vector3()) { return out.set(x - TW / 2, h, TL / 2 - y); }
  wmm(x, y, h = 0, out) { return this.w(x * MM, y * MM, h * MM, out); }

  // ------------------------------------------------------------------ setup
  _env() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x030305);
    const panel = (color, k, w, h, pos, look = V(0, 0, 0)) => {
      const c = new THREE.Color(color).multiplyScalar(k);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false }));
      m.position.copy(pos); m.lookAt(look); s.add(m);
    };
    panel(0xfff1dd, 9, 3, 1.2, V(0, 4, 0.5));
    panel(0xff3a1a, 7, 2, 3, V(-5, 1.5, 0));
    panel(0x3aa0ff, 6, 2, 3, V(5, 1.5, -1));
    panel(0xff7a2a, 5, 6, 0.6, V(0, 0.8, 5));
    panel(0xffffff, 4, 5, 0.5, V(0, 2.5, -5));
    panel(0xff2030, 3, 1, 1, V(-2, 3, -3));
    panel(0x66c8ff, 3, 1, 1, V(2.5, 3, 3));
    this.scene.environment = pm.fromScene(s, 0.035).texture;
    this.scene.environmentIntensity = 0.6;
    pm.dispose();
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xa9b6ff, 0x1a0606, 0.4);
    this.scene.add(this.hemi);
    const key = (this.key = new THREE.DirectionalLight(0xfff0e0, 1.25));
    key.position.set(-0.45, 1.7, 0.75);
    key.target.position.set(0, 0, -0.05);
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -0.42; sc.right = 0.42; sc.top = 0.75; sc.bottom = -0.75; sc.near = 0.4; sc.far = 3.4;
    key.shadow.bias = -0.0006; key.shadow.normalBias = 0.004;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(this.theme && this.theme.id === 'alien' ? 0x8a3cff : 0xff5533, this.theme && this.theme.id === 'alien' ? 0.5 : 0.3);
    if (this.theme && this.theme.id === 'alien') { this.hemi.color.set(0x8fd8ff); this.hemi.groundColor.set(0x12061e); }
    fill.position.set(0.8, 0.9, -0.6);
    this.scene.add(fill);
    // flashers
    const pl = (color, x, y, h) => {
      const l = new THREE.PointLight(color, 0, 1.1, 1.7);
      this.wmm(x, y, h, l.position);
      this.scene.add(l);
      return { light: l, v: 0 };
    };
    this.flashers = {
      bumpers: pl(0xff7a22, 260, 830, 150),
      slingL: pl(0xfff0d0, 110, 280, 110),
      slingR: pl(0xfff0d0, 370, 280, 110),
      skull: pl(0xff1520, 240, 600, 120),
      storm: pl(0x9fd8ff, 260, 560, 420),
    };
    this.flashers.storm.light.distance = 2.2;
  }

  _floor() {
    const g = new THREE.CircleGeometry(7, 48);
    const m = new THREE.MeshStandardMaterial({ color: 0x08070a, roughness: 0.42, metalness: 0.4 });
    const f = new THREE.Mesh(g, m);
    f.rotation.x = -Math.PI / 2; f.position.y = -0.92;
    f.receiveShadow = false;
    this.scene.add(f);
  }

  _composer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: this.quality === 'high' ? 4 : 2 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.36, 0.42, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.renderer.shadowMap.enabled = high;
    this.key.castShadow = high;
    this.scale = high ? 1 : 0.85;
    if (this.composer) { this.composer.dispose?.(); this._composer(); }
    if (this._pfTex && this._pfTex.image && this._pfTex.image.width !== this._pfWidth()) this.repaintPlayfield();
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    if (this._w) this.resize(this._w, this._h, this.insets);
  }

  // ------------------------------------------------------------------ loading
  async load(urls, onProgress = () => {}) {
    const loader = new GLTFLoader();
    const gltfP = new Promise((res, rej) => {
      if (urls.glb.startsWith('data:')) {
        // inlined model: decode by hand so it also works where fetch() of data: URLs is not allowed
        try {
          const bin = atob(urls.glb.slice(urls.glb.indexOf(',') + 1));
          const buf = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
          loader.parse(buf.buffer, '', res, rej);
        } catch (err) { rej(err); }
      } else loader.load(urls.glb, res, (e) => { if (e.total) onProgress(0.1 + 0.7 * (e.loaded / e.total)); }, rej);
    });
    const imgP = new Promise((res) => {
      if (!urls.base) return res(null);
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = urls.base;
    });
    const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
    const artP = Promise.all(Object.entries(urls.art || {}).map(async ([k, src]) => [k, await loadImg(src)])).then((e) => Object.fromEntries(e));
    try { await Promise.race([Promise.all([document.fonts.load("40px 'Metal Mania'"), document.fonts.load("40px 'Black Ops One'"), document.fonts.load("900 40px 'Orbitron'"), document.fonts.load("700 20px 'Barlow Condensed'")]), new Promise((r) => setTimeout(r, 2500))]); } catch { /* fallback font */ }
    const [gltf, base, art] = await Promise.all([gltfP, imgP, artP]);
    this.artImages = art;
    onProgress(0.85);
    this._adopt(gltf.scene, base);
    onProgress(0.95);
    this.setQuality(this.quality);
    // warm up shaders so the first flip does not hitch
    try { this.renderer.compile(this.scene, this.camera); } catch { /* optional */ }
    this.ready = true;
    onProgress(1);
  }

  _adopt(root, baseImage) {
    this.table.add(root);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      if (m && m.name && m.name.startsWith('glow')) { o.castShadow = false; }
    });
    const find = (n) => root.getObjectByName(n);
    const P = this.parts;

    // playfield texture
    const pf = find('playfield');
    if (pf) {
      this._baseImage = baseImage;
      const art = paintPlayfield(this.L, baseImage, this._pfWidth(), this.theme.art, { images: this.artImages, lang: this.lang, texts: this.artTexts });
      this._pfTex = null;
      const tex = new THREE.CanvasTexture(art);
      this._pfTex = tex;
      tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = maxAniso;
      tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      pf.traverse((o) => {
        if (o.isMesh) {
          o.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3, metalness: 0.05, envMapIntensity: 0.7 });
          o.castShadow = false; o.receiveShadow = true;
        }
      });
    }

    // dynamic parts
    P.flippers = {};
    for (const f of this.L.flippers) P.flippers[f.id] = find(`flipper_${f.id}`);
    // ROTORSTURM parts
    P.m16 = { o: find('m16_gun'), a: 0 };
    if (P.m16.o) P.m16.a0 = P.m16.o.rotation.y;
    P.cuchiDoor = { o: find('cuchi_door'), v: 0 };
    if (this.L.alien) installAlien(this, find);
    if (P.cuchiDoor.o) P.cuchiDoor.x0 = P.cuchiDoor.o.rotation.x;
    const glass = find('glass');
    if (glass) glass.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshPhysicalMaterial({ color: 0x9fb8c8, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.05, envMapIntensity: 0.35, depthWrite: false }); o.castShadow = false; o.receiveShadow = false; o.renderOrder = 3; } });
    // runtime-painted faces: sign boards, flags, apron card
    this.paintTargets = [];
    root.traverse((o) => { if (/_face$|_cloth$|^apron_art$|^backpanel_art$|^truss_banner$/.test(o.name)) this.paintTargets.push(o); });
    P.bumpers = this.L.bumpers.map((b, i) => ({ ring: find(`bumper_${i}_ring`), cap: find(`bumper_${i}_cap`), hit: 0, ringY: 0, capY: 0 }));
    for (const b of P.bumpers) { if (b.ring) b.ringY = b.ring.position.y; if (b.cap) b.capY = b.cap.position.y; }
    P.targets = this.L.dropTargets.map((t, i) => { const o = find(`droptarget_${i}`); return { o, y0: o ? o.position.y : 0, y: 0 }; });
    P.spinner = { o: find('spinner_plate'), w: 0 };
    // RIFFGEWITTER stage modules
    P.spinnerR = { o: find('spinner_R_plate'), w: 0 };
    P.vinyl = { o: find('vinyl_disc'), flash: 0 };
    P.mic = { o: find('mic_stand'), hit: 0 };
    if (P.mic.o) { P.mic.rx = P.mic.o.rotation.x; P.mic.rz = P.mic.o.rotation.z; }
    P.truss = { heads: [0, 1, 2, 3].map((i) => find(`truss_head_${i}`)).filter(Boolean), show: 0, focus: -1 };
    P.truss.base = P.truss.heads.map((o) => ({ y: o.rotation.y, x: o.rotation.x }));
    P.plunger = { o: find('plunger'), z0: 0, kick: 0 };
    if (P.plunger.o) P.plunger.z0 = P.plunger.o.position.z;
    P.skull = { o: find('skull'), nod: 0, shake: 0 };
    P.cones = [];
    for (let a = 0; a < 2; a++) for (let k = 0; k < 4; k++) { const o = find(`amp_${a}_cone_${k}`); if (o) P.cones.push(o); }
    P.gates = { shooter: find('gate_shooter_flap'), top: find('gate_top_flap') };
    P.gateSwing = { shooter: 0, top: 0 };
    P.heli = { o: find('heli'), rotor: find('heli_rotor'), tail: find('heli_tail_rotor'), spin: 0, spinTarget: 0.25, ang: 0, lift: 0, liftTarget: 0, y0: 0, x0: 0, z0: 0, boost: 0 };
    if (P.heli.rotor) {
      // motion blur disc for the spinning main rotor
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.066, 40), new THREE.MeshBasicMaterial({ color: 0x1a1c12, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.copy(P.heli.rotor.position);
      disc.renderOrder = 2;
      P.heli.rotor.parent.add(disc);
      P.heli.disc = disc;
    }
    if (P.heli.o) { P.heli.y0 = P.heli.o.position.y; P.heli.x0 = P.heli.o.position.x; P.heli.z0 = P.heli.o.position.z; P.heli.o.rotation.reorder('YXZ'); }
    P.roxy = { root: find('roxy'), skirt: find('roxy_skirt'), torso: find('roxy_torso'), head: find('roxy_head'), arm: find('roxy_arm_R'), laugh: 0, len: 1, shriek: 0 };
    P.roxy.morphs = [];
    if (P.roxy.skirt) P.roxy.skirt.traverse((o) => { if (o.isMesh && o.morphTargetInfluences && o.morphTargetInfluences.length) P.roxy.morphs.push(o); });
    for (const k of ['root', 'skirt', 'torso', 'head', 'arm']) { const o = P.roxy[k]; if (o) { o.rotation.reorder('YXZ'); P.roxy[k + '0'] = o.rotation.clone(); P.roxy[k + 'P'] = o.position.clone(); } }

    // glow registry: every object whose name contains "_glow" or "_plastic", plus skull eyes and bumper caps
    const reg = (name, o) => {
      if (!o) return;
      const mats = [];
      o.traverse((c) => {
        if (c.isMesh && c.material && c.material.emissive && (c.material.emissiveIntensity > 0.01) && (c.material.emissive.r + c.material.emissive.g + c.material.emissive.b > 0.01)) {
          c.material = c.material.clone();
          mats.push(c.material);
          c.castShadow = false;
        }
      });
      const k = /_plastic$/.test(name) ? 0.8 : 0.3;
      if (mats.length) this.glows[name] = { mats, base: mats.map((m) => m.emissiveIntensity * k), level: 1, target: 1, hold: 1 };
    };
    root.traverse((o) => {
      if (/_glow$|_plastic$|_eye_[LR]$|^heli_beacon$/.test(o.name)) reg(o.name, o);
    });
    P.bumpers.forEach((b, i) => reg(`bumper_${i}_cap`, b.cap));
    P.targets.forEach((t, i) => reg(`droptarget_${i}`, t.o));

    this._inserts();
    this._balls();
    this._beams();
    this.paintFaces();
  }

  /** Paint sign boards, flags and the apron card (called again when the language changes). */
  paintFaces() {
    if (!this.paintTargets || !this.facePainter) return;
    for (const o of this.paintTargets) {
      const cv = this.facePainter(o.name, this.artImages || {});
      if (!cv) continue;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      o.traverse((m) => {
        if (!m.isMesh) return;
        if (m.material && m.material.map) m.material.map.dispose();
        m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0, side: /_cloth$/.test(o.name) ? THREE.DoubleSide : THREE.FrontSide });
      });
    }
  }

  /** Repaint the playfield artwork (language switch). */
  repaintPlayfield() {
    if (!this._pfTex) return;
    const art = paintPlayfield(this.L, this._baseImage, this._pfWidth(), this.theme.art, { images: this.artImages, lang: this.lang, texts: this.artTexts });
    this._pfTex.image = art;
    this._pfTex.needsUpdate = true;
  }

  /** Playfield texture width: as sharp as the GPU allows (the texture is about twice as tall as wide). */
  _pfWidth() {
    const maxTex = this.renderer.capabilities.maxTextureSize || 4096;
    const want = this.quality === 'high' ? 1920 : 1280;
    return Math.max(768, Math.min(want, Math.floor((maxTex * 520) / 1080)));
  }

  glow(name, level, hold) {
    const g = this.glows[name];
    if (!g) return;
    g.level = level;
    if (hold !== undefined) g.hold = hold;
  }

  // ------------------------------------------------------------------ playfield inserts
  _inserts() {
    const lights = this.L.lights;
    const byShape = { circle: [], arrow: [], bar: [] };
    lights.forEach((l) => byShape[l.shape].push(l));
    this.inserts = [];
    this.insertIndex = {};
    const dummy = new THREE.Object3D();
    for (const shape in byShape) {
      const list = byShape[shape];
      if (!list.length) continue;
      const tex = new THREE.CanvasTexture(shapeSprite(shape));
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.renderOrder = 2; im.frustumCulled = false;
      list.forEach((l, i) => {
        this.wmm(l.x, l.y, 0.7, dummy.position);
        dummy.rotation.set(0, ((l.rot || 0) * Math.PI) / 180, 0);
        const s = (l.r * MM) / 0.27; // sprite radius is 27 % of the quad
        dummy.scale.set(s, 1, s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color(0, 0, 0));
        this.insertIndex[l.id] = { mesh: im, i, l, v: 0, color: this.colors[l.color] || this.colors.orange };
      });
      this.fx.add(im);
      this.inserts.push(im);
    }
    this._tmpColor = new THREE.Color();
  }

  // ------------------------------------------------------------------ balls + trails
  _balls() {
    this.ballGeo = new THREE.SphereGeometry(this.L.ballR * MM, 48, 32);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.06, envMapIntensity: 1.6 });
    this.shadowTex = new THREE.CanvasTexture(shapeSprite('soft', 64));
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
    this.shadowGeo = new THREE.PlaneGeometry(0.05, 0.05); this.shadowGeo.rotateX(-Math.PI / 2);
    this.trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  }

  _ballMesh(id) {
    let b = this.ballMeshes.get(id);
    if (b) return b;
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
    mesh.castShadow = true;
    const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    shadow.renderOrder = 1;
    const N = 14;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    const trail = new THREE.Mesh(geo, this.trailMat);
    trail.frustumCulled = false; trail.renderOrder = 3;
    this.fx.add(mesh, shadow, trail);
    b = { mesh, shadow, trail, hist: [], N, seen: true, scale: 1 };
    this.ballMeshes.set(id, b);
    return b;
  }

  // ------------------------------------------------------------------ particles
  _particles() {
    const N = (this.PN = 700);
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pSize = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pMax = new Float32Array(N);
    this.pKind = new Uint8Array(N); this.pBase = new Float32Array(N * 4);
    this.pNext = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute vec3 aColor; varying vec3 vColor; uniform float uScale;
        void main(){ vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(180.0, aSize*uScale/max(0.05,-mv.z)); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vColor;
        void main(){ float d=length(gl_PointCoord-0.5); float a=smoothstep(0.5,0.05,d); gl_FragColor=vec4(vColor*a*a,1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.pMat = mat;
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 4;
    this.points = pts;
    this.fx.add(pts);
  }

  /** kind 0 spark, 1 flame, 2 electric */
  emit(kind, pos, vel, life, size, color) {
    const i = this.pNext; this.pNext = (this.pNext + 1) % this.PN;
    this.pPos[i * 3] = pos.x; this.pPos[i * 3 + 1] = pos.y; this.pPos[i * 3 + 2] = pos.z;
    this.pVel[i * 3] = vel.x; this.pVel[i * 3 + 1] = vel.y; this.pVel[i * 3 + 2] = vel.z;
    this.pLife[i] = life; this.pMax[i] = life; this.pKind[i] = kind;
    this.pBase[i * 4] = color.r; this.pBase[i * 4 + 1] = color.g; this.pBase[i * 4 + 2] = color.b; this.pBase[i * 4 + 3] = size;
  }

  sparks(xm, ym, o = {}) {
    const n = Math.round((o.count ?? 14) * (this.quality === 'high' ? 1 : 0.6));
    const p = this.w(xm, ym, o.h ?? 0.02);
    const col = o.color || this.colors.orange;
    const v = new THREE.Vector3();
    const sp = o.speed ?? 0.9;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, up = 0.25 + Math.random() * 0.9;
      v.set(Math.cos(a) * sp * (0.3 + Math.random()), up * sp, Math.sin(a) * sp * (0.3 + Math.random()));
      if (o.dir) { v.x += o.dir.x * sp; v.z += o.dir.z * sp; }
      this.emit(o.kind ?? 0, p, v, 0.25 + Math.random() * 0.45, (o.size ?? 0.011) * (0.5 + Math.random()), col);
    }
  }

  flames(dur = 1.2, power = 1) {
    this.L.decor.flamePots.forEach((f, i) => this.jets.push({ pos: this.wmm(f.x, f.y, f.z + 20), t: -i * 0.07, dur, power, i }));
  }

  // ------------------------------------------------------------------ lightning
  _bolts() {
    this.bolts = [];
    const SEG = 28;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.85, 1).multiplyScalar(5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (let k = 0; k < 8; k++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEG + 1) * 2 * 3), 3));
      const idx = [];
      for (let i = 0; i < SEG; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5;
      this.fx.add(mesh);
      this.bolts.push({ mesh, life: 0, a: V(0, 0, 0), b: V(0, 0, 0), width: 0.006, regen: 0, SEG, pts: new Float32Array((SEG + 1) * 3) });
    }
    this._bt = { t: V(0, 0, 0), s: V(0, 0, 0), v: V(0, 0, 0), p: V(0, 0, 0) };
  }

  lightning(a, b, o = {}) {
    const bolt = this.bolts.find((x) => x.life <= 0) || this.bolts[0];
    bolt.a.copy(a); bolt.b.copy(b);
    bolt.life = o.dur ?? 0.22; bolt.width = o.width ?? 0.007; bolt.regen = 0; bolt.amp = o.amp ?? 0.12;
    bolt.mesh.visible = true;
    // bolt colour: blue-white lightning; on the alien table cyan human lasers, green alien rays, red robot fire
    const BOLT = { blue: [0.55, 0.85, 1], cyan: [0.3, 0.95, 1], green: [0.45, 1, 0.2], red: [1, 0.12, 0.2], violet: [0.7, 0.3, 1] };
    const bc = BOLT[o.color || (this.theme.id === 'alien' ? 'cyan' : 'blue')] || BOLT.blue;
    bolt.mesh.material.color.setRGB(bc[0] * 5, bc[1] * 5, bc[2] * 5);
    if (this.theme.id === 'alien' && o.amp === undefined) bolt.amp = 0.018;
    this.flashers.storm.v = Math.max(this.flashers.storm.v, o.flash ?? 3);
    if (o.sparks !== false) this.sparksW(b, 10, o.color === 'green' ? this.colors.green : o.color === 'red' ? this.colors.red : this.colors.blue, 2);
  }

  sparksW(p, n, color, kind = 0) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set((Math.random() - 0.5) * 1.6, Math.random() * 1.2, (Math.random() - 0.5) * 1.6);
      this.emit(kind, p, v, 0.15 + Math.random() * 0.3, 0.008 + Math.random() * 0.01, color);
    }
  }

  anchor(name) {
    if (this.L.alien) { const a = alienAnchor(this, name); if (a) return a; }
    const d = this.L.decor, s = this.L.skull || (this.L.helmet ? { x: this.L.helmet.x, y: this.L.helmet.y + 40 } : { x: 240, y: 700 });
    switch (name) {
      case 'teslaL': return this.wmm(d.tesla[0].x, d.tesla[0].y, d.tesla[0].z + 80);
      case 'teslaR': return this.wmm(d.tesla[1].x, d.tesla[1].y, d.tesla[1].z + 80);
      case 'skull': return this.wmm(s.x, s.y - 20, 95);
      case 'sky': return this.wmm(120 + Math.random() * 280, 500 + Math.random() * 500, 620);
      case 'ramp': { const m = this.L.ramp ? this.L.ramp.mouth : [350, 555]; return this.wmm(m[0] + 10, m[1] + 40, 30); }
      case 'bank': return this.wmm(114, 554, 30);
      case 'roxy': { const r = this.L.roxy || this.L.village || { x: 240, y: 700 }; return this.wmm(r.x, r.y, 120); }
      case 'outL': return this.wmm(19, 300, 20);
      case 'outR': return this.wmm(461, 300, 20);
      case 'logo': return this.wmm(d.logo.x + (Math.random() - 0.5) * 300, d.logo.y - 10, d.logo.z);
      case 'bumpers': { const b = this.L.bumpers[(Math.random() * 3) | 0]; return this.wmm(b.x, b.y, 55); }
      default: return this.wmm(260 + (Math.random() - 0.5) * 380, 200 + Math.random() * 760, 6);
    }
  }

  strike(from, to, o) { this.lightning(this.anchor(from), this.anchor(to), o); }

  // ------------------------------------------------------------------ stage light beams
  _beams() {
    this.beams = [];
    this.beamLevel = 0; this.beamTarget = 0;
    if (this.theme.beams === false) return;
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(cv);
    const cols = this.theme.id === 'rotor' ? [this.colors.white, this.colors.white, this.colors.amber, this.colors.white] : this.theme.id === 'alien' ? [this.colors.green, this.colors.blue, this.colors.green, this.colors.red] : [this.colors.red, this.colors.blue, this.colors.orange, this.colors.blue];
    this.L.decor.parCans.forEach((p, i) => {
      const geo = new THREE.ConeGeometry(0.13, 1.0, 20, 1, true);
      geo.translate(0, -0.5, 0);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: cols[i % 4].clone(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const m = new THREE.Mesh(geo, mat);
      this.wmm(p.x, p.y - 20, p.z - 10, m.position);
      m.renderOrder = 6; m.frustumCulled = false;
      this.fx.add(m);
      this.beams.push({ m, mat, i, phase: i * 1.7 });
    });
    this.beamLevel = 0; this.beamTarget = 0.5;
  }

  // ------------------------------------------------------------------ camera
  resize(w, h, insets) {
    this._w = w; this._h = h;
    if (insets) this.insets = insets;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.5) * (this.scale || 1) * (this.dynScale || 1);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.pMat.uniforms.uScale.value = (h * dpr) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this._fit();
  }

  _fit() {
    const cam = this.camera;
    const aspect = cam.aspect;
    const portrait = aspect < 0.8;
    cam.fov = portrait ? 31 : 29 + clamp((aspect - 1.5) / 0.6, 0, 1) * 9;
    cam.updateProjectionMatrix();
    const h = this._h || 1;
    const topN = 1 - (2 * (this.insets.top + 6)) / h;
    const botN = -1 + (2 * (this.insets.bottom + (portrait ? 6 : 10))) / h;
    const fitOne = (elevDeg, pts, xLim, yaw = 0) => {
      const elev = (elevDeg * Math.PI) / 180;
      const dir = V(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
      const tgt = V(0, 0, 0);
      let d = 3;
      const p = V(0, 0, 0);
      const measure = (dist) => {
        cam.position.copy(tgt).addScaledVector(dir, dist);
        cam.lookAt(tgt); cam.updateMatrixWorld();
        let minX = 9, maxX = -9, minY = 9, maxY = -9;
        for (const q of pts) { p.copy(q).project(cam); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
        return { minX, maxX, minY, maxY };
      };
      for (let it = 0; it < 7; it++) {
        let lo = 0.6, hi = 9;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          const m = measure(mid);
          const ok = m.minX >= -xLim && m.maxX <= xLim && m.maxY - m.minY <= topN - botN;
          if (ok) hi = mid; else lo = mid;
        }
        d = hi;
        const m = measure(d);
        const off = (m.maxY + m.minY) / 2 - (topN + botN) / 2;
        tgt.z -= (off * d * Math.tan((cam.fov * Math.PI) / 360)) / Math.sin(elev) * 0.9;
      }
      measure(d);
      return { pos: cam.position.clone(), tgt: tgt.clone() };
    };
    const hw = TW / 2 + 0.03;
    const playPts = [V(-hw, 0.04, 0.6), V(hw, 0.04, 0.6), V(-hw, 0.04, -0.56), V(hw, 0.04, -0.56), V(-hw, portrait ? 0.24 : 0.36, -0.57), V(hw, portrait ? 0.24 : 0.36, -0.57)];
    // the wider the screen, the flatter the view: a player's-eye angle fills a landscape phone
    const wide = clamp((aspect - 1.5) / 0.6, 0, 1);
    // player-selectable views: std fits the whole table; flat is a low player's-eye angle that
    // lets the sides run off-screen; close follows the ball over half the table; top looks straight down
    const std = fitOne(portrait ? 61 : 48 - wide * 16, playPts, portrait ? 1.0 : 0.96);
    const dStd = std.pos.distanceTo(std.tgt);
    // fixed orbit around a target: elevation (deg), distance as a share of the standard view
    const orbit = (elevDeg, share, tz) => {
      const e = (elevDeg * Math.PI) / 180;
      const tgt = V(0, 0, tz);
      return { pos: tgt.clone().add(V(0, Math.sin(e), Math.cos(e)).multiplyScalar(dStd * share)), tgt };
    };
    // player's eye: low behind the flippers, the playfield fills the width, the far end at the top
    const eyePts = [V(-hw, 0.04, 0.52), V(hw, 0.04, 0.52), V(-hw, 0.04, -0.56), V(hw, 0.04, -0.56), V(-hw, 0.16, -0.57), V(hw, 0.16, -0.57)];
    const views = {
      player: fitOne(portrait ? 44 : 33 + wide * 5, eyePts, portrait ? 1.22 : 1.12 - wide * 0.1),
      std,
      flat: orbit(portrait ? 34 : 20 - wide * 4, portrait ? 0.62 : 0.6, 0.08),
      close: orbit(portrait ? 52 : 46, portrait ? 0.5 : 0.48, 0.12),
      top: fitOne(portrait ? 84 : 80, playPts.map((q) => V(q.x, 0.04, q.z)), portrait ? 1.0 : 0.96),
    };
    this.camViews = views;
    this.camPlay = views[this.view] || views.player;
    const attPts = [V(-hw, 0.04, 0.6), V(hw, 0.04, 0.6), V(-hw, 0.38, -0.57), V(hw, 0.38, -0.57), V(-hw, 0, -0.56), V(hw, 0, -0.56)];
    this.camAttract = fitOne(portrait ? 50 : 36 - wide * 8, attPts, portrait ? 1.12 : 0.9);
  }

  setView(v) {
    this.view = ['player', 'std', 'flat', 'close', 'top'].includes(v) ? v : 'player';
    if (this.camViews) this.camPlay = this.camViews[this.view];
  }

  setMode(mode) {
    this.camMixTarget = mode === 'attract' ? 0 : 1;
    this.beamTarget = mode === 'attract' ? 0.55 : 0.0;
    this.mode = mode;
  }

  shake(a) { this.trauma = Math.min(1, this.trauma + a * (this.reduced ? 0.25 : 1)); }

  // ------------------------------------------------------------------ event hooks
  bumperHit(id, x, y) {
    const b = this.parts.bumpers?.[id];
    if (b) b.hit = 1;
    this.flashers.bumpers.v = 9;
    this.sparks(x, y, { count: 16, h: 0.03, color: this.colors.orange, speed: 1.0 });
    this.shake(0.22);
  }

  slingHit(id, x, y, nx, ny) {
    this.flashers[id === 'L' ? 'slingL' : 'slingR'].v = 8;
    this.glow(`sling_${id}_plastic`, 5);
    this.sparks(x, y, { count: 10, h: 0.02, color: this.colors.white, speed: 0.8, dir: { x: nx, z: -ny } });
    this.shake(0.18);
  }

  spinnerKick(speed, which) { const s = which === 'R' && this.parts.spinnerR.o ? this.parts.spinnerR : this.parts.spinner; s.w = Math.max(s.w, speed * 22); }
  micBash() { this.parts.mic.hit = 1; this.glow('mic_glow', 6); }
  setDiscSpin() { this.parts.vinyl.flash = 1; }
  trussShow(idx, sec) { const T = this.parts.truss; T.show = Math.max(T.show, sec); T.focus = idx; }
  plungerFire(power) { this.parts.plunger.kick = 1; this.shake(0.1 + power * 0.15); }
  heliLift(on) { if (this.parts.heli) this.parts.heli.liftTarget = on ? 1 : 0; }
  heliBoost(sec = 1.5) { if (this.parts.heli) this.parts.heli.boost = Math.max(this.parts.heli.boost, sec); }
  skullEat() { this.heliBoost(1.6); const s = this.parts.skull; s.nod = this.theme.figure === 'tower' ? 0.25 : 1; this.flashers.skull.v = 12; this.glow('skull_eye_L', 6); this.glow('skull_eye_R', 6); }
  skullEject() { const s = this.parts.skull; s.nod = this.theme.figure === 'tower' ? 0.15 : 0.6; this.flashers.skull.v = 8; }
  gateSwing(id) { this.parts.gateSwing[id] = 1; }
  roxyLaugh(big) { const r = this.parts.roxy; r.len = big ? 2.6 : 1.25; r.laugh = r.len; }
  /** The pin-up gets the ball between her legs: shriek, jump, skirt flies up, she spins, then giggles. */
  roxyShriek(big) { const r = this.parts.roxy; r.shriek = big ? 1.9 : 1.5; r.shriekLen = r.shriek; r.len = big ? 2.8 : 2.0; r.laugh = r.len; }
  /** Table position (metres) -> CSS pixels inside the canvas. */
  project(xm, ym, h = 0.03) {
    const v = this.w(xm, ym, h).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this._w, y: (-v.y * 0.5 + 0.5) * this._h, visible: v.z < 1 };
  }
  beat(type) {
    if (type === 'kick') this.beatPulse = 1;
    else if (type === 'snare') this.snarePulse = 1;
  }
  startStorm(sec) { this.storm = Math.max(this.storm, sec); }
  /** Red alert: the whole table goes red with rotating warning beacons. */
  setAlarm(on) {
    this.alarmTarget = on ? 1 : 0;
    if (on && !this.beacons) {
      this.beacons = [0, 1].map((i) => {
        const l = new THREE.PointLight(0xff1a10, 0, 1.4, 1.5);
        this.wmm(i ? 410 : 70, 760, 220, l.position);
        this.scene.add(l);
        return l;
      });
    }
  }
  flashLamps(sec = 0.6) { this.lampFlash = Math.max(this.lampFlash, sec); }
  dim(sec = 1.6) { this.gi = 0.12; this.giTarget = 1; this._giDelay = sec; }

  // ------------------------------------------------------------------ frame
  frame(dt, game) {
    if (!this.ready) return;
    this.time += dt;
    const t = this.time;
    const phys = game.phys;
    const P = this.parts;
    this.multiball = game.multiball;

    // flippers
    for (const f of phys.flippers) { const o = P.flippers[f.id]; if (o) o.rotation.set(0, f.angle, 0); }
    // drop targets
    phys.targets.forEach((tg, i) => {
      const p = P.targets[i]; if (!p.o) return;
      const goal = tg.up ? 0 : -0.036;
      p.y += (goal - p.y) * Math.min(1, dt * (tg.up ? 9 : 26));
      p.o.position.y = p.y0 + p.y;
    });
    // bumpers
    P.bumpers.forEach((b, i) => {
      b.hit = Math.max(0, b.hit - dt * 7);
      if (b.ring) b.ring.position.y = b.ringY - 0.009 * b.hit;
      if (b.cap) b.cap.position.y = b.capY - 0.002 * b.hit;
      const g = this.glows[`bumper_${i}_cap`];
      if (g) g.level = Math.max(g.level, 1 + b.hit * 5);
    });
    // spinner
    if (P.spinner.o) { P.spinner.w *= Math.exp(-dt * 1.6); if (Math.abs(P.spinner.w) < 0.4) P.spinner.w = 0; P.spinner.o.rotation.x += P.spinner.w * dt; if (!P.spinner.w) P.spinner.o.rotation.x *= 1 - Math.min(1, dt * 4); }
    // second spinner, turntable, mic stand, truss heads (RIFFGEWITTER)
    if (P.spinnerR.o) { const S = P.spinnerR; S.w *= Math.exp(-dt * 1.6); if (Math.abs(S.w) < 0.4) S.w = 0; S.o.rotation.x += S.w * dt; if (!S.w) S.o.rotation.x *= 1 - Math.min(1, dt * 4); }
    if (P.vinyl.o) { const d = phys.discs && phys.discs[0]; P.vinyl.o.rotation.y += (d ? d.omega : 7) * dt; }
    if (P.mic.o) {
      P.mic.hit = Math.max(0, P.mic.hit - dt * 1.4);
      const w = P.mic.hit * P.mic.hit * 0.22;
      P.mic.o.rotation.x = P.mic.rx + Math.sin(t * 19) * w;
      P.mic.o.rotation.z = P.mic.rz + Math.cos(t * 15) * w * 0.7;
    }
    if (P.truss.heads.length) {
      const T = P.truss; T.show = Math.max(0, T.show - dt);
      const amp = T.show > 0 || game.multiball ? 0.75 : 0.28, sp = T.show > 0 || game.multiball ? 2.6 : 0.7;
      T.heads.forEach((o, i) => {
        const ph = i * 1.7 + (i % 2 ? Math.PI : 0);
        o.rotation.y = T.base[i].y + Math.sin(t * sp + ph) * amp;
        o.rotation.x = T.base[i].x + Math.sin(t * sp * 0.7 + ph * 1.3) * amp * 0.45;
      });
    }
    // plunger
    if (P.plunger.o) {
      P.plunger.kick = Math.max(0, P.plunger.kick - dt * 6);
      P.plunger.o.position.z = P.plunger.z0 + game.plunger.charge * this.L.plunger.pull * MM - Math.sin(P.plunger.kick * Math.PI) * 0.012;
    }
    // gates
    for (const id of ['shooter', 'top']) {
      const o = P.gates[id]; if (!o) continue;
      P.gateSwing[id] = Math.max(0, P.gateSwing[id] - dt * 3);
      o.rotation.x = Math.sin(P.gateSwing[id] * 9) * P.gateSwing[id] * 0.9;
    }
    // skull
    if (P.skull.o) {
      P.skull.nod = Math.max(0, P.skull.nod - dt * 2.2);
      const sh = this.storm > 0 ? Math.sin(t * 60) * 0.02 : 0;
      P.skull.o.rotation.x = -Math.sin(P.skull.nod * Math.PI) * 0.2 + sh;
      P.skull.o.rotation.z = sh * 0.8;
    }
    // helicopter: rotor always turning; spins up on a lock, lifts off for multiball
    if (P.heli && P.heli.o) {
      const H = P.heli;
      H.boost = Math.max(0, H.boost - dt);
      const attract = game.state === 'attract' || game.state === 'gameover';
      H.spinTarget = H.lift > 0.05 || H.boost > 0 || game.multiball ? 1 : attract ? 0.35 : 0.22;
      H.spin += (H.spinTarget - H.spin) * Math.min(1, dt * 1.2);
      H.ang += H.spin * 34 * dt;
      if (H.rotor) H.rotor.rotation.y = H.ang;
      if (H.disc) { H.disc.material.opacity = Math.max(0, H.spin - 0.15) * 0.42; H.disc.visible = H.disc.material.opacity > 0.01; }
      if (H.tail) H.tail.rotation.x = H.ang * 2.6;
      H.liftTarget = game.multiball ? 1 : 0;
      H.lift += (H.liftTarget - H.lift) * Math.min(1, dt * (H.liftTarget ? 1.1 : 0.6));
      const k = H.lift * H.lift * (3 - 2 * H.lift);
      const bob = Math.sin(t * 2.1) * 0.004 * k;
      H.o.position.y = H.y0 + k * 0.105 + bob + (H.boost > 0 ? Math.sin(t * 40) * 0.0008 : 0);
      H.o.position.x = H.x0 + Math.sin(t * 0.55) * 0.05 * k;
      H.o.position.z = H.z0 + Math.sin(t * 0.37) * 0.02 * k;
      H.o.rotation.y = Math.sin(t * 0.45) * 0.5 * k;
      H.o.rotation.x = 0.12 * k + Math.sin(t * 0.9) * 0.03 * k;
      H.o.rotation.z = Math.cos(t * 0.55) * 0.1 * k;
      if (this.audioRotor) this.audioRotor(H.spin);
    }
    // monsoon rain on the rotor table (storm, monsoon mode, multiball)
    if (this.theme.id === 'rotor') {
      const heavy = this.storm > 0 || (game.elevenUntil && game.elevenUntil > game.time) ? 1 : this.multiball ? 0.45 : 0.06;
      const n = Math.floor(heavy * (this.quality === 'high' ? 9 : 5) * dt * 60 + Math.random());
      const rc = this._rainCol || (this._rainCol = new THREE.Color(0.7, 0.8, 0.95));
      const pv = this._rainP || (this._rainP = new THREE.Vector3()), vv = this._rainV || (this._rainV = new THREE.Vector3(-0.25, -3.2, 0.4));
      for (let i = 0; i < n; i++) {
        pv.set((Math.random() - 0.5) * 0.62, 0.3 + Math.random() * 0.25, (Math.random() - 0.5) * 1.15);
        this.emit(4, pv, vv, 0.35, 0.0045, rc);
      }
    }
    // Roxy: head-bangs to the kick drum, throws her head back when she laughs
    {
      const r = P.roxy;
      r.laugh = Math.max(0, r.laugh - dt);
      const a = r.laugh > 0 ? Math.min(1, r.laugh * 5, (r.len - r.laugh) * 9 + 0.15) : 0;
      const sh = Math.sin(t * 34) * a;
      if (this.theme.figure === 'tower') {
        // watchtower: hut sways, searchlight sweeps the jungle, signal flag waves on a low pass
        if (r.torso) { r.torso.rotation.x = r.torso0.x + sh * 0.02 + Math.sin(t * 0.9) * 0.008; r.torso.rotation.z = r.torso0.z + Math.sin(t * 0.7) * 0.012 + sh * 0.02; }
        if (r.head) { r.head.rotation.y = r.head0.y + Math.sin(t * (a > 0 ? 6 : 0.6)) * (0.7 + a * 0.4); }
        if (r.arm) { r.arm.rotation.z = r.arm0.z + Math.sin(t * 9) * (0.12 + a * 0.5); }
      } else {
      // shriek: p = seconds since the ball went through
      r.shriek = Math.max(0, r.shriek - dt);
      const p = r.shriek > 0 ? r.shriekLen - r.shriek : 99;
      const s = r.shriek > 0 ? Math.min(1, p * 14, r.shriek * 3) : 0; // overall envelope
      const hop = p < 0.42 ? Math.sin((p / 0.42) * Math.PI) : p < 0.66 ? 0.32 * Math.sin(((p - 0.42) / 0.24) * Math.PI) : 0;
      const flare = s * (p < 0.12 ? p / 0.12 : Math.max(0.35, 1 - (p - 0.12) * 0.9));
      if (r.root) {
        r.root.position.y = r.rootP.y + 0.017 * hop * (this.reduced ? 0.4 : 1);
        r.root.rotation.y = r.root0.y + (p < 1.2 ? Math.sin(p * 15) * 0.32 * s * (1 - p / 1.2) : 0);
      }
      if (r.skirt) {
        const w = Math.sin(t * 31) * 0.5 + Math.sin(t * 19) * 0.5;
        // the shape key billows the skirt into a bell; a little extra scale and wobble on top
        for (const m of r.morphs) m.morphTargetInfluences[0] = Math.min(1, flare * (0.9 + 0.1 * w));
        const sc = r.morphs.length ? 0.08 : 0.22;
        r.skirt.scale.set(1 + sc * flare + w * 0.02 * flare, 1 - 0.06 * flare, 1 + sc * flare + w * 0.02 * flare);
        r.skirt.rotation.z = r.skirt0.z + w * 0.1 * flare;
        r.skirt.rotation.x = r.skirt0.x + Math.sin(t * 23) * 0.06 * flare;
      }
      const jerk = s * (p < 0.3 ? 1 : 0.5);
      if (r.torso) { r.torso.rotation.x = r.torso0.x - 0.2 * a - 0.12 * jerk + sh * 0.035 + this.beatPulse * 0.03; r.torso.rotation.z = r.torso0.z + Math.sin(t * 1.7) * 0.025 + Math.sin(t * 22) * 0.06 * s; }
      if (r.head) { r.head.rotation.x = r.head0.x - 0.34 * a - 0.12 * jerk + sh * 0.05 + this.beatPulse * 0.16 * (1 - a); r.head.rotation.y = r.head0.y + Math.sin(t * 13) * 0.25 * s; }
      if (r.arm) { r.arm.rotation.z = r.arm0.z - a * 0.4 * Math.abs(Math.sin(t * 9)) - this.snarePulse * 0.1 - s * 0.35 * (0.6 + 0.4 * Math.sin(t * 24)); }
      }
    }
    // M16 diverter swings to the side the next supply run will take; tunnel trapdoor opens when lit
    if (P.m16 && P.m16.o) {
      const target = (game.diverter === 'L' ? 0.75 : -0.55);
      P.m16.a += (target - P.m16.a) * Math.min(1, dt * 7);
      P.m16.o.rotation.y = P.m16.a0 + P.m16.a;
    }
    if (P.cuchiDoor && P.cuchiDoor.o) {
      P.cuchiDoor.v += ((game.cuchiLit ? 1 : 0) - P.cuchiDoor.v) * Math.min(1, dt * 5);
      P.cuchiDoor.o.rotation.x = P.cuchiDoor.x0 - P.cuchiDoor.v * 1.9;
    }
    if (this.L.alien) frameAlien(this, dt, game);
    // speakers
    this.beatPulse = Math.max(0, this.beatPulse - dt * 7);
    this.snarePulse = Math.max(0, this.snarePulse - dt * 6);
    const cs = 1 + this.beatPulse * 0.16;
    for (const c of P.cones) c.scale.setScalar(cs);

    this._balls3d(dt, game);
    this._lamps(dt, game);
    this._glows(dt, game);
    this._fxUpdate(dt, game);
    this._camera(dt, game);

    // adaptive resolution
    this._perf(dt);
    this.composer.render(dt);
  }

  _balls3d(dt, game) {
    const R = this.L.ballR * MM;
    for (const b of this.ballMeshes.values()) b.seen = false;
    const tmp = [0, 0, 0];
    for (const pb of game.phys.balls) {
      const b = this._ballMesh(pb.id);
      b.seen = true;
      let h = R + (pb.z || 0), x = pb.x, y = pb.y, scale = 1;
      if (pb.level === 0 && this.L.rotor) h = R + this.L.rotor.tunnel.z * MM;
      if (pb.mode === 'held' && pb.show) {
        b.scale = Math.min(1, b.scale + dt * 8);
      } else if (pb.mode === 'held') {
        // swallowed by the skull
        b.scale = Math.max(0, b.scale - dt * 5);
        scale = b.scale; y = pb.y + (1 - b.scale) * 0.03;
      } else b.scale = Math.min(1, b.scale + dt * 8);
      scale = b.scale;
      this.w(x, y, h, b.mesh.position);
      b.mesh.scale.setScalar(Math.max(0.001, scale));
      b.mesh.visible = scale > 0.02;
      // shadow
      const sh = b.shadow;
      sh.visible = b.mesh.visible;
      const zz = Math.max(0, pb.z || 0);
      this.w(x - 0.004 - zz * 0.25, y - 0.004, pb.level === 0 && this.L.rotor ? this.L.rotor.tunnel.z * MM + 0.0009 : pb.mode === 'held' && pb.show && zz > 0.01 ? zz + 0.0009 : 0.0009, sh.position);
      const ss = pb.mode === 'held' && pb.show ? 1 : 1 + zz * 6;
      sh.scale.set(ss * scale, 1, ss * scale);
      // trail
      const sp = Math.hypot(pb.vx, pb.vy) + (pb.mode === 'ramp' ? pb.sv : 0);
      b.hist.unshift({ x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z, s: sp });
      if (b.hist.length > b.N) b.hist.pop();
      this._trail(b);
    }
    for (const [id, b] of this.ballMeshes) {
      if (!b.seen) { this.fx.remove(b.mesh, b.shadow, b.trail); b.trail.geometry.dispose(); this.ballMeshes.delete(id); }
    }
  }

  _trail(b) {
    const pos = b.trail.geometry.attributes.position.array;
    const col = b.trail.geometry.attributes.color.array;
    const hot = this.multiball;
    const R = this.L.ballR * MM;
    const n = b.hist.length;
    for (let i = 0; i < b.N; i++) {
      const p = b.hist[Math.min(i, n - 1)];
      const q = b.hist[Math.min(i + 1, n - 1)];
      let dx = p.x - q.x, dz = p.z - q.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const k = 1 - i / (b.N - 1);
      const wdt = R * 0.85 * k;
      pos[i * 6] = p.x - dz * wdt; pos[i * 6 + 1] = p.y; pos[i * 6 + 2] = p.z + dx * wdt;
      pos[i * 6 + 3] = p.x + dz * wdt; pos[i * 6 + 4] = p.y; pos[i * 6 + 5] = p.z - dx * wdt;
      const a = clamp((p.s - 0.9) / 2.2, 0, 1) * k * k * (hot ? 1.6 : 0.5);
      const r = hot ? 1.0 : 0.45, g = hot ? 0.4 : 0.7, bl = hot ? 0.08 : 1.0;
      for (let j = 0; j < 2; j++) { col[i * 6 + j * 3] = r * a; col[i * 6 + j * 3 + 1] = g * a; col[i * 6 + j * 3 + 2] = bl * a; }
    }
    b.trail.geometry.attributes.position.needsUpdate = true;
    b.trail.geometry.attributes.color.needsUpdate = true;
  }

  _lamps(dt, game) {
    const t = this.time;
    this.lampFlash = Math.max(0, this.lampFlash - dt);
    const attract = game.state === 'attract' || game.state === 'gameover';
    const c = this._tmpColor;
    for (const id in this.insertIndex) {
      const e = this.insertIndex[id];
      let v;
      if (attract) {
        // light show: three interleaved sweeps
        const ph = Math.floor(t / 4) % 3;
        const l = e.l;
        const a = ph === 0 ? Math.sin(l.y * 0.012 - t * 5) : ph === 1 ? Math.sin(Math.hypot(l.x - 240, l.y - 600) * 0.02 - t * 6) : Math.sin(l.x * 0.03 + l.y * 0.01 + t * 7);
        v = a > 0.35 ? 1 : 0.04;
      } else {
        const m = game.lamps[id] || 0;
        v = m === 1 ? 1 : m === 2 ? (Math.sin(t * 22) > 0 ? 1.25 : 0.05) : m === 3 ? 0.35 + 0.3 * Math.sin(t * 3.2 + e.l.y * 0.01) : 0.03;
        if (id.startsWith('stage')) v = (Math.sin(t * (this.multiball ? 14 : 3) + e.i * 0.8) > 0.2 ? 1 : 0.08) * (0.4 + this.beatPulse);
        if (id.startsWith('run')) v = Math.sin(t * 9 - e.l.y * 0.05) > 0.5 && (game.lockLit || game.multiball || game.extraBallLit) ? 1 : 0.05;
      }
      if (!attract && e.l.id.startsWith('chase')) {
        // chase lights run up the orbits; faster in multiball
        const k = +e.l.id.slice(6), sp = this.multiball ? 18 : 7;
        v = ((t * sp - k) % 7 + 7) % 7 < 1.6 ? 1.2 : 0.08;
      }
      if (this.lampFlash > 0) v = Math.sin(t * 40 + e.l.x * 0.05) > 0 ? 1.4 : 0.1;
      v *= 0.15 + 0.85 * this.gi;
      if (this.alarmV > 0.05 && !attract) v = Math.max(v, Math.sin(t * 7 + e.l.x * 0.02) > 0.3 ? this.alarmV * 1.2 : 0.05);
      e.v += (v - e.v) * Math.min(1, dt * 22);
      c.copy(e.color);
      if (this.alarmV > 0.05) c.lerp(this._redCol || (this._redCol = new THREE.Color(1, 0.12, 0.08)), this.alarmV);
      c.multiplyScalar(e.v * 1.5);
      e.mesh.setColorAt(e.i, c);
    }
    for (const im of this.inserts) im.instanceColor.needsUpdate = true;
  }

  _glows(dt, game) {
    const t = this.time;
    const attract = game.state === 'attract' || game.state === 'gameover';
    const G = this.glows;
    const set = (n, v) => { if (G[n]) G[n].hold = v; };
    // idle levels
    const gi = this.gi;
    const strobe = this.storm > 0 ? (Math.sin(t * 50) > 0 ? 2.2 : 0.2) : 1;
    set('logo_glow', (attract ? 0.8 + 0.5 * Math.sin(t * 2) : 0.9 + this.beatPulse * 0.6) * strobe * (Math.random() > 0.985 ? 0.3 : 1));
    for (let i = 0; i < 2; i++) {
      set(`amp_${i}_logo_glow`, 0.7 + this.beatPulse * 1.5);
      set(`tesla_${i}_glow`, 0.5 + (this.storm > 0 ? 3 * Math.random() : 0.3 * Math.sin(t * 6 + i)));
      set(`guitar_${i}_strings_glow`, 0.12 + this.snarePulse * 1.6);
    }
    for (let i = 0; i < 4; i++) {
      set(`flamepot_${i}_glow`, 0.3 + (this.jets.some((j) => j.i === i && j.t > 0) ? 4 : 0));
      set(`par_${i}_glow`, attract || this.storm > 0 ? 1.2 + Math.sin(t * 3 + i * 1.5) : 0.5);
    }
    set('heli_beacon', Math.sin(t * 7) > 0.6 ? 3 : 0.15);
    const eye = 0.6 + 0.4 * Math.sin(t * 4) + (game.lockLit || game.multiball ? 1.2 + Math.sin(t * 16) * 0.8 : 0);
    set('skull_eye_L', eye); set('skull_eye_R', eye);
    for (const id of ['L', 'R']) set(`sling_${id}_plastic`, 0.5 * gi + this.beatPulse * 0.25);
    for (const id of ['left', 'right', 'strip']) set(`island_${id}_plastic`, (0.45 + 0.2 * Math.sin(t * 2 + id.length)) * gi * strobe);
    for (let i = 0; i < 4; i++) set(`droptarget_${i}`, 0.9 + 0.4 * Math.sin(t * 5 + i));
    if (this.theme.id === 'rotor') {
      set('raillamps_glow', 0.8 + 0.2 * Math.sin(t * 2.3) + (this.multiball ? 0.6 * (Math.sin(t * 14) > 0 ? 1 : 0) : 0));
      set('helmet_glow', game.lamps && game.lamps.helmetArrow === 2 ? 1.6 + Math.sin(t * 9) * 0.8 : 0.5);
      set('village_glow', 0.7 + 0.25 * Math.sin(t * 3.1) + (Math.random() > 0.97 ? -0.3 : 0));
      set('cuchi_glow', game.cuchiLit ? 2 + Math.sin(t * 12) : 0.35);
      set('khesanh_glow', Math.sin(t * 5) > 0.3 ? 1.6 : 0.2);
      for (let i = 10; i < 13; i++) set(`standup_${i}_glow`, game.tunnelHits && game.tunnelHits[i - 10] ? 2.2 : 0.6);
    }
    for (let i = 0; i < 2; i++) set(`standup_${i}_glow`, game.eleven && game.eleven[i] ? 2.4 : 0.8 + 0.4 * Math.sin(t * 6 + i * 3));
    for (let i = 0; i < 3; i++) set(`bumper_${i}_cap`, (0.55 + 0.25 * Math.sin(t * 3 + i * 2) + this.beatPulse * 0.5) * (0.25 + 0.75 * gi));
    for (const n in G) {
      const g = G[n];
      g.level += (g.hold - g.level) * Math.min(1, dt * 9);
      for (let i = 0; i < g.mats.length; i++) g.mats[i].emissiveIntensity = g.base[i] * Math.max(0, g.level);
    }
    // flashers decay
    for (const k in this.flashers) {
      const f = this.flashers[k];
      f.v = Math.max(0, f.v - dt * (k === 'storm' ? 30 : 34));
      f.light.intensity = f.v * 0.06;
    }
    // general illumination
    if (this._giDelay > 0) this._giDelay -= dt; else this.gi += (this.giTarget - this.gi) * Math.min(1, dt * 2.5);
    this.key.intensity = 1.25 * (0.3 + 0.7 * this.gi);
    // red alert grading
    this.alarmV = (this.alarmV || 0) + ((this.alarmTarget || 0) - (this.alarmV || 0)) * Math.min(1, dt * 3);
    if (this.alarmV > 0.001) {
      const a = this.alarmV;
      this._keyCol = this._keyCol || new THREE.Color(0xfff0e0);
      this.key.color.copy(this._keyCol).lerp(this._redCol || (this._redCol = new THREE.Color(1, 0.12, 0.08)), a * 0.85);
      this.hemi.color.setRGB(0.66 + 0.34 * a, 0.71 * (1 - a * 0.8), 1 * (1 - a * 0.85));
      this.key.intensity *= 1 - a * 0.25;
      if (this.beacons) this.beacons.forEach((l, i) => { l.intensity = a * 3.2 * Math.max(0, Math.sin(t * 7 + i * Math.PI)) ** 2; });
      this.scene.background.copy(this.bg).lerp(this._redBg || (this._redBg = new THREE.Color(0.16, 0.0, 0.0)), a * (0.5 + 0.5 * Math.max(0, Math.sin(t * 7))));
    } else if (this._keyCol) {
      this.key.color.copy(this._keyCol);
      this.hemi.color.setRGB(0.66, 0.71, 1);
      this.scene.background.copy(this.bg);
      if (this.beacons) this.beacons.forEach((l) => { l.intensity = 0; });
    }
    this.hemi.intensity = 0.4 * (0.35 + 0.65 * this.gi);
  }

  _fxUpdate(dt, game) {
    const t = this.time;
    // storm: repeated strikes
    if (this.storm > 0) {
      this.storm -= dt;
      this._stormT = (this._stormT || 0) - dt;
      if (this._stormT <= 0) {
        this._stormT = 0.07 + Math.random() * 0.16;
        const pick = Math.random();
        if (this.theme.id === 'alien') {
          if (pick < 0.5) this.strike('ship', 'table', { dur: 0.16, width: 0.007, color: 'green' });
          else this.strike(pick < 0.75 ? 'teslaL' : 'teslaR', 'ship', { dur: 0.18, width: 0.008 });
        } else if (this.theme.id === 'rotor' && pick < 0.45) this.strike('sky', Math.random() < 0.5 ? 'teslaL' : 'teslaR', { dur: 0.16, width: 0.009 });
        else if (pick < 0.3) this.strike('teslaL', 'skull', { dur: 0.16 });
        else if (pick < 0.6) this.strike('teslaR', 'skull', { dur: 0.16 });
        else if (pick < 0.75) this.strike('teslaL', 'teslaR', { dur: 0.18, amp: 0.2 });
        else this.strike('sky', 'table', { dur: 0.14, width: 0.009, amp: 0.1 });
        if (!this.reduced) this.shake(0.12);
      }
    } else if (this.multiball && Math.random() < dt * 1.4) {
      this.strike(Math.random() < 0.5 ? 'teslaL' : 'teslaR', Math.random() < 0.5 ? 'skull' : 'bumpers', { dur: 0.14, flash: 3 });
    } else if ((game.state === 'attract') && Math.random() < dt * 0.45) {
      this.strike(Math.random() < 0.5 ? 'teslaL' : 'teslaR', 'skull', { dur: 0.18, flash: 3 });
    }

    // flame jets
    const up = new THREE.Vector3();
    const flameCol = this._flameCol || (this._flameCol = new THREE.Color(1.0, 0.55, 0.12));
    for (let i = this.jets.length - 1; i >= 0; i--) {
      const j = this.jets[i];
      j.t += dt;
      if (j.t > j.dur) { this.jets.splice(i, 1); continue; }
      if (j.t < 0) continue;
      const n = this.quality === 'high' ? 5 : 3;
      if (this.theme.jets === 'smoke') {
        // signal smoke: slow, billowing columns in the canister's colour
        const sc = this._smokeCols || (this._smokeCols = [new THREE.Color(0.35, 1, 0.2), new THREE.Color(0.75, 0.35, 1), new THREE.Color(1, 0.3, 0.15), new THREE.Color(1, 0.85, 0.2)]);
        for (let k = 0; k < Math.ceil(n * 0.6); k++) {
          up.set((Math.random() - 0.5) * 0.08, (0.32 + Math.random() * 0.25) * j.power, (Math.random() - 0.5) * 0.08 + 0.04);
          this.emit(3, j.pos, up, 1.1 + Math.random() * 0.8, 0.05 + Math.random() * 0.04, sc[j.i % 4]);
        }
      } else for (let k = 0; k < n; k++) {
        up.set((Math.random() - 0.5) * 0.12, (1.1 + Math.random() * 0.7) * j.power, (Math.random() - 0.5) * 0.12 + 0.05);
        this.emit(1, j.pos, up, 0.35 + Math.random() * 0.3, 0.035 + Math.random() * 0.03, flameCol);
      }
    }

    // particles
    const N = this.PN, pos = this.pPos, vel = this.pVel, col = this.pCol, size = this.pSize, life = this.pLife;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) size[i] = 0; continue; }
      life[i] -= dt;
      const k = Math.max(0, life[i] / this.pMax[i]);
      const kind = this.pKind[i];
      const i3 = i * 3, i4 = i * 4;
      if (kind === 1) { vel[i3 + 1] += 0.9 * dt; vel[i3] *= 1 - dt * 1.5; vel[i3 + 2] *= 1 - dt * 1.5; }
      else if (kind === 3) { vel[i3 + 1] *= 1 - dt * 0.6; vel[i3] += 0.05 * dt; vel[i3 + 2] += 0.03 * dt; }
      else if (kind === 4) { /* rain: constant fall */ }
      else { vel[i3 + 1] -= 3.2 * dt; }
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (kind === 4 && pos[i3 + 1] < 0.004) { life[i] = 0; size[i] = 0; continue; }
      if (kind !== 1 && kind !== 3 && pos[i3 + 1] < 0.003) { pos[i3 + 1] = 0.003; vel[i3 + 1] *= -0.45; }
      let r = this.pBase[i4], g = this.pBase[i4 + 1], b = this.pBase[i4 + 2], s = this.pBase[i4 + 3];
      if (kind === 3) {
        // smoke: swells, fades in and out softly
        const f = Math.min(1, (1 - k) * 6) * k;
        r *= 0.55 * f; g *= 0.55 * f; b *= 0.55 * f;
        s *= 1 + (1 - k) * 3.2;
      } else if (kind === 4) {
        r *= 0.5; g *= 0.55; b *= 0.6;
      } else if (kind === 1) {
        // flame: white-yellow core -> orange -> red, grows then shrinks
        const heat = k;
        r = 2.4 * heat + 0.4; g = 1.5 * heat * heat; b = 0.5 * heat * heat * heat;
        s *= 0.5 + Math.sin(k * Math.PI) * 1.2;
        const f = k < 0.2 ? k / 0.2 : 1;
        r *= f; g *= f; b *= f;
      } else {
        const br = 2.2 * k + (kind === 2 ? Math.random() * 1.5 : 0);
        r *= br; g *= br * (0.5 + 0.5 * k); b *= br * (kind === 2 ? 1 : k);
        s *= 0.4 + 0.6 * k;
      }
      col[i3] = r; col[i3 + 1] = g; col[i3 + 2] = b; size[i] = s;
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = true; ga.aColor.needsUpdate = true; ga.aSize.needsUpdate = true;

    // lightning ribbons
    const { t: T, s: S, v: Vv, p: Pp } = this._bt;
    const camPos = this.camera.position;
    for (const b of this.bolts) {
      if (b.life <= 0) { if (b.mesh.visible) b.mesh.visible = false; continue; }
      b.life -= dt;
      b.regen -= dt;
      const SEG = b.SEG;
      if (b.regen <= 0) {
        b.regen = 0.035;
        const len = b.a.distanceTo(b.b);
        // midpoint-displacement style: sum of random octaves
        const o1 = Math.random() * 9, o2 = Math.random() * 9, o3 = Math.random() * 9, o4 = Math.random() * 9;
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG, env = Math.sin(u * Math.PI);
          const n1 = (Math.sin(u * 7 + o1) + 0.6 * Math.sin(u * 17 + o2) + 0.35 * (Math.random() - 0.5) * 2) * env * len * b.amp;
          const n2 = (Math.sin(u * 5 + o3) + 0.6 * Math.sin(u * 13 + o4) + 0.35 * (Math.random() - 0.5) * 2) * env * len * b.amp;
          b.pts[i * 3] = b.a.x + (b.b.x - b.a.x) * u + n1;
          b.pts[i * 3 + 1] = b.a.y + (b.b.y - b.a.y) * u + n2 * 0.5;
          b.pts[i * 3 + 2] = b.a.z + (b.b.z - b.a.z) * u + n2;
        }
      }
      const arr = b.mesh.geometry.attributes.position.array;
      const flick = 0.6 + Math.random() * 0.6;
      for (let i = 0; i <= SEG; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(SEG, i + 1);
        T.set(b.pts[i1 * 3] - b.pts[i0 * 3], b.pts[i1 * 3 + 1] - b.pts[i0 * 3 + 1], b.pts[i1 * 3 + 2] - b.pts[i0 * 3 + 2]);
        Pp.set(b.pts[i * 3], b.pts[i * 3 + 1], b.pts[i * 3 + 2]);
        Vv.copy(camPos).sub(Pp);
        S.crossVectors(T, Vv).normalize().multiplyScalar(b.width * 0.5 * flick * (0.45 + 0.55 * Math.sin((i / SEG) * Math.PI)));
        arr[i * 6] = Pp.x + S.x; arr[i * 6 + 1] = Pp.y + S.y; arr[i * 6 + 2] = Pp.z + S.z;
        arr[i * 6 + 3] = Pp.x - S.x; arr[i * 6 + 4] = Pp.y - S.y; arr[i * 6 + 5] = Pp.z - S.z;
      }
      b.mesh.geometry.attributes.position.needsUpdate = true;
    }

    // stage beams
    this.beamLevel += ((this.storm > 0 || this.multiball ? 0.6 : this.beamTarget) - this.beamLevel) * Math.min(1, dt * 2);
    for (const bm of this.beams) {
      bm.mat.opacity = this.beamLevel * (0.05 + 0.035 * Math.sin(t * 2.2 + bm.phase)) * (this.reduced ? 0.6 : 1);
      bm.m.visible = bm.mat.opacity > 0.004;
      const sp = this.multiball ? 2.6 : 0.7;
      bm.m.rotation.set(-0.95 + 0.28 * Math.sin(t * sp + bm.phase), 0, 0.4 * Math.sin(t * sp * 0.7 + bm.phase * 2));
    }
  }

  _camera(dt, game) {
    this.camMix += (this.camMixTarget - this.camMix) * Math.min(1, dt * 1.8);
    const k = this.camMix * this.camMix * (3 - 2 * this.camMix);
    const cam = this.camera;
    const a = this.camAttract, p = this.camPlay;
    const pos = this._cp || (this._cp = V(0, 0, 0)), tgt = this._ct || (this._ct = V(0, 0, 0));
    pos.lerpVectors(a.pos, p.pos, k); tgt.lerpVectors(a.tgt, p.tgt, k);
    const t = this.time;
    // attract sway
    const sway = (1 - k) * (this.reduced ? 0.3 : 1);
    pos.x += Math.sin(t * 0.25) * 0.55 * sway;
    pos.y += Math.sin(t * 0.19) * 0.08 * sway;
    // gentle ball follow while playing
    let fx = 0, fz = 0, n = 0;
    for (const b of game.phys.balls) { fx += b.x - TW / 2; fz += TL / 2 - b.y; n++; }
    if (n) { fx /= n; fz /= n; }
    this._fx = (this._fx || 0) + (fx - (this._fx || 0)) * Math.min(1, dt * 3);
    this._fz = (this._fz || 0) + (fz - (this._fz || 0)) * Math.min(1, dt * 3);
    const follow = k * (this.reduced ? 0 : 1);
    tgt.x += this._fx * 0.035 * follow; tgt.z += this._fz * 0.03 * follow;
    // flat and close views travel with the ball (camera and target together)
    const travel = k * (this.view === 'close' ? 0.85 : this.view === 'flat' ? 0.4 : this.view === 'player' ? 0.18 : 0);
    if (travel) {
      const tx = clamp(this._fx, -0.12, 0.12) * travel * 0.6, tz = clamp(this._fz, -0.42, 0.42) * travel;
      pos.x += tx; tgt.x += tx; pos.z += tz; tgt.z += tz;
    }
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 2.2);
    const sh = this.trauma * this.trauma * 0.012;
    pos.x += (Math.sin(t * 97) + Math.sin(t * 61.7)) * sh;
    pos.y += (Math.sin(t * 83) + Math.sin(t * 47.3)) * sh * 0.6;
    pos.z += (Math.sin(t * 71) + Math.sin(t * 53.1)) * sh;
    cam.position.copy(pos);
    cam.lookAt(tgt);
    cam.rotateZ((Math.sin(t * 89) * sh * 1.4));
  }

  _perf(dt) {
    this._pf = (this._pf || 0) * 0.95 + dt * 0.05;
    this._pt = (this._pt || 0) + dt;
    if (this._pt < 3 || this.fixedScale) return;
    this._pt = 0;
    const cur = this.dynScale || 1;
    if (this._pf > 1 / 40 && cur > 0.55) {
      this.dynScale = Math.max(0.55, cur - 0.15);
      if (this.dynScale <= 0.7) this.bloom.enabled = this.quality === 'high';
      this._goodT = 0;
      this.resize(this._w, this._h);
    } else if (this._pf < 1 / 54 && cur < 1) {
      // smooth again for a while (a hiccup, a background tab): climb back towards full resolution
      this._goodT = (this._goodT || 0) + 3;
      if (this._goodT >= 9) {
        this._goodT = 0;
        this.dynScale = Math.min(1, cur + 0.15);
        if (this.dynScale > 0.7) this.bloom.enabled = true;
        this.resize(this._w, this._h);
      }
    } else this._goodT = 0;
  }
}
