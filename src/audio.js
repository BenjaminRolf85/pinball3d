// RIFFGEWITTER / ROTORSTURM / ERDABWEHR sound engine.
// Pure WebAudio synthesis: no samples, no network, no dependencies.
// All riffs and melodies are original material written for this game.

const TEMPO = { attract: 66, play: 152, multiball: 184, gameover: 84 };
const E2 = 40; // MIDI note of the low E string
const LOOKAHEAD = 0.12; // seconds of music scheduled ahead of the clock
const TICK_MS = 25;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// Music data. Riff events: [step (16ths), semitones above E2, kind, length]
// kind: 'o' open strummed power chord, 'p' palm mute, 's' short stab.
// Guitar and the overdriven chord bass play the same riff; every pattern is
// two bars of relentless eighths built from generic blues-scale moves in E/A
// (pedal tones, chromatic walk-ups, scale turnarounds).
// ---------------------------------------------------------------------------
const RIFFS = {
  // E pedal, pushes to G and A, chromatic walk-up into the octave
  A: {
    g: [
      [0, 0, 'o', 2], [2, 0, 'o', 2], [4, 0, 'o', 2], [6, 3, 'o', 2],
      [8, 0, 'o', 2], [10, 0, 'o', 2], [12, 5, 'o', 2], [14, 3, 'o', 2],
      [16, 0, 'o', 2], [18, 0, 'o', 2], [20, 0, 'o', 2], [22, 3, 'o', 2],
      [24, 0, 'o', 2], [26, 0, 'o', 2], [28, 10, 'o', 1], [29, 11, 'o', 1], [30, 12, 'o', 2],
    ],
  },
  // up to the IV chord, back home, walk-up to the V
  B: {
    ride: true,
    g: [
      [0, 5, 'o', 2], [2, 5, 'o', 2], [4, 5, 'o', 2], [6, 8, 'o', 2],
      [8, 5, 'o', 2], [10, 5, 'o', 2], [12, 10, 'o', 2], [14, 8, 'o', 2],
      [16, 0, 'o', 2], [18, 0, 'o', 2], [20, 0, 'o', 2], [22, 3, 'o', 2],
      [24, 0, 'o', 2], [26, 3, 'o', 2], [28, 5, 'o', 1], [29, 6, 'o', 1], [30, 7, 'o', 2],
    ],
  },
  // V-chord stabs, down through IV and G, blues-scale run back to the root
  C: {
    g: [
      [0, 7, 's', 2], [3, 7, 's', 2], [6, 7, 's', 2],
      [8, 5, 'o', 2], [10, 5, 'o', 2], [12, 3, 'o', 2], [14, 3, 'o', 2],
      [16, 0, 'o', 2], [18, 0, 'o', 2], [20, 0, 'o', 2], [22, 0, 'o', 2],
      [24, 12, 'o', 1], [25, 10, 'o', 1], [26, 7, 'o', 1], [27, 6, 'o', 1],
      [28, 5, 'o', 1], [29, 3, 'o', 1], [30, 0, 'o', 2],
    ],
  },
  // gallop variation: strummed eighths with muted sixteenth pick-ups
  D: {
    ride: true,
    g: [
      [0, 0, 'o', 2], [2, 0, 'p', 1], [3, 0, 'p', 1], [4, 0, 'o', 2], [6, 0, 'p', 1], [7, 0, 'p', 1],
      [8, 3, 'o', 2], [10, 3, 'p', 1], [11, 3, 'p', 1], [12, 5, 'o', 2], [14, 6, 'o', 2],
      [16, 7, 'o', 2], [18, 7, 'p', 1], [19, 7, 'p', 1], [20, 5, 'o', 2], [22, 3, 'o', 2],
      [24, 0, 'o', 2], [26, 0, 'p', 1], [27, 0, 'p', 1], [28, 10, 'o', 2], [30, 11, 'o', 2],
    ],
  },
  // multiball: pedal gallop with descending accents
  M1: {
    g: [
      [0, 0, 'o', 2], [2, 0, 'p', 1], [3, 0, 'p', 1], [4, 7, 'o', 2], [6, 0, 'p', 1], [7, 0, 'p', 1],
      [8, 5, 'o', 2], [10, 0, 'p', 1], [11, 0, 'p', 1], [12, 3, 'o', 2], [14, 2, 'o', 2],
      [16, 0, 'o', 2], [18, 0, 'p', 1], [19, 0, 'p', 1], [20, 7, 'o', 2], [22, 0, 'p', 1], [23, 0, 'p', 1],
      [24, 10, 'o', 2], [26, 11, 'o', 2], [28, 12, 'o', 4],
    ],
  },
  M2: {
    burst: true,
    g: [
      [0, 12, 'o', 2], [2, 0, 'p', 1], [3, 0, 'p', 1], [4, 10, 'o', 2], [6, 0, 'p', 1], [7, 0, 'p', 1],
      [8, 8, 'o', 2], [10, 0, 'p', 1], [11, 0, 'p', 1], [12, 7, 'o', 2], [14, 6, 'o', 2],
      [16, 0, 'p', 1], [17, 0, 'p', 1], [18, 0, 'p', 1], [19, 0, 'p', 1], [20, 0, 'p', 1], [21, 0, 'p', 1],
      [22, 0, 'p', 1], [23, 0, 'p', 1], [24, 3, 'o', 2], [26, 5, 'o', 2], [28, 7, 'o', 4],
    ],
    // harmonised lead: [step, midi, length, harmony midi]
    lead: [
      [0, 71, 4, 67], [4, 76, 2, 72], [6, 74, 2, 71], [8, 79, 4, 76], [12, 78, 2, 74], [14, 76, 2, 72],
      [16, 83, 6, 79], [22, 81, 2, 78], [24, 79, 2, 76], [26, 81, 2, 78], [28, 83, 4, 78],
    ],
  },
  // multiball: IV-chord drive, V answer, scale run home
  M3: {
    g: [
      [0, 5, 'o', 2], [2, 5, 'p', 1], [3, 5, 'p', 1], [4, 5, 'o', 2], [6, 8, 'o', 2],
      [8, 5, 'o', 2], [10, 5, 'p', 1], [11, 5, 'p', 1], [12, 10, 'o', 2], [14, 8, 'o', 2],
      [16, 7, 'o', 2], [18, 7, 'p', 1], [19, 7, 'p', 1], [20, 7, 'o', 2], [22, 10, 'o', 2],
      [24, 7, 'o', 2], [26, 6, 'o', 1], [27, 5, 'o', 1], [28, 3, 'o', 1], [29, 2, 'o', 1], [30, 0, 'o', 2],
    ],
  },
};
const PLAY_ORDER = ['A', 'A', 'B', 'A', 'D', 'A', 'B', 'C'];
const MULTI_ORDER = ['M1', 'M1', 'M2', 'M1', 'M3', 'M1', 'M2', 'M3'];
const GAMEOVER = [
  [0, 12, 4], [4, 10, 4], [8, 8, 4], [12, 7, 4], [16, 5, 4], [20, 3, 4], [24, 2, 8], [32, 0, 16],
];
const GAMEOVER_STEPS = 48;
// sparse clean notes of the attract loop: [bar in 4-bar cycle, step, midi]
const ATTRACT_PLUCKS = [[0, 8, 59], [1, 4, 55], [1, 12, 54], [2, 8, 64], [3, 6, 62], [3, 12, 59]];

function indexEvents(list) {
  const map = new Map();
  for (const ev of list) map.set(ev[0], ev);
  return map;
}
for (const k of Object.keys(RIFFS)) {
  RIFFS[k].gMap = indexEvents(RIFFS[k].g);
  if (RIFFS[k].lead) RIFFS[k].leadMap = indexEvents(RIFFS[k].lead);
}
const GAMEOVER_MAP = indexEvents(GAMEOVER);

// ---------------------------------------------------------------------------
// ROTORSTURM theme: 1960s garage / psych rock in D minor, all original.
// Fuzz riff events: [step, midi, length, 'd' = double-stop with the fifth]
// Bass: [step, midi, length]   Clean tremolo lead: [step, midi, length, bend cents]
// Built from generic vocabulary only (minor pentatonic lines, i-IV and
// bVI-V turnarounds, walking bass with chromatic approach notes).
// ---------------------------------------------------------------------------
const ROTOR_TEMPO = { attract: 60, play: 126, multiball: 150, gameover: 72 };
const ROTOR = {
  // D minor vamp, pentatonic answer with a blue note
  R1: {
    f: [
      [0, 50, 3], [3, 50, 1], [4, 53, 2], [6, 50, 2], [8, 55, 2], [10, 53, 2], [12, 50, 2], [14, 48, 2],
      [16, 50, 3], [19, 50, 1], [20, 53, 2], [22, 55, 1], [23, 56, 1], [24, 57, 4], [28, 60, 2], [30, 57, 2],
    ],
    b: [[0, 38, 4], [4, 38, 2], [6, 41, 2], [8, 43, 4], [12, 45, 2], [14, 48, 2], [16, 50, 4], [20, 48, 4], [24, 45, 4], [28, 41, 2], [30, 37, 2]],
    l: [[24, 69, 3, -200], [27, 72, 1, 0], [28, 74, 4, 0]],
  },
  // up to the IV, home again; the clean guitar sings over it
  R2: {
    f: [
      [0, 55, 3], [3, 55, 1], [4, 58, 2], [6, 55, 2], [8, 60, 2], [10, 58, 2], [12, 55, 2], [14, 53, 2],
      [16, 50, 3], [19, 50, 1], [20, 53, 2], [22, 55, 2], [24, 50, 4], [28, 48, 2], [30, 50, 2],
    ],
    b: [[0, 43, 4], [4, 46, 2], [6, 47, 2], [8, 48, 4], [12, 47, 2], [14, 45, 2], [16, 38, 4], [20, 41, 2], [22, 43, 2], [24, 45, 4], [28, 48, 2], [30, 37, 2]],
    l: [[0, 74, 6, 0], [6, 72, 2, 0], [8, 70, 4, 0], [12, 67, 4, 0], [16, 69, 8, -100], [24, 65, 4, 0], [28, 62, 4, 0]],
  },
  // turnaround: bVI to V, arpeggio up into the next round
  R3: {
    f: [
      [0, 46, 4, 'd'], [4, 46, 2], [6, 48, 2], [8, 50, 2], [10, 53, 2], [12, 50, 2], [14, 48, 2],
      [16, 45, 4, 'd'], [20, 45, 2], [22, 48, 2], [24, 49, 2], [26, 52, 2], [28, 55, 2], [30, 57, 2],
    ],
    b: [[0, 34, 4], [4, 34, 2], [6, 41, 2], [8, 46, 4], [12, 45, 2], [14, 44, 2], [16, 33, 4], [20, 33, 2], [22, 40, 2], [24, 45, 4], [28, 43, 2], [30, 37, 2]],
    l: [[16, 76, 4, -200], [20, 73, 4, 0], [24, 69, 8, 0]],
  },
  // stop-time stabs, then a pentatonic run down
  R4: {
    stops: [0, 3, 6],
    f: [
      [0, 50, 2, 'd'], [3, 50, 2, 'd'], [6, 50, 2, 'd'], [10, 53, 1], [11, 55, 1], [12, 57, 2], [14, 60, 2],
      [16, 62, 2], [18, 60, 2], [20, 57, 2], [22, 55, 2], [24, 53, 2], [26, 52, 1], [27, 50, 1], [28, 48, 2], [30, 50, 2],
    ],
    b: [[0, 38, 2], [3, 38, 2], [6, 38, 2], [10, 41, 1], [11, 43, 1], [12, 45, 2], [14, 48, 2], [16, 50, 4], [20, 45, 4], [24, 41, 4], [28, 40, 2], [30, 37, 2]],
  },
  // multiball: urgent eighth-note drive, fuzz doubled an octave up, organ swells
  X1: {
    chords: ['Dm', 'Dm'],
    f: [
      [0, 50, 2], [2, 50, 2], [4, 57, 2], [6, 50, 2], [8, 60, 2], [10, 50, 2], [12, 58, 1], [13, 57, 1], [14, 55, 2],
      [16, 50, 2], [18, 50, 2], [20, 57, 2], [22, 50, 2], [24, 62, 2], [26, 60, 2], [28, 57, 2], [30, 55, 2],
    ],
  },
  X2: {
    chords: ['G', 'A'],
    f: [
      [0, 55, 2], [2, 55, 2], [4, 62, 2], [6, 55, 2], [8, 65, 2], [10, 55, 2], [12, 64, 1], [13, 62, 1], [14, 60, 2],
      [16, 57, 2], [18, 57, 2], [20, 64, 2], [22, 57, 2], [24, 61, 2], [26, 64, 2], [28, 67, 2], [30, 69, 2],
    ],
  },
  X3: {
    chords: ['Bb', 'Dm'],
    f: [
      [0, 46, 4, 'd'], [4, 46, 2], [6, 46, 2], [8, 48, 4, 'd'], [12, 48, 2], [14, 48, 2],
      [16, 50, 4, 'd'], [20, 50, 2], [22, 53, 2], [24, 55, 2], [26, 57, 2], [28, 60, 2], [30, 62, 2],
    ],
  },
};
const ROTOR_PLAY_ORDER = ['R1', 'R1', 'R2', 'R1', 'R4', 'R1', 'R2', 'R3'];
const ROTOR_MULTI_ORDER = ['X1', 'X1', 'X2', 'X1', 'X3', 'X1', 'X2', 'X3'];
// organ voicings for the multiball swells
const OCHORD = { Dm: [62, 65, 69, 74], G: [55, 62, 67, 71], A: [57, 61, 64, 69], Bb: [58, 62, 65, 70] };
// night-jungle tremolo figure: [bar in 4-bar cycle, step, midi, length]
const ROTOR_ATTRACT = [[0, 0, 62, 8], [0, 8, 57, 8], [1, 0, 65, 12], [1, 12, 64, 4], [2, 0, 60, 8], [2, 8, 62, 8], [3, 0, 57, 14]];
// game over: descending clean line over i-VI-iv-V, then a ringing D minor chord (step 32)
const ROTOR_GAMEOVER = [[0, 69, 4], [4, 67, 4], [8, 65, 4], [12, 64, 4], [16, 62, 4], [20, 60, 2], [22, 57, 2], [24, 58, 8], [32, 0, 16]];
const ROTOR_GAMEOVER_BASS = new Map([[0, 38], [8, 34], [16, 31], [24, 33]]);
const ROTOR_GAMEOVER_STEPS = 48;
for (const k of Object.keys(ROTOR)) {
  ROTOR[k].fMap = indexEvents(ROTOR[k].f);
  if (ROTOR[k].b) ROTOR[k].bMap = indexEvents(ROTOR[k].b);
  if (ROTOR[k].l) ROTOR[k].lMap = indexEvents(ROTOR[k].l);
}
const ROTOR_GAMEOVER_MAP = indexEvents(ROTOR_GAMEOVER);

// ---------------------------------------------------------------------------
// ERDABWEHR theme: dark synth / space rock in C minor (b2 and tritone colour),
// all original. Pulsing 16th-note analog bass arpeggio, gated snare, theremin
// lead with portamento, alarm stabs.
// Pattern: r = bass root per half bar (4 per 2-bar pattern), a = arp shape per
// half bar, l = theremin [step, midi, length, glide steps], st = stabs
// [step, chord, length, 'w' = rising alarm whoop], stops = stop-time hits.
// ---------------------------------------------------------------------------
const ALIEN_TEMPO = { attract: 64, play: 138, multiball: 168, gameover: 76 };
const ARP = {
  p: [0, 0, 12, 0, 0, 12, 0, 10], // 3-3-2 pulse with a b7 pickup
  q: [0, 12, 7, 12, 0, 12, 7, 3], // rolling arpeggio
  m: [0, 12, 0, 12, 0, 12, 0, 12], // octave pump
};
const ACH = { Cm: [60, 63, 67], Ab: [56, 60, 63], Bb: [58, 62, 65], X: [60, 61, 66], G: [55, 59, 62], Db: [61, 65, 68] };
const ALIEN = {
  // C pedal creeping up to the b2
  P0: { r: [36, 36, 36, 37], a: 'pppp' },
  P1: { r: [36, 36, 36, 37], a: 'pppp', l: [[0, 79, 6], [6, 80, 2, 1], [8, 79, 8], [16, 75, 4], [20, 74, 4], [24, 72, 6], [30, 71, 2]] },
  // Ab to Bb, the theremin climbs
  P2: { r: [32, 32, 34, 34], a: 'qqqq', l: [[0, 72, 6], [6, 75, 2], [8, 77, 8], [16, 79, 6], [22, 77, 2], [24, 74, 8, 3]], st: [[14, 'Ab', 2], [30, 'Bb', 2]] },
  // chromatic rise F - Gb - G with alarm whoops
  P3: { r: [41, 42, 43, 43], a: 'pppq', l: [[0, 77, 8], [8, 78, 8, 2], [16, 79, 8], [24, 83, 4, 2], [28, 84, 4, 2]], st: [[24, 'X', 2, 'w'], [28, 'X', 2, 'w']] },
  // stop-time cluster hits, then a swooping wail into the next round
  P4: { r: [36, 36, 36, 31], a: 'ppqq', stops: [0, 3, 6], st: [[0, 'X', 2], [3, 'X', 2], [6, 'X', 2]], l: [[8, 67, 8], [16, 79, 12, 8], [28, 74, 4, 2]] },
  // multiball: octave pump, sequencer arp on top
  M1: { r: [36, 36, 36, 36], a: 'mmmm', seq: true, st: [[6, 'Cm', 1], [14, 'X', 2, 'w'], [22, 'Cm', 1], [30, 'X', 2, 'w']] },
  M2: { r: [32, 32, 34, 34], a: 'mmmm', seq: true, l: [[0, 84, 8, 2], [8, 82, 8], [16, 86, 12, 3], [28, 84, 4]] },
  M3: { r: [37, 37, 31, 31], a: 'qqmm', seq: true, st: [[0, 'Db', 2], [8, 'Db', 2], [16, 'G', 2, 'w'], [20, 'G', 2, 'w'], [24, 'G', 2, 'w'], [28, 'G', 2, 'w']] },
};
const ALIEN_PLAY_ORDER = ['P0', 'P1', 'P2', 'P1', 'P3', 'P0', 'P2', 'P4'];
const ALIEN_MULTI_ORDER = ['M1', 'M1', 'M2', 'M1', 'M3', 'M1', 'M2', 'M3'];
const ALIEN_SEQ = [0, 7, 12, 7, 0, 7, 12, 19]; // sequencer offsets (+2 octaves over the root)
// attract: 1950s sci-fi theremin over a dark pad: [bar in 4-bar cycle, step, midi, length, glide s]
const ALIEN_ATTRACT = [[0, 0, 67, 10], [0, 10, 68, 6], [1, 0, 67, 8], [1, 8, 63, 8], [2, 0, 66, 12, 0.5], [2, 12, 65, 4], [3, 0, 60, 14, 0.6]];
const ALIEN_PADS = [[36, 43, 48, 51], [36, 43, 48, 51], [37, 44, 49, 53], [36, 43, 48, 51]];
// game over: falling theremin over C-Ab-F-G, then a power-down slide (step 32)
const ALIEN_GAMEOVER = [[0, 79, 4], [4, 75, 4], [8, 77, 4], [12, 72, 4], [16, 75, 4], [20, 68, 4], [24, 71, 8], [32, 72, 16]];
const ALIEN_GAMEOVER_BASS = new Map([[0, 36], [8, 32], [16, 29], [24, 31]]);
for (const k of Object.keys(ALIEN)) {
  if (ALIEN[k].l) ALIEN[k].lMap = indexEvents(ALIEN[k].l);
  if (ALIEN[k].st) ALIEN[k].stMap = indexEvents(ALIEN[k].st);
}
const ALIEN_GAMEOVER_MAP = indexEvents(ALIEN_GAMEOVER);
const TEMPOS = { riff: TEMPO, rotor: ROTOR_TEMPO, alien: ALIEN_TEMPO };
const GAMEOVER_LEN = { riff: GAMEOVER_STEPS, rotor: ROTOR_GAMEOVER_STEPS, alien: 48 };

// ---------------------------------------------------------------------------
// Sfx bookkeeping: level trim, approximate length, priority, rate limit
// ---------------------------------------------------------------------------
const SFX_META = {
  flipperUp: { trim: 1.3, len: 0.08, gap: 0.03 },
  flipperDown: { trim: 1.3, len: 0.07, gap: 0.03, low: true },
  bumper: { trim: 1.5, len: 0.3, gap: 0.03 },
  sling: { trim: 1.6, len: 0.2 },
  wallHit: { trim: 1.3, len: 0.06, gap: 0.07, low: true },
  target: { trim: 1.25, len: 0.18 },
  dropTarget: { trim: 1.1, len: 0.18 },
  bankComplete: { trim: 1.0, len: 1.2, big: true },
  spinner: { trim: 2.2, len: 0.03, gap: 0.03, low: true },
  rollover: { trim: 1.35, len: 0.15, low: true },
  laneComplete: { trim: 1.3, len: 0.45 },
  rampEnter: { trim: 1.0, len: 0.55 },
  rampDone: { trim: 1.0, len: 0.6 },
  orbit: { trim: 1.6, len: 0.4 },
  skullEat: { trim: 1.0, len: 0.75 },
  skullEject: { trim: 1.1, len: 0.25 },
  lock: { trim: 1.0, len: 0.6, big: true },
  multiballStart: { trim: 1.0, len: 2.8, big: true },
  jackpot: { trim: 1.0, len: 1.0, big: true },
  superJackpot: { trim: 1.0, len: 2.2, big: true },
  extraBall: { trim: 1.0, len: 1.2, big: true },
  ballSave: { trim: 1.0, len: 0.45, big: true },
  drain: { trim: 1.0, len: 1.6, big: true },
  launch: { trim: 1.6, len: 0.35 },
  thunder: { trim: 1.3, len: 2.4 },
  flame: { trim: 2.0, len: 0.9 },
  tiltWarning: { trim: 0.8, len: 0.4, big: true },
  tilt: { trim: 0.8, len: 1.2, big: true },
  bonusTick: { trim: 1.5, len: 0.05, low: true },
  gameStart: { trim: 1.0, len: 1.9, big: true },
  gameOver: { trim: 1.0, len: 2.4, big: true },
  highScore: { trim: 1.0, len: 1.8, big: true },
  uiClick: { trim: 1.5, len: 0.04 },
  laugh: { trim: 1.3, len: 1.1, gap: 0.9, big: true },
  kickback: { trim: 1.25, len: 0.5 },
  cheer: { trim: 1.0, len: 1.6 },
  scratch: { trim: 1.1, len: 0.7, gap: 0.25 },
  micBash: { trim: 1.2, len: 0.6, gap: 0.08 },
  feedback: { trim: 0.8, len: 1.4, gap: 1.0 },
  powerChord: { trim: 0.9, len: 1.8, gap: 0.6, big: true },
  vinylSpin: { trim: 1.0, len: 0.25, gap: 0.06 },
  shriek: { trim: 0.95, len: 1.1, gap: 0.9, big: true },
  radio: { trim: 1.0, len: 0.9, gap: 0.8, big: true },
  winch: { trim: 1.0, len: 0.85, gap: 0.3 },
  smoke: { trim: 1.0, len: 1.3, gap: 0.3 },
  liftoff: { trim: 1.0, len: 2.3, gap: 1.0, big: true },
  monsoon: { trim: 1.0, len: 2.6, gap: 1.0 },
  // ---- ROTORSTURM combat and field sounds
  gunshot: { trim: 1.7, len: 0.45, gap: 0.045, low: true },
  burst: { trim: 1.0, len: 0.75, gap: 0.2 },
  mg: { trim: 0.9, len: 1.6, gap: 0.4 },
  ricochet: { trim: 1.0, len: 0.9, gap: 0.15 },
  bolt: { trim: 1.1, len: 0.35, gap: 0.2, low: true },
  casings: { trim: 1.0, len: 0.8, gap: 0.12, low: true },
  mortar: { trim: 1.0, len: 2.4, gap: 0.6, big: true },
  incoming: { trim: 1.0, len: 2.7, gap: 0.6, big: true },
  explosion: { trim: 1.0, len: 2.0, gap: 0.08, bigIf: (o) => num(o && o.size, 0.7) >= 0.8 },
  artillery: { trim: 1.0, len: 2.5, gap: 0.3 },
  barrage: { trim: 1.0, len: 3.4, gap: 2.0 },
  jet: { trim: 1.0, len: 3.0, gap: 2.5, big: true },
  airstrike: { trim: 1.0, len: 4.4, gap: 3.0, big: true },
  heliFlyby: { trim: 1.0, len: 3.5, gap: 2.5 },
  bugle: { trim: 1.0, len: 2.4, gap: 2.0, big: true },
  tunnelShot: { trim: 1.5, len: 0.6, gap: 0.08 },
  dirt: { trim: 1.0, len: 1.2, gap: 0.5 },
  dogtags: { trim: 1.0, len: 0.5, gap: 0.2 },
  alarm: { trim: 1.0, len: 3.2, gap: 2.0, big: true },
  // ---- ERDABWEHR aliens, robots and defenders
  laser: { trim: 1.8, len: 0.18, gap: 0.04 },
  laserBig: { trim: 1.0, len: 1.0, gap: 0.3, big: true },
  rayGun: { trim: 1.0, len: 0.6, gap: 0.08 },
  ufoPass: { trim: 1.0, len: 1.6, gap: 1.0, big: true },
  tractor: { trim: 1.0, len: 1.7, gap: 1.0, big: true },
  abduct: { trim: 1.0, len: 0.35, gap: 0.15 },
  release: { trim: 1.0, len: 0.8, gap: 0.3 },
  robotStep: { trim: 1.0, len: 0.6, gap: 0.15 },
  robotLaser: { trim: 1.0, len: 1.1, gap: 0.6, big: true },
  robotDown: { trim: 1.0, len: 2.1, gap: 1.5, big: true },
  tankShot: { trim: 1.0, len: 1.8, gap: 0.25, big: true },
  turret: { trim: 1.0, len: 0.65, gap: 0.3 },
  alienScreech: { trim: 0.5, len: 0.8, gap: 0.5 },
  alienChatter: { trim: 0.8, len: 0.8, gap: 0.6 },
  shield: { trim: 1.4, len: 0.5, gap: 0.06 },
  invasionAlarm: { trim: 1.0, len: 2.6, gap: 2.0, big: true },
  mothershipHit: { trim: 1.0, len: 2.8, gap: 0.5, big: true },
  powerUp: { trim: 1.5, len: 0.75, gap: 0.2 },
  teleport: { trim: 1.0, len: 0.9, gap: 0.3 },
};
const MAX_SFX = 16; // hard cap on overlapping sfx events
const SOFT_SFX = 9; // above this, low-priority sfx are dropped

