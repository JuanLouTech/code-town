export type Category = 'fish' | 'bug' | 'fruit' | 'fossil' | 'shell';

export interface CatalogItem {
  id: string;
  name: string;
  category: Category;
  emoji: string;
  value: number;
  rarity: number; // 1 common … 5 legendary
  where?: 'sea' | 'pond';
  size?: [number, number]; // cm range, for fish
  color?: string;
  quip?: string;
}

export const CATALOG: CatalogItem[] = [
  // Sea fish.
  { id: 'segfault-sardine', name: 'Segfault Sardine', category: 'fish', emoji: '🐟', value: 60, rarity: 1, where: 'sea', size: [12, 22], color: '#9fb4c7', quip: 'It dumped its core and swam off… almost.' },
  { id: 'async-anchovy', name: 'Async Anchovy', category: 'fish', emoji: '🐟', value: 90, rarity: 1, where: 'sea', size: [10, 18], color: '#b8c4cf', quip: 'It arrived later than expected, but it arrived.' },
  { id: 'stack-snapper', name: 'Stack Overflow Snapper', category: 'fish', emoji: '🐠', value: 400, rarity: 2, where: 'sea', size: [30, 60], color: '#e8743b', quip: 'Marked as a duplicate of another fish.' },
  { id: 'heap-halibut', name: 'Heap Halibut', category: 'fish', emoji: '🐟', value: 450, rarity: 2, where: 'sea', size: [40, 90], color: '#c9b08a', quip: 'Flat, wide and never freed.' },
  { id: 'kernel-puffer', name: 'Kernel Panic Pufferfish', category: 'fish', emoji: '🐡', value: 800, rarity: 3, where: 'sea', size: [20, 35], color: '#f2c94c', quip: 'Please do not reboot the pufferfish.' },
  { id: 'merge-marlin', name: 'Merge Conflict Marlin', category: 'fish', emoji: '🗡️', value: 2400, rarity: 4, where: 'sea', size: [150, 300], color: '#3d6fb6', quip: '<<<<<<< HEAD … what a catch! >>>>>>>' },
  { id: 'legacy-coelacanth', name: 'Legacy Code Coelacanth', category: 'fish', emoji: '🦕', value: 9000, rarity: 5, where: 'sea', size: [120, 200], color: '#5a6b7a', quip: 'Thought extinct. Still running in production.' },
  // Pond fish.
  { id: 'callback-carp', name: 'Callback Carp', category: 'fish', emoji: '🐟', value: 100, rarity: 1, where: 'pond', size: [20, 45], color: '#a88a5a', quip: 'It will call you back. Eventually.' },
  { id: 'promise-perch', name: 'Promise Perch', category: 'fish', emoji: '🐟', value: 120, rarity: 1, where: 'pond', size: [15, 30], color: '#8fae5f', quip: 'Resolved successfully!' },
  { id: 'lambda-loach', name: 'Lambda Loach', category: 'fish', emoji: '🐍', value: 300, rarity: 2, where: 'pond', size: [10, 25], color: '#6b5a45', quip: 'Anonymous, but friendly.' },
  { id: 'recursive-koi', name: 'Recursive Koi', category: 'fish', emoji: '🎏', value: 1200, rarity: 3, where: 'pond', size: [40, 80], color: '#f28c28', quip: 'To catch a koi, you must first catch a koi.' },
  { id: 'golden-goroutine', name: 'Golden Goroutine', category: 'fish', emoji: '✨', value: 5000, rarity: 5, where: 'pond', size: [30, 50], color: '#ffd94a', quip: 'Spawned from nowhere, gone in a flash.' },
  // Bugs (butterflies flying around the island).
  { id: 'cabbage', name: 'Off-by-One Cabbage White', category: 'bug', emoji: '🦋', value: 80, rarity: 1, quip: 'Almost caught one. Then caught one more.' },
  { id: 'sulphur', name: 'Yellow Semicolon Sulphur', category: 'bug', emoji: '🦋', value: 100, rarity: 1, quip: 'Optional, but please keep it.' },
  { id: 'monarch', name: 'Monarch of the Main Branch', category: 'bug', emoji: '🦋', value: 350, rarity: 2, quip: 'Protected. Requires two approvals.' },
  { id: 'pink', name: 'Pull Request Pinkwing', category: 'bug', emoji: '🦋', value: 300, rarity: 2, quip: 'LGTM!' },
  { id: 'blue', name: 'Blue Screen Morpho', category: 'bug', emoji: '🦋', value: 900, rarity: 3, quip: 'Your butterfly ran into a problem and needs to restart.' },
  { id: 'heisen', name: 'Heisenbug Swallowtail', category: 'bug', emoji: '🦋', value: 4000, rarity: 5, quip: 'It vanished the moment you looked at it. But not this time!' },
  // Fruit.
  { id: 'apple', name: 'Apple', category: 'fruit', emoji: '🍎', value: 100, rarity: 1 },
  { id: 'orange', name: 'Orange', category: 'fruit', emoji: '🍊', value: 100, rarity: 1 },
  { id: 'pear', name: 'Golden Pear', category: 'fruit', emoji: '🍐', value: 150, rarity: 2 },
  // Fossils.
  { id: 'semicolon', name: 'Fossilized Semicolon', category: 'fossil', emoji: '🦴', value: 300, rarity: 1, quip: 'From the age before auto-formatting.' },
  { id: 'floppy', name: 'Ancient Floppy Disk', category: 'fossil', emoji: '💾', value: 450, rarity: 2, quip: 'Holds 1.44 MB of prehistoric secrets.' },
  { id: 'punchcard', name: 'Petrified Punch Card', category: 'fossil', emoji: '🪨', value: 600, rarity: 2, quip: 'Do not fold, spindle or mutilate.' },
  { id: 'trilobite', name: 'Trilobite of Tabs', category: 'fossil', emoji: '🐚', value: 800, rarity: 3, quip: 'Scientists still argue whether it was spaces.' },
  { id: 'cobol', name: 'COBOL Tablet', category: 'fossil', emoji: '📜', value: 1000, rarity: 3, quip: 'Still compiles. Nobody knows how.' },
  { id: 'monorepo', name: 'Mammoth Monorepo Skull', category: 'fossil', emoji: '🦣', value: 2000, rarity: 4, quip: 'git clone took three ice ages.' },
  { id: 'first-bug', name: 'The First Bug (1947)', category: 'fossil', emoji: '🪲', value: 6000, rarity: 5, quip: 'A moth, taped into the logbook. Legendary.' },
  // Shells.
  { id: 'scallop', name: 'Scallop Shell', category: 'shell', emoji: '🐚', value: 60, rarity: 1 },
  { id: 'cowrie', name: 'Cowrie', category: 'shell', emoji: '🐚', value: 60, rarity: 1 },
  { id: 'sand-dollar', name: 'Sand Dollar', category: 'shell', emoji: '🪙', value: 120, rarity: 2 },
  { id: 'console-conch', name: 'Conch of the Console', category: 'shell', emoji: '🐚', value: 400, rarity: 3, quip: 'Hold it to your ear: you can hear the logs.' },
  { id: 'pearl', name: 'Pearl Oyster', category: 'shell', emoji: '🦪', value: 1500, rarity: 4 },
];

