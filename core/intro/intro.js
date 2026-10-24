// Інтро — сцэна чакання перад стрымам: налады старонкі і ўсе кліпы канала з Twitch.
// Кліпы не спампоўваюцца: праграма трымае толькі спіс (id, назва, працягласць), а паказвае іх афіцыйны плэер Twitch.
// Апошні атрыманы спіс захоўваецца ў базе — калі Twitch недаступны, оверлей грае па ім.
import { errorCode } from '../util/log.js';

const DAY = 86_400_000;
const YEAR = 365 * DAY;
/** Абнаўленне спіса не часцей, чым раз у хвіліну (актывацыі сцэны могуць ісці адна за адной). */
const MIN_REFRESH_MS = 60_000;
/** Twitch аддае па адным запыце з пагінацыяй каля 1000 кліпаў — акно з такой колькасцю дзеліцца напалову. */
const WINDOW_LIMIT = 950;
const PAGES_PER_WINDOW = 20;

export const introDefaults = {
  version: 1,
  countdown: 600,
  finishText: 'Пачынаем!',
  linksTitle: 'Дзе мяне знайсці',
  links: [],
  clipPause: 5,
  donations: false,
};

const plain = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

export function validateIntro(input) {
  const value = { ...introDefaults, ...input };
  if (!inRange(value.countdown, 10, 6 * 3600)) throw new Error('intro_countdown');
  if (!plain(value.finishText, 1, 80)) throw new Error('intro_finish_text');
  if (!plain(value.linksTitle, 0, 60)) throw new Error('intro_links_title');
  if (!inRange(value.clipPause, 0, 120)) throw new Error('intro_clip_pause');
  if (typeof value.donations !== 'boolean') throw new Error('intro_options');
  if (!Array.isArray(value.links) || value.links.length > 8) throw new Error('intro_links');
  const links = value.links.map(link => {
    if (!plain(link?.url, 1, 200) || /\s/.test(link.url.trim()) || !plain(link.label ?? '', 0, 60) || typeof (link.qr ?? false) !== 'boolean'
      || !/^[a-z0-9]{1,24}$/i.test(link.id ?? '')) throw new Error('intro_link');
    return { id: link.id, url: link.url.trim(), label: (link.label ?? '').normalize('NFKC').trim(), qr: link.qr ?? false };
  });
  return {
    version: 1, countdown: value.countdown, finishText: value.finishText.normalize('NFKC').trim(),
    linksTitle: value.linksTitle.normalize('NFKC').trim(), links, clipPause: value.clipPause, donations: value.donations,
  };
}

const clipOf = c => ({
  id: String(c.id), title: String(c.title ?? ''), duration: Number(c.duration) || 30,
  creator: String(c.creator_name ?? ''), creatorId: String(c.creator_id ?? ''), createdAt: String(c.created_at ?? ''), views: Number(c.view_count) || 0,
});

/**
 * Усе кліпы канала, у тым ліку нарэзаныя гледачамі. Без даты Twitch аддае толькі «топ» і абрывае пагінацыю,
 * таму праграма праходзіць гісторыю канала гадавымі вокнамі (`started_at`/`ended_at`), а поўныя вокны дзеліць.
 */
export async function fetchAllClips(twitch, broadcasterId, { now = Date.now } = {}) {
  const users = await twitch.api('users', { query: { id: broadcasterId } });
  const created = Date.parse(users?.data?.[0]?.created_at ?? '') || Date.UTC(2011, 5, 1);
  const end = now() + DAY;
  const byId = new Map();
  const iso = ms => new Date(ms).toISOString();

  const scan = async (from, to, depth) => {
    const found = [];
    let cursor = '';
    for (let page = 0; page < PAGES_PER_WINDOW; page++) {
      const data = await twitch.api('clips', {
        query: { broadcaster_id: broadcasterId, first: '100', started_at: iso(from), ended_at: iso(to), ...(cursor ? { after: cursor } : {}) },
      });
      if (!Array.isArray(data?.data)) throw new Error('remote_format');
      found.push(...data.data);
      cursor = data.pagination?.cursor ?? '';
      if (!cursor) break;
    }
    if ((cursor || found.length >= WINDOW_LIMIT) && to - from > DAY && depth < 20) {
      const middle = Math.floor(from + (to - from) / 2);
      await scan(from, middle, depth + 1);
      await scan(middle, to, depth + 1);
      return;
    }
    for (const clip of found) if (clip?.id) byId.set(String(clip.id), clipOf(clip));
  };

  for (let from = created; from < end; from += YEAR) await scan(from, Math.min(from + YEAR, end), 0);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export class Intro {
  constructor({ store, twitch, log = () => {}, now = Date.now, fetchClips = fetchAllClips }) {
    Object.assign(this, { store, twitch, log, now, fetchClips });
    this.fetching = null;
    this.attemptAt = 0;
    this.error = null;
  }

  config() {
    try { return validateIntro(this.store.get('intro.settings', introDefaults)); } catch { return validateIntro(introDefaults); }
  }

  save(body) {
    const value = validateIntro(body);
    this.store.transaction(() => this.store.set('intro.settings', value));
    return value;
  }

  /** Адлік пачынаецца нанова на оверлеі, калі гэты знак змяняецца. */
  restartCountdown() {
    const at = this.now();
    this.store.set('intro.restart', at);
    return { restartAt: at };
  }

  /** Апошні атрыманы спіс. Кліпы іншага канала (стрымер увайшоў пад іншым акаўнтам) не паказваюцца. */
  clips() {
    const saved = this.store.get('intro.clips', null);
    const owner = this.twitch.identity?.userId;
    if (!saved || (owner && saved.broadcasterId !== owner)) return { fetchedAt: null, clips: [] };
    return { fetchedAt: saved.fetchedAt, clips: saved.clips };
  }

  /** Абнавіць спіс з Twitch. Без `force` — не часцей за раз у хвіліну; паралельныя выклікі чакаюць адзін запыт. */
  refresh({ force = false } = {}) {
    if (this.fetching) return this.fetching;
    if (!force && this.now() - this.attemptAt < MIN_REFRESH_MS) return Promise.resolve(this.clips());
    this.attemptAt = this.now();
    this.fetching = (async () => {
      try {
        await this.twitch.credentials();
        const broadcasterId = this.twitch.identity.userId;
        const clips = await this.fetchClips(this.twitch, broadcasterId, { now: this.now });
        this.store.set('intro.clips', { broadcasterId, fetchedAt: this.now(), clips });
        this.error = null;
        this.log('info', 'intro.clips', String(clips.length));
      } catch (error) {
        this.error = errorCode(error);
        this.log('warn', 'intro.clips_failed', this.error);
      } finally {
        this.fetching = null;
      }
      return this.clips();
    })();
    return this.fetching;
  }

  /** Для оверлея: налады і версія спіса (сам спіс — асобным запытам, калі версія змянілася). */
  overlayState() {
    const { fetchedAt, clips } = this.clips();
    return { config: this.config(), restartAt: this.store.get('intro.restart', 0), clips: { fetchedAt, count: clips.length } };
  }

  snapshot() {
    const { fetchedAt, clips } = this.clips();
    const owner = this.store.get('intro.clips', null)?.broadcasterId;
    return {
      config: this.config(), clips: clips.length, fetchedAt, fetching: !!this.fetching, error: this.error,
      byViewers: clips.filter(c => c.creatorId && c.creatorId !== owner).length,
    };
  }
}
