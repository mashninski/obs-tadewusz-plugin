// Падробка Twitch для тэстаў: ядро праграмы (уваход, Helix праз ядро, падзеі ўзнагарод) і сам Helix у памяці.
// У зборку не трапляе (імпартуюць толькі тэсты).

import { CoreError, type CoreEvents, type CoreTwitch } from './core';

export const FAKE_CLIENT_ID = 'abcdefghijklmnopqrstuvwxyz0123';

interface Reply {
  status: number;
  body?: unknown;
}

export interface FakeReward {
  id: string;
  title: string;
  cost: number;
  prompt: string;
  background_color: string;
  is_paused: boolean;
  is_enabled: boolean;
  is_user_input_required: boolean;
  should_redemptions_skip_request_queue: boolean;
  /** Узнагароду стварыла наша прыкладанне (толькі такую можна мяняць). */
  managed: boolean;
}

export interface FakeRedemption {
  id: string;
  reward_id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  user_input: string;
  status: 'UNFULFILLED' | 'FULFILLED' | 'CANCELED';
  redeemed_at: string;
}

export function createFakeTwitch() {
  const state = {
    clientId: FAKE_CLIENT_ID,
    userId: '1001',
    login: 'streamer',
    affiliate: true,
    /** У ядры ёсць уваход у Twitch. */
    loggedIn: true,
    /** Ядро злучана з EventSub (падзеі даходзяць). */
    eventsConnected: true,
    rewards: [] as FakeReward[],
    redemptions: [] as FakeRedemption[],
    chat: [] as string[],
    /** Адказ, які атрымае наступны запыт да Helix з гэтым шляхам (адзін раз). */
    nextReply: null as { path: string; reply: Reply } | null,
    /** Колькі наступных запытаў да Helix адкажуць 429. */
    rateLimited: 0,
    counter: 0,
  };
  const calls: string[] = [];
  const listeners = new Set<CoreEvents>();

  const id = (prefix: string) => `${prefix}-${++state.counter}`;
  const error = (status: number, message: string): Reply => ({ status, body: { error: 'Error', status, message } });

  /** Ядро перасылае падзею ўзнагароды ўсім падпісчыкам (калі злучэнне з EventSub ёсць). */
  function notify(type: string, event: unknown): void {
    if (!state.eventsConnected) return;
    for (const l of listeners) l.onEvent(type, event);
  }

  function setEvents(connected: boolean): void {
    state.eventsConnected = connected;
    for (const l of listeners) l.onStatus(connected);
  }

  const rewardJson = (r: FakeReward) => {
    const { managed: _, ...rest } = r;
    return { ...rest, broadcaster_id: state.userId };
  };

  const redemptionEvent = (r: FakeRedemption) => {
    const reward = state.rewards.find((x) => x.id === r.reward_id);
    return {
      id: r.id,
      broadcaster_user_id: state.userId,
      broadcaster_user_login: state.login,
      broadcaster_user_name: state.login,
      user_id: r.user_id,
      user_login: r.user_login,
      user_name: r.user_name,
      user_input: r.user_input,
      status: r.status.toLowerCase(),
      reward: { id: r.reward_id, title: reward?.title ?? '', cost: reward?.cost ?? 0, prompt: reward?.prompt ?? '' },
      redeemed_at: r.redeemed_at,
    };
  };

  function helix(method: string, path: string, query: URLSearchParams, body: Record<string, any>): Reply {
    if (method === 'GET' && path === '/channel_points/custom_rewards') {
      const ids = query.getAll('id');
      let list = state.rewards.filter((r) => query.get('only_manageable_rewards') !== 'true' || r.managed);
      if (ids.length) list = list.filter((r) => ids.includes(r.id));
      if (ids.length && list.length === 0) return error(404, 'Not Found');
      return { status: 200, body: { data: list.map(rewardJson) } };
    }
    if (method === 'POST' && path === '/channel_points/custom_rewards') {
      if (!state.affiliate) return error(403, 'The broadcaster must have partner or affiliate status.');
      if (state.rewards.some((r) => r.title === body.title)) return error(400, 'CREATE_CUSTOM_REWARD_DUPLICATE_REWARD');
      if (typeof body.title !== 'string' || body.title.length > 45 || (body.prompt ?? '').length > 200) return error(400, 'bad title or prompt');
      const reward: FakeReward = {
        id: id('reward'),
        title: body.title,
        cost: body.cost,
        prompt: body.prompt ?? '',
        background_color: body.background_color ?? '#9147FF',
        is_paused: false,
        is_enabled: body.is_enabled !== false,
        is_user_input_required: body.is_user_input_required === true,
        should_redemptions_skip_request_queue: body.should_redemptions_skip_request_queue === true,
        managed: true,
      };
      state.rewards.push(reward);
      return { status: 200, body: { data: [rewardJson(reward)] } };
    }
    if (method === 'PATCH' && path === '/channel_points/custom_rewards') {
      const reward = state.rewards.find((r) => r.id === query.get('id'));
      if (!reward) return error(404, 'Not Found');
      if (!reward.managed) return error(403, 'Forbidden');
      for (const key of ['cost', 'is_paused', 'is_enabled', 'title', 'prompt', 'background_color'] as const) {
        if (key in body) (reward as any)[key] = body[key];
      }
      notify('channel.channel_points_custom_reward.update', rewardJson(reward));
      return { status: 200, body: { data: [rewardJson(reward)] } };
    }
    if (method === 'GET' && path === '/channel_points/custom_rewards/redemptions') {
      const status = query.get('status');
      const list = state.redemptions.filter((r) => r.reward_id === query.get('reward_id') && (!status || r.status === status));
      const first = Number(query.get('first') ?? 20);
      const start = Number(query.get('after') || 0);
      const page = list.slice(start, start + first);
      const cursor = start + first < list.length ? String(start + first) : undefined;
      return { status: 200, body: { data: page.map(redemptionEvent).map((e) => ({ ...e, status: e.status.toUpperCase() })), pagination: cursor ? { cursor } : {} } };
    }
    if (method === 'PATCH' && path === '/channel_points/custom_rewards/redemptions') {
      const ids = query.getAll('id');
      const reward = state.rewards.find((r) => r.id === query.get('reward_id'));
      if (reward && !reward.managed) return error(403, 'Forbidden');
      const list = state.redemptions.filter((r) => ids.includes(r.id) && r.status === 'UNFULFILLED');
      if (list.length === 0) return error(404, 'Not Found');
      for (const r of list) r.status = body.status;
      return { status: 200, body: { data: list.map(redemptionEvent) } };
    }
    if (method === 'POST' && path === '/chat/messages') {
      if (body.sender_id !== state.userId || body.broadcaster_id !== state.userId) return error(403, 'Forbidden');
      if (typeof body.message !== 'string' || body.message.length > 500) return error(422, 'too large');
      state.chat.push(body.message);
      return { status: 200, body: { data: [{ message_id: id('chat'), is_sent: true }] } };
    }
    return error(404, 'not found');
  }

  const core: CoreTwitch = {
    async identity() {
      return state.loggedIn
        ? { connected: true, login: state.login, userId: state.userId, clientId: state.clientId, scopes: ['channel:manage:redemptions', 'user:write:chat'] }
        : { connected: false };
    },
    async helix(method, pathWithQuery, body) {
      const u = new URL(pathWithQuery, 'https://api.twitch.tv');
      const path = u.pathname;
      calls.push(`${method} ${path}`);
      let reply: Reply;
      if (state.nextReply && state.nextReply.path === `${method} ${path}`) {
        reply = state.nextReply.reply;
        state.nextReply = null;
      } else if (!state.loggedIn) {
        throw new CoreError('twitch_connect_required');
      } else if (state.rateLimited > 0) {
        state.rateLimited--;
        reply = error(429, 'Too Many Requests');
      } else reply = helix(method, path, u.searchParams, (body ?? {}) as Record<string, any>);
      return { status: reply.status, body: reply.body ?? null };
    },
    events(handlers) {
      listeners.add(handlers);
      setTimeout(() => {
        if (listeners.has(handlers)) handlers.onStatus(state.eventsConnected);
      }, 0);
      return () => listeners.delete(handlers);
    },
    async obs() {
      return { url: 'ws://127.0.0.1:4455', password: '' };
    },
  };

  /** Глядач купляе ўзнагароду. Калі бот падключаны, падзея прыходзіць праз EventSub. */
  function redeem(user: string, input: string, options: { redeemedAt?: number; rewardId?: string } = {}): FakeRedemption {
    const reward = state.rewards.find((r) => r.id === options.rewardId) ?? state.rewards.find((r) => r.managed);
    if (!reward) throw new Error('узнагароды няма');
    const r: FakeRedemption = {
      id: id('redemption'),
      reward_id: reward.id,
      user_id: id('user'),
      user_login: user.toLowerCase(),
      user_name: user,
      user_input: input,
      status: 'UNFULFILLED',
      redeemed_at: new Date(options.redeemedAt ?? Date.now()).toISOString(),
    };
    state.redemptions.push(r);
    notify('channel.channel_points_custom_reward_redemption.add', redemptionEvent(r));
    return r;
  }

  /** Даставіць падзею пра выкуп яшчэ раз (паўторная дастаўка). */
  function redeliver(r: FakeRedemption): void {
    notify('channel.channel_points_custom_reward_redemption.add', redemptionEvent(r));
  }

  const count = (call: string) => calls.filter((c) => c === call).length;
  const statusOf = (redemptionId: string) => state.redemptions.find((r) => r.id === redemptionId)?.status;

  /** Колькі старонак зараз атрымліваюць падзеі ад ядра. */
  const listening = () => listeners.size;

  return { state, calls, core, redeem, redeliver, setEvents, listening, count, statusOf };
}

export type FakeTwitch = ReturnType<typeof createFakeTwitch>;
