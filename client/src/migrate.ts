/**
 * One-time move of browser data from the old app name: copies every `crossing.*` localStorage key
 * to its `codetown.*` counterpart (unless that is already set) and removes the old key. Imported
 * first by main.ts so it runs before any module reads localStorage.
 */
const OLD = 'crossing.';
const NEW = 'codetown.';

try {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const key of keys) {
    if (!key?.startsWith(OLD)) continue;
    const next = NEW + key.slice(OLD.length);
    const value = localStorage.getItem(key);
    if (localStorage.getItem(next) === null && value !== null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch { /* storage unavailable: nothing to migrate */ }

export {};
