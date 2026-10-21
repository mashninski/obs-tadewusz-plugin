// Агульнае для тэстаў ядра: часовыя тэчкі, база і падробка Twitch у памяці.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../core/storage/database.js';

// Часовыя тэчкі выдаляюцца пры выхадзе з працэсу, калі ўсе базы ўжо закрыты (Windows не выдаляе адкрыты файл).
const dirs = [];
process.on('exit', () => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'tadewusz-test-'));
  dirs.push(dir);
  return dir;
}

export function clock(start = Date.UTC(2026, 9, 21, 12)) {
  let now = start;
  const fn = () => now;
  fn.advance = ms => { now += ms; return now; };
  return fn;
}

export function store(t, now = clock()) {
  const s = new Store(join(tempDir(), 'obs-bot.sqlite'), { now });
  t.after(() => s.close());
  return s;
}

/** Twitch у памяці: узнагароды, пакупкі і чат — з тымі ж метадамі, што ў TwitchClient. */
export function fakeTwitch({ clientId = 'client', userId = '42', login = 'streamer' } = {}) {
  const rewards = new Map(), redemptions = new Map(), chat = [], calls = [];
  let counter = 0;
  const twitch = {
    connected: true,
    identity: { userId, login },
    status: { state: 'connected', error: null },
    rewards: async () => [...rewards.values()].map(r => ({ ...r })),
    async credentials() { if (!twitch.connected) throw new Error('twitch_connect_required'); return {}; },
    account() { if (!twitch.connected) throw new Error('twitch_connect_required'); return `${clientId}:${userId}`; },
    async updateReward(id, patch) { calls.push(['PATCH', id, patch]); Object.assign(rewards.get(id), patch); return rewards.get(id); },
    async createReward(body) {
      const reward = { id: `reward-${++counter}`, is_enabled: true, is_paused: false, ...body };
      rewards.set(reward.id, reward);
      return reward;
    },
    async redemption(rewardId, id) {
      const r = redemptions.get(id);
      if (!r || r.reward.id !== rewardId) throw new Error('redemption_not_found');
      return { ...r };
    },
    async *unfulfilled(rewardId) {
      yield [...redemptions.values()].filter(r => r.reward.id === rewardId && r.status === 'UNFULFILLED').map(r => ({ ...r }));
    },
    async setRedemption(rewardId, id, status) {
      if (twitch.failNext) { const error = twitch.failNext; twitch.failNext = null; throw error; }
      const r = redemptions.get(id);
      if (r.status === status) return { ...r };
      if (r.status !== 'UNFULFILLED') throw new Error('refund_unavailable');
      r.status = status;
      return { ...r };
    },
    async chat(message) { chat.push(message); },
    /** Глядач купляе ўзнагароду. */
    redeem(rewardId, input, { cost, at = Date.now(), user = 'viewer' } = {}) {
      const reward = rewards.get(rewardId);
      const r = {
        id: `redemption-${++counter}`, user_id: `u${counter}`, user_login: user, user_name: user, user_input: input,
        status: 'UNFULFILLED', redeemed_at: new Date(at).toISOString(), reward: { id: rewardId, cost: cost ?? reward?.cost ?? 100 },
      };
      redemptions.set(r.id, r);
      return r;
    },
    rewardMap: rewards, redemptionMap: redemptions, chatLog: chat, calls,
  };
  return twitch;
}

/** EventSub, які заўсёды «злучаны». */
export function fakeEventSub(state = 'connected') {
  const stateListeners = new Set();
  return {
    state,
    onState(listener) { stateListeners.add(listener); },
    onEvent() {},
    set(next) { this.state = next; for (const l of stateListeners) l(next); },
  };
}
