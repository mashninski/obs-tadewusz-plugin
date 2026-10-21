// Twitch: уваход па кодзе (Device Code Flow, прыкладанне тыпу Public), токены і запыты да Helix.
// Адзін уваход на ўсю праграму: галасаванне, бягучы радок і музыка карыстаюцца адным токенам.
export const TWITCH_SCOPES = ['channel:manage:redemptions', 'user:write:chat'];
const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const VALIDATE_EVERY_MS = 3_600_000;

export class RemoteError extends Error {
  constructor(code, status = 0, body = null, retryMs) {
    super(code);
    this.status = status;
    this.body = body;
    this.retryMs = retryMs;
  }
}

async function send(fetchImpl, url, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new RemoteError('network_unavailable');
  }
  const text = await response.text().catch(() => '');
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: response.status, ok: response.ok, body, headers: response.headers };
}

function failure(result) {
  if (result.body?.message === 'authorization_pending') return new RemoteError('authorization_pending', result.status);
  if (result.body?.message === 'slow_down') return new RemoteError('slow_down', result.status);
  const reset = Number(result.headers?.get?.('ratelimit-reset')) * 1000 - Date.now();
  return new RemoteError(`remote_${result.status}`, result.status, result.body, result.status === 429 ? Math.max(1000, Math.min(60_000, reset || 30_000)) : undefined);
}

export class TwitchClient {
  constructor({ vault, settings, fetchImpl = fetch, log = () => {}, now = Date.now }) {
    Object.assign(this, { vault, settings, fetch: fetchImpl, log, now });
    this.tokens = null;
    this.identity = null;
    this.validatedAt = 0;
    this.flow = null;
    this.refreshing = null;
    this.loaded = false;
    this.status = { state: 'disconnected', error: null };
    this.listeners = new Set();
  }

  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  setStatus(state, error = null) {
    const changed = state !== this.status.state || error !== this.status.error;
    this.status = { state, error };
    if (changed) for (const listener of this.listeners) listener(this.status);
  }

  clientId() { return this.settings().twitch.clientId; }

  account() {
    if (!this.identity) throw new Error('twitch_connect_required');
    return `${this.clientId()}:${this.identity.userId}`;
  }

  get connected() { return this.status.state === 'connected' && !!this.identity; }

