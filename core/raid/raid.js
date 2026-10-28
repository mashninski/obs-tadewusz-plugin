// Рэйд з дока: спіс каналаў у эфіры, на якія падпісаны стрымер, пачатак і адмена рэйду, адлік да Raid Now.
// Twitch не дазваляе націснуць Raid Now праз API: POST /helix/raids толькі адкрывае акно рэйду ў чаце,
// кнопка Raid Now робіцца актыўнай праз ~10 с, а без націску рэйд адбываецца сам праз ~90 с.
// Факт рэйду — падзея EventSub channel.raid (ад нашага канала).
import { RAID_SCOPES } from '../twitch/client.js';
import { errorCode } from '../util/log.js';

/** Калі за гэты час няма channel.raid — у доку «Рэйд не пацверджаны». */
export const RAID_CONFIRM_MS = 100_000;
/** Спіс каналаў з Twitch — не часцей за раз у 5 с (адкрыццё спіса і кнопка «Абнавіць»). */
const LIST_MIN_MS = 5000;

const https = url => (typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : '');
const text = (value, max) => String(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, max);

/**
 * Адказы Twitch на рэйд — у коды з зразумелым тэкстам у доку (апісанне кодаў — у даведцы Helix «Start a raid»).
 * 401 пасля абнаўлення токена — у токене няма патрэбных правоў.
 */
const RAID_ERRORS = { remote_400: 'raid_refused', remote_401: 'raid_scopes', remote_404: 'raid_channel_missing', remote_409: 'raid_conflict', remote_429: 'raid_rate_limit' };
const raidError = error => new Error(RAID_ERRORS[error?.message] ?? errorCode(error));

/** Канал для дока і экрана: толькі патрэбныя палі, адрасы — толькі https. */
export const channelOf = (stream, user) => ({
  id: String(stream.user_id),
  login: text(stream.user_login, 40),
  name: text(stream.user_name || stream.user_login, 40),
  avatar: https(user?.profile_image_url),
  game: text(stream.game_name, 120),
  title: text(stream.title, 200),
  viewers: Number.isInteger(stream.viewer_count) ? stream.viewer_count : 0,
  // Twitch пазначыў поле састарэлым (заўсёды false), але калі яно true — паказаць.
  mature: stream.is_mature === true,
  thumbnail: https(String(stream.thumbnail_url ?? '').replace('{width}', '640').replace('{height}', '360')),
});

export class Raid {
  constructor({ twitch, log = () => {}, now = Date.now, countdown = () => 10 }) {
    Object.assign(this, { twitch, log, now, countdown });
    this.list = { fetchedAt: null, channels: [], error: null };
    this.loading = null;
    this.current = null;
    /** Ці сцэна «Аўтра» ў праграме OBS (ядро правярае раз у 3 с); `null` — невядома. */
    this.outroOnAir = null;
  }

  /** Чаго не хапае для рэйду: уваходу ў Twitch або новых правоў. */
  access() {
    if (!this.twitch.connected) return 'twitch_connect_required';
    return this.twitch.missingScopes(RAID_SCOPES).length ? 'raid_scopes' : null;
  }

  requireAccess() {
    const problem = this.access();
    if (problem) throw new Error(problem);
  }

  /** Каналы ў эфіры з аватарамі. Без `force` — не часцей за раз у 5 с; паралельныя выклікі чакаюць адзін запыт. */
  channels({ force = false } = {}) {
    if (this.loading) return this.loading;
    if (!force && this.list.fetchedAt && this.now() - this.list.fetchedAt < LIST_MIN_MS) return Promise.resolve(this.list);
    this.loading = (async () => {
      try {
        this.requireAccess();
        const streams = await this.twitch.followedStreams();
        const users = new Map((await this.twitch.users(streams.map(s => String(s.user_id)))).map(u => [String(u.id), u]));
        const channels = streams.filter(s => s.user_id !== this.twitch.identity.userId).map(s => channelOf(s, users.get(String(s.user_id))));
        this.list = { fetchedAt: this.now(), channels, error: null };
      } catch (error) {
        this.list = { ...this.list, error: error.message === 'remote_401' ? 'raid_scopes' : errorCode(error) };
        this.log('warn', 'raid.channels_failed', this.list.error);
      } finally {
        this.loading = null;
      }
      return this.list;
    })();
    return this.loading;
  }

