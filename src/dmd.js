// Dot-matrix display (128 x 32), the classic pinball score board.
// Draws into a tiny canvas that CSS scales up with a dot mask on top.

import { t, fmtNum } from './i18n.js';

const W = 128, H = 32;

// 5x7 font, rows as bit strings. Proportional glyphs carry their own width.
const G = {
  A: '01110,10001,10001,11111,10001,10001,10001', B: '11110,10001,10001,11110,10001,10001,11110',
  C: '01110,10001,10000,10000,10000,10001,01110', D: '11110,10001,10001,10001,10001,10001,11110',
  E: '11111,10000,10000,11110,10000,10000,11111', F: '11111,10000,10000,11110,10000,10000,10000',
  G: '01110,10001,10000,10111,10001,10001,01111', H: '10001,10001,10001,11111,10001,10001,10001',
  I: '111,010,010,010,010,010,111', J: '00111,00010,00010,00010,00010,10010,01100',
  K: '10001,10010,10100,11000,10100,10010,10001', L: '10000,10000,10000,10000,10000,10000,11111',
  M: '10001,11011,10101,10101,10001,10001,10001', N: '10001,11001,10101,10011,10001,10001,10001',
  O: '01110,10001,10001,10001,10001,10001,01110', P: '11110,10001,10001,11110,10000,10000,10000',
  Q: '01110,10001,10001,10001,10101,10010,01101', R: '11110,10001,10001,11110,10100,10010,10001',
  S: '01111,10000,10000,01110,00001,00001,11110', T: '11111,00100,00100,00100,00100,00100,00100',
  U: '10001,10001,10001,10001,10001,10001,01110', V: '10001,10001,10001,10001,10001,01010,00100',
  W: '10001,10001,10001,10101,10101,11011,10001', X: '10001,10001,01010,00100,01010,10001,10001',
  Y: '10001,10001,01010,00100,00100,00100,00100', Z: '11111,00001,00010,00100,01000,10000,11111',
  Ä: '01010,00000,01110,10001,11111,10001,10001', Ö: '01010,00000,01110,10001,10001,10001,01110',
  Ü: '01010,00000,10001,10001,10001,10001,01110',
  0: '01110,10001,10011,10101,11001,10001,01110', 1: '010,110,010,010,010,010,111',
  2: '01110,10001,00001,00010,00100,01000,11111', 3: '11110,00001,00001,01110,00001,00001,11110',
  4: '00010,00110,01010,10010,11111,00010,00010', 5: '11111,10000,11110,00001,00001,10001,01110',
  6: '00110,01000,10000,11110,10001,10001,01110', 7: '11111,00001,00010,00100,01000,01000,01000',
  8: '01110,10001,10001,01110,10001,10001,01110', 9: '01110,10001,10001,01111,00001,00010,01100',
  ' ': '000,000,000,000,000,000,000', '.': '0,0,0,0,0,0,1', ',': '00,00,00,00,00,01,10',
  '!': '1,1,1,1,1,0,1', ':': '0,0,1,0,1,0,0', '-': '0000,0000,0000,1111,0000,0000,0000',
  '+': '00000,00100,00100,11111,00100,00100,00000', '/': '00001,00001,00010,00100,01000,10000,10000',
  "'": '1,1,0,0,0,0,0', '?': '01110,10001,00001,00010,00100,00000,00100',
};
const FONT = {};
for (const k in G) {
  const rows = G[k].split(',');
  FONT[k] = { w: rows[0].length, rows: rows.map((r) => parseInt(r, 2)) };
}

function norm(s) {
  return String(s).toUpperCase().replace(/ß/g, 'SS');
}

export function textWidth(s, scale = 1) {
  s = norm(s);
  let w = 0;
  for (const ch of s) w += ((FONT[ch] || FONT['?']).w + 1) * scale;
  return Math.max(0, w - scale);
}

