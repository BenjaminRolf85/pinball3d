// End-to-end smoke test in headless Chromium: real clicks, touch/keyboard input, and a bot that
// plays full games through every event path with audio unlocked. Fails on any console/page error.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const port = 8124;
const srv = spawn('node', ['tools/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const TABLE = process.argv[2] || 'riff';
const page = await ctx.newPage();
await page.addInitScript((tb) => { window.name = `rgTable=${tb}`; }, TABLE);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
await page.goto(`http://localhost:${port}/index.html`);
await page.waitForFunction(() => window.__rg, null, { timeout: 90000 });
const check = (name, ok, info = '') => { console.log(ok ? 'PASS' : 'FAIL', name, info); if (!ok) errors.push('check failed: ' + name); };

// language switch
await page.tap('#lang-de');
check('german ui', (await page.textContent('#btn-play')).trim() === 'Spiel starten');
check('table loaded: ' + TABLE, await page.evaluate((tb) => window.__rg.table === tb && document.documentElement.dataset.table === tb, TABLE));
await page.tap('#btn-help'); check('help opens', await page.isVisible('#screen-help'));
check('help has rules', (await page.locator('#help-rules li').count()) === ({ rotor: 9, alien: 8 }[TABLE] || 10));
await page.tap('#btn-help-back');
await page.tap('#btn-play');
await page.waitForTimeout(600);
check('game started', await page.evaluate(() => window.__rg.game.state === 'playing'));
check('audio running', await page.evaluate(() => window.__rg.audio.ctx && window.__rg.audio.ctx.state === 'running'));
// touch: left / right halves
const box = await page.locator('#stage').boundingBox();
const touch = async (x, type) => page.evaluate(([x, y, type]) => {
  const el = document.getElementById('stage');
  el.dispatchEvent(new PointerEvent(type, { pointerId: x < 200 ? 11 : 12, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true }));
}, [x, box.y + box.height * 0.7, type]);
await touch(60, 'pointerdown'); await page.waitForTimeout(120);
check('left flipper by touch', await page.evaluate(() => window.__rg.game.phys.flippers[0].pressed && !window.__rg.game.phys.flippers[1].pressed));
await touch(60, 'pointerup'); await page.waitForTimeout(80);
check('left flipper released', await page.evaluate(() => !window.__rg.game.phys.flippers[0].pressed));
await touch(330, 'pointerdown');
check('plunger held by touch', await page.evaluate(() => window.__rg.game.plunger.held));
const charged = await page.waitForFunction(() => window.__rg.game.plunger.charge > 0.3, null, { timeout: 8000 }).then(() => true, () => false);
check('plunger charging by touch', charged);
await touch(330, 'pointerup'); await page.waitForTimeout(400);
check('ball launched', await page.evaluate(() => window.__rg.game.phys.balls.some((b) => b.vy > 0.5 || b.y > 0.2)));
// pause / resume
await page.tap('#btn-pause'); check('pause screen', await page.isVisible('#screen-pause'));
await page.tap('#btn-resume'); check('resumed', await page.isHidden('#screen-pause'));

// bot: play several accelerated games through the real director (audio + renderer hooks)
const res = await page.evaluate(async () => {
  const { game, renderer, startGame } = window.__rg;
  window.__rgFreeze = true;
  const seen = {};
  game.on((e) => { seen[e.type] = (seen[e.type] || 0) + 1; });
  const hold = { L: 0, R: 0 };
  let games = 0, frames = 0, forced = false;
  const dt = 1 / 120;
  const t0 = performance.now();
  // force the rare paths early in the first game
  game.lockLit = true; game.extraBallLit = true; game.volume = 10; game.volumeProgress = 5;
  if (window.__rg.table !== 'rotor') game.locks = 2;
  game.tunnels = 2; game.ballSaveArmed = false; game.ballSaveUntil = 0;
  if (window.__rg.table === 'alien') game._startWave();
  while (games < 2 && performance.now() - t0 < 200000) {
    for (let k = 0; k < 2400; k++) {
      if (game.state === 'gameover') { games++; startGame(); }
      // slow software rendering: make sure the end of a game is reached within the time budget
      if (!games && !forced && (frames >= 120 * 150 || performance.now() - t0 > 90000) && game.state === 'playing') { forced = true; game.ball = 3; game.extraBalls = 0; game.extraBallLit = false; }
      for (const f of game.phys.flippers) {
        let want = false;
        for (const b of game.phys.balls) {
          if (b.mode !== 'free') continue;
          const rx = (b.x - f.x) * (f.side === -1 ? 1 : -1);
          if (rx < 0.012 || rx > 0.082) continue;
          const gap = b.y - (f.y - rx * 0.577 + 0.025);
          if (gap < Math.max(0, -b.vy) * 0.018 + 0.004 + Math.random() * 0.006 && gap > -0.03) want = true;
        }
        if (want && hold[f.id] <= 0) hold[f.id] = 0.14 + Math.random() * 0.1;
        if (hold[f.id] > 0) hold[f.id] -= dt;
        const press = hold[f.id] > 0.02;
        if (press !== f.pressed) game.flipper(f.id, press);
      }
      if (game.state === 'playing' && game.phys.ballsInShooter() > 0 && !game.phys.balls.some((b) => b.auto)) {
        if (!game.plunger.held) game.plungerDown(); else if (game.plunger.charge > 0.5 + Math.random() * 0.5) game.plungerUp();
      }
      if (Math.random() < 0.0004) game.nudge(0);
      game.update(dt);
      frames++;
      if (frames % 40 === 0) renderer.frame(dt * 40, game);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { games, simSeconds: Math.round(frames * dt), seen, score: game.score };
});
console.log(`bot: ${res.games} games, ${res.simSeconds}s simulated`);
console.log(Object.entries(res.seen).filter(([k]) => !['score', 'lamps', 'wall', 'post', 'flipperUp', 'flipperDown', 'flipperHit', 'spinTick', 'msg'].includes(k)).map(([k, v]) => `${k}:${v}`).join(' '));
const must = TABLE === 'alien' ? ['bumper', 'sling', 'dropTarget', 'scoopEnter', 'robotBash', 'waveStart', 'drain', 'bonus', 'gameOver', 'standup'] : TABLE === 'rotor' ? ['bumper', 'sling', 'dropTarget', 'scoopEnter', 'rampDone', 'missionStart', 'lock', 'drain', 'bonus', 'gameOver'] : ['bumper', 'sling', 'dropTarget', 'skullEat', 'multiballStart', 'rampDone', 'drain', 'bonus', 'gameOver', 'extraBall', 'ballSaved', 'tunnel', 'kickback', 'standup'];
for (const k of must) check('event ' + k, !!res.seen[k]);
await page.waitForTimeout(500);
await browser.close();
srv.kill();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
process.exit(errors.length ? 1 : 0);
