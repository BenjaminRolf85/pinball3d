// Mixed reality smoke test: emulates a Meta Quest 3 (IWER) in headless Chromium, enters the
// immersive-ar session through the start menu button, plays with the emulated controllers and
// leaves again. Usage: node tools/xr-test.mjs [table] [outDir]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const TABLE = process.argv[2] || 'alien';
const OUT = process.argv[3] || 'build/shots';
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xr-'));
fs.writeFileSync(path.join(tmp, 'entry.js'), "import { XRDevice, metaQuest3 } from 'iwer'; const d = new XRDevice(metaQuest3); d.installRuntime({ forceInstall: true, polyfillLayers: true }); window.__iwer = d;");
await build({ entryPoints: [path.join(tmp, 'entry.js')], bundle: true, format: 'iife', outfile: path.join(tmp, 'iwer.js'), nodePaths: [path.resolve('node_modules')], logLevel: 'error' });
const iwer = fs.readFileSync(path.join(tmp, 'iwer.js'), 'utf8');

const port = 8131;
const srv = spawn('node', ['tools/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript((tb) => { window.name = `rgTable=${tb}`; }, TABLE);
await page.addInitScript(iwer);
const check = (name, ok, info = '') => { console.log(ok ? 'PASS' : 'FAIL', name, info); if (!ok) errors.push('check failed: ' + name); };
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.__rg, null, { timeout: 120000 });
await page.waitForSelector('#btn-xr:not([hidden])', { timeout: 15000 }).catch(() => {});
check('xr button shown', await page.isVisible('#btn-xr'), await page.textContent('#btn-xr'));
const credits0 = await page.evaluate(() => window.__rg.store.data.credits);
await page.click('#btn-xr');
await page.waitForFunction(() => window.__rg.renderer.renderer.xr.isPresenting, null, { timeout: 20000 }).catch(() => {});
check('session presenting', await page.evaluate(() => window.__rg.renderer.renderer.xr.isPresenting));
check('game started in headset', await page.evaluate(() => window.__rg.game.state === 'playing'));
check('one credit used', (await page.evaluate(() => window.__rg.store.data.credits)) === credits0 - 1);
await wait(1500);
const t0 = await page.evaluate(() => window.__rg.game.time);
await wait(1500);
const t1 = await page.evaluate(() => window.__rg.game.time); check('game loop runs in XR', t1 > t0 + 0.02, `+${(t1 - t0).toFixed(2)}s game time in 1.5 s (software GPU)`);

// plunger on A, flippers on the triggers
const ctl = (hand, btn, v) => page.evaluate(([h, b, x]) => window.__iwer.controllers[h].updateButtonValue(b, x), [hand, btn, v]);
await ctl('right', 'a-button', 1); await wait(900);
check('plunger pulled with A', await page.evaluate(() => window.__rg.game.plunger.held));
await ctl('right', 'a-button', 0); await wait(1200);
check('ball launched', await page.evaluate(() => window.__rg.game.phys.ballsInShooter() === 0));
await ctl('left', 'trigger', 1); await wait(300);
check('left flipper up (trigger)', await page.evaluate(() => window.__rg.game.phys.flippers.find((f) => f.id === 'L').pressed));
await ctl('left', 'trigger', 0); await ctl('right', 'trigger', 1); await wait(300);
check('right flipper up (trigger)', await page.evaluate(() => window.__rg.game.phys.flippers.find((f) => f.id === 'R').pressed));
await ctl('right', 'trigger', 0); await wait(300);
check('flippers released', await page.evaluate(() => !window.__rg.game.phys.flippers.some((f) => f.pressed)));
check('passthrough background', await page.evaluate(() => window.__rg.renderer.scene.background === null));
await ctl('right', 'thumbstick', 1); await wait(200); await ctl('right', 'thumbstick', 0);
await wait(1500);
await page.screenshot({ path: `${OUT}/xr-${TABLE}.png` });

// leave with X
await ctl('left', 'x-button', 1); await wait(300); await ctl('left', 'x-button', 0);
await page.waitForFunction(() => !window.__rg.renderer.renderer.xr.isPresenting, null, { timeout: 10000 }).catch(() => {});
check('session ended', await page.evaluate(() => !window.__rg.renderer.renderer.xr.isPresenting));
check('paused after leaving', await page.evaluate(() => !document.getElementById('screen-pause').hidden));
check('background restored', await page.evaluate(() => window.__rg.renderer.scene.background !== null));
await wait(800);
check('flat loop runs again', await page.evaluate(async () => { const i = window.__rg.renderer.renderer.info.render; const a = i.frame; await new Promise((r) => setTimeout(r, 800)); return i.frame > a; }));

await browser.close();
srv.kill();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
process.exit(errors.length ? 1 : 0);
