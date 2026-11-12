// Jukebox: plays the owner's own songs (MP3 files next to the page) as background music.
// Falls back silently when the files are not there (e.g. the single-file version), so the
// synthesised soundtrack can take over. A bass detector drives the light show.

export const TRACKS = [
  { file: 'king-for-a-night.mp3', title: 'King for a Night' },
  { file: 'duke-nukem.mp3', title: 'Duke Nukem' },
  { file: 'rusty-balls.mp3', title: 'Rusty Balls' },
  { file: 'beer-and-bitches.mp3', title: 'Beer and Bitches' },
  { file: 'tits-and-guns.mp3', title: 'Tits and Guns' },
  { file: 'when-the-duke-comes-around.mp3', title: 'When the Duke Comes Around' },
];

export function createJukebox(opts = {}) {
  const base = opts.base || 'music/';
  const tracks = opts.tracks || TRACKS;
  const level = opts.level ?? 0.55; // the songs are mastered hot; keep the table sounds on top
  let el = null, ctx = null, src = null, gain = null, analyser = null, bins = null;
  let order = [], pos = -1;
  let usable = tracks.length > 0;
  let wanted = false; // should be playing
  let volume = 1, muted = false, fade = 1, fadeTarget = 1;
  let errors = 0;
  let avgLow = 0, avgMid = 0, coolLow = 0, coolMid = 0, prevLow = 0, prevMid = 0, sinceKick = 0;
  const trackCbs = [], beatCbs = [], failCbs = [];

  function shuffle() {
    order = tracks.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    pos = -1;
  }

  function applyVolume() {
    const v = (muted ? 0 : volume) * fade * level;
    try { if (gain) gain.gain.value = v; else if (el) el.volume = Math.max(0, Math.min(1, v)); } catch { /* ignore */ }
  }

  function fail() {
    usable = false; wanted = false;
    try { if (el) el.pause(); } catch { /* ignore */ }
    for (const cb of failCbs) cb();
  }

  function ensure() {
    if (el) return;
    el = new Audio();
    el.preload = 'none';
    el.addEventListener('ended', () => { if (wanted) next(); });
    el.addEventListener('error', () => {
      if (!usable) return;
      if (++errors >= 2) fail(); else if (wanted) next();
    });
    el.addEventListener('playing', () => { errors = 0; });
    shuffle();
  }

  /** Route through WebAudio once a context exists (needed for the bass detector). */
  function attach(audioCtx) {
    if (!audioCtx || src || !el) return;
    try {
      ctx = audioCtx;
      src = ctx.createMediaElementSource(el);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.25;
      analyser.minDecibels = -62; analyser.maxDecibels = -14;
      bins = new Uint8Array(analyser.frequencyBinCount);
      gain = ctx.createGain();
      src.connect(analyser); analyser.connect(gain); gain.connect(ctx.destination);
      el.volume = 1;
      applyVolume();
    } catch { src = null; gain = null; analyser = null; }
  }

  function load(i) {
    const t = tracks[order[i]];
    el.src = base + t.file;
    for (const cb of trackCbs) cb(t);
  }

  function next() {
    if (!usable) return;
    ensure();
    pos++;
    if (pos >= order.length) { const last = order[order.length - 1]; shuffle(); if (order[0] === last && order.length > 1) order.push(order.shift()); pos = 0; }
    load(pos);
    if (wanted) start();
  }

  function start() {
    try {
      const p = el.play();
      if (p && p.catch) p.catch((err) => { if (err && err.name === 'NotSupportedError') { if (++errors >= 2) fail(); else next(); } });
    } catch { /* ignore */ }
  }

  return {
    get usable() { return usable; },
    get playing() { return usable && wanted; },
    get title() { return pos >= 0 && usable ? tracks[order[pos]].title : ''; },
    get debug() { return { t: el ? el.currentTime : -1, paused: el ? el.paused : true, avgLow, avgMid, routed: !!analyser, ctx: ctx ? ctx.state : 'none' }; },
    onTrack(cb) { trackCbs.push(cb); },
    onBeat(cb) { beatCbs.push(cb); },
    onFail(cb) { failCbs.push(cb); },
    /** Start or continue the playlist. Call from a user gesture the first time. */
    play(audioCtx) {
      if (!usable) return false;
      ensure(); attach(audioCtx);
      wanted = true; fadeTarget = 1; if (fade < 0.05) fade = 0.05;
      if (pos < 0) next(); else start();
      applyVolume();
      return true;
    },
    pause() { wanted = false; try { if (el) el.pause(); } catch { /* ignore */ } },
    /** Fade out and pause (menu, game over). */
    fadeOut() { fadeTarget = 0; },
    next() { if (usable) { const w = wanted; wanted = w; next(); } },
    setVolume(v) { volume = v; applyVolume(); },
    setMuted(m) { muted = m; applyVolume(); },
    update(dt) {
      if (!el) return;
      if (fade !== fadeTarget) {
        fade += Math.sign(fadeTarget - fade) * Math.min(Math.abs(fadeTarget - fade), dt * 1.2);
        applyVolume();
        if (fade <= 0.001 && fadeTarget === 0 && wanted) { wanted = false; try { el.pause(); } catch { /* ignore */ } }
      }
      if (!analyser || !wanted || el.paused) return;
      analyser.getByteFrequencyData(bins);
      // bass: ~40-190 Hz, snare/crack: ~1.5-4 kHz (bin width is sampleRate / 512)
      const bw = ctx.sampleRate / 512;
      let low = 0, mid = 0, nl = 0, nm = 0;
      for (let i = 1; i < bins.length; i++) {
        const f = i * bw;
        if (f < 190) { low += bins[i]; nl++; } else if (f > 1500 && f < 4000) { mid += bins[i]; nm++; }
      }
      low /= nl || 1; mid /= nm || 1;
      coolLow -= dt; coolMid -= dt; sinceKick += dt;
      // a hit = clearly above the running average and still rising; if the mix is too dense to tell,
      // keep the lights moving with a steady pulse
      if ((low > avgLow + Math.max(5, avgLow * 0.07) && low > prevLow && coolLow <= 0) || sinceKick > 0.5) { coolLow = 0.19; sinceKick = 0; for (const cb of beatCbs) cb('kick'); }
      if (mid > avgMid + Math.max(5, avgMid * 0.1) && mid > prevMid && coolMid <= 0) { coolMid = 0.22; for (const cb of beatCbs) cb('snare'); }
      prevLow = low; prevMid = mid;
      avgLow += (low - avgLow) * Math.min(1, dt * 2.5);
      avgMid += (mid - avgMid) * Math.min(1, dt * 2.5);
    },
  };
}
