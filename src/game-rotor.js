// ROTORSTURM rules. Builds on the shared rules engine (scoring, ball save, tilt, bonus, kickback,
// pop bumpers, slings, lanes) and adds this table's features:
//   missions started at the sunken helmet (M-I-S-S-I-O-N ladder), a physical 3-ball lock on the
//   helipad fed by the Hueyeinsatz ramp, the supply ramp with the M16 diverter, Khe Sanh and village
//   scoops, and the Cu Chi tunnel under glass with its own mini flipper.

import { Game, RULES } from './game.js';

const MM = 0.001;
export const MISSIONS = [
  { id: 'rolling', need: 4, time: 40, award: 75000 },
  { id: 'trail', need: 5, time: 40, award: 75000 },
  { id: 'tet', need: 25, time: 35, award: 75000 },
  { id: 'khesanh', need: 3, time: 45, award: 100000 },
  { id: 'abzug', need: 8, time: 0, award: 50000 },
];
const BONUS_STEPS = [1, 2, 4, 6, 8];
export const ALARM_TASKS = ['huey', 'supply', 'helmet', 'kheSanh', 'village', 'orbit'];

export class GameRotor extends Game {
  _resetGame() {
    super._resetGame();
    this.lockLit = false;
    this.locks = 0;
    this.padBalls = [];
    this.missionIdx = 0;
    this.missionsDone = [false, false, false, false, false];
    this.villages = 0;
    this.tunnelsDone = 0;
    this.diverter = 'R';
    this.stats.villages = 0;
    this.stats.missions = 0;
    this.stats.tunnels = 0;
  }

  _resetBall() {
    super._resetBall();
    this.mission = null;
    this.missionReady = true;
    this.cuchiLit = false;
    this.orbitsForCuchi = 0;
    this.tunnelHits = [false, false, false];
    this.bonusStep = 0;
    this.bonusX = 1;
    this.rock = [false, false, false, false, false];
    this.alarmHave = ALARM_TASKS.map(() => false);
    this.insane = false;
    if (this.phys) this.phys.setScoop('cuchi', false);
  }

  _startBall() {
    super._startBall();
    this.phys.setScoop('cuchi', false);
  }

  // ------------------------------------------------------------------ helpers
  _scoopHold(ball, id, sec, o = {}) {
    if (o.show) { ball.show = true; ball.z = (o.z ?? 0) * MM; }
    this.after(sec, () => this._eject(ball, id));
  }

