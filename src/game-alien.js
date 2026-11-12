// ERDABWEHR rules. Builds on the shared rules engine (scoring, ball save, tilt, bonus, kickback,
// pop bumpers, slings, lanes, ramp jackpots, the leg-shot frenzy) and adds this table's features:
//   - invasion waves started at the tank emplacement; all five lead to the counterstrike multiball
//   - the tractor beam: E-R-D-E lights the abduction lock, three balls taken up into the mothership
//     start the invasion multiball (the ship drops them back down the beam)
//   - the laser battery (three standups) charges the laser: the next beam shot hits the mothership,
//     five hits destroy it
//   - the war robot: three hits on its feet knock it out, the leg shot is the super jackpot

import { Game, RULES } from './game.js';

const MM = 0.001;
export const WAVES = [
  { id: 'saucers', need: 12, time: 40, award: 75000 },
  { id: 'robot', need: 3, time: 40, award: 75000 },
  { id: 'ramp', need: 3, time: 45, award: 75000 },
  { id: 'orbits', need: 4, time: 45, award: 75000 },
  { id: 'targets', need: 4, time: 40, award: 75000 },
];
const COUNTER = { id: 'counter', need: 10, time: 0, award: 50000 };
const BONUS_STEPS = [1, 2, 4, 6, 8];
const SHIP_HP = 5;
const ROBOT_ARMOR = 5;

export class GameAlien extends Game {
  _resetGame() {
    super._resetGame();
    this.lockLit = false;
    this.locks = 0;
    this.shipBalls = [];
    this.anims = [];
    this.waveIdx = 0;
    this.wavesDone = [false, false, false, false, false];
    this.shipHP = SHIP_HP;
    this.shipsDown = 0;
    this.robotArmor = ROBOT_ARMOR;
    this.robotsDown = 0;
    this.robotOut = false;
    this.stats.waves = 0;
    this.stats.shipHits = 0;
    this.stats.robots = 0;
  }

  _resetBall() {
    super._resetBall();
    this.wave = null;
    this.waveReady = true;
    this.counter = false;
    this.battery = [false, false, false];
    this.laserReady = false;
    this.bonusStep = 0;
    this.bonusX = 1;
  }

  freeBalls() { return this.phys.balls.filter((b) => !b.locked).length; }

  // ------------------------------------------------------------------ ball animations (beam lift / drop)
  _animate(ball, to, dur, done) {
    const from = [ball.x / MM, ball.y / MM, (ball.z || 0) / MM];
    ball.mode = 'held'; ball.vx = 0; ball.vy = 0;
    this.anims = this.anims.filter((a) => a.ball !== ball);
    this.anims.push({ ball, from, to, t0: this.time, dur, done });
  }

  _eject(ball, id) {
    if (!this.phys.balls.includes(ball)) return;
    ball.show = false; ball.z = 0;
    // the beam pad drops the ball out to the left and right in turn (never straight down the middle)
    if (id === 'beam') { this.beamSide = !this.beamSide; id = this.beamSide ? 'beamR' : 'beamL'; }
    const E = this.L.ejects[id];
    this.phys.placeBall(ball, E.x, E.y, { vx: E.vx * (1 + (this.rng() - 0.5) * 0.5), vy: E.vy * (1 + (this.rng() - 0.5) * 0.1) });
    this.fx('scoopEject', { id, ball });
  }

  // ------------------------------------------------------------------ waves
  _progress(kind, n = 1) {
    const w = this.wave;
    if (!w || w.def.id !== kind) return;
    w.count += n;
    this.fx('waveProgress', { id: kind, count: w.count, need: w.def.need });
    if (w.count >= w.def.need) this._waveEnd(true);
  }

