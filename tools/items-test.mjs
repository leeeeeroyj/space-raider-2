// Items and the hold: the hold takes 4 treasures and leaves the rest on the floor (HOLD FULL); a cargo pod adds 2
// slots; a mod from a crate shows in the HUD; the Lance hurts every hostile on its line; the shield takes one hit;
// losing a ship takes an Overcharge level and the newest mod but keeps the pods; a brood pod leaves a crate.
// Usage: node tools/items-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';

const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5248, debugPort: 9418 });
const { evaluate, until, shot, tap, check, sleep, send } = t;
const G = 'window.__spaceRaider';
const S = `${G}.screen`;
const hud = `${S}.hud`;

await until(() => evaluate(`${G}?.screen?.name === 'title'`));
await sleep(400);
await tap('Enter');
await until(() => evaluate(`${S}?.name === 'room' && !!${S}.vault`), 5000);
await sleep(800);
// A quiet room: nothing hostile, and nothing can hurt the ship unless a test says so.
const quiet = `(() => { const s = ${S}; s.invulnerableUntil = s.clock.now + 1e9; s.nextSpawnAt = 1e12; s.room.hunters = 0;
  for (const e of [...s.enemies]) s.removeEnemy(e); s.room.foes.length = 0; })()`;
await evaluate(quiet);
const drop = (code) => evaluate(`(() => { const s = ${S}, p = s.player; ${code} })()`);

check('the hold starts with 4 slots', (await evaluate(`${S}.slots`)) === 4);
const onFloor = await evaluate(`${S}.room.loot.length`);
await drop(`for (let i = 0; i < 5; i++) { const l = { kind: 't1_coin', x: p.x, y: p.y }; s.room.loot.push(l); s.placeTreasure(l); }`);
await sleep(300);
check('4 treasures go in, the 5th stays on the floor', (await evaluate(`${S}.cargo.length`)) === 4 && (await evaluate(`${S}.room.loot.length`)) === onFloor + 1);
check('the HUD says the hold is full', (await evaluate(`${hud}.cargoTotal.text`)).startsWith('FULL'));
check('HOLD FULL shows (with its blip)', (await evaluate(`${S}.holdFullAt`)) > 0);
await shot('1-hold-full');

// Move off the coin, then drop a cargo pod crate under the ship.
await drop(`p.x -= 40;`);
await sleep(100);
await drop(`const c = { x: p.x, y: p.y, item: 'pod' }; s.room.crates.push(c); s.placeCrate(c);`);
await sleep(300);
check('a cargo pod adds 2 slots', (await evaluate(`${S}.slots`)) === 6);
await drop(`p.x += 40;`);
await sleep(300);
check('the 5th treasure fits now', (await evaluate(`${S}.cargo.length`)) === 5);

await drop(`p.x -= 40; const c = { x: p.x, y: p.y, item: 'lance' }; s.room.crates.push(c); s.placeCrate(c);`);
await sleep(300);
check('a Lance crate gives the Lance', await evaluate(`${S}.mods.includes('lance')`));
check('the HUD lights the Lance icon', (await evaluate(`${hud}.gear.lance.alpha`)) === 1 && (await evaluate(`${hud}.gear.splitter.alpha`)) < 1);

// Two sturdy hostiles in a row to the ship's right; aim right (at beam height) and fire.
await drop(`for (const dx of [30, 60]) { const e = s.addEnemy('warden', p.x + dx, p.y); Object.assign(e, { fixed: true, hp: 1000, armedAt: 1e12 }); }`);
const [px, py] = await evaluate(`[${S}.player.x, ${S}.player.y]`);
const r = await evaluate(`(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return [b.left, b.top, b.width / 416]; })()`);
const mx = r[0] + (px + 90) * r[2], my = r[1] + (py - 6) * r[2];
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mx, y: my });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: mx, y: my, button: 'left', buttons: 1, clickCount: 1 });
await sleep(500);
await shot('2-lance');
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: mx, y: my, button: 'left', buttons: 0, clickCount: 1 });
const hp = await evaluate(`${S}.enemies.filter((e) => e.kind === 'warden').map((e) => e.hp)`);
check('the Lance hurts both hostiles on its line', hp.length === 2 && hp.every((h) => h < 1000), JSON.stringify(hp.map(Math.round)));
await evaluate(quiet);

await drop(`const c = { x: p.x, y: p.y, item: 'shield' }; s.room.crates.push(c); s.placeCrate(c);`);
await sleep(300);
const lives = await evaluate(`${S}.lives`);
await evaluate(`(() => { const s = ${S}; s.invulnerableUntil = 0; s.takeHit(); })()`);
check('the shield takes a hit instead of a ship', !(await evaluate(`${S}.shielded`)) && (await evaluate(`${S}.lives`)) === lives && !(await evaluate(`${S}.dead`)));

await evaluate(`(() => { const s = ${S}; s.overcharge = 2; s.mods = ['lance', 'splitter']; s.invulnerableUntil = 0; s.loseShip(); })()`);
await sleep(100);
check('losing a ship takes an Overcharge level and the newest mod',
  (await evaluate(`${S}.overcharge`)) === 1 && (await evaluate(`${S}.mods.join()`)) === 'lance');
check('cargo pods are kept', (await evaluate(`${S}.slots`)) === 6);
await until(() => evaluate(`!${S}.dead`), 5000);
await sleep(200);
check('the respawn banner says what went', (await evaluate(`${S}.subBanner.text`)).includes('SPLITTER'));
await shot('3-respawn');

await evaluate(quiet);
const crates = await evaluate(`${S}.room.crates.length`);
await drop(`const e = s.addEnemy('brood', p.x + 40, p.y); e.fixed = true; s.hurt(e, 1e9);`);
check('a brood pod leaves a crate', (await evaluate(`${S}.room.crates.length`)) === crates + 1);
t.done();