  /** Пачаць рэйд на канал са спіса. Адлік — ад адказу Twitch. */
  async start(id) {
    this.requireAccess();
    if (this.current && ['starting', 'pending'].includes(this.current.phase)) throw new Error('raid_in_progress');
    const target = this.list.channels.find(c => c.id === id);
    if (!target) throw new Error('raid_target');
    this.current = { phase: 'starting', target, startedAt: null, deadline: null, error: null, viewers: null };
    try {
      await this.twitch.startRaid(target.id);
    } catch (error) {
      const failure = raidError(error);
      this.current = { ...this.current, phase: 'failed', error: failure.message };
      this.log('warn', 'raid.start_failed', failure.message);
      throw failure;
    }
    const startedAt = this.now();
    this.current = { ...this.current, phase: 'pending', startedAt, deadline: startedAt + this.countdown() * 1000 };
    this.log('info', 'raid.started', target.login);
    return this.snapshot();
  }

  /** Адмяніць рэйд, пакуль ён не адбыўся. */
  async cancel() {
    this.requireAccess();
    if (!this.current || !['pending', 'unconfirmed'].includes(this.current.phase)) throw new Error('raid_not_pending');
    let gone = false;
    try {
      await this.twitch.cancelRaid();
    } catch (error) {
      if (error.message !== 'remote_404') throw raidError(error);
      // 404: у Twitch рэйду ўжо няма — яго адмянілі ў чаце (падзеі на гэта Twitch не дае).
      // Калі б рэйд адбыўся, channel.raid ужо перавёў бы стан у «адбыўся». Стан закрываецца — можна пачаць новы.
      gone = true;
    }
    this.current = { ...this.current, phase: 'cancelled' };
    this.log('info', gone ? 'raid.gone' : 'raid.cancelled');
    return { ...this.snapshot(), gone };
  }

  /** Закрыць вынік (рэйд адбыўся, адменены або не пацверджаны) — экран вяртаецца да кліпаў. */
  reset() {
    if (this.current && ['starting', 'pending'].includes(this.current.phase)) throw new Error('raid_in_progress');
    this.current = null;
    return this.snapshot();
  }

  /** Падзея EventSub. `true` — падзея рэйду (апрацавана тут). */
  onEvent(type, event) {
    if (type !== 'channel.raid') return false;
    if (String(event?.from_broadcaster_user_id) !== this.twitch.identity?.userId) return true;
    const to = String(event.to_broadcaster_user_id ?? '');
    this.log('info', 'raid.happened', String(event.to_broadcaster_user_login ?? to));
    if (this.current && ['pending', 'unconfirmed'].includes(this.current.phase)) {
      const target = this.current.target.id === to ? this.current.target
        : { ...this.current.target, id: to, login: text(event.to_broadcaster_user_login, 40), name: text(event.to_broadcaster_user_name, 40) };
      this.current = { ...this.current, target, phase: 'done', doneAt: this.now(), viewers: Number(event.viewers) || 0 };
    }
    return true;
  }

  tick() {
    if (this.current?.phase === 'pending' && this.now() - this.current.startedAt >= RAID_CONFIRM_MS) {
      this.current = { ...this.current, phase: 'unconfirmed' };
      this.log('warn', 'raid.unconfirmed');
    }
  }

  /** Для старонкі аўтра: картка рэйду і адлік (пакуль рэйд ідзе або адбыўся). Адменены або няўдалы — нічога. */
  view() {
    const raid = this.current;
    if (!raid || !['pending', 'unconfirmed', 'done'].includes(raid.phase)) return null;
    return { id: `${raid.target.id}:${raid.startedAt}`, target: raid.target, startedAt: raid.startedAt, deadline: raid.deadline };
  }

  snapshot() {
    return {
      access: this.access(),
      list: { ...this.list, loading: !!this.loading },
      current: this.current, serverNow: this.now(), confirmMs: RAID_CONFIRM_MS, outroOnAir: this.outroOnAir,
    };
  }
}
