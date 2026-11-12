// RIFFGEWITTER — rules engine. Consumes physics events, owns score/modes/lamps,
// and emits semantic "fx" events for audio, renderer and the dot-matrix display.

import { Physics, PHYS } from './physics.js';

export const RULES = {
  balls: 3,
  ballSave: 20,
  frenzyTime: 20,
  tunnelsForFrenzy: 3,
  bumperHitsPerVolume: 7,
  maxVolume: 11,
  maxBonusX: 6,
  skillShot: 25000,
  rampsForExtraBall: [4, 12, 24],
  elevenTime: 22,
};

export class Game {
  constructor(layout, rng = Math.random) {
    this.L = layout;
    this.rng = rng;
    this.phys = new Physics(layout, rng);
    this.listeners = [];
    this.timers = [];
    this.time = 0;
    this.state = 'attract';
    this.lamps = {};
    this.score = 0;
    this.ball = 0;
    this.plunger = { held: false, charge: 0 };
    this.stats = {};
    this._resetGame();
  }

  on(fn) { this.listeners.push(fn); }
  fx(type, data) {
    const e = data || {};
    e.type = type;
    for (const fn of this.listeners) fn(e);
  }
  msg(key, vars, o = {}) { this.fx('msg', { key, vars, pri: o.pri ?? 1, dur: o.dur ?? 1.6, anim: o.anim }); }
  after(sec, fn) { this.timers.push({ t: this.time + sec, fn }); }
  lamp(id, mode) { this.lamps[id] = mode; }

  // ------------------------------------------------------------------ lifecycle
  _resetGame() {
    this.score = 0;
    this.ball = 0;
    this.extraBalls = 0;
    this.locks = 0;
    this.lockLit = true;
    this.multiball = false;
    this.jackpots = 0;
    this.superLit = false;
    this.bankCount = 0;
    this.rampsTotal = 0;
    this.extraBallLit = false;
    this.extraBallsGiven = 0;
    this.tiltWarnings = 0;
    this.tunnels = 0;
    this.stats = { bumpers: 0, ramps: 0, orbits: 0, targets: 0, skulls: 0, multiballs: 0, jackpots: 0, tunnels: 0, time: 0 };
    this._resetBall();
  }

  _resetBall() {
    this.volume = 1;
    this.volumeProgress = 0;
    this.bonusX = 1;
    this.b = { bumpers: 0, ramps: 0, orbits: 0, targets: 0, skulls: 0, tunnels: 0 };
    this.kick = { L: true, R: true };
    this.eleven = [false, false];
    this.frenzyUntil = 0;
    this.tunnelStreak = 0;
    this.lastTunnelT = -99;
    this.laneLit = [false, false, false];
    this.skillLane = 1;
    this.skillActive = false;
    this.rock = [false, false, false, false];
    this.combo = 0;
    this.lastShotT = -99;
    this.ballSaveUntil = 0;
    this.ballSaveArmed = false;
    this.elevenUntil = 0;
    this.scoreX = 1;
    this.tilted = false;
    this.lastSwitchT = this.time;
  }

  startGame() {
    this.timers.length = 0;
    for (const b of [...this.phys.balls]) this.phys.removeBall(b);
    this._resetGame();
    this.state = 'playing';
    this.fx('gameStart');
    this.fx('music', { state: 'play' });
    this.ball = 1;
    this._startBall();
  }

  _startBall() {
    this._resetBall();
    this.phys.setTilted(false);
    this.phys.resetTargets();
    this.phys.setGate('top', true);
    this.skillActive = true;
    this._launched = false;
    this.ballSaveArmed = true;
    this.state = 'playing';
    const b = this.phys.spawnInShooter();
    b.fresh = true;
    this.fx('ballStart', { ball: this.ball });
    this.msg('ball', { n: this.ball }, { dur: 1.8, pri: 2 });
    this._lamps();
  }

  add(points, at) {
    if (this.tilted || this.state !== 'playing') return 0;
    const p = Math.round(points * this.scoreX);
    this.score += p;
    this.fx('score', { score: this.score, points: p, x: at?.x, y: at?.y });
    return p;
  }

