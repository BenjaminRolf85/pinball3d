import { buildRotorLayout } from '../src/layout-rotor.js';
import { layoutSvg } from './layout-svg.mjs';
import fs from 'node:fs';
fs.writeFileSync(process.argv[2], layoutSvg([], buildRotorLayout()));
