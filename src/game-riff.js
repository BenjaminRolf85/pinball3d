// RIFFGEWITTER rules on top of the shared engine: the setlist (five song modes started at the
// backstage scoop, then the encore finale multiball), the turntable (scratch mode lit by the
// microphone stand) and the second spinner.

import { Game } from './game.js';

export const SONGS = [
  { id: 'donner', need: 10, time: 45, award: 60000 },
  { id: 'stahl', need: 2, time: 45, award: 75000 },
  { id: 'express', need: 3, time: 45, award: 75000 },
  { id: 'feuer', need: 4, time: 45, award: 75000 },
  { id: 'vinyl', need: 4, time: 45, award: 75000 },
];

export class GameRiff extends Game {
  _resetGame() {
    super._resetGame();
    this.songsDone = [false, false, false, false, false];
    this.songIdx = 0;
    this.finale = false;
    this.backstages = 0;
    this.stats.songs = 0;
  }

  _resetBall() {
    super._resetBall();
    this.song = null;
    this.songReady = true;
    this.micHits = 0;
    this.scratchUntil = 0;
    if (this.phys) this.phys.setDisc('vinyl', 7);
  }

  // ------------------------------------------------------------------ helpers
  _eject(ball, id) {
    if (!this.phys.balls.includes(ball)) return;
    const E = this.L.ejects[id];
    ball.show = false;
    this.phys.placeBall(ball, E.x, E.y, { vx: E.vx * (1 + (this.rng() - 0.5) * 0.25), vy: E.vy * (1 + (this.rng() - 0.5) * 0.1) });
    this.fx('scoopEject', { id, ball });
  }

  _songProgress(kind, n = 1) {
    const s = this.song;
    if (!s || s.def.id !== kind) return;
    s.count += n;
    this.fx('songProgress', { id: kind, count: s.count, need: s.def.need });
    if (s.count >= s.def.need) this._songEnd(true);
  }

  _finaleShot(ball) {
    if (!this.finale) return;
    const pts = this.add(50000, ball);
    this.jackpots++; this.stats.jackpots++;
    this.fx('jackpot', { points: pts, n: this.jackpots });
    this.msg('jackpot', { p: pts }, { dur: 1.4, pri: 4, anim: 'flash' });
  }

  _startSong() {
    if (this.songsDone.every(Boolean)) return this._startFinale();
    let idx = this.songIdx;
    while (this.songsDone[idx]) idx = (idx + 1) % SONGS.length;
    const def = SONGS[idx];
    this.song = { idx, def, count: 0, until: this.time + def.time };
    this.songReady = false;
    this.fx('songStart', { idx, id: def.id });
    this.msg(`song_${def.id}`, null, { dur: 2.6, pri: 5, anim: 'flash' });
    this._lamps();
  }

  _songEnd(ok) {
    const s = this.song;
    if (!s) return;
    this.song = null;
    if (ok) {
      this.songsDone[s.idx] = true;
      this.stats.songs++;
      const pts = this.add(s.def.award);
      this.fx('songDone', { idx: s.idx, points: pts });
      this.msg('songDone', { p: pts }, { dur: 2.4, pri: 5, anim: 'flash' });
    } else {
      this.fx('songFail', { idx: s.idx });
      this.msg('songFail', null, { dur: 1.8, pri: 3 });
    }
    this.songIdx = (s.idx + 1) % SONGS.length;
    this.after(1.5, () => { this.songReady = true; this._lamps(); });
    this._lamps();
  }

  _startFinale() {
    this.finale = true;
    this.songReady = false;
    this.fx('finaleStart');
    this.msg('finale', null, { dur: 3.2, pri: 7, anim: 'storm' });
    if (!this.multiball) this._startMultiball();
    this._lamps();
  }

  // ------------------------------------------------------------------ update: song timer, scratch
  update(dt) {
    super.update(dt);
    if (this.state !== 'playing') return;
    if (this.song && this.time > this.song.until) this._songEnd(false);
    if (this.scratchUntil && this.time > this.scratchUntil) {
      this.scratchUntil = 0;
      this.phys.setDisc('vinyl', 7);
      this.fx('scratchEnd');
      this._lamps();
    }
  }

