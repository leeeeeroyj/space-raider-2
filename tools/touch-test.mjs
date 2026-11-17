// Touch on a phone held sideways: the two sticks are drawn, the left one moves the ship and the right one fires, and at
// game over RETRY can be tapped.
// Usage: node tools/touch-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';
const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5259, debugPort: 9429, width: 915, height: 412, touch: true, mobile: true });
const { evaluate, until, shot, check, sleep, press, move, lift } = t;
const G = 'window.__spaceRaider', S = `${G}.screen`;
await until(() => evaluate(`${G}?.screen?.name === 'title'`), 20000);
await sleep(600);
await shot('t1-title');
// START is centred at design (208, 117); RETRY at (108, 106).
const r = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left, r.top, r.width / 416]; })()`);
const at = (x, y) => [r[0] + x * r[2], r[1] + y * r[2]];
await press(1, ...at(208, 117)); await sleep(60); await lift(1);
await until(() => evaluate(`${S}.name === 'room'`), 5000);
await sleep(1200);
await evaluate(`${S}.invulnerableUntil = ${S}.clock.now + 1e6`);
const sticks = await evaluate(`[...document.querySelectorAll('body > div')].filter(d => d.style.borderRadius === '50%' && d.style.display === 'block').map(d => { const b = d.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width / 2]; })`);
check('two sticks drawn', sticks.length === 2);
const p0 = await evaluate(`[${S}.player.x, ${S}.player.y]`);
const [mv, aim] = sticks;
await press(1, mv[0], mv[1]); await move(1, mv[0] + mv[2], mv[1]);
await press(2, aim[0], aim[1]); await move(2, aim[0], aim[1] - aim[2]);
await sleep(500);
await shot('t2-sticks');
const firing = await evaluate(`${S}.beam.context.instructions.length > 1`);
const p1 = await evaluate(`[${S}.player.x, ${S}.player.y]`);
await lift(2); await lift(1);
check('left stick moves the ship right', p1[0] - p0[0] > 10, `${p0[0].toFixed(0)} → ${p1[0].toFixed(0)}`);
check('right stick fires the beam', firing);
check('device is touch', (await evaluate(`${S}.device`)) === 'touch');
await evaluate(`(() => { const s = ${S}; s.lives = 1; s.invulnerableUntil = 0; s.loseShip(); })()`);
await until(() => evaluate(`${S}.over`), 10000);
await sleep(1000);
await shot('t3-over');
await press(1, ...at(160 - 52, 18 + 96 - 8)); await sleep(60); await lift(1);
await sleep(500);
check('tap RETRY restarts', await evaluate(`${S}.name === 'room' && !${S}.over && ${S}.score === 0`));
t.done();
