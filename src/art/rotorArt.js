// Playfield artwork for ROTORSTURM (Vietnam 1968), painted over the topographic texture baked in
// Blender. Positions come from the table layout (src/layout-rotor.js), so art, lamps and toys agree.
// Elements: jungle edges, a painted dusk scene with soldiers and helicopters (rendered in Blender),
// the VIETNAM 1968 banner with flags, the mission ladder plates, a map of Indochina with Hanoi,
// Saigon, the DMZ and the Ho Chi Minh trail, lane markings, hazard rings and lettering.

import { cssColor, rng } from '../playfieldArt.js';
import INDOCHINA from './indochina.json';

const TXT = {
  de: {
    missions: ['ROLLING THUNDER', 'HO-CHI-MINH-PFAD', 'TET-OFFENSIVE', 'KHE SANH', 'ABZUG'],
    trail: 'HO-CHI-MINH-PFAD', laos: 'LAOS', cambodia: 'KAMBODSCHA', sea: 'SÜDCHINESISCHES MEER', thai: 'THAILAND', china: 'CHINA',
    huey: 'HUEYEINSATZ', supply: 'NACHSCHUB', base: 'KHE SANH', monsoon: 'MONSUN', tunnel: 'TUNNELSYSTEM', bonus: 'BONUS-MULTIPLIKATOR',
    lz: 'LANDEZONE', again: 'NOCHMAL', extra: 'EXTRA', lock: 'SPERRE', mission: 'MISSION',
  },
  en: {
    missions: ['ROLLING THUNDER', 'HO CHI MINH TRAIL', 'TET OFFENSIVE', 'KHE SANH', 'WITHDRAWAL'],
    trail: 'HO CHI MINH TRAIL', laos: 'LAOS', cambodia: 'CAMBODIA', sea: 'SOUTH CHINA SEA', thai: 'THAILAND', china: 'CHINA',
    huey: 'HUEY MISSION', supply: 'SUPPLY', base: 'KHE SANH', monsoon: 'MONSOON', tunnel: 'TUNNEL SYSTEM', bonus: 'BONUS MULTIPLIER',
    lz: 'LANDING ZONE', again: 'AGAIN', extra: 'EXTRA', lock: 'LOCK', mission: 'MISSION',
  },
};

export function drawUSFlag(c, x, y, w, h) {
  const stripe = h / 13;
  for (let i = 0; i < 13; i++) { c.fillStyle = i % 2 ? '#f2efe6' : '#b22234'; c.fillRect(x, y + i * stripe, w, stripe + 0.5); }
  const cw = w * 0.4, ch = stripe * 7;
  c.fillStyle = '#3c3b6e'; c.fillRect(x, y, cw, ch);
  c.fillStyle = '#f2efe6';
  for (let r = 0; r < 9; r++) {
    const n = r % 2 ? 5 : 6;
    for (let k = 0; k < n; k++) {
      const sx = x + cw * ((k + (r % 2 ? 1 : 0.5)) / 6), sy = y + ch * ((r + 0.5) / 9);
      c.beginPath(); c.arc(sx, sy, Math.max(0.6, h * 0.018), 0, Math.PI * 2); c.fill();
    }
  }
}

export function drawStar(c, cx, cy, r, color) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.4 : r;
    c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  c.closePath(); c.fillStyle = color; c.fill();
}

export function drawVNFlag(c, x, y, w, h) {
  c.fillStyle = '#c8211b'; c.fillRect(x, y, w, h);
  drawStar(c, x + w / 2, y + h / 2, h * 0.32, '#ffd500');
}

