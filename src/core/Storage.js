/**
 * Settings and the one save slot, kept in this browser's localStorage. Storage can be unavailable
 * (private windows, blocked site data), so every access is guarded and the game runs on defaults.
 */
const SETTINGS_KEY = 'little-spirit.settings';
const SAVE_KEY = 'little-spirit.save';

export const DEFAULT_SETTINGS = { master: 0.9, music: 0.6, sfx: 0.8, sensitivity: 1, quality: 'high' };

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // nothing to do: the game keeps working without persistence
  }
}

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY) });
export const saveSettings = (s) => write(SETTINGS_KEY, s);

/** { position: [x, y, z], yaw, form } or null. */
export function loadGame() {
  const s = read(SAVE_KEY);
  return s && Array.isArray(s.position) && s.position.length === 3 && s.position.every(Number.isFinite) ? s : null;
}
export const saveGame = (s) => write(SAVE_KEY, s);
export const clearGame = () => write(SAVE_KEY, null);
