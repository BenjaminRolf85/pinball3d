// Screenshots of the running game in headless Chromium (software WebGL).
// usage: node tools/shot.mjs <outDir> [scenario,...]
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'build/shots';
const want = (process.argv[3] || 'desk-start,phone-start,phone-play,desk-play').split(',');
fs.mkdirSync(out, { recursive: true });
const port = 8123;
const srv = spawn('node', ['tools/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const logs = [];
async function run(name, ctxOpts, fn, table = 'riff') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.addInitScript((tb) => { window.name = `rgTable=${tb}`; }, table);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(`http://localhost:${port}/index.html`);
  await page.waitForFunction(() => window.__rg, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  await fn(page);
  const pf = await page.evaluate(() => { window.__rgFreeze = true; return window.__rg.renderer._pf; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
  console.log(name, 'avg frame', (pf * 1000).toFixed(0) + 'ms');
  await ctx.close();
}
const desk = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const play = async (page, sec = 3.5, setup = '') => {
  await page.evaluate((setup) => {
    const { game, startGame } = window.__rg;
    startGame();
    for (let i = 0; i < 60; i++) game.update(1 / 60);
    game.plungerDown(); for (let i = 0; i < 50; i++) game.update(1 / 60); game.plungerUp();
    if (setup) new Function('rg', setup)(window.__rg);
  }, setup);
  await page.waitForTimeout(sec * 1000);
};
const S = {
  'desk-start': () => run('desk-start', desk, async () => {}),
  'phone-start': () => run('phone-start', phone, async () => {}),
  'phone-play': () => run('phone-play', phone, (p) => play(p, 3)),
  'desk-play': () => run('desk-play', desk, (p) => play(p, 3)),
  'desk-multi': () => run('desk-multi', desk, (p) => play(p, 2.2, 'rg.game.locks=2; rg.game.lockLit=true; const b=rg.game.phys.balls[0]; b.x=0.24; b.y=0.5; b.vx=0; b.vy=1.5;')),
  'phone-multi': () => run('phone-multi', phone, (p) => play(p, 2.2, 'rg.game.locks=2; rg.game.lockLit=true; const b=rg.game.phys.balls[0]; b.x=0.24; b.y=0.5; b.vx=0; b.vy=1.5;')),
  'phone-help': () => run('phone-help', phone, async (p) => { await p.click('#btn-help'); await p.waitForTimeout(400); }),
  'phone-over': () => run('phone-over', phone, async (p) => { await p.evaluate(() => { const g = window.__rg.game; window.__rg.startGame(); g.score = 1234560; g.ball = 3; for (const b of [...g.phys.balls]) g.phys.removeBall(b); g._gameOver(); }); await p.waitForTimeout(3200); }),
  'land-play': () => run('land-play', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, (p) => play(p, 3)),
  'desk-top': () => run('desk-top', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 2.6, 0.02); r.camPlay.tgt.set(0, 0, 0); r.camMix = 1; }); await p.waitForTimeout(2500); }),
  'desk-close': () => run('desk-close', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.02, 0.55, 0.42); r.camPlay.tgt.set(-0.02, 0.04, -0.12); r.camMix = 1; }); await p.waitForTimeout(2500); }),
  'desk-roxy': () => run('desk-roxy', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.1, 0.42, 0.28); r.camPlay.tgt.set(-0.1, 0.07, -0.1); r.camMix = 1; }); await p.waitForTimeout(1800); await p.evaluate(() => { window.__rg.renderer.roxyLaugh(true); }); await p.waitForTimeout(700); }),
  'desk-roxy0': () => run('desk-roxy0', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.1, 0.42, 0.28); r.camPlay.tgt.set(-0.1, 0.07, -0.1); r.camMix = 1; }); await p.waitForTimeout(2200); }),
  'rotor-start': () => run('rotor-start', desk, async () => {}, 'rotor'),
  'rotor-phone-start': () => run('rotor-phone-start', phone, async () => {}, 'rotor'),
  'rotor-phone-play': () => run('rotor-phone-play', phone, (p) => play(p, 3), 'rotor'),
  'rotor-play': () => run('rotor-play', desk, (p) => play(p, 3), 'rotor'),
  'rotor-multi': () => run('rotor-multi', desk, (p) => play(p, 4.5, 'rg.game.locks=2; rg.game.lockLit=true; const b=rg.game.phys.balls[0]; b.x=0.24; b.y=0.5; b.vx=0; b.vy=1.5;'), 'rotor'),
  'rotor-close': () => run('rotor-close', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.05, 0.5, 0.36); r.camPlay.tgt.set(-0.05, 0.05, -0.1); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'rotor'),
  'rotor-back': () => run('rotor-back', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 0.5, 0.1); r.camPlay.tgt.set(0, 0.18, -0.56); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'rotor'),
  'desk-shriek': () => run('desk-shriek', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.1, 0.42, 0.28); r.camPlay.tgt.set(-0.1, 0.07, -0.1); r.camMix = 1; }); await p.waitForTimeout(1800); await p.evaluate(() => { window.__rg.renderer.roxyShriek(true); }); await p.waitForTimeout(260); }),
  'rotor-lift': () => run('rotor-lift', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); window.__rg.game.multiball = true; r.camPlay.pos.set(0.0, 0.62, 0.42); r.camPlay.tgt.set(0, 0.06, -0.14); r.camMix = 1; }); await p.waitForTimeout(5000); console.log('lift', await p.evaluate(() => window.__rg.renderer.parts.heli.lift.toFixed(2))); }, 'rotor'),
  'rotor-pad': () => run('rotor-pad', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.12, 0.42, 0.02); r.camPlay.tgt.set(-0.13, 0.06, -0.38); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'rotor'),
  'rotor-tunnel': () => run('rotor-tunnel', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 0.36, 0.52); r.camPlay.tgt.set(-0.02, 0.0, 0.14); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'rotor'),
  'rotor-right': () => run('rotor-right', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0.12, 0.42, 0.1); r.camPlay.tgt.set(0.13, 0.05, -0.28); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'rotor'),
  'rotor-lock': () => run('rotor-lock', desk, async (p) => {
    await p.evaluate(() => { const { game, renderer: r } = window.__rg; window.__rg.startGame(); r.camPlay.pos.set(-0.12, 0.40, 0.0); r.camPlay.tgt.set(-0.13, 0.06, -0.38); r.camMix = 1;
      for (let k = 0; k < 2; k++) { game.lockLit = true; const b = game.phys.addBall(200, 600); game.phys.sendToRail(b, 'huey', 1.6); for (let i = 0; i < 400; i++) game.update(1 / 120); } });
    await p.waitForTimeout(2500); }, 'rotor'),
  'rotor-tunnelball': () => run('rotor-tunnelball', desk, async (p) => {
    await p.evaluate(() => { const { game, renderer: r } = window.__rg; window.__rg.startGame(); r.camPlay.pos.set(0, 0.34, 0.5); r.camPlay.tgt.set(-0.02, 0.0, 0.16); r.camMix = 1;
      const b = game.phys.addBall(224, 384); b.level = 0; });
    await p.waitForTimeout(2200); }, 'rotor'),
  'rotor-flip': () => run('rotor-flip', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0.12, 0.42, 0.1); r.camPlay.tgt.set(0.13, 0.05, -0.28); r.camMix = 1; window.__rg.game.flipper('R', true); }); await p.waitForTimeout(2200); }, 'rotor'),
  'riff-stage': () => run('riff-stage', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 0.62, 0.3); r.camPlay.tgt.set(0, 0.04, -0.3); r.camMix = 1; r.trussShow(0, 10); }); await p.waitForTimeout(2600); }),
  'riff-left': () => run('riff-left', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.12, 0.36, 0.2); r.camPlay.tgt.set(-0.13, 0.03, -0.27); r.camMix = 1; r.micBash(); }); await p.waitForTimeout(1500); }),
  'riff-right': () => run('riff-right', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0.12, 0.4, 0.12); r.camPlay.tgt.set(0.13, 0.05, -0.36); r.camMix = 1; window.__rg.game.flipper('R', true); }); await p.waitForTimeout(2200); }),
  'view-flat': () => run('view-flat', desk, (p) => p.evaluate(() => { window.__rg.renderer.setView('flat'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'phone-view-flat': () => run('phone-view-flat', phone, (p) => p.evaluate(() => { window.__rg.renderer.setView('flat'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'view-close': () => run('view-close', desk, (p) => p.evaluate(() => { window.__rg.renderer.setView('close'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'phone-view-close': () => run('phone-view-close', phone, (p) => p.evaluate(() => { window.__rg.renderer.setView('close'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'view-top': () => run('view-top', desk, (p) => p.evaluate(() => { window.__rg.renderer.setView('top'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'phone-view-top': () => run('phone-view-top', phone, (p) => p.evaluate(() => { window.__rg.renderer.setView('top'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;'))),
  'view-player': () => run('view-player', desk, (p) => play(p, 3, 'rg.renderer.camMix = 1;')),
  'phone-view-player': () => run('phone-view-player', phone, (p) => play(p, 3, 'rg.renderer.camMix = 1;')),
  'land-view-player': () => run('land-view-player', { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, (p) => play(p, 3, 'rg.renderer.camMix = 1;')),
  'alien-start': () => run('alien-start', desk, async () => {}, 'alien'),
  'alien-play': () => run('alien-play', desk, (p) => play(p, 3, 'rg.renderer.camMix = 1;'), 'alien'),
  'alien-phone-start': () => run('alien-phone-start', phone, async () => {}, 'alien'),
  'alien-phone-play': () => run('alien-phone-play', phone, (p) => play(p, 3, 'rg.renderer.camMix = 1;'), 'alien'),
  'alien-std': () => run('alien-std', desk, (p) => p.evaluate(() => { window.__rg.renderer.setView('std'); }).then(() => play(p, 3, 'rg.renderer.camMix = 1;')), 'alien'),
  'alien-close': () => run('alien-close', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0.08, 0.42, 0.25); r.camPlay.tgt.set(0.06, 0.06, -0.2); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'alien'),
  'alien-back': () => run('alien-back', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 0.45, 0.15); r.camPlay.tgt.set(0, 0.16, -0.5); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'alien'),
  'alien-left': () => run('alien-left', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(-0.13, 0.4, 0.1); r.camPlay.tgt.set(-0.12, 0.04, -0.35); r.camMix = 1; }); await p.waitForTimeout(2500); }, 'alien'),
  'phone-credits': () => run('phone-credits', phone, async (p) => { await p.evaluate(() => { window.__rg.store.data.credits = 0; document.getElementById('lang-de').click(); window.__rg.requestStart(); }); await p.waitForTimeout(2500); }),
  'phone-credits-low': () => run('phone-credits-low', phone, async (p) => { await p.evaluate(() => { window.__rg.store.data.credits = 3; window.__rg.show('start'); document.getElementById('lang-de').click(); }); await p.waitForTimeout(500); }),
  'phone-imprint': () => run('phone-imprint', phone, async (p) => { await p.evaluate(() => { document.getElementById('lang-de').click(); document.getElementById('btn-imprint').click(); }); await p.waitForTimeout(2500); }),
  'phone-brand': () => run('phone-brand', phone, async (p) => { await p.evaluate(() => { document.getElementById('lang-de').click(); const pl = document.querySelector('#screen-start .plate'); pl.scrollTop = 9999; }); await p.waitForTimeout(1500); }),
  'desk-back': () => run('desk-back', desk, async (p) => { await p.evaluate(() => { const r = window.__rg.renderer; window.__rg.startGame(); r.camPlay.pos.set(0, 0.5, 0.1); r.camPlay.tgt.set(0, 0.18, -0.56); r.camMix = 1; }); await p.waitForTimeout(2500); }),
};
for (const k of want) { if (S[k]) { const t0 = Date.now(); await S[k](); console.log(k, ((Date.now() - t0) / 1000).toFixed(1) + 's'); } }
await browser.close();
srv.kill();
console.log(logs.slice(0, 20).join('\n') || 'no console errors');
