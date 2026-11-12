// Playfield artwork for ERDABWEHR (Earth Defense), painted over the hull-plating texture baked in
// Blender. Positions come from the table layout (src/layout-alien.js), so art, lamps and toys agree.
// Composition, bottom to top: a night city seen from above under attack (glowing street grid,
// burning blocks, craters, a river), human laser cannons and tanks firing cyan beams; the crop-circle
// glyph ring and the tractor beam's green light pool around the beam pad; violet alien hex plating
// with circuit traces in the upper third; saucers firing green rays; radar ring under the saucer
// bumpers; lane guides, hazard stripes, the shield arc and all lettering (German or English).

import { cssColor, rng } from '../playfieldArt.js';

const TXT = {
  de: {
    title: 'ERDABWEHR', subtitle: 'VERTEIDIGT DIE ERDE',
    beam: 'STRAHLENFELD', ship: 'MUTTERSCHIFF', tank: 'PANZER', ramp: 'LASERRAMPE', cross: 'KREUZRAMPE', battery: 'LASERBATTERIE',
    robot: 'ROBOTER', waves: 'WELLEN', waveNames: ['UNTERTASSEN', 'ROBO-STURM', 'SPERRFEUER', 'ABFANGJÄGER', 'BODENTRUPPEN'],
    energy: 'ENERGIE', overload: 'ÜBERLADUNG', bonus: 'BONUS', multiplier: 'MULTIPLIKATOR', again: 'NOCHMAL',
    shield: 'SCHILD', extra: 'EXTRAKUGEL', jackpot: 'JACKPOT', superJ: 'SUPER', lock: 'ENTFÜHRUNG', launch: 'START',
    targets: 'ALIEN-ZIELE', sector: 'SEKTOR', armor: 'PANZERUNG',
  },
  en: {
    title: 'ERDABWEHR', subtitle: 'DEFEND THE EARTH',
    beam: 'BEAM PAD', ship: 'MOTHERSHIP', tank: 'TANK', ramp: 'LASER RAMP', cross: 'CROSS RAMP', battery: 'LASER BATTERY',
    robot: 'ROBOT', waves: 'WAVES', waveNames: ['SAUCERS', 'ROBOT ASSAULT', 'BARRAGE', 'INTERCEPTORS', 'GROUND TROOPS'],
    energy: 'ENERGY', overload: 'OVERLOAD', bonus: 'BONUS', multiplier: 'MULTIPLIER', again: 'SHOOT AGAIN',
    shield: 'SHIELD', extra: 'EXTRA BALL', jackpot: 'JACKPOT', superJ: 'SUPER', lock: 'ABDUCTION', launch: 'LAUNCH',
    targets: 'ALIEN TARGETS', sector: 'SECTOR', armor: 'ARMOUR',
  },
};

const DEG = Math.PI / 180;

