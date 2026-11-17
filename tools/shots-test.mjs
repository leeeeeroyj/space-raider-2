// Hostile fire: the sentry still fires its bolt; a warden lobs a mortar shell at a ring on the floor that hits you
// if you stay and misses if you move (and the shield takes it); pausing freezes the shell; a brood pod's spore turns
// toward you and fades; a destroyed mine bursts into four shards.
// Usage: node tools/shots-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';

const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5249, debugPort: 9419 });
const { evaluate, until, shot, tap, check, sleep } = t;
const G = 'window.__spaceRaider';
const S = `${G}.screen`;

await until(() => evaluate(`${G}?.screen?.name === 'title'`));
await sleep(400);
await tap('Enter');
await until(() => evaluate(`${S}?.name === 'room' && !!${S}.vault`), 5000);
await sleep(2400);
// A quiet room, the ship parked in the middle-left, nothing able to hurt it unless a test says so.
const quiet = `(() => { const s = ${S}; s.invulnerableUntil = s.clock.now + 1e9; s.nextSpawnAt = 1e12; s.room.hunters = 0;
  s.clearHostiles(); s.room.foes.length = 0; Object.assign(s.player, { x: 120, y: 120, vx: 0, vy: 0 }); })()`;
const run = (code) => evaluate(`(() => { const s = ${S}, p = s.player, now = s.clock.now;
  const add = (k, x, y, o = {}) => Object.assign(s.addEnemy(k, x, y), { fixed: true, hp: 1e9, armedAt: 1e12 }, o);
  ${code} })()`);
await evaluate(quiet);

// Sentry: unchanged, a bolt.
await run(`add('sentry', 280, 120, { nextShotAt: now + 50 });`);
await sleep(250);
check('the sentry still fires a bolt', await run(`return s.shots.some((b) => b.kind === 'bolt');`));
await evaluate(quiet);

// Warden: a shell at where you are, with a ring on the floor.
await run(`s.shielded = true; s.invulnerableUntil = 0; add('warden', p.x + 60, p.y, { nextLobAt: now });`);
await sleep(80);
const shell = await run(`const sh = s.shells[0]; return sh && [sh.x, sh.y, p.x, p.y, !!sh.ring.parent];`);
check('a warden in range lobs a shell at you, with a ring on the floor', !!shell && Math.hypot(shell[0] - shell[2], shell[1] - shell[3]) < 1 && shell[4]);
await sleep(350);
await shot('1-mortar');
await run(`for (const e of s.enemies) e.nextLobAt = 1e12;`);
await sleep(700);
check('the shell lands and the shield takes it', (await run(`return s.shells.length === 0 && !s.shielded && !s.dead;`)));

await run(`s.invulnerableUntil = 0; s.shielded = true; for (const e of s.enemies) e.nextLobAt = now;`);
await sleep(80);
await run(`for (const e of s.enemies) e.nextLobAt = 1e12; p.y -= 50;`);
await sleep(1000);
check('moving off the ring dodges it', await run(`return s.shielded && !s.dead;`));

// Pause freezes a shell mid-flight.
await run(`s.invulnerableUntil = now + 1e9; for (const e of s.enemies) e.nextLobAt = now;`);
await sleep(200);
await run(`for (const e of s.enemies) e.nextLobAt = 1e12; s.setPaused(true);`);
const before = await run(`return s.shells.length && [s.shells[0].view.x, s.shells[0].view.y];`);
await sleep(1500);
const after = await run(`return s.shells.length && [s.shells[0].view.x, s.shells[0].view.y];`);
check('pausing freezes a shell in the air', !!before && JSON.stringify(before) === JSON.stringify(after));
await run(`s.setPaused(false);`);
await sleep(1000);
await evaluate(quiet);

// Brood pod: a spore that steers toward you, then fades.
await run(`add('brood', 60, 120, { nextSpitAt: now + 20, nextHatchAt: 1e12 });`);
await sleep(150);
await run(`for (const e of s.enemies) e.nextSpitAt = 1e12; p.y = 190;`);
const heading = () => run(`const b = s.shots.find((b) => b.kind === 'spore'); return b && Math.atan2(b.vy, b.vx);`);
const h0 = await heading();
await sleep(700);
const h1 = await heading();
check('the brood pod spits a spore that turns toward you', h0 !== undefined && h1 !== undefined && h1 > h0 + 0.3, `${h0?.toFixed(2)} → ${h1?.toFixed(2)}`);
await shot('2-spore');
await sleep(3000);
check('the spore fades out', !(await run(`return s.shots.some((b) => b.kind === 'spore');`)));
await evaluate(quiet);

// Mine: four shards when it blows.
await run(`const e = add('mine', 220, 120, { wakeAt: 1e12 }); s.hurt(e, 1e12);`);
check('a destroyed mine bursts into 4 shards', (await run(`return s.shots.filter((b) => b.kind === 'shard').length;`)) === 4);
await sleep(120);
await shot('3-shrapnel');
await sleep(800);
check('the shards fall short and vanish', (await run(`return s.shots.length;`)) === 0);

t.done();
