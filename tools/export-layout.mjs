// Writes the table layout (plus the sampled ramp rail) as JSON for the Blender build script.
import { buildLayout } from '../src/layout.js';
import { tableById } from '../src/tables.js';
import { buildRotorLayout } from '../src/layout-rotor.js';
import { buildRiffLayout } from '../src/layout-riff.js';
import { buildAlienLayout } from '../src/layout-alien.js';
import { sampleRampPath } from '../src/physics.js';
import fs from 'node:fs';
const id = process.argv[2] || 'riff';
const L = id === 'rotor' ? buildRotorLayout() : id === 'riff' ? buildRiffLayout() : id === 'alien' ? buildAlienLayout() : buildLayout(tableById(id).layout);
const rp = L.ramp ? sampleRampPath(L.ramp.path, 6) : { pts: [] };
if (L.ramp) L.ramp.samples = rp.pts.map((p) => p.map((v) => +(v * 1000).toFixed(2)));
for (const r of L.rails || []) r.samples = sampleRampPath(r.path, 6).pts.map((p) => p.map((v) => +(v * 1000).toFixed(2)));
fs.mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`../build/layout-${id}.json`, import.meta.url), JSON.stringify(L));
console.log(`layout-${id}.json written`);
