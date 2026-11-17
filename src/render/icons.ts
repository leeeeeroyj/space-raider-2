import type { Texture } from 'pixi.js';
import { ITEMS, type ItemKind } from '../config';
import { hex, named } from '../engine/textures';

/** 12 × 12 pixel icons for the items: '#' is the item's colour, '+' is white. */
const ICONS: Record<ItemKind, string[]> = {
  overcharge: [
    '......####..',
    '.....####...',
    '....####....',
    '...####.....',
    '..++++++++..',
    '.....####...',
    '....####....',
    '...####.....',
    '..###.......',
    '..##........',
    '.#..........',
    '............',
  ],
  splitter: [
    '..........##',
    '........##..',
    '......##....',
    '.....#......',
    '....#.......',
    '++++++++++++',
    '....#.......',
    '.....#......',
    '......##....',
    '........##..',
    '..........##',
    '............',
  ],
  lance: [
    '............',
    '............',
    '........#...',
    '........##..',
    '........###.',
    '++++++++++++',
    '############',
    '........###.',
    '........##..',
    '........#...',
    '............',
    '............',
  ],
  ricochet: [
    '##........##',
    '.##......##.',
    '..##....##..',
    '...##..##...',
    '....####....',
    '.....++.....',
    '............',
    '++++++++++++',
    '#.#.#.#.#.#.',
    '............',
    '............',
    '............',
  ],
  shield: [
    '..########..',
    '.#........#.',
    '#..++++++..#',
    '#.+......+.#',
    '#.+......+.#',
    '#.+......+.#',
    '.#.+....+.#.',
    '.#..+..+..#.',
    '..#..++..#..',
    '...#....#...',
    '....#..#....',
    '.....##.....',
  ],
  pod: [
    '############',
    '#..........#',
    '#....++....#',
    '#....++....#',
    '#..++++++..#',
    '#..++++++..#',
    '#....++....#',
    '#....++....#',
    '#..........#',
    '############',
    '#.#.#..#.#.#',
    '############',
  ],
};

/** The colour that marks an item: cyan for the beam, magenta for the rest. */
export const itemColor = (item: ItemKind) =>
  item === 'shield' || item === 'pod' ? ITEMS.colors.other : ITEMS.colors.beam;

/** An item's icon, 12 × 12 in a 16 × 16 texture (native size in the HUD, a hologram over crates). */
export function itemIcon(item: ItemKind): Texture {
  return named(`icon-${item}`, 16, 16, (ctx) => {
    const rows = ICONS[item];
    // A dark outline round every lit pixel, so it reads on any background.
    ctx.fillStyle = '#05060d';
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && ctx.fillRect(x + 1, y + 1, 3, 3)));
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === '+' ? '#ffffff' : hex(itemColor(item));
        ctx.fillRect(x + 2, y + 2, 1, 1);
      }),
    );
  });
}