  _switchHit() {
    this.lastSwitchT = this.time;
    if (this.frenzyUntil && this.state === 'playing' && !this.tilted) { this.score += 2000; this.fx('score', { score: this.score, points: 2000 }); }
    if (this.skillActive && this._launched) {
      // the first real switch after the plunge ends the skill-shot window
      this.skillActive = false;
      this.phys.setGate('top', false);
      this._lamps();
    }
  }

  // ------------------------------------------------------------------ input
  flipper(id, pressed) {
    if (this.state === 'bonus' && pressed) { this._skipBonus = true; }
    if (this.state !== 'playing') { this.phys.setFlipper(id, pressed && this.state === 'attract'); return; }
    this.phys.setFlipper(id, pressed);
    if (pressed && !this.tilted) {
      // lane change
      if (id === 'L') { this.laneLit.push(this.laneLit.shift()); if (this.skillActive) this.skillLane = (this.skillLane + 2) % 3; }
      else { this.laneLit.unshift(this.laneLit.pop()); if (this.skillActive) this.skillLane = (this.skillLane + 1) % 3; }
      this._lamps();
    }
  }

  plungerDown() {
    if (this.state !== 'playing') return;
    if (this.phys.ballsInShooter() > 0) { this.plunger.held = true; this.fx('plungerPull'); }
  }

  plungerUp() {
    if (!this.plunger.held) return;
    this.plunger.held = false;
    const c = this.plunger.charge;
    this.plunger.charge = 0;
    if (this.state === 'playing') {
      const n = this.phys.launch(Math.max(0.08, c));
      this.fx('plungerRelease', { power: c, launched: n });
    }
  }