/** '#rrggbb' (or 'rgb(...)') + alpha -> css colour string */
function rgba(color, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function paintAlien(hp, layout) {
  const { c, X, Y, S, W, L, glow, cv } = hp;
  const extra = hp.extra || {};
  const T = TXT[extra.lang] || TXT.de;
  const R = rng(1953);
  const acid = cssColor('--alien-acid', '#7dff3a');
  const violet = cssColor('--alien-violet', '#a64dff');
  const cyan = cssColor('--alien-cyan', '#38e8ff');
  const red = cssColor('--lamp-red', '#ff2d55');
  const amber = cssColor('--lamp-amber', '#ffd21a');
  const chrome = cssColor('--c-chrome', '#e6e9ff');
  const fire = '#ff7a1f';
  const A = layout.alien || { ship: { x: 260, y: 985 }, beamPad: { x: 240, y: 690 }, robot: { x: 330, y: 724, legs: 24 }, tank: { x: 116, y: 904 } };
  const pad = A.beamPad;
  const lamp = Object.fromEntries(layout.lights.map((l) => [l.id, l]));
  const UI = "'Barlow Condensed', 'Arial Narrow', sans-serif";
  const DISPLAY = "Orbitron, 'Eurostile', 'Arial Black', sans-serif";

  // ------------------------------------------------------------------ helpers
  const layer = () => {
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    return o.getContext('2d');
  };
  const path = (g, pts, close = true) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
    if (close) g.closePath();
  };
  const ring = (g, x, y, r, color, lw, alpha = 1, a0 = 0, a1 = 360, dash = null) => {
    g.save(); g.globalAlpha = alpha; g.strokeStyle = color; g.lineWidth = lw * S;
    if (dash) g.setLineDash(dash.map((d) => d * S));
    g.beginPath(); g.arc(X(x), Y(y), r * S, -a1 * DEG, -a0 * DEG); g.stroke();
    g.restore();
  };
  const softGlow = (g, x, y, r, color, a) => {
    const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(X(x - r), Y(y + r), 2 * r * S, 2 * r * S);
  };
  // fade a layer with a vertical alpha ramp: stops = [[y, alpha], ...] in table mm
  const fadeY = (g, stops) => {
    g.save(); g.globalCompositeOperation = 'destination-in';
    const gr = g.createLinearGradient(0, Y(L), 0, Y(0));
    for (const [y, a] of stops) gr.addColorStop(Math.min(1, Math.max(0, 1 - y / L)), `rgba(0,0,0,${a})`);
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    g.restore();
  };
  const punch = (g, x, y, r0, r1) => {
    g.save(); g.globalCompositeOperation = 'destination-out';
    const gr = g.createRadialGradient(X(x), Y(y), r0 * S, X(x), Y(y), r1 * S);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(X(x - r1), Y(y + r1), 2 * r1 * S, 2 * r1 * S);
    g.restore();
  };

  // text with a dark outline, a coloured glow and an optional backing plate; fits into maxW (mm)
  const txt = (s, x, y, size, color, o = {}) => {
    const font = o.font === 'display' ? `900 ${size * S}px ${DISPLAY}` : `${o.weight || 700} ${size * S}px ${UI}`;
    c.save();
    c.translate(X(x), Y(y)); c.rotate(((o.rot || 0) * Math.PI) / 180);
    c.font = font;
    if ('letterSpacing' in c) c.letterSpacing = `${(o.spacing || 0) * size * S}px`;
    c.textAlign = o.align || 'center'; c.textBaseline = 'middle';
    const w = c.measureText(s).width;
    const k = o.maxW && w > o.maxW * S ? (o.maxW * S) / w : 1;
    c.scale(k, 1);
    if (o.plate) {
      const pw = w + size * 1.0 * S, ph = size * 1.55 * S, cut = ph * 0.32;
      const x0 = o.align === 'left' ? -size * 0.5 * S : o.align === 'right' ? -w - size * 0.5 * S : -pw / 2;
      c.beginPath();
      c.moveTo(x0 + cut, -ph / 2); c.lineTo(x0 + pw, -ph / 2); c.lineTo(x0 + pw, ph / 2 - cut);
      c.lineTo(x0 + pw - cut, ph / 2); c.lineTo(x0, ph / 2); c.lineTo(x0, -ph / 2 + cut); c.closePath();
      c.fillStyle = 'rgba(5,3,14,0.84)'; c.fill();
      c.lineWidth = 0.7 * S / k; c.strokeStyle = rgba(o.plate === true ? color : o.plate, 0.75); c.stroke();
    }
    c.globalAlpha = o.alpha ?? 0.96;
    c.lineJoin = 'round';
    c.lineWidth = Math.max(1.5, size * 0.2 * S); c.strokeStyle = 'rgba(2,1,8,0.85)'; c.strokeText(s, 0, 0);
    c.shadowColor = color; c.shadowBlur = size * (o.glow ?? 0.6) * S;
    c.fillStyle = o.fill || color; c.fillText(s, 0, 0);
    c.shadowBlur = 0; c.fillText(s, 0, 0);
    c.restore();
  };
  // text along an arc around (cx, cy); angle in table degrees (0 = right, 90 = up-table).
  // outward: letters' tops point away from the centre (text runs clockwise on screen)
  const arcTxt = (s, cx, cy, r, angle, size, color, o = {}) => {
    const outward = o.outward ?? true;
    c.save();
    c.font = o.font === 'display' ? `900 ${size * S}px ${DISPLAY}` : `700 ${size * S}px ${UI}`;
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const sp = (o.spacing ?? 0.12) * size * S;
    const widths = [...s].map((ch) => c.measureText(ch).width + sp);
    const total = widths.reduce((a, b) => a + b, 0) - sp;
    const rr = r * S;
    let th = -angle * DEG + (outward ? -1 : 1) * (total / rr / 2); // canvas angle of the first glyph edge
    [...s].forEach((ch, i) => {
      const half = (widths[i] - sp) / 2 / rr;
      th += (outward ? 1 : -1) * half;
      c.save();
      c.translate(X(cx) + Math.cos(th) * rr, Y(cy) + Math.sin(th) * rr);
      c.rotate(th + (outward ? Math.PI / 2 : -Math.PI / 2));
      c.lineWidth = Math.max(1.5, size * 0.2 * S); c.strokeStyle = 'rgba(2,1,8,0.85)'; c.lineJoin = 'round'; c.strokeText(ch, 0, 0);
      c.shadowColor = color; c.shadowBlur = size * 0.6 * S; c.fillStyle = color; c.globalAlpha = o.alpha ?? 0.95;
      c.fillText(ch, 0, 0); c.shadowBlur = 0; c.fillText(ch, 0, 0);
      c.restore();
      th += (outward ? 1 : -1) * (half + sp / rr);
    });
    c.restore();
  };
  const chevrons = (x, y, n, step, dirDeg, color, w = 9, alpha = 0.6, g = c) => {
    // n chevrons starting at (x, y) going along dirDeg (table degrees), pointing that way
    const dx = Math.cos(dirDeg * DEG), dy = Math.sin(dirDeg * DEG);
    g.save(); g.strokeStyle = color; g.lineWidth = 2.6 * S; g.lineJoin = 'miter'; g.lineCap = 'butt';
    g.shadowColor = color; g.shadowBlur = 4 * S;
    for (let i = 0; i < n; i++) {
      const px = x + dx * step * i, py = y + dy * step * i;
      g.globalAlpha = alpha * (0.45 + 0.55 * ((i + 1) / n));
      g.save(); g.translate(X(px), Y(py)); g.rotate(-(dirDeg - 90) * DEG);
      g.beginPath(); g.moveTo(-w * S, 5 * S); g.lineTo(0, -4 * S); g.lineTo(w * S, 5 * S); g.stroke();
      g.restore();
    }
    g.restore();
  };
  const hazard = (pts, color, stripe = 6) => {
    c.save(); path(c, pts); c.clip();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40, y0 = Math.min(...ys), y1 = Math.max(...ys);
    c.fillStyle = 'rgba(8,6,4,0.9)'; c.fillRect(X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S);
    c.fillStyle = rgba(color, 0.85);
    for (let x = x0; x < x1; x += stripe * 2) path(c, [[x, y0], [x + stripe, y0], [x + stripe + (y1 - y0), y1], [x + (y1 - y0), y1]]), c.fill();
    c.restore();
    c.save(); c.strokeStyle = rgba(color, 0.9); c.lineWidth = 0.8 * S; path(c, pts); c.stroke(); c.restore();
  };

  // ================================================================== 1. atmosphere
  {
    const g = c.createLinearGradient(0, Y(L), 0, Y(0));
    g.addColorStop(0, 'rgba(46,10,78,0.42)');
    g.addColorStop(0.42, 'rgba(14,6,34,0.25)');
    g.addColorStop(0.62, 'rgba(4,10,26,0.3)');
    g.addColorStop(1, 'rgba(2,14,26,0.45)');
    c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
    c.save(); c.globalCompositeOperation = 'lighter';
    softGlow(c, 250, 960, 260, violet, 0.22);
    softGlow(c, 90, 760, 120, violet, 0.12);
    softGlow(c, 420, 820, 120, violet, 0.12);
    softGlow(c, 240, 300, 260, cyan, 0.08);
    c.restore();
  }

  // ================================================================== 2. the city under attack (lower half)
  const fires = [];
  {
    const g = layer();
    // night ground
    g.fillStyle = 'rgba(3,9,20,0.75)'; g.fillRect(0, 0, cv.width, cv.height);
    // rotated street grid
    const ox = 240, oy = 300, rot = -9;
    g.save(); g.translate(X(ox), Y(oy)); g.rotate(-rot * DEG);
    const bw = 34, bh = 30; // block pitch (mm)
    const avenueEvery = 3;
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const u0 = i * bw, v0 = j * bh;
        const swL = i % avenueEvery === 0 ? 4.5 : 2.2, swB = j % avenueEvery === 0 ? 4.5 : 2.2;
        const x = u0 + swL, y = v0 + swB, w = bw - swL - 2.2, h = bh - swB - 2.2;
        const r = R();
        const rx = x * S, ry = -(y + h) * S, rw = w * S, rh = h * S;
        if (r < 0.07) { // park
          g.fillStyle = 'rgba(10,40,26,0.75)'; g.fillRect(rx, ry, rw, rh);
          g.fillStyle = 'rgba(60,140,80,0.35)';
          for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(rx + R() * rw, ry + R() * rh, (1 + R() * 1.6) * S, 0, Math.PI * 2); g.fill(); }
          continue;
        }
        g.fillStyle = `rgba(${12 + R() * 8 | 0},${20 + R() * 10 | 0},${38 + R() * 14 | 0},0.92)`;
        g.fillRect(rx, ry, rw, rh);
        // buildings
        const nb = 1 + (R() * 4 | 0);
        for (let k = 0; k < nb; k++) {
          const bx = rx + (0.06 + R() * 0.5) * rw, by = ry + (0.06 + R() * 0.5) * rh;
          const bww = (0.25 + R() * 0.45) * rw, bhh = (0.25 + R() * 0.45) * rh;
          const cw = Math.min(bww, rx + rw * 0.95 - bx), ch = Math.min(bhh, ry + rh * 0.95 - by);
          g.fillStyle = `rgba(${26 + R() * 18 | 0},${40 + R() * 22 | 0},${70 + R() * 30 | 0},0.8)`;
          g.fillRect(bx, by, cw, ch);
          g.fillStyle = 'rgba(120,220,255,0.22)'; g.fillRect(bx, by, cw, 0.5 * S); g.fillRect(bx, by, 0.5 * S, ch);
          if (R() < 0.35) { g.fillStyle = 'rgba(180,240,255,0.35)'; g.fillRect(bx + cw * 0.3, by + ch * 0.3, 1.4 * S, 1.4 * S); }
        }
        g.strokeStyle = 'rgba(56,232,255,0.16)'; g.lineWidth = 0.5 * S; g.strokeRect(rx, ry, rw, rh);
        if (r > 0.94) {
          // burning block: remember its table position for the fire pass
          const cx = x + w / 2, cy = y + h / 2;
          const a = rot * DEG;
          fires.push([ox + cx * Math.cos(a) - cy * Math.sin(a), oy + cx * Math.sin(a) + cy * Math.cos(a), Math.max(w, h) * 0.6]);
          g.fillStyle = 'rgba(40,14,6,0.85)'; g.fillRect(rx, ry, rw, rh);
        }
      }
    }
    // avenues: glowing lines with street lights
    g.strokeStyle = 'rgba(56,232,255,0.42)'; g.shadowColor = cyan; g.shadowBlur = 5 * S; g.lineWidth = 0.9 * S;
    for (let i = -10; i <= 10; i += avenueEvery) {
      g.beginPath(); g.moveTo(i * bw * S + 2.2 * S, 12 * bh * S); g.lineTo(i * bw * S + 2.2 * S, -12 * bh * S); g.stroke();
      g.beginPath(); g.moveTo(-12 * bw * S, -(i * bh) * S - 2.2 * S); g.lineTo(12 * bw * S, -(i * bh) * S - 2.2 * S); g.stroke();
    }
    g.shadowBlur = 0;
    for (let k = 0; k < 900; k++) {
      const horiz = R() < 0.5, line = (Math.round((R() - 0.5) * 7) * avenueEvery);
      const t = (R() - 0.5) * 12;
      const px = horiz ? t * bw : line * bw + 2.2 + (R() < 0.5 ? -1.2 : 1.2);
      const py = horiz ? line * bh + 2.2 + (R() < 0.5 ? -1.2 : 1.2) : t * bh;
      g.fillStyle = R() < 0.7 ? 'rgba(255,236,190,0.75)' : 'rgba(255,60,80,0.7)';
      g.fillRect(px * S, -py * S, 0.7 * S, 0.7 * S);
    }
    g.restore();

    // river with bridges
    const river = [[-30, 452], [60, 420], [150, 352], [262, 352], [372, 300], [560, 262]];
    const riverPath = (off) => {
      g.beginPath(); g.moveTo(X(river[0][0]), Y(river[0][1] + off));
      for (let i = 1; i < river.length - 1; i++) {
        const [x1, y1] = river[i], [x2, y2] = river[i + 1];
        g.quadraticCurveTo(X(x1), Y(y1 + off), X((x1 + x2) / 2), Y((y1 + y2) / 2 + off));
      }
      g.lineTo(X(river.at(-1)[0]), Y(river.at(-1)[1] + off));
    };
    g.save();
    g.lineCap = 'round';
    riverPath(0); g.strokeStyle = 'rgba(1,6,16,1)'; g.lineWidth = 26 * S; g.stroke();
    riverPath(0); g.strokeStyle = 'rgba(20,70,110,0.25)'; g.lineWidth = 16 * S; g.stroke();
    for (const off of [-13.5, 13.5]) { riverPath(off); g.strokeStyle = 'rgba(56,232,255,0.5)'; g.lineWidth = 0.9 * S; g.shadowColor = cyan; g.shadowBlur = 6 * S; g.stroke(); }
    g.restore();

    // craters with ejecta and glowing rims
    const crater = (x, y, r) => {
      g.save();
      for (let k = 0; k < 22; k++) {
        const a = R() * Math.PI * 2, l = r * (1.3 + R() * 0.9);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = (0.8 + R() * 2.2) * S;
        g.beginPath(); g.moveTo(X(x + Math.cos(a) * r * 0.7), Y(y + Math.sin(a) * r * 0.7)); g.lineTo(X(x + Math.cos(a) * l), Y(y + Math.sin(a) * l)); g.stroke();
      }
      const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * 1.15 * S);
      gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(0.55, 'rgba(14,6,4,0.92)');
      gr.addColorStop(0.78, 'rgba(255,110,30,0.55)'); gr.addColorStop(0.86, 'rgba(60,20,8,0.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(X(x), Y(y), r * 1.15 * S, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 14; k++) {
        const a = R() * Math.PI * 2, d = r * (0.7 + R() * 0.3);
        g.fillStyle = rgba(R() < 0.5 ? fire : '#ffd28a', 0.5 + R() * 0.4);
        g.beginPath(); g.arc(X(x + Math.cos(a) * d), Y(y + Math.sin(a) * d), (0.5 + R()) * S, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    };
    crater(372, 428, 13);
    crater(312, 318, 9);
    crater(160, 300, 8);
    crater(400, 236, 10);

    // fire glow over burning blocks
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const [x, y, r] of fires) {
      if (y > 520 || y < 60) continue;
      softGlow(g, x, y, r * 1.25, fire, 0.32);
      for (let k = 0; k < 9; k++) {
        const fx = x + (R() - 0.5) * r * 1.1, fy = y + (R() - 0.5) * r * 0.9, fr = 1.5 + R() * 3.5;
        softGlow(g, fx, fy, fr * 1.8, fire, 0.55);
        softGlow(g, fx, fy, fr * 0.7, '#fff0b0', 0.7);
      }
    }
    g.restore();

    // CRT scan lines over the city
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < L; y += 2.4) g.fillRect(0, Y(y), cv.width, Math.max(1, 0.7 * S));

    fadeY(g, [[0, 0.55], [90, 1], [430, 1], [520, 0.55], [600, 0]]);
    c.drawImage(g.canvas, 0, 0);
  }

  // ================================================================== 3. alien hex plating (upper third)
  {
    const g = layer();
    const hr = 9.5; // hex circumradius (flat top)
    const dx = hr * 1.5, dy = hr * Math.sqrt(3);
    const hex = (x, y, r) => {
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = k * 60 * DEG; const px = X(x + Math.cos(a) * r), py = Y(y + Math.sin(a) * r); if (k) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath();
    };
    for (let i = -1; i * dx < W + hr; i++) {
      for (let j = -1; j * dy < L + dy; j++) {
        const x = i * dx, y = j * dy + (i % 2 ? dy / 2 : 0);
        if (y < 520) continue;
        const r = R();
        hex(x, y, hr - 0.8);
        g.fillStyle = r < 0.05 ? rgba(violet, 0.4) : r < 0.07 ? rgba(acid, 0.22) : `rgba(${24 + R() * 20 | 0},${8 + R() * 10 | 0},${44 + R() * 30 | 0},${0.35 + R() * 0.3})`;
        g.fill();
        g.strokeStyle = r < 0.07 ? rgba(r < 0.05 ? violet : acid, 0.85) : rgba(violet, 0.3); g.lineWidth = (r < 0.07 ? 0.9 : 0.6) * S; g.stroke();
        if (r < 0.05) { hex(x, y, hr * 0.45); g.strokeStyle = rgba(violet, 0.6); g.stroke(); }
      }
    }
    // circuit traces (0/45/90 degree walks) with solder pads
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 26; k++) {
      let x = 20 + R() * 440, y = 640 + R() * 420;
      const col = R() < 0.25 ? acid : R() < 0.5 ? cyan : violet;
      const pts = [[x, y]];
      let dir = (R() * 4 | 0) * 90;
      for (let s = 0; s < 3 + (R() * 2 | 0); s++) {
        const len = s % 2 ? 6 + R() * 8 : 18 + R() * 30;
        x += Math.cos(dir * DEG) * len; y += Math.sin(dir * DEG) * len;
        pts.push([x, y]);
        dir += (s % 2 ? -1 : 1) * (R() < 0.5 ? -45 : 45);
      }
      g.strokeStyle = rgba(col, 0.55); g.lineWidth = 0.8 * S; g.shadowColor = col; g.shadowBlur = 4 * S;
      path(g, pts, false); g.stroke();
      g.shadowBlur = 0;
      for (const p of [pts[0], pts.at(-1)]) {
        g.beginPath(); g.arc(X(p[0]), Y(p[1]), 1.6 * S, 0, Math.PI * 2);
        g.fillStyle = 'rgba(6,2,14,0.9)'; g.fill(); g.strokeStyle = rgba(col, 0.8); g.lineWidth = 0.7 * S; g.stroke();
      }
    }
    fadeY(g, [[520, 0], [640, 0.85], [800, 1], [1080, 1]]);
    punch(g, pad.x, pad.y, 60, 118);
    c.drawImage(g.canvas, 0, 0);
  }

  // ================================================================== 4. lasers, saucers, defenders
  const laser = (x0, y0, x1, y1, color, w = 1.6, alpha = 1, g = c) => {
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    const gr = (a) => {
      const lg = g.createLinearGradient(X(x0), Y(y0), X(x1), Y(y1));
      lg.addColorStop(0, rgba(color, 0)); lg.addColorStop(0.18, rgba(color, a)); lg.addColorStop(1, rgba(color, a));
      return lg;
    };
    for (const [lw, a] of [[w * 5, 0.12], [w * 2.2, 0.35], [w, 0.8]]) {
      g.strokeStyle = gr(a * alpha); g.lineWidth = lw * S;
      g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke();
    }
    const core = g.createLinearGradient(X(x0), Y(y0), X(x1), Y(y1));
    core.addColorStop(0, 'rgba(255,255,255,0)'); core.addColorStop(0.3, `rgba(255,255,255,${0.85 * alpha})`); core.addColorStop(1, `rgba(255,255,255,${0.9 * alpha})`);
    g.strokeStyle = core; g.lineWidth = w * 0.35 * S;
    g.beginPath(); g.moveTo(X(x0), Y(y0)); g.lineTo(X(x1), Y(y1)); g.stroke();
    g.restore();
  };
  const burst = (x, y, r, color, spikes = 12, seed = 1) => {
    const rr = rng(seed);
    c.save(); c.globalCompositeOperation = 'lighter';
    softGlow(c, x, y, r * 1.8, color, 0.45);
    c.beginPath();
    for (let k = 0; k < spikes * 2; k++) {
      const a = (k / (spikes * 2)) * Math.PI * 2 + rr() * 0.15;
      const d = k % 2 ? r * (0.3 + rr() * 0.15) : r * (0.65 + rr() * 0.5);
      const px = X(x + Math.cos(a) * d), py = Y(y + Math.sin(a) * d);
      if (k) c.lineTo(px, py); else c.moveTo(px, py);
    }
    c.closePath();
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    g.addColorStop(0, 'rgba(255,255,240,0.95)'); g.addColorStop(0.35, rgba(color, 0.8)); g.addColorStop(1, rgba(color, 0.05));
    c.fillStyle = g; c.fill();
    c.restore();
  };
  const saucer = (x, y, s, rot = 0, beam = false) => {
    c.save(); c.translate(X(x), Y(y)); c.rotate(-rot * DEG); c.scale(s * S / 10, s * S / 10);
    if (beam) {
      const g = c.createLinearGradient(0, 2, 0, 34);
      g.addColorStop(0, rgba(acid, 0.45)); g.addColorStop(1, rgba(acid, 0));
      c.fillStyle = g; c.beginPath(); c.moveTo(-5, 2); c.lineTo(5, 2); c.lineTo(13, 34); c.lineTo(-13, 34); c.closePath(); c.fill();
    }
    c.shadowColor = acid; c.shadowBlur = 8;
    const body = c.createLinearGradient(0, -4, 0, 4);
    body.addColorStop(0, '#9ba3c4'); body.addColorStop(0.45, '#3b3f5e'); body.addColorStop(1, '#0d0d1c');
    c.fillStyle = body; c.beginPath(); c.ellipse(0, 0, 20, 4.6, 0, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(5,4,12,0.9)'; c.lineWidth = 0.7; c.stroke();
    const dome = c.createRadialGradient(-2, -6, 0.5, 0, -3, 9);
    dome.addColorStop(0, 'rgba(230,255,250,0.95)'); dome.addColorStop(0.4, rgba(cyan, 0.75)); dome.addColorStop(1, 'rgba(10,40,60,0.9)');
    c.fillStyle = dome; c.beginPath(); c.ellipse(0, -2.4, 8.5, 6.2, 0, Math.PI, 0); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(5,4,12,0.9)'; c.stroke();
    for (let k = -3; k <= 3; k++) {
      c.fillStyle = k % 2 ? acid : '#fff4b0'; c.shadowColor = acid; c.shadowBlur = 5;
      c.beginPath(); c.arc(k * 5.2, 0.6 + Math.abs(k) * -0.25, 0.9, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  };
  // a little grey-green alien with a ray gun (seen from the front, standing on the plating)
  const alien = (x, y, h, flip = 1, ray = null) => {
    const k = h / 30;
    c.save(); c.translate(X(x), Y(y)); c.scale(flip * k * S, k * S);
    const skin = c.createLinearGradient(-8, -30, 8, 0);
    skin.addColorStop(0, '#b8d88f'); skin.addColorStop(1, '#4f6e43');
    c.shadowColor = acid; c.shadowBlur = 6;
    c.fillStyle = skin; c.strokeStyle = 'rgba(4,8,2,0.95)'; c.lineWidth = 0.8;
    // legs and body
    c.beginPath(); c.moveTo(-3, 0); c.lineTo(-2.2, -9); c.lineTo(-3.4, -17); c.lineTo(3.4, -17); c.lineTo(2.2, -9); c.lineTo(3, 0); c.lineTo(1, 0); c.lineTo(0, -8); c.lineTo(-1, 0); c.closePath(); c.fill(); c.stroke();
    // arm with ray gun pointing forward
    c.beginPath(); c.moveTo(2.6, -16); c.lineTo(9, -14.5); c.lineTo(9, -13); c.lineTo(2.6, -13.5); c.closePath(); c.fill(); c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = '#2b2f45'; c.fillRect(8.4, -16, 5.2, 2.2); c.fillRect(8.6, -14.2, 1.4, 2.6);
    c.fillStyle = acid; c.beginPath(); c.arc(13.9, -14.9, 0.9, 0, Math.PI * 2); c.fill();
    // head: big inverted drop
    c.fillStyle = skin; c.shadowColor = acid; c.shadowBlur = 6;
    c.beginPath(); c.moveTo(0, -17); c.bezierCurveTo(-4, -18, -7.5, -23, -7, -27); c.bezierCurveTo(-6.5, -31.5, 6.5, -31.5, 7, -27); c.bezierCurveTo(7.5, -23, 4, -18, 0, -17); c.closePath(); c.fill(); c.stroke();
    c.shadowBlur = 0;
    // almond eyes
    c.fillStyle = '#050208';
    for (const s of [-1, 1]) { c.save(); c.translate(s * 3, -25); c.rotate(s * 0.45); c.beginPath(); c.ellipse(0, 0, 2.6, 1.3, 0, 0, Math.PI * 2); c.fill(); c.restore(); }
    c.fillStyle = 'rgba(200,255,220,0.7)';
    for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 3 - 0.8, -25.5, 0.4, 0, Math.PI * 2); c.fill(); }
    c.restore();
    if (ray) laser(x + flip * 14 * k, y + 14.9 * k, ray[0], ray[1], acid, 1.1, 0.9);
  };
  // human tank, top view, turret angle in table degrees
  const tankTop = (x, y, s, hull, turret, color = cyan) => {
    c.save(); c.translate(X(x), Y(y)); c.rotate(-hull * DEG); c.scale(s * S / 10, s * S / 10);
    c.fillStyle = '#10141e'; c.strokeStyle = rgba(color, 0.9); c.lineWidth = 0.6; c.shadowColor = color; c.shadowBlur = 5;
    c.fillRect(-8, -6, 16, 12); c.strokeRect(-8, -6, 16, 12); c.shadowBlur = 0;
    c.fillStyle = '#1f2635';
    c.fillRect(-9, -7.4, 18, 2.6); c.fillRect(-9, 4.8, 18, 2.6);
    c.strokeStyle = rgba(color, 0.45);
    for (let k = -8; k <= 8; k += 2) { c.beginPath(); c.moveTo(k, -7.4); c.lineTo(k, -4.8); c.moveTo(k, 4.8); c.lineTo(k, 7.4); c.stroke(); }
    c.rotate(-(turret - hull) * DEG);
    c.fillStyle = '#2a3346'; c.strokeStyle = rgba(color, 0.9);
    c.beginPath(); c.arc(0, 0, 4.2, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillRect(3, -0.9, 11, 1.8); c.strokeRect(3, -0.9, 11, 1.8);
    c.restore();
  };
  // laser cannon emplacement, top view
  const cannon = (x, y, s, aim) => {
    c.save(); c.translate(X(x), Y(y)); c.scale(s * S / 10, s * S / 10);
    c.shadowColor = cyan; c.shadowBlur = 6;
    c.fillStyle = '#0e1320'; c.strokeStyle = rgba(cyan, 0.9); c.lineWidth = 0.7;
    c.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; c.lineTo(Math.cos(a) * 8, Math.sin(a) * 8); } c.closePath(); c.fill(); c.stroke();
    c.shadowBlur = 0;
    c.rotate(-aim * DEG);
    c.fillStyle = '#26324a'; c.beginPath(); c.arc(0, 0, 4.6, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillRect(2, -2.2, 12, 1.5); c.fillRect(2, 0.7, 12, 1.5); c.strokeRect(2, -2.2, 12, 1.5); c.strokeRect(2, 0.7, 12, 1.5);
    c.fillStyle = cyan; c.beginPath(); c.arc(0, 0, 1.4, 0, Math.PI * 2); c.fill();
    c.restore();
  };

  // ================================================================== 5. tractor beam, crop circle around the beam pad
  {
    const sx = A.ship.x, sy = A.ship.y - 40;
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(X(sx), Y(sy), X(pad.x), Y(pad.y));
    g.addColorStop(0, rgba(acid, 0.04)); g.addColorStop(0.7, rgba(acid, 0.12)); g.addColorStop(1, rgba(acid, 0.22));
    c.fillStyle = g;
    path(c, [[sx - 16, sy], [sx + 16, sy], [pad.x + 40, pad.y], [pad.x - 40, pad.y]]); c.fill();
    for (let k = 1; k < 7; k++) {
      const t = k / 7, y = sy + (pad.y - sy) * t, x = sx + (pad.x - sx) * t, hw = 16 + 24 * t;
      c.strokeStyle = rgba(acid, 0.05 + 0.12 * t); c.lineWidth = 1.2 * S;
      c.beginPath(); c.ellipse(X(x), Y(y), hw * S, hw * 0.22 * S, 0, 0, Math.PI * 2); c.stroke();
    }
    softGlow(c, pad.x, pad.y, 100, acid, 0.38);
    softGlow(c, pad.x, pad.y, 44, '#d8ffb8', 0.25);
    c.restore();

    c.save();
    const disc = c.createRadialGradient(X(pad.x), Y(pad.y), 20 * S, X(pad.x), Y(pad.y), 64 * S);
    disc.addColorStop(0, 'rgba(4,10,2,0.82)'); disc.addColorStop(0.8, 'rgba(4,10,2,0.6)'); disc.addColorStop(1, 'rgba(4,10,2,0)');
    c.fillStyle = disc; c.beginPath(); c.arc(X(pad.x), Y(pad.y), 64 * S, 0, Math.PI * 2); c.fill();
    c.restore();
    c.save(); c.shadowColor = acid; c.shadowBlur = 8 * S;
    ring(c, pad.x, pad.y, 25, acid, 1.6, 0.9);
    ring(c, pad.x, pad.y, 43, acid, 0.8, 0.7, 196, 344);
    ring(c, pad.x, pad.y, 59, acid, 2, 0.9, 160, 380);
    ring(c, pad.x, pad.y, 86, acid, 1, 0.5, 150, 390, [3, 4]);
    ring(c, pad.x, pad.y, 34, red, 1.1, 0.55, 15, 165);
    c.restore();
    // glyph band (r 45..55) where neither text nor lamps are
    const gr = rng(77);
    c.save(); c.strokeStyle = acid; c.fillStyle = acid; c.shadowColor = acid; c.shadowBlur = 5 * S; c.lineCap = 'round'; c.globalAlpha = 0.85;
    const P = (r, d) => [X(pad.x + Math.cos(d * DEG) * r), Y(pad.y + Math.sin(d * DEG) * r)];
    for (const [a0, a1] of [[222, 258], [282, 318]]) {
      for (let a = a0 + 4; a <= a1 - 3; a += 9) {
        const kind = gr() * 5 | 0;
        c.lineWidth = 1.2 * S;
        if (kind === 0) { c.beginPath(); c.moveTo(...P(45, a)); c.lineTo(...P(55, a)); c.stroke(); }
        else if (kind === 1) { c.beginPath(); c.arc(X(pad.x), Y(pad.y), 53 * S, -(a + 3.5) * DEG, -(a - 3.5) * DEG); c.stroke(); c.beginPath(); c.arc(...P(47, a), 1.2 * S, 0, Math.PI * 2); c.fill(); }
        else if (kind === 2) { c.beginPath(); c.moveTo(...P(55, a - 3.5)); c.lineTo(...P(55, a + 3.5)); c.lineTo(...P(45, a)); c.closePath(); c.stroke(); }
        else if (kind === 3) { for (const r of [46.5, 50.5, 54.5]) { c.beginPath(); c.arc(...P(r, a), 1.1 * S, 0, Math.PI * 2); c.fill(); } }
        else { c.beginPath(); c.arc(X(pad.x), Y(pad.y), 55 * S, -(a + 3.5) * DEG, -(a - 3.5) * DEG); c.stroke(); c.beginPath(); c.moveTo(...P(55, a)); c.lineTo(...P(45, a)); c.stroke(); }
      }
    }
    for (const a of [160, 200, 340, 20]) {
      c.lineWidth = 1 * S; c.globalAlpha = 0.6;
      c.beginPath(); c.moveTo(...P(61, a)); c.lineTo(...P(84, a)); c.stroke();
      c.beginPath(); c.arc(...P(73, a), 2 * S, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  // ================================================================== 6. saucer formation: target rings, formation line, HUD brackets
  if (layout.bumpers && layout.bumpers.length) {
    const bs = [...layout.bumpers].sort((a, b) => a.x - b.x);
    c.save(); c.strokeStyle = rgba(acid, 0.55); c.lineWidth = 1 * S; c.setLineDash([4 * S, 3 * S]); c.shadowColor = acid; c.shadowBlur = 4 * S;
    path(c, bs.map((b) => [b.x, b.y]), false); c.stroke();
    c.restore();
    for (const b of bs) {
      c.save();
      const dg = c.createRadialGradient(X(b.x), Y(b.y), b.r * S, X(b.x), Y(b.y), (b.r + 16) * S);
      dg.addColorStop(0, 'rgba(2,10,14,0.8)'); dg.addColorStop(1, 'rgba(2,10,14,0)');
      c.fillStyle = dg; c.fillRect(X(b.x - b.r - 16), Y(b.y + b.r + 16), (2 * b.r + 32) * S, (2 * b.r + 32) * S);
      if (c.createConicGradient) {
        const cg = c.createConicGradient((-40 - b.x) * DEG, X(b.x), Y(b.y));
        cg.addColorStop(0, rgba(acid, 0)); cg.addColorStop(0.18, rgba(acid, 0.35)); cg.addColorStop(0.181, rgba(acid, 0)); cg.addColorStop(1, rgba(acid, 0));
        c.fillStyle = cg; c.beginPath(); c.arc(X(b.x), Y(b.y), (b.r + 13) * S, 0, Math.PI * 2); c.fill();
      }
      c.shadowColor = cyan; c.shadowBlur = 6 * S;
      ring(c, b.x, b.y, b.r + 5, cyan, 1.4, 0.8);
      ring(c, b.x, b.y, b.r + 12, cyan, 0.7, 0.4, 0, 360, [2, 3]);
      c.strokeStyle = rgba(cyan, 0.85); c.lineWidth = 1.2 * S;
      for (let k = 0; k < 4; k++) {
        const a = (45 + k * 90) * DEG;
        c.beginPath(); c.moveTo(X(b.x + Math.cos(a) * (b.r + 6)), Y(b.y + Math.sin(a) * (b.r + 6))); c.lineTo(X(b.x + Math.cos(a) * (b.r + 14)), Y(b.y + Math.sin(a) * (b.r + 14))); c.stroke();
      }
      c.restore();
    }
    // HUD corner brackets round the formation
    const x0 = bs[0].x - bs[0].r - 18, x1 = bs.at(-1).x + bs.at(-1).r + 18;
    const y1 = Math.max(...bs.map((b) => b.y + b.r)) + 14, y0 = Math.min(...bs.map((b) => b.y - b.r)) + 4;
    c.save(); c.strokeStyle = rgba(acid, 0.8); c.lineWidth = 1.3 * S; c.shadowColor = acid; c.shadowBlur = 5 * S;
    for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      path(c, [[cx + sx * 12, cy], [cx, cy], [cx, cy + sy * 12]], false); c.stroke();
    }
    c.restore();
  }

  // ================================================================== 7. the attack axis: a runway from the flippers to the beam pad
  {
    const yb = 296, yt = pad.y - 26, ax = pad.x;
    const hw = (y) => 58 - 40 * (y - yb) / (yt - yb);
    c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(0, Y(yb), 0, Y(yt));
    g.addColorStop(0, rgba(acid, 0.02)); g.addColorStop(0.6, rgba(acid, 0.07)); g.addColorStop(1, rgba(acid, 0.16));
    c.fillStyle = g;
    path(c, [[ax - hw(yb), yb], [ax + hw(yb), yb], [ax + hw(yt), yt], [ax - hw(yt), yt]]); c.fill();
    c.restore();
    c.save(); c.shadowColor = acid; c.shadowBlur = 6 * S; c.strokeStyle = rgba(acid, 0.75); c.lineWidth = 1.2 * S;
    for (const s of [-1, 1]) { path(c, [[ax + s * hw(yb), yb], [ax + s * hw(yt), yt]], false); c.stroke(); }
    c.setLineDash([5 * S, 6 * S]); c.strokeStyle = rgba(acid, 0.3); c.lineWidth = 0.9 * S;
    path(c, [[ax, yb], [ax, yt]], false); c.stroke(); c.setLineDash([]);
    // runway lights
    let k = 0;
    for (let y = yb + 6; y < yt; y += 16, k++) {
      for (const s of [-1, 1]) {
        c.fillStyle = k % 3 === 0 ? '#ffffff' : acid; c.shadowColor = acid; c.shadowBlur = 5 * S;
        c.beginPath(); c.arc(X(ax + s * (hw(y) + 3.5)), Y(y), 1.3 * S, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
    // threshold bars at the foot of the runway
    c.save(); c.fillStyle = rgba(acid, 0.45);
    for (let x = 16; x < 54; x += 7) for (const s of [-1, 1]) c.fillRect(X(ax + s * x - 2), Y(yb + 12), 4 * S, 10 * S);
    c.restore();
    // chevrons in the gaps between the shots on the axis
    chevrons(ax, 543, 2, 10, 90, acid, 10, 0.95);
    chevrons(ax, 657, 2, 10, 90, acid, 8, 0.95);
  }

  // ================================================================== 8. battle scene
  // human defenders in the city fire cyan lasers up both orbits; saucers circle above
  laser(108, 392, 55, 631, cyan, 1.4, 0.75);
  laser(330, 410, 429, 617, cyan, 1.3, 0.65);
  burst(55, 631, 5, cyan, 9, 3);
  burst(429, 617, 5, cyan, 9, 7);
  cannon(108, 392, 9, 103);
  tankTop(330, 410, 8, 50, 64);
  saucer(100, 676, 12, -8);
  saucer(126, 1002, 10, 12);
  saucer(404, 1010, 11, -14);
  alien(368, 890, 30, -1, null);
  alien(176, 898, 26, 1, null);
  for (const [x, y, r] of [[368, 905, 14], [176, 911, 12]]) {
    c.save(); c.strokeStyle = rgba(cyan, 0.75); c.lineWidth = 0.8 * S; c.shadowColor = cyan; c.shadowBlur = 4 * S;
    c.beginPath(); c.arc(X(x), Y(y), r * S, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 4; k++) { const a = k * 90 * DEG; c.beginPath(); c.moveTo(X(x + Math.cos(a) * (r - 3)), Y(y + Math.sin(a) * (r - 3))); c.lineTo(X(x + Math.cos(a) * (r + 4)), Y(y + Math.sin(a) * (r + 4))); c.stroke(); }
    c.restore();
  }

  // ================================================================== 9. lane guides, hazard stripes, robot ring, shield arc
  chevrons(51, 372, 4, 18, 90, cyan, 8, 0.65);             // left orbit entry
  chevrons(429, 372, 4, 18, 90, cyan, 8, 0.65);            // right orbit entry
  chevrons(51, 790, 2, 16, 90, acid, 8, 0.55);
  chevrons(429, 762, 2, 16, 90, acid, 8, 0.55);
  chevrons(59, 336, 3, 16, -90, cyan, 7, 0.55);            // inlanes: down to the flippers
  chevrons(421, 336, 3, 16, -90, cyan, 7, 0.55);
  for (let y = 120; y < 760; y += 30) { c.save(); c.fillStyle = rgba(cyan, 0.3); c.fillRect(X(498.5), Y(y + 14), 3 * S, 14 * S); c.restore(); }
  chevrons(500, 790, 3, 18, 90, acid, 9, 0.5);
  // ramp mouths: chevrons inside the open U, pointing up the ramp
  for (const r of layout.rails || []) {
    const d = Math.atan2(r.entry.dir[1], r.entry.dir[0]) / DEG;
    const col = r.id === 'cross' ? acid : cyan;
    chevrons(r.path[0][0] + r.entry.dir[0] * 8, r.path[0][1] + r.entry.dir[1] * 8, 3, 13, d, col, 10, 0.85);
  }
  // tank pocket: hazard band across the mouth
  hazard([[76, 834], [148, 834], [148, 843], [76, 843]], amber);
  // robot: hazard ring around its stance
  {
    const Rb = A.robot;
    c.save();
    for (let k = 0; k < 24; k++) {
      c.beginPath(); c.arc(X(Rb.x), Y(Rb.y), 38 * S, (k / 24) * Math.PI * 2, ((k + 0.5) / 24) * Math.PI * 2);
      c.lineWidth = 3.2 * S; c.strokeStyle = k % 2 ? 'rgba(10,6,8,0.9)' : rgba(red, 0.75); c.stroke();
    }
    c.restore();
  }
  // laser battery: charge bar behind the three lamps
  {
    const bat = ['battery0', 'battery1', 'battery2'].map((id) => lamp[id]).filter(Boolean);
    if (bat.length) {
      const x = bat[0].x, y0 = Math.min(...bat.map((b) => b.y)) - 8, y1 = Math.max(...bat.map((b) => b.y)) + 8;
      c.save(); c.shadowColor = cyan; c.shadowBlur = 8 * S;
      const g = c.createLinearGradient(0, Y(y0), 0, Y(y1));
      g.addColorStop(0, rgba(cyan, 0.25)); g.addColorStop(1, rgba(cyan, 0.75));
      c.fillStyle = g; c.fillRect(X(x - 2), Y(y1), 4 * S, (y1 - y0) * S);
      c.restore();
    }
    const sh = ['eleven0', 'eleven1'].map((id) => lamp[id]).filter(Boolean);
    if (sh.length === 2) {
      c.save(); c.strokeStyle = rgba(cyan, 0.7); c.lineWidth = 1 * S; c.shadowColor = cyan; c.shadowBlur = 5 * S;
      for (const s of [-1, 1]) {
        c.beginPath(); c.arc(X(sh[0].x), Y((sh[0].y + sh[1].y) / 2), ((sh[1].y - sh[0].y) / 2 + 9) * S, (s < 0 ? 200 : -20) * DEG, (s < 0 ? 160 : 20) * DEG, s < 0);
        c.stroke();
      }
      c.restore();
    }
  }
  // shield arc between the flippers: a band of hex cells
  {
    const cx = 240, cy = 214, r0 = 58, r1 = 68;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.beginPath(); c.arc(X(cx), Y(cy), r1 * S, -322 * DEG, -218 * DEG); c.arc(X(cx), Y(cy), r0 * S, -218 * DEG, -322 * DEG, true); c.closePath();
    const g = c.createRadialGradient(X(cx), Y(cy), r0 * S, X(cx), Y(cy), r1 * S);
    g.addColorStop(0, rgba(cyan, 0.05)); g.addColorStop(0.5, rgba(cyan, 0.22)); g.addColorStop(1, rgba(cyan, 0.05));
    c.fillStyle = g; c.fill();
    c.restore();
    c.save(); c.strokeStyle = rgba(cyan, 0.8); c.shadowColor = cyan; c.shadowBlur = 7 * S; c.lineWidth = 1.3 * S;
    c.beginPath(); c.arc(X(cx), Y(cy), r1 * S, -322 * DEG, -218 * DEG); c.stroke();
    c.lineWidth = 0.7 * S; c.beginPath(); c.arc(X(cx), Y(cy), r0 * S, -322 * DEG, -218 * DEG); c.stroke();
    c.lineWidth = 0.6 * S; c.globalAlpha = 0.55;
    for (let a = 222; a < 320; a += 7) {
      c.beginPath(); c.moveTo(X(cx + Math.cos(a * DEG) * r0), Y(cy + Math.sin(a * DEG) * r0)); c.lineTo(X(cx + Math.cos((a + 3.5) * DEG) * r1), Y(cy + Math.sin((a + 3.5) * DEG) * r1)); c.stroke();
    }
    c.restore();
  }
  // energy meter scale
  {
    const vu = layout.lights.filter((l) => /^vu\d+$/.test(l.id)).sort((a, b) => a.y - b.y);
    if (vu.length) {
      c.save(); c.strokeStyle = rgba(cyan, 0.75); c.lineWidth = 0.9 * S; c.shadowColor = cyan; c.shadowBlur = 4 * S;
      path(c, [[vu[0].x - 15, vu[0].y - 6], [vu[0].x - 15, vu.at(-1).y + 6]], false); c.stroke();
      path(c, [[vu[0].x + 15, vu[0].y - 6], [vu[0].x + 15, vu.at(-1).y + 6]], false); c.stroke();
      c.restore();
      vu.forEach((l, i) => txt(String(i + 1), l.x - 20, l.y, 5, i < 6 ? cyan : i < 9 ? acid : red, { align: 'right', alpha: 0.85, glow: 0.3 }));
    }
  }

  // ================================================================== 10. dark halos under every insert (keeps lamps readable)
  for (const l of layout.lights) {
    const r = l.shape === 'bar' ? l.r * 2.4 : l.r * (l.shape === 'arrow' ? 1.7 : 1.55);
    const g = c.createRadialGradient(X(l.x), Y(l.y), l.r * 0.8 * S, X(l.x), Y(l.y), r * S);
    g.addColorStop(0, 'rgba(2,1,6,0.85)'); g.addColorStop(1, 'rgba(2,1,6,0)');
    c.fillStyle = g; c.fillRect(X(l.x - r), Y(l.y + r), 2 * r * S, 2 * r * S);
  }

  // ================================================================== 11. lettering
  // title banner
  {
    const y = 276, x = 240;
    c.save();
    const pts = [[134, y - 14], [346, y - 14], [356, y], [346, y + 14], [134, y + 14], [124, y]];
    path(c, pts); c.fillStyle = 'rgba(5,3,14,0.88)'; c.fill();
    c.shadowColor = violet; c.shadowBlur = 10 * S; c.strokeStyle = rgba(violet, 0.95); c.lineWidth = 1.4 * S; c.stroke();
    c.shadowBlur = 0; c.strokeStyle = rgba(acid, 0.6); c.lineWidth = 0.6 * S;
    path(c, [[138, y - 11], [342, y - 11], [350, y], [342, y + 11], [138, y + 11], [130, y]]); c.stroke();
    c.restore();
    const tg = c.createLinearGradient(0, Y(y + 9), 0, Y(y - 9));
    tg.addColorStop(0, '#f4ffe8'); tg.addColorStop(0.5, acid); tg.addColorStop(1, '#2e8a10');
    txt(T.title, x, y + 2.2, 17, acid, { font: 'display', maxW: 196, spacing: 0.06, fill: tg, glow: 0.8 });
    txt(T.subtitle, x, y - 9.6, 6, cyan, { maxW: 150, spacing: 0.25, glow: 0.3 });
  }
  // beam pad (left of the ring) and mothership (right of the ring, next to the hull lamps)
  arcTxt(T.beam, pad.x, pad.y, 50, 180, 7.5, acid, { outward: true, font: 'display', spacing: 0.1 });
  arcTxt(T.ship, pad.x, pad.y, 50, 0, 6.6, red, { outward: false, font: 'display', spacing: 0.1 });
  // tank
  txt(T.tank, 96, 806, 8, amber, { font: 'display', plate: true, maxW: 32 });
  // ramps: vertical along the outside of each mouth
  for (const r of layout.rails || []) {
    const d = Math.atan2(r.entry.dir[1], r.entry.dir[0]) / DEG;
    const m = r.path[0];
    const side = m[0] < 240 ? -1 : 1;
    const px = r.entry.dir[1] * side, py = -r.entry.dir[0] * side; // outward normal
    const isCross = r.id === 'cross';
    txt(isCross ? T.cross : T.ramp, m[0] + px * 46 + r.entry.dir[0] * 30, m[1] + py * 46 + r.entry.dir[1] * 30, 6.8, isCross ? acid : cyan,
      { font: 'display', rot: -d, plate: true, maxW: 52 });
  }
  if (lamp.crossJackpot) txt(T.jackpot, lamp.crossJackpot.x - 11, lamp.crossJackpot.y, 5.8, chrome, { align: 'right', maxW: 30 });
  if (lamp.jackpot) txt(T.jackpot, lamp.jackpot.x + 11, lamp.jackpot.y, 5.8, chrome, { align: 'left', maxW: 30 });
  // shield targets (left wall) and laser battery (right wall)
  if (lamp.eleven0 && lamp.eleven1) txt(T.shield, lamp.eleven0.x + 2, (lamp.eleven0.y + lamp.eleven1.y) / 2, 6.5, cyan, { font: 'display', plate: true, maxW: 28 });
  if (lamp.battery0) txt(T.battery, lamp.battery0.x, lamp.battery0.y - 21, 5.8, cyan, { font: 'display', plate: true, maxW: 42 });
  // robot
  txt(T.robot, A.robot.x - 58, A.robot.y + 10, 6.5, red, { font: 'display', plate: true, maxW: 26 });
  // alien bank
  if (layout.dropTargets && layout.dropTargets.length) txt(T.targets, 240, 478, 5.8, acid, { maxW: 44, spacing: 0.08 });
  // waves: names to the left of the fan
  {
    const ws = ['w0', 'w1', 'w2', 'w3', 'w4'].map((id) => lamp[id]).filter(Boolean);
    if (ws.length) {
      txt(T.waves, ws[0].x, ws[0].y - 17, 7, amber, { font: 'display', plate: true, maxW: 40 });
      ws.forEach((l, i) => txt(`${i + 1} ${T.waveNames[i]}`, l.x - 11, l.y - (i === 4 ? 4 : 0), 6.8, '#ffe9b0', { align: 'right', maxW: 56, glow: 0.4 }));
    }
  }
  // energy
  if (lamp.vu10) {
    txt(T.energy, lamp.vu10.x + 24, (lamp.vu0.y + lamp.vu10.y) / 2, 7.5, cyan, { font: 'display', rot: -90, maxW: 90 });
    txt(T.overload, lamp.vu10.x, lamp.vu10.y + 11, 5.4, red, { font: 'display', maxW: 40, glow: 0.5 });
  }
  if (lamp.extraBall) txt(T.extra, lamp.extraBall.x + 12, lamp.extraBall.y, 6, chrome, { align: 'left', maxW: 38, alpha: 0.9 });
  if (lamp.superJackpot) txt(T.superJ, lamp.superJackpot.x + 10, lamp.superJackpot.y, 5.6, chrome, { align: 'left', maxW: 20, alpha: 0.9 });
  // top lanes
  txt('U   F   O', 275, 1004, 13, acid, { font: 'display', glow: 0.7 });
  // orbits
  txt('ORBIT', 55, 432, 8, cyan, { font: 'display', rot: -90 });
  txt('ORBIT', 425, 432, 8, cyan, { font: 'display', rot: -90 });
  // bonus row
  txt(T.bonus, 152, 240, 8, amber, { font: 'display', maxW: 40 });
  txt(T.multiplier, 330, 240, 5.6, amber, { font: 'display', maxW: 40 });
  txt(T.again, 240, 157, 5.6, red, { maxW: 40, spacing: 0.1 });
  // outlane shields
  txt(T.shield, 19, 318, 7, cyan, { font: 'display', rot: -90, maxW: 50 });
  txt(T.shield, 461, 318, 7, cyan, { font: 'display', rot: -90, maxW: 50 });
  // shooter lane
  txt(T.launch, 500, 220, 7, cyan, { font: 'display', rot: -90, maxW: 60, alpha: 0.8 });
}
