// RIFFGEWITTER — application shell: boot, input, UI screens, and the "director" that turns
// game events into sound, light and fury.

import { buildLayout } from './layout.js';
import { Game } from './game.js';
import { GameRotor } from './game-rotor.js';
import { buildRotorLayout } from './layout-rotor.js';
import { buildRiffLayout } from './layout-riff.js';
import { buildAlienLayout } from './layout-alien.js';
import { GameAlien } from './game-alien.js';
import { GameRiff } from './game-riff.js';
import { Renderer } from './render.js';
import { DMD } from './dmd.js';
import { createAudio } from './audio.js';
import { createJukebox } from './jukebox.js';
import { t, setLang, getLang, fmtNum, setTable } from './i18n.js';
import { TABLES, tableById } from './tables.js';
import { cssColor } from './playfieldArt.js';
import { drawUSFlag, drawStar } from './art/rotorArt.js';
import { alienFx } from './render-alien.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

// ------------------------------------------------------------------ persistence (per device)
const STORE_KEY = 'riffgewitter.v1';
const store = {
  data: { lang: null, music: true, muted: false, quality: null, scores: [], table: null, scoresByTable: {}, view: 'player', credits: 20 },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch { /* storage unavailable */ } },
  save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ } },
};
store.load();
// scores used to be a single list (only one table existed)
if (store.data.scores && store.data.scores.length && !store.data.scoresByTable.riff) store.data.scoresByTable.riff = store.data.scores;

// ------------------------------------------------------------------ table choice (survives reloads even without storage)
function chosenTable() {
  let id = store.data.table;
  try { const m = /(?:^|;)rgTable=(\w+)/.exec(window.name || ''); if (m) id = m[1]; } catch { /* ignore */ }
  return TABLES[id] ? id : 'riff';
}
const TABLE = tableById(chosenTable());
const AMBIENCE = { rotor: 'jungle', alien: 'invasion' }[TABLE.id] || null;
document.documentElement.dataset.table = TABLE.id;
setTable(TABLE.id);
const scoreList = () => (store.data.scoresByTable[TABLE.id] = store.data.scoresByTable[TABLE.id] || []);

function switchTable(id) {
  if (!TABLES[id] || id === TABLE.id) return;
  store.data.table = id; store.save();
  try { window.name = `rgTable=${id}`; } catch { /* ignore */ }
  jukebox.pause();
  $('loading-text').textContent = t('switching');
  $('loading').hidden = false;
  setTimeout(() => location.reload(), 60);
}

const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
let touchSeen = coarse;

// ------------------------------------------------------------------ language
function initialLang() {
  if (store.data.lang) return store.data.lang;
  const n = (navigator.language || 'de').toLowerCase();
  return n.startsWith('en') ? 'en' : 'de';
}

function dedicationName() {
  try {
    const h = decodeURIComponent((location.hash || '').slice(1)).trim();
    if (/^[\p{L}][\p{L} .'-]{1,23}$/u.test(h) && !/^(settings|sidebar|customize|upgrade|downloads|comment-.*)$/i.test(h)) return h;
  } catch { /* malformed hash */ }
  return null;
}

function applyLang() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  updateCredits();
  document.querySelectorAll('[data-i18n-label]').forEach((el) => { const s = t(el.dataset.i18nLabel); el.setAttribute('aria-label', s); el.title = s; });
  const name = dedicationName();
  $('dedication').textContent = name ? t('dedicationName', { name }) : t('dedication');
  $('help-touch').innerHTML = '';
  for (const s of t('helpTouch')) { const li = document.createElement('li'); li.textContent = s; $('help-touch').append(li); }
  $('help-rules').innerHTML = '';
  for (const s of t('helpRules')) { const li = document.createElement('li'); li.textContent = s; $('help-rules').append(li); }
  $('help-keys').innerHTML = '';
  for (const [k, v] of t('helpKeys')) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    $('help-keys').append(dt, dd);
  }
  $('loading-text').textContent = t('loading');
  seg('seg-lang', getLang());
  seg('table-pick', TABLE.id);
  document.querySelectorAll('.js-table-name').forEach((el) => { el.textContent = TABLE.name; });
  seg('seg-music', store.data.music ? '1' : '0');
  if (dmd) setAttractPages();
  renderScores($('scores-list'), -1);
}

function seg(id, value) {
  $(id).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === value)));
}

// ------------------------------------------------------------------ core objects
const layout = TABLE.id === 'rotor' ? buildRotorLayout() : TABLE.id === 'alien' ? buildAlienLayout() : buildRiffLayout();
const game = TABLE.id === 'rotor' ? new GameRotor(layout) : TABLE.id === 'alien' ? new GameAlien(layout) : new GameRiff(layout);
let dmd = null;
let renderer = null;
const audio = createAudio();
// ERDABWEHR: the shared pinball sounds that are guitar-based get the table's sci-fi versions
if (TABLE.id === 'alien') {
  const ALIEN_SFX = {
    multiballStart: 'invasionAlarm', jackpot: 'laserBig', superJackpot: 'mothershipHit', drain: 'robotDown', ballSave: 'shield',
    extraBall: 'powerUp', bankComplete: 'laserBig', laneComplete: 'powerUp', thunder: 'explosion', flame: 'tankShot',
    skillShot: 'powerUp', lock: 'abduct', gameStart: 'teleport', cheer: 'powerUp',
  };
  const raw = audio.sfx;
  audio.sfx = (n, o) => raw.call(audio, ALIEN_SFX[n] || n, o);
}
const jukebox = createJukebox();
let paused = false;
let musicState = 'attract';

/** Decide who plays: the owner's songs during a game, the synthesised score otherwise (or as fallback). */
function syncMusic() {
  const on = store.data.music;
  if (AMBIENCE && audio.setAmbience) audio.setAmbience(on ? AMBIENCE : null, game.state === 'playing' ? 0.45 : 0.7);
  const inGame = musicState === 'play' || musicState === 'multiball';
  if (on && inGame && jukebox.usable) {
    audio.setMusicVolume(0);
    if (paused) jukebox.pause(); else jukebox.play(audio.ctx);
  } else {
    if (inGame && paused) jukebox.pause(); else jukebox.fadeOut();
    audio.setMusicVolume(on ? 0.85 : 0);
  }
}

function titleLines(title) {
  const words = title.toUpperCase().split(' ');
  if (title.length <= 20 || words.length < 2) return [title.toUpperCase()];
  let best = 1, diff = 1e9;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) { diff = d; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}
let view = 'loading';
let helpReturn = 'start';

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 176, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setAttractPages() {
  const name = dedicationName();
  const best = scoreList()[0];
  dmd.attractPages = [
    { lines: t('d_press'), anim: 'storm', border: true },
    { lines: t('d_dedication', { name: name || (getLang() === 'de' ? 'PAPA' : 'DAD') }), border: true },
    { lines: t('d_motto'), border: true },
    { lines: t('d_credits') },
    ...(best ? [{ lines: t('d_hiscore', { p: best.s }), border: true }] : []),
    { lines: t('d_press'), anim: 'blink' },
  ];
}

// ------------------------------------------------------------------ screens
function show(name) {
  view = name;
  for (const s of ['start', 'help', 'scores', 'pause', 'over', 'credits', 'imprint']) $(`screen-${s}`).hidden = s !== name;
  app.dataset.state = name === 'none' ? 'playing' : name;
  if (name !== 'none') {
    const el = $(`screen-${name}`);
    const btn = el && el.querySelector('.btn--primary, .btn');
    if (btn && !touchSeen) btn.focus({ preventScroll: true });
  } else $('stage').focus({ preventScroll: true });
}

