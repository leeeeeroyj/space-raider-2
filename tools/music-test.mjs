// Music: the title theme plays once a key unlocks audio, the raid's song takes over, hostiles bring in the combat
// layer on the next bar line, the tracker keeps time with the audio clock, N turns the music off and on, and the
// sound tap cycles ALL → SFX ONLY → OFF.
// Usage: node tools/music-test.mjs <project-dir> <out-dir>
import { session } from './cdp.mjs';

const [project, out] = process.argv.slice(2);
const t = await session({ project, out, port: 5249, debugPort: 9419 });
const { evaluate, until, tap, check, sleep, click } = t;
const G = 'window.__spaceRaider';
const S = `${G}.screen`;
const music = () => evaluate(`${G}.musicState()`);

await until(() => evaluate(`${G}?.screen?.name === 'title'`));
await evaluate(`localStorage.clear()`);
await sleep(300);
await tap('ArrowDown');
await sleep(1500);
let m = await music();
check('the title theme plays after the first key press', m.song === 'title' && m.step > 4, `step ${m.step}`);

await tap('Enter');
await until(() => evaluate(`${S}.name === 'room' && !!${S}.vault`), 5000);
await evaluate(`(() => { const s = ${S}; s.invulnerableUntil = s.clock.now + 1e9; s.room.hunters = 0; s.nextSpawnAt = 1e12;
  for (const e of [...s.enemies]) s.removeEnemy(e); s.room.foes.length = 0; })()`);
await sleep(2500);
m = await music();
check('the raid song takes over', m.song === 'game');
check('calm with no hostiles', !m.barMood.combat);
await evaluate(`(() => { const s = ${S}; const e = s.addEnemy('sentry', 60, 60); e.foe = { kind: 'sentry', x: 60, y: 60 }; s.room.foes.push(e.foe); e.fixed = true; e.nextShotAt = 1e12; })()`);
// One bar at 126 bpm is about 1.9 s: the change waits for the next one.
await sleep(2300);
m = await music();
check('hostiles bring in the combat layer on the next bar', m.barMood.combat);
const stepLen = 60 / m.bpm / 4;
const expected = (m.now - m.startedAt) / stepLen;
check('the tracker keeps time with the audio clock', Math.abs(m.step - expected) < 3, `${m.step} steps, ${expected.toFixed(1)} expected`);

await tap('n');
await sleep(100);
check('N turns the music off', !(await music()).enabled && (await evaluate(`${G}.soundLabel()`)) === 'SFX ONLY');
await tap('n');
await sleep(100);
check('N turns it back on', (await music()).enabled && (await evaluate(`${G}.soundLabel()`)) === 'SOUND ON');
check('the setting is kept', (await evaluate(`localStorage.getItem('space-raider-music')`)) === '1');

// The sound toggle, top right of the HUD: tap through all three.
const r = await evaluate(`(() => { const b = document.querySelector('canvas').getBoundingClientRect(); return [b.left, b.top, b.width / 416]; })()`);
const labels = [];
for (let i = 0; i < 3; i++) {
  await click(r[0] + 400 * r[2], r[1] + 8 * r[2]);
  await sleep(150);
  labels.push(await evaluate(`${G}.soundLabel()`));
}
check('the sound tap cycles SFX ONLY → OFF → ALL', labels.join() === 'SFX ONLY,SOUND OFF,SOUND ON', labels.join());
t.done();
