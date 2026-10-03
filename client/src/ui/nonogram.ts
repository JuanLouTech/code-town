import './nonogram.css';
import { cluesOf, generatePuzzle, pictureGrid, PICTURES, type Grid } from '../game/nonogram.ts';
import { listNav } from './keys.ts';
import { h, type Panel } from './panel.ts';

export interface NonogramSave {
  /** bestMs is the time used, penalties included. `timed` once it has been solved against the clock. */
  solved: Record<string, { bestMs: number; date: number; timed?: boolean }>;
  /** marks: '#' filled, 'x' marked empty, '.' unknown. The solution is kept so random puzzles can be resumed. */
  current?: { id: string; name: string; solution: string[]; marks: string[]; elapsedMs: number; timed?: boolean; errors?: number; penaltyMs?: number };
  /** Play without the clock. */
  relaxed?: boolean;
}

export interface NonogramOptions {
  save: NonogramSave;
  onSave: (s: NonogramSave) => void;
  onReward: (coins: number) => void;
  onSound?: (k: 'pop' | 'fanfare' | 'error' | 'timeout') => void;
}

type Mark = 0 | 1 | 2; // unknown · filled · marked empty
type Mode = 'fill' | 'mark' | 'clear-fill' | 'clear-mark';
interface Game {
  id: string; name: string; solution: Grid; marks: Mark[][]; elapsedMs: number;
  /** Against the clock (Picross 2 rules): 30 minutes, and every wrong fill costs time and becomes a mark. */
  timed: boolean;
  errors: number;
  penaltyMs: number;
}

const SIZE = 15;
/** Every random puzzle shares one entry in `solved`: the best random time. */
const RANDOM_ID = 'random';
const MARK_CH = ['.', '#', 'x'] as const;
const INK = '#5b4636';
const TIME_LIMIT = 30 * 60_000;
/** What each mistake costs, in order; after the last one they all cost the last amount. */
const PENALTIES = [2, 4, 8].map((m) => m * 60_000);
const penaltyFor = (errors: number) => PENALTIES[Math.min(errors, PENALTIES.length - 1)];
const DIRS: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function fresh(id: string, name: string, solution: Grid, timed: boolean): Game {
  return { id, name, solution, marks: solution.map((r) => r.map((): Mark => 0)), elapsedMs: 0, timed, errors: 0, penaltyMs: 0 };
}

function fromSave(c: NonNullable<NonogramSave['current']>): Game {
  return {
    id: c.id, name: c.name, elapsedMs: c.elapsedMs, timed: Boolean(c.timed), errors: c.errors ?? 0, penaltyMs: c.penaltyMs ?? 0,
    solution: c.solution.map((r) => [...r].map((ch) => ch === '#')),
    marks: c.marks.map((r) => [...r].map((ch): Mark => (ch === '#' ? 1 : ch === 'x' ? 2 : 0))),
  };
}

/** A tiny pixel picture, scaled up crisply by CSS. */
function thumb(filled: (y: number, x: number) => boolean, cls = 'ngram-thumb') {
  const c = h('canvas', { class: cls, width: String(SIZE), height: String(SIZE) });
  drawThumb(c, filled);
  return c;
}

function drawThumb(c: HTMLCanvasElement, filled: (y: number, x: number) => boolean) {
  const g = c.getContext('2d');
  if (!g) return;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, SIZE, SIZE);
  g.fillStyle = INK;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (filled(y, x)) g.fillRect(x, y, 1, 1);
}