function renderScores(ol, highlight) {
  ol.innerHTML = '';
  const fmt = new Intl.DateTimeFormat(getLang(), { day: '2-digit', month: '2-digit', year: '2-digit' });
  scoreList().forEach((e, i) => {
    const li = document.createElement('li');
    const a = document.createElement('span'); a.textContent = fmtNum(e.s);
    const b = document.createElement('span');
    try { b.textContent = fmt.format(new Date(e.d)); } catch { b.textContent = ''; }
    li.append(a, b);
    if (i === highlight) li.dataset.new = 'true';
    ol.append(li);
  });
  const empty = $('scores-empty');
  if (ol.id === 'scores-list' && empty) empty.hidden = scoreList().length > 0;
}

function addScore(s) {
  const entry = { s, d: new Date().toISOString() };
  const list = scoreList();
  list.push(entry);
  list.sort((a, b) => b.s - a.s);
  list.length = Math.min(list.length, 5);
  store.save();
  return list.indexOf(entry);
}

// ------------------------------------------------------------------ small effects
let flashV = 0, lastFlash = 0;
const flashEl = $('flash');
function flash(strength = 0.25, color = '--flash') {
  const now = performance.now();
  if (now - lastFlash < 380) return; // never strobe faster than ~2.5 Hz
  lastFlash = now;
  flashEl.style.background = `var(${color})`;
  flashV = Math.min(reducedMotion ? 0.1 : 0.32, strength);
}
function vib(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ } }

// floating score / "HAHA" pop-ups, positioned over the table
const popups = [];
let popupNext = 0;
function popup(text, xm, ym, laugh = false) {
  if (!renderer || xm === undefined || reducedMotion) return;
  const host = $('popups');
  if (popups.length < 8) { const el = document.createElement('span'); el.className = 'popup'; host.append(el); popups.push(el); }
  const el = popups[popupNext++ % popups.length];
  const p = renderer.project(xm, ym, 0.05);
  if (!p.visible) return;
  el.textContent = text;
  el.className = laugh ? 'popup popup--laugh' : 'popup';
  el.style.setProperty('--px', `${p.x.toFixed(0)}px`);
  el.style.setProperty('--py', `${p.y.toFixed(0)}px`);
  el.dataset.on = '0';
  void el.offsetWidth; // restart the animation
  el.dataset.on = '1';
}

let wakeLock = null;
async function keepAwake() {
  try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* optional */ }
}

// ------------------------------------------------------------------ director: game events -> show
let bonusTimer = 0;
const SFX_MAP = TABLE.id === 'rotor' ? { flame: 'smoke', thunder: 'thunder' } : {};
/** Play the table's version of a sound, falling back to the shared one. */
function sfxT(name, o) { const m = SFX_MAP[name] || name; return audio.sfx(m, o) || (m !== name && audio.sfx(name, o)); }
// Vietnam combat soundscape: layered on top of the shared pinball sounds (ROTORSTURM only)
let popCount = 0;
function rotorSound(e) {
  const S = (n, o) => audio.sfx(n, o);
  switch (e.type) {
    case 'sling': S('gunshot', { distance: 0.15 }); break;
    case 'bumper': if (++popCount % 6 === 0) S('burst'); else S('gunshot', { distance: 0.35 + Math.random() * 0.4 }); break;
    case 'dropTarget': S('burst'); break;
    case 'bankComplete': S('mg', { len: 1.4 }); S('explosion', { size: 0.6 }); break;
    case 'standup': S('dogtags'); break;
    case 'orbit': S('gunshot', { distance: 0.85 }); break;
    case 'spinner': S('casings'); break;
    case 'rampEnter': if (e.id === 'huey') S('heliFlyby'); break;
    case 'rampDone':
      if (game.mission && game.mission.def.id === 'rolling') S('jet'); else S('artillery');
      break;
    case 'launch': S('bolt'); break;
    case 'diverter': S('bolt'); break;
    case 'scoopEnter':
      if (e.id === 'arch') S('dirt');
      else if (e.id === 'helmet') S('ricochet');
      else if (e.id === 'kheSanh') S('incoming');
      else if (e.id === 'cuchi') S('dirt');
      break;
    case 'tunnelTarget': S('tunnelShot'); break;
    case 'tunnelDone': S('tunnelShot'); setTimeout(() => S('tunnelShot'), 160); break;
    case 'missionStart': S(e.id === 'rolling' ? 'jet' : 'bugle'); break;
    case 'missionDone': S('barrage'); S('mg', { len: 1.8 }); break;
    case 'jackpot': S('explosion', { size: 0.8 }); break;
    case 'superJackpot': S('airstrike'); break;
    case 'multiballStart': S('mg', { len: 2.5 }); setTimeout(() => S('barrage'), 900); break;
    case 'extraBall': S('bugle'); break;
    case 'skillShot': S('burst'); break;
    case 'drain': S('artillery'); break;
    case 'tilt': S('explosion', { size: 0.3 }); break;
    case 'gameStart': S('bolt'); setTimeout(() => S('bugle'), 350); break;
    case 'eleven': S('barrage'); break;
    default: break;
  }
}

// RIFFGEWITTER: the backstage bus swallows and spits out the ball
function riffDirect(e) {
  const R = renderer;
  if (e.type === 'scoopEnter') { audio.sfx('skullEat'); R.sparks(layout.backstage.x / 1000, layout.backstage.y / 1000, { count: 12, color: R.colors.red, h: 0.02 }); R.shake(0.2); vib(20); return true; }
  if (e.type === 'scoopEject') { audio.sfx('skullEject'); R.flames(0.4, 0.6); return true; }
  return false;
}