  _startWave() {
    if (this.wavesDone.every(Boolean)) return this._startCounter();
    let idx = this.waveIdx;
    while (this.wavesDone[idx]) idx = (idx + 1) % WAVES.length;
    const def = WAVES[idx];
    this.wave = { idx, def, count: 0, until: this.time + def.time };
    this.waveReady = false;
    this.fx('waveStart', { idx, id: def.id });
    this.msg(`wave_${def.id}`, null, { dur: 2.6, pri: 5, anim: 'flash' });
    this._lamps();
  }

  _waveEnd(ok) {
    const w = this.wave;
    if (!w) return;
    this.wave = null;
    if (ok) {
      this.wavesDone[w.idx] = true;
      this.stats.waves++;
      const pts = this.add(w.def.award);
      this.fx('waveDone', { idx: w.idx, id: w.def.id, points: pts });
      this.msg('waveDone', { p: pts }, { dur: 2.4, pri: 5, anim: 'flash' });
    } else {
      this.fx('waveFail', { idx: w.idx });
      this.msg('waveFail', null, { dur: 1.8, pri: 3 });
    }
    this.waveIdx = (w.idx + 1) % WAVES.length;
    this.after(1.5, () => { this.waveReady = true; this._lamps(); });
    this._lamps();
  }

  _startCounter() {
    this.counter = true;
    this.waveReady = false;
    this.fx('counterStart');
    this.msg('counter', null, { dur: 3.2, pri: 7, anim: 'storm' });
    if (!this.multiball) this._startMultiball('counter');
    this._lamps();
  }

  _counterShot(ball) {
    if (!this.counter) return false;
    const pts = this.add(COUNTER.award + 10000 * Math.min(this.jackpots, 10), ball);
    this.jackpots++; this.stats.jackpots++;
    this.fx('jackpot', { points: pts, n: this.jackpots });
    this.msg('jackpot', { p: pts }, { dur: 1.4, pri: 4, anim: 'flash' });
    return true;
  }

  // ------------------------------------------------------------------ mothership
  _shipHit(ball) {
    this.shipHP--;
    this.stats.shipHits++;
    this.laserReady = false;
    this.battery = [false, false, false];
    if (this.shipHP <= 0) {
      this.shipsDown++;
      this.shipHP = SHIP_HP;
      const pts = this.add(250000 * Math.min(this.shipsDown, 3), ball);
      if (this.extraBallsGiven < 3) this.extraBallLit = true;
      this.fx('shipDown', { points: pts, n: this.shipsDown });
      this.msg('shipDown', { p: pts }, { dur: 3, pri: 6, anim: 'storm' });
    } else {
      const pts = this.add(30000, ball);
      this.fx('shipHit', { points: pts, hp: this.shipHP });
      this.msg('shipHit', { n: SHIP_HP - this.shipHP, m: SHIP_HP }, { dur: 1.8, pri: 4, anim: 'flash' });
    }
  }

  // E-R-D-E blocks the attack axis: once it is down it stays down (the way to the robot and the
  // beam is open) until a ball is abducted, a multiball starts or 25 seconds pass
  _bankTarget(e) {
    if (this.state !== 'playing') return;
    this._switchHit();
    this.rock[e.id] = true;
    this.b.targets++; this.stats.targets++;
    const pts = this.add(2500, e);
    this.fx('dropTarget', { ...e, points: pts });
    if (this.rock.every(Boolean)) {
      this.bankCount++;
      this.add(25000 * Math.min(4, this.bankCount), e);
      this.fx('bankComplete', { count: this.bankCount });
      if (this.multiball) { this.superLit = true; this.msg('superLit', null, { dur: 1.8, pri: 3 }); }
      else if (!this.lockLit && this.locks < 3) { this.lockLit = true; this.msg('lockLit', null, { dur: 2, pri: 3, anim: 'flash' }); }
      else this.msg('rock', null, { dur: 1.8, pri: 2, anim: 'flash' });
      const n = this.bankCount;
      this.after(25, () => { if (this.bankCount === n) this._resetBank(); });
    }
    this._lamps();
  }

  _resetBank() {
    if (!this.rock.every(Boolean)) return;
    this.rock = [false, false, false, false];
    this.phys.resetTargets();
    this.fx('targetsReset');
    this._lamps();
  }