export const SFX_NAMES = Object.keys(SFX_META);

export function createAudio(opts = {}) {
  let ctx = null;
  let offline = false;
  let noiseBuf = null;
  let distCurve = null;
  // graph nodes
  let musicBus, musicGate, duckGain, sfxBus, comp, muteGain;
  let gtrM, gtrS, leadM1, leadM2, leadS1, leadS2, bassIn, bassDrv, drumBus, pluckIn, droneBus;
  // ROTORSTURM instruments and shared wave tables
  let fuzzCurve = null, pulseWave = null, organWave = null;
  let fuzzM, fuzzM2, cleanIn, organIn;
  let rotor = null; // continuous helicopter loop (built on first use)
  let rotorWanted = 0;
  let amb = null; // jungle ambience bed (built on first use)
  const ambWanted = { name: null, level: 0 };
  let alarmL = null; // repeating base siren (built on first use)
  let alarmWanted = false;
  let ambInv = null; // invasion ambience bed (built on demand, torn down when off)
  let alienFx = null; // ERDABWEHR synth buses (built on first use)
  let therLast = 72; // last theremin pitch, for portamento
  let theme = 'riff';
  // optional stem multipliers, only used by the offline test ({ gtr, bass, drums })
  const mix = Object.assign({ gtr: 1, bass: 1, drums: 1 }, opts.mix || {});
  let rollSrc = null, rollFilter = null, rollGain = null;
  let timer = null;
  let silentEl = null;
  let trim = 1; // level multiplier applied by the voice helpers (set per sfx)

  const settings = { music: 0.8, sfx: 0.9, muted: false };
  const seq = { state: 'off', pending: null, pendingTheme: null, step: 0, nextTime: 0, finished: false };
  let wantedState = 'off'; // remembered when setMusic() is called before unlock()
  const beatCbs = [];
  const sustained = []; // long-ringing music voices: {g, end}
  const sfxEnds = []; // end times of running sfx events
  const lastSfx = {};
  let targetIdx = 0;

  const MUSIC_LEVEL = 0.25;
  const GTR_LEVEL = 0.21; // raw guitar sits just behind the bass
  const BASS_LEVEL = 0.28; // overdriven chord bass, up front
  const DRUM_LEVEL = 0.7;
  const MASTER_TRIM = 1.0; // level into the limiter (limiter table spans -2..2)
  const SFX_LEVEL = 1.0;
  const FUZZ_LEVEL = 0.21;
  const FUZZ2_LEVEL = 0.08;
  const CLEAN_LEVEL = 0.44;
  const ORGAN_LEVEL = 0.12;
  const ROTOR_LEVEL = 0.55;

  // -------------------------------------------------------------------------
  // graph construction
  // -------------------------------------------------------------------------
  function makeDistCurve() {
    const n = 2048;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // asymmetric tanh: the negative half clips a little softer (even harmonics)
      c[i] = x >= 0 ? Math.tanh(5.5 * x) : 0.94 * Math.tanh(4.2 * x);
    }
    return c;
  }

  function makeLimiterCurve() {
    // input is pre-scaled by 0.5, so the table covers real input -2..2;
    // output can never exceed 0.95
    const n = 4096;
    const c = new Float32Array(n);
    const k = 0.95 / Math.tanh(1.9);
    for (let i = 0; i < n; i++) {
      const x = ((i / (n - 1)) * 2 - 1) * 2;
      c[i] = k * Math.tanh(0.95 * x);
    }
    return c;
  }

  function biquad(type, freq, q, gain) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    if (gain != null) f.gain.value = gain;
    return f;
  }

  function gainNode(v) {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  }

  function chain(nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[0];
  }

  // rhythm guitar: tight pre-highpass -> drive -> waveshaper -> cabinet
  function makeGuitarChain(dest, level, opts2) {
    const input = gainNode(1);
    const ws = ctx.createWaveShaper();
    ws.curve = distCurve;
    try { ws.oversample = '2x'; } catch (e) { /* older browsers */ }
    const cabLp = biquad('lowpass', 4600, 0.8);
    chain([
      input,
      biquad('highpass', 110, 0.7),
      gainNode(1.5),
      ws,
      biquad('highpass', 90, 0.7),
      biquad('peaking', 900, 0.8, 2.5),
      biquad('peaking', 2400, 1.1, 5),
      cabLp,
      biquad('lowpass', 5400, 0.6),
      gainNode(level),
      dest,
    ]);
    if (opts2 && opts2.dynamicTone) input.cabLp = cabLp;
    return input;
  }

  function makeLeadChain(dest, level) {
    const input = gainNode(1);
    const ws = ctx.createWaveShaper();
    ws.curve = distCurve;
    chain([
      input,
      gainNode(2.2),
      ws,
      biquad('highpass', 260, 0.7),
      biquad('peaking', 1500, 1.0, 3),
      biquad('lowpass', 3600, 1.4),
      gainNode(level),
      dest,
    ]);
    return input;
  }

  // fuzz guitar: tight input, fuzz box, dark 1960s amp voicing
  function makeFuzzChain(dest, level, lp) {
    const input = gainNode(1);
    const ws = ctx.createWaveShaper();
    ws.curve = fuzzCurve;
    try { ws.oversample = '2x'; } catch (e) { /* older browsers */ }
    chain([
      input,
      biquad('highpass', 160, 0.7),
      gainNode(1.4),
      ws,
      biquad('highpass', 110, 0.7),
      biquad('peaking', 1100, 0.9, 4),
      biquad('lowpass', lp, 0.9),
      biquad('lowpass', lp * 1.3, 0.6),
      gainNode(level),
      dest,
    ]);
    return input;
  }

  function buildGraph() {
    offline = typeof ctx.startRendering === 'function';
    const sr = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, Math.floor(sr * 2), sr);
    const d = noiseBuf.getChannelData(0);
    // deterministic noise (LCG) so offline renders are reproducible
    let s = 0x2f6e2b1;
    for (let i = 0; i < d.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      d[i] = (s >>> 8) / 8388608 - 1;
    }
    distCurve = makeDistCurve();

    // master: buses -> compressor -> soft limiter -> mute -> out
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const limiter = ctx.createWaveShaper();
    limiter.curve = makeLimiterCurve();
    muteGain = gainNode(settings.muted ? 0 : 1);
    chain([comp, gainNode(0.5 * MASTER_TRIM), limiter, muteGain, ctx.destination]);

    musicBus = gainNode(settings.music * MUSIC_LEVEL);
    musicGate = gainNode(1);
    duckGain = gainNode(1);
    chain([musicGate, duckGain, musicBus, comp]);
    sfxBus = gainNode(settings.sfx * SFX_LEVEL);
    sfxBus.connect(comp);

    // music instruments
    // the music riff is monophonic, so its cabinet filter can follow each note
    // (darker for palm mutes, open for ringing chords)
    gtrM = makeGuitarChain(musicGate, GTR_LEVEL * mix.gtr, { dynamicTone: true });
    leadM1 = makeLeadChain(musicGate, 0.1);
    leadM2 = makeLeadChain(musicGate, 0.075);
    drumBus = gainNode(DRUM_LEVEL * mix.drums);
    drumBus.connect(musicGate);
    bassIn = gainNode(1);
    const bws = ctx.createWaveShaper();
    const bc = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) bc[i] = Math.tanh(2.2 * ((i / 1023) * 2 - 1));
    bws.curve = bc;
    chain([bassIn, biquad('lowpass', 520, 0.8), bws, biquad('lowpass', 1300, 0.7), gainNode(0.2 * mix.bass), musicGate]);
    // the chord bass: played like a rhythm guitar through a snarling, mid-heavy drive
    bassDrv = gainNode(1);
    const dws = ctx.createWaveShaper();
    dws.curve = distCurve;
    try { dws.oversample = '2x'; } catch (e) { /* older browsers */ }
    chain([
      bassDrv,
      biquad('highpass', 62, 0.7),
      biquad('peaking', 700, 0.9, 4),
      gainNode(2.4),
      dws,
      biquad('highpass', 55, 0.7),
      biquad('peaking', 950, 0.9, 6),
      biquad('peaking', 2100, 1.3, 4),
      biquad('lowpass', 3600, 0.7),
      gainNode(BASS_LEVEL * mix.bass),
      musicGate,
    ]);
    droneBus = gainNode(0.28);
    droneBus.connect(musicGate);
    // clean plucks with a dark feedback delay (attract mode)
    pluckIn = gainNode(1);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.34;
    const fb = gainNode(0.45);
    const dlp = biquad('lowpass', 1800, 0.7);
    pluckIn.connect(musicGate);
    chain([pluckIn, delay, dlp, fb, delay]);
    dlp.connect(musicGate);

    // ROTORSTURM instruments --------------------------------------------
    fuzzCurve = new Float32Array(2048);
    for (let i = 0; i < 2048; i++) {
      const x = (i / 2047) * 2 - 1;
      // vintage fuzz box: hard, slightly lopsided clipping, almost a square wave
      fuzzCurve[i] = x >= 0 ? Math.tanh(14 * x) : 0.86 * Math.tanh(10 * x);
    }
    fuzzM = makeFuzzChain(musicGate, FUZZ_LEVEL * mix.gtr, 2900);
    fuzzM2 = makeFuzzChain(musicGate, FUZZ2_LEVEL * mix.gtr, 4200);
    // shared wave tables: a narrow pulse (rotor blade slap) and a drawbar organ
    {
      const N = 10;
      const re = new Float32Array(N + 1), im = new Float32Array(N + 1);
      for (let n = 1; n <= N; n++) re[n] = 1 - n / (N + 1);
      pulseWave = ctx.createPeriodicWave(re, im);
      const ore = new Float32Array(9), oim = new Float32Array(9);
      oim[1] = 1; oim[2] = 0.8; oim[3] = 0.5; oim[4] = 0.45; oim[6] = 0.22; oim[8] = 0.18;
      organWave = ctx.createPeriodicWave(ore, oim);
    }
    // clean guitar: amp tremolo -> twangy EQ -> dry + short spring drip + ping-pong echo
    {
      cleanIn = gainNode(1);
      const trem = gainNode(0.62);
      const tl = ctx.createOscillator(); tl.frequency.value = 5.3;
      const tg = gainNode(0.38);
      tl.connect(tg); tg.connect(trem.gain); tl.start();
      const out = gainNode(CLEAN_LEVEL * mix.gtr);
      chain([cleanIn, trem, biquad('highpass', 140, 0.7), biquad('peaking', 2600, 1.1, 4), biquad('lowpass', 5200, 0.7), out, musicGate]);
      // spring: a short feedback comb, dark and drippy
      const sd = ctx.createDelay(0.1); sd.delayTime.value = 0.031;
      const sfb = gainNode(0.5);
      const slp = biquad('lowpass', 2600, 0.9);
      const sout = gainNode(0.3);
      out.connect(sd); chain([sd, slp, sfb, sd]); chain([slp, sout, musicGate]);
      // ping-pong echo across the stereo field
      const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
      dl.delayTime.value = 0.36; dr.delayTime.value = 0.36;
      const pfb = gainNode(0.38), plp = biquad('lowpass', 2400, 0.7);
      const send = gainNode(0.32);
      const merge = ctx.createChannelMerger(2);
      out.connect(send); send.connect(dl); dl.connect(dr); chain([dr, plp, pfb, dl]);
      dl.connect(merge, 0, 0); dr.connect(merge, 0, 1);
      merge.connect(musicGate);
    }
    // drawbar organ with a slow rotating-speaker wobble
    {
      organIn = gainNode(1);
      const les = gainNode(0.85);
      const ll = ctx.createOscillator(); ll.frequency.value = 6.4;
      const lg = gainNode(0.15);
      ll.connect(lg); lg.connect(les.gain); ll.start();
      chain([organIn, les, biquad('lowpass', 3600, 0.7), gainNode(ORGAN_LEVEL * mix.gtr), musicGate]);
    }

    // sfx instruments
    gtrS = makeGuitarChain(sfxBus, 0.3);
    leadS1 = makeLeadChain(sfxBus, 0.17);
    leadS2 = makeLeadChain(sfxBus, 0.12);
  }

  // -------------------------------------------------------------------------
  // voice helpers (all self-cleaning)
  // -------------------------------------------------------------------------
  function autoKill(src, nodes) {
    src.onended = () => {
      try {
        src.disconnect();
        for (const n of nodes) n.disconnect();
      } catch (e) { /* already gone */ }
    };
  }

  function shapeEnv(p, t, o, v) {
    const a = o.a != null ? o.a : 0.002;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (o.hold) {
      const r = o.r != null ? o.r : 0.03;
      p.setValueAtTime(v, Math.max(t + a, t + o.dur - r));
      p.linearRampToValueAtTime(0, t + o.dur);
    } else {
      p.exponentialRampToValueAtTime(Math.max(v * 0.001, 1e-5), t + o.dur);
      p.setValueAtTime(0, t + o.dur + 0.001);
    }
  }

  // oscillator with pitch sweep and decay envelope
  function tone(dest, t, o) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    const f0 = Math.max(1, o.f0);
    osc.frequency.setValueAtTime(f0, t);
    if (o.f1 && o.f1 !== o.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.ft || o.dur));
    }
    shapeEnv(g.gain, t, o, num(o.vol, 0.5) * trim);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + o.dur + 0.03);
    autoKill(osc, [g]);
  }

  // filtered noise burst
  function noise(dest, t, o) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.ftype || 'bandpass';
    f.Q.value = num(o.q, 0.8);
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.ft || o.dur));
    const g = ctx.createGain();
    shapeEnv(g.gain, t, o, num(o.vol, 0.5) * trim);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + o.dur + 0.03);
    autoKill(src, [f, g]);
  }

  // distorted power chord. kind: 'p' palm mute, 'o' open, 's' stab
  // o.ring: seconds of slow decay (final chords), o.chord: semitone stack
  function gtr(input, t, midi, dur, kind, vel, o) {
    vel = num(vel, 1);
    o = o || {};
    const pm = kind === 'p';
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    const g = ctx.createGain();
    const p = g.gain;
    let end;
    if (input.cabLp) input.cabLp.frequency.setTargetAtTime(pm ? 2300 : 4600, t, 0.004);
    if (pm) {
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(480, t + 0.09);
      end = t + Math.min(Math.max(dur * 0.95, 0.08), 0.21);
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(vel, t + 0.002);
      p.exponentialRampToValueAtTime(0.03, end - 0.012);
      p.linearRampToValueAtTime(0, end);
    } else if (o.ring) {
      f.frequency.value = 5200;
      end = t + o.ring;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(vel, t + 0.003);
      p.exponentialRampToValueAtTime(0.01, end - 0.03);
      p.linearRampToValueAtTime(0, end);
    } else {
      f.frequency.value = 5200;
      const len = kind === 's' ? dur * 0.7 : dur;
      end = t + len;
      const rel = Math.min(0.03, len * 0.3);
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(vel, t + 0.003);
      p.linearRampToValueAtTime(vel * 0.7, end - rel);
      p.linearRampToValueAtTime(0, end);
    }
    const stack = o.chord || (pm ? [[0, -7], [0, 7], [7, 0]] : [[0, -6], [0, 6], [7, 0], [12, 4]]);
    let first = null;
    const oscs = [];
    for (const [semi, det] of stack) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(midi + semi);
      osc.detune.value = det;
      osc.connect(f);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc);
      if (!first) first = osc;
    }
    f.connect(g);
    g.connect(input);
    autoKill(first, oscs.slice(1).concat([f, g]));
    return { g, end };
  }

  // singing lead voice with delayed vibrato; o.bend (cents), o.glide (target midi)
  function lead(input, t, midi, dur, vel, o) {
    vel = num(vel, 1);
    o = o || {};
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.008);
    p.setValueAtTime(vel, t + Math.max(0.01, dur - 0.04));
    p.linearRampToValueAtTime(0, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = num(o.vibRate, 5.8);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + 0.1);
    lg.gain.linearRampToValueAtTime(num(o.vib, 16), t + 0.26);
    lfo.connect(lg);
    const oscs = [];
    for (const det of [-5, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(mtof(midi), t);
      if (o.glide != null) {
        osc.frequency.exponentialRampToValueAtTime(mtof(o.glide), t + num(o.glideTime, dur));
      }
      if (o.bend) {
        osc.detune.setValueAtTime(o.bend + det, t);
        osc.detune.linearRampToValueAtTime(det, t + 0.09);
      } else {
        osc.detune.value = det;
      }
      lg.connect(osc.detune);
      osc.connect(g);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      oscs.push(osc);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.03);
    g.connect(input);
    autoKill(oscs[0], [oscs[1], lfo, lg, g]);
  }

  function bass(t, midi, dur, pm, vel) {
    const g = ctx.createGain();
    const end = t + (pm ? Math.min(dur, 0.16) : dur);
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.004);
    if (pm) {
      p.exponentialRampToValueAtTime(0.004, end);
    } else {
      p.linearRampToValueAtTime(vel * 0.75, end - 0.03);
      p.linearRampToValueAtTime(0, end);
    }
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = mtof(midi);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(midi + 12);
    o1.connect(g);
    o2.connect(g);
    g.connect(bassIn);
    o1.start(t); o2.start(t);
    o1.stop(end + 0.03); o2.stop(end + 0.03);
    autoKill(o1, [o2, g]);
  }

  // bass played as a rhythm guitar: root + fifth + octave into the drive, plus a clean sub
  function bassChord(t, midi, dur, pm, vel) {
    const g = ctx.createGain();
    const gs = ctx.createGain();
    const end = t + (pm ? Math.min(Math.max(dur * 0.9, 0.07), 0.15) : dur);
    for (const [node, v] of [[g, vel], [gs, vel * 0.8]]) {
      const p = node.gain;
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(v, t + 0.003);
      if (pm) {
        p.exponentialRampToValueAtTime(Math.max(v * 0.02, 1e-4), end - 0.01);
      } else {
        p.linearRampToValueAtTime(v * 0.78, Math.max(t + 0.004, end - Math.min(0.03, dur * 0.3)));
      }
      p.linearRampToValueAtTime(0, end);
    }
    const oscs = [];
    for (const [semi, det, type, lvl] of [[0, -6, 'sawtooth', 1], [7, 5, 'sawtooth', 0.8], [12, 3, 'square', 0.45]]) {
      const osc = ctx.createOscillator();
      const og = gainNode(lvl);
      osc.type = type;
      osc.frequency.value = mtof(midi + semi);
      osc.detune.value = det;
      osc.connect(og);
      og.connect(g);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc, og);
    }
    const sub = ctx.createOscillator();
    sub.type = 'triangle';
    sub.frequency.value = mtof(midi);
    sub.connect(gs);
    sub.start(t);
    sub.stop(end + 0.03);
    g.connect(bassDrv);
    gs.connect(bassIn);
    autoKill(oscs[0], oscs.slice(1).concat([sub, g, gs]));
  }

  function ride(dest, t, vel, bell) {
    noise(dest, t, { dur: 0.16, vol: 0.2 * vel, ftype: 'highpass', f0: 6400, q: 0.7 });
    tone(dest, t, { type: 'square', f0: bell ? 3350 : 4420, dur: bell ? 0.2 : 0.09, vol: (bell ? 0.05 : 0.025) * vel });
  }

  // laughter: glottal buzz and breath noise through open-vowel formants, one
  // falling "ha" per syllable; every call is randomised a little
  function laugh(dest, t, big) {
    const n = (big ? 8 : 5) + (Math.random() < 0.5 ? 1 : 0);
    const out = gainNode((big ? 1.25 : 1) * trim);
    const bank = gainNode(1);
    const f1 = biquad('bandpass', 900, 4.2);
    const f2 = biquad('bandpass', 1420, 6.5);
    const f3 = biquad('bandpass', 2850, 7.5);
    const g1 = gainNode(1.0), g2 = gainNode(0.8), g3 = gainNode(0.42);
    const body = biquad('lowpass', 640, 0.7);
    const gb = gainNode(0.22);
    chain([bank, f1, g1, out]);
    chain([bank, f2, g2, out]);
    chain([bank, f3, g3, out]);
    chain([bank, body, gb, out]);
    out.connect(dest);
    // source: saw + narrow pulse, a quiet sub-octave and a fast flutter for rasp
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.detune.value = 9;
    const sub = ctx.createOscillator(); sub.type = 'sawtooth';
    const g2o = gainNode(0.35), gsub = gainNode(0.22);
    const vg = gainNode(0);
    const am = gainNode(0.84);
    const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 41 + Math.random() * 14;
    const lg = gainNode(0.16);
    lfo.connect(lg); lg.connect(am.gain);
    osc.connect(vg); chain([osc2, g2o, vg]); chain([sub, gsub, vg]);
    chain([vg, am, bank]);
    // breath
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const nh = biquad('highpass', 1100, 0.7);
    const ng = gainNode(0);
    const air = biquad('bandpass', 3400, 1.2);
    const ga = gainNode(0.35);
    chain([src, nh, ng, bank]);
    chain([ng, air, ga, out]);

    const top = 455 + Math.random() * 70;
    let ts = t + 0.04;
    const peakAt = big ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0;
      const len = (big ? 0.105 : 0.115) + Math.random() * 0.03;
      const gap = 0.05 + Math.random() * 0.028 + (big && i === 4 ? 0.07 : 0);
      // phrase contour: climbs to the second/third "ha", then tumbles down
      let c = i < peakAt ? 0.92 + 0.1 * (i / peakAt) : 1.04 - 0.3 * u;
      if (big && i >= 5) c += 0.14 * (1 - (i - 5) / 4); // second wind
      const f = top * c * (1 + (Math.random() - 0.5) * 0.05);
      const a = (i < peakAt ? 0.85 : 1 - 0.42 * u) * (0.92 + 0.16 * Math.random());
      for (const [o, k] of [[osc, 1], [osc2, 1], [sub, 0.5]]) {
        o.frequency.setValueAtTime(f * 1.1 * k, ts);
        o.frequency.exponentialRampToValueAtTime(f * 0.85 * k, ts + len);
      }
      vg.gain.setValueAtTime(0, ts);
      vg.gain.linearRampToValueAtTime(a, ts + 0.016);
      vg.gain.linearRampToValueAtTime(a * 0.5, ts + len * 0.72);
      vg.gain.linearRampToValueAtTime(0, ts + len);
      ng.gain.setValueAtTime(0, ts - 0.032);
      ng.gain.linearRampToValueAtTime(0.55 * a, ts - 0.006);
      ng.gain.linearRampToValueAtTime(0.1 * a, ts + 0.03);
      ng.gain.linearRampToValueAtTime(0, ts + len);
      // the vowel opens: "h-" starts near a schwa, then the jaw drops
      f1.frequency.setValueAtTime(690, ts - 0.032);
      f1.frequency.linearRampToValueAtTime(930 + Math.random() * 70, ts + 0.035);
      ts += len + gap;
    }
    const end = ts + 0.06;
    for (const o of [osc, osc2, sub, lfo]) { o.start(t); o.stop(end); }
    src.start(t, Math.random() * 1.5); src.stop(end);
    autoKill(osc, [osc2, sub, lfo, src, g2o, gsub, vg, am, lg, nh, ng, air, ga, bank, f1, f2, f3, g1, g2, g3, body, gb, out]);
    return end - t;
  }

  // a startled comedic "Iiiieek!" (bright "ee" vowel, up-and-down glissando) and a breathy giggle
  function shriek(dest, t, big) {
    const out = gainNode((big ? 1.3 : 1) * trim);
    const soft = biquad('lowpass', 6000, 0.7);
    chain([out, soft, dest]);
    const bank = gainNode(1);
    const fa = biquad('bandpass', 300, 3), fb = biquad('bandpass', 2600, 6), fc = biquad('bandpass', 3300, 7);
    const body = biquad('lowpass', 1500, 0.8);
    const ga = gainNode(0.25), gb = gainNode(0.9), gc = gainNode(0.55), gbody = gainNode(0.32);
    chain([bank, fa, ga, out]);
    chain([bank, fb, gb, out]);
    chain([bank, fc, gc, out]);
    chain([bank, body, gbody, out]);
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.detune.value = 7;
    const g2o = gainNode(0.3);
    const vg = gainNode(0);
    osc.connect(vg); chain([osc2, g2o, vg]); vg.connect(bank);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.8 + Math.random();
    const lg = gainNode(0);
    lfo.connect(lg); lg.connect(osc.detune); lg.connect(osc2.detune);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const nh = biquad('highpass', 1800, 0.7);
    const ng = gainNode(0);
    chain([src, nh, ng, bank]);

    // the scream
    const top = 1150 + Math.random() * 150;
    const len = big ? 0.55 : 0.42 + Math.random() * 0.06;
    const ts = t + 0.02;
    for (const o of [osc, osc2]) {
      o.frequency.setValueAtTime(top * 0.78, ts);
      o.frequency.exponentialRampToValueAtTime(top, ts + 0.11);
      o.frequency.exponentialRampToValueAtTime(top * 1.02, ts + len * 0.5);
      o.frequency.exponentialRampToValueAtTime(top * 0.72, ts + len);
    }
    vg.gain.setValueAtTime(0, ts);
    vg.gain.linearRampToValueAtTime(1, ts + 0.03);
    vg.gain.linearRampToValueAtTime(0.9, ts + len * 0.7);
    vg.gain.linearRampToValueAtTime(0, ts + len);
    lg.gain.setValueAtTime(0, ts);
    lg.gain.linearRampToValueAtTime(35, ts + 0.15);
    lg.gain.setValueAtTime(0, ts + len);
    ng.gain.setValueAtTime(0, ts);
    ng.gain.linearRampToValueAtTime(0.5, ts + 0.012);
    ng.gain.linearRampToValueAtTime(0, ts + 0.07);

    // the giggle: quick, high "hi-hi-hi"
    let gt = ts + len + 0.08;
    const n = (big ? 6 : 3) + (Math.random() < 0.5 ? 1 : 0);
    const gf = 640 + Math.random() * 80;
    for (let i = 0; i < n; i++) {
      const sl = 0.05 + Math.random() * 0.025;
      const gap = 0.04 + Math.random() * 0.02;
      const f = gf * (1 - (0.06 * i) / n) * (1 + (Math.random() - 0.5) * 0.05);
      for (const o of [osc, osc2]) {
        o.frequency.setValueAtTime(f * 1.08, gt);
        o.frequency.exponentialRampToValueAtTime(f * 0.9, gt + sl);
      }
      const a = 0.55 * (1 - (0.25 * i) / n);
      vg.gain.setValueAtTime(0, gt);
      vg.gain.linearRampToValueAtTime(a, gt + 0.01);
      vg.gain.linearRampToValueAtTime(0, gt + sl);
      ng.gain.setValueAtTime(0, gt - 0.02);
      ng.gain.linearRampToValueAtTime(0.35, gt - 0.004);
      ng.gain.linearRampToValueAtTime(0, gt + 0.02);
      gt += sl + gap;
    }
    const end = gt + 0.05;
    for (const o of [osc, osc2, lfo]) { o.start(t); o.stop(end); }
    src.start(t, Math.random() * 1.5); src.stop(end);
    autoKill(osc, [osc2, lfo, src, g2o, vg, lg, nh, ng, bank, fa, fb, fc, body, ga, gb, gc, gbody, out, soft]);
    return end - t;
  }

  // field radio: squelch, garbled voice blips through a narrow, overdriven band, roger beep
  function radioCall(dest, t) {
    const pre = gainNode(0.8);
    const ws = ctx.createWaveShaper(); ws.curve = distCurve;
    const post = gainNode(0.27 * trim);
    const band = [biquad('highpass', 420, 0.8), biquad('peaking', 1700, 1.2, 6), ws, biquad('lowpass', 3100, 1), biquad('highpass', 300, 0.7), post];
    chain([pre, ...band, dest]);
    const keep = trim;
    trim = 1; // the level is applied once, by `post`
    noise(pre, t, { dur: 0.11, vol: 0.9, ftype: 'highpass', f0: 900, q: 0.7, a: 0.003 }); // squelch opens
    noise(pre, t + 0.08, { dur: 0.66, vol: 0.13, ftype: 'bandpass', f0: 2400, q: 0.6, hold: true, a: 0.01, r: 0.03 }); // carrier hiss
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const vg = gainNode(0);
    const f1 = biquad('bandpass', 500, 5), f2 = biquad('bandpass', 1500, 7);
    const g1 = gainNode(1), g2 = gainNode(0.7);
    osc.connect(vg); chain([vg, f1, g1, pre]); chain([vg, f2, g2, pre]);
    const F1 = [450, 650, 350, 580], F2 = [1150, 1750, 2150, 950];
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    let ts = t + 0.13;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const len = 0.09 + Math.random() * 0.07;
      if (ts + len > t + 0.72) break;
      const f0 = 120 + Math.random() * 60;
      osc.frequency.setValueAtTime(f0 * 1.1, ts);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, ts + len);
      f1.frequency.setValueAtTime(pick(F1), ts);
      f1.frequency.linearRampToValueAtTime(pick(F1), ts + len);
      f2.frequency.setValueAtTime(pick(F2), ts);
      f2.frequency.linearRampToValueAtTime(pick(F2), ts + len);
      vg.gain.setValueAtTime(0, ts);
      vg.gain.linearRampToValueAtTime(0.9, ts + 0.012);
      vg.gain.linearRampToValueAtTime(0.4, ts + len * 0.5);
      vg.gain.linearRampToValueAtTime(0.85, ts + len * 0.62);
      vg.gain.linearRampToValueAtTime(0, ts + len);
      ts += len + 0.03 + Math.random() * 0.04;
    }
    const ve = Math.min(ts, t + 0.74);
    tone(pre, ve + 0.02, { type: 'sine', f0: 1050, dur: 0.06, vol: 0.55, hold: true, a: 0.003, r: 0.008 }); // roger beep
    tone(pre, ve + 0.08, { type: 'sine', f0: 1400, dur: 0.06, vol: 0.55, hold: true, a: 0.003, r: 0.008 });
    noise(pre, ve + 0.15, { dur: 0.07, vol: 0.8, ftype: 'highpass', f0: 1200, q: 0.7 }); // squelch closes
    trim = keep;
    osc.start(t);
    osc.stop(ve + 0.3);
    autoKill(osc, [vg, f1, f2, g1, g2, pre, ...band]);
    return ve + 0.25 - t;
  }

  // helicopter spool-up: blade slap speeding up, turbine whine rising, wind roar
  function liftoffRoar(dest, t, dur) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = biquad('bandpass', 240, 0.9);
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(520, t + dur * 0.85);
    const am = gainNode(0.18);
    const lfo = ctx.createOscillator(); lfo.setPeriodicWave(pulseWave);
    lfo.frequency.setValueAtTime(1.6, t);
    lfo.frequency.exponentialRampToValueAtTime(7.6, t + dur * 0.82);
    const lg = gainNode(0.82), lg2 = gainNode(0.45);
    const th = ctx.createOscillator(); th.frequency.setValueAtTime(48, t); th.frequency.linearRampToValueAtTime(62, t + dur);
    const tg = gainNode(0);
    lfo.connect(lg); lg.connect(am.gain);
    lfo.connect(lg2); lg2.connect(tg.gain);
    const env = gainNode(0);
    const v = trim;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(v * 0.35, t + 0.25);
    env.gain.linearRampToValueAtTime(v, t + dur * 0.72);
    env.gain.setValueAtTime(v, t + dur - 0.45);
    env.gain.linearRampToValueAtTime(0, t + dur);
    chain([src, bp, am, env]);
    chain([th, tg, env]);
    env.connect(dest);
    // turbine whine
    const w = ctx.createOscillator(); w.type = 'sawtooth';
    w.frequency.setValueAtTime(300, t); w.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.9);
    const wbp = biquad('bandpass', 300, 5);
    wbp.frequency.setValueAtTime(300, t); wbp.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.9);
    const wg = gainNode(0);
    wg.gain.setValueAtTime(0, t);
    wg.gain.linearRampToValueAtTime(0.11 * v, t + dur * 0.6);
    wg.gain.setValueAtTime(0.11 * v, t + dur - 0.4);
    wg.gain.linearRampToValueAtTime(0, t + dur);
    chain([w, wbp, wg, dest]);
    for (const o of [lfo, th, w]) { o.start(t); o.stop(t + dur + 0.03); }
    src.start(t, Math.random()); src.stop(t + dur + 0.03);
    autoKill(src, [bp, am, lfo, lg, lg2, th, tg, env, w, wbp, wg]);
  }

  // a roaring crowd: three noise bands whose centres wander, swelling and fading
  function crowd(dest, t, dur, vel) {
    for (const [fc, q, lvl, rate, depth] of [[520, 0.9, 1.0, 2.3, 140], [1150, 1.1, 0.8, 3.7, 320], [2300, 1.4, 0.42, 5.1, 600]]) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = biquad('bandpass', fc, q);
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = rate * (0.8 + 0.4 * Math.random());
      const lg = gainNode(depth);
      lfo.connect(lg); lg.connect(f.frequency);
      const g = ctx.createGain();
      const v = lvl * vel * trim;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + dur * 0.22);
      g.gain.linearRampToValueAtTime(v * 0.8, t + dur * 0.55);
      g.gain.linearRampToValueAtTime(0, t + dur);
      chain([src, f, g, dest]);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.03);
      lfo.start(t); lfo.stop(t + dur + 0.03);
      autoKill(src, [f, lfo, lg, g]);
    }
  }

  function kick(dest, t, vel, tight) {
    tone(dest, t, { f0: 175, f1: 46, ft: 0.07, dur: tight ? 0.12 : 0.26, vol: 0.95 * vel });
    tone(dest, t, { type: 'triangle', f0: 1100, f1: 140, ft: 0.02, dur: 0.03, vol: 0.4 * vel });
  }

  function snare(dest, t, vel) {
    noise(dest, t, { dur: 0.19, vol: 0.75 * vel, ftype: 'bandpass', f0: 2100, q: 0.6 });
    noise(dest, t, { dur: 0.08, vol: 0.3 * vel, ftype: 'highpass', f0: 5200, q: 0.7 });
    tone(dest, t, { type: 'triangle', f0: 235, f1: 165, dur: 0.11, vol: 0.55 * vel });
  }

  function hat(dest, t, vel, open) {
    noise(dest, t, { dur: open ? 0.26 : 0.045, vol: 0.32 * vel, ftype: 'highpass', f0: 7600, q: 0.7 });
  }

  function crash(dest, t, vel) {
    noise(dest, t, { dur: 1.5, vol: 0.34 * vel, ftype: 'highpass', f0: 3600, q: 0.7 });
    noise(dest, t, { dur: 0.8, vol: 0.2 * vel, ftype: 'bandpass', f0: 6200, q: 2 });
  }

  function tom(dest, t, f, vel) {
    tone(dest, t, { f0: f * 1.7, f1: f, ft: 0.08, dur: 0.3, vol: 0.85 * vel });
    noise(dest, t, { dur: 0.03, vol: 0.2 * vel, ftype: 'bandpass', f0: f * 5, q: 1 });
  }

  // rolling thunder: sharp crack, then a long lumpy rumble
  function thunder(dest, t, vel, dur, distant) {
    if (!distant) noise(dest, t, { dur: 0.09, vol: 0.7 * vel, ftype: 'highpass', f0: 1800, q: 0.7 });
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = biquad('lowpass', 900, 0.9);
    f.frequency.setValueAtTime(distant ? 420 : 1100, t);
    f.frequency.exponentialRampToValueAtTime(distant ? 70 : 110, t + dur);
    const g = ctx.createGain();
    const p = g.gain;
    const v = 1.5 * vel * trim;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + (distant ? 0.35 : 0.02));
    const n = 9;
    for (let i = 1; i < n; i++) {
      const k = 1 - i / n;
      p.linearRampToValueAtTime(v * Math.pow(k, 1.4) * (0.45 + 0.55 * Math.random()), t + (dur * i) / n);
    }
    p.linearRampToValueAtTime(0, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.03);
    autoKill(src, [f, g]);
    tone(dest, t, { f0: distant ? 52 : 70, f1: 30, dur: Math.min(1.2, dur), vol: (distant ? 0.35 : 0.6) * vel, a: distant ? 0.3 : 0.002 });
  }

  // amplitude-chopped voice (growls, pick scrapes): list of sources -> filter -> AM -> dest
  function chopped(dest, t, o) {
    const f = ctx.createBiquadFilter();
    f.type = o.ftype || 'lowpass';
    f.Q.value = num(o.q, 1);
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const am = ctx.createGain();
    am.gain.value = 0.55;
    const lfo = ctx.createOscillator();
    lfo.type = o.lfoType || 'square';
    lfo.frequency.setValueAtTime(o.rate0, t);
    if (o.rate1) lfo.frequency.linearRampToValueAtTime(o.rate1, t + o.dur);
    const lg = gainNode(0.45);
    lfo.connect(lg);
    lg.connect(am.gain);
    const g = ctx.createGain();
    shapeEnv(g.gain, t, { a: num(o.a, 0.02), hold: true, r: num(o.r, 0.08), dur: o.dur }, num(o.vol, 0.5) * trim);
    const srcs = [];
    if (o.noise) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      src.connect(f);
      src.start(t, Math.random());
      src.stop(t + o.dur + 0.03);
      srcs.push(src);
    }
    for (const hz of o.saws || []) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz;
      osc.connect(f);
      osc.start(t);
      osc.stop(t + o.dur + 0.03);
      srcs.push(osc);
    }
    f.connect(am);
    am.connect(g);
    g.connect(dest);
    lfo.start(t);
    lfo.stop(t + o.dur + 0.03);
    autoKill(srcs[0], srcs.slice(1).concat([f, am, lfo, lg, g]));
  }

  function drone(t, dur) {
    const f = biquad('lowpass', 170, 4);
    f.frequency.setValueAtTime(170, t);
    f.frequency.linearRampToValueAtTime(520, t + dur * 0.55);
    f.frequency.linearRampToValueAtTime(170, t + dur);
    const g = ctx.createGain();
    const end = t + dur + 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.8);
    g.gain.setValueAtTime(0.5, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, end);
    const oscs = [];
    for (const [m, det] of [[28, -6], [40, 7], [40, -9], [47, 0]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = det;
      osc.connect(f);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc);
    }
    f.connect(g);
    g.connect(droneBus);
    autoKill(oscs[0], oscs.slice(1).concat([f, g]));
    sustained.push({ g, end });
  }

  function pluck(t, midi, vel) {
    tone(pluckIn, t, { type: 'triangle', f0: mtof(midi), dur: 1.3, vol: 0.3 * vel, a: 0.004 });
    tone(pluckIn, t, { type: 'sine', f0: mtof(midi + 12), dur: 0.5, vol: 0.1 * vel, a: 0.004 });
  }

  // clean single-coil twang: plucked saw through a closing filter, tremolo comes from the chain
  function twang(t, midi, dur, vel, o) {
    vel = num(vel, 1);
    o = o || {};
    const ring = num(o.ring, Math.max(0.35, dur * 1.5));
    const end = t + ring;
    const f = biquad('lowpass', 4600, 2.2);
    f.frequency.setValueAtTime(4600, t);
    f.frequency.exponentialRampToValueAtTime(1100, t + Math.min(0.35, ring));
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.003);
    p.exponentialRampToValueAtTime(Math.max(vel * 0.004, 1e-5), end - 0.01);
    p.linearRampToValueAtTime(0, end);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = mtof(midi);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = mtof(midi + 12);
    const og = gainNode(0.35);
    if (o.bend) {
      for (const osc of [o1, o2]) {
        osc.detune.setValueAtTime(o.bend, t);
        osc.detune.linearRampToValueAtTime(0, t + 0.12);
      }
    }
    o1.connect(f); o2.connect(og); og.connect(f);
    f.connect(g); g.connect(cleanIn);
    o1.start(t); o2.start(t);
    o1.stop(end + 0.03); o2.stop(end + 0.03);
    autoKill(o1, [o2, og, f, g]);
    return { g, end };
  }

  // fuzz guitar note (single note, or root + fifth + octave double-stop)
  function fuzzNote(input, t, midi, dur, vel, dbl) {
    vel = num(vel, 1);
    const end = t + Math.max(0.05, dur);
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.004);
    p.linearRampToValueAtTime(vel * 0.8, Math.max(t + 0.006, end - Math.min(0.035, dur * 0.3)));
    p.linearRampToValueAtTime(0, end);
    const voices = dbl ? [[0, -5, 'sawtooth'], [7, 4, 'sawtooth'], [12, 0, 'square']] : [[0, -5, 'sawtooth'], [0, 6, 'square']];
    const oscs = [];
    for (const [semi, det, type] of voices) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(midi + semi);
      osc.detune.value = det;
      osc.connect(g);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc);
    }
    g.connect(input);
    autoKill(oscs[0], oscs.slice(1).concat([g]));
  }

  // organ chord swelling up through the bar
  function organChord(t, notes, dur, vel) {
    const g = ctx.createGain();
    const p = g.gain;
    const end = t + dur;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel * 0.25, t + 0.03);
    p.linearRampToValueAtTime(vel, t + dur * 0.85);
    p.linearRampToValueAtTime(0, end);
    const oscs = [];
    for (const m of notes) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(organWave);
      osc.frequency.value = mtof(m);
      osc.detune.value = (Math.random() - 0.5) * 6;
      osc.connect(g);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc);
    }
    g.connect(organIn);
    autoKill(oscs[0], oscs.slice(1).concat([g]));
  }

  function tamb(dest, t, vel) {
    noise(dest, t, { dur: 0.09, vol: 0.2 * vel, ftype: 'bandpass', f0: 8200, q: 1.2 });
    noise(dest, t + 0.012, { dur: 0.06, vol: 0.1 * vel, ftype: 'highpass', f0: 6000 });
  }

  function shaker(dest, t, vel) {
    noise(dest, t, { dur: 0.06, vol: 0.12 * vel, ftype: 'bandpass', f0: 5600, q: 0.9, a: 0.018 });
  }

  // humid night drone in D
  function droneRotor(t, dur) {
    const f = biquad('lowpass', 140, 3);
    f.frequency.setValueAtTime(140, t);
    f.frequency.linearRampToValueAtTime(380, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    const end = t + dur + 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 1.2);
    g.gain.setValueAtTime(0.45, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, end);
    const oscs = [];
    for (const [m, det, type] of [[26, -5, 'sawtooth'], [38, 6, 'sawtooth'], [45, -4, 'triangle'], [50, 3, 'triangle']]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(m);
      osc.detune.value = det;
      osc.connect(f);
      osc.start(t);
      osc.stop(end + 0.03);
      oscs.push(osc);
    }
    f.connect(g);
    g.connect(droneBus);
    autoKill(oscs[0], oscs.slice(1).concat([f, g]));
    sustained.push({ g, end });
  }

  // -------------------------------------------------------------------------
  // sequencer
  // -------------------------------------------------------------------------
  function emit(type, t) {
    if (offline || !beatCbs.length) return;
    const state = seq.state;
    const lat = num(ctx.outputLatency, 0) || num(ctx.baseLatency, 0);
    const delay = Math.max(0, (t - ctx.currentTime + lat) * 1000);
    setTimeout(() => {
      for (const cb of beatCbs) {
        try { cb({ type, state, time: t }); } catch (e) { /* listener error */ }
      }
    }, delay);
  }

  const stepDur = (state) => 60 / ((TEMPOS[theme] || TEMPO)[state] || 120) / 4;

  function doKick(t, vel, tight) { kick(drumBus, t, vel, tight); emit('kick', t); }
  function doSnare(t, vel) { snare(drumBus, t, vel); emit('snare', t); }
  function doCrash(t, vel) { crash(drumBus, t, vel); emit('crash', t); }

  // one riff event: raw guitar on top of the overdriven chord bass
  function rock(ev, t, sd, acc) {
    const [, semi, kind, len] = ev;
    const dur = len * sd;
    const pm = kind === 'p';
    const v = acc * (pm ? 0.8 + 0.15 * Math.random() : 0.92 + 0.08 * Math.random());
    gtr(gtrM, t, E2 + semi, dur, kind, v);
    bassChord(t, E2 - 12 + (semi >= 12 ? semi - 12 : semi), dur * (kind === 's' ? 0.7 : 1), pm, v);
  }

  function stepPlay(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const riff = RIFFS[PLAY_ORDER[Math.floor(bar / 2) % PLAY_ORDER.length]];
    const ev = riff.gMap.get(step % 32);
    if (ev) rock(ev, t, sd, s % 4 === 0 ? 1 : 0.87);

    const bigFill = bar % 8 === 7;
    const smallFill = bar % 8 === 3;
    if (s === 0 && bar % 4 === 0) doCrash(t, 1);
    if (bigFill && s >= 8) {
      if (s < 10) doSnare(t, 0.8 + 0.1 * (s - 8));
      else tom(drumBus, t, [190, 190, 150, 150, 112, 112][s - 10], 0.9);
      if (s === 8 || s === 12) doKick(t, 0.9, true);
      return;
    }
    if (smallFill && s >= 12) {
      if (s < 14) doSnare(t, 0.85);
      else tom(drumBus, t, s === 14 ? 150 : 112, 0.9);
      if (s === 12) doKick(t, 0.9, true);
      return;
    }
    // the fast two-beat: kick on every quarter, snare on every off-beat eighth
    if (s % 4 === 0) doKick(t, s === 0 ? 1 : 0.92, true);
    else if (s % 4 === 2) doSnare(t, s === 6 || s === 14 ? 1 : 0.9);
    else if ((s === 15 && bar % 2 === 1) || (s === 7 && bar % 4 === 2)) doKick(t, 0.7, true); // push into the beat
    if (s % 2 === 0) {
      if (riff.ride) ride(drumBus, t, s % 4 === 0 ? 1 : 0.7, s % 8 === 0);
      else hat(drumBus, t, s % 4 === 0 ? 0.95 : 0.62, s === 14 && bar % 2 === 1);
    }
  }

  function stepMulti(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const slot = Math.floor(bar / 2) % MULTI_ORDER.length;
    const riff = RIFFS[MULTI_ORDER[slot]];
    const ps = step % 32;
    const ev = riff.gMap.get(ps);
    if (ev) rock(ev, t, sd, s % 4 === 0 ? 1 : 0.88);
    if (riff.leadMap) {
      const lv = riff.leadMap.get(ps);
      if (lv) {
        lead(leadM1, t, lv[1], lv[2] * sd * 0.96, 0.9);
        lead(leadM2, t, lv[3], lv[2] * sd * 0.96, 0.9, { vibRate: 5.4 });
      }
    }
    if (s === 0 && bar % 2 === 0) doCrash(t, 1);
    const fill = bar % 4 === 3 && s >= 12;
    if (fill) {
      doSnare(t, 0.7 + 0.1 * (s - 12));
      doKick(t, 0.7, true);
      return;
    }
    // double-kick bursts: under the lead section and in the back half of every second bar
    const burst = riff.burst || (bar % 2 === 1 && s >= 8);
    if (burst) {
      if (s === 4 || s === 12) { doSnare(t, 1); doKick(t, 0.5, true); }
      else doKick(t, s % 4 === 0 ? 0.95 : 0.7, true);
    } else if (s % 4 === 0) doKick(t, s === 0 ? 1 : 0.92, true);
    else if (s % 4 === 2) doSnare(t, 0.95);
    if (s % 4 === 0) hat(drumBus, t, 1.1, true);
    else if (s % 2 === 0) hat(drumBus, t, 0.5, false);
  }

  function stepAttract(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) drone(t, sd * 16);
    if (s === 0) doKick(t, 0.36);
    if (s === 3) doKick(t, 0.24);
    if (bar % 2 === 1) {
      if (s === 10 || s === 12) tom(drumBus, t, 95, 0.3);
      if (s === 13) tom(drumBus, t, 125, 0.26);
    }
    for (const [b, st, midi] of ATTRACT_PLUCKS) {
      if (b === bar % 4 && st === s) pluck(t, midi, 0.65);
    }
    if (bar % 4 === 3 && s === 8) {
      noise(droneBus, t, { dur: sd * 8, vol: 0.5, ftype: 'lowpass', f0: 120, f1: 320, a: sd * 5, hold: true, r: sd * 2.5 });
    }
  }

  function stepGameover(step, t, sd) {
    const ev = GAMEOVER_MAP.get(step);
    if (ev) {
      const [, semi, len] = ev;
      const last = step === 32;
      const v = gtr(gtrM, t, E2 + semi, len * sd, 'o', 1, last ? { ring: 4.5 } : null);
      if (last) sustained.push(v);
      bass(t, E2 - 12 + (semi >= 12 ? semi - 12 : semi), last ? 2.5 : len * sd, false, 0.9);
      doKick(t, 1);
      if (step === 0 || last) doCrash(t, 1);
    }
    if (step === 28 || step === 30) tom(drumBus, t, step === 28 ? 150 : 105, 0.9);
    if (step === 24) doSnare(t, 0.9);
  }

  // ---- ROTORSTURM sequences -------------------------------------------------
  function stepRotorPlay(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ps = step % 32;
    const pat = ROTOR[ROTOR_PLAY_ORDER[Math.floor(bar / 2) % ROTOR_PLAY_ORDER.length]];
    const tt = t + (s % 2 === 1 ? sd * 0.12 : 0); // a little shuffle on the off-sixteenths
    const loose = () => tt + (Math.random() - 0.5) * 0.006;
    const fz = pat.fMap.get(ps);
    if (fz) fuzzNote(fuzzM, tt, fz[1], fz[2] * sd * 0.94, s % 4 === 0 ? 1 : 0.86, fz[3] === 'd');
    const bs = pat.bMap && pat.bMap.get(ps);
    if (bs) bass(tt, bs[1], bs[2] * sd * 0.9, false, 1.15);
    const ld = pat.lMap && pat.lMap.get(ps);
    if (ld) twang(tt, ld[1], ld[2] * sd, 0.75, { bend: ld[3] || 0, ring: ld[2] * sd * 1.25 });

    if (s === 0 && bar % 4 === 0) doCrash(t, 0.85);
    // stop-time: only the stabs in the first bar of the pattern
    if (pat.stops && bar % 2 === 0 && s < 10) {
      if (pat.stops.includes(s)) { doKick(t, 1); doSnare(t, 0.8); }
      return;
    }
    // tom roll down the kit
    if (bar % 4 === 3 && s >= 8) {
      tom(drumBus, loose(), [210, 210, 175, 175, 145, 145, 115, 115][s - 8], 0.75 + 0.03 * (s - 8));
      if (s === 8 || s === 12) doKick(t, 0.85);
      if (s % 2 === 0) tamb(drumBus, loose(), 0.5);
      return;
    }
    if (s === 0 || s === 8 || s === 10 || (s === 7 && bar % 2 === 1)) doKick(loose(), s === 0 ? 1 : 0.85);
    if (s === 4 || s === 12) doSnare(loose(), 0.95);
    else if (s === 14 && bar % 2 === 1) snare(drumBus, loose(), 0.3); // ghost note
    if (s % 2 === 0) tamb(drumBus, loose(), s === 4 || s === 12 ? 1 : 0.6);
    else shaker(drumBus, loose(), 0.6);
  }

  function stepRotorMulti(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ps = step % 32;
    const pat = ROTOR[ROTOR_MULTI_ORDER[Math.floor(bar / 2) % ROTOR_MULTI_ORDER.length]];
    const fz = pat.fMap.get(ps);
    if (fz) {
      const v = s % 4 === 0 ? 1 : 0.88;
      const d = fz[2] * sd * 0.94;
      fuzzNote(fuzzM, t, fz[1], d, v, fz[3] === 'd');
      fuzzNote(fuzzM2, t, fz[1] + 12, d, v * 0.8, false);
      bass(t, fz[1] - 12, fz[2] * sd * 0.88, false, 1.15);
    }
    if (s === 0) organChord(t, OCHORD[pat.chords[bar % 2]], 16 * sd, 0.8);
    if (s === 0 && bar % 2 === 0) doCrash(t, 1);
    if (bar % 4 === 3 && s >= 12) {
      tom(drumBus, t, [230, 185, 145, 110][s - 12], 0.95);
      doKick(t, 0.8, true);
      return;
    }
    if (s === 0 || s === 6 || s === 8 || s === 11) doKick(t, s === 0 ? 1 : 0.88, true);
    if (s === 4 || s === 12) doSnare(t, 1);
    else if (s % 2 === 0) tom(drumBus, t, s % 4 === 0 ? 92 : 128, s % 4 === 0 ? 0.55 : 0.42); // driving floor toms
    if (s % 2 === 0) tamb(drumBus, t, s === 4 || s === 12 ? 1 : 0.7);
  }

  function stepRotorAttract(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) { droneRotor(t, sd * 16); doKick(t, 0.28); }
    if (s === 8 && bar % 2 === 1) tom(drumBus, t, 68, 0.22);
    for (const [b, st, midi, len] of ROTOR_ATTRACT) {
      if (b === bar % 4 && st === s) twang(t, midi, len * sd, 0.55, { ring: len * sd * 1.1 });
    }
    // insects in the trees
    if (s === 2 || s === 9) {
      chopped(musicGate, t, {
        noise: true, ftype: 'bandpass', f0: s === 2 ? 5400 : 4700, f1: s === 2 ? 5000 : 4500, q: 8,
        rate0: 44, rate1: 56, dur: sd * (s === 2 ? 5 : 3), vol: 0.07, a: 0.25, r: 0.3,
      });
    }
    if (s === 12 && bar % 2 === 0) {
      chopped(musicGate, t, { noise: true, ftype: 'bandpass', f0: 3600, q: 10, rate0: 8, rate1: 9, dur: sd * 3, vol: 0.06, a: 0.05, r: 0.1 });
    }
    // thunder far away
    if (bar % 4 === 2 && s === 4) thunder(droneBus, t, 0.55, 3.2, true);
  }

  function stepRotorGameover(step, t, sd) {
    const ev = ROTOR_GAMEOVER_MAP.get(step);
    if (ev) {
      if (step === 32) {
        [50, 57, 62, 65].forEach((m, i) => sustained.push(twang(t + i * 0.035, m, 0.5, 0.7, { ring: 4.8 })));
        bass(t, 38, 2.6, false, 0.85);
        doKick(t, 0.8);
        doCrash(t, 0.55);
        thunder(droneBus, t + 0.4, 0.5, 3.0, true);
      } else {
        twang(t, ev[1], ev[2] * sd, 0.85, { ring: ev[2] * sd * 1.3 });
      }
    }
    const bn = ROTOR_GAMEOVER_BASS.get(step);
    if (bn) bass(t, bn, 8 * sd * 0.95, false, 0.75);
    if (step === 0 || step === 16) doKick(t, 0.65);
    if (step === 24) tom(drumBus, t, 110, 0.5);
  }

  // ---- ERDABWEHR instruments --------------------------------------------------
  const SYN_LEVEL = 0.34;
  const THER_LEVEL = 0.3;
  const STAB_LEVEL = 0.2;

  // shared buses only (no running oscillators): bass drive, theremin, stabs, space echo
  function buildAlien() {
    const bIn = gainNode(1);
    const ws = ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) c[i] = Math.tanh(1.8 * ((i / 1023) * 2 - 1)) / Math.tanh(1.8);
    ws.curve = c;
    chain([bIn, gainNode(1.3), ws, biquad('lowpass', 2800, 0.7), gainNode(SYN_LEVEL * mix.bass), musicGate]);
    // ping-pong echo, about a dotted eighth at the play tempo
    const eIn = gainNode(1);
    const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
    dl.delayTime.value = 0.326; dr.delayTime.value = 0.326;
    const fb = gainNode(0.42), lp = biquad('lowpass', 2600, 0.7);
    const merge = ctx.createChannelMerger(2);
    eIn.connect(dl); dl.connect(dr); chain([dr, lp, fb, dl]);
    dl.connect(merge, 0, 0); dr.connect(merge, 0, 1);
    merge.connect(musicGate);
    const thIn = gainNode(1), thOut = gainNode(THER_LEVEL * mix.gtr);
    chain([thIn, biquad('highpass', 200, 0.7), biquad('lowpass', 3800, 0.7), thOut, musicGate]);
    chain([thOut, gainNode(0.45), eIn]);
    const stIn = gainNode(1), stOut = gainNode(STAB_LEVEL * mix.gtr);
    chain([stIn, biquad('highpass', 180, 0.7), stOut, musicGate]);
    chain([stOut, gainNode(0.32), eIn]);
    alienFx = { bass: bIn, ther: thIn, stab: stIn };
  }

  // analog-style bass: saw + square through a resonant lowpass with a snappy envelope
  function synBass(t, midi, dur, vel, acc) {
    const end = t + Math.max(0.06, dur);
    const f = biquad('lowpass', 400, 6);
    f.frequency.setValueAtTime(500 + 2600 * acc, t);
    f.frequency.exponentialRampToValueAtTime(240 + 160 * acc, t + Math.min(0.14, dur));
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.003);
    p.exponentialRampToValueAtTime(vel * 0.45, end - 0.012);
    p.linearRampToValueAtTime(0, end);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = mtof(midi); o1.detune.value = -8;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = mtof(midi); o2.detune.value = 8;
    const og = gainNode(0.45);
    o1.connect(f); o2.connect(og); og.connect(f);
    f.connect(g); g.connect(alienFx.bass);
    o1.start(t); o2.start(t); o1.stop(end + 0.03); o2.stop(end + 0.03);
    autoKill(o1, [o2, og, f, g]);
  }

  // theremin: sine (+ a little triangle) gliding from the last pitch, delayed wide vibrato.
  // o.from (midi), o.glide (s), o.slide [midi, s] (slide away after arriving)
  function theremin(t, midi, dur, vel, o) {
    o = o || {};
    const from = num(o.from, therLast);
    therLast = o.slide ? o.slide[0] : midi;
    const f = mtof(midi), end = t + Math.max(0.08, dur);
    const a = Math.min(0.06, dur * 0.3), r = Math.min(0.12, dur * 0.3);
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + a);
    p.setValueAtTime(vel, end - r);
    p.linearRampToValueAtTime(0, end);
    const lfo = ctx.createOscillator(); lfo.frequency.value = num(o.vibRate, 5.6);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + 0.12);
    lg.gain.linearRampToValueAtTime(f * num(o.vib, 0.016), t + 0.4);
    lfo.connect(lg);
    const gl = num(o.glide, 0.07);
    const og = gainNode(0.22);
    const oscs = ['sine', 'triangle'].map((type) => {
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.setValueAtTime(mtof(from), t);
      osc.frequency.exponentialRampToValueAtTime(f, t + gl);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(mtof(o.slide[0]), t + gl + o.slide[1]);
      lg.connect(osc.frequency);
      osc.start(t); osc.stop(end + 0.03);
      return osc;
    });
    oscs[0].connect(g); oscs[1].connect(og); og.connect(g);
    g.connect(alienFx.ther);
    lfo.start(t); lfo.stop(end + 0.03);
    autoKill(oscs[0], [oscs[1], og, lfo, lg, g]);
    return { g, end };
  }

  // square-wave chord stab; whoop: each voice scoops up an octave like an alarm chirp
  function alienStab(t, notes, dur, vel, whoop) {
    const end = t + Math.max(0.06, dur);
    const f = biquad('lowpass', 4000, 2.5);
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(700, end);
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(vel, t + 0.003);
    p.exponentialRampToValueAtTime(vel * 0.3, end - 0.01);
    p.linearRampToValueAtTime(0, end);
    const oscs = notes.map((m, i) => {
      const osc = ctx.createOscillator(); osc.type = 'square';
      osc.frequency.value = mtof(m);
      const det = i % 2 ? 7 : -7;
      if (whoop) {
        osc.detune.setValueAtTime(det - 1200, t);
        osc.detune.linearRampToValueAtTime(det, t + (end - t) * 0.6);
      } else osc.detune.value = det;
      osc.connect(f);
      osc.start(t); osc.stop(end + 0.03);
      return osc;
    });
    f.connect(g); g.connect(alienFx.stab);
    autoKill(oscs[0], oscs.slice(1).concat([f, g]));
  }

  // step-sequencer pluck (multiball)
  function seqNote(t, midi, dur, vel) {
    const end = t + Math.max(0.04, dur);
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = mtof(midi);
    const f = biquad('lowpass', 3000, 4);
    f.frequency.setValueAtTime(3400, t);
    f.frequency.exponentialRampToValueAtTime(600, end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(vel * 0.05, end);
    g.gain.linearRampToValueAtTime(0, end + 0.01);
    chain([osc, f, g, alienFx.stab]);
    osc.start(t); osc.stop(end + 0.03);
    autoKill(osc, [f, g]);
  }

  // dark detuned saw pad with a slowly breathing filter
  function alienPad(t, dur, notes, att) {
    const f = biquad('lowpass', 200, 3);
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    const end = t + dur + 0.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + num(att, 0.8));
    g.gain.setValueAtTime(0.32, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, end);
    const oscs = [];
    notes.forEach((m, i) => {
      for (const det of [-9, 9]) {
        if (i > 1 && det > 0) continue; // upper voices single, keeps it cheap
        const osc = ctx.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = mtof(m); osc.detune.value = det + (Math.random() - 0.5) * 4;
        osc.connect(f); osc.start(t); osc.stop(end + 0.03);
        oscs.push(osc);
      }
    });
    f.connect(g); g.connect(droneBus);
    autoKill(oscs[0], oscs.slice(1).concat([f, g]));
    sustained.push({ g, end });
  }

  // big snare with an 80s gated room: dense noise held flat, then slammed shut
  function gatedSnare(dest, t, vel, short) {
    snare(dest, t, vel * 0.85);
    const d = short ? 0.1 : 0.26;
    noise(dest, t + 0.004, { dur: d, vol: 0.42 * vel, ftype: 'bandpass', f0: 1500, q: 0.45, a: 0.006, hold: true, r: 0.02 });
    noise(dest, t + 0.004, { dur: d - 0.02, vol: 0.18 * vel, ftype: 'highpass', f0: 4200, q: 0.7, a: 0.004, hold: true, r: 0.02 });
    tone(dest, t, { type: 'triangle', f0: 200, f1: 150, dur: 0.16, vol: 0.3 * vel });
  }

  // syndrum: falling sine "pew" tom
  function synTom(dest, t, f, vel) {
    tone(dest, t, { f0: f * 2.4, f1: f * 0.6, ft: 0.22, dur: 0.32, vol: 0.75 * vel });
    tone(dest, t, { type: 'triangle', f0: f * 4.8, f1: f * 1.2, ft: 0.18, dur: 0.18, vol: 0.16 * vel });
    noise(dest, t, { dur: 0.025, vol: 0.2 * vel, ftype: 'bandpass', f0: f * 8, q: 1 });
  }

  function doGSnare(t, vel, short) { gatedSnare(drumBus, t, vel, short); emit('snare', t); }

  // ---- ERDABWEHR sequences ----------------------------------------------------
  function alienBassNote(pat, ps) {
    const h = ps >> 3;
    return pat.r[h] + ARP[pat.a[h]][ps & 7];
  }

  // theremin lead and stabs of a pattern position
  function alienVoices(pat, ps, t, sd) {
    const ld = pat.lMap && pat.lMap.get(ps);
    if (ld) {
      const v = theremin(t, ld[1], ld[2] * sd * 1.02, 0.9, { glide: ld[3] ? ld[3] * sd : 0.07 });
      if (ld[2] * sd > 1) sustained.push(v);
    }
    const st = pat.stMap && pat.stMap.get(ps);
    if (st) alienStab(t, ACH[st[1]], st[2] * sd * 0.9, st[3] ? 0.8 : 0.9, st[3] === 'w');
  }

  function stepAlienPlay(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ps = step % 32;
    const pat = ALIEN[ALIEN_PLAY_ORDER[Math.floor(bar / 2) % ALIEN_PLAY_ORDER.length]];
    const stop = pat.stops && bar % 2 === 0 && s < 8;
    if (stop) {
      if (pat.stops.includes(s)) synBass(t, pat.r[0], sd * 2, 1, 1);
    } else {
      synBass(t, alienBassNote(pat, ps), sd * 0.9, s % 4 === 0 ? 1 : 0.8, s % 4 === 0 ? 1 : s % 2 === 0 ? 0.5 : 0.25);
    }
    alienVoices(pat, ps, t, sd);

    if (s === 0 && bar % 4 === 0) doCrash(t, 0.8);
    if (stop) {
      if (pat.stops.includes(s)) { doKick(t, 1, true); doGSnare(t, 0.85); }
      return;
    }
    // syndrum fill down the kit
    if (bar % 8 === 7 && s >= 8) {
      if (s % 2 === 0) synTom(drumBus, t, [200, 160, 125, 95][(s - 8) >> 1], 0.9);
      else doGSnare(t, 0.4 + 0.05 * (s - 8), true);
      if (s === 8 || s === 12) doKick(t, 0.9, true);
      return;
    }
    // gated snare roll
    if (bar % 8 === 3 && s >= 12) {
      doGSnare(t, 0.55 + 0.12 * (s - 12), s < 15);
      if (s === 12) doKick(t, 0.9, true);
      return;
    }
    if (s % 4 === 0) doKick(t, s === 0 ? 1 : 0.9, true);
    if (s === 4 || s === 12) doGSnare(t, 1);
    hat(drumBus, t, s % 4 === 2 ? 0.75 : 0.3, s === 14 && bar % 2 === 1);
  }

  function stepAlienMulti(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const ps = step % 32;
    const pat = ALIEN[ALIEN_MULTI_ORDER[Math.floor(bar / 2) % ALIEN_MULTI_ORDER.length]];
    const root = pat.r[ps >> 3];
    synBass(t, alienBassNote(pat, ps), sd * 0.9, s % 4 === 0 ? 1 : 0.85, s % 4 === 0 ? 1 : 0.6);
    if (pat.seq) seqNote(t, root + 24 + ALIEN_SEQ[ps & 7], sd * 0.9, s % 4 === 0 ? 0.75 : 0.55);
    alienVoices(pat, ps, t, sd);

    if (s === 0 && bar % 2 === 0) doCrash(t, 1);
    if (bar % 4 === 3 && s >= 12) {
      synTom(drumBus, t, [210, 160, 120, 90][s - 12], 1);
      doKick(t, 0.8, true);
      return;
    }
    if (s % 4 === 0 || s === 14 || (s === 7 && bar % 2 === 1)) doKick(t, s === 0 ? 1 : 0.9, true);
    if (s === 4 || s === 12) doGSnare(t, 1);
    if (s === 15 && bar % 2 === 1) synTom(drumBus, t, 240, 0.6);
    hat(drumBus, t, s % 4 === 2 ? 0.9 : 0.35, s % 4 === 2);
  }

  function stepAlienAttract(step, t, sd) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    if (s === 0) alienPad(t, sd * 16, ALIEN_PADS[bar % 4]);
    // slow heartbeat
    if (s === 0) doKick(t, 0.34);
    if (s === 3) doKick(t, 0.22);
    for (const [b, st, midi, len, gl] of ALIEN_ATTRACT) {
      if (b === bar % 4 && st === s) {
        sustained.push(theremin(t, midi, len * sd, 0.75, { glide: num(gl, 0.12), vib: 0.02, vibRate: 5.2 }));
      }
    }
    // computer bleeps from the mothership
    if ((s === 6 || s === 13) && Math.random() < 0.6) {
      const m = [84, 87, 91, 96, 90][Math.floor(Math.random() * 5)];
      tone(alienFx.stab, t, { type: 'sine', f0: mtof(m), dur: 0.09, vol: 0.3, a: 0.003 });
    }
    if (bar % 4 === 3 && s === 8) {
      noise(droneBus, t, { dur: sd * 8, vol: 0.45, ftype: 'lowpass', f0: 100, f1: 280, a: sd * 5, hold: true, r: sd * 2.5 });
    }
  }

  function stepAlienGameover(step, t, sd) {
    const ev = ALIEN_GAMEOVER_MAP.get(step);
    if (ev) {
      if (step === 32) {
        // power down: the theremin sinks two octaves over a ringing pad
        sustained.push(theremin(t, 72, 4.2, 0.9, { glide: 0.1, slide: [48, 3.4], vib: 0.02 }));
        alienPad(t, 3.8, [36, 43, 48, 51], 0.02);
        synBass(t, 24, 2.6, 0.9, 0.5);
        doKick(t, 1);
        doGSnare(t, 0.9);
        doCrash(t, 0.7);
        alienStab(t, ACH.X, 0.5, 0.6, true);
      } else {
        theremin(t, ev[1], ev[2] * sd * 1.02, 0.9, { glide: 0.09 });
      }
    }
    const bn = ALIEN_GAMEOVER_BASS.get(step);
    if (bn) synBass(t, bn, 8 * sd * 0.95, 0.85, 0.4);
    if (step === 0 || step === 16) doKick(t, 0.7);
    if (step === 8 || step === 24) doGSnare(t, 0.55);
    if (step === 28 || step === 30) synTom(drumBus, t, step === 28 ? 150 : 110, 0.6);
  }

  function scheduleStep(state, step, t) {
    const sd = stepDur(state);
    const s = step % 16;
    trim = 1;
    if (s === 0) emit('bar', t);
    if (s % 4 === 0) emit('beat', t);
    if (theme === 'alien') {
      if (!alienFx) buildAlien();
      if (state === 'play') stepAlienPlay(step, t, sd);
      else if (state === 'multiball') stepAlienMulti(step, t, sd);
      else if (state === 'attract') stepAlienAttract(step, t, sd);
      else if (state === 'gameover') stepAlienGameover(step, t, sd);
      return;
    }
    if (theme === 'rotor') {
      if (state === 'play') stepRotorPlay(step, t, sd);
      else if (state === 'multiball') stepRotorMulti(step, t, sd);
      else if (state === 'attract') stepRotorAttract(step, t, sd);
      else if (state === 'gameover') stepRotorGameover(step, t, sd);
      return;
    }
    if (state === 'play') stepPlay(step, t, sd);
    else if (state === 'multiball') stepMulti(step, t, sd);
    else if (state === 'attract') stepAttract(step, t, sd);
    else if (state === 'gameover') stepGameover(step, t, sd);
  }

  // Schedules every music step whose start time lies before t1. The realtime
  // lookahead timer and the offline test both drive the music through this.
  function scheduleRange(t0, t1) {
    let count = 0;
    if (!ctx) return count;
    try {
      while (seq.state !== 'off' && !seq.finished && seq.nextTime < t1) {
        if (seq.pendingTheme && seq.step % 16 === 0) {
          theme = seq.pendingTheme;
          seq.pendingTheme = null;
          seq.step = 0;
        }
        if (seq.pending && seq.step % 16 === 0) {
          seq.state = seq.pending;
          seq.pending = null;
          seq.step = 0;
          if (seq.state === 'off') break;
        }
        if (seq.state === 'gameover' && seq.step >= (GAMEOVER_LEN[theme] || GAMEOVER_STEPS)) {
          seq.finished = true;
          break;
        }
        if (seq.nextTime >= t0 - 0.05) {
          scheduleStep(seq.state, seq.step, seq.nextTime);
          count++;
        }
        seq.nextTime += stepDur(seq.state);
        seq.step++;
      }
      pruneSustained(t0);
      scheduleAmbience(t0, t1);
    } catch (e) { /* never let the scheduler die */ }
    return count;
  }

  function pruneSustained(now) {
    for (let i = sustained.length - 1; i >= 0; i--) {
      if (sustained[i].end < now) sustained.splice(i, 1);
    }
  }

  function killSustained(now) {
    for (const v of sustained) {
      try {
        const p = v.g.gain;
        if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now);
        else p.cancelScheduledValues(now);
        p.setTargetAtTime(0, now, 0.03);
      } catch (e) { /* voice already ended */ }
    }
    sustained.length = 0;
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // after a long gap (hidden tab, suspended context) resync instead of
    // firing a burst of missed notes
    if (seq.state !== 'off' && !seq.finished && seq.nextTime < now - 0.03) {
      seq.nextTime = now + 0.03;
    }
    scheduleRange(now, now + LOOKAHEAD);
  }

  function startTimer() {
    if (offline || timer != null) return;
    timer = setInterval(tick, TICK_MS);
  }

  function stopTimer() {
    if (timer != null) clearInterval(timer);
    timer = null;
  }

  function applyMusic(state, immediate, force) {
    const now = ctx.currentTime;
    if (!force && state === seq.state && !(state === 'gameover' && seq.finished && immediate)) {
      seq.pending = null;
      return;
    }
    if (state === 'off') {
      seq.state = 'off';
      seq.pending = null;
      musicGate.gain.cancelScheduledValues(now);
      musicGate.gain.setTargetAtTime(0, now, 0.03);
      killSustained(now);
      return;
    }
    const cur = seq.state;
    // only play <-> multiball is quantised to the bar line; everything else
    // (game start, game over, back to attract) switches right away
    const groove = (st) => st === 'play' || st === 'multiball';
    const instant = force || immediate || seq.finished || !(groove(cur) && groove(state));
    if (!instant) {
      seq.pending = state; // switch on the next bar line
      return;
    }
    const g = musicGate.gain;
    g.cancelScheduledValues(now);
    if (cur !== 'off') {
      g.setTargetAtTime(0, now, 0.012);
      g.setTargetAtTime(1, now + 0.06, 0.012);
      killSustained(now);
    } else {
      g.setTargetAtTime(1, now, 0.01);
    }
    seq.state = state;
    seq.pending = null;
    seq.step = 0;
    seq.finished = false;
    seq.nextTime = now + (cur !== 'off' ? 0.09 : 0.05);
  }

  // -------------------------------------------------------------------------
  // sfx
  // -------------------------------------------------------------------------
  function duck(t, depth, hold) {
    const p = duckGain.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(depth, t, 0.02);
    p.setTargetAtTime(1, t + hold, 0.25);
  }


  // -------------------------------------------------------------------------
  // ROTORSTURM: weapons, explosions, aircraft, field sounds
  // -------------------------------------------------------------------------
  // per-voice output: gain -> optional lowpass -> optional pan -> dest
  function voiceOut(dest, o) {
    const g = gainNode(num(o.vol, 1));
    let tail = g;
    if (o.lp) { const f = biquad('lowpass', o.lp, 0.7); tail.connect(f); tail = f; }
    if (o.pan != null && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      tail.connect(p); tail = p;
    }
    tail.connect(dest);
    return g;
  }

  // a single rifle / machine-gun / pistol report
  function shot(dest, t, o) {
    const d = clamp01(num(o.d, 0));
    const j = 1 + (Math.random() - 0.5) * 0.14;
    const v = num(o.vel, 1) * (1 - 0.72 * d);
    const out = voiceOut(dest, { lp: num(o.lp, 9500 - 8300 * d), vol: v, pan: o.pan });
    const near = 1 - d;
    // supersonic crack: a few ms of broadband snap
    if (near > 0.15) {
      noise(out, t, { dur: 0.009, vol: 1.05 * near, ftype: 'highpass', f0: 3000 * j, q: 0.7, a: 0.0004 });
      tone(out, t, { type: 'square', f0: 2700 * j, f1: 650, dur: 0.012, vol: 0.22 * near, a: 0.0004 });
    }
    // muzzle report
    const body = o.heavy ? 640 : o.pistol ? 1150 : 920;
    noise(out, t + 0.002, { dur: o.heavy ? 0.13 : 0.1, vol: 0.95, ftype: 'bandpass', f0: body * j, f1: body * 0.5, q: 0.55, a: 0.0008 });
    noise(out, t + 0.002, { dur: 0.16, vol: o.heavy ? 0.85 : 0.7, ftype: 'lowpass', f0: 560 * j, f1: 150, q: 0.7, a: 0.0008 });
    tone(out, t, { f0: (o.heavy ? 105 : 132) * j, f1: 42, ft: 0.08, dur: 0.13, vol: o.heavy ? 0.65 : 0.5, a: 0.001 });
    // tail and echo: more of it the farther away
    noise(out, t + 0.025, { dur: 0.28 + 0.45 * d, vol: 0.1 + 0.28 * d, ftype: 'bandpass', f0: 540, f1: 250, q: 0.5, a: 0.02 });
    if (o.echo !== false) {
      noise(out, t + 0.12 + 0.12 * d, { dur: 0.12, vol: 0.13 + 0.14 * d, ftype: 'lowpass', f0: 900, q: 0.7, a: 0.004 });
      noise(out, t + 0.27 + 0.18 * d, { dur: 0.16, vol: 0.06 + 0.09 * d, ftype: 'lowpass', f0: 620, q: 0.7, a: 0.01 });
    }
  }

  // swept tone with optional vibrato (shell whistles, ricochet whine)
  function whistle(dest, t, o) {
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.pts) for (const [dt, f] of o.pts) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f), t + dt);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const extra = [];
    if (o.vib) {
      const lfo = ctx.createOscillator(); lfo.frequency.value = o.vib;
      const lg = gainNode(num(o.vibDepth, 20));
      lfo.connect(lg); lg.connect(osc.frequency);
      lfo.start(t); lfo.stop(t + o.dur + 0.05);
      extra.push(lfo, lg);
    }
    const g = ctx.createGain();
    const p = g.gain, v = num(o.vol, 0.3) * trim;
    p.setValueAtTime(0, t);
    if (o.cresc) {
      p.linearRampToValueAtTime(v * 0.12, t + 0.06);
      p.exponentialRampToValueAtTime(v, t + o.dur * 0.94);
      p.linearRampToValueAtTime(0, t + o.dur);
    } else {
      p.linearRampToValueAtTime(v, t + 0.015);
      p.setValueAtTime(v, t + o.dur * 0.35);
      p.exponentialRampToValueAtTime(v * 0.001, t + o.dur);
      p.setValueAtTime(0, t + o.dur + 0.001);
    }
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + o.dur + 0.05);
    autoKill(osc, [g].concat(extra));
  }

  // irregular low rumble (explosion body, artillery rolling over hills)
  function rumble(dest, t, o) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = biquad('lowpass', o.f0, 0.8);
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = ctx.createGain();
    const p = g.gain, v = num(o.vol, 0.8) * trim, n = 10;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + num(o.a, 0.02));
    for (let i = 1; i < n; i++) {
      const k = 1 - i / n;
      p.linearRampToValueAtTime(v * Math.pow(k, 1.5) * (0.5 + 0.5 * Math.random()), t + (o.dur * i) / n);
    }
    p.linearRampToValueAtTime(0, t + o.dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + o.dur + 0.03);
    autoKill(src, [f, g]);
  }

  function boom(dest, t, s, o) {
    o = o || {};
    const out = voiceOut(dest, { vol: num(o.vol, 1), lp: o.lp, pan: o.pan });
    noise(out, t, { dur: 0.03, vol: 0.25 + 0.75 * s, ftype: 'highpass', f0: 1400, q: 0.7, a: 0.0005 });
    noise(out, t, { dur: 0.18 + 0.15 * s, vol: 0.9, ftype: 'lowpass', f0: 3600, f1: 380, q: 0.6, a: 0.001 });
    tone(out, t, { f0: 82, f1: 26, ft: 0.35 + 0.5 * s, dur: 0.45 + 0.8 * s, vol: 0.55 + 0.45 * s, a: 0.002 });
    rumble(out, t + 0.03, { dur: 0.6 + 1.4 * s, vol: 0.35 + 0.65 * s, f0: 1500, f1: 85, a: 0.03 });
    const n = Math.round(4 + 14 * s);
    for (let i = 0; i < n; i++) {
      const at = t + 0.12 + Math.random() * (0.4 + 1.1 * s);
      noise(out, at, { dur: 0.008 + Math.random() * 0.03, vol: 0.08 + Math.random() * 0.22, ftype: 'bandpass', f0: 900 + Math.random() * 3800, q: 1.5 });
    }
  }

  function distantGun(dest, t, vel) {
    tone(dest, t, { f0: 58, f1: 33, ft: 0.5, dur: 0.95, vol: 0.6 * vel, a: 0.02 });
    noise(dest, t, { dur: 0.25, vol: 0.45 * vel, ftype: 'lowpass', f0: 420, f1: 120, q: 0.7, a: 0.01 });
    rumble(dest, t + 0.05, { dur: 2.3, vol: 0.55 * vel, f0: 360, f1: 60, a: 0.12 });
    tone(dest, t + 0.62, { f0: 50, f1: 32, dur: 0.6, vol: 0.22 * vel, a: 0.03 });
    tone(dest, t + 1.35, { f0: 46, f1: 31, dur: 0.6, vol: 0.1 * vel, a: 0.05 });
  }

  // a jet passing over: roar + turbine whine with a doppler drop, panned across
  function jetPass(dest, t, dur, vol) {
    const tc = t + dur * 0.46;
    const out = voiceOut(dest, { vol });
    let pn = null;
    if (ctx.createStereoPanner) {
      pn = ctx.createStereoPanner();
      pn.pan.setValueAtTime(-0.9, t);
      pn.pan.linearRampToValueAtTime(0.9, t + dur);
      out.disconnect(); out.connect(pn); pn.connect(dest);
    }
    const env = (g, peak) => {
      const p = g.gain;
      p.setValueAtTime(0.0001, t);
      p.exponentialRampToValueAtTime(peak * 0.08, t + dur * 0.2);
      p.exponentialRampToValueAtTime(peak, tc);
      p.exponentialRampToValueAtTime(peak * 0.18, tc + dur * 0.22);
      p.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = biquad('bandpass', 1300, 0.45);
    bp.frequency.setValueAtTime(1300, t);
    bp.frequency.exponentialRampToValueAtTime(2700, tc);
    bp.frequency.exponentialRampToValueAtTime(480, t + dur);
    const g1 = ctx.createGain(); env(g1, 1.4 * trim);
    chain([src, bp, g1, out]);
    const src2 = ctx.createBufferSource(); src2.buffer = noiseBuf; src2.loop = true;
    const lp = biquad('lowpass', 260, 0.7);
    const g2 = ctx.createGain(); env(g2, 1.0 * trim);
    chain([src2, lp, g2, out]);
    const w = ctx.createOscillator(); w.type = 'sawtooth';
    w.frequency.setValueAtTime(3600, t);
    w.frequency.exponentialRampToValueAtTime(3300, tc - 0.08);
    w.frequency.exponentialRampToValueAtTime(1500, tc + 0.45);
    w.frequency.exponentialRampToValueAtTime(1250, t + dur);
    const wbp = biquad('bandpass', 3000, 3);
    wbp.frequency.setValueAtTime(3400, t);
    wbp.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const g3 = ctx.createGain(); env(g3, 0.16 * trim);
    chain([w, wbp, g3, out]);
    for (const n of [src, src2, w]) { n.start(t, n === w ? undefined : Math.random()); n.stop(t + dur + 0.05); }
    autoKill(src, [bp, g1]); autoKill(src2, [lp, g2]); autoKill(w, [wbp, g3]);
  }

  // brass voice for the bugle
  function brass(dest, t, midi, dur, vel) {
    const f = mtof(midi);
    const lp = biquad('lowpass', 500, 1.4);
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.linearRampToValueAtTime(3400, t + 0.035);
    lp.frequency.setTargetAtTime(1900, t + 0.05, 0.09);
    const g = ctx.createGain();
    const p = g.gain, v = vel * trim;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.025);
    p.linearRampToValueAtTime(v * 0.78, t + 0.11);
    p.setValueAtTime(v * 0.78, t + Math.max(0.12, dur - 0.05));
    p.linearRampToValueAtTime(0, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.6;
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.005, t + Math.min(dur, 0.35));
    lfo.connect(lg);
    const oscs = [1, 1.004].map((k) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * k * 0.985, t);
      o.frequency.exponentialRampToValueAtTime(f * k, t + 0.03); // lip scoop into the note
      lg.connect(o.frequency);
      o.connect(lp);
      return o;
    });
    lp.connect(g); g.connect(dest);
    for (const o of oscs) { o.start(t); o.stop(t + dur + 0.03); }
    lfo.start(t); lfo.stop(t + dur + 0.03);
    autoKill(oscs[0], [oscs[1], lfo, lg, lp, g]);
  }

  function metalPing(dest, t, f, vol, dec) {
    const nyq = ctx.sampleRate * 0.42;
    tone(dest, t, { type: 'sine', f0: f, dur: dec, vol });
    if (f * 2.76 < nyq) tone(dest, t, { type: 'sine', f0: f * 2.76, dur: dec * 0.6, vol: vol * 0.5 });
    if (f * 5.4 < nyq) tone(dest, t, { type: 'sine', f0: f * 5.4, dur: dec * 0.35, vol: vol * 0.25 });
  }

  // jungle ambience: insect bed (cheap, continuous) + scheduled critters and distant war
  function buildAmbience() {
    const out = gainNode(0);
    out.connect(sfxBus);
    const mk = (fc, q, rate, depth, lvl) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = biquad('bandpass', fc, q);
      const am = gainNode(1 - depth);
      const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = rate;
      const lg = gainNode(depth);
      lfo.connect(lg); lg.connect(am.gain);
      const swell = gainNode(lvl);
      chain([src, bp, am, swell, out]);
      src.start(0, Math.random()); lfo.start();
      return swell;
    };
    const s1 = mk(5400, 7, 41, 0.85, 0.5);
    const s2 = mk(3900, 9, 27, 0.75, 0.3);
    // slow swelling of the cicada chorus
    const slow = ctx.createOscillator(); slow.frequency.value = 0.09;
    const sg = gainNode(0.25);
    slow.connect(sg); sg.connect(s1.gain); slow.start();
    // night air: a whisper of low wind
    const wsrc = ctx.createBufferSource(); wsrc.buffer = noiseBuf; wsrc.loop = true;
    chain([wsrc, biquad('lowpass', 380, 0.7), gainNode(0.12), out]);
    wsrc.start(0, Math.random());
    const ev = gainNode(1); // scheduled events
    ev.connect(out);
    amb = { out, ev, next: { frog: 0, bird: 0, gun: 0, art: 0 }, synced: false };
  }

  // invasion ambience: mothership drone (beating saws, slow throb), a faint eerie whine,
  // low air; scheduled far-away explosions, laser fire and saucers
  function buildInvasion() {
    const out = gainNode(0);
    out.connect(sfxBus);
    const h1 = ctx.createOscillator(); h1.type = 'sawtooth'; h1.frequency.value = 49;
    const h2 = ctx.createOscillator(); h2.type = 'sawtooth'; h2.frequency.value = 49.7;
    const lp = biquad('lowpass', 170, 2);
    const throb = gainNode(0.65);
    const tl = ctx.createOscillator(); tl.frequency.value = 0.23;
    const tg = gainNode(0.3);
    tl.connect(tg); tg.connect(throb.gain);
    const bl = ctx.createOscillator(); bl.frequency.value = 0.05; // the filter breathes
    const bg = gainNode(60);
    bl.connect(bg); bg.connect(lp.frequency);
    const hg = gainNode(0.08);
    h1.connect(lp); h2.connect(lp);
    chain([lp, throb, hg, out]);
    const w = ctx.createOscillator(); w.frequency.value = 1180;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.3;
    const wd = gainNode(9);
    wl.connect(wd); wd.connect(w.frequency);
    const wg = gainNode(0.012);
    chain([w, wg, out]);
    const air = ctx.createBufferSource(); air.buffer = noiseBuf; air.loop = true;
    const alp = biquad('lowpass', 260, 0.7), ag = gainNode(0.1);
    chain([air, alp, ag, out]);
    const srcs = [h1, h2, tl, bl, w, wl];
    for (const o of srcs) o.start();
    air.start(0, Math.random());
    srcs.push(air);
    const ev = gainNode(1);
    ev.connect(out);
    const now = ctx.currentTime;
    ambInv = {
      out, ev, srcs,
      nodes: [lp, throb, tg, bg, hg, wd, wg, alp, ag, ev, out],
      next: { boom: now + 4 + Math.random() * 4, laser: now + 2 + Math.random() * 3, ufo: now + 12 + Math.random() * 10 },
    };
  }

  // fade the invasion bed out, then stop and disconnect everything
  function retireInvasion(now) {
    const a = ambInv;
    ambInv = null;
    a.out.gain.cancelScheduledValues(now);
    a.out.gain.setTargetAtTime(0, now, 0.5);
    autoKill(a.srcs[0], a.srcs.slice(1).concat(a.nodes));
    for (const o of a.srcs) o.stop(now + 5);
  }

  const AMB_LEVEL = 0.32;
  const INV_LEVEL = 0.32;
  function applyAmbience() {
    const lvl = ambWanted.level > 0 ? ambWanted.level : 0;
    const jungle = ambWanted.name === 'jungle' && lvl > 0;
    const inv = ambWanted.name === 'invasion' && lvl > 0;
    const now = ctx.currentTime;
    if (amb || jungle) {
      if (!amb) buildAmbience();
      amb.out.gain.setTargetAtTime(jungle ? lvl * AMB_LEVEL : 0, now, 0.9);
      if (jungle && !amb.synced) {
        amb.synced = true;
        amb.next = { frog: now + 0.8 + Math.random(), bird: now + 1.8 + Math.random() * 2, gun: now + 6 + Math.random() * 6, art: now + 10 + Math.random() * 6 };
      }
    }
    if (inv) {
      if (!ambInv) buildInvasion();
      ambInv.out.gain.setTargetAtTime(lvl * INV_LEVEL, now, 0.9);
    } else if (ambInv) {
      retireInvasion(now);
    }
  }

  // distant laser exchange: human rifles (clean pews) or alien ray guns (falling warbles)
  function invLasers(t) {
    const out = voiceOut(ambInv.ev, { lp: 2600, vol: 0.5, pan: (Math.random() - 0.5) * 1.6 });
    const n = 2 + Math.floor(Math.random() * 4), human = Math.random() < 0.5;
    let at = t;
    for (let i = 0; i < n; i++) {
      const o = human
        ? { type: 'square', f0: 2400, f1: 420, dur: 0.12, vol: 0.14 }
        : { type: 'triangle', f0: 1200, f1: 260, dur: 0.22, vol: 0.2 };
      tone(out, at, o);
      tone(out, at + 0.21, Object.assign({}, o, { vol: o.vol * 0.3 })); // echo off the hills
      at += 0.14 + Math.random() * 0.12;
    }
  }

  function ambFrog(t) {
    const n = 2 + Math.floor(Math.random() * 3), f = 150 + Math.random() * 60;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.08 + Math.random() * 0.03);
      tone(amb.ev, at, { type: 'square', f0: f * 1.15, f1: f, dur: 0.06, vol: 0.12, a: 0.008 });
      noise(amb.ev, at, { dur: 0.05, vol: 0.12, ftype: 'bandpass', f0: f * 6, q: 6, a: 0.008 });
    }
  }
  function ambBird(t) {
    const n = 2 + Math.floor(Math.random() * 3), base = 2200 + Math.random() * 1600, up = Math.random() < 0.5;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.13 + Math.random() * 0.06);
      tone(amb.ev, at, { type: 'sine', f0: up ? base : base * 1.5, f1: up ? base * 1.5 : base * 0.9, dur: 0.08 + Math.random() * 0.07, vol: 0.06, a: 0.01 });
    }
  }
  function ambGun(t) {
    if (Math.random() < 0.55) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) shot(amb.ev, t + i * (0.3 + Math.random() * 0.5), { d: 0.9, vel: 0.9, pan: (Math.random() - 0.5) * 1.4 });
    } else {
      const out = voiceOut(amb.ev, { pan: (Math.random() - 0.5) * 1.4, vol: 1 });
      for (let at = t; at < t + 0.7; at += 0.109 * (1 + (Math.random() - 0.5) * 0.08)) shot(out, at, { d: 0.92, vel: 0.85, heavy: true, echo: false });
    }
  }

  function scheduleAmbience(t0, t1) {
    if (!(ambWanted.level > 0)) return;
    const jungle = amb && ambWanted.name === 'jungle';
    const inv = ambInv && ambWanted.name === 'invasion';
    if (!jungle && !inv) return;
    const nx = jungle ? amb.next : ambInv.next;
    for (const k of Object.keys(nx)) if (nx[k] < t0 - 0.5) nx[k] = t0 + 0.2 + Math.random() * 2; // resync after a gap
    const saved = trim;
    trim = 1;
    try {
      if (jungle) {
        while (nx.frog < t1) { ambFrog(nx.frog); nx.frog += 2 + Math.random() * 4.5; }
        while (nx.bird < t1) { ambBird(nx.bird); nx.bird += 3.5 + Math.random() * 7; }
        while (nx.gun < t1) { ambGun(nx.gun); nx.gun += 15 + Math.random() * 25; }
        while (nx.art < t1) { distantGun(voiceOut(amb.ev, { lp: 700, vol: 0.9, pan: (Math.random() - 0.5) }), nx.art, 0.9); nx.art += 18 + Math.random() * 22; }
      } else {
        while (nx.boom < t1) { distantGun(voiceOut(ambInv.ev, { lp: 600, vol: 0.8, pan: (Math.random() - 0.5) * 1.2 }), nx.boom, 0.8); nx.boom += 12 + Math.random() * 18; }
        while (nx.laser < t1) { invLasers(nx.laser); nx.laser += 5 + Math.random() * 9; }
        while (nx.ufo < t1) { saucer(voiceOut(ambInv.ev, { lp: 1100, vol: 0.4 }), nx.ufo, 4, 1); nx.ufo += 25 + Math.random() * 20; }
      }
    } finally { trim = saved; }
  }


  // hand-cranked air-raid siren wail through a slightly overdriven horn
  // up/down: seconds per rise/fall, k: pitch multiplier
  function siren(dest, t, cycles, vol, up = 0.62, down = 0.78, kf = 1) {
    const per = up + down, dur = cycles * per;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    for (const [o, k] of [[o1, kf], [o2, 1.005 * kf]]) {
      const f = o.frequency;
      f.setValueAtTime(260 * k, t);
      for (let c = 0; c < cycles; c++) {
        const t0 = t + c * per;
        f.exponentialRampToValueAtTime(820 * k, t0 + up);
        f.exponentialRampToValueAtTime(c === cycles - 1 ? 230 * k : 300 * k, t0 + per);
      }
    }
    const mixg = gainNode(0.5);
    const bp = biquad('bandpass', 950, 0.9);
    const ws = ctx.createWaveShaper(); ws.curve = distCurve;
    const post = biquad('lowpass', 3200, 0.7);
    const g = ctx.createGain();
    const p = g.gain, v = vol * trim;
    p.setValueAtTime(0, t);
    for (let c = 0; c < cycles; c++) {
      const t0 = t + c * per;
      p.linearRampToValueAtTime(v * 0.55, t0 + 0.08);
      p.linearRampToValueAtTime(v, t0 + up);
      p.linearRampToValueAtTime(v * 0.45, t0 + per);
    }
    p.linearRampToValueAtTime(0, t + dur + 0.05);
    o1.connect(mixg); o2.connect(mixg);
    chain([mixg, bp, gainNode(1.6), ws, post, g, dest]);
    // big outdoor reverb: two cross-fed dark echoes
    const d1 = ctx.createDelay(1), d2 = ctx.createDelay(1);
    d1.delayTime.value = 0.17; d2.delayTime.value = 0.29;
    const fb = gainNode(0.42), wet = gainNode(0.45), lp = biquad('lowpass', 1600, 0.7);
    g.connect(d1); chain([d1, d2, lp, fb, d1]); lp.connect(wet); wet.connect(dest);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    autoKill(o1, [o2, mixg, bp, ws, post, g]);
    // let the echo network ring out, then cut it loose
    const tail = ctx.createConstantSource ? ctx.createConstantSource() : null;
    if (tail) { const z = gainNode(0); tail.connect(z); z.connect(d1); tail.start(t); tail.stop(t + dur + 2.5); autoKill(tail, [z, d1, d2, fb, wet, lp]); }
    return dur;
  }

  function buildAlarmLoop() {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 540;
    const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 543;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 1 / 3; // one rise and fall every 3 s
    const depth = gainNode(260), depth2 = gainNode(260);
    lfo.connect(depth); depth.connect(osc.frequency);
    lfo.connect(depth2); depth2.connect(osc2.frequency);
    const am = gainNode(0.7), amd = gainNode(0.3);
    lfo.connect(amd); amd.connect(am.gain);
    const mixg = gainNode(0.5);
    const out = gainNode(0);
    osc.connect(mixg); osc2.connect(mixg);
    chain([mixg, biquad('bandpass', 900, 0.9), biquad('lowpass', 2600, 0.7), am, out, sfxBus]);
    const d = ctx.createDelay(1); d.delayTime.value = 0.23;
    const fb = gainNode(0.35), wet = gainNode(0.3);
    out.connect(d); chain([d, biquad('lowpass', 1400, 0.7), fb, d]); fb.connect(wet); wet.connect(sfxBus);
    osc.start(); osc2.start(); lfo.start();
    alarmL = { out };
  }

  const ALARM_LOOP_LEVEL = 0.16;
  function applyAlarmLoop() {
    if (!alarmL) { if (!alarmWanted) return; buildAlarmLoop(); }
    const now = ctx.currentTime;
    const p = alarmL.out.gain;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(alarmWanted ? ALARM_LOOP_LEVEL : 0, now, alarmWanted ? 0.25 : 0.12); // ~0.5 s fade out
  }

  // -------------------------------------------------------------------------
  // ERDABWEHR: saucers, beams, robots, creature voices
  // -------------------------------------------------------------------------
  // flying saucer passing by: hum + wobbling whine with a doppler drop, whoosh, panned across
  function saucer(dest, t, dur, vol) {
    const tc = t + dur * 0.5;
    const out = voiceOut(dest, { vol: 1 });
    const extra = [];
    if (ctx.createStereoPanner) {
      const pn = ctx.createStereoPanner();
      pn.pan.setValueAtTime(-0.9, t); pn.pan.linearRampToValueAtTime(0.9, t + dur);
      out.disconnect(); out.connect(pn); pn.connect(dest);
      extra.push(pn);
    }
    const env = out.gain;
    env.setValueAtTime(0.0001, t);
    env.exponentialRampToValueAtTime(vol * trim, tc);
    env.exponentialRampToValueAtTime(0.0001, t + dur);
    // doppler: slightly sharp while approaching, flat after passing
    const dop = (prm, f) => {
      prm.setValueAtTime(f * 1.1, t);
      prm.exponentialRampToValueAtTime(f * 1.06, tc - 0.08);
      prm.exponentialRampToValueAtTime(f * 0.92, tc + 0.22);
      prm.exponentialRampToValueAtTime(f * 0.9, t + dur);
    };
    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; dop(hum.frequency, 96);
    const hlp = biquad('lowpass', 420, 1.2), hg = gainNode(0.5);
    chain([hum, hlp, hg, out]);
    const w = ctx.createOscillator(); dop(w.frequency, 540);
    const vib = ctx.createOscillator(); vib.frequency.value = 7.5;
    const vg = gainNode(45);
    vib.connect(vg); vg.connect(w.frequency);
    const wg = gainNode(0.22);
    chain([w, wg, out]);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = biquad('bandpass', 700, 0.8);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(2600, tc);
    bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const ng = gainNode(0.5);
    chain([src, bp, ng, out]);
    for (const n of [hum, w, vib]) { n.start(t); n.stop(t + dur + 0.05); }
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    autoKill(src, [hum, hlp, hg, w, vib, vg, wg, bp, ng, out].concat(extra));
  }

  // tractor beam: three warbling sines rising together, shimmering noise, low hum
  function tractorBeam(dest, t, dur) {
    const out = gainNode(0);
    const p = out.gain, v = trim;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v * 0.3, t + 0.2);
    p.linearRampToValueAtTime(v, t + dur * 0.8);
    p.linearRampToValueAtTime(0, t + dur);
    out.connect(dest);
    const nodes = [];
    for (const [k, rate, lvl] of [[1, 11, 0.22], [1.5, 13.5, 0.15], [2.02, 17, 0.1]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(260 * k, t);
      o.frequency.exponentialRampToValueAtTime(640 * k, t + dur);
      const l = ctx.createOscillator(); l.frequency.value = rate;
      const lg = gainNode(22 * k);
      l.connect(lg); lg.connect(o.frequency);
      const g = gainNode(lvl);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.03); l.start(t); l.stop(t + dur + 0.03);
      nodes.push(o, l, lg, g);
    }
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = biquad('bandpass', 3000, 9);
    bp.frequency.setValueAtTime(3000, t);
    bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
    const am = gainNode(0.5);
    const al = ctx.createOscillator(); al.type = 'square'; al.frequency.value = 26;
    const ag = gainNode(0.5);
    al.connect(ag); ag.connect(am.gain);
    chain([src, bp, am, gainNode(0.6), out]);
    src.start(t, Math.random()); src.stop(t + dur + 0.03); al.start(t); al.stop(t + dur + 0.03);
    const h = ctx.createOscillator(); h.type = 'triangle';
    h.frequency.setValueAtTime(55, t); h.frequency.linearRampToValueAtTime(82, t + dur);
    const hg = gainNode(0.3);
    chain([h, hg, out]);
    h.start(t); h.stop(t + dur + 0.03);
    autoKill(src, nodes.concat([bp, am, al, ag, h, hg, out]));
  }

  // FM creature voice: carrier + inharmonic modulator, flutter, formant bank.
  // syl: [{at, len, f: [[frac, hz]...], i0, i1, amp, fa: [hz, hz], fb: [hz, hz]}]
  function fmVoice(dest, t, o) {
    const out = gainNode(num(o.vol, 1) * trim);
    const hp = biquad('highpass', 160, 0.7);
    chain([out, hp, dest]);
    const bank = gainNode(1);
    const fa = biquad('bandpass', 900, 3), fb = biquad('bandpass', 2400, 5);
    const body = biquad('lowpass', 1600, 0.7);
    const ga = gainNode(1), gb = gainNode(0.75), gbd = gainNode(0.35);
    chain([bank, fa, ga, out]); chain([bank, fb, gb, out]); chain([bank, body, gbd, out]);
    const car = ctx.createOscillator(); car.type = o.type || 'triangle';
    const mod = ctx.createOscillator();
    const mg = gainNode(0);
    mod.connect(mg); mg.connect(car.frequency);
    const fl = ctx.createOscillator(); fl.type = 'triangle'; fl.frequency.value = num(o.flutter, 13);
    const flg = gainNode(num(o.flutterDepth, 0));
    fl.connect(flg); flg.connect(car.frequency);
    const vg = gainNode(0);
    car.connect(vg); vg.connect(bank);
    const ratio = num(o.ratio, 1.41);
    let end = t;
    for (const s of o.syl) {
      const a = t + s.at, e = a + s.len;
      s.f.forEach(([k, hz], i) => {
        const at = a + k * s.len;
        if (i === 0) { car.frequency.setValueAtTime(hz, at); mod.frequency.setValueAtTime(hz * ratio, at); }
        else { car.frequency.exponentialRampToValueAtTime(hz, at); mod.frequency.exponentialRampToValueAtTime(hz * ratio, at); }
      });
      mg.gain.setValueAtTime(s.f[0][1] * s.i0, a);
      mg.gain.linearRampToValueAtTime(s.f[s.f.length - 1][1] * s.i1, e);
      fa.frequency.setValueAtTime(s.fa[0], a); fa.frequency.linearRampToValueAtTime(s.fa[1], e);
      fb.frequency.setValueAtTime(s.fb[0], a); fb.frequency.linearRampToValueAtTime(s.fb[1], e);
      const atk = Math.min(0.02, s.len * 0.25), rel = Math.min(0.05, s.len * 0.3);
      vg.gain.setValueAtTime(0, a);
      vg.gain.linearRampToValueAtTime(s.amp, a + atk);
      vg.gain.linearRampToValueAtTime(s.amp * 0.8, e - rel);
      vg.gain.linearRampToValueAtTime(0, e);
      end = Math.max(end, e);
    }
    for (const n of [car, mod, fl]) { n.start(t); n.stop(end + 0.03); }
    autoKill(car, [mod, mg, fl, flg, vg, bank, fa, fb, body, ga, gb, gbd, out, hp]);
    return end - t;
  }

  // robot beam: two detuned saws with fast FM through a hot band, overdriven
  function screechBeam(dest, t, dur) {
    const lfo = ctx.createOscillator(); lfo.frequency.value = 37;
    const lg = gainNode(260);
    lfo.connect(lg);
    const g = ctx.createGain();
    const p = g.gain, v = 0.3 * trim;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + 0.04);
    p.setValueAtTime(v, t + dur * 0.8);
    p.linearRampToValueAtTime(0, t + dur);
    const pre = gainNode(0.5);
    const ws = ctx.createWaveShaper(); ws.curve = distCurve;
    const bp = biquad('bandpass', 2200, 1.2), lp = biquad('lowpass', 6500, 0.7);
    chain([pre, bp, ws, lp, g, dest]);
    const oscs = [1650, 1663].map((f) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.68, t + dur);
      lg.connect(o.frequency); o.connect(pre);
      o.start(t); o.stop(t + dur + 0.03);
      return o;
    });
    lfo.start(t); lfo.stop(t + dur + 0.03);
    autoKill(oscs[0], [oscs[1], lfo, lg, pre, bp, ws, lp, g]);
  }

  const SFX = {
    flipperUp(t) {
      tone(sfxBus, t, { f0: 210, f1: 70, dur: 0.07, vol: 0.8 });
      noise(sfxBus, t, { dur: 0.025, vol: 0.5, ftype: 'bandpass', f0: 2600, q: 1 });
    },
    flipperDown(t) {
      tone(sfxBus, t, { f0: 120, f1: 55, dur: 0.06, vol: 0.45 });
      noise(sfxBus, t, { dur: 0.03, vol: 0.25, ftype: 'lowpass', f0: 900 });
    },
    bumper(t, o) {
      const i = (Math.abs(o.index | 0)) % 3;
      tom(sfxBus, t, [160, 118, 88][i], 1);
      tone(sfxBus, t, { type: 'sawtooth', f0: 2600 - i * 300, f1: 180, dur: 0.14, vol: 0.26 });
      tone(sfxBus, t, { type: 'square', f0: 1500, f1: 240, dur: 0.08, vol: 0.14 });
      noise(sfxBus, t, { dur: 0.05, vol: 0.35, ftype: 'highpass', f0: 4200 });
    },
    sling(t) {
      snare(sfxBus, t, 1);
      tone(sfxBus, t, { type: 'square', f0: 950, f1: 280, dur: 0.07, vol: 0.2 });
    },
    wallHit(t, o) {
      const v = clamp01(num(o.velocity, 0.5));
      tone(sfxBus, t, { f0: 150, f1: 75, dur: 0.05, vol: 0.14 + 0.45 * v });
      noise(sfxBus, t, { dur: 0.02, vol: 0.06 + 0.22 * v, ftype: 'lowpass', f0: 1200 + 2200 * v });
    },
    target(t) {
      const n = [0, 3, 5, 7][targetIdx++ % 4];
      gtr(gtrS, t, E2 + 12 + n, 0.16, 'p', 1);
      noise(sfxBus, t, { dur: 0.03, vol: 0.4, ftype: 'bandpass', f0: 3200, q: 1.5 });
      tone(sfxBus, t, { type: 'square', f0: mtof(76 + n), dur: 0.07, vol: 0.12 });
    },
    dropTarget(t) {
      tone(sfxBus, t, { f0: 240, f1: 55, dur: 0.12, vol: 0.8 });
      noise(sfxBus, t, { dur: 0.05, vol: 0.5, ftype: 'bandpass', f0: 1500, q: 0.8 });
      gtr(gtrS, t + 0.01, E2 + 7, 0.14, 'p', 1);
    },
    bankComplete(t) {
      [0, 3, 5, 7, 10].forEach((n, i) => gtr(gtrS, t + i * 0.075, E2 + n, 0.075, 'o', 1));
      gtr(gtrS, t + 0.375, E2 + 12, 0.8, 'o', 1, { ring: 0.8 });
      crash(sfxBus, t + 0.375, 0.8);
      kick(sfxBus, t + 0.375, 1);
    },
    spinner(t, o) {
      const s = clamp01(num(o.speed, 0.5));
      tone(sfxBus, t, { type: 'square', f0: 500 + 1100 * s, dur: 0.028, vol: 0.16 });
      noise(sfxBus, t, { dur: 0.012, vol: 0.2, ftype: 'highpass', f0: 5000 });
    },
    rollover(t) {
      tone(sfxBus, t, { f0: 990, dur: 0.07, vol: 0.3 });
      tone(sfxBus, t + 0.05, { f0: 1480, dur: 0.1, vol: 0.3 });
    },
    laneComplete(t) {
      [76, 79, 83, 88].forEach((m, i) => {
        tone(sfxBus, t + i * 0.055, { type: 'triangle', f0: mtof(m), dur: 0.2, vol: 0.34 });
      });
      noise(sfxBus, t + 0.16, { dur: 0.3, vol: 0.14, ftype: 'highpass', f0: 6500 });
    },
    rampEnter(t) {
      noise(sfxBus, t, { dur: 0.55, vol: 0.5, ftype: 'bandpass', f0: 500, f1: 4500, q: 2, a: 0.3, hold: true, r: 0.1 });
      tone(gtrS, t, { type: 'sawtooth', f0: 140, f1: 900, dur: 0.5, vol: 0.5, a: 0.05, hold: true, r: 0.06 });
    },
    rampDone(t) {
      gtr(gtrS, t, E2 + 5, 0.09, 'o', 1);
      gtr(gtrS, t + 0.09, E2 + 7, 0.09, 'o', 1);
      gtr(gtrS, t + 0.18, E2 + 12, 0.4, 'o', 1);
      tone(sfxBus, t + 0.18, { f0: 1760, dur: 0.3, vol: 0.2 });
    },
    orbit(t) {
      noise(sfxBus, t, { dur: 0.4, vol: 0.55, ftype: 'bandpass', f0: 2600, f1: 500, q: 3, a: 0.1 });
      tone(sfxBus, t, { f0: 400, f1: 1600, dur: 0.3, vol: 0.28, a: 0.05 });
    },
    skullEat(t) {
      chopped(gtrS, t, { saws: [55, 58.3, 82.6], f0: 700, f1: 260, q: 2, rate0: 34, rate1: 19, dur: 0.6, vol: 0.9, a: 0.03 });
      tone(sfxBus, t, { f0: 95, f1: 48, dur: 0.6, vol: 0.5, a: 0.03 });
      tone(sfxBus, t + 0.52, { f0: 330, f1: 70, dur: 0.18, vol: 0.85 });
      noise(sfxBus, t + 0.52, { dur: 0.08, vol: 0.3, ftype: 'lowpass', f0: 700 });
    },
    skullEject(t) {
      tone(sfxBus, t, { f0: 80, f1: 520, ft: 0.06, dur: 0.1, vol: 0.75 });
      noise(sfxBus, t, { dur: 0.12, vol: 0.5, ftype: 'highpass', f0: 2500 });
      gtr(gtrS, t + 0.02, E2 + 10, 0.22, 's', 1);
    },
    lock(t) {
      tone(sfxBus, t, { type: 'square', f0: 523, dur: 0.3, vol: 0.2 });
      tone(sfxBus, t, { type: 'square', f0: 811, dur: 0.25, vol: 0.16 });
      tone(sfxBus, t, { type: 'square', f0: 1243, dur: 0.2, vol: 0.12 });
      tone(sfxBus, t, { f0: 120, f1: 55, dur: 0.16, vol: 0.8 });
      gtr(gtrS, t + 0.05, E2 + 7, 0.5, 'o', 1);
    },
    multiballStart(t) {
      duck(t, 0.3, 2.4);
      gtr(gtrS, t, E2, 2.6, 'o', 1, { ring: 2.6, chord: [[0, -6], [0, 6], [7, 0], [12, 4], [19, -3]] });
      crash(sfxBus, t, 1.2);
      kick(sfxBus, t, 1.2);
      thunder(sfxBus, t + 0.05, 1, 2.5);
      lead(leadS1, t + 0.12, 90, 1.9, 1, { glide: 45, glideTime: 1.8, vib: 40, vibRate: 7.5 });
      lead(leadS2, t + 0.12, 83, 1.9, 0.9, { glide: 38, glideTime: 1.8, vib: 40, vibRate: 6.5 });
    },
    jackpot(t) {
      duck(t, 0.45, 0.9);
      [0, 7, 12].forEach((n, i) => gtr(gtrS, t + i * 0.06, E2 + n, 0.06, 'o', 1));
      gtr(gtrS, t + 0.18, E2 + 12, 0.7, 'o', 1, { ring: 0.7 });
      lead(leadS1, t + 0.18, 88, 0.62, 1, { bend: -300 });
      lead(leadS2, t + 0.18, 83, 0.62, 0.9, { bend: -300 });
      crash(sfxBus, t + 0.18, 1);
      kick(sfxBus, t, 1);
      kick(sfxBus, t + 0.18, 1);
    },
    superJackpot(t) {
      duck(t, 0.3, 2.1);
      [0, 3, 5, 7, 10, 12].forEach((n, i) => gtr(gtrS, t + i * 0.065, E2 + n, 0.065, 'o', 1));
      gtr(gtrS, t + 0.39, E2, 1.6, 'o', 1, { ring: 1.6, chord: [[0, -6], [0, 6], [7, 0], [12, 4], [19, -3]] });
      const notes = [[0.4, 88, 83, 0.34], [0.75, 91, 88, 0.34], [1.1, 95, 91, 0.9]];
      for (const [dt, a, b, d] of notes) {
        lead(leadS1, t + dt, a, d, 1, { bend: -200 });
        lead(leadS2, t + dt, b, d, 0.9, { bend: -200 });
      }
      thunder(sfxBus, t + 0.39, 0.9, 1.8);
      crash(sfxBus, t, 0.9);
      crash(sfxBus, t + 0.39, 1.2);
      kick(sfxBus, t, 1);
      kick(sfxBus, t + 0.39, 1.2);
    },
    extraBall(t) {
      const up = [76, 80, 83, 88];
      up.forEach((m, i) => {
        const last = i === up.length - 1;
        lead(leadS1, t + i * 0.09, m, last ? 0.6 : 0.09, 1);
        tone(sfxBus, t + i * 0.09, { type: 'triangle', f0: mtof(m + 12), dur: 0.2, vol: 0.2 });
      });
      gtr(gtrS, t + 0.27, E2 + 12, 0.8, 'o', 1, { ring: 0.8, chord: [[0, -6], [0, 6], [7, 0], [12, 4], [16, 0]] });
      crash(sfxBus, t + 0.27, 0.8);
    },
    ballSave(t) {
      lead(leadS1, t, 69, 0.1, 1);
      lead(leadS1, t + 0.1, 76, 0.32, 1, { bend: -200 });
      noise(sfxBus, t, { dur: 0.3, vol: 0.4, ftype: 'bandpass', f0: 600, f1: 3200, q: 2, a: 0.15 });
      kick(sfxBus, t, 0.9);
    },
    drain(t) {
      duck(t, 0.45, 1.5);
      lead(leadS1, t, 76, 1.5, 1, { glide: 45, glideTime: 1.4, vib: 30, vibRate: 6.5 });
      lead(leadS2, t, 76.45, 1.5, 1, { glide: 44.4, glideTime: 1.4, vib: 30, vibRate: 5.2 });
      noise(sfxBus, t, { dur: 1.5, vol: 0.5, ftype: 'lowpass', f0: 500, f1: 80, a: 0.05 });
      tone(sfxBus, t, { f0: 110, f1: 38, dur: 1.2, vol: 0.6, a: 0.02 });
    },
    launch(t, o) {
      const p = clamp01(num(o.power, 0.7));
      tone(sfxBus, t, { type: 'triangle', f0: 90, f1: 220 + 380 * p, dur: 0.14, vol: 0.45 + 0.4 * p });
      noise(sfxBus, t, { dur: 0.32, vol: 0.2 + 0.4 * p, ftype: 'bandpass', f0: 600, f1: 1500 + 3000 * p, q: 1.5, a: 0.02 });
      tone(sfxBus, t, { type: 'square', f0: 330, f1: 290, dur: 0.2, vol: 0.08 });
    },
    thunder(t) {
      thunder(sfxBus, t, 1, 2.3);
    },
    flame(t) {
      noise(sfxBus, t, { dur: 0.8, vol: 0.8, ftype: 'bandpass', f0: 350, f1: 1400, ft: 0.25, q: 0.7, a: 0.04 });
      noise(sfxBus, t, { dur: 0.9, vol: 0.6, ftype: 'lowpass', f0: 500, f1: 150, a: 0.05 });
    },
    tiltWarning(t) {
      for (const dt of [0, 0.2]) {
        tone(sfxBus, t + dt, { type: 'square', f0: 120, dur: 0.13, vol: 0.4, hold: true, r: 0.02 });
        tone(sfxBus, t + dt, { type: 'square', f0: 181, dur: 0.13, vol: 0.25, hold: true, r: 0.02 });
      }
    },
    tilt(t) {
      tone(sfxBus, t, { type: 'sawtooth', f0: 170, f1: 45, dur: 1.1, vol: 0.5, a: 0.01, hold: true, r: 0.15 });
      tone(sfxBus, t, { type: 'square', f0: 85, f1: 30, dur: 1.1, vol: 0.35, a: 0.01, hold: true, r: 0.15 });
      noise(sfxBus, t, { dur: 1.0, vol: 0.3, ftype: 'lowpass', f0: 900, f1: 120 });
    },
    bonusTick(t) {
      tone(sfxBus, t, { type: 'square', f0: 1400, dur: 0.035, vol: 0.2 });
      tone(sfxBus, t, { f0: 440, f1: 260, dur: 0.05, vol: 0.35 });
    },
    gameStart(t) {
      chopped(sfxBus, t, { noise: true, ftype: 'bandpass', f0: 3200, f1: 700, q: 5, rate0: 28, rate1: 60, dur: 0.4, vol: 1.6, a: 0.02, r: 0.03 });
      gtr(gtrS, t + 0.4, E2, 1.4, 'o', 1, { ring: 1.4 });
      crash(sfxBus, t + 0.4, 1);
      kick(sfxBus, t + 0.4, 1.1);
    },
    gameOver(t) {
      gtr(gtrS, t, E2 + 3, 0.5, 'o', 1);
      gtr(gtrS, t + 0.5, E2, 1.8, 'o', 1, { ring: 1.8 });
      tone(sfxBus, t + 0.5, { f0: 80, f1: 35, dur: 1.5, vol: 0.6 });
      kick(sfxBus, t, 1);
      kick(sfxBus, t + 0.5, 1.1);
    },
    highScore(t) {
      const a = [76, 80, 83, 88, 83, 88];
      const b = [71, 76, 80, 83, 80, 83];
      a.forEach((m, i) => {
        const last = i === a.length - 1;
        lead(leadS1, t + i * 0.11, m, last ? 0.9 : 0.11, 1);
        lead(leadS2, t + i * 0.11, b[i], last ? 0.9 : 0.11, 0.9);
      });
      gtr(gtrS, t + 0.55, E2, 1.1, 'o', 1, { ring: 1.1, chord: [[0, -6], [0, 6], [7, 0], [12, 4], [16, 0]] });
      crash(sfxBus, t, 0.8);
      crash(sfxBus, t + 0.55, 1);
      kick(sfxBus, t + 0.55, 1);
    },
    uiClick(t) {
      tone(sfxBus, t, { f0: 1100, f1: 650, dur: 0.035, vol: 0.35 });
      noise(sfxBus, t, { dur: 0.01, vol: 0.15, ftype: 'highpass', f0: 4000 });
    },
    laugh(t, o) {
      return laugh(sfxBus, t, !!o.big);
    },
    kickback(t) {
      // electric zap
      tone(sfxBus, t, { type: 'sawtooth', f0: 3400, f1: 220, dur: 0.13, vol: 0.3 });
      tone(sfxBus, t, { type: 'square', f0: 1900, f1: 310, dur: 0.09, vol: 0.18 });
      noise(sfxBus, t, { dur: 0.06, vol: 0.45, ftype: 'highpass', f0: 3800 });
      // solenoid thump
      tone(sfxBus, t + 0.02, { f0: 150, f1: 44, ft: 0.08, dur: 0.16, vol: 0.95 });
      noise(sfxBus, t + 0.02, { dur: 0.03, vol: 0.4, ftype: 'lowpass', f0: 1400 });
      // the ball whipping back up the lane
      noise(sfxBus, t + 0.05, { dur: 0.42, vol: 0.5, ftype: 'bandpass', f0: 420, f1: 4200, q: 2.2, a: 0.22, hold: true, r: 0.12 });
      tone(sfxBus, t + 0.05, { type: 'triangle', f0: 190, f1: 1500, dur: 0.38, vol: 0.2, a: 0.06, hold: true, r: 0.1 });
    },
    shriek(t, o) {
      return shriek(sfxBus, t, !!o.big);
    },
    radio(t) {
      return radioCall(sfxBus, t);
    },
    winch(t) {
      // electric hoist motor winding up
      chopped(sfxBus, t, { saws: [180, 183], ftype: 'bandpass', f0: 520, f1: 1500, q: 2.5, rate0: 90, rate1: 140, lfoType: 'sawtooth', dur: 0.7, vol: 0.55, a: 0.04, r: 0.08 });
      tone(sfxBus, t, { type: 'square', f0: 180, f1: 520, ft: 0.62, dur: 0.7, vol: 0.06, a: 0.04, hold: true, r: 0.08 });
      // cable ratchet, speeding up
      let ct = t + 0.05, gap = 0.065;
      while (ct < t + 0.66) {
        noise(sfxBus, ct, { dur: 0.014, vol: 0.55, ftype: 'bandpass', f0: 3200 + Math.random() * 600, q: 3 });
        tone(sfxBus, ct, { type: 'triangle', f0: 2300, dur: 0.012, vol: 0.08 });
        ct += gap;
        gap = Math.max(0.032, gap * 0.9);
      }
      // the hook locks home
      tone(sfxBus, t + 0.7, { f0: 160, f1: 55, ft: 0.06, dur: 0.14, vol: 0.85 });
      noise(sfxBus, t + 0.7, { dur: 0.05, vol: 0.5, ftype: 'lowpass', f0: 1100 });
      tone(sfxBus, t + 0.705, { type: 'triangle', f0: 1730, dur: 0.18, vol: 0.12 });
      tone(sfxBus, t + 0.705, { type: 'triangle', f0: 2610, dur: 0.12, vol: 0.07 });
    },
    smoke(t) {
      tone(sfxBus, t, { f0: 420, f1: 110, ft: 0.05, dur: 0.09, vol: 0.7 }); // canister pop
      noise(sfxBus, t, { dur: 0.05, vol: 0.6, ftype: 'bandpass', f0: 1600, q: 0.8 });
      noise(sfxBus, t + 0.04, { dur: 1.15, vol: 0.55, ftype: 'bandpass', f0: 5600, f1: 3900, q: 0.7, a: 0.09, hold: true, r: 0.5 });
      noise(sfxBus, t + 0.04, { dur: 1.1, vol: 0.32, ftype: 'bandpass', f0: 1100, f1: 800, q: 0.6, a: 0.12, hold: true, r: 0.5 });
    },
    liftoff(t) {
      duck(t, 0.3, 2.2);
      liftoffRoar(sfxBus, t, 2.2);
      noise(sfxBus, t + 0.3, { dur: 1.9, vol: 0.4, ftype: 'lowpass', f0: 250, f1: 2400, ft: 1.7, a: 1.2, hold: true, r: 0.5 });
      tone(sfxBus, t, { f0: 41, f1: 82, ft: 2.0, dur: 2.2, vol: 0.4, a: 1.4, hold: true, r: 0.35 });
    },
    monsoon(t) {
      noise(sfxBus, t, { dur: 2.5, vol: 0.5, ftype: 'highpass', f0: 2200, q: 0.5, a: 0.18, hold: true, r: 1.0 }); // sheet of rain
      noise(sfxBus, t, { dur: 2.4, vol: 0.45, ftype: 'bandpass', f0: 900, q: 0.4, a: 0.25, hold: true, r: 1.0 });
      for (let i = 0; i < 14; i++) {
        const at = t + 0.05 + Math.random() * 2.0;
        noise(sfxBus, at, { dur: 0.012 + Math.random() * 0.012, vol: 0.25 + Math.random() * 0.25, ftype: 'bandpass', f0: 1800 + Math.random() * 3500, q: 2.5 });
      }
      thunder(sfxBus, t + 0.35, 1, 2.1);
      return 2.5;
    },
    // ---------------------------------------------------------------- RIFFGEWITTER stage gear
    scratch(t) {
      // a record dragged back and forth under the needle
      const moves = [[900, 2600, 0.09], [2600, 700, 0.11], [800, 3000, 0.08], [3000, 600, 0.16], [700, 2200, 0.1]];
      let at = t;
      for (const [a, b, d] of moves) {
        noise(sfxBus, at, { dur: d, vol: 0.7, ftype: 'bandpass', f0: a, f1: b, ft: d, q: 4, a: 0.01, hold: true, r: 0.02 });
        tone(sfxBus, at, { type: 'sawtooth', f0: a / 6, f1: b / 6, ft: d, dur: d, vol: 0.12, a: 0.01, hold: true, r: 0.02 });
        at += d + 0.015;
      }
    },
    micBash(t) {
      // ball against a mic stand: metal ping, mic thump through the PA
      tone(sfxBus, t, { f0: 140, f1: 48, ft: 0.08, dur: 0.22, vol: 0.9 });
      noise(sfxBus, t, { dur: 0.06, vol: 0.5, ftype: 'lowpass', f0: 1800 });
      tone(sfxBus, t + 0.002, { type: 'triangle', f0: 1480, dur: 0.45, vol: 0.12 });
      tone(sfxBus, t + 0.002, { type: 'triangle', f0: 2217, dur: 0.3, vol: 0.07 });
    },
    feedback(t) {
      // PA howl that swells and gets cut
      tone(sfxBus, t, { f0: 1750, f1: 1830, ft: 1.2, dur: 1.25, vol: 0.13, a: 0.6, hold: true, r: 0.05 });
      tone(sfxBus, t + 0.2, { type: 'triangle', f0: 3500, f1: 3660, ft: 1.0, dur: 1.05, vol: 0.05, a: 0.5, hold: true, r: 0.05 });
    },
    powerChord(t) {
      // big open E5 with fifth and octave, distorted by stacking detuned saws
      duck(t, 0.4, 1.4);
      for (const [f, v] of [[82.4, 0.2], [123.5, 0.16], [164.8, 0.12]]) {
        for (const d of [-0.6, 0, 0.7]) tone(sfxBus, t, { type: 'sawtooth', f0: f + d, dur: 1.7, vol: v, a: 0.005, r: 1.2 });
      }
      noise(sfxBus, t, { dur: 0.05, vol: 0.4, ftype: 'highpass', f0: 2500 });
      tone(sfxBus, t, { f0: 70, f1: 40, ft: 0.15, dur: 0.3, vol: 0.8 });
    },
    vinylSpin(t) {
      noise(sfxBus, t, { dur: 0.18, vol: 0.4, ftype: 'bandpass', f0: 600, f1: 1800, ft: 0.18, q: 2 });
      tone(sfxBus, t, { type: 'triangle', f0: 330, f1: 660, ft: 0.18, dur: 0.2, vol: 0.1 });
    },
    cheer(t) {
      crowd(sfxBus, t, 1.6, 0.6);
      for (let i = 0; i < 4; i++) {
        const at = t + 0.25 + Math.random() * 0.9;
        const f = 1700 + Math.random() * 900;
        tone(sfxBus, at, { f0: f, f1: f * (1.25 + Math.random() * 0.3), ft: 0.07, dur: 0.16 + Math.random() * 0.12, vol: 0.05, a: 0.02, hold: true, r: 0.05 });
      }
    },

    // ---------------------------------------------------------------- ROTORSTURM combat & field
    gunshot(t, o) {
      shot(sfxBus, t, { d: num(o.distance, 0), pan: o.pan });
    },
    burst(t, o) {
      const d = num(o.distance, 0);
      let at = t;
      for (let i = 0; i < 3; i++) {
        shot(sfxBus, at, { d, echo: i === 2, vel: 0.92 });
        at += 0.07 + Math.random() * 0.012;
      }
      return 0.75;
    },
    mg(t, o) {
      const len = Math.max(0.2, Math.min(3, num(o.len, 1.2)));
      const d = num(o.distance, 0);
      const out = voiceOut(sfxBus, { vol: 0.82 });
      let at = t, k = 0;
      while (at < t + len) {
        shot(out, at, { d, heavy: true, echo: false, vel: 0.8 + Math.random() * 0.15 });
        noise(out, at + 0.004, { dur: 0.008, vol: 0.12, ftype: 'bandpass', f0: 4200 + Math.random() * 900, q: 3 }); // belt links
        at += 0.109 * (1 + (Math.random() - 0.5) * 0.09);
        k++;
      }
      noise(out, at, { dur: 0.5, vol: 0.32, ftype: 'lowpass', f0: 700, f1: 200, q: 0.7, a: 0.01 }); // echo after the last round
      return len + 0.55;
    },
    ricochet(t) {
      const j = 1 + (Math.random() - 0.5) * 0.12;
      const out = voiceOut(sfxBus, { pan: (Math.random() - 0.5) * 0.6 });
      noise(out, t, { dur: 0.012, vol: 0.75, ftype: 'highpass', f0: 3800, q: 0.7, a: 0.0005 });
      metalPing(out, t, 1580 * j, 0.32, 0.4);
      tone(out, t, { type: 'sine', f0: 3730 * j, dur: 0.22, vol: 0.16 });
      whistle(out, t + 0.035, { f0: 3500 * j, f1: 820, dur: 0.85, vol: 0.2, vib: 36, vibDepth: 70, type: 'triangle' });
    },
    bolt(t) {
      noise(sfxBus, t, { dur: 0.018, vol: 0.7, ftype: 'bandpass', f0: 2900, q: 2 });
      tone(sfxBus, t, { type: 'triangle', f0: 950, f1: 420, dur: 0.03, vol: 0.45 });
      noise(sfxBus, t + 0.03, { dur: 0.13, vol: 0.18, ftype: 'bandpass', f0: 3600, f1: 2300, q: 3, a: 0.01 }); // spring scrape
      noise(sfxBus, t + 0.2, { dur: 0.025, vol: 0.9, ftype: 'bandpass', f0: 2100, q: 1.6 });
      tone(sfxBus, t + 0.2, { type: 'triangle', f0: 640, f1: 240, dur: 0.05, vol: 0.55 });
      metalPing(sfxBus, t + 0.202, 3100, 0.08, 0.09);
    },
    casings(t) {
      const n = 3 + Math.floor(Math.random() * 4);
      for (let c = 0; c < n; c++) {
        let at = t + Math.random() * 0.22, gap = 0.09 + Math.random() * 0.06, v = 0.16 + Math.random() * 0.08;
        const f = 3600 + Math.random() * 2400;
        for (let b = 0; b < 3; b++) {
          metalPing(sfxBus, at, f * (1 + (Math.random() - 0.5) * 0.04), v, 0.06 + Math.random() * 0.04);
          at += gap; gap *= 0.6; v *= 0.55;
        }
      }
      return 0.8;
    },
    mortar(t) {
      tone(sfxBus, t, { f0: 150, f1: 52, ft: 0.12, dur: 0.2, vol: 0.85 }); // thoonk
      noise(sfxBus, t, { dur: 0.14, vol: 0.6, ftype: 'bandpass', f0: 330, q: 5 });
      noise(sfxBus, t, { dur: 0.1, vol: 0.4, ftype: 'lowpass', f0: 600 });
      whistle(sfxBus, t + 0.45, { f0: 1350, pts: [[0.4, 2000], [1.15, 640]], dur: 1.15, vol: 0.16, cresc: true });
      boom(sfxBus, t + 1.62, 0.6);
      return 2.6;
    },
    incoming(t) {
      whistle(sfxBus, t, { f0: 2300, f1: 520, dur: 1.2, vol: 0.18, cresc: true, vib: 7, vibDepth: 25 });
      duck(t + 1.18, 0.55, 1.2);
      boom(sfxBus, t + 1.2, 0.85);
      return 2.9;
    },
    explosion(t, o) {
      const sz = clamp01(num(o.size, 0.7));
      if (sz >= 0.5) duck(t, 0.75 - 0.25 * sz, 0.6 + 0.8 * sz);
      boom(sfxBus, t, sz);
      return 0.8 + 1.4 * sz;
    },
    artillery(t) {
      distantGun(voiceOut(sfxBus, { lp: 850, vol: 0.95, pan: (Math.random() - 0.5) * 0.8 }), t, 1);
      return 2.5;
    },
    barrage(t) {
      const n = 4 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const at = t + (i / n) * 2.4 + Math.random() * 0.25;
        distantGun(voiceOut(sfxBus, { lp: 800, vol: 0.75 + Math.random() * 0.25, pan: (Math.random() - 0.5) * 1.4 }), at, 0.8);
      }
      return 3.4;
    },
    jet(t) {
      duck(t + 0.8, 0.65, 1.4);
      jetPass(sfxBus, t, 3.0, 1);
      return 3.0;
    },
    airstrike(t) {
      duck(t, 0.3, 3.8);
      jetPass(sfxBus, t, 3.0, 1);
      boom(sfxBus, t + 1.85, 1, { vol: 1.05 });
      rumble(sfxBus, t + 2.1, { dur: 2.2, vol: 0.55, f0: 500, f1: 70, a: 0.1 });
      tone(sfxBus, t + 2.1, { f0: 48, f1: 30, dur: 1.6, vol: 0.4, a: 0.08 });
      return 4.4;
    },
    heliFlyby(t) {
      const dur = 3.5, tc = t + 1.6;
      const out = voiceOut(sfxBus, { vol: 1 });
      let pn = null;
      if (ctx.createStereoPanner) {
        pn = ctx.createStereoPanner();
        pn.pan.setValueAtTime(-0.85, t); pn.pan.linearRampToValueAtTime(0.85, t + dur);
        out.disconnect(); out.connect(pn); pn.connect(sfxBus);
      }
      const env = out.gain;
      env.setValueAtTime(0.0001, t);
      env.exponentialRampToValueAtTime(1, tc);
      env.exponentialRampToValueAtTime(0.0001, t + dur);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = biquad('bandpass', 300, 0.9);
      const am = gainNode(0.15);
      const lfo = ctx.createOscillator(); lfo.setPeriodicWave(pulseWave);
      lfo.frequency.setValueAtTime(6.5, t); lfo.frequency.linearRampToValueAtTime(6.2, tc); lfo.frequency.linearRampToValueAtTime(5.3, tc + 0.5); lfo.frequency.linearRampToValueAtTime(5.1, t + dur);
      const lg = gainNode(0.85), lg2 = gainNode(0.5);
      const th = ctx.createOscillator(); th.frequency.value = 55;
      const tg = gainNode(0);
      lfo.connect(lg); lg.connect(am.gain);
      lfo.connect(lg2); lg2.connect(tg.gain);
      const sg = gainNode(0.9 * trim);
      chain([src, bp, biquad('lowpass', 1100, 0.7), am, sg, out]);
      chain([th, tg, sg]);
      const w = ctx.createOscillator(); w.type = 'sawtooth';
      w.frequency.setValueAtTime(2150, t); w.frequency.exponentialRampToValueAtTime(2000, tc); w.frequency.exponentialRampToValueAtTime(1700, t + dur);
      const wg = gainNode(0.035 * trim);
      chain([w, biquad('bandpass', 2000, 5), wg, out]);
      for (const n of [src, lfo, th, w]) { n.start(t); n.stop(t + dur + 0.05); }
      autoKill(src, [bp, am, lfo, lg, lg2, th, tg, sg, w, wg]);
      return dur;
    },
    bugle(t) {
      // an original call on the bugle's natural notes (E4 G4 C5 E5), not any real military call
      const notes = [[64, 0.3], [67, 0.1], [72, 0.35], [67, 0.15], [76, 0.26], [72, 0.24], [67, 0.15], [72, 0.62]];
      let at = t;
      for (const [m, d] of notes) {
        brass(sfxBus, at, m, d * 0.96, 0.32);
        brass(voiceOut(sfxBus, { lp: 1300, vol: 0.22 }), at + 0.19, m, d * 0.96, 0.32); // valley echo
        at += d;
      }
      return at - t + 0.3;
    },
    tunnelShot(t) {
      const out = voiceOut(sfxBus, { lp: 2100, vol: 1 });
      shot(out, t, { pistol: true, echo: false, vel: 0.95 });
      [0.013, 0.024, 0.037, 0.051, 0.069, 0.091, 0.118, 0.15].forEach((dt, i) => {
        noise(out, t + dt, { dur: 0.05, vol: 0.42 * Math.pow(0.72, i), ftype: 'lowpass', f0: 1200 - i * 90, q: 0.8, a: 0.002 });
      });
      noise(out, t + 0.02, { dur: 0.5, vol: 0.22, ftype: 'bandpass', f0: 380, f1: 200, q: 0.6, a: 0.03 });
      return 0.6;
    },
    dirt(t) {
      tone(sfxBus, t, { f0: 52, f1: 38, dur: 1.0, vol: 0.32, a: 0.08 });
      noise(sfxBus, t, { dur: 0.9, vol: 0.4, ftype: 'lowpass', f0: 520, f1: 180, q: 0.7, a: 0.05 });
      for (let i = 0; i < 34; i++) {
        const k = i / 34, at = t + Math.pow(k, 1.3) * 1.1;
        noise(sfxBus, at, { dur: 0.01 + Math.random() * 0.025, vol: (0.35 - 0.25 * k) * (0.5 + Math.random() * 0.5), ftype: 'bandpass', f0: 300 + Math.random() * (k > 0.5 ? 2600 : 1000), q: 1.2 });
      }
      return 1.2;
    },
    alarm(t) {
      duck(t, 0.3, 3.0);
      // klaxon "BAH-BAH-BAH" over the first second
      for (let i = 0; i < 3; i++) {
        const at = t + i * 0.34;
        chopped(sfxBus, at, { saws: [220, 277, 330], ftype: 'bandpass', f0: 900, q: 0.8, rate0: 60, lfoType: 'square', dur: 0.24, vol: 0.32, a: 0.008, r: 0.03 });
      }
      siren(sfxBus, t + 0.05, 2, 0.34);
      return 3.2;
    },
    dogtags(t) {
      const n = 6 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const at = t + Math.random() * 0.38;
        metalPing(sfxBus, at, (i % 2 ? 3900 : 5200) * (1 + (Math.random() - 0.5) * 0.05), 0.09 + Math.random() * 0.06, 0.05 + Math.random() * 0.07);
      }
      noise(sfxBus, t, { dur: 0.3, vol: 0.06, ftype: 'bandpass', f0: 6500, q: 1.5, a: 0.02 }); // ball chain rustle
      return 0.5;
    },

    // ---------------------------------------------------------------- ERDABWEHR invaders & defenders
    laser(t, o) {
      // human laser rifle: bright, clean "pew"
      const j = 1 + (Math.random() - 0.5) * 0.1;
      const out = voiceOut(sfxBus, { lp: 7500, pan: o.pan });
      tone(out, t, { type: 'sine', f0: 3400 * j, f1: 600, ft: 0.11, dur: 0.13, vol: 0.4 });
      tone(out, t, { type: 'square', f0: 2600 * j, f1: 380, ft: 0.13, dur: 0.15, vol: 0.12 });
      tone(out, t, { type: 'triangle', f0: 1700 * j, f1: 260, ft: 0.12, dur: 0.12, vol: 0.18 });
      noise(out, t, { dur: 0.012, vol: 0.3, ftype: 'highpass', f0: 5000, q: 0.7 });
    },
    laserBig(t) {
      // laser cannon: 0.25 s charge-up, then the discharge
      chopped(sfxBus, t, { saws: [220, 223], ftype: 'bandpass', f0: 600, f1: 3200, q: 4, rate0: 24, rate1: 70, dur: 0.26, vol: 0.45, a: 0.05, r: 0.01 });
      tone(sfxBus, t, { f0: 400, f1: 2600, ft: 0.25, dur: 0.26, vol: 0.16, a: 0.2, hold: true, r: 0.01 });
      const d = t + 0.25;
      duck(d, 0.5, 0.8);
      const out = voiceOut(sfxBus, { lp: 6000 });
      noise(out, d, { dur: 0.03, vol: 0.8, ftype: 'highpass', f0: 3000, q: 0.7, a: 0.0005 });
      tone(out, d, { type: 'sawtooth', f0: 1800, f1: 70, ft: 0.5, dur: 0.6, vol: 0.3 });
      tone(out, d, { type: 'square', f0: 900, f1: 50, ft: 0.45, dur: 0.55, vol: 0.16 });
      tone(out, d, { f0: 140, f1: 32, ft: 0.4, dur: 0.7, vol: 0.9 });
      noise(out, d, { dur: 0.5, vol: 0.55, ftype: 'bandpass', f0: 4200, f1: 400, q: 1.2, a: 0.002 });
      return 1.0;
    },
    rayGun(t, o) {
      // alien ray gun: wobbling, falling warble
      const out = voiceOut(sfxBus, { lp: 5200, pan: o.pan });
      whistle(out, t, { type: 'square', f0: 1500, f1: 220, dur: 0.55, vol: 0.1, vib: 19, vibDepth: 150 });
      whistle(out, t, { type: 'sine', f0: 2200, f1: 330, dur: 0.5, vol: 0.28, vib: 19, vibDepth: 200 });
      tone(out, t, { type: 'triangle', f0: 600, f1: 90, dur: 0.4, vol: 0.2 });
      return 0.6;
    },
    ufoPass(t) {
      saucer(sfxBus, t, 1.5, 0.9);
      return 1.55;
    },
    tractor(t) {
      duck(t + 0.3, 0.6, 1.2);
      tractorBeam(sfxBus, t, 1.6);
      return 1.65;
    },
    abduct(t) {
      // zap up and away
      const out = voiceOut(sfxBus, { lp: 6000 });
      tone(out, t, { type: 'sawtooth', f0: 180, f1: 2600, ft: 0.16, dur: 0.2, vol: 0.16, a: 0.005, hold: true, r: 0.04 });
      tone(out, t, { f0: 500, f1: 3000, ft: 0.18, dur: 0.22, vol: 0.3, a: 0.005, hold: true, r: 0.05 });
      noise(out, t, { dur: 0.2, vol: 0.3, ftype: 'bandpass', f0: 1000, f1: 7000, q: 3, a: 0.01 });
      tone(out, t + 0.17, { f0: 3200, dur: 0.12, vol: 0.12 }); // sparkle
      return 0.32;
    },
    release(t) {
      // balls dropped back: falling sweep, then a thump on the playfield
      const out = voiceOut(sfxBus, { lp: 5000 });
      tone(out, t, { type: 'triangle', f0: 2600, f1: 160, ft: 0.5, dur: 0.5, vol: 0.28, a: 0.01, hold: true, r: 0.08 });
      tone(out, t, { type: 'square', f0: 1300, f1: 80, ft: 0.5, dur: 0.5, vol: 0.06, a: 0.01, hold: true, r: 0.08 });
      noise(out, t, { dur: 0.5, vol: 0.3, ftype: 'bandpass', f0: 6000, f1: 400, q: 2, a: 0.02 });
      tone(sfxBus, t + 0.48, { f0: 150, f1: 42, ft: 0.1, dur: 0.25, vol: 0.9 });
      noise(sfxBus, t + 0.48, { dur: 0.08, vol: 0.45, ftype: 'lowpass', f0: 900, q: 0.7 });
      return 0.8;
    },
    robotStep(t) {
      // servo whine, then a heavy metal stomp
      chopped(sfxBus, t, { saws: [310, 316], ftype: 'bandpass', f0: 900, f1: 1400, q: 3, rate0: 70, rate1: 95, lfoType: 'sawtooth', dur: 0.17, vol: 0.3, a: 0.01, r: 0.03 });
      tone(sfxBus, t, { type: 'square', f0: 420, f1: 640, ft: 0.12, dur: 0.17, vol: 0.04, hold: true, r: 0.03 });
      const s = t + 0.16;
      tone(sfxBus, s, { f0: 120, f1: 34, ft: 0.12, dur: 0.38, vol: 1.0 });
      noise(sfxBus, s, { dur: 0.12, vol: 0.65, ftype: 'lowpass', f0: 1100, f1: 200, q: 0.7 });
      noise(sfxBus, s, { dur: 0.03, vol: 0.45, ftype: 'bandpass', f0: 2600, q: 1.5 });
      metalPing(sfxBus, s + 0.003, 210, 0.16, 0.35);
      metalPing(sfxBus, s + 0.003, 487, 0.08, 0.25);
      noise(sfxBus, s + 0.05, { dur: 0.3, vol: 0.1, ftype: 'highpass', f0: 4500, q: 0.7, a: 0.02 }); // hydraulic hiss
      return 0.6;
    },
    robotLaser(t) {
      duck(t, 0.6, 0.9);
      const out = voiceOut(sfxBus, { vol: 1 });
      screechBeam(out, t, 1.0);
      tone(out, t, { type: 'sawtooth', f0: 92, f1: 78, dur: 1.0, vol: 0.18, a: 0.03, hold: true, r: 0.15 }); // beam hum
      tone(out, t, { f0: 70, f1: 55, dur: 1.0, vol: 0.3, a: 0.03, hold: true, r: 0.15 });
      for (let i = 0; i < 26; i++) {
        const at = t + 0.03 + Math.random() * 0.92;
        noise(out, at, { dur: 0.004 + Math.random() * 0.01, vol: 0.2 + Math.random() * 0.3, ftype: 'highpass', f0: 3000 + Math.random() * 4000, q: 0.7, a: 0.0005 });
      }
      return 1.05;
    },
    robotDown(t) {
      duck(t, 0.4, 1.8);
      // sparks
      for (let i = 0; i < 18; i++) {
        const at = t + Math.random() * 0.7;
        noise(sfxBus, at, { dur: 0.005 + Math.random() * 0.015, vol: 0.2 + Math.random() * 0.25, ftype: 'highpass', f0: 3500 + Math.random() * 3500, q: 0.7, a: 0.0005 });
        if (i % 3 === 0) tone(sfxBus, at, { f0: 4000 + Math.random() * 3000, dur: 0.05, vol: 0.05 });
      }
      // the crash
      boom(sfxBus, t + 0.12, 0.55, { vol: 0.8 });
      metalPing(sfxBus, t + 0.12, 173, 0.32, 1.3);
      metalPing(sfxBus, t + 0.12, 311, 0.22, 1.0);
      metalPing(sfxBus, t + 0.38, 241, 0.2, 0.9);
      metalPing(sfxBus, t + 0.6, 397, 0.14, 0.6);
      noise(sfxBus, t + 0.12, { dur: 0.9, vol: 0.3, ftype: 'bandpass', f0: 2400, f1: 900, q: 0.8, a: 0.003 });
      // power-down whine
      const out = voiceOut(sfxBus, { lp: 4000 });
      tone(out, t + 0.05, { type: 'sawtooth', f0: 1300, f1: 45, ft: 1.8, dur: 1.9, vol: 0.12, a: 0.02, hold: true, r: 0.4 });
      tone(out, t + 0.05, { f0: 650, f1: 30, ft: 1.8, dur: 1.9, vol: 0.2, a: 0.02, hold: true, r: 0.4 });
      return 2.1;
    },
    tankShot(t) {
      duck(t, 0.55, 0.9);
      noise(sfxBus, t, { dur: 0.02, vol: 0.9, ftype: 'highpass', f0: 2000, q: 0.7, a: 0.0005 });
      tone(sfxBus, t, { type: 'triangle', f0: 180, f1: 60, ft: 0.08, dur: 0.18, vol: 0.5 });
      boom(sfxBus, t, 0.85, { vol: 0.9 });
      tone(sfxBus, t, { f0: 62, f1: 26, ft: 0.6, dur: 1.1, vol: 0.7, a: 0.003 }); // sub
      for (let i = 0; i < 12; i++) {
        const at = t + 0.35 + Math.random() * 1.0;
        noise(sfxBus, at, { dur: 0.01 + Math.random() * 0.03, vol: 0.1 + Math.random() * 0.15, ftype: 'lowpass', f0: 900 + Math.random() * 1800, q: 1 });
      }
      return 1.8;
    },
    turret(t) {
      noise(sfxBus, t, { dur: 0.025, vol: 0.4, ftype: 'bandpass', f0: 1800, q: 2 }); // relay
      chopped(sfxBus, t + 0.02, { saws: [118, 121], ftype: 'bandpass', f0: 500, f1: 820, q: 2.5, rate0: 48, rate1: 66, lfoType: 'sawtooth', dur: 0.52, vol: 0.45, a: 0.06, r: 0.08 });
      tone(sfxBus, t + 0.02, { type: 'triangle', f0: 760, f1: 980, ft: 0.3, dur: 0.52, vol: 0.05, a: 0.06, hold: true, r: 0.08 }); // gear whine
      for (let at = t + 0.06; at < t + 0.52; at += 0.045) {
        noise(sfxBus, at, { dur: 0.008, vol: 0.1, ftype: 'bandpass', f0: 2800, q: 3 });
      }
      noise(sfxBus, t + 0.56, { dur: 0.04, vol: 0.45, ftype: 'bandpass', f0: 1200, q: 1.5 }); // locks
      tone(sfxBus, t + 0.56, { f0: 180, f1: 70, dur: 0.08, vol: 0.45 });
      return 0.65;
    },
    alienScreech(t) {
      const j = 1 + (Math.random() - 0.5) * 0.15;
      noise(sfxBus, t, { dur: 0.08, vol: 0.2, ftype: 'highpass', f0: 2500, q: 0.7, a: 0.01 }); // intake hiss
      return fmVoice(sfxBus, t + 0.02, {
        vol: 1.1, ratio: 1.41, flutter: 31, flutterDepth: 70,
        syl: [{ at: 0, len: 0.65, f: [[0, 700 * j], [0.15, 1500 * j], [0.5, 1250 * j], [1, 520 * j]], i0: 3.2, i1: 0.9, amp: 1, fa: [1100, 800], fb: [2900, 2300] }],
      }) + 0.02;
    },
    alienChatter(t) {
      const F1 = [400, 700, 300, 550], F2 = [1100, 1900, 2400, 900];
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      const base = 330 + Math.random() * 120;
      const n = 5 + Math.floor(Math.random() * 4);
      const syl = [];
      let at = 0;
      for (let i = 0; i < n && at < 0.7; i++) {
        const len = 0.045 + Math.random() * 0.05;
        const f0 = base * (0.8 + Math.random() * 0.6), up = Math.random() < 0.5;
        syl.push({ at, len, f: [[0, f0], [1, f0 * (up ? 1.35 : 0.7)]], i0: 0.5 + Math.random() * 2, i1: 0.3 + Math.random(), amp: 0.6 + Math.random() * 0.4, fa: [pick(F1), pick(F1)], fb: [pick(F2), pick(F2)] });
        at += len + 0.02 + Math.random() * 0.035;
      }
      return fmVoice(sfxBus, t, { vol: 0.9, ratio: 1.5, flutter: 23, flutterDepth: 25, syl });
    },
    shield(t) {
      const j = 1 + (Math.random() - 0.5) * 0.08;
      noise(sfxBus, t, { dur: 0.01, vol: 0.4, ftype: 'highpass', f0: 4000, q: 0.7, a: 0.0005 });
      metalPing(sfxBus, t, 2300 * j, 0.2, 0.45);
      tone(sfxBus, t, { f0: 1200 * j, f1: 3600 * j, ft: 0.06, dur: 0.25, vol: 0.16 });
      tone(sfxBus, t, { type: 'triangle', f0: 880, f1: 620, dur: 0.4, vol: 0.12 });
      chopped(sfxBus, t + 0.01, { noise: true, ftype: 'highpass', f0: 5200, f1: 3000, q: 0.8, rate0: 55, rate1: 30, dur: 0.38, vol: 0.28, a: 0.004, r: 0.2 }); // fizz
      return 0.5;
    },
    invasionAlarm(t) {
      // one long air-raid swell, two horns a little apart for the beating chord
      duck(t, 0.35, 2.4);
      siren(sfxBus, t, 1, 0.3, 1.3, 1.2, 1);
      siren(sfxBus, t + 0.04, 1, 0.2, 1.3, 1.2, 0.8);
      return 2.6;
    },
    mothershipHit(t) {
      duck(t, 0.3, 2.2);
      noise(sfxBus, t, { dur: 0.04, vol: 0.8, ftype: 'bandpass', f0: 3000, q: 0.8, a: 0.0005 }); // clang
      boom(sfxBus, t, 1, { vol: 0.85 });
      // the hull rings: low inharmonic partials
      for (const [f, v, d] of [[97, 0.28, 2.4], [143, 0.2, 2.0], [229, 0.15, 1.6], [367, 0.09, 1.2], [611, 0.06, 0.9]]) {
        tone(sfxBus, t + 0.005, { f0: f, f1: f * 0.97, dur: d, vol: v });
      }
      metalPing(sfxBus, t + 0.005, 523, 0.08, 1.0);
      // reverberant slaps off the hull
      for (let i = 1; i <= 4; i++) {
        noise(sfxBus, t + i * 0.21, { dur: 0.35, vol: 0.32 * Math.pow(0.6, i), ftype: 'lowpass', f0: 1400 - i * 220, q: 0.7, a: 0.01 });
      }
      rumble(sfxBus, t + 0.1, { dur: 2.6, vol: 0.45, f0: 700, f1: 60, a: 0.2 });
      return 2.8;
    },
    powerUp(t) {
      [60, 64, 67, 72, 76, 79, 84, 88].forEach((m, i) => {
        tone(sfxBus, t + i * 0.045, { type: 'square', f0: mtof(m), dur: 0.09, vol: 0.08 });
        tone(sfxBus, t + i * 0.045, { f0: mtof(m + 12), dur: 0.12, vol: 0.08 });
      });
      tone(voiceOut(sfxBus, { lp: 3500 }), t, { type: 'sawtooth', f0: 200, f1: 1600, ft: 0.4, dur: 0.45, vol: 0.1, a: 0.02, hold: true, r: 0.06 });
      whistle(sfxBus, t, { f0: 400, f1: 3200, dur: 0.5, vol: 0.12, vib: 12, vibDepth: 30, cresc: true });
      noise(sfxBus, t + 0.3, { dur: 0.35, vol: 0.12, ftype: 'highpass', f0: 7000, q: 0.7 });
      return 0.75;
    },
    teleport(t) {
      const out = voiceOut(sfxBus, { lp: 9000 });
      for (let k = 0; k < 6; k++) {
        const f = 1200 + Math.random() * 2400;
        whistle(out, t + k * 0.03, { f0: f, pts: [[0.35, f * 1.6], [0.75, f * 0.7]], dur: 0.75, vol: 0.06, vib: 24 + Math.random() * 16, vibDepth: f * 0.05 });
      }
      chopped(out, t, { noise: true, ftype: 'bandpass', f0: 3000, f1: 9000, q: 4, rate0: 30, rate1: 60, dur: 0.6, vol: 0.3, a: 0.15, r: 0.25 });
      tone(out, t, { f0: 300, f1: 1200, dur: 0.5, vol: 0.1, a: 0.1 });
      return 0.85;
    },
  };

  function sfx(name, o) {
    if (!ctx || !Object.prototype.hasOwnProperty.call(SFX, name)) return false;
    try {
      if (!offline && ctx.state !== 'running') return false; // would pile up and burst on resume
      o = o || {};
      const meta = SFX_META[name];
      const now = ctx.currentTime;
      const t = num(o.when, now + 0.004);
      const gap = meta.gap || 0.025;
      if (lastSfx[name] != null && Math.abs(t - lastSfx[name]) < gap) return false;
      // voice cap: count sfx events still sounding at t
      let active = 0;
      for (let i = sfxEnds.length - 1; i >= 0; i--) {
        if (sfxEnds[i] <= t) sfxEnds.splice(i, 1);
        else active++;
      }
      const big = meta.big || (meta.bigIf && meta.bigIf(o));
      if (!big && (active >= MAX_SFX || (meta.low && active >= SOFT_SFX))) return false;
      lastSfx[name] = t;
      trim = meta.trim;
      const len = SFX[name](t, o);
      trim = 1;
      sfxEnds.push(t + num(len, meta.len));
      return true;
    } catch (e) {
      trim = 1;
      return false;
    }
  }

  function setRoll(speed) {
    if (!ctx) return;
    try {
      if (!offline && ctx.state !== 'running') return;
      const s = clamp01(num(speed, 0));
      if (!rollSrc) {
        if (s <= 0) return;
        rollSrc = ctx.createBufferSource();
        rollSrc.buffer = noiseBuf;
        rollSrc.loop = true;
        rollFilter = biquad('bandpass', 300, 1.1);
        rollGain = gainNode(0);
        chain([rollSrc, rollFilter, biquad('lowpass', 1800, 0.7), rollGain, sfxBus]);
        rollSrc.start();
      }
      const now = ctx.currentTime;
      rollGain.gain.setTargetAtTime(0.5 * s, now, 0.06);
      rollFilter.frequency.setTargetAtTime(260 + 900 * s, now, 0.06);
    } catch (e) { /* ignore */ }
  }

  // continuous helicopter: blade slap (pulse-modulated noise + low thump) and turbine whine
  function buildRotor() {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = biquad('bandpass', 300, 0.9);
    const lp = biquad('lowpass', 900, 0.7);
    const am = gainNode(0.2);
    const lfo = ctx.createOscillator(); lfo.setPeriodicWave(pulseWave); lfo.frequency.value = 4;
    const lg = gainNode(0.8), lg2 = gainNode(0.4);
    const th = ctx.createOscillator(); th.frequency.value = 52;
    const tg = gainNode(0);
    const w = ctx.createOscillator(); w.type = 'sawtooth'; w.frequency.value = 1000;
    const wbp = biquad('bandpass', 1000, 6);
    const wg = gainNode(0);
    const out = gainNode(0);
    lfo.connect(lg); lg.connect(am.gain);
    lfo.connect(lg2); lg2.connect(tg.gain);
    chain([src, bp, lp, am, out]);
    chain([th, tg, out]);
    chain([w, wbp, wg, out]);
    out.connect(sfxBus);
    src.start(); lfo.start(); th.start(); w.start();
    rotor = { out, lfo, bp, w, wbp, wg };
  }

  function applyRotor(level) {
    const l = clamp01(num(level, 0));
    if (!rotor) {
      if (l <= 0) return;
      buildRotor();
    }
    const now = ctx.currentTime;
    rotor.out.gain.setTargetAtTime(l > 0 ? (0.35 + 0.65 * l) * ROTOR_LEVEL : 0, now, 0.25);
    rotor.lfo.frequency.setTargetAtTime(2.7 + 4.3 * l, now, 0.35); // ~4 Hz at 0.3, 7 Hz at 1.0
    rotor.bp.frequency.setTargetAtTime(220 + 320 * l, now, 0.3);
    const wf = 700 + 2100 * l;
    rotor.w.frequency.setTargetAtTime(wf, now, 0.4);
    rotor.wbp.frequency.setTargetAtTime(wf, now, 0.4);
    rotor.wg.gain.setTargetAtTime(0.06 * l, now, 0.3);
  }

  function applyTheme(name, immediate) {
    if (name === theme) { seq.pendingTheme = null; return; }
    if (seq.state === 'off' || seq.finished) { theme = name; seq.pendingTheme = null; return; }
    const groove = seq.state === 'play' || seq.state === 'multiball';
    if (groove && !immediate) { seq.pendingTheme = name; return; } // next bar line
    theme = name;
    seq.pendingTheme = null;
    applyMusic(seq.state, true, true);
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------
  function iosSilentSwitchWorkaround() {
    // On iOS the hardware mute switch silences WebAudio unless a media element
    // is playing. A looping silent <audio> moves the page to the playback
    // category.
    try {
      if (offline || silentEl || typeof document === 'undefined' || typeof navigator === 'undefined') return;
      const ua = navigator.userAgent || '';
      const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
      if (!ios) return;
      const sr = 8000;
      const n = 800;
      const bytes = new Uint8Array(44 + n);
      const dv = new DataView(bytes.buffer);
      const str = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
      str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
      dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true);
      dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true);
      bytes.fill(128, 44);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      silentEl = document.createElement('audio');
      silentEl.setAttribute('playsinline', '');
      silentEl.setAttribute('x-webkit-airplay', 'deny');
      silentEl.loop = true;
      silentEl.preload = 'auto';
      silentEl.src = 'data:audio/wav;base64,' + btoa(bin);
      const p = silentEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* not essential */ }
  }

  function unlock() {
    try {
      if (!ctx) {
        if (opts.context) {
          ctx = opts.context;
        } else {
          const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
          if (!AC) return false;
          try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        }
        buildGraph();
        if (wantedState !== 'off') applyMusic(wantedState, true);
        if (rotorWanted > 0) applyRotor(rotorWanted);
        if (ambWanted.name) applyAmbience();
        if (alarmWanted) applyAlarmLoop();
      }
      if (!offline) {
        if (ctx.state !== 'running' && ctx.resume) {
          const p = ctx.resume();
          if (p && p.catch) p.catch(() => {});
        }
        iosSilentSwitchWorkaround();
        if (silentEl && silentEl.paused) {
          const p = silentEl.play();
          if (p && p.catch) p.catch(() => {});
        }
        startTimer();
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function setMusic(state, o) {
    try {
      if (!Object.prototype.hasOwnProperty.call(TEMPO, state) && state !== 'off') return;
      wantedState = state;
      if (!ctx) return;
      applyMusic(state, !!(o && o.immediate));
    } catch (e) { /* ignore */ }
  }

  function setParam(node, v) {
    try {
      if (ctx && node) node.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
    } catch (e) { /* ignore */ }
  }

  return {
    unlock,
    setMusic,
    sfx,
    setRoll,
    scheduleRange,
    /** Repeating base siren while a mode lasts; fades out within 0.5 s. Remembered before unlock(), never stacks. */
    alarmLoop(on) {
      try {
        alarmWanted = !!on;
        if (!ctx) return;
        applyAlarmLoop();
      } catch (e) { /* ignore */ }
    },
    /** Background ambience: 'jungle', 'invasion' or null (off), level 0..1. Remembered before unlock(). */
    setAmbience(name, level) {
      try {
        ambWanted.name = name === 'jungle' || name === 'invasion' ? name : null;
        ambWanted.level = ambWanted.name ? clamp01(num(level, 1)) : 0;
        if (!ctx) return;
        applyAmbience();
      } catch (e) { /* ignore */ }
    },
    /** 'riff' (default), 'rotor' or 'alien'. Changes the synthesised music only; during play/multiball it switches on the next bar line. */
    setTheme(name, o) {
      try {
        if (!Object.prototype.hasOwnProperty.call(TEMPOS, name)) return;
        if (!ctx) { theme = name; return; }
        applyTheme(name, !!(o && o.immediate));
      } catch (e) { /* ignore */ }
    },
    /** Continuous helicopter rotor, 0 (silent) .. 1 (full power). Remembered before unlock(). */
    setRotor(level) {
      try {
        rotorWanted = clamp01(num(level, 0));
        if (!ctx) return;
        applyRotor(rotorWanted);
      } catch (e) { /* ignore */ }
    },
    setMusicVolume(v) {
      settings.music = clamp01(num(v, settings.music));
      setParam(musicBus, settings.music * MUSIC_LEVEL);
    },
    setSfxVolume(v) {
      settings.sfx = clamp01(num(v, settings.sfx));
      setParam(sfxBus, settings.sfx * SFX_LEVEL);
    },
    setMuted(m) {
      settings.muted = !!m;
      setParam(muteGain, settings.muted ? 0 : 1);
    },
    suspend() {
      try {
        stopTimer();
        if (silentEl) silentEl.pause();
        if (ctx && !offline && ctx.state === 'running') {
          const p = ctx.suspend();
          if (p && p.catch) p.catch(() => {});
        }
      } catch (e) { /* ignore */ }
    },
    resume() {
      try {
        if (!ctx || offline) return;
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
        if (silentEl) {
          const q = silentEl.play();
          if (q && q.catch) q.catch(() => {});
        }
        startTimer();
      } catch (e) { /* ignore */ }
    },
    onBeat(cb) {
      if (typeof cb !== 'function') return () => {};
      beatCbs.push(cb);
      return () => {
        const i = beatCbs.indexOf(cb);
        if (i >= 0) beatCbs.splice(i, 1);
      };
    },
    get ctx() { return ctx; },
    get musicState() { return seq.pending || seq.state; },
    get theme() { return seq.pendingTheme || theme; },
    get muted() { return settings.muted; },
  };
}