// ERDABWEHR: lasers, the tractor beam, the robot and the tank. Returns true when the event is fully handled.
function alienDirect(e) {
  const R = renderer;
  const S = (n, o) => audio.sfx(n, o);
  const A = layout.alien;
  const de = getLang() === 'de';
  switch (e.type) {
    case 'bumper': if (Math.random() < 0.3) S('rayGun'); return false;
    case 'sling': if (Math.random() < 0.4) S('laser'); return false;
    case 'dropTarget': S('alienScreech'); return false;
    case 'standup': S('shield'); return false;
    case 'orbit': S('ufoPass'); return false;
    case 'rampEnter': S('laser'); return false;
    case 'rampDone': S('laserBig'); R.strike('teslaR', 'ship', { dur: 0.3 }); return false;
    case 'spinner': S('turret'); return false;
    case 'scoopEnter':
      if (e.id === 'tank') { S('turret'); R.sparks(A.tank.x / 1000, A.tank.y / 1000, { count: 10, color: R.colors.amber, h: 0.02 }); }
      else { S('teleport'); R.sparks(A.beamPad.x / 1000, A.beamPad.y / 1000, { count: 12, color: R.colors.green, h: 0.02 }); }
      R.shake(0.15); vib(18);
      return true;
    case 'scoopEject': S(e.id === 'beam' ? 'shield' : 'skullEject'); R.shake(0.12); return true;
    case 'tankFire': S('tankShot'); alienFx.tankFire(R); flash(0.14, '--c-ember-hot'); vib(40); return true;
    case 'tractor': S('tractor'); alienFx.beam(R, 2); return true;
    case 'abduct':
      S('abduct'); alienFx.beam(R, 1.8); R.flashLamps(0.8);
      popup(de ? 'ENTFÜHRT!' : 'ABDUCTED!', A.beamPad.x / 1000, (A.beamPad.y + 40) / 1000, true);
      return false;
    case 'release': S('release'); alienFx.beam(R, 1.4); return true;
    case 'laserReady': S('powerUp'); R.flashLamps(0.8); return true;
    case 'battery': S('powerUp'); return true;
    case 'laserFire': S('laserBig'); alienFx.laserFire(R); flash(0.16, '--c-volt'); vib(30); return true;
    case 'shipHit':
      S('mothershipHit'); alienFx.shipHit(R, false); flash(0.18, '--c-volt'); vib([30, 30, 50]);
      popup(`+${fmtNum(e.points)}`, A.beamPad.x / 1000, (A.beamPad.y + 60) / 1000);
      return true;
    case 'shipDown':
      S('mothershipHit'); S('explosion', { size: 1 }); alienFx.shipHit(R, true); R.startStorm(2.6); R.flashLamps(2.4); flash(0.34, '--c-ember-hot'); vib([80, 40, 80, 40, 200]);
      setTimeout(() => S('explosion', { size: 0.8 }), 450);
      return true;
    case 'robotBash': S('robotStep'); alienFx.robotBash(R); R.sparks(e.x, e.y, { count: 8, color: R.colors.orange, h: 0.03 }); vib(12); return true;
    case 'robotDown':
      S('robotDown'); R.sparks(A.robot.x / 1000, A.robot.y / 1000, { count: 30, color: R.colors.orange, h: 0.09 }); R.shake(0.6); R.flashLamps(1.2); flash(0.2, '--c-ember-hot'); vib([40, 40, 80]);
      popup(`+${fmtNum(e.points)}`, A.robot.x / 1000, (A.robot.y + 60) / 1000);
      return true;
    case 'robotUp': S('powerUp'); return true;
    case 'tunnel':
      // a shot between the robot's legs: it fires back with its arm laser
      S('robotLaser'); alienFx.robotFire(R); R.sparks(e.x, e.y, { count: 14, color: R.colors.red, h: 0.03 }); R.shake(0.2); vib(20);
      popup(de ? 'BEINSCHUSS!' : 'LEG SHOT!', A.robot.x / 1000, (A.robot.y + 70) / 1000, true);
      return true;
    case 'frenzy':
      S('invasionAlarm'); R.startStorm(1.8); R.flashLamps(1.5); R.shake(0.5); flash(0.2, '--c-blood');
      return true;
    case 'kickback':
      S('shield'); R.strike('teslaL', e.side === 'L' ? 'outL' : 'outR', { dur: 0.25, width: 0.009 }); R.sparks(e.x, e.y, { count: 18, color: R.colors.blue, kind: 2 }); R.shake(0.4); flash(0.14, '--c-volt'); vib(30);
      return true;
    case 'waveStart':
      S('invasionAlarm'); setTimeout(() => S('ufoPass'), 600);
      for (let i = 0; i < 4; i++) setTimeout(() => alienFx.rayStrike(R), 200 + i * 260);
      R.flashLamps(1.2); flash(0.14, '--c-ember-hot');
      return true;
    case 'waveProgress': S('laser'); return true;
    case 'waveDone':
      S('powerUp'); S('explosion', { size: 0.7 }); R.strike('teslaL', 'ship', { dur: 0.35 }); R.strike('teslaR', 'ship', { dur: 0.35 });
      R.flashLamps(1.6); R.shake(0.5); flash(0.22, '--c-ember-hot');
      return true;
    case 'waveFail': S('alienChatter'); R.dim(0.8); return true;
    case 'counterStart': S('invasionAlarm'); S('powerUp'); R.startStorm(3); R.flashLamps(3); R.shake(1); flash(0.3, '--c-volt'); vib([60, 40, 60, 40, 160]); return true;
    case 'multiballStart':
      audio.sfx('multiballStart'); S('invasionAlarm'); alienFx.beam(R, 3); R.startStorm(3.2); R.shake(0.9); R.flashLamps(2.5); flash(0.3, '--c-ember-hot'); vib([40, 60, 40, 60, 120]);
      return true;
    case 'jackpot': S('laserBig'); return false;
    case 'superJackpot': S('mothershipHit'); alienFx.robotFire(R, R.anchor('ship')); return false;
    case 'outlane': S('alienChatter'); return false;
    case 'gameStart': S('invasionAlarm'); return false;
    case 'eleven': S('powerUp'); return false;
    default: return false;
  }
}

