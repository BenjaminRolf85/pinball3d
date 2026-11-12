import { Game } from '../src/game.js';
import { playGame } from './sim.mjs';
const pos = {};
const orig = Game.prototype.fx;
Game.prototype.fx = function (type, data) { if (type === 'ballSearch') { const k = `${Math.round(data.x * 100) * 10},${Math.round(data.y * 100) * 10}`; pos[k] = (pos[k] || 0) + 1; } return orig.call(this, type, data); };
for (let i = 0; i < 30; i++) playGame(1000 + i);
console.log(Object.entries(pos).sort((a, b) => b[1] - a[1]).slice(0, 12));