  async token(params, endpoint = 'token') {
    const result = await send(this.fetch, `${ID}/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
    });
    if (!result.ok) throw failure(result);
    return result.body;
  }

  // --- Уваход ---

  async startLogin() {
    const clientId = this.clientId();
    if (!clientId) throw new Error('client_id_required');
    const data = await this.token({ client_id: clientId, scopes: TWITCH_SCOPES.join(' ') }, 'device');
    if (!data?.device_code || !data.user_code || !data.verification_uri) throw new Error('oauth_format');
    if (new URL(data.verification_uri).hostname !== 'www.twitch.tv') throw new Error('oauth_url');
    const interval = Math.max(5, data.interval ?? 5) * 1000;
    this.flow = { code: data.device_code, clientId, interval, next: this.now() + interval, expires: this.now() + (data.expires_in ?? 1800) * 1000 };
    return { uri: data.verification_uri, code: data.user_code };
  }

  async pollLogin() {
    const flow = this.flow;
    if (!flow || flow.expires <= this.now() || flow.clientId !== this.clientId()) { this.flow = null; throw new Error('oauth_expired'); }
    if (this.now() < flow.next) return { pending: true };
    flow.next = this.now() + flow.interval;
    let tokens;
    try {
      tokens = await this.token({ client_id: flow.clientId, device_code: flow.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    } catch (error) {
      if (error.message === 'authorization_pending') return { pending: true };
      if (error.message === 'slow_down') { flow.interval += 5000; return { pending: true }; }
      this.flow = null;
      throw error;
    }
    if (this.flow !== flow) throw new Error('oauth_session_changed');
    this.flow = null;
    const next = { ...tokens, clientId: flow.clientId };
    await this.validate(next.access_token);
    this.tokens = next;
    await this.vault.set('twitch', next);
    this.setStatus('connected');
    this.log('info', 'twitch.login');
    return { connected: true, login: this.identity.login };
  }

  async disconnect() {
    this.flow = null;
    this.tokens = null;
    this.identity = null;
    this.validatedAt = 0;
    await this.vault.set('twitch', null);
    this.setStatus('disconnected');
  }

  // --- Токены ---

  async validate(accessToken) {
    const result = await send(this.fetch, `${ID}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
    if (!result.ok) throw failure(result);
    const v = result.body;
    if (v?.client_id !== this.clientId() || !v.user_id || TWITCH_SCOPES.some(s => !v.scopes?.includes(s))) throw new Error('oauth_identity');
    this.identity = { userId: v.user_id, login: v.login };
    this.validatedAt = this.now();
    return this.identity;
  }

  /** Захаваныя токены з'яўляюцца ў памяці адзін раз; праверка — раз на гадзіну (патрабаванне Twitch). */
  async credentials() {
    if (!this.loaded) {
      let stored;
      try { stored = await this.vault.get('twitch'); } catch (error) { this.setStatus('error', error.message); throw error; }
      this.loaded = true;
      this.tokens = stored?.clientId === this.clientId() ? stored : null;
    }
    if (!this.tokens || this.tokens.clientId !== this.clientId()) {
      this.identity = null;
      this.setStatus('disconnected');
      throw new Error('twitch_connect_required');
    }
    if (!this.identity || this.now() - this.validatedAt >= VALIDATE_EVERY_MS) {
      try {
        await this.validate(this.tokens.access_token);
      } catch (error) {
        if (error.message !== 'remote_401') { this.setStatus('error', error.message); throw error; }
        await this.refresh(this.tokens.access_token);
      }
    }
    this.setStatus('connected');
    return this.tokens;
  }

  /**
   * Refresh token у Public-прыкладання аднаразовы: новыя токены адразу становяцца бягучымі ў памяці,
   * а захаванне на дыск ідзе з паўторамі — збой дыска не губляе ўваход у працуючай праграме.
   */
  refresh(rejectedAccessToken) {
    if (this.tokens && rejectedAccessToken && this.tokens.access_token !== rejectedAccessToken) return Promise.resolve(this.tokens);
    return this.refreshing ??= (async () => {
      const current = this.tokens;
      let fresh;
      try {
        fresh = await this.token({ client_id: current.clientId, grant_type: 'refresh_token', refresh_token: current.refresh_token });
      } catch (error) {
        if (['remote_400', 'remote_401'].includes(error.message)) {
          this.log('warn', 'twitch.refresh_rejected');
          this.tokens = null;
          this.identity = null;
          await this.vault.set('twitch', null).catch(() => {});
          this.setStatus('disconnected', 'login_expired');
          throw new Error('twitch_connect_required');
        }
        this.setStatus('error', error.message);
        throw error;
      }
      if (!fresh?.access_token || !fresh.refresh_token) throw new Error('oauth_format');
      this.tokens = { ...fresh, clientId: current.clientId };
      this.vault.set('twitch', this.tokens).catch(() => this.log('error', 'twitch.token_not_saved'));
      await this.validate(this.tokens.access_token);
      this.log('info', 'twitch.refreshed');
      return this.tokens;
    })().finally(() => { this.refreshing = null; });
  }

  /** Запыт да Helix без выключэнняў на HTTP-памылкі (для музыкі). 401 — адно абнаўленне токена і паўтор. */
  async raw(method, path, body) {
    const request = tokens => send(this.fetch, `${HELIX}/${path}`, {
      method,
      headers: { 'Client-Id': tokens.clientId, Authorization: `Bearer ${tokens.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const tokens = await this.credentials();
    let result = await request(tokens);
    if (result.status === 401) result = await request(await this.refresh(tokens.access_token));
    return result;
  }

  /** Запыт да Helix: вяртае JSON або кідае `remote_<код>`. */
  async api(path, { query = {}, method = 'GET', body } = {}) {
    const search = new URLSearchParams(query).toString();
    const result = await this.raw(method, search ? `${path}?${search}` : path, body);
    if (!result.ok) throw failure(result);
    return result.body;
  }

  // --- Узнагароды і пакупкі ---

  async rewards() {
    const data = await this.api('channel_points/custom_rewards', { query: { broadcaster_id: this.identity.userId, only_manageable_rewards: 'true' } });
    return data?.data ?? [];
  }

  async updateReward(id, patch) {
    const data = await this.api('channel_points/custom_rewards', { method: 'PATCH', query: { broadcaster_id: this.identity.userId, id }, body: patch });
    return data?.data?.[0];
  }

  async createReward(body) {
    const data = await this.api('channel_points/custom_rewards', { method: 'POST', query: { broadcaster_id: this.identity.userId }, body });
    const reward = data?.data?.[0];
    if (!reward?.id) throw new Error('reward_state');
    return reward;
  }

  async redemption(rewardId, id) {
    const data = await this.api('channel_points/custom_rewards/redemptions', { query: { broadcaster_id: this.identity.userId, reward_id: rewardId, id } });
    if (data?.data?.length !== 1) throw new Error('redemption_not_found');
    return data.data[0];
  }

  async *unfulfilled(rewardId) {
    let cursor = '';
    for (let page = 0; page < 200; page++) {
      const data = await this.api('channel_points/custom_rewards/redemptions', {
        query: { broadcaster_id: this.identity.userId, reward_id: rewardId, status: 'UNFULFILLED', first: '50', ...(cursor ? { after: cursor } : {}) },
      });
      if (!Array.isArray(data?.data)) throw new Error('remote_format');
      yield data.data;
      cursor = data.pagination?.cursor ?? '';
      if (!cursor) return;
    }
  }

  /** Ідэмпатэнтна: калі Twitch ужо мае патрэбны статус, нічога не мяняецца. */
  async setRedemption(rewardId, id, status) {
    const current = await this.redemption(rewardId, id);
    if (current.status === status) return current;
    if (current.status !== 'UNFULFILLED') throw new Error('refund_unavailable');
    const data = await this.api('channel_points/custom_rewards/redemptions', {
      method: 'PATCH', query: { broadcaster_id: this.identity.userId, reward_id: rewardId, id }, body: { status },
    });
    if (data?.data?.[0]?.status !== status) throw new Error('refund_unconfirmed');
    return data.data[0];
  }

  async chat(message) {
    const id = this.identity.userId;
    const data = await this.api('chat/messages', { method: 'POST', body: { broadcaster_id: id, sender_id: id, message } });
    if (data?.data?.[0]?.is_sent !== true) throw new Error('chat_not_sent');
  }
}
