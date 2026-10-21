// Пераезд музыкі з асобнага прыкладання: старыя ўзнагароды музыкі створаны іншым Twitch Client ID,
// і змяніць або выдаліць іх можа толькі тое прыкладанне. Аднаразовы ўваход пад старым Client ID
// вяртае балы за незавершаныя замовы і выдаляе гэтыя ўзнагароды; токен нідзе не захоўваецца.
const ID = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const SCOPES = 'channel:manage:redemptions';

export class LegacyMusicRewards {
  constructor({ store, fetchImpl = fetch, log = () => {}, now = Date.now }) {
    Object.assign(this, { store, fetch: fetchImpl, log, now });
    this.flow = null;
  }

  clientId() { return this.store.get('music.legacyClientId', null); }

  async request(url, options = {}) {
    let response;
    try { response = await this.fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new Error('network_unavailable'); }
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(body?.message === 'authorization_pending' ? 'authorization_pending' : `remote_${response.status}`), { body });
    return body;
  }

  async start() {
    const clientId = this.clientId();
    if (!clientId) throw new Error('legacy_none');
    const data = await this.request(`${ID}/device`, { method: 'POST', body: new URLSearchParams({ client_id: clientId, scopes: SCOPES }) });
    this.flow = { clientId, code: data.device_code, next: 0, interval: Math.max(5, data.interval ?? 5) * 1000, expires: this.now() + data.expires_in * 1000 };
    return { uri: data.verification_uri, code: data.user_code };
  }

  async poll() {
    const flow = this.flow;
    if (!flow || flow.expires <= this.now()) { this.flow = null; throw new Error('oauth_expired'); }
    if (this.now() < flow.next) return { pending: true };
    flow.next = this.now() + flow.interval;
    let tokens;
    try {
      tokens = await this.request(`${ID}/token`, { method: 'POST', body: new URLSearchParams({
        client_id: flow.clientId, device_code: flow.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    } catch (error) {
      if (error.message === 'authorization_pending' || error.body?.message === 'slow_down') return { pending: true };
      this.flow = null;
      throw error;
    }
    this.flow = null;
    const removed = await this.remove(flow.clientId, tokens.access_token);
    this.store.transaction(() => this.store.set('music.legacyClientId', null));
    this.log('info', 'music.legacy_rewards_removed', String(removed));
    return { removed };
  }

  /** Вярнуць балы за незавершаныя замовы і выдаліць усе ўзнагароды, створаныя старым прыкладаннем. */
  async remove(clientId, accessToken) {
    const headers = { 'Client-Id': clientId, Authorization: `Bearer ${accessToken}` };
    const { user_id: broadcaster } = await this.request(`${ID}/validate`, { headers: { Authorization: `OAuth ${accessToken}` } });
    const helix = (method, path, body) => this.request(`${HELIX}/${path}`, {
      method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const rewards = (await helix('GET', `channel_points/custom_rewards?broadcaster_id=${broadcaster}&only_manageable_rewards=true`))?.data ?? [];
    for (const reward of rewards) {
      for (;;) {
        const pending = (await helix('GET', `channel_points/custom_rewards/redemptions?broadcaster_id=${broadcaster}&reward_id=${reward.id}&status=UNFULFILLED&first=50`))?.data ?? [];
        if (!pending.length) break;
        const ids = pending.map(r => `id=${r.id}`).join('&');
        await helix('PATCH', `channel_points/custom_rewards/redemptions?broadcaster_id=${broadcaster}&reward_id=${reward.id}&${ids}`, { status: 'CANCELED' });
      }
      await helix('DELETE', `channel_points/custom_rewards?broadcaster_id=${broadcaster}&id=${reward.id}`);
    }
    return rewards.length;
  }
}
