// Прыём платных паведамленняў для бягучага радка.
// Узнагарода адкрытая толькі тады, калі ёсць злучэнне і старонка радка бачная ў эфіры OBS:
// глядач не плаціць за паведамленне, якое ніхто не пакажа. Калі ўключаны голас — яшчэ і толькі пры загружанай мадэлі OmniVoice:
// глядач не плаціць за голас, якога не будзе.
import { errorCode } from '../util/log.js';

/** Свой колер фону ўзнагароды: гледачы адразу адрозніваюць яе ад узнагарод галасавання і музыкі. */
export const TICKER_REWARD_COLOR = '#4A1F3D';

const RECONCILE_EVERY_MS = 300_000;
const BLOCKING = ['remote_400', 'remote_401', 'remote_403', 'remote_404', 'refund_unavailable', 'redemption_not_found'];

export class TickerReception {
  constructor({ store, ticker, twitch, eventsub, bindings, log = () => {}, now = Date.now, voice = null }) {
    Object.assign(this, { store, ticker, twitch, eventsub, bindings, log, now, voice });
    this.applied = null;
    this.reconciledAt = 0;
    this.reconcileNeeded = true;
    this.error = null;
    this.retryAt = 0;
    eventsub.onState(state => { if (state === 'connected') this.reconcileNeeded = true; else this.applied = null; });
  }

  wanted() { return this.store.get('reception', { voting: false, ticker: false }).ticker; }

  setWanted(value) {
    this.store.transaction(() => this.store.set('reception', { ...this.store.get('reception', { voting: false, ticker: false }), ticker: !!value }));
  }

  account() { try { return this.twitch.account(); } catch { return null; } }
  rewardId() { const account = this.account(); return account ? this.bindings.get(account).ticker ?? null : null; }

  accepting() {
    return this.wanted() && !!this.rewardId() && this.twitch.connected && this.eventsub.state === 'connected' && !this.reconcileNeeded
      && this.ticker.ready() && !this.ticker.waiting() && this.ticker.pending() < 1000 && (!this.voice?.wanted() || this.voice.available());
  }

  // Вокны, калі ўзнагарода была адкрытая: пакупка па-за імі (напрыклад, позняя дастаўка) вяртаецца.
  windowsKey() { return `ticker.windows:${this.account()}`; }
  windows() { return this.store.get(this.windowsKey(), []); }

  openWindow() {
    const windows = this.windows();
    if (windows.at(-1)?.end === null) return;
    windows.push({ start: this.now(), end: null });
    this.store.transaction(() => this.store.set(this.windowsKey(), windows.slice(-200)));
  }

  closeWindow() {
    if (!this.account()) return;
    const windows = this.windows();
    if (windows.at(-1)?.end !== null) return;
    windows.at(-1).end = this.now();
    this.store.transaction(() => this.store.set(this.windowsKey(), windows));
  }

  async syncReward() {
    await this.twitch.credentials();
    const account = this.twitch.account(), c = this.ticker.config(), remote = await this.twitch.rewards();
    const body = { title: c.title, prompt: c.prompt, cost: c.cost, background_color: TICKER_REWARD_COLOR, is_user_input_required: true, should_redemptions_skip_request_queue: false };
    const existing = remote.find(r => r.id === this.rewardId());
    if (existing) {
      await this.twitch.updateReward(existing.id, body);
    } else {
      if (remote.some(r => r.title === c.title)) throw new Error('reward_title_taken');
      const reward = await this.twitch.createReward({ ...body, is_enabled: false });
      this.store.transaction(() => this.bindings.set(account, 'ticker', reward.id));
    }
    this.applied = null;
  }

  async applyRewardState() {
    const enabled = this.accepting(), id = this.rewardId();
    if (!enabled) this.closeWindow();
    if (this.applied === enabled || !id || !this.twitch.connected) return;
    if (enabled) this.openWindow();
    await this.twitch.updateReward(id, enabled ? { is_enabled: true, is_paused: false } : { is_enabled: false, is_paused: true });
    this.applied = enabled;
  }