function direct(e) {
  const R = renderer;
  if (TABLE.id === 'rotor') rotorSound(e);
  if (TABLE.id === 'riff' && riffDirect(e)) return;
  if (TABLE.id === 'alien' && alienDirect(e)) return;
  switch (e.type) {
    case 'msg': dmd.show(t(`d_${e.key}`, e.vars), e); break;
    case 'score': dmd.setScore(e.score); if (e.points >= 2500 && e.x !== undefined) popup(`+${fmtNum(e.points)}`, e.x, e.y); break;
    case 'music': musicState = e.state; audio.setMusic(e.state); syncMusic(); break;
    case 'flipperUp': audio.sfx('flipperUp'); break;
    case 'flipperDown': audio.sfx('flipperDown'); break;
    case 'wall': case 'post': case 'ballHit':
      audio.sfx('wallHit', { velocity: Math.min(1, e.speed / 3) });
      if (e.speed > 2.2 && e.x !== undefined) R.sparks(e.x, e.y, { count: 4, color: R.colors.white, speed: 0.4, size: 0.006 });
      break;
    case 'gate': audio.sfx('wallHit', { velocity: 0.3 }); R.gateSwing(e.id === 'top' ? 'top' : 'shooter'); break;
    case 'bumper':
      audio.sfx('bumper', { index: e.id }); R.bumperHit(e.id, e.x, e.y); vib(12);
      break;
    case 'sling':
      audio.sfx('sling'); R.slingHit(e.id, e.x, e.y, e.nx, e.ny); vib(10);
      break;
    case 'dropTarget':
      audio.sfx('dropTarget'); R.sparks(e.x, e.y, { count: 14, color: R.colors.orange, h: 0.025 }); R.shake(0.15); vib(10);
      break;
    case 'bankComplete':
      audio.sfx('bankComplete'); R.strike('teslaL', 'bank', { dur: 0.3 }); R.strike('teslaL', 'skull', { dur: 0.3 }); R.flames(0.8, 0.9);
      sfxT('flame'); R.flashLamps(0.8); R.shake(0.4); flash(0.18, '--c-ember-hot');
      break;
    case 'targetsReset': audio.sfx('target'); break;
    case 'rollover': audio.sfx('rollover'); break;
    case 'standup': audio.sfx('target'); R.glow(`standup_${e.id}_glow`, 6); R.sparks(e.x, e.y, { count: 10, color: R.colors.amber, h: 0.025 }); R.shake(0.12); vib(10); break;
    case 'elevenTargets': audio.sfx('laneComplete'); R.strike('teslaR', 'outR', { dur: 0.25 }); R.strike('teslaL', 'outL', { dur: 0.25 }); R.flashLamps(0.6); break;
    case 'tunnel':
      if (TABLE.figure === 'pinup') {
        if (!audio.sfx('shriek', { big: e.big })) audio.sfx('laugh', { big: e.big });
        R.roxyShriek(e.big); popup(getLang() === 'de' ? 'IIIEK!' : 'EEEK!', layout.roxy.x / 1000, (layout.roxy.y + 70) / 1000, true);
        setTimeout(() => popup('HIHIHI!', layout.roxy.x / 1000 + 0.03, (layout.roxy.y + 40) / 1000, true), 750);
      } else {
        if (!audio.sfx(TABLE.sfx.tunnel, { big: e.big })) audio.sfx('rampEnter');
        R.roxyLaugh(e.big); R.heliBoost(1.2); popup(getLang() === 'de' ? 'TIEFFLUG!' : 'LOW PASS!', layout.roxy.x / 1000, (layout.roxy.y + 70) / 1000, true);
      }
      R.sparks(e.x, e.y, { count: 14, color: R.colors.white, h: 0.03 }); R.flashLamps(0.4); R.shake(0.2); vib(20);
      break;
    case 'frenzy':
      audio.sfx(TABLE.sfx.frenzy) || audio.sfx('cheer'); R.flames(1.6, 1.1); sfxT('flame'); if (TABLE.id === 'rotor') R.startStorm(1.6); R.strike('teslaL', 'roxy', { dur: 0.3 }); R.strike('teslaR', 'roxy', { dur: 0.3 }); R.flashLamps(1.5); R.shake(0.5); flash(0.2, '--c-ember-hot');
      break;
    case 'kickback':
      audio.sfx(TABLE.sfx.kickback) || audio.sfx('kickback'); R.strike('sky', e.side === 'L' ? 'outL' : 'outR', { dur: 0.25, width: 0.009 }); R.sparks(e.x, e.y, { count: 18, color: R.colors.blue, kind: 2 }); R.shake(0.4); flash(0.14, '--c-volt'); vib(30);
      break;
    case 'outlane': audio.sfx('thunder'); R.strike('sky', 'table', { dur: 0.2 }); break;
    case 'laneComplete': audio.sfx('laneComplete'); R.flashLamps(0.5); break;
    case 'skillShot': audio.sfx('jackpot'); R.flashLamps(1); R.flames(0.7, 0.8); flash(0.2, '--c-ember-hot'); break;
    case 'orbit': audio.sfx('orbit'); R.strike(e.side === 'L' ? 'teslaL' : 'teslaR', 'sky', { dur: 0.16, flash: 2 }); break;
    case 'spinner': R.spinnerKick(e.speed, e.which); break;
    case 'spinTick': audio.sfx('spinner', { speed: 1 - e.k / Math.max(1, e.n) }); break;
    case 'rampEnter': audio.sfx('rampEnter'); break;
    case 'rampDone':
      audio.sfx('rampDone'); R.sparks(0.06, 0.356, { count: 12, color: R.colors.blue, kind: 2 });
      if (e.combo >= 1) { R.flames(0.5, 0.7); sfxT('flame'); }
      break;
    case 'skullEat': audio.sfx('skullEat'); R.skullEat(); R.shake(0.3); vib(25); break;
    case 'skullEject': audio.sfx('skullEject'); R.skullEject(); R.sparks(0.24, 0.57, { count: 10, color: R.colors.red }); break;
    case 'lock':
      audio.sfx('lock'); R.strike('teslaL', 'skull', { dur: 0.35 }); R.strike('teslaR', 'skull', { dur: 0.35 }); audio.sfx('thunder');
      R.flashLamps(0.7); flash(0.16, '--c-volt');
      break;
    case 'multiballStart':
      audio.sfx('multiballStart'); if (TABLE.heli) audio.sfx('liftoff'); else audio.sfx('cheer'); R.startStorm(3.2); R.flames(2.6, 1.2); R.shake(0.9); R.flashLamps(2.5); flash(0.3, '--c-volt'); vib([40, 60, 40, 60, 120]);
      break;
    case 'multiballEnd': R.dim(0.4); break;
    // ---- RIFFGEWITTER stage modules
    case 'backstage': audio.sfx('cheer'); R.flashLamps(0.5); break;
    case 'disc': audio.sfx(e.scratch ? 'scratch' : 'vinylSpin'); R.sparks(e.ball ? e.ball.x : 0.118, e.ball ? e.ball.y : 0.792, { count: e.scratch ? 14 : 6, color: e.scratch ? R.colors.blue : R.colors.amber, h: 0.02 }); break;
    case 'bash': audio.sfx('micBash'); R.micBash?.(); R.sparks(e.x, e.y, { count: 8, color: R.colors.white, h: 0.03 }); R.shake(0.1); vib(12); break;
    case 'scratch': audio.sfx('feedback'); audio.sfx('scratch'); R.setDiscSpin?.(-17); R.flashLamps(1); R.strike('teslaL', 'teslaR', { dur: 0.25 }); flash(0.16, '--c-volt'); vib([20, 30, 20]); break;
    case 'scratchEnd': R.setDiscSpin?.(7); break;
    case 'songStart': audio.sfx('powerChord'); R.trussShow?.(e.idx, 4); R.flames(1.0, 1.0); sfxT('flame'); R.flashLamps(1.2); R.shake(0.4); flash(0.18, '--c-ember-hot'); vib(30); break;
    case 'songProgress': audio.sfx('target'); break;
    case 'songDone': audio.sfx('jackpot'); audio.sfx('cheer'); R.trussShow?.(-1, 3); R.flames(1.6, 1.2); sfxT('flame'); R.flashLamps(1.6); R.shake(0.5); flash(0.22, '--c-ember-hot'); vib([30, 40, 60]); break;
    case 'songFail': audio.sfx('drain'); R.dim(0.3); break;
    case 'finaleStart': audio.sfx('powerChord'); audio.sfx('cheer'); R.trussShow?.(-1, 10); R.startStorm(3); R.flames(3, 1.3); R.flashLamps(3); R.shake(1); flash(0.3, '--c-ember-hot'); vib([60, 40, 60, 40, 160]); break;
    case 'jackpot':
      audio.sfx('jackpot'); sfxT('flame'); R.flames(1.2, 1.1); R.strike('teslaL', 'teslaR', { dur: 0.3, amp: 0.2 }); R.strike('sky', 'ramp', { dur: 0.25 });
      R.flashLamps(1.2); R.shake(0.6); flash(0.26, '--c-ember-hot'); vib(40);
      break;
    case 'superJackpot':
      audio.sfx('superJackpot'); audio.sfx('thunder'); R.startStorm(1.8); R.flames(2, 1.3); R.flashLamps(2); R.shake(1); flash(0.3); vib([60, 40, 120]);
      break;
    case 'extraBall': audio.sfx('extraBall'); audio.sfx('cheer'); R.flashLamps(1.2); R.flames(1, 1); break;
    case 'eleven': audio.sfx('thunder'); audio.sfx('bankComplete'); R.startStorm(1.4); R.flames(1.8, 1.2); R.shake(0.7); flash(0.24, '--c-ember-hot'); break;
    case 'volume': audio.sfx('laneComplete'); break;
    case 'ballSaved': audio.sfx('ballSave'); R.flashLamps(0.5); break;
    case 'launch': audio.sfx('launch', { power: e.power }); R.plungerFire(e.power); break;
    case 'nudge': R.shake(0.55); audio.sfx('wallHit', { velocity: 0.9 }); break;
    case 'tiltWarning': audio.sfx('tiltWarning'); break;
    case 'tilt': audio.sfx('tilt'); R.dim(3); break;
    case 'ballSearch': R.sparks(e.x, e.y, { count: 6 }); break;
    case 'drain': audio.sfx('drain'); R.dim(1.4); R.shake(0.35); vib(60); break;
    case 'bonus': dmd.showBonus(e); bonusTimer = e.tilted ? 0 : 2.4; break;
    case 'ballStart': dmd.clearBonus(); dmd.setBall(e.ball); bonusTimer = 0; break;
    case 'gameStart': audio.sfx('gameStart'); dmd.setMode('game'); dmd.setScore(0); dmd.shownScore = 0; R.setMode('play'); R.flames(1, 1); break;
    case 'gameOver': onGameOver(e); break;
    // ---- ROTORSTURM events
    case 'scoopEnter':
      if (e.id === 'helmet') { audio.sfx('dropTarget'); R.glow('helmet_glow', 5); R.sparks(layout.helmet.x / 1000, layout.helmet.y / 1000, { count: 10, color: R.colors.amber }); }
      else if (e.id === 'kheSanh') { audio.sfx('lock'); R.glow('khesanh_glow', 5); R.shake(0.2); }
      else if (e.id === 'village') { audio.sfx('rollover'); R.glow('village_glow', 4); }
      else if (e.id === 'cuchi') { audio.sfx('rampEnter'); R.shake(0.25); }
      vib(18);
      break;
    case 'scoopEject': audio.sfx('skullEject'); R.shake(0.12); break;
    case 'missionStart': audio.sfx('radio') || audio.sfx('laneComplete'); R.flashLamps(1.2); R.strike('sky', 'table', { dur: 0.2, flash: 2 }); flash(0.14, '--c-ember-hot'); break;
    case 'missionDone':
      audio.sfx('jackpot'); audio.sfx('cheer'); R.flames(1.6, 1.1); sfxT('flame'); R.flashLamps(1.6); R.shake(0.5); flash(0.22, '--c-ember-hot');
      popup(`+${fmtNum(e.points)}`, layout.helmet.x / 1000, (layout.helmet.y + 40) / 1000);
      break;
    case 'missionFail': audio.sfx('radio') || audio.sfx('tiltWarning'); R.dim(0.8); break;
    case 'missionProgress': audio.sfx('target'); break;
    case 'diverter': if (TABLE.id !== 'rotor') audio.sfx('flipperDown'); break;
    case 'padRelease': audio.sfx('winch') || audio.sfx('kickback'); R.heliBoost(1.5); break;
    case 'village':
      audio.sfx('cheer'); popup(`+${fmtNum(e.points)}`, layout.village.x / 1000, (layout.village.y + 30) / 1000);
      break;
    case 'kheSanh': R.strike('teslaR', 'table', { dur: 0.18, flash: 2 }); break;
    case 'cuchiLit': audio.sfx('radio') || audio.sfx('laneComplete'); R.flashLamps(0.5); break;
    case 'tunnelEnter': audio.sfx('rampEnter'); popup('CU CHI', layout.cuchi.x / 1000, (layout.cuchi.y + 30) / 1000, true); break;
    case 'tunnelDrop': audio.sfx('wallHit', { velocity: 0.6 }); R.shake(0.15); break;
    case 'tunnelTarget': audio.sfx('target'); R.sparks(e.x ?? 0.24, 0.41, { count: 8, color: R.colors.amber, h: -0.02 }); break;
    case 'tunnelDone': audio.sfx('jackpot'); R.flashLamps(1.2); R.shake(0.4); flash(0.18, '--c-ember-hot'); break;
    case 'tunnelExit': audio.sfx('skullEject'); break;
    case 'archLift': audio.sfx('winch') || audio.sfx('rampEnter'); R.heliBoost(1.5); popup(getLang() === 'de' ? 'NACH OBEN!' : 'GOING UP!', layout.tunnelArch.x / 1000, (layout.tunnelArch.y + 30) / 1000, true); break;
    case 'alarmStep': audio.sfx('target'); R.glow('helmet_glow', 3); if (e.n >= e.need - 1) audio.sfx('radio'); break;
    case 'insaneStart':
      audio.sfx('alarm') || audio.sfx('multiballStart');
      if (audio.alarmLoop) audio.alarmLoop(true);
      R.setAlarm(true); R.startStorm(2.4); R.shake(1); R.flashLamps(2); flash(0.3, '--c-blood'); vib([80, 60, 80, 60, 200]);
      dmd.setColor([255, 40, 30]);
      app.dataset.alarm = 'on';
      break;
    case 'insaneEnd':
      if (audio.alarmLoop) audio.alarmLoop(false);
      R.setAlarm(false);
      dmd.setColor(hexToRgb(cssColor('--dmd', '#ffb000')));
      app.dataset.alarm = 'off';
      break;
    case 'insaneHit':
      audio.sfx('explosion', { size: 0.45 });
      if (e.x !== undefined) popup(`+${fmtNum(e.points)}`, e.x, e.y);
      break;
    case 'attract': dmd.setMode('attract'); dmd.clearBonus(); R.setMode('attract'); break;
    default: break;
  }
}