/** The picross notebook: pick a picture (or a random one), then solve it. Resolves when the panel closes. */
export function openNonogram(panel: Panel, opts: NonogramOptions): Promise<void> {
  const { save } = opts;
  const root = h('div', { class: 'ngram' });
  const foot = h('div', { class: 'row end' });
  let teardown: (() => void) | undefined;
  const clearScreen = () => {
    teardown?.();
    teardown = undefined;
    root.innerHTML = '';
    foot.innerHTML = '';
  };
  const pictureIndex = (id: string) => PICTURES.findIndex((p) => p.id === id);
  /** Unsolved pictures keep their name a secret. */
  const label = (id: string, name: string) => {
    const i = pictureIndex(id);
    return i >= 0 && !save.solved[id] ? `Picture #${i + 1}` : name;
  };
  const footBtn = (text: string, onClick: () => void, cls = 'btn small') => {
    const b = h('button', { class: cls, type: 'button' }, text);
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep Space for the board
    b.addEventListener('click', onClick);
    return b;
  };
  const timed = () => !save.relaxed;
  const randomGame = () => {
    const r = generatePuzzle(SIZE);
    return fresh(RANDOM_ID, r.name, r.grid, timed());
  };

  const showPicker = () => {
    clearScreen();
    const done = PICTURES.filter((p) => save.solved[p.id]).length;
    root.append(h('div', { class: 'ngram-intro' },
      `Fill the grid so every row and column matches its numbers, and a picture appears. Solved ${done} of ${PICTURES.length}.`));
    const modes = h('div', { class: 'ngram-modes' });
    for (const [relaxed, text, sub] of [
      [false, '⏳ Against the clock', '30 minutes · a wrong square costs 2, 4, then 8 minutes'],
      [true, '🌿 Relaxed', 'no clock, no penalties'],
    ] as const) {
      const b = h('button', { class: 'ngram-mode' + (Boolean(save.relaxed) === relaxed ? ' on' : ''), type: 'button' },
        h('div', { class: 'ngram-mode-name' }, text), h('div', { class: 'ngram-card-sub' }, sub));
      b.addEventListener('click', () => {
        save.relaxed = relaxed || undefined;
        opts.onSave(save);
        showPicker();
      });
      modes.append(b);
    }
    root.append(modes);
    const grid = h('div', { class: 'ngram-picks' });
    const card = (art: HTMLElement, name: string, sub: string, onPick: () => void, extra = '') => {
      const b = h('button', { class: 'ngram-card' + extra, type: 'button' }, art,
        h('div', { class: 'ngram-card-name' }, name), h('div', { class: 'ngram-card-sub' }, sub));
      b.addEventListener('click', onPick);
      grid.append(b);
    };
    const cur = save.current;
    if (cur) {
      const left = cur.timed ? `⏳ ${fmt(TIME_LIMIT - cur.elapsedMs - (cur.penaltyMs ?? 0))} left` : fmt(cur.elapsedMs);
      card(thumb((y, x) => cur.marks[y]?.[x] === '#'), '▶ Continue', `${label(cur.id, cur.name)} · ${left}`,
        () => play(fromSave(cur)), ' ngram-continue');
    }
    PICTURES.forEach((p, i) => {
      const won = save.solved[p.id];
      const g = pictureGrid(p);
      card(won ? thumb((y, x) => g[y][x]) : h('div', { class: 'ngram-thumb ngram-unknown' }, '?'),
        won ? `${won.timed ? '⏳' : '✅'} ${p.name}` : '???',
        won ? `Best ${fmt(won.bestMs)}` : cur?.id === p.id ? `Picture #${i + 1} · in progress` : `Picture #${i + 1}`,
        () => play(cur?.id === p.id ? fromSave(cur) : fresh(p.id, p.name, g, timed())));
    });
    const bestRandom = save.solved[RANDOM_ID];
    card(h('div', { class: 'ngram-thumb ngram-unknown' }, '🎲'), '🎲 Random puzzle',
      bestRandom ? `Best ${fmt(bestRandom.bestMs)}` : 'A brand-new mystery', () => play(randomGame()));
    root.append(grid);
    foot.append(h('div', { class: 'kbd-hint' }, '←→↑↓ choose · Enter play · Esc close'));
    const nav = listNav(root, '.ngram-mode, .ngram-card');
    nav.reset();
    teardown = () => nav.destroy();
  };

  const play = (game: Game) => {
    clearScreen();
    const clues = cluesOf(game.solution);
    const isPicture = pictureIndex(game.id) >= 0;
    let cx = 0;
    let cy = 0;
    let solved = false;
    let over = false;
    let mode: Mode | null = null;
    let heldCode = '';
    let dragging = false;
    const since = performance.now();
    const elapsed = () => (solved || over ? game.elapsedMs : game.elapsedMs + performance.now() - since);
    const timeLeft = () => Math.max(0, TIME_LIMIT - elapsed() - game.penaltyMs);
    const clockText = () => game.timed ? `⏳ ${fmt(timeLeft())}` : `⏱ ${fmt(elapsed())}`;

    // ---- layout: clues around the board, info on the side
    const clueSpans = (c: number[]) => (c.length ? c : [0]).map((n) => h('span', {}, String(n)));
    const colEls = clues.cols.map((c) => h('div', { class: 'ngram-colclue' }, ...clueSpans(c)));
    const rowEls = clues.rows.map((c) => h('div', { class: 'ngram-rowclue' }, ...clueSpans(c)));
    const board = h('div', { class: 'ngram-board' });
    const cells: HTMLElement[][] = [];
    const baseClass: string[][] = [];
    for (let y = 0; y < SIZE; y++) {
      cells.push([]);
      baseClass.push([]);
      for (let x = 0; x < SIZE; x++) {
        const base = 'ngram-cell' + (x % 5 === 4 && x < SIZE - 1 ? ' r5' : '') + (x === SIZE - 1 ? ' re' : '')
          + (y % 5 === 4 && y < SIZE - 1 ? ' d5' : '') + (y === SIZE - 1 ? ' de' : '');
        const cell = h('div', { class: base, 'data-x': String(x), 'data-y': String(y), style: `--d:${(x + y) * 22}ms` });
        cells[y].push(cell);
        baseClass[y].push(base);
        board.append(cell);
      }
    }
    const table = h('div', { class: 'ngram-table' },
      h('div', { class: 'ngram-corner' }),
      h('div', { class: 'ngram-cols' }, ...colEls),
      h('div', { class: 'ngram-rows' }, ...rowEls),
      board);
    const nameEl = h('div', { class: 'ngram-name' }, label(game.id, game.name));
    const timerEl = h('div', { class: 'ngram-timer' }, clockText());
    const errorsEl = h('div', { class: 'ngram-errors' });
    const showErrors = () => {
      errorsEl.style.display = game.timed ? '' : 'none';
      errorsEl.textContent = (game.errors ? `${'✖'.repeat(game.errors)} · ` : '') + `next mistake −${fmt(penaltyFor(game.errors))}`;
    };
    showErrors();
    const preview = thumb(() => false, 'ngram-preview');
    const status = h('div', { class: 'ngram-status' }, timerEl, errorsEl, preview,
      h('div', { class: 'ngram-keys' },
        h('div', {}, h('kbd', {}, 'WASD'), ' / ', h('kbd', {}, '←↑↓→'), ' move'),
        h('div', {}, h('kbd', {}, 'E'), ' / ', h('kbd', {}, 'Space'), ' fill'),
        h('div', {}, h('kbd', {}, 'X'), ' / ', h('kbd', {}, '⇧E'), ' mark ×'),
        h('div', {}, 'Hold and move to paint a line'),
        h('div', {}, '🖱 Left fills · right marks')));
    const side = h('div', { class: 'ngram-side' },
      nameEl, h('div', { class: 'ngram-sub' }, (isPicture ? '🖼 Hand-made picture' : '🎲 Random puzzle') + (game.timed ? ' · against the clock' : ' · relaxed')), status);
    root.append(h('div', { class: 'ngram-play' }, table, side));

    // ---- drawing
    const paint = () => {
      const now = cluesOf(game.marks.map((r) => r.map((m) => m === 1)));
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const m = game.marks[y][x];
          const hl = !solved && !over && (x === cx || y === cy);
          const oops = cells[y][x].classList.contains('ngram-oops') ? ' ngram-oops' : '';
          cells[y][x].className = baseClass[y][x] + (m === 1 ? ' f' : m === 2 ? ' x' : '')
            + (hl ? ' hl' : '') + (!solved && !over && x === cx && y === cy ? ' cur' : '') + oops;
        }
        rowEls[y].className = 'ngram-rowclue' + (!solved && y === cy ? ' on' : '') + (same(now.rows[y], clues.rows[y]) ? ' done' : '');
      }
      for (let x = 0; x < SIZE; x++) {
        colEls[x].className = 'ngram-colclue' + (!solved && x === cx ? ' on' : '') + (same(now.cols[x], clues.cols[x]) ? ' done' : '');
      }
      drawThumb(preview, (y, x) => game.marks[y][x] === 1);
      return now.rows.every((r, y) => same(r, clues.rows[y])) && now.cols.every((c, x) => same(c, clues.cols[x]));
    };

    // ---- saving
    let saveTimer = 0;
    const flush = () => {
      clearTimeout(saveTimer);
      if (solved || over) return;
      save.current = {
        id: game.id, name: game.name, elapsedMs: elapsed(), timed: game.timed, errors: game.errors, penaltyMs: game.penaltyMs,
        solution: game.solution.map((r) => r.map((c) => (c ? '#' : '.')).join('')),
        marks: game.marks.map((r) => r.map((m) => MARK_CH[m]).join('')),
      };
      opts.onSave(save);
    };
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(flush, 1000);
    };

    // ---- editing
    /** Applies the current paint mode to the cursor cell; true if it changed. */
    const apply = (first = false) => {
      if (!mode || solved || over) return false;
      const m = game.marks[cy][cx];
      let next: Mark = m;
      if (mode === 'fill' && game.timed) {
        // Against the clock a marked square can't be painted, and every fill is checked.
        if (m !== 0) return false;
        if (!game.solution[cy][cx]) {
          mistake();
          return true;
        }
        next = 1;
      } else if (mode === 'fill' && (m === 0 || first)) next = 1;
      else if (mode === 'mark' && (m === 0 || first)) next = 2;
      else if (mode === 'clear-fill' && m === 1) next = 0;
      else if (mode === 'clear-mark' && m === 2) next = 0;
      if (next === m) return false;
      game.marks[cy][cx] = next;
      if (next === 1) opts.onSound?.('pop');
      return true;
    };
    /** A wrong square: it becomes a mark, the clock loses time, and the stroke stops. */
    const mistake = () => {
      game.marks[cy][cx] = 2;
      game.penaltyMs += penaltyFor(game.errors);
      game.errors++;
      endStroke();
      showErrors();
      opts.onSound?.('error');
      const cell = cells[cy][cx];
      cell.classList.remove('ngram-oops');
      void cell.offsetWidth;
      cell.classList.add('ngram-oops');
      timerEl.classList.remove('ngram-hit');
      void timerEl.offsetWidth;
      timerEl.classList.add('ngram-hit');
      timerEl.textContent = clockText();
      if (timeLeft() <= 0) setTimeout(timeUp, 0);
    };
    /** The first press decides the mode for the whole stroke. */
    const begin = (kind: 'fill' | 'mark') => {
      const m = game.marks[cy][cx];
      mode = kind === 'fill' ? (m === 1 ? 'clear-fill' : 'fill') : (m === 2 ? 'clear-mark' : 'mark');
      return apply(true);
    };
    const refresh = (changed: boolean) => {
      const won = paint();
      if (!changed) return;
      if (won) win();
      else scheduleSave();
    };
    const moveTo = (x: number, y: number) => {
      cx = Math.max(0, Math.min(SIZE - 1, x));
      cy = Math.max(0, Math.min(SIZE - 1, y));
      refresh(apply());
    };

    const onKey = (e: KeyboardEvent) => {
      if (!root.isConnected) return teardown?.();
      if (solved || over || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      const dir = DIRS[e.code];
      if (dir) {
        e.preventDefault();
        moveTo(cx + dir[0], cy + dir[1]);
      } else if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'KeyX') {
        e.preventDefault();
        if (e.repeat) return;
        heldCode = e.code;
        refresh(begin(e.code === 'KeyX' || (e.code === 'KeyE' && e.shiftKey) ? 'mark' : 'fill'));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== heldCode) return;
      heldCode = '';
      if (!dragging) mode = null;
    };
    const endStroke = () => {
      dragging = false;
      heldCode = '';
      mode = null;
    };
    const cellOf = (t: EventTarget | null) => {
      const el = (t as HTMLElement | null)?.closest?.<HTMLElement>('.ngram-cell');
      return el ? [Number(el.dataset.x), Number(el.dataset.y)] as const : null;
    };
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('mousedown', (e) => {
      const c = cellOf(e.target);
      if (!c || solved || over || (e.button !== 0 && e.button !== 2)) return;
      e.preventDefault();
      [cx, cy] = c;
      dragging = true;
      refresh(begin(e.button === 2 ? 'mark' : 'fill'));
    });
    board.addEventListener('mouseover', (e) => {
      const c = cellOf(e.target);
      if (!c || solved || over || (c[0] === cx && c[1] === cy)) return;
      moveTo(c[0], c[1]);
    });
    const onMouseUp = () => {
      if (dragging) endStroke();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', endStroke);
    const tick = window.setInterval(() => {
      timerEl.textContent = clockText();
      timerEl.classList.toggle('ngram-low', game.timed && timeLeft() < 5 * 60_000);
      if (game.timed && !solved && !over && timeLeft() <= 0) timeUp();
    }, 250);
    let winNav: ReturnType<typeof listNav> | undefined;
    teardown = () => {
      flush();
      clearInterval(tick);
      winNav?.destroy();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', endStroke);
    };

    // ---- footer
    let confirmClear = 0;
    const clearBtn = footBtn('🧽 Clear board', () => {
      if (!confirmClear) {
        clearBtn.textContent = '🧽 Sure? Click again';
        confirmClear = window.setTimeout(() => {
          confirmClear = 0;
          clearBtn.textContent = '🧽 Clear board';
        }, 2500);
        return;
      }
      clearTimeout(confirmClear);
      confirmClear = 0;
      clearBtn.textContent = '🧽 Clear board';
      // Clearing the board never gives back time lost to mistakes.
      for (const r of game.marks) r.fill(0);
      for (const c of cells.flat()) c.classList.remove('ngram-oops');
      refresh(true);
    });
    foot.append(h('div', { class: 'kbd-hint' }, 'Move WASD/arrows · E/Space fill · X/⇧E mark · hold to paint · Esc close (progress is saved)'),
      clearBtn, footBtn('📚 Puzzles', showPicker));

    // ---- solved!
    const win = () => {
      game.elapsedMs = elapsed();
      solved = true;
      endStroke();
      clearTimeout(saveTimer);
      const ms = game.elapsedMs + game.penaltyMs;
      const prev = save.solved[game.id];
      // Beating the clock pays half as much again.
      const coins = Math.round((game.id === RANDOM_ID ? 300 : prev ? 100 : 500) * (game.timed ? 1.5 : 1));
      const record = Boolean(prev && ms < prev.bestMs);
      save.solved[game.id] = { bestMs: prev ? Math.min(prev.bestMs, ms) : ms, date: Date.now(), timed: game.timed || prev?.timed || undefined };
      delete save.current;
      opts.onSave(save);
      opts.onReward(coins);
      opts.onSound?.('fanfare');
      board.classList.add('ngram-solved');
      paint();
      nameEl.textContent = game.name;
      const winBtn = (text: string, onClick: () => void) => {
        const b = h('button', { class: 'btn small ngram-win-btn', type: 'button' }, text);
        b.addEventListener('click', onClick);
        return b;
      };
      status.replaceChildren(h('div', { class: 'ngram-win' },
        h('div', { class: 'ngram-win-burst' }, '🎉'),
        h('div', { class: 'ngram-win-title' }, 'Solved!'),
        h('div', { class: 'ngram-win-name' }, isPicture ? `It's… ${game.name}!` : `“${game.name}” cracked`),
        h('div', { class: 'ngram-win-line' }, `⏱ ${fmt(ms)}${record ? ' · new best!' : prev ? ` · best ${fmt(prev.bestMs)}` : ''}`),
        game.timed ? h('div', { class: 'ngram-win-line' }, `⏳ ${fmt(timeLeft())} to spare${game.errors ? ` · ${game.errors} mistake${game.errors > 1 ? 's' : ''}` : ' · no mistakes!'}`) : null,
        h('div', { class: 'ngram-win-coins' }, `+${coins.toLocaleString()} 🪙`),
        winBtn('🎲 Another one', () => play(randomGame())),
        winBtn('📚 Pick a puzzle', showPicker),
        winBtn('👋 Done', () => panel.close())));
      foot.replaceChildren(h('div', { class: 'kbd-hint' }, '↑↓ choose · Enter confirm · Esc close'));
      winNav = listNav(status, '.ngram-win-btn');
      winNav.reset();
    };

    // ---- out of time
    const timeUp = () => {
      if (over || solved) return;
      game.elapsedMs = elapsed();
      over = true;
      endStroke();
      clearTimeout(saveTimer);
      delete save.current;
      opts.onSave(save);
      opts.onSound?.('timeout');
      board.classList.add('ngram-over');
      timerEl.textContent = '⏳ 00:00';
      paint();
      const btn = (text: string, onClick: () => void) => {
        const b = h('button', { class: 'btn small ngram-win-btn', type: 'button' }, text);
        b.addEventListener('click', onClick);
        return b;
      };
      status.replaceChildren(h('div', { class: 'ngram-win ngram-lost' },
        h('div', { class: 'ngram-win-burst' }, '⏰'),
        h('div', { class: 'ngram-win-title' }, 'Time’s up!'),
        h('div', { class: 'ngram-win-line' }, `${game.errors} mistake${game.errors === 1 ? '' : 's'} cost ${fmt(game.penaltyMs)}`),
        btn('🔁 Try this one again', () => play(fresh(game.id, game.name, game.solution, true))),
        btn('📚 Pick a puzzle', showPicker),
        btn('👋 Done', () => panel.close())));
      foot.replaceChildren(h('div', { class: 'kbd-hint' }, '↑↓ choose · Enter confirm · Esc close'));
      winNav = listNav(status, '.ngram-win-btn');
      winNav.reset();
    };

    paint();
    flush();
    if (game.timed && timeLeft() <= 0) timeUp();
  };

  return new Promise((resolve) => {
    panel.open({
      title: '🧩 Picross corner', color: '#e8845e', body: root, foot, kind: 'nonogram',
      onClose: () => {
        teardown?.();
        teardown = undefined;
        resolve();
      },
    });
    showPicker();
  });
}
