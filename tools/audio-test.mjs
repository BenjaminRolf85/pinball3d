// Offline verification of the sound engine.
// Renders every music state and every sfx through an OfflineAudioContext in
// headless Chromium, measures levels, and writes WAV previews.
//
//   node tools/audio-test.mjs [output-dir]
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is installed globally in the build environment; require() finds it.
const { chromium } = createRequire(import.meta.url)('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] || join(root, 'build', 'audio-preview'));
mkdirSync(outDir, { recursive: true });

const bundle = buildSync({
  entryPoints: [join(root, 'src/audio.js')],
  bundle: true,
  format: 'iife',
  globalName: 'RG',
  write: false,
}).outputFiles[0].text;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: bundle });

const result = await page.evaluate(async () => {
  const SR = 44100;
  const TEMPO = { attract: 66, play: 152, multiball: 184, gameover: 84 };
  const ROTOR_TEMPO = { attract: 60, play: 126, multiball: 150, gameover: 72 };
  const ALIEN_TEMPO = { attract: 64, play: 138, multiball: 168, gameover: 76 };
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

  async function render(dur, setup, mix) {
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
    const audio = RG.createAudio({ context: ctx, mix });
    audio.unlock();
    setup(audio, ctx);
    return ctx.startRendering();
  }

  function stats(buf) {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let peak = 0, sum = 0, nan = false, hot = 0;
    const win = Math.floor(SR * 0.05);
    let wsum = 0, wmax = 0;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], b = R[i];
      if (!(a === a) || !(b === b)) nan = true;
      const m = Math.max(Math.abs(a), Math.abs(b));
      if (m > peak) peak = m;
      if (m > 0.9) hot++;
      const e = (a * a + b * b) / 2;
      sum += e;
      wsum += e;
      if ((i + 1) % win === 0) {
        if (wsum > wmax) wmax = wsum;
        wsum = 0;
      }
    }
    return {
      nan,
      peak,
      peakDb: db(peak),
      rmsDb: db(Math.sqrt(sum / L.length)),
      loudDb: db(Math.sqrt(wmax / win)), // loudest 50 ms window
      hotPct: (100 * hot) / L.length,
    };
  }

  function wavBase64(buf) {
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const n = L.length;
    const bytes = new Uint8Array(44 + n * 4);
    const dv = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true);
    dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(bin);
  }

  const out = { music: {}, sfx: {}, wav: {}, extra: {} };

  // --- pre-unlock safety: nothing may throw
  try {
    const a = RG.createAudio();
    a.setMusic('play'); a.sfx('bumper', { index: 1 }); a.setRoll(0.5); a.setMusicVolume(0.5);
    a.setSfxVolume(0.5); a.setMuted(true); a.suspend(); a.resume(); a.scheduleRange(0, 1);
    a.sfx('doesNotExist'); a.onBeat(() => {})();
    a.setTheme('rotor'); a.setTheme('nope'); a.setRotor(0.5); a.sfx('shriek', { big: true }); a.sfx('radio');
    a.setTheme('alien'); a.setAmbience('invasion', 0.5); a.sfx('tractor'); a.setAmbience(null);
    out.extra.preUnlock = a.ctx === null ? 'ok' : 'ctx created too early';
  } catch (e) {
    out.extra.preUnlock = 'THREW ' + e.message;
  }

  // --- music states, 8 bars each
  for (const state of ['attract', 'play', 'multiball', 'gameover']) {
    const dur = (8 * 4 * 60) / TEMPO[state] + 0.6;
    const buf = await render(dur, (a) => { a.setMusic(state); a.scheduleRange(0, dur); });
    out.music[state] = { dur, ...stats(buf) };
    if (state === 'play' || state === 'multiball') out.wav[state] = wavBase64(buf);
  }

  // --- stems of the two groove states (which instrument carries the mix)
  out.stems = {};
  for (const state of ['play', 'multiball']) {
    const dur = (4 * 4 * 60) / TEMPO[state];
    out.stems[state] = {};
    for (const [label, mix] of [['bass', { gtr: 0, drums: 0 }], ['guitar', { bass: 0, drums: 0 }], ['drums', { gtr: 0, bass: 0 }]]) {
      const buf = await render(dur, (a) => { a.setMusic(state); a.scheduleRange(0, dur); }, mix);
      out.stems[state][label] = stats(buf).rmsDb;
    }
  }

  // --- ROTORSTURM music, 8 bars each
  out.rotorMusic = {};
  for (const state of ['attract', 'play', 'multiball', 'gameover']) {
    const dur = (8 * 4 * 60) / ROTOR_TEMPO[state] + (state === 'gameover' ? 5 : 0.6);
    const buf = await render(dur, (a) => { a.setTheme('rotor'); a.setMusic(state); a.scheduleRange(0, dur); });
    out.rotorMusic[state] = { dur, ...stats(buf) };
    if (state !== 'gameover') out.wav[`rotor_${state}`] = wavBase64(buf);
  }
  out.rotorStems = {};
  for (const state of ['play', 'multiball']) {
    const dur = (4 * 4 * 60) / ROTOR_TEMPO[state];
    out.rotorStems[state] = {};
    for (const [label, mix] of [['bass', { gtr: 0, drums: 0 }], ['guitar', { bass: 0, drums: 0 }], ['drums', { gtr: 0, bass: 0 }]]) {
      const buf = await render(dur, (a) => { a.setTheme('rotor'); a.setMusic(state); a.scheduleRange(0, dur); }, mix);
      out.rotorStems[state][label] = stats(buf).rmsDb;
    }
  }

  // --- ERDABWEHR music, 8 bars each, and stems
  out.alienMusic = {};
  for (const state of ['attract', 'play', 'multiball', 'gameover']) {
    const dur = (8 * 4 * 60) / ALIEN_TEMPO[state] + (state === 'gameover' ? 5 : 0.6);
    const buf = await render(dur, (a) => { a.setTheme('alien'); a.setMusic(state); a.scheduleRange(0, dur); });
    out.alienMusic[state] = { dur, ...stats(buf) };
    out.wav[`alien_${state}`] = wavBase64(buf);
  }
  out.alienStems = {};
  for (const state of ['play', 'multiball']) {
    const dur = (4 * 4 * 60) / ALIEN_TEMPO[state];
    out.alienStems[state] = {};
    for (const [label, mix] of [['bass', { gtr: 0, drums: 0 }], ['synth', { bass: 0, drums: 0 }], ['drums', { gtr: 0, bass: 0 }]]) {
      const buf = await render(dur, (a) => { a.setTheme('alien'); a.setMusic(state); a.scheduleRange(0, dur); }, mix);
      out.alienStems[state][label] = stats(buf).rmsDb;
    }
  }
  {
    let themeAfter = null, themeMid = null;
    const buf = await render(8, (a) => {
      a.setTheme('rotor'); a.setMusic('play'); a.scheduleRange(0, 2.0);
      a.setTheme('alien'); themeMid = a.theme; a.scheduleRange(2.0, 5);
      a.setMusic('multiball'); a.scheduleRange(5, 8);
      themeAfter = a.theme;
    });
    out.extra.alienSwitch = { ...stats(buf), themeMid, themeAfter };
  }

  // --- theme switch during play lands on a bar line, riff -> rotor
  {
    let themeAfter = null, themeMid = null;
    const buf = await render(8, (a) => {
      a.setMusic('play'); a.scheduleRange(0, 2.0);
      a.setTheme('rotor'); themeMid = a.theme; a.scheduleRange(2.0, 8);
      themeAfter = a.theme;
    });
    out.extra.themeSwitch = { ...stats(buf), themeMid, themeAfter };
  }

  // --- helicopter loop: blade rate from the envelope's autocorrelation
  function bladeRate(buf, from) {
    const L = buf.getChannelData(0);
    const hop = Math.floor(SR * 0.005);
    const env = [];
    for (let i = Math.floor(from * SR); i + hop < L.length; i += hop) {
      let e = 0;
      for (let k = 0; k < hop; k++) e += L[i + k] * L[i + k];
      env.push(Math.sqrt(e / hop));
    }
    const mean = env.reduce((x, y) => x + y, 0) / env.length;
    const v = env.map((x) => x - mean);
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(0.1 / 0.005); lag <= Math.floor(0.4 / 0.005); lag++) {
      let c = 0;
      for (let i = 0; i + lag < v.length; i++) c += v[i] * v[i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    return bestLag ? 1 / (bestLag * 0.005) : 0;
  }
  out.rotor = {};
  for (const lvl of [0.3, 1.0]) {
    const buf = await render(4, (a) => { a.setRotor(lvl); });
    out.rotor[lvl] = { ...stats(buf), rate: bladeRate(buf, 1.5) };
  }
  {
    // spool up, cruise, wind down: 0 -> 0.3 -> 1.0 -> 0 (automation set up front, offline)
    const ctx = new OfflineAudioContext(2, SR * 10, SR);
    const a = RG.createAudio({ context: ctx });
    a.unlock();
    a.setRotor(0.3);
    const steps = [[3, 1.0], [7, 0]];
    for (const [at, lvl] of steps) ctx.suspend(at).then(() => { a.setRotor(lvl); ctx.resume(); });
    const buf = await ctx.startRendering();
    out.extra.rotorLoop = stats(buf);
    out.wav.rotor_loop = wavBase64(buf);
  }

  // --- every sfx on its own
  const names = RG.SFX_NAMES;
  for (const name of names) {
    const longer = { robotDown: 2.6, mothershipHit: 3.2, invasionAlarm: 4.6, tankShot: 2.2, multiballStart: 3.5, liftoff: 3.2, monsoon: 3.2, airstrike: 4.8, alarm: 3.6, barrage: 3.8, jet: 3.3, heliFlyby: 3.9, incoming: 3.1, mortar: 2.9, artillery: 2.9, bugle: 2.6 };
    const dur = longer[name] || 2.5;
    const buf = await render(dur, (a) => { a.sfx(name, { index: 1, velocity: 0.8, speed: 0.6, power: 0.9 }); });
    out.sfx[name] = stats(buf);
  }

  // --- medley of all sfx, 1.4 s apart (longer after the big ones)
  {
    const long = { invasionAlarm: 3.0, mothershipHit: 3.0, robotDown: 2.3, tankShot: 1.9, ufoPass: 1.7, tractor: 1.8, multiballStart: 3.2, superJackpot: 2.6, thunder: 2.8, gameStart: 2.2, gameOver: 2.8, highScore: 2.2, drain: 2.0, bankComplete: 1.6, tilt: 1.6, liftoff: 2.6, monsoon: 2.9, cheer: 1.8 };
    let total = 0.2;
    const plan = names.map((n) => { const at = total; total += long[n] || 1.2; return [n, at]; });
    const buf = await render(total + 0.5, (a) => {
      for (const [n, at] of plan) a.sfx(n, { when: at, index: 0, velocity: 0.8, speed: 0.6, power: 0.9 });
    });
    out.extra.medley = stats(buf);
    out.wav.sfx_medley = wavBase64(buf);
  }

  // --- laughter: three calls in a row (the middle one big), over nothing and over the music
  {
    const plan = (a) => { a.sfx('laugh', { when: 0.2 }); a.sfx('laugh', { when: 1.6, big: true }); a.sfx('laugh', { when: 3.9 }); };
    const buf = await render(5.4, plan);
    out.extra.laugh3 = stats(buf);
    out.wav.laugh = wavBase64(buf);
    const mixed = await render(5.4, (a) => { a.setMusic('play'); a.scheduleRange(0, 5.4); plan(a); a.sfx('kickback', { when: 3.2 }); a.sfx('cheer', { when: 1.0 }); });
    out.extra.laughOverMusic = stats(mixed);
    out.wav.laugh_over_music = wavBase64(mixed);
    // rate limit: a second laugh 0.5 s later must be refused
    let second = null;
    await render(1, (a) => { a.sfx('laugh', { when: 0.1 }); second = a.sfx('laugh', { when: 0.6 }); });
    out.extra.laughRateLimited = second === false;
    const big = await render(2.5, (a) => { a.sfx('laugh', { big: true }); });
    out.extra.laughBig = stats(big);
  }

  // --- shriek: normal then big, solo and over the music; rate limit
  {
    const plan = (a) => { a.sfx('shriek', { when: 0.2 }); a.sfx('shriek', { when: 1.7, big: true }); };
    const buf = await render(3.6, plan);
    out.extra.shriek2 = stats(buf);
    out.wav.shriek = wavBase64(buf);
    out.extra.shriekSolo = stats(await render(1.6, (a) => { a.sfx('shriek'); }));
    out.extra.shriekBig = stats(await render(2.0, (a) => { a.sfx('shriek', { big: true }); }));
    const mixed = await render(3.6, (a) => { a.setMusic('play'); a.scheduleRange(0, 3.6); plan(a); });
    out.extra.shriekOverMusic = stats(mixed);
    out.wav.shriek_over_music = wavBase64(mixed);
    let second = null;
    await render(1, (a) => { a.sfx('shriek', { when: 0.1 }); second = a.sfx('shriek', { when: 0.6 }); });
    out.extra.shriekRateLimited = second === false;
  }

  // --- ROTORSTURM sfx: solo medley, and in context (rotor music + helicopter loop)
  {
    const plan = [['radio', 0.2], ['winch', 1.5], ['smoke', 2.6], ['liftoff', 4.2], ['monsoon', 7.0], ['radio', 10.0]];
    const buf = await render(11.4, (a) => { for (const [n, at] of plan) a.sfx(n, { when: at }); });
    out.extra.rotorMedley = stats(buf);
    out.wav.rotor_sfx = wavBase64(buf);
    const mix = await render(11.4, (a) => {
      a.setTheme('rotor'); a.setMusic('play'); a.scheduleRange(0, 11.4); a.setRotor(0.5);
      for (const [n, at] of plan) a.sfx(n, { when: at });
    });
    out.extra.rotorMix = stats(mix);
    out.wav.rotor_mix = wavBase64(mix);
    let second = null;
    await render(1, (a) => { a.sfx('radio', { when: 0.1 }); second = a.sfx('radio', { when: 0.6 }); });
    out.extra.radioRateLimited = second === false;
  }

  // --- ROTORSTURM combat sounds: variants, a medley of all of them, ambience, stress
  {
    const COMBAT = ['gunshot', 'burst', 'mg', 'ricochet', 'bolt', 'casings', 'mortar', 'incoming', 'explosion', 'artillery', 'barrage', 'jet', 'airstrike', 'heliFlyby', 'bugle', 'tunnelShot', 'dirt', 'dogtags', 'alarm'];
    out.combat = {};
    out.combat['gunshot far (0.9)'] = stats(await render(1.2, (a) => { a.sfx('gunshot', { distance: 0.9 }); }));
    out.combat['mg len 2.5'] = stats(await render(3.4, (a) => { a.sfx('mg', { len: 2.5 }); }));
    out.combat['explosion size 0.3'] = stats(await render(1.8, (a) => { a.sfx('explosion', { size: 0.3 }); }));
    out.combat['explosion size 1.0'] = stats(await render(2.8, (a) => { a.sfx('explosion', { size: 1.0 }); }));
    // gunshot rate limit: a second shot 30 ms later is refused, 60 ms later accepted
    let r30 = null, r60 = null;
    await render(0.5, (a) => { a.sfx('gunshot', { when: 0.1 }); r30 = a.sfx('gunshot', { when: 0.13 }); r60 = a.sfx('gunshot', { when: 0.19 }); });
    out.extra.gunshotRate = r30 === false && r60 === true;
    const gap = { alarm: 3.6, mg: 1.9, mortar: 2.8, incoming: 3.1, explosion: 2.3, artillery: 2.8, barrage: 3.7, jet: 3.3, airstrike: 4.7, heliFlyby: 3.8, bugle: 2.6, burst: 1.0, ricochet: 1.1, casings: 1.0, dirt: 1.4 };
    let total = 0.2;
    const plan = COMBAT.map((n) => { const at = total; total += gap[n] || 0.8; return [n, at]; });
    const med = await render(total + 0.4, (a) => { for (const [n, at] of plan) a.sfx(n, { when: at }); });
    out.extra.combatMedley = stats(med);
    out.wav.combat_medley = wavBase64(med);
    // jungle ambience, 20 s at full level, alone and with the rotor music for comparison
    const amb = await render(20, (a) => { a.setAmbience('jungle', 1); a.scheduleRange(0, 20); });
    out.extra.ambience = stats(amb);
    out.wav.ambience_jungle = wavBase64(amb);
    const before = await render(4, (a) => { a.setAmbience('jungle', 0.6); }); // set before unlock-time scheduling
    out.extra.ambiencePre = stats(before);
    // alarm loop: on alone, no stacking when called twice, and switched off at 3 s (fades within 0.5 s)
    const segRms = (buf, t0, t1) => {
      const L = buf.getChannelData(0), a0 = Math.floor(t0 * SR), a1 = Math.min(L.length, Math.floor(t1 * SR));
      let e = 0; for (let i = a0; i < a1; i++) e += L[i] * L[i];
      return db(Math.sqrt(e / Math.max(1, a1 - a0)));
    };
    const loop1 = await render(6, (a) => { a.alarmLoop(true); });
    const loop2 = await render(6, (a) => { a.alarmLoop(true); a.alarmLoop(true); });
    const loopOff = await render(5, (a, ctx) => { a.alarmLoop(true); ctx.suspend(3).then(() => { a.alarmLoop(false); ctx.resume(); }); });
    const preUnlockLoop = (() => { const x = RG.createAudio(); x.alarmLoop(true); x.alarmLoop(false); return 'ok'; })();
    out.extra.alarmLoop = { ...stats(loop1), rms1: segRms(loop1, 1, 6), rms2: segRms(loop2, 1, 6), on: segRms(loopOff, 1.5, 3), after: segRms(loopOff, 3.55, 5), preUnlockLoop };
    out.wav.alarm_loop = wavBase64(loopOff);
    // stress: rotor music + 3 s of machine gun + 10 gunshots + 2 explosions + an airstrike within 4 s
    let acc = 0;
    const st = await render(6, (a) => {
      a.setTheme('rotor'); a.setMusic('play'); a.scheduleRange(0, 6); a.setRotor(0.6);
      a.sfx('mg', { when: 0.2, len: 3 });
      for (let i = 0; i < 10; i++) if (a.sfx('gunshot', { when: 0.3 + i * 0.33 })) acc++;
      a.sfx('explosion', { when: 0.8, size: 0.9 }); a.sfx('explosion', { when: 2.6, size: 1.0 });
      a.sfx('airstrike', { when: 0.5 });
    });
    out.extra.combatStress = { ...stats(st), acc };
    out.wav.combat_stress = wavBase64(st);
  }

  // --- ERDABWEHR: sfx medley solo and in context, invasion ambience, ambience switching
  {
    const segRms = (buf, t0, t1) => {
      const L = buf.getChannelData(0), a0 = Math.floor(t0 * SR), a1 = Math.min(L.length, Math.floor(t1 * SR));
      let e = 0; for (let i = a0; i < a1; i++) e += L[i] * L[i];
      return db(Math.sqrt(e / Math.max(1, a1 - a0)));
    };
    const ALIEN_SFX = ['laser', 'laserBig', 'rayGun', 'ufoPass', 'tractor', 'abduct', 'release', 'robotStep', 'robotLaser', 'robotDown', 'tankShot', 'turret', 'alienScreech', 'alienChatter', 'shield', 'invasionAlarm', 'mothershipHit', 'powerUp', 'teleport'];
    const gap = { laserBig: 1.2, ufoPass: 1.8, tractor: 1.9, robotLaser: 1.3, robotDown: 2.3, tankShot: 1.9, invasionAlarm: 3.0, mothershipHit: 3.0, release: 1.0, teleport: 1.0, alienScreech: 1.0, alienChatter: 1.0 };
    let total = 0.2;
    const plan = ALIEN_SFX.map((n) => { const at = total; total += gap[n] || 0.8; return [n, at]; });
    const med = await render(total + 0.5, (a) => { for (const [n, at] of plan) a.sfx(n, { when: at }); });
    out.extra.alienMedley = stats(med);
    out.wav.alien_sfx = wavBase64(med);
    const ctxMix = await render(total + 0.5, (a) => {
      a.setTheme('alien'); a.setMusic('play'); a.setAmbience('invasion', 0.45); a.scheduleRange(0, total + 0.5);
      for (const [n, at] of plan) a.sfx(n, { when: at });
    });
    out.extra.alienMix = stats(ctxMix);
    out.wav.alien_mix = wavBase64(ctxMix);
    // laser spam (rate limit 40 ms) + shields + robot steps over multiball
    let acc = 0;
    const st = await render(5, (a) => {
      a.setTheme('alien'); a.setMusic('multiball'); a.scheduleRange(0, 5);
      for (let t = 0.2; t < 4.5; t += 0.02) if (a.sfx('laser', { when: t })) acc++;
      for (let t = 0.3; t < 4.5; t += 0.25) a.sfx('shield', { when: t });
      for (let t = 0.1; t < 4.5; t += 0.6) a.sfx('robotStep', { when: t });
      a.sfx('tankShot', { when: 1 }); a.sfx('mothershipHit', { when: 2 }); a.sfx('robotLaser', { when: 2.5 });
    });
    out.extra.alienStress = { ...stats(st), acc };
    out.wav.alien_stress = wavBase64(st);
    // invasion ambience, 30 s full level (events scheduled ahead like the realtime ticker)
    const inv = await render(30, (a) => { a.setAmbience('invasion', 1); a.scheduleRange(0, 30); });
    out.extra.invasion = stats(inv);
    out.wav.ambience_invasion = wavBase64(inv);
    // switching: invasion (0-6 s) -> jungle (6-12 s) -> invasion (12-18 s) -> off (18 s)
    const sw = await render(24, (a, ctx) => {
      a.setAmbience('invasion', 1);
      for (let k = 0; k < 24; k++) {
        ctx.suspend(k + 0.5).then(() => {
          if (k === 6) a.setAmbience('jungle', 1);
          if (k === 12) a.setAmbience('invasion', 1);
          if (k === 18) a.setAmbience(null);
          a.scheduleRange(k + 0.5, k + 1.5);
          ctx.resume();
        });
      }
      a.scheduleRange(0, 0.5);
    });
    out.extra.ambSwitch = { ...stats(sw), inv1: segRms(sw, 3, 6.5), jungle: segRms(sw, 10, 12.5), inv2: segRms(sw, 16, 18.5), off: segRms(sw, 22, 24) };
    out.wav.ambience_switch = wavBase64(sw);
  }

  // --- stress: multiball music, three balls hammering the bumpers, jackpots
  {
    const dur = 6;
    let accepted = 0, tried = 0;
    const buf = await render(dur, (a) => {
      a.setMusic('multiball'); a.scheduleRange(0, dur);
      for (let t = 0.3; t < 5; t += 0.013) {
        tried++;
        if (a.sfx('bumper', { when: t, index: tried % 3 })) accepted++;
        a.sfx('wallHit', { when: t + 0.004, velocity: 0.9 });
        a.sfx('spinner', { when: t + 0.008, speed: 0.9 });
        a.sfx('sling', { when: t + 0.002 });
      }
      a.sfx('jackpot', { when: 1 }); a.sfx('superJackpot', { when: 2.5 }); a.sfx('multiballStart', { when: 0.3 });
      a.setRoll(1);
    });
    out.extra.stress = { ...stats(buf), tried, accepted };
    out.wav.stress = wavBase64(buf);
  }

  // --- state switching offline: play -> multiball must land on a bar line
  {
    const dur = 8;
    const buf = await render(dur, (a) => {
      a.setMusic('play'); a.scheduleRange(0, 2.0);
      a.setMusic('multiball'); a.scheduleRange(2.0, dur);
    });
    out.extra.switch = stats(buf);
  }

  // --- realtime path, rotor theme
  try {
    const a = RG.createAudio();
    const beats = {};
    a.onBeat((e) => { beats[e.type] = (beats[e.type] || 0) + 1; });
    a.setTheme('rotor');
    a.unlock();
    a.setMusic('play');
    a.setRotor(0.6);
    await new Promise((r) => setTimeout(r, 2000));
    a.setMusic('off');
    a.setRotor(0);
    a.suspend();
    out.extra.realtimeRotor = { beats, theme: a.theme };
  } catch (e) {
    out.extra.realtimeRotor = { error: e.message };
  }

  // --- realtime path: scheduler + onBeat callbacks with a live AudioContext
  try {
    const a = RG.createAudio();
    const beats = {};
    a.onBeat((e) => { beats[e.type] = (beats[e.type] || 0) + 1; });
    a.unlock();
    a.setMusic('play');
    await new Promise((r) => setTimeout(r, 2500));
    const running = a.ctx && a.ctx.state;
    a.setMusic('off');
    a.suspend();
    out.extra.realtime = { state: running, beats };
  } catch (e) {
    out.extra.realtime = { error: e.message };
  }
  return out;
});

