// Preview of the painted playfield art without the 3-D table.
// Bundles a tiny entry (layout + paintPlayfield), renders it in headless Chromium and saves PNGs.
//
//   node tools/art-preview.mjs [table=alien] [outDir=.] [--debug] [--width=1024] [--lit=0.55]
//
// Writes <outDir>/<table>_art_de.png and _en.png (art + fake lit lamps). With --debug it also writes
// <table>_art_debug.png with the physics geometry (walls, islands, bumpers, flippers, rails) overlaid.
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const table = pos[0] || 'alien';
const outDir = path.resolve(pos[1] || '.');
const width = +(flags.width || 1024);
const lit = +(flags.lit ?? 0.55);
fs.mkdirSync(outDir, { recursive: true });

const layoutModule = { riff: ['layout-riff.js', 'buildRiffLayout'], rotor: ['layout-rotor.js', 'buildRotorLayout'], alien: ['layout-alien.js', 'buildAlienLayout'] }[table];
if (!layoutModule) throw new Error(`unknown table ${table}`);
const entry = `
import * as LM from '../src/${layoutModule[0]}';
import { paintPlayfield, cssColor, LAMP_COLORS, shapeSprite } from '../src/playfieldArt.js';
import { arcPts } from '../src/layout.js';
window.renderArt = async ({ lang, lit, debug, width }) => {
  document.documentElement.dataset.table = ${JSON.stringify(table)};
  await Promise.all(["900 40px 'Orbitron'", "700 40px 'Orbitron'", "700 20px 'Barlow Condensed'", "500 20px 'Barlow Condensed'", "40px 'Black Ops One'", "40px 'Metal Mania'"].map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  const build = LM[${JSON.stringify(layoutModule[1])}] || LM.default;
  const L = build();
  const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'assets/${table}/playfield_base.jpg'; });
  const images = {};
  for (const [k, f] of Object.entries({ scene: 'art_scene.webp', apron: 'art_apron.webp', soldierL: 'art_soldier_left.webp', soldierR: 'art_soldier_right.webp' })) {
    const im = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'assets/${table}/' + f; });
    if (im) images[k] = im;
  }
  const cv = paintPlayfield(L, img, width, ${JSON.stringify(table === 'riff' ? 'riff' : table)}, { lang, images, texts: {} });
  const c = cv.getContext('2d');
  const S = cv.width / L.table.W, H = L.table.L;
  const X = (x) => x * S, Y = (y) => (H - y) * S;
  // fake lit lamps (additive glow sprites like the renderer)
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  c.globalCompositeOperation = 'lighter';
  for (const l of L.lights) {
    if (rnd() > lit) continue;
    const col = cssColor(LAMP_COLORS[l.color] || '--lamp-orange');
    const spr = shapeSprite(l.shape === 'arrow' ? 'arrow' : l.shape === 'bar' ? 'bar' : 'circle', 128);
    const t = document.createElement('canvas'); t.width = t.height = 128;
    const tc = t.getContext('2d'); tc.drawImage(spr, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = col; tc.fillRect(0, 0, 128, 128);
    const s = l.r * S * 3.7;
    c.save(); c.translate(X(l.x), Y(l.y)); c.rotate((-(l.rot || 0) * Math.PI) / 180); c.globalAlpha = 0.9;
    c.drawImage(t, -s / 2, -s / 2, s, s); c.restore();
  }
  c.globalCompositeOperation = 'source-over';
  if (debug) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    const poly = (pts, color, w, close = false, fill = null) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y)))); if (close) c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } c.strokeStyle = color; c.lineWidth = w * S; c.stroke(); };
    const circ = (x, y, r, color, fill = null) => { c.beginPath(); c.arc(X(x), Y(y), r * S, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } c.strokeStyle = color; c.lineWidth = 1.2 * S; c.stroke(); };
    for (const isl of L.islands) poly(isl.pts, '#c84', 1, true, 'rgba(90,60,20,0.55)');
    for (const w of L.walls) poly(w.pts, w.kind === 'island' ? '#c84' : '#ddd', Math.max(1.5, w.r * 2));
    for (const a of L.arcs) poly(arcPts(a.cx, a.cy, a.r, a.a0, a.a1), '#999', 2);
    for (const p of L.posts) circ(p.x, p.y, p.r, '#f55', 'rgba(140,30,30,0.7)');
    for (const b of L.bumpers) circ(b.x, b.y, b.r, '#fa0', 'rgba(100,70,0,0.55)');
    for (const s of L.scoops || []) circ(s.x, s.y, s.r, '#f0f', 'rgba(60,0,60,0.6)');
    for (const b of L.bashes || []) circ(b.x, b.y, b.r, '#f0f', 'rgba(60,0,60,0.6)');
    for (const t of [...(L.standups || []), ...L.dropTargets]) poly([[t.x - t.ux * t.w / 2, t.y - t.uy * t.w / 2], [t.x + t.ux * t.w / 2, t.y + t.uy * t.w / 2]], '#ff0', 5);
    for (const sl of L.slings) poly([sl.A, sl.B, sl.C], '#f80', sl.r * 2, true);
    for (const f of L.flippers) poly([[f.x, f.y], [f.x + Math.cos(f.rest) * f.len, f.y + Math.sin(f.rest) * f.len]], '#f33', f.rBase * 1.4);
    for (const r of L.rails || []) poly(r.path.map((p) => [p[0], p[1]]), 'rgba(80,170,255,0.8)', 3);
    for (const s of L.sensors) circ(s.x, s.y, s.r, 'rgba(0,255,255,0.6)');
    for (const l of L.lights) circ(l.x, l.y, l.r, 'rgba(120,255,120,0.9)');
  }
  const out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
  out.getContext('2d').drawImage(cv, 0, 0);
  document.body.appendChild(out); out.id = 'art';
  return [out.width, out.height];
};
`;
const tmp = path.join(root, 'tools', '.art-preview-entry.js');
fs.writeFileSync(tmp, entry);
let js;
try {
  const r = await build({ entryPoints: [tmp], bundle: true, write: false, format: 'iife', loader: { '.json': 'json' }, logLevel: 'error' });
  js = r.outputFiles[0].text;
} finally { fs.rmSync(tmp, { force: true }); }

const css = fs.readFileSync(path.join(root, 'src/styles/tokens.css'), 'utf8');
const html = `<!doctype html><html data-table="${table}"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Metal+Mania&family=Black+Ops+One&family=Orbitron:wght@700;900&display=swap">
<style>${css}\nbody{margin:0;background:#000}canvas{display:block}</style></head><body><script>${js}</script></body></html>`;

const types = { '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
  const f = path.join(root, p);
  if (!f.startsWith(path.join(root, 'assets')) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
try {
  const jobs = [['de', false], ['en', false]];
  if (flags.debug) jobs.push(['de', true]);
  for (const [lang, debug] of jobs) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.error('console:', m.text()); });
    await page.goto(url);
    const [w, h] = await page.evaluate((o) => window.renderArt(o), { lang, lit, debug, width });
    await page.setViewportSize({ width: w, height: h });
    const file = path.join(outDir, `${table}_art_${debug ? 'debug' : lang}.png`);
    await (await page.$('#art')).screenshot({ path: file });
    console.log('wrote', file, w, 'x', h);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
