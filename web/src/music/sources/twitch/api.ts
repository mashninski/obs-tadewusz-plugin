// Кліент Twitch Helix для музыкі. Запыты ідуць праз ядро праграмы (агульны ўваход у Twitch, гл. core.ts).

import { CoreError, type CoreIdentity, type CoreTwitch } from './core';

/** Колькі чакаць пасля 429: каля хвіліны — столькі доўжыцца «вядро» запытаў Twitch. */
export const RATE_WAIT_MS = 30_000;

export type TwitchErrorKind =
  /** Няма ўваходу ў Twitch (падключэнне — у доку, укладка «Падключэнні»). */
  | 'auth'
  | 'rate'
  /** 403: канал не Affiliate/Partner або ўзнагарода створана іншым прыкладаннем. */
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  | 'conflict'
  | 'network'
  | 'other';

export class TwitchApiError extends Error {
  constructor(
    readonly kind: TwitchErrorKind,
    readonly status = 0,
    readonly reason = '',
  ) {
    super(`${kind}${status ? ` ${status}` : ''}${reason ? `: ${reason}` : ''}`);
    this.name = 'TwitchApiError';
  }
}

const isObject = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

export interface Reward {
  id: string;
  title: string;
  cost: number;
  /** Падказка гледачу ў акне ўзнагароды. */
  prompt?: string;
  /** Колер фону, напрыклад `#282828`. */
  color?: string;
  isPaused: boolean;
  isEnabled: boolean;
}

export interface Redemption {
  id: string;
  rewardId: string;
  userId: string;
  userLogin: string;
  userName: string;
  userInput: string;
  status: string;
  redeemedAt: number;
}

export function parseReward(raw: unknown): Reward | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    title: typeof raw.title === 'string' ? raw.title : '',
    cost: typeof raw.cost === 'number' ? raw.cost : 0,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
    color: typeof raw.background_color === 'string' ? raw.background_color : undefined,
    isPaused: raw.is_paused === true,
    isEnabled: raw.is_enabled !== false,
  };
}

/** Выкуп узнагароды з Helix або з падзеі EventSub (палі аднолькавыя, акрамя ўзнагароды). */
export function parseRedemption(raw: unknown): Redemption | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  const reward = isObject(raw.reward) ? raw.reward : {};
  const rewardId = typeof reward.id === 'string' ? reward.id : typeof raw.reward_id === 'string' ? raw.reward_id : '';
  const at = Date.parse(typeof raw.redeemed_at === 'string' ? raw.redeemed_at : '');
  const login = typeof raw.user_login === 'string' ? raw.user_login : '';
  return {
    id: raw.id,
    rewardId,
    userId: typeof raw.user_id === 'string' ? raw.user_id : '',
    userLogin: login,
    userName: (typeof raw.user_name === 'string' && raw.user_name) || login,
    userInput: typeof raw.user_input === 'string' ? raw.user_input : '',
    status: typeof raw.status === 'string' ? raw.status.toUpperCase() : '',
    redeemedAt: Number.isFinite(at) ? at : 0,
  };
}

export interface TwitchApiOptions {
  core: CoreTwitch;
}