  _abduct(ball) {
    this.after(2, () => this._resetBank());
    this.locks++;
    this.add(20000, ball);
    ball.locked = true; ball.show = true;
    const S = this.L.alien.ship;
    const slot = this.locks - 1;
    this.fx('abduct', { n: this.locks, ball });
    this._animate(ball, [S.x - 20 + slot * 20, S.y, S.z - 14], 1.5, () => { ball.show = false; });
    this.shipBalls.push(ball);
    this.lockLit = this.locks === 1; // the second lock needs E-R-D-E again, the third follows directly
    if (this.locks >= 3) {
      this.locks = 0;
      this.lockLit = false;
      this.msg('multiball', null, { dur: 3.2, pri: 6, anim: 'storm' });
      this.after(1.8, () => this._startMultiball());
    } else {
      this.msg(this.lockLit ? 'lockedNext' : 'locked', { n: this.locks }, { dur: 2.2, pri: 3, anim: 'flash' });
      this.after(1.6, () => { if (this.state === 'playing') { const b = this.phys.spawnInShooter(); b.auto = true; } });
    }
  }

  _release(ball, delay) {
    this.after(delay, () => {
      if (!this.phys.balls.includes(ball)) return;
      ball.show = true; ball.locked = false;
      const P = this.L.alien.beamPad;
      this.fx('release', { ball });
      this._animate(ball, [P.x, P.y, 0], 1.1, () => this._eject(ball, 'beam'));
    });
  }