  _eject(ball, id) {
    if (!this.phys.balls.includes(ball)) return;
    ball.show = false; ball.z = 0;
    if (id === 'helmet') {
      // the helmet fires the ball off in a random direction (any way round, even up into the bumpers)
      const H = this.L.helmet;
      const a = this.rng() * Math.PI * 2;
      const sp = 1.0 + this.rng() * 0.7;
      this.phys.placeBall(ball, H.x + Math.cos(a) * 19, H.y + Math.sin(a) * 19, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
      this.phys.setScoop('helmet', false);
      this.after(0.7, () => this.phys.setScoop('helmet', true));
      this.fx('scoopEject', { id, ball, angle: a });
      return;
    }
    const E = this.L.ejects[id];
    this.phys.placeBall(ball, E.x, E.y, { vx: E.vx * (1 + (this.rng() - 0.5) * 0.25), vy: E.vy * (1 + (this.rng() - 0.5) * 0.1) });
    this.fx('scoopEject', { id, ball });
  }

  // ------------------------------------------------------------------ red alert (insane mode)
  _alarmTask(key, ball) {
    // the alarm only builds up in normal play, never during a multiball (or it would feed itself)
    if (this.state !== 'playing' || this.tilted || this.multiball || this.insane) return;
    const i = ALARM_TASKS.indexOf(key);
    if (i < 0 || this.alarmHave[i]) return;
    this.alarmHave[i] = true;
    const n = this.alarmHave.filter(Boolean).length;
    this.fx('alarmStep', { i, n, need: ALARM_TASKS.length });
    if (n >= ALARM_TASKS.length) this._startInsane(ball);
    else if (!this.multiball) this.msg('alarmStep', { n, m: ALARM_TASKS.length }, { dur: 1.1, pri: 1 });
    this._lamps();
  }

  _startInsane() {
    this.alarmHave = ALARM_TASKS.map(() => false);
    this.insane = true;
    this.multiball = true;
    this.scoreX = 2;
    this.jackpots = 0;
    this.stats.insane = (this.stats.insane || 0) + 1;
    this.fx('insaneStart');
    this.fx('music', { state: 'multiball' });
    this.msg('insane', null, { dur: 3.4, pri: 7, anim: 'storm' });
    this.ballSaveUntil = Math.max(this.ballSaveUntil, this.time + 10);
    this.kick.L = true; this.kick.R = true;
    this._pendingBalls = (this._pendingBalls || 0) + 3;
    for (let i = 0; i < 3; i++) {
      this.after(1.2 + i * 0.9, () => {
        this._pendingBalls--;
        if (this.state !== 'playing') return;
        const b = this.phys.spawnInShooter();
        b.auto = true;
      });
    }
    this._lamps();
  }

  _endInsane() {
    if (!this.insane) return;
    this.insane = false;
    this.scoreX = this.elevenUntil ? 2 : 1;
    this.fx('insaneEnd');
    this._lamps();
  }

  _insaneHit(ball) {
    if (!this.insane) return;
    const pts = this.add(25000, ball);
    this.fx('insaneHit', { points: pts, x: ball && ball.x, y: ball && ball.y });
  }

  _progress(kind, n = 1) {
    const m = this.mission;
    if (!m || m.def.id !== kind) return;
    m.count += n;
    this.fx('missionProgress', { id: kind, count: m.count, need: m.def.need });
    if (m.count >= m.def.need && kind !== 'abzug') this._missionEnd(true);
  }

  _startMission() {
    let idx = this.missionsDone.slice(0, 4).every(Boolean) ? 4 : this.missionIdx;
    while (idx < 4 && this.missionsDone[idx]) idx = (idx + 1) % 4;
    const def = MISSIONS[idx];
    this.mission = { idx, def, count: 0, until: def.time ? this.time + def.time : 0 };
    this.missionReady = false;
    this.fx('missionStart', { idx, id: def.id });
    this.msg(`mission_${def.id}`, null, { dur: 2.6, pri: 5, anim: 'flash' });
    if (def.id === 'abzug') this._startMultiball('abzug');
    this._lamps();
  }

  _missionEnd(ok) {
    const m = this.mission;
    if (!m) return;
    this.mission = null;
    if (ok) {
      this.missionsDone[m.idx] = true;
      this.stats.missions++;
      const pts = this.add(m.def.award);
      this.fx('missionDone', { idx: m.idx, id: m.def.id, points: pts });
      this.msg('missionDone', { p: pts }, { dur: 2.4, pri: 5, anim: 'flash' });
      if (m.def.id === 'abzug') this.missionsDone = [false, false, false, false, false];
    } else {
      this.fx('missionFail', { idx: m.idx });
      this.msg('missionFail', null, { dur: 1.8, pri: 3 });
    }
    this.missionIdx = (m.idx + 1) % 4;
    this.after(1.5, () => { this.missionReady = true; this._lamps(); });
    this._lamps();
  }

  // ------------------------------------------------------------------ update: mission timers
  update(dt) {
    super.update(dt);
    if (this.insane && this.state === 'playing') this.scoreX = 2;
    const m = this.mission;
    if (this.state === 'playing' && m && m.until && this.time > m.until) this._missionEnd(false);
  }

  // ------------------------------------------------------------------ events
  _handle(e) {
    const playing = this.state === 'playing';
    switch (e.type) {
      case 'scoop': return this._scoop(e);
      case 'rampDone': return this._rampDone(e);
      case 'rampEnter':
        if (playing) { this._switchHit(); this.fx('rampEnter', e); }
        return;
      case 'standup':
        if (e.id >= 10) return this._tunnelTarget(e);
        break;
      case 'bumper': case 'sling':
        if (playing) this._progress('tet');
        break;
      case 'dropTarget':
        if (playing) this._progress('tet', 2);
        return this._starTarget(e);
      default: break;
    }
    return super._handle(e);
  }

  _sensor(e) {
    if (this.state !== 'playing') return super._sensor(e);
    const id = e.id;
    if (id.startsWith('lane')) {
      // S-O-S lanes: same as the base table, but the bonus steps 2x 4x 6x 8x
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
    if (id === 'spinnerR') return super._sensor({ ...e, id: 'spinner' });
    if ((id === 'orbL' || id === 'orbR') && e.vy >= 0.7) {
      this._alarmTask('orbit', e.ball); this._insaneHit(e.ball);
      this._progress('trail');
      if (this.mission && this.mission.def.id === 'abzug') this._abzugShot(e.ball);
      if (!this.cuchiLit && ++this.orbitsForCuchi >= 2) {
        this.orbitsForCuchi = 0;
        this.cuchiLit = true;
        this.phys.setScoop('cuchi', true);
        this.fx('cuchiLit');
        this.msg('cuchiLit', null, { dur: 1.8, pri: 3 });
        this._lamps();
      }
    }
    return super._sensor(e);
  }

  _abzugShot(ball) {
    const pts = this.add(MISSIONS[4].award, ball);
    this.jackpots++; this.stats.jackpots++;
    this.fx('jackpot', { points: pts, n: this.jackpots });
    this.msg('jackpot', { p: pts }, { dur: 1.6, pri: 4, anim: 'flash' });
    this._progress('abzug');
  }

  _scoop(e) {
    const ball = e.ball;
    const playing = this.state === 'playing';
    this.fx('scoopEnter', { id: e.id, ball });
    if (!playing) {
      if (e.id === 'cuchi' || e.id === 'tunnelExit') this.after(0.6, () => this._eject(ball, 'village'));
      else this.after(0.8, () => this._eject(ball, e.id));
      return;
    }
    this._switchHit();
    switch (e.id) {
      case 'helmet': {
        this._alarmTask('helmet', ball); this._insaneHit(ball);
        this.b.skulls++; this.stats.skulls++;
        let hold = 1.1;
        if (this.multiball && this.superLit) {
          this.superLit = false;
          const pts = this.add(250000, ball);
          this.fx('superJackpot', { points: pts });
          this.msg('superJackpot', { p: pts }, { dur: 2.6, pri: 5, anim: 'flash' });
          hold = 1.6;
        } else if (!this.mission && this.missionReady && !this.multiball) {
          this._startMission();
          hold = 2.2;
        } else if (this.mission && this.mission.def.id === 'abzug') {
          this._abzugShot(ball);
        } else {
          const pts = this.add(5000, ball);
          this.msg('skull', { p: pts }, { dur: 1.2, pri: 1 });
        }
        this._scoopHold(ball, 'helmet', hold, { show: true, z: -14 });
        break;
      }
      case 'kheSanh': {
        this._alarmTask('kheSanh', ball); this._insaneHit(ball);
        let hold = 1.0;
        const pts = this.add(10000, ball);
        this.fx('kheSanh', { points: pts });
        if (this.extraBallLit) {
          this.extraBallLit = false;
          this.extraBalls++; this.extraBallsGiven++;
          this.fx('extraBall');
          this.msg('extraBall', null, { dur: 2.4, pri: 4, anim: 'flash' });
          hold = 1.8;
        } else this.msg('kheSanh', { p: pts }, { dur: 1.4, pri: 2 });
        this._progress('khesanh');
        if (this.mission && this.mission.def.id === 'abzug') this._abzugShot(ball);
        this._scoopHold(ball, 'kheSanh', hold);
        break;
      }
      case 'village': {
        this._alarmTask('village', ball); this._insaneHit(ball);
        this.villages++; this.stats.villages++;
        const pts = this.add(15000, ball);
        this.fx('village', { points: pts, n: this.villages });
        if (this.villages % 3 === 0) {
          this.kick.L = true; this.kick.R = true;
          this.add(25000, ball);
          this.msg('villageSaved', null, { dur: 2.2, pri: 4, anim: 'flash' });
        } else this.msg('village', { p: pts }, { dur: 1.4, pri: 2 });
        if (this.mission && this.mission.def.id === 'abzug') this._abzugShot(ball);
        this._scoopHold(ball, 'village', 1.0);
        break;
      }
      case 'arch': {
        // the stone tunnel behind the star bank: the helicopter's winch lifts the ball onto the helipad
        const pts = this.add(5000, ball);
        this.fx('archLift', { points: pts, ball });
        this.msg('arch', { p: pts }, { dur: 1.4, pri: 2 });
        this.after(0.9, () => {
          if (!this.phys.balls.includes(ball)) return;
          const J = this.L.rampExits.huey;
          this.phys.placeBall(ball, J[0], J[1], { mode: 'held', z: J[2] });
          ball.show = true;
          if (this.state === 'playing' && this.lockLit && !this.multiball && this.locks < 3) this._padLock(ball);
          else { ball.show = false; this.phys.sendToRail(ball, 'padReturn', 1.0); }
          this._lamps();
        });
        break;
      }
      case 'cuchi': {
        this.cuchiLit = false;
        this.phys.setScoop('cuchi', false);
        this.tunnelHits = [false, false, false];
        this.fx('tunnelEnter', { ball });
        this.msg('tunnelIn', null, { dur: 2.2, pri: 4, anim: 'flash' });
        this.after(1.0, () => {
          if (!this.phys.balls.includes(ball)) return;
          const T = this.L.tunnelEntry;
          this.phys.placeBall(ball, T.x, T.y, { level: 0, vx: 0.15, vy: -0.2 });
          this.fx('tunnelDrop', { ball });
        });
        break;
      }
      case 'tunnelExit': {
        const done = this.tunnelHits.filter(Boolean).length;
        this.fx('tunnelExit', { ball, hits: done });
        this.after(0.9, () => {
          if (!this.phys.balls.includes(ball)) return;
          const V = this.L.village;
          this.phys.placeBall(ball, V.x, V.y, { mode: 'held' });
          this._eject(ball, 'village');
        });
        break;
      }
      default:
        this.after(0.8, () => this._eject(ball, e.id));
    }
    this._lamps();
  }

  _starTarget(e) {
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
      this.after(1.1, () => { this.rock = [false, false, false, false, false]; this.phys.resetTargets(); this.fx('targetsReset'); this._lamps(); });
    }
    this._lamps();
  }

  _tunnelTarget(e) {
    if (this.state !== 'playing') return;
    const i = e.id - 10;
    this._switchHit();
    if (this.tunnelHits[i]) { this.add(1000); return; }
    this.tunnelHits[i] = true;
    const pts = this.add(5000, e);
    this.fx('tunnelTarget', { i, points: pts });
    if (this.tunnelHits.every(Boolean)) {
      this.tunnelsDone++; this.stats.tunnels++;
      const p2 = this.add(50000 * Math.min(3, this.tunnelsDone));
      this.fx('tunnelDone', { points: p2 });
      this.msg('tunnelDone', { p: p2 }, { dur: 2.4, pri: 5, anim: 'flash' });
    }
    this._lamps();
  }

  _rampDone(e) {
    const ball = e.ball;
    const playing = this.state === 'playing';
    if (e.id === 'supply') {
      if (playing) { this._alarmTask('supply', ball); this._insaneHit(ball); }
      // the M16 diverter decides which inlane the supply run ends at
      this.diverter = this.diverter === 'R' ? 'L' : 'R';
      this.fx('diverter', { side: this.diverter });
      this.phys.sendToRail(ball, this.diverter === 'L' ? 'retL' : 'retR', 1.3);
      if (!playing) return;
      this._switchHit();
      this.b.ramps++; this.stats.ramps++; this.rampsTotal++;
      this._comboStep();
      this._progress('rolling');
      if (this.mission && this.mission.def.id === 'abzug') this._abzugShot(ball);
      else if (this.multiball) {
        const v = 40000 + 10000 * this.jackpots;
        this.jackpots++; this.stats.jackpots++;
        const pts = this.add(v, ball);
        this.fx('jackpot', { points: pts, n: this.jackpots });
        this.msg('jackpot', { p: pts }, { dur: 2, pri: 4, anim: 'flash' });
        if (this.jackpots % 3 === 0) { this.superLit = true; this.msg('superLit', null, { dur: 1.8, pri: 3 }); }
      } else {
        const pts = this.add(6000 + 2000 * Math.min(this.combo, 8), ball);
        this.fx('rampDone', { points: pts, combo: this.combo, id: 'supply' });
        if (this.combo >= 1) this.msg('combo', { n: this.combo + 1, p: pts }, { dur: 1.4, pri: 2 });
        else this.msg('ramp', { p: pts }, { dur: 1.2, pri: 1 });
        if (RULES.rampsForExtraBall.includes(this.rampsTotal) && this.extraBallsGiven < 3) {
          this.extraBallLit = true;
          this.msg('extraLit', null, { dur: 2, pri: 3 });
        }
      }
      this._lamps();
      return;
    }
    if (e.id === 'huey') {
      if (!playing) { this.phys.sendToRail(ball, 'padReturn', 1.0); return; }
      this._alarmTask('huey', ball); this._insaneHit(ball);
      this._switchHit();
      this.b.ramps++; this.stats.ramps++;
      this._progress('rolling');
      if (this.mission && this.mission.def.id === 'abzug') this._abzugShot(ball);
      if (this.lockLit && !this.multiball && this.locks < 3) {
        this._padLock(ball);
      } else {
        const pts = this.add(this.multiball ? 30000 : 8000, ball);
        this.fx('rampDone', { points: pts, id: 'huey' });
        this.msg('huey', { p: pts }, { dur: 1.2, pri: 1 });
        this.phys.sendToRail(ball, 'padReturn', 1.0);
      }
      this._lamps();
      return;
    }
    // wire returns arrive at the inlanes
    if (playing) this.fx('wireDone', e);
  }

  _padLock(ball) {
    this.locks++;
    const slot = this.L.rotor.lockSlots[this.locks - 1];
    this.phys.placeBall(ball, slot[0], slot[1], { mode: 'held', z: this.L.rotor.padZ });
    ball.show = true; ball.locked = true;
    this.padBalls.push(ball);
    this.add(20000, ball);
    this.lockLit = this.locks < 3 && this.locks >= 2;
    if (this.locks === 1) this.lockLit = false;
    this.fx('lock', { n: this.locks });
    if (this.locks >= 3) {
      this.locks = 0;
      this.lockLit = false;
      this.msg('multiball', null, { dur: 3.2, pri: 6, anim: 'storm' });
      this.after(1.2, () => this._startMultiball());
    } else {
      this.msg(this.lockLit ? 'lockedNext' : 'locked', { n: this.locks }, { dur: 2.2, pri: 3, anim: 'flash' });
      // the locked ball stays on the pad; the crew sends a new one up the shooter lane
      this.after(1.0, () => { if (this.state === 'playing') { const b = this.phys.spawnInShooter(); b.auto = true; } });
    }
  }

  _startMultiball(kind) {
    this.multiball = true;
    this.jackpots = 0;
    this.superLit = false;
    this.stats.multiballs++;
    this.fx('multiballStart', { kind });
    this.fx('music', { state: 'multiball' });
    this.ballSaveUntil = this.time + 18;
    // release the balls waiting on the helipad one after another
    const pad = this.padBalls.splice(0);
    pad.forEach((b, i) => this.after(0.6 + i * 0.7, () => {
      if (!this.phys.balls.includes(b)) return;
      b.locked = false; b.show = false;
      this.phys.sendToRail(b, 'padReturn', 0.9);
      this.fx('padRelease', { ball: b });
    }));
    const missing = Math.max(0, 3 - (pad.length + this.freeBalls()));
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

  freeBalls() { return this.phys.balls.filter((b) => !b.locked).length; }

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
      this._endInsane();
      if (this.mission && this.mission.def.id === 'abzug') this._missionEnd(this.mission.count >= MISSIONS[4].need);
      this.fx('multiballEnd');
      this.fx('music', { state: 'play' });
      if (remaining === 1) this.msg('multiballEnd', null, { dur: 1.8, pri: 2 });
      this._lamps();
    }
    if (remaining === 0) {
      this._endInsane();
      if (this.mission) this._missionEnd(false);
      this._endBall();
    }
  }