export function paintRotor(hp, layout) {
  const { c, X, Y, S, W, L, glow, label, extra } = hp;
  const T = TXT[extra.lang] || TXT.de;
  const img = extra.images || {};
  const R = rng(1968);
  const signal = cssColor('--rotor-signal', '#f2c230');
  const khaki = cssColor('--rotor-khaki', '#c9b98a');
  const sky = cssColor('--c-volt', '#7fd6ff');
  const bone = '#ece4cc';
  const rect = (x0, y0, x1, y1) => [X(x0), Y(y1), (x1 - x0) * S, (y1 - y0) * S];

  // ---- jungle canopy blobs along the walls and between features (dark, layered)
  c.save();
  const leaf = (x, y, r, k) => {
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    g.addColorStop(0, `rgba(${20 + k * 10},${46 + k * 12},${14 + k * 4},0.55)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(X(x - r), Y(y + r), 2 * r * S, 2 * r * S);
  };
  for (let i = 0; i < 160; i++) {
    const side = R() < 0.5;
    const y = 120 + R() * 940;
    const x = side ? R() * 70 : 410 + R() * 70;
    leaf(x, y, 14 + R() * 26, (R() * 3) | 0);
  }
  for (let i = 0; i < 40; i++) leaf(60 + R() * 380, 980 + R() * 80, 20 + R() * 30, (R() * 3) | 0);
  c.restore();

  // ---- rotor wash under the helipad
  c.save(); c.globalCompositeOperation = 'lighter';
  const pad = layout.rotor ? layout.rotor.heli : { x: 130, y: 918 };
  c.translate(X(pad.x), Y(pad.y));
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, r0 = 70 * S, r1 = (110 + R() * 60) * S;
    c.strokeStyle = 'rgba(190,200,120,0.12)'; c.lineWidth = (1.5 + R() * 2) * S;
    c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a + 0.2) * r1, Math.sin(a + 0.2) * r1); c.stroke();
  }
  c.restore();

  // ---- smoke plumes and fire glow (like the reference's burning treeline), away from the shots
  c.save(); c.globalCompositeOperation = 'lighter';
  glow(110, 470, 70, 'rgba(255,120,40,1)', 0.22);
  glow(96, 520, 40, 'rgba(255,190,90,1)', 0.18);
  glow(250, 1000, 120, 'rgba(160,110,220,1)', 0.1);
  glow(240, 150, 200, 'rgba(255,150,50,1)', 0.18);
  c.restore();
  c.save();
  for (let i = 0; i < 14; i++) {
    const x = 100 + R() * 40, y = 480 + i * 14, r = 16 + i * 2.2;
    const g = c.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r * S);
    g.addColorStop(0, 'rgba(30,28,24,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(X(x - r), Y(y + r), 2 * r * S, 2 * r * S);
  }
  c.restore();

  // ---- painted dusk scene behind the lower playfield
  if (img.scene) {
    c.save(); c.globalAlpha = 0.95;
    c.drawImage(img.scene, ...rect(84, 150, 396, 372));
    c.restore();
  } else {
    const g = c.createLinearGradient(0, Y(372), 0, Y(150));
    g.addColorStop(0, 'rgba(255,140,40,0.5)'); g.addColorStop(1, 'rgba(60,20,30,0.2)');
    c.fillStyle = g; c.fillRect(...rect(110, 150, 370, 372));
  }
  if (img.soldierL) c.drawImage(img.soldierL, ...rect(2, 352, 86, 470));
  if (img.soldierR) c.drawImage(img.soldierR, ...rect(394, 352, 478, 470));

  // ---- tunnel window frame: a cross-section of earth and timber around the glass
  if (layout.rotor) {
    const t = layout.rotor.tunnel;
    c.save();
    c.fillStyle = 'rgba(40,26,12,0.92)';
    c.fillRect(...rect(t.x0 - 12, t.y0 - 12, t.x1 + 12, t.y1 + 12));
    c.fillStyle = '#6b4a24';
    for (const [x0, y0, x1, y1] of [[t.x0 - 12, t.y1, t.x1 + 12, t.y1 + 6], [t.x0 - 12, t.y0 - 6, t.x1 + 12, t.y0], [t.x0 - 8, t.y0 - 6, t.x0 - 2, t.y1 + 6], [t.x1 + 2, t.y0 - 6, t.x1 + 8, t.y1 + 6]]) c.fillRect(...rect(x0, y0, x1, y1));
    c.restore();
  }

  // ---- banner: VIETNAM 1968 with flags at both ends
  {
    const y0 = 262, y1 = 296, x0 = 112, x1 = 368;
    c.save();
    const g = c.createLinearGradient(0, Y(y1), 0, Y(y0));
    g.addColorStop(0, '#d9c99a'); g.addColorStop(1, '#a8946a');
    c.beginPath();
    c.moveTo(X(x0), Y(y1)); c.quadraticCurveTo(X(240), Y(y1 + 10), X(x1), Y(y1));
    c.lineTo(X(x1), Y(y0)); c.quadraticCurveTo(X(240), Y(y0 + 10), X(x0), Y(y0)); c.closePath();
    c.fillStyle = g; c.fill();
    c.lineWidth = 1.5 * S; c.strokeStyle = 'rgba(40,30,10,0.8)'; c.stroke();
    drawUSFlag(c, X(x0 - 34), Y(y1 + 2), 44 * S, 34 * S);
    drawVNFlag(c, X(x1 - 10), Y(y1 + 2), 44 * S, 34 * S);
    c.restore();
    label('VIETNAM 1968', 240, (y0 + y1) / 2 + 4, 21, '#2a2410', 0, 'display', 0.95);
  }

  // ---- mission ladder plates
  {
    const lamps = Object.fromEntries(layout.lights.map((l) => [l.id, l]));
    label(T.mission, 168, 580, 9, signal, 0, 'ui', 0.9);
    T.missions.forEach((name, i) => {
      const l = lamps[`m${i}`];
      if (!l) return;
      c.save();
      c.fillStyle = 'rgba(30,26,14,0.82)'; c.strokeStyle = '#8a7a4a'; c.lineWidth = 1.2 * S;
      c.beginPath(); c.rect(...rect(l.x + 10, l.y - 9, l.x + 112, l.y + 9)); c.fill(); c.stroke();
      c.restore();
      label(name, l.x + 61, l.y + 0.5, 8.6, bone, 0, 'display', 0.95);
    });
  }

  // ---- map of Indochina
  if (layout.map) {
    const m = layout.map;
    const P = ([lo, la]) => [X(m.x0 + (lo - m.lon0) * m.kx), Y(m.y0 + (la - m.lat0) * m.ky)];
    const box = [m.x0, m.y0, m.x0 + (m.lon1 - m.lon0) * m.kx, m.y0 + (m.lat1 - m.lat0) * m.ky];
    c.save();
    c.beginPath(); c.rect(...rect(...box)); c.clip();
    c.fillStyle = 'rgba(28,62,70,0.75)'; c.fillRect(...rect(...box));
    // sea grid
    c.strokeStyle = 'rgba(160,210,220,0.12)'; c.lineWidth = 1;
    for (let lo = 102; lo <= 110; lo += 2) { const [a] = P([lo, 0]); c.beginPath(); c.moveTo(a, Y(box[1])); c.lineTo(a, Y(box[3])); c.stroke(); }
    for (let la = 10; la <= 22; la += 2) { const [, b] = P([0, la]); c.beginPath(); c.moveTo(X(box[0]), b); c.lineTo(X(box[2]), b); c.stroke(); }
    const fillRings = (rings, fill, stroke) => {
      for (const ring of rings) {
        c.beginPath(); ring.forEach((p, i) => { const [x, y] = P(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
        c.fillStyle = fill; c.fill();
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1 * S; c.stroke(); }
      }
    };
    for (const k of ['cn', 'th', 'la', 'kh']) if (INDOCHINA[k]) fillRings(INDOCHINA[k], k === 'la' || k === 'kh' ? 'rgba(160,140,90,0.85)' : 'rgba(120,110,80,0.8)', 'rgba(40,30,10,0.6)');
    // Vietnam: north of the 17th parallel red, south yellow (clip halves)
    const dmz = P([0, 17])[1];
    for (const [fill, clipTop] of [['#b5291f', true], ['#d8a724', false]]) {
      c.save();
      c.beginPath();
      if (clipTop) c.rect(0, 0, c.canvas.width, dmz); else c.rect(0, dmz, c.canvas.width, c.canvas.height);
      c.clip();
      fillRings(INDOCHINA.vn, fill, 'rgba(40,10,5,0.8)');
      c.restore();
    }
    // DMZ line
    c.setLineDash([4 * S, 3 * S]); c.strokeStyle = bone; c.lineWidth = 1.6 * S;
    const [dx0] = P([105.6, 17]), [dx1] = P([107.3, 17]);
    c.beginPath(); c.moveTo(dx0, dmz); c.lineTo(dx1, dmz); c.stroke(); c.setLineDash([]);
    // Ho Chi Minh trail
    c.strokeStyle = '#ff3b2a'; c.lineWidth = 2.4 * S; c.setLineDash([6 * S, 4 * S]);
    c.beginPath(); m.trail.forEach((p, i) => { const [x, y] = P(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    const end = P([106.6, 11.2]); c.lineTo(end[0], end[1]); c.stroke(); c.setLineDash([]);
    // cities
    const [hx, hy] = P([105.85, 21.03]); drawStar(c, hx, hy, 5 * S, '#ffe14a');
    const [sx, sy] = P([106.7, 10.78]); c.beginPath(); c.arc(sx, sy, 3.6 * S, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 1.5 * S; c.strokeStyle = '#b5291f'; c.stroke();
    c.restore();
    // frame and labels outside the clip
    c.save(); c.strokeStyle = khaki; c.lineWidth = 2 * S; c.strokeRect(...rect(...box)); c.restore();
    const lab = (txt, lo, la, size, color, rot = 0, font = 'ui') => {
      const x = m.x0 + (lo - m.lon0) * m.kx, y = m.y0 + (la - m.lat0) * m.ky;
      label(txt, x, y, size, color, rot, font, 0.92);
    };
    lab('HANOI', 107.9, 21.2, 8, bone, 0, 'display');
    lab('SAIGON', 108.6, 10.4, 8, bone, 0, 'display');
    lab('DMZ 17°', 108.3, 17.3, 6.5, bone);
    lab(T.laos, 103.6, 18.6, 6.5, '#2a2410');
    lab(T.cambodia, 104.6, 12.6, 5.5, '#2a2410');
    lab(T.trail, 104.6, 15.2, 5.2, '#ff5a3a', 62);
    lab(T.sea, 108.8, 14.5, 4.8, 'rgba(200,230,235,0.8)', 75);
  }

  // ---- lane markings
  const chevrons = (x, y0, y1, color, step = 26, w = 12, rot = 0, alpha = 0.6) => {
    c.save(); c.strokeStyle = color; c.lineWidth = 3 * S; c.globalAlpha = alpha;
    for (let y = y0; y < y1; y += step) {
      c.save(); c.translate(X(x), Y(y)); c.rotate((rot * Math.PI) / 180);
      c.beginPath(); c.moveTo(-w * S, 6 * S); c.lineTo(0, -6 * S); c.lineTo(w * S, 6 * S); c.stroke();
      c.restore();
    }
    c.restore();
  };
  chevrons(59, 240, 330, sky, 22, 9, 180, 0.5);
  chevrons(421, 240, 330, sky, 22, 9, 180, 0.5);
  c.save(); c.fillStyle = 'rgba(235,230,210,0.55)';
  for (let y = 120; y < 760; y += 36) c.fillRect(X(498), Y(y + 14), 4 * S, 14 * S);
  c.restore();

  // ---- hazard rings under the star bumpers
  for (const b of layout.bumpers) {
    c.save(); c.translate(X(b.x), Y(b.y));
    for (let k = 0; k < 16; k++) {
      c.beginPath(); c.arc(0, 0, 44 * S, (k / 16) * Math.PI * 2, ((k + 0.5) / 16) * Math.PI * 2);
      c.lineWidth = 6 * S; c.strokeStyle = k % 2 ? 'rgba(20,20,10,0.8)' : signal; c.globalAlpha = 0.55; c.stroke();
    }
    c.restore();
  }

  // ---- rain over everything (monsoon)
  c.save(); c.strokeStyle = 'rgba(210,230,240,0.05)'; c.lineWidth = 1 * S;
  for (let i = 0; i < 420; i++) {
    const x = R() * W, y = R() * L, l = 10 + R() * 18;
    c.beginPath(); c.moveTo(X(x), Y(y)); c.lineTo(X(x - l * 0.25), Y(y - l)); c.stroke();
  }
  c.restore();

  // ---- lettering
  label(T.huey, 150, 572, 8, '#9cff7a', 15, 'display', 0.9);
  label(T.supply, 318, 448, 11, '#ff8a2a', -72, 'display');
  label(T.base, 344, 500, 8, '#ff5a3a', -73, 'display', 0.9);
  label('ORBIT', 82, 440, 10, sky, -84, 'ui');
  label('ORBIT', 398, 440, 10, sky, 84, 'ui');
  label('S   O   S', 275, 1006, 15, sky, 0, 'ui');
  label(T.monsoon, 272, 905, 11, signal, 0, 'ui', 0.75);
  label(T.lock, 240, 660, 7, '#9cff7a', 0, 'ui', 0.85);
  label(T.bonus, 240, 210, 7, bone, 0, 'ui', 0.8);
  label(T.again, 240, 158, 6.5, bone, 0, 'ui', 0.8);
}
