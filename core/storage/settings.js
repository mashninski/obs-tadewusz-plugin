// Налады праграмы (без сакрэтаў). Кожнае поле правяраецца; невядомыя палі адкідаюцца.
import { validateReplies } from '../chat/templates.js';

export const defaults = {
  schemaVersion: 4,
  replies: validateReplies(),
  obs: { url: 'ws://127.0.0.1:4455' },
  twitch: { clientId: '', addCost: 2000, supportCosts: [100, 200, 500, 1000, 2000, 5000, 10000] },
  steam: { onlySteam: false, checkLibrary: false, steamId: '' },
  display: {
    font: 'Segoe UI', size: 32, color: '#ffffff', speed: 24, duration: 10, headlineDuration: 20, volume: 0.15, sound: true,
    width: 660, height: 62, headerOpacity: 0.85, listOpacity: 0.75,
    headlines: ['Стрым па замовах', 'Галасуйце баламі канала', 'Дадавайце новыя пазіцыі', 'Код гульні — побач з назвай'],
  },
  backup: { directory: '' },
};

const inRange = (value, min, max, integer = false) => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));

export function validateSettings(input) {
  if (![1, 2, 3, 4].includes(input?.schemaVersion)) throw new Error('settings_version');
  const url = new URL(input.obs?.url ?? defaults.obs.url);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('obs_local_only');

  const twitch = input.twitch ?? defaults.twitch;
  if (!/^[a-zA-Z0-9]{0,100}$/.test(twitch.clientId ?? '')) throw new Error('client_id');
  const costs = [twitch.addCost, ...(twitch.supportCosts ?? [])];
  if (costs.length < 2 || costs.length > 11 || costs.some(x => !inRange(x, 1, 100_000_000, true))) throw new Error('reward_cost');
  if (new Set(twitch.supportCosts).size !== twitch.supportCosts.length) throw new Error('reward_duplicate');

  const steam = input.steam ?? defaults.steam;
  if (!/^\d{17}$|^$/.test(steam.steamId ?? '')) throw new Error('steam_id');
  if (typeof steam.onlySteam !== 'boolean' || typeof steam.checkLibrary !== 'boolean') throw new Error('steam_options');
  if (steam.checkLibrary && !steam.steamId) throw new Error('steam_connection_required');

  const display = { ...defaults.display, ...input.display };
  if (!/^[\p{L}\p{N} _-]{1,80}$/u.test(display.font) || !/^#[0-9a-f]{6}$/i.test(display.color)) throw new Error('display_style');
  if (!inRange(display.size, 8, 150, true) || !inRange(display.speed, 0, 200)) throw new Error('display_size');
  if (!inRange(display.headerOpacity, 0, 1) || !inRange(display.listOpacity, 0, 1)) throw new Error('display_opacity');
  if (!inRange(display.duration, 1, 60) || !inRange(display.headlineDuration, 1, 300) || !inRange(display.volume, 0, 1)
    || typeof display.sound !== 'boolean' || !inRange(display.width, 200, 1600, true) || !inRange(display.height, 10, 80)) throw new Error('display_options');
  if (!Array.isArray(display.headlines) || display.headlines.length > 20
    || display.headlines.some(s => typeof s !== 'string' || !s.trim() || s.length > 120 || /[\p{Cc}\p{Cf}]/u.test(s))) throw new Error('display_headlines');

  const directory = input.backup?.directory ?? '';
  if (typeof directory !== 'string' || directory.length > 260 || /[\p{Cc}"*?<>|]/u.test(directory)) throw new Error('backup_directory');

  return {
    schemaVersion: 4,
    replies: validateReplies(input.replies),
    obs: { url: url.href },
    twitch: { clientId: twitch.clientId, addCost: twitch.addCost, supportCosts: [...twitch.supportCosts] },
    steam: { onlySteam: steam.onlySteam, checkLibrary: steam.checkLibrary, steamId: steam.steamId },
    display: {
      font: display.font, size: display.size, color: display.color, speed: display.speed, duration: display.duration,
      headlineDuration: display.headlineDuration, volume: display.volume, sound: display.sound, width: display.width,
      height: display.height, headerOpacity: display.headerOpacity, listOpacity: display.listOpacity,
      headlines: display.headlines.map(s => s.normalize('NFKC').trim()),
    },
    backup: { directory: directory.trim() },
  };
}