  // ------------------------------------------------------------------ lamps
  _lamps() {
    super._lamps();
    const l = this.lamps;
    const done = this.missionsDone.filter(Boolean).length;
    const t = this.time;
    for (let i = 0; i < 7; i++) l[`ladder${i}`] = i < Math.round((done * 7) / 4) ? 1 : this.mission ? 2 : 0;
    for (let i = 0; i < 5; i++) {
      l[`m${i}`] = this.missionsDone[i] ? 1 : this.mission && this.mission.idx === i ? 2 : !this.mission && this.missionReady && i === (done >= 4 ? 4 : this.missionIdx) ? 3 : 0;
    }
    l.helmetArrow = (this.multiball && this.superLit) || (!this.mission && this.missionReady && !this.multiball) ? 2 : 3;
    l.hueyArrow = this.lockLit ? 2 : this.multiball ? 2 : 3;
    l.supplyArrow = this.multiball || (this.mission && this.mission.def.id === 'rolling') ? 2 : 3;
    l.kheSanhArrow = this.extraBallLit || (this.mission && this.mission.def.id === 'khesanh') ? 2 : 3;
    l.villageArrow = 3;
    l.cuchiLit = this.cuchiLit ? 2 : 0;
    for (let i = 1; i <= 3; i++) l[`lock${i}`] = this.padBalls.length >= i || this.locks >= i ? 1 : this.lockLit && this.locks + 1 === i ? 2 : 0;
    const trail = this.mission && this.mission.def.id === 'trail' ? this.mission.count : 0;
    for (let i = 0; i < 5; i++) l[`trail${i}`] = i < trail ? 1 : this.mission && this.mission.def.id === 'trail' ? 3 : 0;
    BONUS_STEPS.slice(1).forEach((m) => { l[`bonus${m}`] = this.bonusX >= m ? 1 : 0; });
    for (let i = 0; i < 3; i++) l[`tunnel${i}`] = this.tunnelHits[i] ? 1 : 3;
    l.extraBall = this.extraBallLit ? 2 : this.extraBalls > 0 ? 1 : 0;
    l.jackpot = this.multiball ? 2 : 0;
    for (let i = 0; i < 5; i++) l[`star${i}`] = this.rock && this.rock[i] ? 1 : 3;
    l.archArrow = this.lockLit ? 2 : 3;
    for (let i = 0; i < ALARM_TASKS.length; i++) l[`alarm${i}`] = this.insane ? 2 : this.alarmHave && this.alarmHave[i] ? 1 : 3;
    void t;
  }
}