function onGameOver(e) {
  if (audio.alarmLoop) audio.alarmLoop(false);
  if (renderer) renderer.setAlarm(false);
  app.dataset.alarm = 'off';
  dmd.setColor(hexToRgb(cssColor('--dmd', '#ffb000')));
  audio.sfx('gameOver');
  dmd.clearBonus();
  dmd.show([t('d_gameOver'), fmtNum(e.score)], { dur: 6, pri: 9 });
  const rank = addScore(e.score);
  const isNew = rank === 0 && e.score > 0;
  setTimeout(() => {
    if (game.state !== 'gameover') return;
    if (isNew) { audio.sfx('highScore'); renderer.flames(1.6, 1.1); renderer.flashLamps(2); }
    $('over-score').textContent = fmtNum(e.score);
    $('over-new').hidden = !isNew;
    const st = e.stats;
    const mm = Math.floor(st.time / 60), ss = String(Math.floor(st.time % 60)).padStart(2, '0');
    const rows = [[t('statTime'), `${mm}:${ss}`], [t('statRamps'), st.ramps], [t('statJackpots'), st.jackpots], [t('statTunnels'), st.tunnels], [t('statBumpers'), st.bumpers]];
    const dl = $('over-stats'); dl.innerHTML = '';
    for (const [k, v] of rows) {
      const d = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      d.append(dt, dd); dl.append(d);
    }
    renderScores($('over-list'), rank);
    renderer.setMode('attract');
    show('over');
  }, 2400);
}