export class DMD {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W; canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.img = this.ctx.createImageData(W, H);
    this.buf = new Float32Array(W * H);
    this.color = [255, 176, 0];
    this.score = 0;
    this.shownScore = 0;
    this.ball = 0;
    this.info = '';
    this.queue = [];
    this.cur = null;
    this.mode = 'attract';
    this.time = 0;
    this.attractPages = [];
    this.bonus = null;
    this.hint = null;
    this._last = -1;
  }

  setColor(rgb) { this.color = rgb; }
  setScore(s) { this.score = s; }
  setBall(n, info = '') { this.ball = n; this.info = info; }
  setMode(m) { this.mode = m; this.time = 0; if (m !== 'game') { this.queue.length = 0; this.cur = null; } }
  setHint(lines) { this.hint = lines; }

  /** Queue a message. lines: string | string[] */
  show(lines, o = {}) {
    const m = { lines: Array.isArray(lines) ? lines : [lines], dur: o.dur ?? 1.6, pri: o.pri ?? 1, anim: o.anim, t: 0 };
    if (this.cur && m.pri >= this.cur.pri) { this.cur = m; return; }
    if (!this.cur) { this.cur = m; return; }
    if (this.queue.length < 3) this.queue.push(m);
  }

  showBonus(b) { this.bonus = { ...b, t: 0 }; }
  clearBonus() { this.bonus = null; }

  // ---------------------------------------------------------------- drawing primitives
  clear(v = 0) { this.buf.fill(v); }
  px(x, y, v = 1) { if (x >= 0 && x < W && y >= 0 && y < H) this.buf[y * W + x] = v; }
  text(s, x, y, scale = 1, v = 1) {
    s = norm(s);
    let cx = x;
    for (const ch of s) {
      const g = FONT[ch] || FONT['?'];
      for (let r = 0; r < 7; r++) {
        const row = g.rows[r];
        for (let c = 0; c < g.w; c++) {
          if (row & (1 << (g.w - 1 - c))) {
            for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) this.px(cx + c * scale + a, y + r * scale + b, v);
          }
        }
      }
      cx += (g.w + 1) * scale;
    }
  }
  center(s, y, scale = 1, v = 1) { this.text(s, Math.round((W - textWidth(s, scale)) / 2), y, scale, v); }
  fit(s) { return textWidth(s, 2) <= W - 4 ? 2 : 1; }
  lines(lines, v = 1) {
    if (lines.length === 1) {
      const sc = this.fit(lines[0]);
      this.center(lines[0], sc === 2 ? 9 : 12, sc, v);
    } else {
      const s0 = this.fit(lines[0]), s1 = this.fit(lines[1]);
      const h = s0 * 7 + s1 * 7 + 3;
      const y0 = Math.round((H - h) / 2);
      this.center(lines[0], y0, s0, v);
      this.center(lines[1], y0 + s0 * 7 + 3, s1, v);
    }
  }
  border(phase) {
    for (let x = 0; x < W; x++) { if ((x + phase) % 4 < 2) { this.px(x, 0, 0.8); this.px(W - 1 - x, H - 1, 0.8); } }
    for (let y = 0; y < H; y++) { if ((y + phase) % 4 < 2) { this.px(W - 1, y, 0.8); this.px(0, H - 1 - y, 0.8); } }
  }
  bolt(seed) {
    // a jagged lightning column
    let x = (seed * 37) % W, r = seed;
    for (let y = 0; y < H; y++) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      x += (r % 3) - 1;
      this.px(x, y, 1); this.px(x + 1, y, 0.5);
    }
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    this.time += dt;
    // score roll-up
    if (this.shownScore !== this.score) {
      const d = this.score - this.shownScore;
      const stepv = Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 9)));
      this.shownScore += Math.sign(d) * Math.min(Math.abs(d), stepv);
    }
    if (this.cur) {
      this.cur.t += dt;
      if (this.cur.t > this.cur.dur) this.cur = this.queue.shift() || null;
    }
    const frame = Math.floor(this.time * 24);
    if (frame === this._last) return;
    this._last = frame;
    this.clear();
    if (this.bonus) this._drawBonus(dt);
    else if (this.cur) this._drawMessage(frame);
    else if (this.mode === 'game') this._drawScore(frame);
    else this._drawAttract(frame);
    this._blit();
  }

  _drawMessage(frame) {
    const m = this.cur;
    let v = 1;
    if (m.anim === 'flash') {
      if (m.t < 0.7 && frame % 4 < 2) { this.clear(0.55); v = 0; }
      this.border(frame);
    } else if (m.anim === 'storm') {
      if (m.t < 1.6) { this.bolt(frame * 7 + 3); this.bolt(frame * 13 + 11); if (frame % 5 === 0) this.clear(0.45); }
      this.border(frame * 2);
    }
    this.lines(m.lines, v);
  }

  _drawScore(frame) {
    const s = fmtNum(this.shownScore);
    const sc = textWidth(s, 2) <= W - 2 ? 2 : 1;
    this.center(s, sc === 2 ? 3 : 7, sc);
    if (this.hint && frame % 24 < 16) {
      this.center(this.hint[frame % 96 < 48 ? 0 : 1] || this.hint[0], 23, 1, 0.9);
      return;
    }
    this.text(t('d_ball', { n: this.ball }), 2, 23, 1, 0.75);
    if (this.info) this.text(this.info, W - 2 - textWidth(this.info), 23, 1, 0.75);
  }

  _drawBonus() {
    const b = this.bonus;
    b.t += 1 / 24;
    if (b.tilted) { this.center(t('d_tilt'), 9, 2); return; }
    if (b.t < 1.3) {
      this.center(t('d_bonus'), 2, 2);
      this.center(fmtNum(Math.round(b.base * Math.min(1, b.t / 0.9))), 20, 1);
    } else if (b.t < 2.4) {
      this.center(`${fmtNum(b.base)} ${t('d_bonusX', { n: b.x })}`, 4, 1);
      const k = Math.min(1, (b.t - 1.3) / 0.8);
      this.center(fmtNum(Math.round(b.base + (b.total - b.base) * k)), 15, 2);
    } else {
      this.center(t('d_total'), 3, 1);
      this.center(fmtNum(b.total), 14, 2);
      this.border(Math.floor(b.t * 20));
    }
  }

  _drawAttract(frame) {
    const pages = this.attractPages;
    if (!pages.length) return;
    const per = 3.2;
    const i = Math.floor(this.time / per) % pages.length;
    const ph = (this.time % per) / per;
    const p = pages[i];
    if (ph < 0.06 || ph > 0.96) return;
    if (p.anim === 'storm' && ph < 0.3) { this.bolt(frame * 5 + 1); this.bolt(frame * 9 + 5); }
    if (p.anim === 'blink' && frame % 16 >= 11) { this.center(p.lines[0], 4, this.fit(p.lines[0])); return; }
    this.lines(p.lines);
    if (p.border) this.border(frame);
  }

  _blit() {
    const d = this.img.data, b = this.buf, [r, g, bl] = this.color;
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      const k = 0.075 + v * 0.925;
      const o = i * 4;
      d[o] = Math.min(255, r * k + (v > 0.9 ? 40 : 0));
      d[o + 1] = Math.min(255, g * k + (v > 0.9 ? 30 : 0));
      d[o + 2] = bl * k;
      d[o + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
