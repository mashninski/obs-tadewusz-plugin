// Адказы гледачам у чат. Кожны шаблон рэдагуецца ў доку; падстаноўкі — толькі з дазволенага спіса.
export const replyDefinitions = {
  accepted_support: ['Голас прыняты', '+{amount} талераў на {title}'],
  accepted_add: ['Гульня дададзена', 'гульня {title} дададзена ў спіс'],
  entry_duplicate: ['Пазіцыя ўжо ёсць', 'гульня ўжо ёсць у спісе'],
  entry_ambiguous: ['Неадназначная назва', 'увядзі трохлітарны код гульні'],
  entry_missing: ['Пазіцыя не знойдзена', 'гульня не знойдзена — правер код'],
  paused_at_purchase: ['Пакупка падчас паўзы', 'галасаванне на паўзе'],
  between_rounds: ['Пакупка паміж раўндамі', 'зараз няма адкрытага раўнда'],
  late_closed_round: ['Позна атрыманае дзеянне', 'раунд ужо закрыты'],
  rejected: ['Іншая адмова', 'пакупка не прынята — правер назву або спасылку Steam'],
  suggestions: ['Варыянты назвы', 'магчыма: {suggestions}'],
  canceled: ['Вяртанне пацверджана', 'скасаванне пацверджана'],
  fulfilled: ['Вяртанне недаступнае', 'вяртанне недаступнае'],
  refund_pending: ['Вяртанне яшчэ не пацверджана', 'вяртанне чакае пацверджання Twitch'],
  absent: ['Гульні няма ў стрымера', 'гульні {title} ў мяне няма — згуляю пасля пакупкі'],
  winner: ['Вынік раўнда', 'Перамагла {title} — {score} талераў'],
  empty: ['Раунд без пазіцый', 'Раунд завершаны без гульняў'],
};

export const replyPlaceholders = {
  accepted_support: ['amount', 'title'], accepted_add: ['title'], suggestions: ['suggestions'],
  absent: ['title', 'profile'], winner: ['title', 'score'],
};

export function validateReplies(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input.enabled !== undefined && typeof input.enabled !== 'boolean'))
    throw new Error('reply_settings');
  const templates = {};
  for (const [key, [, fallback]] of Object.entries(replyDefinitions)) {
    const value = input.templates?.[key] ?? fallback;
    if (typeof value !== 'string' || !value.trim() || value.length > 350 || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error('reply_template');
    const allowed = replyPlaceholders[key] ?? [];
    if ([...value.matchAll(/\{([^{}]*)\}/g)].some(m => !allowed.includes(m[1])) || /[{}]/.test(value.replace(/\{[^{}]*\}/g, '')))
      throw new Error('reply_placeholder');
    templates[key] = value;
  }
  return { enabled: input.enabled === true, templates };
}

export function renderReply(key, values = {}, replies = {}) {
  const text = replies.templates?.[key] ?? replyDefinitions[key][1];
  return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ')).trim().replace(/\.+$/u, '');
}

const REJECTIONS = ['entry_duplicate', 'entry_ambiguous', 'entry_missing', 'paused_at_purchase', 'between_rounds', 'late_closed_round'];

/** Адказ гледачу на пакупку ў галасаванні; `null` — адказваць не трэба. */
export function purchaseReply(event, result, { entry, profileUrl = '', replies = {} } = {}) {
  if (result.duplicate) return null;
  const address = /^[a-zA-Z0-9_]{1,25}$/.test(event.user_login ?? '') ? `@${event.user_login}, ` : '';
  const compose = parts => (address + parts.filter(Boolean).join(' · ')).slice(0, 500).trimEnd().replace(/\.+$/u, '');
  if (!result.decision?.startsWith('accepted')) {
    const suggestions = (result.suggestions ?? []).slice(0, 3).map(x => String(x).replace(/\p{Cc}/gu, ' ').slice(0, 60)).join(' / ');
    const status = String(event.status ?? '').toUpperCase();
    const refund = renderReply(status === 'CANCELED' ? 'canceled' : status === 'FULFILLED' ? 'fulfilled' : 'refund_pending', {}, replies);
    return compose([
      renderReply(REJECTIONS.includes(result.decision) ? result.decision : 'rejected', {}, replies),
      suggestions ? renderReply('suggestions', { suggestions }, replies) : '',
      refund,
    ]);
  }
  if (!entry?.title) return null;
  const amount = event.reward?.cost;
  if (result.decision === 'accepted_support' && (!Number.isSafeInteger(amount) || amount < 1)) return null;
  const accepted = renderReply(result.decision, { title: entry.title, amount }, replies);
  const absent = entry.availability === 'absent'
    ? renderReply('absent', { title: entry.title, profile: profileUrl ? ` ${profileUrl}` : '' }, replies) : '';
  return compose([accepted, absent]);
}