  nudge(dir = 0) {
    if (this.state !== 'playing' || this.tilted) return;
    this.phys.nudge(dir * 0.22, 0.3);
    this.fx('nudge', { dir });
    this._nudges = (this._nudges || []).filter((t) => this.time - t < 4);
    this._nudges.push(this.time);
    if (this._nudges.length >= 3) {
      this.tiltWarnings++;
      this._nudges.length = 0;
      if (this.tiltWarnings >= 3) {
        this.tilted = true;
        this.phys.setTilted(true);
        this.ballSaveUntil = 0;
        this.fx('tilt');
        this.msg('tilt', null, { dur: 3, pri: 5 });
      } else {
        this.fx('tiltWarning');
        this.msg('tiltWarning', null, { dur: 1.4, pri: 4 });
      }
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    this.time += dt;
    if (this.plunger.held) this.plunger.charge = Math.min(1, this.plunger.charge + dt / 0.95);
    if (this.state === 'playing') this.stats.time += dt;
    this.phys.step(dt);
    const ev = this.phys.events;
    for (let i = 0; i < ev.length; i++) this._handle(ev[i]);
    ev.length = 0;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].t <= this.time) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }

    if (this.state === 'playing') {
      // auto-plunge saved / multiball balls
      for (const b of this.phys.balls) {
        if (b.auto && b.mode === 'free' && b.inShooter && b.y < 0.2 && Math.abs(b.vy) < 0.05 && b.age > 0.5) {
          b.auto = false;
          this.phys.launch(0.86 + this.rng() * 0.12);
        }
        // ball search
        if (b.mode === 'free' && b.still > 3.2 && !b.inShooter && !this.phys.flippers.some((f) => f.pressed)) {
          b.still = 0;
          b.vx += (this.rng() - 0.5) * 0.8;
          b.vy += 0.5 + this.rng() * 0.5;
          this.fx('ballSearch', { x: b.x, y: b.y });
        }
      }
      if (this.elevenUntil && this.time > this.elevenUntil) {
        this.elevenUntil = 0;
        this.scoreX = 1;
        this.volume = 6;
        this.fx('elevenEnd');
        this._lamps();
      }
      if (this.ballSaveUntil && this.time > this.ballSaveUntil) { this.ballSaveUntil = 0; this._lamps(); }
      if (this.frenzyUntil && this.time > this.frenzyUntil) { this.frenzyUntil = 0; this.fx('frenzyEnd'); this._lamps(); }
      // safety: playing but no ball anywhere (should not happen)
      if (this.phys.balls.length === 0 && !this._pendingBalls) this._endBall();
    }
  }

  // ------------------------------------------------------------------ physics events
  _handle(e) {
    const playing = this.state === 'playing';
    switch (e.type) {
      case 'flipperUp': case 'flipperDown': case 'wall': case 'post': case 'gate': case 'flipperHit': case 'ballHit': case 'skullEject':
        this.fx(e.type, e); break;
      case 'launch':
        this.fx('launch', e); break;
      case 'bumper': {
        if (!playing) break;
        this._switchHit();
        this.b.bumpers++; this.stats.bumpers++;
        const pts = this.add(this.elevenUntil ? 5000 : 300 + 100 * this.volume, e);
        this.fx('bumper', { ...e, points: pts });
        if (!this.elevenUntil && ++this.volumeProgress >= RULES.bumperHitsPerVolume) {
          this.volumeProgress = 0;
          this.volume++;
          if (this.volume >= RULES.maxVolume) {
            this.volume = RULES.maxVolume;
            this.elevenUntil = this.time + RULES.elevenTime;
            this.scoreX = 2;
            this.fx('eleven');
            this.msg('eleven', null, { dur: 2.6, pri: 4, anim: 'flash' });
          } else {
            this.fx('volume', { volume: this.volume });
            this.msg('volume', { n: this.volume }, { dur: 1.1, pri: 1 });
          }
          this._lamps();
        }
        break;
      }
      case 'sling':
        if (!playing) break;
        this._switchHit();
        this.add(110, e);
        this.fx('sling', e);
        break;
      case 'dropTarget': {
        if (!playing) break;
        this._switchHit();
        this.rock[e.id] = true;
        this.b.targets++; this.stats.targets++;
        const pts = this.add(2500, e);
        this.fx('dropTarget', { ...e, points: pts });
        if (this.rock.every(Boolean)) {
          this.bankCount++;
          this.add(25000 * Math.min(4, this.bankCount), e);
          this.fx('bankComplete', { count: this.bankCount });
          if (this.multiball) {
            this.superLit = true;
            this.msg('superLit', null, { dur: 1.8, pri: 3 });
          } else if (!this.lockLit && this.locks < 3) {
            this.lockLit = true;
            this.msg('lockLit', null, { dur: 2, pri: 3, anim: 'flash' });
          } else {
            this.msg('rock', null, { dur: 1.8, pri: 2, anim: 'flash' });
          }
          this.after(1.1, () => { this.rock = [false, false, false, false]; this.phys.resetTargets(); this.fx('targetsReset'); this._lamps(); });
        }
        this._lamps();
        break;
      }
      case 'sensor': this._sensor(e); break;
      case 'standup': {
        if (!playing) break;
        this._switchHit();
        this.eleven[e.id] = true;
        const pts = this.add(3000, e);
        this.fx('standup', { ...e, points: pts });
        if (this.eleven.every(Boolean)) {
          this.eleven = [false, false];
          this.kick.L = true; this.kick.R = true;
          this.add(15000, e);
          this.volumeProgress = RULES.bumperHitsPerVolume - 1;
          this.fx('elevenTargets');
          this.msg('kickLit', null, { dur: 1.8, pri: 3, anim: 'flash' });
        }
        this._lamps();
        break;
      }
      case 'skull': this._skull(e); break;
      case 'rampEnter':
        if (playing) { this._switchHit(); this.fx('rampEnter', e); }
        break;
      case 'rampCommit': this.fx('rampCommit', e); break;
      case 'rampFail': this.fx('rampFail', e); break;
      case 'rampDone': {
        if (!playing) break;
        this._switchHit();
        this.b.ramps++; this.stats.ramps++; this.rampsTotal++;
        this._comboStep();
        if (this.multiball) {
          const v = 40000 + 10000 * this.jackpots;
          this.jackpots++; this.stats.jackpots++;
          const pts = this.add(v, e.ball);
          this.fx('jackpot', { points: pts, n: this.jackpots });
          this.msg('jackpot', { p: pts }, { dur: 2, pri: 4, anim: 'flash' });
          if (this.jackpots % 3 === 0) { this.superLit = true; this.msg('superLit', null, { dur: 1.8, pri: 3 }); }
        } else {
          const pts = this.add(6000 + 2000 * Math.min(this.combo, 8), e.ball);
          this.fx('rampDone', { points: pts, combo: this.combo });
          if (this.combo >= 1) this.msg('combo', { n: this.combo + 1, p: pts }, { dur: 1.4, pri: 2 });
          else this.msg('ramp', { p: pts }, { dur: 1.2, pri: 1 });
          if (RULES.rampsForExtraBall.includes(this.rampsTotal) && this.extraBallsGiven < 3) {
            this.extraBallLit = true;
            this.msg('extraLit', null, { dur: 2, pri: 3 });
          }
        }
        this._lamps();
        break;
      }
      case 'drain': this._drain(e); break;
      default: break;
    }
  }

  _comboStep() {
    if (this.time - this.lastShotT < 7) this.combo++; else this.combo = 0;
    this.lastShotT = this.time;
  }

  _sensor(e) {
    if (this.state !== 'playing') return;
    const id = e.id;
    if (id === 'launched') {
      if (e.vy > 0 && e.ball.fresh) {
        e.ball.fresh = false;
        this._launched = true;
        if (this.ballSaveArmed) { this.ballSaveArmed = false; this.ballSaveUntil = this.time + RULES.ballSave; }
        this.after(4.5, () => { if (this.skillActive) { this.skillActive = false; this.phys.setGate('top', false); this._lamps(); } });
        this.fx('launched');
        this._lamps();
      }
      return;
    }
    if (id.startsWith('lane')) {
      const i = 'AMP'.indexOf(id[4]);
      if (e.vy > 0.3) return; // only count balls dropping through
      if (this.skillActive && i === this.skillLane) {
        const pts = this.add(RULES.skillShot * this.ball, e.ball);
        this.fx('skillShot', { points: pts });
        this.msg('skill', { p: pts }, { dur: 2.2, pri: 4, anim: 'flash' });
      }
      this._switchHit();
      this.add(1000, e.ball);
      this.laneLit[i] = true;
      this.fx('rollover', { id, lane: i });
      if (this.laneLit.every(Boolean)) {
        this.laneLit = [false, false, false];
        if (this.bonusX < RULES.maxBonusX) this.bonusX++;
        this.add(10000, e.ball);
        this.fx('laneComplete', { bonusX: this.bonusX });
        this.msg('amp', { n: this.bonusX }, { dur: 2, pri: 3, anim: 'flash' });
      }
      this._lamps();
      return;
    }
    if (id === 'inL' || id === 'inR') {
      this._switchHit(); this.add(1000, e.ball); this.fx('rollover', { id }); return;
    }
    if (id === 'outL' || id === 'outR') {
      const side = id === 'outL' ? 'L' : 'R';
      this._switchHit();
      if (this.kick[side] && !this.tilted && e.vy < 0.5) {
        // stage dive: the crowd throws the ball back
        this.kick[side] = false;
        e.ball.vx = side === 'L' ? 0.1 : -0.1;
        e.ball.vy = 2.75;
        this.add(5000, e.ball);
        this.fx('kickback', { side, x: e.ball.x, y: e.ball.y });
        this.msg('kickback', null, { dur: 1.6, pri: 4, anim: 'flash' });
        this._lamps();
        return;
      }
      this.add(5000, e.ball); this.fx('outlane', { id }); return;
    }
    if (id === 'tunnel') {
      if (e.vy < 0.45) return; // only shots up through the legs count
      this._switchHit();
      this.tunnels++; this.b.tunnels++; this.stats.tunnels++;
      this.tunnelStreak = this.time - this.lastTunnelT < 14 ? this.tunnelStreak + 1 : 0;
      this.lastTunnelT = this.time;
      const pts = this.add(8000 + 4000 * Math.min(this.tunnelStreak, 5), e.ball);
      const big = this.tunnels % RULES.tunnelsForFrenzy === 0;
      this.fx('tunnel', { points: pts, big, x: e.ball.x, y: e.ball.y });
      if (big) {
        this.frenzyUntil = this.time + RULES.frenzyTime;
        this.kick.L = true; this.kick.R = true;
        this.fx('frenzy');
        this.msg('frenzy', null, { dur: 2.6, pri: 4, anim: 'flash' });
      } else {
        this.msg('tunnel', { p: pts }, { dur: 1.6, pri: 2, anim: 'flash' });
      }
      this._lamps();
      return;
    }
    if (id === 'orbL' || id === 'orbR') {
      if (e.vy < 0.7) return;
      this._switchHit();
      this.b.orbits++; this.stats.orbits++;
      this._comboStep();
      const pts = this.add(4000 + 1500 * Math.min(this.combo, 8) + (this.multiball ? 6000 : 0), e.ball);
      this.fx('orbit', { side: id === 'orbL' ? 'L' : 'R', points: pts, combo: this.combo });
      if (this.combo >= 1) this.msg('combo', { n: this.combo + 1, p: pts }, { dur: 1.4, pri: 2 });
      else this.msg('orbit', { p: pts }, { dur: 1.1, pri: 1 });
      return;
    }
    if (id === 'spinner') {
      const sp = Math.abs(e.vy);
      if (sp < 0.25) return;
      this._switchHit();
      const n = Math.max(1, Math.min(16, Math.round(sp * 4.5)));
      this.fx('spinner', { speed: sp, spins: n, which: e.which || 'L' });
      for (let k = 0; k < n; k++) {
        this.after(0.045 * k + 0.012 * k * k, () => { this.add(200); this.fx('spinTick', { k, n }); });
      }
    }
  }

  _skull(e) {
    const ball = e.ball;
    if (this.state !== 'playing') { this.after(0.8, () => this.phys.ejectSkull(ball)); return; }
    this._switchHit();
    this.b.skulls++; this.stats.skulls++;
    let hold = 0.9;
    this.fx('skullEat', { ball });
    if (this.extraBallLit) {
      this.extraBallLit = false;
      this.extraBalls++; this.extraBallsGiven++;
      this.fx('extraBall');
      this.msg('extraBall', null, { dur: 2.4, pri: 4, anim: 'flash' });
      hold = 1.8;
    }
    if (this.multiball) {
      if (this.superLit) {
        this.superLit = false;
        const pts = this.add(250000, ball);
        this.fx('superJackpot', { points: pts });
        this.msg('superJackpot', { p: pts }, { dur: 2.6, pri: 5, anim: 'flash' });
        hold = 1.4;
      } else {
        this.add(15000, ball);
      }
    } else if (this.lockLit) {
      this.locks++;
      this.add(20000, ball);
      if (this.locks >= 3) {
        this.locks = 0;
        this.lockLit = false;
        hold = 3.2;
        this._startMultiball(ball);
      } else {
        // lock 1 is free, lock 2 needs a completed R-O-C-K bank, lock 3 follows directly
        this.lockLit = this.locks >= 2;
        this.fx('lock', { n: this.locks });
        this.msg(this.lockLit ? 'lockedNext' : 'locked', { n: this.locks }, { dur: 2.2, pri: 3, anim: 'flash' });
        hold = 1.7;
      }
    } else {
      const pts = this.add(7500, ball);
      this.msg('skull', { p: pts }, { dur: 1.3, pri: 1 });
    }
    this._lamps();
    this.after(hold, () => { if (this.phys.balls.includes(ball)) this.phys.ejectSkull(ball); });
  }

  _startMultiball() {
    this.multiball = true;
    this.jackpots = 0;
    this.superLit = false;
    this.stats.multiballs++;
    this.fx('multiballStart');
    this.fx('music', { state: 'multiball' });
    this.msg('multiball', null, { dur: 3.2, pri: 6, anim: 'storm' });
    this.ballSaveUntil = this.time + 18;
    this.phys.setGate('top', true);
    this._pendingBalls = 2;
    for (let i = 0; i < 2; i++) {
      this.after(1.6 + i * 1.3, () => {
        this._pendingBalls--;
        if (this.state !== 'playing') return;
        const b = this.phys.spawnInShooter();
        b.auto = true;
      });
    }
    this.after(9, () => this.phys.setGate('top', false));
    this._lamps();
  }

  _drain(e) {
    if (this.state !== 'playing') return;
    const remaining = this.phys.balls.length + (this._pendingBalls || 0);
    this.fx('drainBall', { x: e.ball.x, lost: e.lost });
    if (!this.tilted && (this.time < this.ballSaveUntil || this.ballSaveArmed || e.lost)) {
      const b = this.phys.spawnInShooter();
      b.auto = true;
      this.fx('ballSaved');
      this.msg('ballSaved', null, { dur: 1.8, pri: 4, anim: 'flash' });
      return;
    }
    if (this.multiball && remaining <= 1) {
      this.multiball = false;
      this.superLit = false;
      this.fx('multiballEnd');
      this.fx('music', { state: 'play' });
      if (remaining === 1) this.msg('multiballEnd', null, { dur: 1.8, pri: 2 });
      this._lamps();
    }
    if (remaining === 0) this._endBall();
  }

  _endBall() {
    if (this.state !== 'playing') return;
    this.state = 'bonus';
    this.multiball = false;
    this.elevenUntil = 0; this.scoreX = 1;
    this.plunger.held = false; this.plunger.charge = 0;
    for (const f of this.phys.flippers) f.pressed = false;
    this.fx('drain', { tilted: this.tilted });
    this.frenzyUntil = 0;
    const base = this.tilted ? 0 : this.b.bumpers * 150 + this.b.ramps * 3000 + this.b.orbits * 1500 + this.b.targets * 750 + this.b.skulls * 2000 + this.b.tunnels * 2500;
    const total = base * this.bonusX;
    this._skipBonus = false;
    this.fx('bonus', { base, x: this.bonusX, total, tilted: this.tilted });
    const finish = () => {
      this.score += total;
      this.fx('score', { score: this.score, points: total });
      if (this.extraBalls > 0) {
        this.extraBalls--;
        this.msg('shootAgain', null, { dur: 2, pri: 4 });
        this._startBall();
      } else if (this.ball >= RULES.balls) {
        this._gameOver();
      } else {
        this.ball++;
        this._startBall();
      }
    };
    const wait = this.tilted ? 2.2 : 4.2;
    const t0 = this.time;
    const poll = () => {
      if (this.time - t0 >= wait || (this._skipBonus && this.time - t0 > 0.6)) finish();
      else this.after(0.05, poll);
    };
    this.after(0.05, poll);
    this._lamps();
  }

  _gameOver() {
    this.state = 'gameover';
    this.fx('music', { state: 'gameover' });
    this.fx('gameOver', { score: this.score, stats: this.stats });
    this._lamps();
  }

  toAttract() {
    this.state = 'attract';
    for (const b of [...this.phys.balls]) this.phys.removeBall(b);
    this.fx('music', { state: 'attract' });
    this.fx('attract');
  }

  // ------------------------------------------------------------------ lamps
  // 0 off, 1 on, 2 fast blink, 3 slow pulse
  _lamps() {
    const l = this.lamps;
    for (let i = 0; i < 11; i++) l[`vu${i}`] = i < this.volume ? (this.elevenUntil ? 2 : 1) : 0;
    for (let m = 2; m <= 6; m++) l[`bonus${m}`] = this.bonusX >= m ? 1 : 0;
    'AMP'.split('').forEach((c, i) => { l[`lane${c}`] = this.skillActive && i === this.skillLane ? 2 : this.laneLit[i] ? 1 : 0; });
    this.rock.forEach((d, i) => { l[`rock${i}`] = d ? 1 : 3; });
    for (let i = 1; i <= 3; i++) l[`lock${i}`] = this.locks >= i ? 1 : this.lockLit && this.locks + 1 === i ? 2 : 0;
    l.skullArrow = this.multiball ? (this.superLit ? 2 : 3) : this.lockLit || this.extraBallLit ? 2 : 3;
    l.extraBall = this.extraBallLit ? 2 : this.extraBalls > 0 ? 1 : 0;
    l.rampArrow = this.multiball ? 2 : 3;
    l.rampJackpot = this.multiball ? 2 : 0;
    l.orbLArrow = 3; l.orbRArrow = 3;
    l.shootAgain = this.time < this.ballSaveUntil || this.ballSaveArmed ? 2 : this.extraBalls > 0 ? 1 : 0;
    l.inL = 1; l.inR = 1;
    l.outL = this.kick.L ? 3 : 0; l.outR = this.kick.R ? 3 : 0;
    l.tunnelArrow = this.frenzyUntil ? 2 : 3;
    l.eleven0 = this.eleven[0] ? 1 : 3; l.eleven1 = this.eleven[1] ? 1 : 3;
    this.fx('lamps');
  }
}

export { PHYS };
