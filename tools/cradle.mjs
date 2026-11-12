import { buildLayout } from '../src/layout.js';
import { Game } from '../src/game.js';
const g = new Game(buildLayout(), () => 0.5);
g.startGame(); for (const b of [...g.phys.balls]) g.phys.removeBall(b);
g.skillActive = false; g.ballSaveArmed = false;
const b = g.phys.addBall(59, 300, 0, 0);
g.flipper('L', true);
for (let t = 0; t < 4; t += 1 / 240) g.update(1 / 240);
console.log('cradle pos', (b.x * 1000).toFixed(1), (b.y * 1000).toFixed(1), 'speed', Math.hypot(b.vx, b.vy).toFixed(4), 'balls', g.phys.balls.length);
g.flipper('L', false);
let log = [];
for (let t = 0; t < 1.2; t += 1 / 240) { g.update(1 / 240); if (Math.round(t * 240) % 24 === 0) log.push(`${(b.x * 1000).toFixed(0)},${(b.y * 1000).toFixed(0)}`); }
console.log('release roll', log.join(' '));
