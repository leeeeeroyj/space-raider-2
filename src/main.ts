import { ATTRACT, attractSeed } from './attract';
import { game, nav } from './engine/screens';
import { loadSprites } from './engine/textures';
import { bakeStacks } from './render/stack';
import { getBus } from './audio/bus';
import { musicState } from './audio/music';
import { RoomScreen } from './screens/room';
import { TitleScreen } from './screens/title';
import { soundLabel, soundsPlayed } from './sfx';

async function start() {
  // Text is rasterised when it's made, so the pixel font must be ready first.
  await Promise.race([document.fonts.load('8px Silkscreen'), new Promise((resolve) => setTimeout(resolve, ATTRACT ? 400 : 2000))]).catch(() => {});
  await game.init(document.getElementById('game')!);
  await loadSprites();
  bakeStacks();
  nav.toTitle = () => game.show(() => new TitleScreen());
  nav.toRoom = (attract?: number) => game.show(() => new RoomScreen(attract));
  // Attract mode goes straight to a vault.
  if (ATTRACT) nav.toRoom(attractSeed());
  else nav.toTitle();
  // Dev-only handle for poking at the running game from the console or a test script.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __spaceRaider: {
        game,
        musicState,
        audioBus: getBus,
        soundLabel,
        get screen() {
          return game.screen;
        },
        soundsPlayed,
      },
    });
  }
}

void start();
