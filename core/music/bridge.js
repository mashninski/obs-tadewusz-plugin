// Мост для музыкі (Spotify і YouTube працуюць у браўзеры OBS).
// Музыка не мае ўласнага ўваходу ў Twitch: запыты да Helix ідуць праз ядро з агульным токенам,
// а падзеі ўзнагарод — з агульнага злучэння EventSub. Узнагародамі галасавання і бягучага радка музыка кіраваць не можа.
const ALLOWED = [
  { path: 'channel_points/custom_rewards', methods: ['GET', 'POST', 'PATCH', 'DELETE'], guard: 'id' },
  { path: 'channel_points/custom_rewards/redemptions', methods: ['GET', 'PATCH'], guard: 'reward_id' },
  { path: 'chat/messages', methods: ['POST'] },
];

export class MusicBridge {
  constructor({ twitch, eventsub, ownedRewardIds, obsSettings, log = () => {} }) {
    Object.assign(this, { twitch, eventsub, ownedRewardIds, obsSettings, log });
    this.clients = new Set();
    eventsub.onEvent((type, event) => {
      if (!type.startsWith('channel.channel_points_custom_reward')) return;
      const rewardId = event.reward?.id ?? event.id;
      if (this.ownedRewardIds().includes(rewardId)) return;
      this.broadcast({ type, event });
    });
    eventsub.onState(state => this.broadcast({ type: 'status', connected: state === 'connected' }));
  }

  identity() {
    const tokens = this.twitch.tokens, identity = this.twitch.identity;
    if (!this.twitch.connected || !tokens) return { connected: false };
    return { connected: true, login: identity.login, userId: identity.userId, clientId: tokens.clientId, scopes: tokens.scope ?? [] };
  }

  /** Запыт да Helix ад імя музыкі; вяртае `{status, body}` як ёсць. */
  async helix({ method, path, body }) {
    const url = new URL(String(path ?? '').replace(/^\/+/, ''), 'https://api.twitch.tv/helix/');
    const route = url.pathname.replace(/^\/helix\//, '');
    const rule = ALLOWED.find(r => r.path === route);
    if (!rule || !rule.methods.includes(method)) throw new Error('music_route');
    // Змяняць узнагароду (і чытаць пакупкі) можна толькі для ўзнагарод, якія не належаць ядру.
    const guarded = rule.guard === 'reward_id' || (rule.guard === 'id' && method !== 'GET');
    if (guarded && url.searchParams.getAll(rule.guard).some(id => this.ownedRewardIds().includes(id))) throw new Error('music_reward_owned');
    if (method === 'POST' && route === 'chat/messages' && (typeof body?.message !== 'string' || body.message.length > 500)) throw new Error('chat_message');
    const result = await this.twitch.raw(method, `${route}${url.search}`, body);
    return { status: result.status, body: result.body };
  }

  async obs() {
    return this.obsSettings();
  }

  /** Server-Sent Events: падзеі ўзнагарод музыкі і стан злучэння. */
  attach(response) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    response.write(`data: ${JSON.stringify({ type: 'status', connected: this.eventsub.state === 'connected' })}\n\n`);
    this.clients.add(response);
    const keepalive = setInterval(() => response.write(': keepalive\n\n'), 15_000);
    response.on('close', () => { clearInterval(keepalive); this.clients.delete(response); });
  }

  broadcast(message) {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of this.clients) client.write(data);
  }

  close() {
    for (const client of this.clients) client.end();
    this.clients.clear();
  }
}