// ------------------------------------------------------------------ painted faces (signs, flags, apron card)
function paintFace(name, imgs) {
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  const wood = (w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6e5634'); g.addColorStop(1, '#4a3820');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(30,18,6,0.45)'; c.lineWidth = 2;
    for (let y = h / 4; y < h; y += h / 4) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + (Math.random() - 0.5) * 6); c.stroke(); }
    c.strokeStyle = '#2a1c0c'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
  };
  let m;
  if ((m = /^sign_(\w+?)_face$/.exec(name))) {
    cv.width = 512; cv.height = 192;
    wood(512, 192);
    const lines = t(`sign_${m[1]}`);
    if (!Array.isArray(lines)) return cv;
    drawStar(c, 40, 96, 24, '#f2efe6');
    c.fillStyle = '#f2ead2'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = "64px 'Black Ops One', Impact, sans-serif";
    let fs = 64; while (c.measureText(lines[0]).width > 400 && fs > 30) { fs -= 2; c.font = `${fs}px 'Black Ops One', Impact, sans-serif`; }
    c.fillText(lines[0], 276, 72);
    c.font = "700 40px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    c.fillStyle = '#f2c230'; c.fillText(lines[1] || '', 276, 140);
    return cv;
  }
  if (name === 'truss_banner') {
    // stage banner on the light truss: 140 x 34 mm
    cv.width = 1024; cv.height = 248;
    const g = c.createLinearGradient(0, 0, 0, 248); g.addColorStop(0, '#1a0608'); g.addColorStop(1, '#070305');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 248);
    c.strokeStyle = cssColor('--c-ember', '#ff5a1f'); c.lineWidth = 8; c.strokeRect(10, 10, 1004, 228);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = "120px 'Metal Mania', Impact, fantasy";
    c.lineWidth = 10; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText('RIFFGEWITTER', 512, 104);
    c.fillStyle = cssColor('--c-ember-hot', '#ffb347'); c.fillText('RIFFGEWITTER', 512, 104);
    c.font = "700 46px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.fillStyle = '#ece9f1';
    c.fillText(t('bannerTour'), 512, 196);
    return cv;
  }
  if (/^flag_\w*_cloth$/.test(name)) { cv.width = 380; cv.height = 200; drawUSFlag(c, 0, 0, 380, 200); return cv; }
  if (TABLE.id === 'alien' && (name === 'backpanel_art' || name === 'apron_art')) return paintAlienFace(name, c, cv);
  if (name === 'backpanel_art') {
    // flat back wall: US flag, sunset with helicopters, Vietnamese flag, title
    cv.width = 1024; cv.height = 540;
    c.fillStyle = '#120c08'; c.fillRect(0, 0, 1024, 540);
    if (imgs.apron) c.drawImage(imgs.apron, 0, 0, imgs.apron.width, imgs.apron.height, -40, 40, 1104, 386);
    const g = c.createLinearGradient(0, 300, 0, 540); g.addColorStop(0, 'rgba(18,12,8,0)'); g.addColorStop(1, 'rgba(18,12,8,1)');
    c.fillStyle = g; c.fillRect(0, 300, 1024, 240);
    drawUSFlag(c, 24, 36, 230, 128);
    c.fillStyle = '#c8211b'; c.fillRect(770, 36, 230, 128); drawStar(c, 885, 100, 44, '#ffd500');
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4; c.strokeRect(24, 36, 230, 128); c.strokeRect(770, 36, 230, 128);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = "96px 'Black Ops One', Impact, sans-serif";
    c.lineWidth = 10; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText('ROTORSTURM', 512, 410);
    c.fillStyle = '#f2c230'; c.fillText('ROTORSTURM', 512, 410);
    c.font = "700 40px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.fillStyle = '#ece4cc';
    c.fillText('VIETNAM 1968', 512, 476);
    return cv;
  }
  if (name === 'apron_art') {
    // the plane is 472 x 60 mm: keep the canvas at the same proportions
    cv.width = 1536; cv.height = 196;
    c.fillStyle = '#1b1a12'; c.fillRect(0, 0, 1536, 196);
    if (imgs.apron) c.drawImage(imgs.apron, 0, 0, imgs.apron.width, imgs.apron.height, 0, 0, 560, 196);
    const g = c.createLinearGradient(470, 0, 560, 0); g.addColorStop(0, 'rgba(27,26,18,0)'); g.addColorStop(1, 'rgba(27,26,18,1)');
    c.fillStyle = g; c.fillRect(470, 0, 90, 196);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#f2c230'; c.font = "62px 'Black Ops One', Impact, sans-serif";
    c.fillText('ROTORSTURM', 770, 78);
    c.fillStyle = '#e8e2cc'; c.font = "700 30px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    c.fillText('VIETNAM 1968', 770, 136);
    const x0 = 990, y0 = 8, w = 538, h = 180;
    c.fillStyle = '#d6c9a0'; c.fillRect(x0, y0, w, h);
    c.strokeStyle = '#5a4a24'; c.lineWidth = 5; c.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
    c.fillStyle = '#2a2410'; c.font = "30px 'Black Ops One', Impact, sans-serif";
    c.fillText(t('goalsTitle'), x0 + w / 2, y0 + 26);
    c.textAlign = 'left'; c.font = "700 25px 'Barlow Condensed', 'Arial Narrow', sans-serif";
    (t('goals') || []).forEach((txt, i) => {
      const y = y0 + 58 + i * 27;
      c.fillStyle = '#e09a1a'; c.beginPath(); c.arc(x0 + 26, y, 9, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2a2410'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#2a2410'; c.fillText(txt, x0 + 46, y + 1);
    });
    return cv;
  }
  return null;
}

