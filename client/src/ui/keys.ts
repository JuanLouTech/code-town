/**
 * Keyboard helpers for the notebook panels, so everything can be driven
 * without the mouse.
 */

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'checkbox' && el.type !== 'radio');
}

/**
 * Arrow keys move a highlight through `selector` items inside `root` (lists
 * and grids alike), Enter clicks the highlighted one. Works while a search
 * box has focus too, so you can type to filter and arrow straight into the results.
 * With `letters` (lists without a text box), WASD move and E picks as well.
 */
export function listNav(root: HTMLElement, selector: string, o: { letters?: boolean } = {}) {
  let sel = -1;
  const items = () => [...root.querySelectorAll<HTMLElement>(selector)].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
  const paint = (scroll = true) => {
    const all = items();
    root.querySelectorAll('.kbd-sel').forEach((x) => x.classList.remove('kbd-sel'));
    const cur = all[sel];
    if (!cur) return;
    cur.classList.add('kbd-sel');
    if (scroll) cur.scrollIntoView({ block: 'nearest' });
  };
  const move = (dir: 'up' | 'down' | 'left' | 'right') => {
    const all = items();
    if (!all.length) return;
    if (sel < 0 || sel >= all.length) {
      sel = 0;
      return paint();
    }
    const cur = all[sel].getBoundingClientRect();
    if (dir === 'left' || dir === 'right') {
      sel = Math.max(0, Math.min(all.length - 1, sel + (dir === 'right' ? 1 : -1)));
      return paint();
    }
    // Up/down: the nearest item in the next row, lining up horizontally.
    const cx = cur.left + cur.width / 2;
    let best = -1;
    let bestScore = Infinity;
    all.forEach((el, i) => {
      if (i === sel) return;
      const r = el.getBoundingClientRect();
      const dy = dir === 'down' ? r.top - cur.top : cur.top - r.top;
      if (dy <= 4) return;
      const score = dy * 4 + Math.abs(r.left + r.width / 2 - cx);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) sel = best;
    paint();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) {
      window.removeEventListener('keydown', onKey, true);
      return;
    }
    const inText = isTextField(document.activeElement);
    // In a multi-line textarea the arrows belong to the caret.
    if (document.activeElement instanceof HTMLTextAreaElement) return;
    let key = e.key;
    if (o.letters && !inText && !e.ctrlKey && !e.metaKey && !e.altKey) {
      key = ({ KeyW: 'ArrowUp', KeyS: 'ArrowDown', KeyA: 'ArrowLeft', KeyD: 'ArrowRight', KeyE: 'Enter' } as Record<string, string>)[e.code] ?? key;
    }
    if (key === 'ArrowDown' || key === 'ArrowUp' || (!inText && (key === 'ArrowLeft' || key === 'ArrowRight'))) {
      e.preventDefault();
      // Moving the highlight takes Enter back from a button that was clicked or Tabbed to.
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && !items().includes(focused)) focused.blur();
      move(key === 'ArrowDown' ? 'down' : key === 'ArrowUp' ? 'up' : key === 'ArrowLeft' ? 'left' : 'right');
    } else if (key === 'Enter' && !e.shiftKey) {
      // A button Tabbed to outside the list (a tab chip, say) keeps its own Enter.
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && !items().includes(focused)) return;
      const cur = items()[sel];
      if (cur) {
        e.preventDefault();
        e.stopPropagation();
        cur.click();
      }
    }
  };
  window.addEventListener('keydown', onKey, true);
  return {
    /** Call after re-rendering the items (e.g. filtering): selects the first one. */
    reset() {
      sel = items().length ? 0 : -1;
      paint(false);
    },
    /** Highlights `el` (one of the items) and scrolls it into view. */
    select(el: HTMLElement) {
      sel = items().indexOf(el);
      paint();
    },
    destroy() {
      window.removeEventListener('keydown', onKey, true);
    },
  };
}

/**
 * Forms: elements marked `data-field` are rows. Tab or ↑/↓ moves between rows,
 * ←/→ changes a chip row or toggle, Enter submits, Esc on a row goes back to
 * the main text box (a second Esc cancels).
 */
export function formNav(root: HTMLElement, o: { submit: () => void; home?: HTMLElement }) {
  const fields = () => [...root.querySelectorAll<HTMLElement>('[data-field]')].filter((x) => x.offsetParent !== null);
  const focusField = (from: HTMLElement, dir: 1 | -1) => {
    const all = fields();
    const i = all.indexOf(from);
    const next = all[i + dir];
    if (next) {
      next.focus();
      return true;
    }
    return false;
  };
  root.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const field = t.closest<HTMLElement>('[data-field]');
    if (!field) return;
    if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && field.type === 'text')) {
      // From the text box, ↓ at the very end moves on to the options.
      const f = field as HTMLTextAreaElement | HTMLInputElement;
      if (e.key === 'ArrowDown' && f.selectionStart === f.value.length && !e.shiftKey) {
        if (focusField(field, 1)) e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusField(field, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && !(t instanceof HTMLButtonElement)) {
      e.preventDefault();
      e.stopPropagation();
      o.submit();
    } else if (e.key === 'Escape' && o.home) {
      e.preventDefault();
      e.stopPropagation();
      o.home.focus();
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && field instanceof HTMLInputElement && field.type === 'checkbox') {
      e.preventDefault();
      field.checked = e.key === 'ArrowRight';
      field.dispatchEvent(new Event('change'));
    }
  });
}

/** ←/→ move focus between the buttons of a row (confirm dialogs, footers). */
export function buttonRowNav(row: HTMLElement) {
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const btns = [...row.querySelectorAll<HTMLButtonElement>('button')];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length].focus();
  });
}

const IS_MAC = /mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform);

/**
 * The "scroll the conversation" shortcut: Ctrl+W/S on macOS, Alt+W/S elsewhere (Ctrl+W closes
 * the tab on Windows/Linux, and Option+W/S types ∑/ß on a Mac). Alt+↑/↓ too, off the Mac
 * (there Ctrl+↑/↓ belong to Mission Control). Returns -1 (up), 1 (down) or 0.
 */
export function scrollKey(e: KeyboardEvent): -1 | 0 | 1 {
  const mod = IS_MAC ? e.ctrlKey && !e.altKey && !e.metaKey : e.altKey && !e.ctrlKey && !e.metaKey;
  if (!mod || e.shiftKey) return 0;
  if (e.code === 'KeyW' || (!IS_MAC && e.code === 'ArrowUp')) return -1;
  if (e.code === 'KeyS' || (!IS_MAC && e.code === 'ArrowDown')) return 1;
  return 0;
}

export function scrollKeyLabel() {
  return IS_MAC ? 'Ctrl+W/S' : 'Alt+W/S';
}