  // ------------------------------------------------------------------ events
  _handle(e) {
    const playing = this.state === 'playing';
    switch (e.type) {
      case 'scoop': return this._scoop(e);
      case 'disc': return this._disc(e);
      case 'bash': return this._bash(e);
      case 'bumper': if (playing) this._songProgress('donner'); break;
      case 'dropTarget': if (playing) this._songProgress('feuer'); break;
      case 'rampDone': if (playing) { this._songProgress('stahl'); this._finaleShot(e.ball); } break;
      case 'skull': if (playing) this._finaleShot(e.ball); break;
      default: break;
    }
    return super._handle(e);
  }

  _sensor(e) {
    if (e.id === 'spinnerR') return super._sensor({ ...e, id: 'spinner', which: 'R' });
    if (this.state === 'playing' && (e.id === 'orbL' || e.id === 'orbR') && e.vy >= 0.7) {
      this._songProgress('express');
      this._finaleShot(e.ball);
    }
    return super._sensor(e);
  }

  _scoop(e) {
    const ball = e.ball;
    ball.show = false; // the ball disappears into the tour bus
    this.fx('scoopEnter', { id: e.id, ball });
    if (this.state !== 'playing') { this.after(0.8, () => this._eject(ball, e.id)); return; }
    this._switchHit();
    let hold = 1.0;
    this.backstages++;
    if (this.finale) this._finaleShot(ball);
    else if (!this.song && this.songReady && !this.multiball) { this._startSong(); hold = 2.0; }
    else {
      const pts = this.add(15000, ball);
      this.fx('backstage', { points: pts });
      this.msg('backstage', { p: pts }, { dur: 1.4, pri: 2 });
    }
    this.after(hold, () => this._eject(ball, e.id));
    this._lamps();
  }

  _disc(e) {
    if (this.state !== 'playing') return;
    this._switchHit();
    const pts = this.add(this.scratchUntil ? 7500 : 1500, e.ball);
    this.fx('disc', { points: pts, scratch: !!this.scratchUntil, ball: e.ball });
    this._songProgress('vinyl');
    if (this.finale) this._finaleShot(e.ball);
  }

  _bash(e) {
    if (this.state !== 'playing') { this.fx('bash', e); return; }
    this._switchHit();
    this.add(2500, e);
    this.fx('bash', e);
    if (this.scratchUntil) return;
    if (++this.micHits >= 3) {
      this.micHits = 0;
      this.scratchUntil = this.time + 15;
      this.phys.setDisc('vinyl', -17);
      this.fx('scratch');
      this.msg('scratch', null, { dur: 2, pri: 4, anim: 'flash' });
    } else this.msg('mic', { n: this.micHits }, { dur: 1, pri: 1 });
    this._lamps();
  }

  _drain(e) {
    super._drain(e);
    if (this.finale && !this.multiball) {
      this.finale = false;
      this.songsDone = [false, false, false, false, false];
      this.fx('finaleEnd');
      this._lamps();
    }
    if (this.state !== 'playing' && this.song) this.song = null;
  }

  // ------------------------------------------------------------------ lamps
  _lamps() {
    super._lamps();
    const l = this.lamps;
    for (let i = 0; i < 5; i++) {
      l[`song${i}`] = this.finale ? 2 : this.songsDone[i] ? 1 : this.song && this.song.idx === i ? 2 : !this.song && this.songReady && i === this.songIdx ? 3 : 0;
    }
    l.backstageArrow = this.finale || (!this.song && this.songReady && !this.multiball) ? 2 : 3;
    l.vinylArrow = this.scratchUntil ? 2 : (this.song && this.song.def.id === 'vinyl') ? 2 : 3;
    l.micLamp = this.scratchUntil ? 2 : this.micHits > 0 ? 1 : 3;
  }
}