  _startMultiball(kind) {
    this.after(3, () => this._resetBank());
    this.multiball = true;
    this.jackpots = 0;
    this.superLit = false;
    this.stats.multiballs++;
    this.fx('multiballStart', { kind });
    this.fx('music', { state: 'multiball' });
    this.ballSaveUntil = this.time + 18;
    const ship = this.shipBalls.splice(0);
    ship.forEach((b, i) => this._release(b, 0.5 + i * 0.8));
    const missing = Math.max(0, 3 - (ship.length + this.freeBalls()));
    this._pendingBalls = missing;
    for (let i = 0; i < missing; i++) {
      this.after(1.6 + i * 1.3, () => {
        this._pendingBalls--;
        if (this.state !== 'playing') return;
        const b = this.phys.spawnInShooter();
        b.auto = true;
      });
    }
    this._lamps();
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    super.update(dt);
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      if (!this.phys.balls.includes(a.ball)) { this.anims.splice(i, 1); continue; }
      const k = Math.min(1, (this.time - a.t0) / a.dur);
      const s = k * k * (3 - 2 * k);
      const b = a.ball;
      b.mode = 'held';
      b.x = (a.from[0] + (a.to[0] - a.from[0]) * s) * MM;
      b.y = (a.from[1] + (a.to[1] - a.from[1]) * s) * MM;
      b.z = (a.from[2] + (a.to[2] - a.from[2]) * s) * MM;
      if (k >= 1) { this.anims.splice(i, 1); if (a.done) a.done(); }
    }
    if (this.state !== 'playing') return;
    if (this.wave && this.time > this.wave.until) this._waveEnd(false);
  }

  // ------------------------------------------------------------------ events
  _handle(e) {
    const playing = this.state === 'playing';
    switch (e.type) {
      case 'scoop': return this._scoop(e);
      case 'bash': return this._robotHit(e);
      case 'bumper': if (playing) this._progress('saucers'); break;
      case 'dropTarget': if (playing) this._progress('targets'); return this._bankTarget(e);
      case 'rampDone':
        if (playing) { this._progress('ramp'); if (this._counterShot(e.ball)) { this._switchHit(); this.b.ramps++; this.stats.ramps++; this.rampsTotal++; this._lamps(); return; } }
        break;
      case 'standup':
        if (e.id >= 2) return this._battery(e);
        break;
      default: break;
    }
    return super._handle(e);
  }

  _sensor(e) {
    if (this.state !== 'playing') return super._sensor(e);
    const id = e.id;
    if (id.startsWith('lane')) {
      // U-F-O lanes: bonus steps 2x 4x 6x 8x
      const i = 'AMP'.indexOf(id[4]);
      if (e.vy > 0.3) return;
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
        if (this.bonusStep < BONUS_STEPS.length - 1) this.bonusStep++;
        this.bonusX = BONUS_STEPS[this.bonusStep];
        this.add(10000, e.ball);
        this.fx('laneComplete', { bonusX: this.bonusX });
        this.msg('amp', { n: this.bonusX }, { dur: 2, pri: 3, anim: 'flash' });
      }
      this._lamps();
      return;
    }
    if (id === 'spinnerR') return super._sensor({ ...e, id: 'spinner', which: 'R' });
    if ((id === 'orbL' || id === 'orbR') && e.vy >= 0.7) {
      this._progress('orbits');
      this._counterShot(e.ball);
    }
    if (id === 'tunnel' && e.vy >= 0.45) {
      // between the robot's legs
      this._progress('robot');
      this._counterShot(e.ball);
      if (this.multiball && this.superLit) {
        this.superLit = false;
        const pts = this.add(250000, e.ball);
        this.fx('superJackpot', { points: pts });
        this.msg('superJackpot', { p: pts }, { dur: 2.6, pri: 5, anim: 'flash' });
      }
    }
    return super._sensor(e);
  }

  _battery(e) {
    if (this.state !== 'playing') return;
    this._switchHit();
    const i = e.id - 2;
    const pts = this.add(this.battery[i] ? 1000 : 4000, e);
    this.fx('standup', { ...e, points: pts });
    if (this.laserReady || this.battery[i]) return;
    this.battery[i] = true;
    this.fx('battery', { i, n: this.battery.filter(Boolean).length });
    if (this.battery.every(Boolean)) {
      this.laserReady = true;
      this.fx('laserReady');
      this.msg('laserReady', null, { dur: 2.2, pri: 4, anim: 'flash' });
    }
    this._lamps();
  }

  _robotHit(e) {
    if (this.state !== 'playing') { this.fx('robotBash', e); return; }
    this._switchHit();
    this.add(2500, e);
    this.fx('robotBash', e);
    this._progress('robot');
    if (this.robotOut) return;
    if (--this.robotArmor <= 0) {
      this.robotsDown++; this.stats.robots++;
      this.robotOut = true;
      const pts = this.add(40000 * Math.min(this.robotsDown, 4), e);
      this.kick.L = true; this.kick.R = true;
      this.fx('robotDown', { points: pts, n: this.robotsDown });
      this.msg('robotDown', { p: pts }, { dur: 2.4, pri: 5, anim: 'flash' });
      this.after(8, () => { this.robotOut = false; this.robotArmor = ROBOT_ARMOR; this.fx('robotUp'); this._lamps(); });
    } else this.msg('robot', { n: ROBOT_ARMOR - this.robotArmor, m: ROBOT_ARMOR }, { dur: 1.1, pri: 1 });
    this._lamps();
  }

  _scoop(e) {
    const ball = e.ball;
    const playing = this.state === 'playing';
    ball.show = e.id === 'beam';
    this.fx('scoopEnter', { id: e.id, ball });
    if (!playing) { this.after(0.8, () => this._eject(ball, e.id)); return; }
    this._switchHit();
    if (e.id === 'tank') {
      let hold = 1.1;
      const pts0 = this.add(10000, ball);
      if (this.extraBallLit) {
        this.extraBallLit = false;
        this.extraBalls++; this.extraBallsGiven++;
        this.fx('extraBall');
        this.msg('extraBall', null, { dur: 2.4, pri: 4, anim: 'flash' });
        hold = 1.9;
      } else if (this._counterShot(ball)) {
        hold = 1.0;
      } else if (!this.wave && this.waveReady && !this.multiball) {
        this._startWave();
        hold = 2.2;
      } else this.msg('tank', { p: pts0 }, { dur: 1.3, pri: 2 });
      this.fx('tankLoad', { ball, hold });
      this.after(hold - 0.35, () => this.fx('tankFire'));
      this.after(hold, () => this._eject(ball, 'tank'));
      this._lamps();
      return;
    }
    // beam pad
    this.b.skulls++; this.stats.skulls++;
    if (this._counterShot(ball)) {
      this.after(0.9, () => this._eject(ball, 'beam'));
    } else if (this.laserReady) {
      this.fx('laserFire', { ball });
      this.after(0.5, () => this._shipHit(ball));
      this.after(1.4, () => this._eject(ball, 'beam'));
    } else if (this.lockLit && !this.multiball && this.locks < 3) {
      this.fx('tractor', { ball });
      this.after(0.4, () => { if (this.phys.balls.includes(ball)) this._abduct(ball); });
    } else {
      const pts = this.add(this.multiball ? 15000 : 5000, ball);
      this.msg('beam', { p: pts }, { dur: 1.2, pri: 1 });
      this.after(0.9, () => this._eject(ball, 'beam'));
    }
    this._lamps();
  }

  _drain(e) {
    if (this.state !== 'playing') return;
    const remaining = this.freeBalls() + (this._pendingBalls || 0);
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
      if (this.counter) {
        this.counter = false;
        this.wavesDone = [false, false, false, false, false];
        this.fx('counterEnd');
        this.after(1.5, () => { this.waveReady = true; this._lamps(); });
      }
      this.fx('multiballEnd');
      this.fx('music', { state: 'play' });
      if (remaining === 1) this.msg('multiballEnd', null, { dur: 1.8, pri: 2 });
      this._lamps();
    }
    if (remaining === 0) {
      if (this.wave) this._waveEnd(false);
      this._endBall();
    }
  }

  // ------------------------------------------------------------------ lamps
  _lamps() {
    super._lamps();
    const l = this.lamps;
    for (let i = 0; i < 5; i++) {
      l[`w${i}`] = this.counter ? 2 : this.wavesDone[i] ? 1 : this.wave && this.wave.idx === i ? 2 : !this.wave && this.waveReady && i === this.waveIdx ? 3 : 0;
      l[`hull${i}`] = i < SHIP_HP - this.shipHP ? 1 : this.laserReady && i === SHIP_HP - this.shipHP ? 2 : 0;
    }
    for (let i = 1; i <= 3; i++) l[`lock${i}`] = this.shipBalls.length >= i || this.locks >= i ? 1 : this.lockLit && this.locks + 1 === i ? 2 : 0;
    l.beamArrow = this.laserReady || this.lockLit || this.counter ? 2 : 3;
    l.extraBall = this.extraBallLit ? 2 : this.extraBalls > 0 ? 1 : 0;
    l.laserArrow = this.multiball || (this.wave && this.wave.def.id === 'ramp') ? 2 : 3;
    l.crossArrow = l.laserArrow;
    l.jackpot = this.multiball ? 2 : 0;
    l.crossJackpot = l.jackpot;
    l.robotArrow = (this.multiball && this.superLit) || (this.wave && this.wave.def.id === 'robot') ? 2 : 3;
    l.superJackpot = this.superLit ? 2 : 0;
    l.tankArrow = this.extraBallLit || (!this.wave && this.waveReady && !this.multiball) ? 2 : 3;
    for (let i = 0; i < 3; i++) l[`battery${i}`] = this.laserReady ? 2 : this.battery[i] ? 1 : 3;
    for (let i = 0; i < ROBOT_ARMOR; i++) l[`armor${i}`] = this.robotOut ? 2 : i < this.robotArmor ? 1 : 0;
    BONUS_STEPS.slice(1).forEach((m) => { l[`bonus${m}`] = this.bonusX >= m ? 1 : 0; });
  }
}
