// Procedural playfield artwork painted on a 2-D canvas (on top of the texture baked in Blender).
// Everything is positioned from the shared layout, so art, physics and 3-D models always agree.

export const LAMP_COLORS = {
  orange: '--lamp-orange', red: '--lamp-red', blue: '--lamp-blue', amber: '--lamp-amber', green: '--lamp-green', white: '--lamp-white',
};

export function cssColor(name, fallback = '#ffffff') {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch { return fallback; }
}

import { paintRotor } from './art/rotorArt.js';
import { paintAlien } from './art/alienArt.js';

export function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function paintPlayfield(layout, baseImage, width = 1024, theme = 'riff', extra = {}) {
  const displayFont = theme === 'rotor' ? "'Black Ops One', Impact, 'Arial Black', sans-serif"
    : theme === 'alien' ? "Orbitron, 'Eurostile', 'Arial Black', sans-serif" : "'Metal Mania', Impact, fantasy";
  const displayWeight = theme === 'alien' ? '900 ' : '';
  const W = layout.table.W, L = layout.table.L;
  const S = width / W;
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = Math.round(L * S);
  const c = cv.getContext('2d');
  const X = (x) => x * S, Y = (y) => (L - y) * S;
  const R = rng(1977);
  const col = {};
  for (const k in LAMP_COLORS) col[k] = cssColor(LAMP_COLORS[k]);
  const ember = cssColor('--c-ember', '#ff5a1f'), hot = cssColor('--c-ember-hot', '#ffb347'), blood = cssColor('--c-blood', '#c01224');
  const volt = cssColor('--c-volt', '#7fd6ff'), chrome = cssColor('--c-chrome', '#ece9f1');

  // ---- base
  if (baseImage) {
    c.drawImage(baseImage, 0, 0, cv.width, cv.height);
    c.fillStyle = theme === 'rotor' ? 'rgba(3,5,2,0.3)' : theme === 'alien' ? 'rgba(3,2,8,0.3)' : 'rgba(4,3,6,0.5)';
    c.fillRect(0, 0, cv.width, cv.height);
  } else {
    const g = c.createLinearGradient(0, 0, 0, cv.height);
    g.addColorStop(0, '#16090c'); g.addColorStop(0.5, '#0b080d'); g.addColorStop(1, '#14080a');
    c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 2600; i++) {
      c.fillStyle = `rgba(255,${120 + R() * 80 | 0},60,${R() * 0.05})`;
      c.fillRect(R() * cv.width, R() * cv.height, 1 + R() * 2, 1 + R() * 2);
    }
  }

  const glow = (x, y, r, color, a = 0.5) => {
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = a; c.fillStyle = g;
    c.fillRect(X(x - r), Y(y + r), 2 * r * S, 2 * r * S);
    c.globalAlpha = 1;
  };

  // ---- labels
  const label = (txt, x, y, size, color, rot = 0, font = 'display', alpha = 0.92) => {
    c.save(); c.translate(X(x), Y(y)); c.rotate((rot * Math.PI) / 180);
    c.font = font === 'display' ? `${displayWeight}${size * S}px ${displayFont}` : `700 ${size * S}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = color; c.shadowBlur = size * 0.5 * S; c.globalAlpha = alpha;
    c.fillStyle = color; c.fillText(txt, 0, 0);
    c.shadowBlur = 0; c.lineWidth = Math.max(1, size * 0.04 * S); c.strokeStyle = 'rgba(0,0,0,0.65)'; c.strokeText(txt, 0, 0);
    c.restore();
  };
  if (theme === 'rotor') {
    paintRotor({ c, X, Y, S, R, W, L, col, glow, label, cv, extra }, layout);
  } else if (theme === 'alien') {
    paintAlien({ c, X, Y, S, R, W, L, col, glow, label, cv, extra }, layout);
  } else {
    // ---- heat pools
    c.globalCompositeOperation = 'lighter';
    glow(260, 830, 190, blood, 0.5);
    glow(240, 640, 170, ember, 0.32);
    glow(240, 150, 230, blood, 0.42);
    glow(51, 640, 110, volt, 0.14);
    glow(429, 640, 110, volt, 0.14);

    // ---- sunburst behind the skull
    c.save();
    c.translate(X(layout.skull.x), Y(layout.skull.y));
    for (let i = 0; i < 28; i++) {
      const a0 = (i / 28) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / 56;
      const len = (200 + (i % 2) * 70) * S;
      const g = c.createRadialGradient(0, 0, 40 * S, 0, 0, len);
      g.addColorStop(0, i % 2 ? 'rgba(255,90,31,0.34)' : 'rgba(192,18,36,0.3)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a0) * len, Math.sin(a0) * len); c.lineTo(Math.cos(a1) * len, Math.sin(a1) * len); c.closePath(); c.fill();
    }
    c.restore();

    // ---- flames rising from the flipper end
    const flame = (x, base, h, w, hue) => {
      const g = c.createLinearGradient(0, Y(base), 0, Y(base + h));
      g.addColorStop(0, hue === 0 ? 'rgba(255,200,90,0.75)' : 'rgba(255,120,40,0.6)');
      g.addColorStop(0.45, 'rgba(255,70,20,0.42)');
      g.addColorStop(1, 'rgba(160,10,20,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(X(x - w), Y(base));
      c.bezierCurveTo(X(x - w * 1.2), Y(base + h * 0.4), X(x - w * 0.1), Y(base + h * 0.55), X(x + (R() - 0.5) * w), Y(base + h));
      c.bezierCurveTo(X(x + w * 0.2), Y(base + h * 0.6), X(x + w * 1.3), Y(base + h * 0.35), X(x + w), Y(base));
      c.closePath(); c.fill();
    };
    for (let i = 0; i < 46; i++) {
      const x = 10 + R() * 460;
      const centre = 1 - Math.abs(x - 240) / 260;
      flame(x, 40 + R() * 30, 120 + R() * 220 * (0.4 + centre), 14 + R() * 26, i % 3 ? 1 : 0);
    }

    // ---- lightning bolts
    const bolt = (x0, y0, x1, y1, w = 3, branch = 2, seed = 1) => {
      const r = rng(seed);
      const pts = [[x0, y0]];
      const n = 9;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      for (let i = 1; i < n; i++) {
        const t = i / n, off = (r() - 0.5) * len * 0.16;
        pts.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
      }
      pts.push([x1, y1]);
      const stroke = (lw, style, blur) => {
        c.lineWidth = lw * S; c.strokeStyle = style; c.shadowColor = volt; c.shadowBlur = blur * S; c.lineJoin = 'miter'; c.lineCap = 'round';
        c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])))); c.stroke();
      };
      stroke(w * 2.6, 'rgba(80,170,255,0.28)', 14);
      stroke(w, 'rgba(190,235,255,0.75)', 8);
      stroke(w * 0.35, 'rgba(255,255,255,0.95)', 0);
      c.shadowBlur = 0;
      if (branch > 0) {
        const k = 2 + Math.floor(r() * (n - 4));
        const p = pts[k];
        bolt(p[0], p[1], p[0] + (r() - 0.5) * len * 0.7, p[1] + (y1 - y0) * 0.35, w * 0.6, branch - 1, seed * 7 + 3);
      }
    };
    bolt(200, 610, 110, 380, 3.2, 2, 11);
    bolt(280, 610, 372, 380, 3.2, 2, 23);
    bolt(150, 905, 96, 720, 2.4, 1, 31);
    bolt(372, 905, 392, 700, 2.4, 1, 47);
    bolt(240, 440, 240, 300, 1.6, 0, 5);
    c.globalCompositeOperation = 'source-over';

    // ---- ace-of-spades card motifs (generic playing-card symbols)
    const spade = (x, y, size, rot, alpha = 0.85) => {
      c.save(); c.translate(X(x), Y(y)); c.rotate((rot * Math.PI) / 180); c.scale(size * S, size * S);
      c.beginPath();
      c.moveTo(0, -1);
      c.bezierCurveTo(0.25, -0.55, 0.95, -0.2, 0.95, 0.3);
      c.bezierCurveTo(0.95, 0.75, 0.35, 0.85, 0.08, 0.5);
      c.lineTo(0.28, 1); c.lineTo(-0.28, 1); c.lineTo(-0.08, 0.5);
      c.bezierCurveTo(-0.35, 0.85, -0.95, 0.75, -0.95, 0.3);
      c.bezierCurveTo(-0.95, -0.2, -0.25, -0.55, 0, -1);
      c.closePath();
      c.globalAlpha = alpha * 0.55; c.fillStyle = '#050406'; c.fill();
      c.globalAlpha = alpha; c.lineWidth = 0.07; c.strokeStyle = chrome; c.shadowColor = ember; c.shadowBlur = 0.5 * size * S; c.stroke();
      c.restore();
    };
    spade(118, 432, 26, -14);
    spade(374, 410, 20, 14);
    spade(240, 118, 16, 0, 0.6);
    for (const [x, y, r] of [[30, 900, 9], [498, 960, 9], [150, 1010, 8], [400, 1012, 8]]) spade(x, y, r, 0, 0.5);

    // ---- lane chevrons
    const chevrons = (x, y0, y1, color, step = 26, w = 12, rot = 0) => {
      c.strokeStyle = color; c.lineWidth = 3 * S; c.lineCap = 'butt'; c.lineJoin = 'miter'; c.globalAlpha = 0.55;
      for (let y = y0; y < y1; y += step) {
        c.save(); c.translate(X(x), Y(y)); c.rotate((rot * Math.PI) / 180);
        c.beginPath(); c.moveTo(-w * S, 6 * S); c.lineTo(0, -6 * S); c.lineTo(w * S, 6 * S); c.stroke();
        c.restore();
      }
      c.globalAlpha = 1;
    };
    chevrons(51, 500, 800, volt);
    chevrons(429, 500, 800, volt);
    chevrons(500, 130, 760, hot, 34, 10);
    chevrons(59, 240, 330, volt, 22, 9, 180);
    chevrons(421, 240, 330, volt, 22, 9, 180);

    // ---- drum target rings under the bumpers
    for (const b of layout.bumpers) {
      for (const [r, a] of [[44, 0.7], [52, 0.35], [60, 0.18]]) {
        c.strokeStyle = hot; c.globalAlpha = a; c.lineWidth = 2.2 * S;
        c.beginPath(); c.arc(X(b.x), Y(b.y), r * S, 0, Math.PI * 2); c.stroke();
      }
      c.globalAlpha = 1;
    }

    if (layout.discs) label('RIFFGEWITTER', 322, 372, 21, hot, 0); // the setlist owns the left side
    else { label('RIFF', 163, 372, 36, hot, 0); label('GEWITTER', 327, 372, 30, hot, 0); }
    label('LOCK', 240, 520, 13, col.red, 0, 'ui');
    label('JACKPOT', 318, 448, 15, col.orange, -72, 'ui');
    label('ORBIT', 82, 440, 12, volt, -84, 'ui');
    label('ORBIT', 398, 440, 12, volt, 84, 'ui');
    label('A   M   P', 275, 1006, 15, volt, 0, 'ui');
    label('VOL', 262, 302, 9, chrome, 0, 'ui', 0.7);
    label('11', 262, 437, 13, col.red, 0, 'ui');
    label('DRUMS', 260, 905, 13, hot, 0, 'ui', 0.75);
    label('ENCORE', 240, 484, 7.5, chrome, 0, 'ui', 0.8);
    // ---- denser table: setlist, backstage, turntable, mic
    if (layout.discs) {
      const de = (extra && extra.lang) !== 'en';
      const songs = de ? ['DONNERKEIL', 'STAHLHERZ', 'NACHTEXPRESS', 'FEUERPROBE', 'VINYLWUT'] : ['THUNDERBOLT', 'HEART OF STEEL', 'NIGHT EXPRESS', 'TRIAL BY FIRE', 'VINYL RAGE'];
      const songLamps = layout.lights.filter((l) => /^song\d$/.test(l.id));
      if (songLamps.length) {
        const top = songLamps[0];
        label('SETLIST', top.x + 30, top.y + 22, 12, hot, 0, 'display', 0.9);
        songLamps.forEach((l, i) => {
          c.save(); c.font = `700 ${8.5 * S}px 'Barlow Condensed', 'Arial Narrow', sans-serif`;
          c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = chrome; c.globalAlpha = 0.85;
          c.fillText(`${i + 1}  ${songs[i]}`, X(l.x + 12), Y(l.y)); c.restore();
        });
      }
      const d = layout.discs[0];
      for (const [r, a] of [[d.r + 6, 0.55], [d.r + 11, 0.3]]) {
        c.strokeStyle = volt; c.globalAlpha = a; c.lineWidth = 1.6 * S;
        c.beginPath(); c.arc(X(d.x), Y(d.y), r * S, 0, Math.PI * 2); c.stroke();
      }
      c.globalAlpha = 1;
      label(de ? 'PLATTENTELLER' : 'TURNTABLE', d.x, d.y - d.r - 18, 9, volt, 0, 'ui', 0.85);
      if (layout.backstage) label('BACKSTAGE', layout.backstage.x - 6, layout.backstage.y - 74, 10, col.red, 0, 'ui', 0.9);
      if (layout.bashes) for (const m of layout.bashes) label(de ? 'MIKRO' : 'MIC', m.x + 20, m.y - 10, 8, chrome, 0, 'ui', 0.8);
    }
  }

  // ---- insert bases
  for (const l of layout.lights) {
    const color = col[l.color] || col.orange;
    c.save(); c.translate(X(l.x), Y(l.y));
    c.rotate((-(l.rot || 0) * Math.PI) / 180);
    const r = l.r * S;
    c.beginPath();
    if (l.shape === 'arrow') { c.moveTo(0, -r * 1.25); c.lineTo(r, r * 0.8); c.lineTo(0, r * 0.35); c.lineTo(-r, r * 0.8); c.closePath(); }
    else if (l.shape === 'bar') { c.rect(-r * 2.1, -r * 0.62, r * 4.2, r * 1.24); }
    else c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = 'rgba(8,6,10,0.9)'; c.fill();
    c.globalAlpha = 0.22; c.fillStyle = color; c.fill();
    c.globalAlpha = 0.9; c.lineWidth = 1.3 * S; c.strokeStyle = color; c.stroke();
    c.restore();
    if (l.label && l.labelSide === 'in') label(l.label, l.x, l.y + 0.5, l.r * 1.25, '#1a1608', 0, 'display', 0.95);
    else if (l.label) label(l.label, l.x, l.y - l.r - 8, 9, color, 0, 'ui', 0.85);
  }

  // ---- wear: fine scratches and a vignette
  c.globalAlpha = 0.06; c.strokeStyle = '#ffffff'; c.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    const x = R() * cv.width, y = R() * cv.height, a = R() * Math.PI, l2 = 10 + R() * 60;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l2, y + Math.sin(a) * l2); c.stroke();
  }
  c.globalAlpha = 1;
  const vg = c.createRadialGradient(cv.width / 2, cv.height / 2, cv.height * 0.25, cv.width / 2, cv.height / 2, cv.height * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = vg; c.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

/** Small white-on-transparent sprite used for the additive insert glow. */
export function shapeSprite(shape, size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const h = size / 2;
  c.translate(h, h);
  c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = size * 0.16;
  const r = size * 0.27;
  c.beginPath();
  if (shape === 'arrow') { c.moveTo(0, -r * 1.25); c.lineTo(r, r * 0.8); c.lineTo(0, r * 0.35); c.lineTo(-r, r * 0.8); c.closePath(); }
  else if (shape === 'bar') { c.rect(-r * 1.5, -r * 0.45, r * 3, r * 0.9); }
  else if (shape === 'soft') {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.shadowBlur = 0; c.fillStyle = g; c.rect(-h, -h, size, size);
  } else c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill(); c.fill();
  return cv;
}