export function createTwitchApi({ core }: TwitchApiOptions) {
  function errorFrom(status: number, body: unknown): TwitchApiError {
    const reason = isObject(body) && typeof body.message === 'string' ? body.message : '';
    if (status === 429) return new TwitchApiError('rate', status, reason);
    if (status === 401) return new TwitchApiError('auth', status, reason);
    if (status === 403) return new TwitchApiError('forbidden', status, reason);
    if (status === 404) return new TwitchApiError('not-found', status, reason);
    if (status === 409) return new TwitchApiError('conflict', status, reason);
    if (status === 400 || status === 422) return new TwitchApiError('bad-request', status, reason);
    return new TwitchApiError('other', status, reason);
  }

  /** Запыт да Helix праз ядро. Памылкі ядра (няма ўваходу, сеткі) — як памылкі Twitch таго ж сэнсу. */
  async function request(method: string, path: string, body?: unknown, keepalive = false): Promise<unknown> {
    let reply;
    try {
      reply = await core.helix(method, path, body, keepalive);
    } catch (e) {
      const code = e instanceof CoreError ? e.code : '';
      if (code === 'twitch_connect_required') throw new TwitchApiError('auth', 0, code);
      if (code === 'network_unavailable' || code === 'core_unavailable') throw new TwitchApiError('network', 0, code);
      if (code === 'remote_429') throw new TwitchApiError('rate', 429, code);
      throw new TwitchApiError('other', 0, code);
    }
    if (reply.status < 200 || reply.status >= 300) throw errorFrom(reply.status, reply.body);
    return reply.body;
  }

  /** Канал стрымера з ядра. Без уваходу — памылка `auth`. */
  async function identity(): Promise<Required<CoreIdentity>> {
    let v: CoreIdentity;
    try {
      v = await core.identity();
    } catch {
      throw new TwitchApiError('network', 0, 'core');
    }
    if (!v.connected || !v.userId) throw new TwitchApiError('auth', 0, 'not-connected');
    return { connected: true, login: v.login ?? '', userId: v.userId, clientId: v.clientId ?? '', scopes: v.scopes ?? [] };
  }

  const data = (json: unknown): unknown[] => (isObject(json) && Array.isArray(json.data) ? json.data : []);
  const q = (params: Record<string, string | string[]>) => {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) search.append(k, x);
    return search.toString();
  };

  return {
    identity,

    async getRewards(broadcasterId: string, ids: string[] = []): Promise<Reward[]> {
      const params: Record<string, string | string[]> = { broadcaster_id: broadcasterId, only_manageable_rewards: 'true' };
      if (ids.length) params.id = ids;
      const json = await request('GET', `/channel_points/custom_rewards?${q(params)}`);
      return data(json).map(parseReward).filter((r): r is Reward => r !== null);
    },

    async createReward(broadcasterId: string, reward: Record<string, unknown>): Promise<Reward> {
      const json = await request('POST', `/channel_points/custom_rewards?${q({ broadcaster_id: broadcasterId })}`, reward);
      const created = parseReward(data(json)[0]);
      if (!created) throw new TwitchApiError('other', 200, 'bad-response');
      return created;
    },

    async updateReward(broadcasterId: string, id: string, patch: Record<string, unknown>, keepalive = false): Promise<Reward | null> {
      if (keepalive) {
        // Старонка зачыняецца: запыт павінен дайсці і пасля выгрузкі, адказ ужо ніхто не прачытае.
        await request('PATCH', `/channel_points/custom_rewards?${q({ broadcaster_id: broadcasterId, id })}`, patch, true).catch(() => null);
        return null;
      }
      const json = await request('PATCH', `/channel_points/custom_rewards?${q({ broadcaster_id: broadcasterId, id })}`, patch);
      return parseReward(data(json)[0]);
    },

    /** Невыкананыя выкупы ўзнагароды (найстарэйшыя спачатку). */
    async unfulfilled(broadcasterId: string, rewardId: string, after = ''): Promise<{ items: Redemption[]; cursor: string }> {
      const params: Record<string, string> = { broadcaster_id: broadcasterId, reward_id: rewardId, status: 'UNFULFILLED', sort: 'OLDEST', first: '50' };
      if (after) params.after = after;
      const json = await request('GET', `/channel_points/custom_rewards/redemptions?${q(params)}`);
      const cursor = isObject(json) && isObject(json.pagination) && typeof json.pagination.cursor === 'string' ? json.pagination.cursor : '';
      return { items: data(json).map(parseRedemption).filter((r): r is Redemption => r !== null), cursor };
    },

    /** FULFILLED — выканана; CANCELED — адмена, баллы вяртаюцца гледачу. */
    async setRedemptionStatus(broadcasterId: string, rewardId: string, id: string, status: 'FULFILLED' | 'CANCELED'): Promise<void> {
      await request('PATCH', `/channel_points/custom_rewards/redemptions?${q({ broadcaster_id: broadcasterId, reward_id: rewardId, id })}`, { status });
    },


    /** Паведамленне ў чат канала ад імя стрымера. `false` — Twitch не прапусціў паведамленне (фільтры чата, AutoMod). */
    async sendChat(broadcasterId: string, message: string): Promise<boolean> {
      const json = await request('POST', '/chat/messages', { broadcaster_id: broadcasterId, sender_id: broadcasterId, message });
      const first = data(json)[0];
      return !isObject(first) || first.is_sent !== false;
    },
  };
}

export type TwitchApi = ReturnType<typeof createTwitchApi>;