await browser.close();

// ---- report -----------------------------------------------------------------
const f = (v) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '  -inf');
let failed = 0;
function check(label, s, minLoudDb = -45) {
  const problems = [];
  if (s.nan) problems.push('NaN');
  if (!(s.peak <= 1.0)) problems.push('CLIP');
  if (!(s.loudDb > minLoudDb)) problems.push('SILENT');
  if (problems.length) failed++;
  console.log(
    `${label.padEnd(22)} peak ${f(s.peakDb)} dB  rms ${f(s.rmsDb)} dB  loudest50ms ${f(s.loudDb)} dB  >0.9: ${s.hotPct.toFixed(2)}%  ${problems.length ? 'FAIL ' + problems.join(',') : 'ok'}`,
  );
}

console.log('pre-unlock safety:', result.extra.preUnlock);
if (result.extra.preUnlock !== 'ok') failed++;
console.log('\n== music (8 bars each) ==');
for (const [k, s] of Object.entries(result.music)) {
  check(k, s);
  if (!(s.rmsDb > -45)) { failed++; console.log('  FAIL overall RMS below -45 dBFS'); }
}
console.log('\n== stems, RMS dB (4 bars) ==');
for (const [k, st] of Object.entries(result.stems)) console.log(`${k.padEnd(10)} bass ${f(st.bass)}  guitar ${f(st.guitar)}  drums ${f(st.drums)}`);
console.log('\n== ROTORSTURM music (8 bars each) ==');
for (const [k, s] of Object.entries(result.rotorMusic)) {
  check('rotor ' + k, s);
  if (!(s.rmsDb > -45)) { failed++; console.log('  FAIL overall RMS below -45 dBFS'); }
}
console.log('\n== ROTORSTURM stems, RMS dB (4 bars) ==');
for (const [k, st] of Object.entries(result.rotorStems)) console.log(`${k.padEnd(10)} bass ${f(st.bass)}  guitar ${f(st.guitar)}  drums ${f(st.drums)}`);
console.log('\n== ERDABWEHR music (8 bars each) ==');
for (const [k, s] of Object.entries(result.alienMusic)) {
  check('alien ' + k, s);
  if (!(s.rmsDb > -45)) { failed++; console.log('  FAIL overall RMS below -45 dBFS'); }
}
console.log('\n== ERDABWEHR stems, RMS dB (4 bars) ==');
for (const [k, st] of Object.entries(result.alienStems)) console.log(`${k.padEnd(10)} bass ${f(st.bass)}  synth ${f(st.synth)}  drums ${f(st.drums)}`);
check('rotor -> alien switch', result.extra.alienSwitch);
console.log(`  theme pending mid-bar: ${result.extra.alienSwitch.themeMid}, after: ${result.extra.alienSwitch.themeAfter}`);
if (result.extra.alienSwitch.themeAfter !== 'alien') { failed++; console.log('  FAIL theme did not switch'); }
check('alien sfx medley', result.extra.alienMedley);
check('alien sfx+music+amb', result.extra.alienMix);
check('alien stress', result.extra.alienStress);
console.log(`  lasers accepted (every 20 ms, gap 40 ms): ${result.extra.alienStress.acc}`);
check('invasion ambience 30s', result.extra.invasion);
console.log(`  invasion RMS ${result.extra.invasion.rmsDb.toFixed(1)} dB vs alien play music ${result.alienMusic.play.rmsDb.toFixed(1)} dB`);
if (!(result.extra.invasion.rmsDb < result.alienMusic.play.rmsDb - 6)) { failed++; console.log('  FAIL invasion ambience not clearly below the music'); }
const sw = result.extra.ambSwitch;
check('ambience switching', sw);
console.log(`  invasion ${sw.inv1.toFixed(1)} dB, jungle ${sw.jungle.toFixed(1)} dB, invasion again ${sw.inv2.toFixed(1)} dB, off ${sw.off.toFixed(1)} dB`);
if (!(sw.off < Math.min(sw.inv1, sw.jungle, sw.inv2) - 40)) { failed++; console.log('  FAIL ambience did not stop'); }
check('theme riff -> rotor', result.extra.themeSwitch);
const ts = result.extra.themeSwitch;
console.log(`  theme pending mid-bar: ${ts.themeMid}, after: ${ts.themeAfter}`);
if (ts.themeAfter !== 'rotor') { failed++; console.log('  FAIL theme did not switch'); }
console.log('\n== helicopter loop ==');
for (const [lvl, s] of Object.entries(result.rotor)) {
  check(`rotor level ${lvl}`, s);
  console.log(`  blade rate ${s.rate.toFixed(2)} Hz`);
}
check('rotor 0 -> .3 -> 1 -> 0', result.extra.rotorLoop);
console.log('\n== sfx (solo) ==');
for (const [k, s] of Object.entries(result.sfx)) check(k, s);
console.log('\n== combined ==');
check('sfx medley', result.extra.medley);
check('laugh x3 (1 big)', result.extra.laugh3);
check('laugh big (solo)', result.extra.laughBig);
check('laugh+cheer on music', result.extra.laughOverMusic);
console.log('  laugh rate limit (0.9 s):', result.extra.laughRateLimited ? 'ok' : 'FAIL');
if (!result.extra.laughRateLimited) failed++;
check('shriek (solo)', result.extra.shriekSolo);
check('shriek big (solo)', result.extra.shriekBig);
check('shriek x2 (1 big)', result.extra.shriek2);
check('shriek on music', result.extra.shriekOverMusic);
console.log('  shriek rate limit (0.9 s):', result.extra.shriekRateLimited ? 'ok' : 'FAIL');
if (!result.extra.shriekRateLimited) failed++;
check('rotor sfx medley', result.extra.rotorMedley);
check('rotor sfx+music+loop', result.extra.rotorMix);
console.log('  radio rate limit (0.8 s):', result.extra.radioRateLimited ? 'ok' : 'FAIL');
if (!result.extra.radioRateLimited) failed++;
console.log('\n== ROTORSTURM combat variants ==');
for (const [k, v] of Object.entries(result.combat)) check(k, v);
console.log('  gunshot rate limit (45 ms):', result.extra.gunshotRate ? 'ok' : 'FAIL');
if (!result.extra.gunshotRate) failed++;
check('combat medley', result.extra.combatMedley);
check('jungle ambience 20 s', result.extra.ambience);
check('ambience 0.6, 4 s', result.extra.ambiencePre, -70);
const playRms = result.rotorMusic.play.rmsDb;
console.log(`  ambience RMS ${result.extra.ambience.rmsDb.toFixed(1)} dB vs rotor play music ${playRms.toFixed(1)} dB`);
if (!(result.extra.ambience.rmsDb < playRms - 3)) { failed++; console.log('  FAIL ambience not clearly below the music'); }
check('combat stress', result.extra.combatStress);
const al = result.extra.alarmLoop;
check('alarm loop (on)', al);
console.log(`  alarm loop RMS ${al.rms1.toFixed(1)} dB, called twice ${al.rms2.toFixed(1)} dB, on ${al.on.toFixed(1)} dB, 0.55 s after off ${al.after.toFixed(1)} dB`);
if (!(Math.abs(al.rms1 - al.rms2) < 1)) { failed++; console.log('  FAIL alarm loop stacks'); }
if (!(al.after < al.on - 30)) { failed++; console.log('  FAIL alarm loop did not fade out'); }
if (al.preUnlockLoop !== 'ok') failed++;

console.log(`  gunshots accepted in stress: ${result.extra.combatStress.acc}/10`);
check('stress (multiball)', result.extra.stress);
console.log(`  bumper sfx accepted ${result.extra.stress.accepted}/${result.extra.stress.tried} (rate limit + voice cap)`);
check('play -> multiball', result.extra.switch);
console.log('\nrealtime scheduler:', JSON.stringify(result.extra.realtime));
console.log('realtime rotor:', JSON.stringify(result.extra.realtimeRotor));
if (!result.extra.realtime.beats || !result.extra.realtime.beats.kick) {
  console.log('  note: no realtime beats observed (headless audio device may be unavailable)');
}

for (const [name, b64] of Object.entries(result.wav)) {
  const p = join(outDir, `${name}.wav`);
  writeFileSync(p, Buffer.from(b64, 'base64'));
  console.log('wrote', p);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
