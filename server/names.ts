import type { Look, Species } from '../shared/protocol.ts';

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(arr: readonly T[], seed: number): T {
  return arr[seed % arr.length];
}

const VILLAGER_NAMES = [
  'Pip', 'Mochi', 'Bramble', 'Clover', 'Juniper', 'Biscuit', 'Pebble', 'Maple', 'Tofu', 'Hazel',
  'Nutmeg', 'Olive', 'Pudding', 'Sprout', 'Waffles', 'Cocoa', 'Fern', 'Poppy', 'Basil', 'Ziggy',
  'Momo', 'Toffee', 'Dumpling', 'Pickles', 'Sage', 'Marble', 'Noodle', 'Peaches', 'Button', 'Rolo',
  'Acorn', 'Bun', 'Chai', 'Dot', 'Ember', 'Figgy', 'Gumdrop', 'Honey', 'Inky', 'Jelly',
  'Kiwi', 'Lentil', 'Mango', 'Nimbus', 'Oats', 'Pepper', 'Quill', 'Radish', 'Sesame', 'Truffle',
  'Umi', 'Velvet', 'Wisp', 'Yuzu', 'Zest', 'Barley', 'Cinder', 'Dandy', 'Echo', 'Flint',
  'Ginger', 'Hopper', 'Iris', 'Jasper', 'Kale', 'Lark', 'Miso', 'Nacho', 'Orzo', 'Pesto',
];

const MERCENARY_NAMES = [
  'Rusty', 'Dusty', 'Hank', 'Mabel', 'Jed', 'Clem', 'Tex', 'Birdie', 'Gus', 'Winnie',
  'Buck', 'Opal', 'Cletus', 'Dolly', 'Earl', 'Fritz', 'Hattie', 'Otis', 'Pearl', 'Walt',
];

const VILLAGER_SPECIES: Species[] = [
  'cat', 'dog', 'bear', 'rabbit', 'frog', 'duck', 'mouse', 'fox', 'pig', 'sheep', 'koala', 'penguin',
];

const FUR: Record<string, string[]> = {
  cat: ['#f2b56b', '#d9d9d9', '#8a7768', '#f5efe3', '#3d3a3b'],
  dog: ['#e3b27d', '#fff4e0', '#b07a4f', '#d9c29c'],
  bear: ['#a8764e', '#6d4c35', '#e8d5b0', '#c49a6c'],
  rabbit: ['#fdf6f0', '#f2c9d8', '#cdb8a2', '#bfe0f2'],
  frog: ['#8fd16a', '#6cc3a0', '#c9de6a'],
  duck: ['#fffdf2', '#fbe28a', '#e6f2ff'],
  mouse: ['#c8c3c8', '#f4d7c5', '#9aa2ad'],
  fox: ['#f08a3c', '#e8a95f', '#d96d3f'],
  pig: ['#f7b6c2', '#f2cfae', '#e89aa8'],
  sheep: ['#f7f3ea', '#e9e4ff', '#fff0d6'],
  koala: ['#a9b0b8', '#c7ccd1', '#8f98a3'],
  penguin: ['#3b4a63', '#2f3640', '#4a6f8a'],
};

const SHIRTS = [
  '#ff8fab', '#7ec4ff', '#ffd166', '#95e1a4', '#c3a6ff', '#ff9f6b', '#6ee7d8', '#f7f7f7',
  '#ffb3c7', '#9ad0ec', '#e9c46a', '#a0c4ff', '#bdb2ff', '#caffbf', '#ffc6ff', '#f4a261',
];

const ACCENTS = ['#ffb3c1', '#ffe5b4', '#ffffff', '#ffd6e0', '#fde2b8'];

export function villagerLook(seed: number): Look {
  const species = pick(VILLAGER_SPECIES, seed);
  return {
    species,
    fur: pick(FUR[species], seed >>> 4),
    shirt: pick(SHIRTS, seed >>> 8),
    accent: pick(ACCENTS, seed >>> 12),
    hat: 'none',
  };
}

export function mercenaryLook(seed: number): Look {
  const look = villagerLook(seed);
  look.hat = 'straw';
  look.shirt = pick(['#7aa6d8', '#6b8f71', '#c97b63', '#8d7bb8', '#d9a441'], seed >>> 3);
  return look;
}

export function villagerName(seed: number, taken: Set<string>): string {
  for (let i = 0; i < VILLAGER_NAMES.length; i++) {
    const name = VILLAGER_NAMES[(seed + i * 7) % VILLAGER_NAMES.length];
    if (!taken.has(name)) return name;
  }
  // Island is crowded: fall back to numbered names.
  let n = 2;
  const base = pick(VILLAGER_NAMES, seed);
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function mercenaryName(seed: number, taken: Set<string>): string {
  for (let i = 0; i < MERCENARY_NAMES.length; i++) {
    const name = MERCENARY_NAMES[(seed + i * 3) % MERCENARY_NAMES.length];
    if (!taken.has(name)) return name;
  }
  return `${pick(MERCENARY_NAMES, seed)} ${taken.size}`;
}