export const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));

/** Weighted random pick: rarity 1 is common, 5 is legendary. */
export function pickWeighted(items: CatalogItem[], luck = 1): CatalogItem {
  const w = (c: CatalogItem) => Math.pow(0.32, c.rarity - 1) * (c.rarity > 2 ? luck : 1);
  const total = items.reduce((a, c) => a + w(c), 0);
  let r = Math.random() * total;
  for (const c of items) {
    r -= w(c);
    if (r <= 0) return c;
  }
  return items[0];
}

export const HATS: { id: 'none' | 'straw' | 'cap' | 'bow' | 'cone' | 'hardhat'; name: string; emoji: string; price: number }[] = [
  { id: 'none', name: 'No hat', emoji: '🙂', price: 0 },
  { id: 'cap', name: 'Baseball cap', emoji: '🧢', price: 600 },
  { id: 'bow', name: 'Big bow', emoji: '🎀', price: 500 },
  { id: 'straw', name: 'Farmhand straw hat', emoji: '👒', price: 800 },
  { id: 'hardhat', name: 'Builder’s hard hat', emoji: '⛑️', price: 1000 },
  { id: 'cone', name: 'Gnome hat', emoji: '🧙', price: 1500 },
];

export const COLOR_NAMES = ['Coral', 'Sky', 'Mint', 'Sunny', 'Lilac', 'Rose', 'Aqua', 'Snow', 'Cocoa'];
export const SHIRTS = ['#ff8c69', '#7ec4ff', '#95e1a4', '#ffd166', '#c3a6ff', '#ff8fab', '#6ee7d8', '#ffffff', '#3b2f2a'];

export const KART = { id: 'kart', name: 'Go-kart', emoji: '🏎️', price: 3000 };
