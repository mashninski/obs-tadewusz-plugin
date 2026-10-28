// Тэкст бягучага радка: агульныя правілы для дока, оверлея і сервера.

/** Даўжыня ў сімвалах Unicode (не ў адзінках UTF-16) — тое, што бачыць стрымер. */
export const textLength = text => Array.from(text).length;

/**
 * Тлусты шрыфт толькі ў аб’явах стрымера (**так**). Ніякага HTML; непарныя маркеры застаюцца тэкстам.
 * Платныя паведамленні гледачоў гэты разбор не выкарыстоўваюць.
 */
export function boldParts(text) {
  const parts = [];
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf('**', at), end = start < 0 ? -1 : text.indexOf('**', start + 2);
    if (start < 0 || end < 0) {
      parts.push({ text: text.slice(at), bold: false });
      break;
    }
    if (start > at) parts.push({ text: text.slice(at, start), bold: false });
    if (end === start + 2) parts.push({ text: '****', bold: false });
    else parts.push({ text: text.slice(start + 2, end), bold: true });
    at = end + 2;
  }
  return parts;
}

/** Уключыць або зняць тлусты шрыфт на вылучаным кавалку. */
export function toggleBold(text, start, end) {
  if (start === end) return { text, start, end };
  const selected = text.slice(start, end);
  if (selected.startsWith('**') && selected.endsWith('**') && end - start > 4)
    return { text: text.slice(0, start) + text.slice(start + 2, end - 2) + text.slice(end), start, end: end - 4 };
  if (text.slice(Math.max(0, start - 2), start) === '**' && text.slice(end, end + 2) === '**')
    return { text: text.slice(0, start - 2) + selected + text.slice(end + 2), start: start - 2, end: end - 2 };
  return { text: `${text.slice(0, start)}**${selected}**${text.slice(end)}`, start: start + 2, end: end + 2 };
}

export function validateText(text, limit = 500) {
  if (typeof text !== 'string' || !text.replace(/[\p{Cf}\p{M}\s]/gu, '') || textLength(text) > limit
    || /[\p{Cc}\p{Cs}​‎‏‪-‮⁠-⁯﻿]/u.test(text.replace(/\n/g, '')))
    throw new Error('ticker_text');
  return text;
}

/**
 * Тэкст гледача: нябачныя знакі (прабелы нулявой шырыні, кіраванне кірункам, «тэгі», якія ўстаўляюць пашырэнні
 * чата Twitch) выкідаюцца, табуляцыя і пераносы — у прабел. Злучальнік эмодзі (ZWJ) застаецца.
 */
export function cleanViewerText(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[\t\n\r\v\f\u2028\u2029]+/g, ' ')
    .replace(/(?!\u200D)[\p{Cc}\p{Cf}\p{Cs}\u{E0000}-\u{E007F}]/gu, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export const tickerDefaults = {
  version: 1, enabled: false, interval: 300, width: 960, height: 190, font: 'Onest', size: 30, speed: 18,
  accent: '#79d6b3', opacity: 0.94, cost: 1000, title: 'Паведамленне голасам',
  prompt: 'Да 1000 знакаў · тэкст прагучыць на стрыме выпадковым голасам і з’явіцца ў радку',
  announcements: [],
};

/** Даўжэйшае платнае паведамленне адхіляецца — балы вяртаюцца. */
export const PAID_TEXT_LIMIT = 1000;

/** Ранейшыя назва і падказкі ўзнагароды па змаўчанні: калі стрымер іх не мяняў, яны замяняюцца новымі. */
export const LEGACY_TICKER_REWARD = {
  title: 'Паведамленне на экране',
  prompts: ['Увядзіце паведамленне: да 500 знакаў', 'Ваш тэкст прагучыць на стрыме выпадковым голасам і з’явіцца ў радку'],
};

export function validateTicker(input) {
  const c = { ...tickerDefaults, ...input };
  if (c.version !== 1 || typeof c.enabled !== 'boolean' || !Array.isArray(c.announcements) || c.announcements.length > 40
    || !/^[\p{L}\p{N} ,_-]{1,80}$/u.test(c.font) || !/^#[a-f0-9]{6}$/i.test(c.accent)) throw new Error('ticker_settings');
  const ranges = [['interval', 10, 86400], ['width', 320, 1920], ['height', 100, 600], ['size', 16, 80], ['speed', 5, 80], ['cost', 1, 100_000_000], ['opacity', 0, 1]];
  for (const [key, min, max] of ranges)
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max || (key !== 'opacity' && !Number.isInteger(c[key]))) throw new Error('ticker_settings');
  if (c.height - 44 - c.size * 0.85 - 8 < c.size * 1.3) throw new Error('ticker_settings');
  validateText(c.title, 45);
  validateText(c.prompt, 200);
  const ids = new Set();
  c.announcements = c.announcements.map(a => {
    if (!/^[a-f0-9-]{36}$/i.test(a.id) || ids.has(a.id)) throw new Error('ticker_settings');
    ids.add(a.id);
    return { id: a.id, text: validateText(a.text, 2000) };
  });
  return Object.fromEntries(Object.keys(tickerDefaults).map(key => [key, c[key]]));
}