  async shutdown() {
    this.closeWindow();
    const id = this.rewardId();
    if (!id || !this.twitch.connected) return;
    try { await this.twitch.updateReward(id, { is_enabled: false, is_paused: true }); this.applied = false; }
    catch (error) { this.log('warn', 'ticker.shutdown_pause', errorCode(error)); }
  }

  receive(event, messageId) {
    const at = Date.parse(event.redeemed_at), admitted = this.windows().some(w => at >= w.start && (w.end === null || at <= w.end));
    return this.ticker.ingest(event, messageId, { account: this.twitch.account(), reward: this.rewardId(), admitted });
  }

  async onEvent(type, event, messageId) {
    if (!type.startsWith('channel.channel_points_custom_reward_redemption.') || !event.reward?.id || event.reward.id !== this.rewardId()) return false;
    this.receive(event, messageId);
    await this.drain();
    return true;
  }

  async reconcile() {
    const id = this.rewardId(), account = this.account();
    if (!id) { this.reconcileNeeded = false; return; }
    for await (const page of this.twitch.unfulfilled(id))
      for (const event of page) this.receive(event, `ticker:reconcile:${account}:${event.id}:${event.status}`);
    for (const row of this.store.db.prepare("SELECT * FROM ticker_purchases WHERE account=? AND status='UNFULFILLED'").all(account)) {
      try {
        const event = await this.twitch.redemption(row.reward, row.redemption);
        this.receive(event, `ticker:status:${row.id}:${event.status}`);
      } catch (error) { if (error.message !== 'redemption_not_found') throw error; }
    }
    this.reconciledAt = this.now();
    this.reconcileNeeded = false;
  }

  async drain() {
    const account = this.account();
    if (!account) return;
    const rows = this.store.db.prepare(`SELECT o.*,p.reward,p.redemption FROM ticker_outbox o JOIN ticker_purchases p ON p.id=o.purchase
      WHERE p.account=? AND o.state='pending' AND o.next<=? ORDER BY o.rowid LIMIT 50`).all(account, this.now());
    for (const row of rows) {
      try {
        const result = await this.twitch.setRedemption(row.reward, row.redemption, row.target);
        this.store.transaction(() => {
          this.store.db.prepare('UPDATE ticker_purchases SET status=? WHERE id=?').run(result.status, row.purchase);
          this.store.db.prepare("UPDATE ticker_outbox SET state='done',error=NULL WHERE id=?").run(row.id);
        });
      } catch (error) {
        const code = errorCode(error), blocked = BLOCKING.includes(code);
        this.store.db.prepare('UPDATE ticker_outbox SET state=?,attempts=attempts+1,next=?,error=? WHERE id=?')
          .run(blocked ? 'blocked' : 'pending', this.now() + (error.retryMs ?? Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8))), code, row.id);
        this.log('warn', 'ticker.outbox', code);
        if (!blocked) return;
      }
    }
  }

  unblockAccess() {
    this.store.db.prepare("UPDATE ticker_outbox SET state='pending',next=0 WHERE state='blocked' AND error IN ('remote_401','remote_403')").run();
  }

  snapshot() {
    return { wanted: this.wanted(), accepting: this.accepting(), enabled: this.applied, reward: this.rewardId(), error: this.error };
  }

  async tick() {
    if (!this.twitch.connected || this.eventsub.state !== 'connected') { this.closeWindow(); return; }
    if (this.now() < this.retryAt) return;
    try {
      if (this.rewardId() && (this.reconcileNeeded || this.now() - this.reconciledAt >= RECONCILE_EVERY_MS)) await this.reconcile();
      await this.applyRewardState();
      await this.drain();
      this.error = null;
    } catch (error) {
      this.error = errorCode(error);
      this.applied = null;
      this.retryAt = this.now() + Math.max(5000, error.retryMs ?? 0);
      this.log('warn', 'ticker.reception', this.error);
    }
  }
}
