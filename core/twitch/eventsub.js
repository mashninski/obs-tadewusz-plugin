// Адно злучэнне EventSub WebSocket на ўсю праграму.
// Падпіскі — на ўсе ўзнагароды канала; падзеі раздаюцца атрымальнікам па ID узнагароды.
// Пакупкі, зробленыя падчас разрыву, не губляюцца: яны застаюцца UNFULFILLED і даганяюцца зверкай пасля злучэння.
const URL_DEFAULT = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';
export const SUBSCRIPTIONS = [
  'channel.channel_points_custom_reward_redemption.add',
  'channel.channel_points_custom_reward_redemption.update',
  'channel.channel_points_custom_reward.update',
  'channel.channel_points_custom_reward.remove',
];
/** Рэйд з нашага канала (факт рэйду для дока). Правоў не патрабуе; калі падпіска не ўдалася, астатняе працуе. */
export const RAID_SUBSCRIPTION = 'channel.raid';

export class EventSub {
  constructor({ twitch, Socket = globalThis.WebSocket, log = () => {}, url = URL_DEFAULT, schedule = setTimeout, unschedule = clearTimeout }) {
    Object.assign(this, { twitch, Socket, log, url, schedule, unschedule });
    this.state = 'off';
    this.socket = null;
    this.replacement = null;
    this.attempt = 0;
    this.running = false;
    this.seen = new Set();
    this.eventListeners = new Set();
    this.stateListeners = new Set();
  }

  onEvent(listener) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  onState(listener) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect(this.url, null);
  }

  stop() {
    this.running = false;
    this.unschedule(this.retry);
    for (const socket of [this.socket, this.replacement]) socket?.close();
    this.socket = this.replacement = null;
    this.setState('off');
  }

  connect(url, previous) {
    const socket = new this.Socket(url);
    if (previous) this.replacement = socket; else this.socket = socket;
    if (!previous) this.setState('connecting');
    let watchdog, timeoutMs = 40_000;
    const arm = () => { this.unschedule(watchdog); watchdog = this.schedule(() => socket.close(), timeoutMs); watchdog?.unref?.(); };
    const current = () => socket === this.socket || socket === this.replacement;
    arm();
    socket.addEventListener('message', message => {
      if (!current()) return;
      arm();
      let packet;
      try { packet = JSON.parse(String(message.data)); } catch { return; }
      const id = packet.metadata?.message_id, type = packet.metadata?.message_type;
      if (id) {
        if (this.seen.has(id)) return;
        this.seen.add(id);
        if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
      }
      if (type === 'session_welcome') {
        timeoutMs = (packet.payload.session.keepalive_timeout_seconds + 10) * 1000;
        arm();
        if (socket === this.replacement) {
          // Twitch пераносіць падпіскі на новае злучэнне сам.
          this.socket?.close();
          this.socket = socket;
          this.replacement = null;
          this.log('info', 'eventsub.reconnected');
        } else {
          void this.subscribe(packet.payload.session.id, socket);
        }
      } else if (type === 'notification') {
        const subscription = packet.payload?.subscription;
        const me = this.twitch.identity?.userId;
        const condition = subscription?.condition ?? {};
        if (condition.broadcaster_user_id !== me && condition.from_broadcaster_user_id !== me) return;
        for (const listener of this.eventListeners) listener(subscription.type, packet.payload.event, id);
      } else if (type === 'session_reconnect') {
        if (!this.replacement) this.connect(packet.payload.session.reconnect_url, socket);
      } else if (type === 'revocation') {
        this.log('warn', 'eventsub.revoked', packet.payload?.subscription?.status ?? '');
        socket.close();
      }
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', () => {
      this.unschedule(watchdog);
      if (socket === this.replacement) { this.replacement = null; return; }
      if (socket !== this.socket) return;
      this.socket = null;
      if (!this.running) return;
      this.setState('disconnected');
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
      this.log('warn', 'eventsub.disconnected');
      this.retry = this.schedule(() => { if (this.running && !this.socket) this.connect(this.url, null); }, delay);
      this.retry?.unref?.();
    });
    return socket;
  }

  async subscribe(sessionId, socket) {
    try {
      await this.twitch.credentials();
      for (const type of SUBSCRIPTIONS) {
        if (socket !== this.socket) return;
        await this.twitch.api('eventsub/subscriptions', {
          method: 'POST',
          body: { type, version: '1', condition: { broadcaster_user_id: this.twitch.identity.userId }, transport: { method: 'websocket', session_id: sessionId } },
        }).catch(error => { if (error.message !== 'remote_409') throw error; });
      }
      if (socket !== this.socket) return;
      await this.twitch.api('eventsub/subscriptions', {
        method: 'POST',
        body: { type: RAID_SUBSCRIPTION, version: '1', condition: { from_broadcaster_user_id: this.twitch.identity.userId }, transport: { method: 'websocket', session_id: sessionId } },
      }).catch(error => { if (error.message !== 'remote_409') this.log('warn', 'eventsub.raid_subscribe_failed', error.message); });
      if (socket !== this.socket) return;
      this.attempt = 0;
      this.setState('connected');
      this.log('info', 'eventsub.connected');
    } catch (error) {
      this.log('warn', 'eventsub.subscribe_failed', error.message);
      socket.close();
    }
  }
}