// ERDABWEHR back wall (night sky over a burning city, the mothership's shadow) and apron card (orders)
function paintAlienFace(name, c, cv) {
  const acid = cssColor('--alien-acid', '#7dff3a'), cyan = cssColor('--alien-cyan', '#38e8ff'), violet = cssColor('--alien-violet', '#a64dff');
  const stars = (w, h, n) => { for (let i = 0; i < n; i++) { const a = Math.random(); c.fillStyle = `rgba(230,236,255,${0.2 + a * 0.7})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + a * 1.6, 1 + a * 1.6); } };
  const title = (x, y, size) => {
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `900 ${size}px 'Orbitron', 'Arial Black', sans-serif`;
    c.lineWidth = size * 0.12; c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText('ERDABWEHR', x, y);
    c.shadowColor = acid; c.shadowBlur = size * 0.4; c.fillStyle = acid; c.fillText('ERDABWEHR', x, y); c.shadowBlur = 0;
  };
  if (name === 'backpanel_art') {
    cv.width = 1024; cv.height = 540;
    const g = c.createLinearGradient(0, 0, 0, 540); g.addColorStop(0, '#05030c'); g.addColorStop(0.6, '#1a0a2e'); g.addColorStop(1, '#3a0e1a');
    c.fillStyle = g; c.fillRect(0, 0, 1024, 540);
    stars(1024, 330, 260);
    // distant saucers against the night sky (the 3D mothership hovers in front of this panel)
    for (const [x, y, r] of [[150, 205, 26], [880, 190, 22], [700, 250, 14], [300, 260, 12]]) {
      c.fillStyle = '#100c20'; c.beginPath(); c.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = violet; c.beginPath(); c.ellipse(x, y - r * 0.18, r * 0.4, r * 0.2, 0, Math.PI, 0); c.fill();
      for (let i = -2; i <= 2; i++) { c.fillStyle = acid; c.fillRect(x + i * r * 0.35 - 1.5, y + r * 0.05, 3, 3); }
    }
    // city skyline with burning windows
    c.fillStyle = '#07060c';
    let x = 0;
    while (x < 1024) { const w = 30 + Math.random() * 60, h = 60 + Math.random() * 150; c.fillRect(x, 540 - h, w, h);
      for (let wy = 540 - h + 8; wy < 532; wy += 12) for (let wx = x + 5; wx < x + w - 6; wx += 10) if (Math.random() < 0.35) { c.fillStyle = Math.random() < 0.15 ? '#ff7a2a' : 'rgba(255,214,140,0.8)'; c.fillRect(wx, wy, 4, 6); c.fillStyle = '#07060c'; }
      x += w + 4; }
    // laser streaks from the ground to the ship
    c.globalCompositeOperation = 'lighter'; c.lineWidth = 3;
    for (const [x0, x1] of [[120, 300], [880, 700], [260, 430]]) { c.strokeStyle = cyan; c.beginPath(); c.moveTo(x0, 520); c.lineTo(x1, 175); c.stroke(); }
    c.globalCompositeOperation = 'source-over';
    title(512, 78, 92);
    c.font = "700 36px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.fillStyle = cyan; c.fillText(t('d_credits')[1], 512, 140);
    return cv;
  }
  // apron card: 472 x 60 mm plane
  cv.width = 1536; cv.height = 196;
  c.fillStyle = '#0b0918'; c.fillRect(0, 0, 1536, 196);
  stars(980, 196, 120);
  for (let i = 0; i < 8; i++) { c.strokeStyle = 'rgba(56,232,255,0.18)'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 20 + i * 22); c.lineTo(980, 20 + i * 22); c.stroke(); }
  title(480, 84, 72);
  c.font = "700 30px 'Barlow Condensed', 'Arial Narrow', sans-serif"; c.fillStyle = cyan; c.textAlign = 'center';
  c.fillText(t('subtitle'), 480, 150);
  const x0 = 990, y0 = 8, w = 538, h = 180;
  c.fillStyle = '#141029'; c.fillRect(x0, y0, w, h);
  c.strokeStyle = acid; c.lineWidth = 4; c.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
  c.fillStyle = acid; c.font = "900 28px 'Orbitron', 'Arial Black', sans-serif"; c.textAlign = 'center';
  c.fillText(t('goalsTitle'), x0 + w / 2, y0 + 26);
  c.textAlign = 'left'; c.font = "700 25px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  (t('goals') || []).forEach((txt, i) => {
    const y = y0 + 58 + i * 27;
    c.fillStyle = cyan; c.beginPath(); c.arc(x0 + 26, y, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#e6e9ff'; c.fillText(txt, x0 + 46, y + 1);
  });
  return cv;
}

// ------------------------------------------------------------------ camera views
const VIEWS = ['player', 'std', 'flat', 'close', 'top'];
function cycleView() {
  if (!renderer) return;
  const v = VIEWS[(VIEWS.indexOf(store.data.view) + 1) % VIEWS.length];
  store.data.view = v; store.save();
  renderer.setView(v);
  dmd.show(t('d_view', { v: t(`view_${v}`) }), { dur: 1.2, pri: 9 });
}

// ------------------------------------------------------------------ credits: 20 per device, one per game
function creditCount() { const n = Math.floor(Number(store.data.credits)); return Number.isFinite(n) ? Math.max(0, n) : 20; }
function updateCredits() {
  const n = creditCount();
  const txt = n === 0 ? t('creditsNone') : n === 1 ? t('creditsOne') : t('creditsLeft', { n });
  for (const id of ['credits-start', 'credits-over']) { const el = $(id); if (el) { el.textContent = txt; el.dataset.low = String(n <= 3); } }
}
function requestStart() {
  const n = creditCount();
  if (n <= 0) { show('credits'); return; }
  store.data.credits = n - 1; store.save();
  updateCredits();
  startGame();
}

// ------------------------------------------------------------------ game flow
function startGame() {
  audio.unlock();
  keepAwake();
  paused = false;
  show('none');
  game.startGame();
  app.dataset.touch = touchSeen ? 'on' : 'off';
  $('hint-l').textContent = t(touchSeen ? 'hintLeft' : 'hintLeftKey');
  $('hint-r').textContent = t(touchSeen ? 'hintRight' : 'hintRightKey');
  app.dataset.hints = 'on';
  setTimeout(() => { app.dataset.hints = 'off'; }, 6500);
}

function toMenu() {
  paused = false;
  game.toAttract();
  setAttractPages();
  show('start');
}

function setPaused(p) {
  if (p === paused) return;
  if (p && game.state !== 'playing' && game.state !== 'bonus') return;
  paused = p;
  if (p) { game.flipper('L', false); game.flipper('R', false); game.plungerUp(); syncMusic(); audio.suspend(); show('pause'); }
  else { audio.resume(); syncMusic(); show('none'); }
}

// ------------------------------------------------------------------ input
function bindInput() {
  const stage = $('stage');
  const pointers = new Map();
  const press = (side, down) => {
    if (paused) return;
    game.flipper(side, down);
    if (side === 'R') { if (down) game.plungerDown(); else game.plungerUp(); }
  };
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') touchSeen = true;
    audio.unlock();
    if (view !== 'none') return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const side = e.clientX - r.left < r.width / 2 ? 'L' : 'R';
    pointers.set(e.pointerId, side);
    try { stage.setPointerCapture(e.pointerId); } catch { /* optional */ }
    press(side, true);
  });
  const up = (e) => {
    const side = pointers.get(e.pointerId);
    if (!side) return;
    pointers.delete(e.pointerId);
    if (![...pointers.values()].includes(side)) press(side, false);
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('lostpointercapture', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  app.addEventListener('touchmove', (e) => { if (view === 'none') e.preventDefault(); }, { passive: false });

  const keyL = new Set(['ArrowLeft', 'KeyA', 'ShiftLeft', 'KeyY', 'KeyZ', 'ControlLeft']);
  const keyR = new Set(['ArrowRight', 'KeyD', 'ShiftRight', 'KeyM', 'Slash', 'Minus', 'ControlRight']);
  const keyP = new Set(['Space', 'ArrowDown', 'Enter', 'KeyS']);
  let plungeKey = false;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) { if (view === 'none') e.preventDefault(); return; }
    if (view !== 'none') {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (view === 'pause') { setPaused(false); e.preventDefault(); } else if (view === 'help') { show(helpReturn); } else if (view === 'scores') show('start'); else if (view === 'credits') toMenu(); else if (view === 'imprint') show('start'); }
      return;
    }
    touchSeen = false;
    if (keyL.has(e.code)) { press('L', true); e.preventDefault(); }
    else if (keyR.has(e.code)) { game.flipper('R', true); e.preventDefault(); }
    else if (keyP.has(e.code)) {
      e.preventDefault();
      if (game.phys.ballsInShooter() > 0) { plungeKey = true; game.plungerDown(); }
      else if (e.code === 'Space') game.nudge(0);
    } else if (e.code === 'ArrowUp' || e.code === 'KeyN') { game.nudge(0); e.preventDefault(); }
    else if (e.code === 'KeyT') { jukebox.next(); }
    else if (e.code === 'KeyV') { cycleView(); }
    else if (e.code === 'Escape' || e.code === 'KeyP') { setPaused(true); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (keyL.has(e.code)) game.flipper('L', false);
    else if (keyR.has(e.code)) game.flipper('R', false);
    else if (keyP.has(e.code) && plungeKey) { plungeKey = false; game.plungerUp(); }
  });
  window.addEventListener('blur', () => { game.flipper('L', false); game.flipper('R', false); pointers.clear(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (game.state === 'playing' || game.state === 'bonus') setPaused(true); else { audio.suspend(); jukebox.pause(); } }
    else if (!paused) audio.resume();
  });

  const click = (id, fn) => $(id).addEventListener('click', () => { audio.unlock(); audio.sfx('uiClick'); fn(); });
  click('btn-play', requestStart);
  click('btn-again', requestStart);
  click('btn-credits-back', toMenu);
  click('btn-imprint', () => show('imprint'));
  click('btn-imprint-back', () => show('start'));
  click('btn-menu', toMenu);
  click('btn-quit', toMenu);
  click('btn-resume', () => setPaused(false));
  click('btn-help', () => { helpReturn = 'start'; show('help'); });
  click('btn-pause-help', () => { helpReturn = 'pause'; show('help'); });
  click('btn-help-back', () => show(helpReturn));
  click('btn-scores', () => { renderScores($('scores-list'), -1); show('scores'); });
  click('btn-scores-back', () => show('start'));
  click('btn-pause', () => setPaused(!paused));
  click('btn-view', () => cycleView());
  click('btn-next', () => { jukebox.next(); $('now-playing').textContent = jukebox.title; });
  click('btn-sound', () => {
    store.data.muted = !store.data.muted; store.save();
    audio.setMuted(store.data.muted); jukebox.setMuted(store.data.muted);
    $('btn-sound').setAttribute('aria-pressed', String(store.data.muted));
    $('btn-sound').querySelector('.wave').style.display = store.data.muted ? 'none' : '';
  });
  $('btn-nudge').addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); if (!paused) game.nudge(0); });
  $('seg-lang').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    store.data.lang = v; store.save(); setLang(v); applyLang(); audio.unlock(); audio.sfx('uiClick');
    if (renderer) { renderer.lang = v; renderer.repaintPlayfield(); renderer.paintFaces(); }
  });
  $('seg-music').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    store.data.music = v === '1'; store.save(); audio.unlock(); syncMusic(); seg('seg-music', v); audio.sfx('uiClick');
    if (store.data.music && game.state === 'attract') audio.setMusic('attract');
  });
  $('table-pick').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    audio.unlock(); audio.sfx('uiClick'); switchTable(v);
  });
  $('seg-quality').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v; if (!v) return;
    store.data.quality = v; store.save(); seg('seg-quality', v); renderer.dynScale = 1; renderer.setQuality(v); audio.unlock(); audio.sfx('uiClick');
  });
  // first gesture anywhere starts the attract music
  window.addEventListener('pointerdown', () => { if (audio.unlock() && game.state === 'attract' && audio.musicState !== 'attract') audio.setMusic('attract'); }, { passive: true });
}

// ------------------------------------------------------------------ layout / loop
function measure() {
  const r = app.getBoundingClientRect();
  const d = document.querySelector('.dmd').getBoundingClientRect();
  // the scoreboard only eats into the table view when it sits centred above it
  const centred = d.right - r.left > r.width * 0.55;
  app.style.setProperty('--hud-h', centred ? `${Math.round(d.bottom - r.top + 6)}px` : '0px');
  renderer.resize(Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height)), { top: centred ? Math.max(0, d.bottom - r.top) : 0, bottom: 0 });
}

let last = 0;
function tick(now) {
  if (window.__rgFreeze) { last = now; requestAnimationFrame(tick); return; }
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (!paused) {
    game.update(dt);
    if (bonusTimer > 0) {
      const before = Math.floor(bonusTimer * 14);
      bonusTimer -= dt;
      if (Math.floor(bonusTimer * 14) !== before) audio.sfx('bonusTick');
    }
  }
  jukebox.update(dt);
  renderer.frame(paused ? 0 : dt, game);
  dmd.update(dt);

  // HUD state
  const inShooter = game.state === 'playing' && game.phys.ballsInShooter() > 0 && !game.phys.balls.some((b) => b.auto);
  app.dataset.plunger = game.plunger.held ? 'on' : 'off';
  if (game.plunger.held) app.style.setProperty('--charge', game.plunger.charge.toFixed(3));
  dmd.setHint(inShooter && !game.plunger.held ? t(touchSeen ? 'd_launch' : 'd_launchKey') : null);
  dmd.info = game.state === 'playing' ? (game.scoreX > 1 ? '2X' : game.bonusX > 1 ? `BONUS X${game.bonusX}` : `VOL ${game.volume}`) : '';
  let roll = 0;
  if (!paused && game.state === 'playing') for (const b of game.phys.balls) if (b.mode !== 'held') roll = Math.max(roll, Math.min(1, (Math.hypot(b.vx, b.vy) + (b.mode === 'ramp' ? b.sv : 0)) / 3));
  audio.setRoll(roll);
  if (flashV > 0.002) { flashV *= Math.exp(-dt * 9); flashEl.style.opacity = flashV.toFixed(3); } else if (flashEl.style.opacity !== '0') flashEl.style.opacity = '0';
  requestAnimationFrame(tick);
}

async function boot() {
  setLang(initialLang());
  dmd = new DMD($('dmd'));
  dmd.setColor(hexToRgb(cssColor('--dmd', '#ffb000')));
  applyLang();
  // high quality by default; only clearly weak devices start in the light mode (the renderer still
  // lowers its resolution on its own if the frame rate drops)
  const weak = (navigator.deviceMemory && navigator.deviceMemory < 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4);
  const quality = store.data.quality || (weak ? 'low' : 'high');
  seg('seg-quality', quality);
  $('btn-sound').setAttribute('aria-pressed', String(store.data.muted));
  $('btn-sound').querySelector('.wave').style.display = store.data.muted ? 'none' : '';
  audio.setMuted(store.data.muted); jukebox.setMuted(store.data.muted);
  audio.setMusicVolume(store.data.music ? 0.85 : 0);
  if (audio.setTheme) audio.setTheme(TABLE.audioTheme);
  if (AMBIENCE && audio.setAmbience && store.data.music) audio.setAmbience(AMBIENCE, 0.7);
  audio.setMusic('attract');
  audio.onBeat((b) => { if (renderer && !jukebox.playing) renderer.beat(b.type); });
  jukebox.onBeat((type) => { if (renderer) renderer.beat(type); });
  jukebox.onFail(syncMusic);
  jukebox.onTrack((tr) => { $('now-playing').textContent = tr.title; $('song-row').hidden = false; if (game.state === 'playing') dmd.show(titleLines(tr.title), { dur: 2.6, pri: 1 }); });

  const bar = document.querySelector('.loading__bar');
  try {
    renderer = new Renderer($('stage'), layout, { quality, reducedMotion, theme: TABLE });
    renderer.lang = getLang();
    if (store.data.viewVer !== 2) { store.data.view = 'player'; store.data.viewVer = 2; store.save(); }
    renderer.setView(store.data.view);
    renderer.facePainter = paintFace;
    if (TABLE.heli) renderer.audioRotor = (spin) => { if (audio.setRotor) audio.setRotor(paused ? 0 : Math.max(0, Math.min(1, (spin - 0.12) * 1.15))); };
    const progress = (p) => bar.style.setProperty('--progress', p.toFixed(2));
    const inl = (window.__RG_ASSETS_ALL || {})[TABLE.id] || {};
    try {
      const artFiles = TABLE.id === 'rotor' ? { scene: 'art_scene.webp', apron: 'art_apron.webp', soldierL: 'art_soldier_left.webp', soldierR: 'art_soldier_right.webp' } : {};
      const art = Object.fromEntries(Object.entries(artFiles).map(([k, f]) => [k, (inl.art || {})[k] || `assets/${TABLE.id}/${f}`]));
      await renderer.load({ glb: inl.glb || `assets/${TABLE.id}/table.glb`, base: inl.base || `assets/${TABLE.id}/playfield_base.jpg`, art }, progress);
    } catch (first) {
      // second chance: the same assets packed into a script file
      if (inl.glb) throw first;
      await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = `assets-inline-${TABLE.id}.js`; sc.onload = res; sc.onerror = () => rej(first); document.head.append(sc); });
      const pack = window.__RG_ASSETS_ALL[TABLE.id];
      await renderer.load({ ...pack, art: pack.art || {} }, progress);
    }
  } catch (err) {
    console.error(err);
    $('loading-text').textContent = t('loadError');
    return;
  }
  game.on(direct);
  bindInput();
  new ResizeObserver(measure).observe(app);
  measure();
  setAttractPages();
  dmd.setMode('attract');
  renderer.setMode('attract');
  $('loading').hidden = true;
  show('start');
  window.__rg = { game, renderer, audio, dmd, jukebox, startGame, requestStart, store, show, table: TABLE.id, switchTable };
  last = performance.now();
  requestAnimationFrame(tick);
}

boot();
