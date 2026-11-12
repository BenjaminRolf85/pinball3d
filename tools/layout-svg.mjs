// Debug view of the layout (and optional ball traces) as SVG.
import { buildLayout, arcPts } from '../src/layout.js';
import { sampleRampPath } from '../src/physics.js';
import fs from 'node:fs';

export function layoutSvg(traces = [], layout = null) {
  const L = layout || buildLayout();
  const H = L.table.L, W = L.table.W;
  const Y = (y) => H - y;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${W + 20} ${H + 20}" width="${(W + 20) * 1.4}" height="${(H + 20) * 1.4}" style="background:#111">`;
  const line = (pts, c, w = 2, extra = '') => { s += `<polyline points="${pts.map((p) => `${p[0]},${Y(p[1])}`).join(' ')}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`; };
  const circ = (x, y, r, c, fill = 'none') => { s += `<circle cx="${x}" cy="${Y(y)}" r="${r}" stroke="${c}" fill="${fill}" stroke-width="1.5"/>`; };
  for (const isl of L.islands) s += `<polygon points="${isl.pts.map((p) => `${p[0]},${Y(p[1])}`).join(' ')}" fill="#3a2a10"/>`;
  for (const w of L.walls) line(w.pts, w.level === 0 ? '#08f' : w.kind === 'outer' ? '#888' : w.kind === 'island' ? '#c84' : '#ccc', Math.max(1.5, w.r * 2));
  for (const a of L.arcs) line(arcPts(a.cx, a.cy, a.r, a.a0, a.a1), '#888', 2);
  for (const p of L.posts) circ(p.x, p.y, p.r, '#f55', '#822');
  for (const b of L.bumpers) circ(b.x, b.y, b.r, '#fa0', '#640');
  if (L.skull) { circ(L.skull.x, L.skull.y, L.skull.r, '#fff', '#444'); for (const j of L.skull.jaw) line([j.a, j.b], '#fff', j.r * 2); circ(L.skull.mouth.x, L.skull.mouth.y, L.skull.mouth.r, '#f0f'); }
  for (const c of L.scoops || []) circ(c.x, c.y, c.r, c.level === 0 ? '#08f' : '#f0f', c.level === 0 ? '#024' : '#404');
  if (L.rotor) s += `<polygon points="${L.rotor.padPoly.map((p) => `${p[0]},${Y(p[1])}`).join(' ')}" fill="#5a6" fill-opacity="0.25" stroke="#5a6"/>`;
  for (const t of L.standups || []) line([[t.x - t.ux * t.w / 2, t.y - t.uy * t.w / 2], [t.x + t.ux * t.w / 2, t.y + t.uy * t.w / 2]], t.level === 0 ? '#0af' : '#0f8', 5);
  for (const g of L.gates) line([g.a, g.b], '#0f0', 2, 'stroke-dasharray="4 3"');
  for (const sl of L.slings) { line([sl.A, sl.B, sl.C, sl.A], '#f80', sl.r * 2); }
  for (const t of L.dropTargets) line([[t.x - t.ux * t.w / 2, t.y - t.uy * t.w / 2], [t.x + t.ux * t.w / 2, t.y + t.uy * t.w / 2]], '#ff0', 6);
  for (const f of L.flippers) {
    for (const a of [f.rest, f.up]) line([[f.x, f.y], [f.x + Math.cos(a) * f.len, f.y + Math.sin(a) * f.len]], a === f.rest ? '#f33' : '#733', f.rBase * 1.4);
  }
  for (const se of L.sensors) circ(se.x, se.y, se.r, '#0ff');
  const rails = L.rails || [{ path: L.ramp.path, entry: L.ramp.sensor }];
  const rc = ['#4af', '#fa4', '#f4a', '#4fa', '#aaf'];
  rails.forEach((r, i) => { const rp = sampleRampPath(r.path); line(rp.pts.map((p) => [p[0] * 1000, p[1] * 1000]), rc[i % 5], 3, 'opacity="0.6"'); if (r.entry) circ(r.entry.x, r.entry.y, r.entry.r, '#f0f'); });
  for (const l of L.lights) circ(l.x, l.y, l.r, '#5a5');
  for (const d of [...L.decor.amps, ...L.decor.tesla, ...L.decor.flamePots, ...(L.decor.signs || [])]) circ(d.x, d.y, 10, '#a5f');
  const cols = ['#ff0', '#0f8', '#f4f', '#8cf', '#fa5', '#fff'];
  traces.forEach((tr, i) => line(tr.map((p) => [p[0] * 1000, p[1] * 1000]), cols[i % cols.length], 1, 'opacity="0.75"'));
  s += '</svg>';
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || 'layout.svg';
  fs.writeFileSync(out, layoutSvg());
  console.log('wrote', out);
}
