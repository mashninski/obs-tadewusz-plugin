// Приём пакупак галасавання з Twitch.
// • Узнагароды ўключаны, толькі калі прыём уключаны, раўнд адкрыты, ёсць злучэнне і прайшла зверка.
// • Кароткі разрыў сувязі не выключае ўзнагароды: пакупкі застаюцца UNFULFILLED і даганяюцца зверкай.
// • Статус у Twitch (FULFILLED/CANCELED) ставіцца з outbox пасля таго, як рашэнне ўжо запісана ў базу.
import { purchaseReply, renderReply } from '../chat/templates.js';
import { errorCode } from '../util/log.js';

const RECONCILE_EVERY_MS = 300_000;
const BLOCKING = ['remote_400', 'remote_401', 'remote_403', 'remote_404', 'refund_unavailable', 'redemption_not_found'];

export const ADD_TITLE = 'Дадаць гульню ў спіс';
export const ADD_PROMPT = 'Увядзіце назву гульні або спасылку Steam';
export const SUPPORT_PROMPT = 'Увядзіце трохлітарны код гульні са спіса на экране (напрыклад, ABC)';
export const supportTitle = cost => `${cost} на гульню са спіса`;

export class Bindings {
  constructor(store) { this.store = store; }
  all() { return this.store.get('twitch.rewardBindings', {}); }
  get(account) { return this.all()[account] ?? {}; }
  set(account, role, id) {
    const all = this.all();
    all[account] = { ...all[account] };
    if (id) all[account][role] = id; else delete all[account][role];
    this.store.set('twitch.rewardBindings', all);
  }
  /** Усе ID узнагарод, якімі кіруе ядро (галасаванне і бягучы радок). */
  ids(account) { return Object.values(this.get(account)); }
}

export class VotingReception {
  constructor({ store, voting, twitch, eventsub, settings, bindings, prepare = () => ({}), log = () => {}, now = Date.now,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { store, voting, twitch, eventsub, settings, bindings, prepare, log, now, wait });
    this.reconciledAt = 0;
    this.applied = null; // апошні вядомы стан узнагарод у Twitch: true/false/null (невядомы)
    this.error = null;
    this.retryAt = 0;
    this.reconcileNeeded = true;
    eventsub.onState(state => { if (state === 'connected') this.reconcileNeeded = true; else this.applied = null; });
    // Пасля збою прыкладання тэкст адказу мог ужо пайсці ў чат: не паўтараем, каб не задвоіць.
    store.db.prepare("UPDATE outbox SET status='uncertain',error='chat_delivery_unknown' WHERE kind='chat' AND status='dispatching'").run();
  }

  wanted() { return this.store.get('reception', { voting: false, ticker: false }).voting; }

  setWanted(value) {
    this.store.transaction(() => this.store.set('reception', { ...this.store.get('reception', { voting: false, ticker: false }), voting: !!value }));
  }

  account() { try { return this.twitch.account(); } catch { return null; } }

  /** Ролі ўзнагарод па наладах: add і support_0…N (па парадку цэн). */
  roles() {
    return ['add', ...this.settings().twitch.supportCosts.map((_, i) => `support_${i}`)];
  }

  rewardIds() {
    const account = this.account();
    if (!account) return [];
    const bindings = this.bindings.get(account);
    return this.roles().map(role => bindings[role]).filter(Boolean);
  }

  roleOf(rewardId) {
    const account = this.account();
    if (!account) return null;
    for (const [role, id] of Object.entries(this.bindings.get(account))) {
      if (id !== rewardId) continue;
      return role === 'add' ? 'add' : /^support_\d+$/.test(role) ? 'support' : null;
    }
    return null;
  }

  ready() {
    return this.twitch.connected && this.eventsub.state === 'connected' && !this.reconcileNeeded && this.rewardIds().length === this.roles().length;
  }

  accepting() {
    return this.wanted() && this.voting.current().status === 'open' && this.ready();
  }

  snapshot() {
    return {
      wanted: this.wanted(), accepting: this.accepting(), rewards: this.rewardIds().length, expectedRewards: this.roles().length,
      enabled: this.applied, error: this.error, reconciledAt: this.reconciledAt || null,
      outbox: this.store.db.prepare("SELECT kind,status,error,count(*) AS count FROM outbox WHERE kind IN ('cancel','fulfill','chat') AND status!='done' GROUP BY kind,status,error").all(),
    };
  }

  // --- Узнагароды ---

  /** Стварыць адсутныя ўзнагароды і выправіць кошты. Назвы і падказкі, змененыя стрымерам, не чапаем. */
  async syncRewards() {
    await this.twitch.credentials();
    const account = this.twitch.account(), remote = await this.twitch.rewards(), costs = this.settings().twitch;
    const bindings = this.bindings.get(account);
    for (const role of this.roles()) {
      const cost = role === 'add' ? costs.addCost : costs.supportCosts[Number(role.slice(8))];
      const existing = remote.find(r => r.id === bindings[role]);
      if (existing) {
        if (existing.cost !== cost || existing.is_user_input_required !== true || existing.should_redemptions_skip_request_queue !== false)
          await this.twitch.updateReward(existing.id, { cost, is_user_input_required: true, should_redemptions_skip_request_queue: false });
        continue;
      }
      const title = role === 'add' ? ADD_TITLE : supportTitle(cost);
      if (remote.some(r => r.title === title)) throw new Error('reward_title_taken');
      const reward = await this.twitch.createReward({
        title, cost, prompt: role === 'add' ? ADD_PROMPT : SUPPORT_PROMPT, is_enabled: false,
        is_user_input_required: true, should_redemptions_skip_request_queue: false,
      });
      this.store.transaction(() => this.bindings.set(account, role, reward.id));
      this.log('info', 'voting.reward_created');
    }
    // Узнагароды цэн, якіх больш няма ў наладах: выключыць і забыць, калі па іх нічога не чакае.
    for (const [role, id] of Object.entries(bindings)) {
      if (!/^support_\d+$/.test(role) || this.roles().includes(role)) continue;
      if (this.store.db.prepare("SELECT 1 FROM purchases WHERE account=? AND reward=? AND status='UNFULFILLED'").get(account, id)) continue;
      if (remote.some(r => r.id === id)) await this.twitch.updateReward(id, { is_enabled: false, is_paused: true });
      this.store.transaction(() => this.bindings.set(account, role, null));
    }
    this.applied = null;
  }

  async applyRewardState(force = false) {
    const enabled = this.accepting();
    if (!force && this.applied === enabled) return;
    if (!this.twitch.connected) return;
    for (const id of this.rewardIds()) await this.twitch.updateReward(id, enabled ? { is_enabled: true, is_paused: false } : { is_enabled: false, is_paused: true });
    this.applied = enabled;
    this.log('info', enabled ? 'voting.rewards_enabled' : 'voting.rewards_disabled');
  }

  /** Пры спыненні праграмы: узнагароды схаваць, каб гледачы не плацілі, пакуль бот не працуе. */
  async shutdown() {
    if (!this.twitch.connected || !this.rewardIds().length) return;
    try {
      for (const id of this.rewardIds()) await this.twitch.updateReward(id, { is_enabled: false, is_paused: true });
      this.applied = false;
    } catch (error) {
      this.log('warn', 'voting.shutdown_pause', errorCode(error));
    }
  }

  // --- Пакупкі ---

  handles(rewardId) { return this.roleOf(rewardId) !== null; }

  async ingest(event, messageId) {
    const role = this.roleOf(event.reward?.id);
    if (!role) return null;
    const ahead = Date.parse(event.redeemed_at) - this.now();
    if (ahead > 1000 && ahead <= 10_000) await this.wait(ahead);
    let prepared;
    try { prepared = this.prepare(event, role); } catch (error) { prepared = { rejectReason: errorCode(error) }; }
    const result = this.voting.receive(event, { account: this.twitch.account(), role, messageId, delivery: this.now(), ...prepared });
    if (!result.duplicate) this.queueReply(event, result);
    return result;
  }

  queueReply(event, result) {
    const replies = this.settings().replies;
    if (!replies.enabled) return;
    const entry = this.voting.entries().find(e => e.id === result.entryId);
    const steamId = this.settings().steam.steamId;
    const message = purchaseReply(event, result, { entry, replies, profileUrl: steamId ? `https://steamcommunity.com/profiles/${steamId}` : '' });
    if (!message) return;
    this.store.db.prepare('INSERT OR IGNORE INTO outbox(id,kind,payload,status) VALUES (?,?,?,?)')
      .run(`chat:${this.twitch.account()}:${event.id}`, 'chat', JSON.stringify({ account: this.twitch.account(), message }), 'pending');
  }

  /** Падзея EventSub. */
  async onEvent(type, event, messageId) {
    if (!type.startsWith('channel.channel_points_custom_reward_redemption.') || !this.handles(event.reward?.id)) return false;
    await this.ingest(event, messageId);
    await this.drain();
    return true;
  }

  /** Дагнаць пакупкі, зробленыя без сувязі, і змены статусаў, зробленыя ўручную ў Twitch. */
  async reconcile() {
    await this.twitch.credentials();
    const account = this.twitch.account();
    for (const rewardId of this.rewardIds()) {
      for await (const page of this.twitch.unfulfilled(rewardId)) {
        for (const event of page) {
          try { await this.ingest(event, `reconcile:${account}:${event.id}:${event.status}`); }
          catch (error) { this.log('warn', 'voting.reconcile_item', errorCode(error)); }
        }
      }
    }
    for (const purchase of this.store.db.prepare("SELECT * FROM purchases WHERE account=? AND status='UNFULFILLED'").all(account)) {
      try {
        const event = await this.twitch.redemption(purchase.reward, purchase.id.slice(account.length + 1));
        if (event.status !== 'UNFULFILLED') await this.ingest(event, `status:${purchase.id}:${event.status}`);
      } catch (error) {
        if (error.message !== 'redemption_not_found') throw error;
      }
    }
    this.reconciledAt = this.now();
    this.reconcileNeeded = false;
  }

  /** Выканаць адкладзеныя статусы (FULFILLED/CANCELED) і адказы ў чат. */
  async drain() {
    const account = this.account();
    if (!account || !this.twitch.connected) return;
    const rows = this.store.db.prepare(`SELECT * FROM outbox WHERE kind IN ('cancel','fulfill','chat') AND status='pending' AND next<=?
      AND json_extract(payload,'$.account')=? ORDER BY rowid LIMIT 50`).all(this.now(), account);
    for (const row of rows) {
      const payload = JSON.parse(row.payload);
      if (row.kind === 'chat') { await this.sendChat(row, payload); continue; }
      try {
        const target = row.kind === 'fulfill' ? 'FULFILLED' : 'CANCELED';
        const result = await this.twitch.setRedemption(payload.rewardId, payload.redemptionId, target);
        this.store.transaction(() => {
          this.store.db.prepare('UPDATE purchases SET status=? WHERE id=?').run(result.status, payload.purchaseId);
          this.store.db.prepare("UPDATE outbox SET status='done',error=NULL WHERE id=?").run(row.id);
          if (row.kind === 'cancel') this.store.record('Балы вернуты гледачу (Twitch пацвердзіў)');
        });
        if (row.kind === 'cancel') this.voting.emit('refund', null, { text: 'Twitch вярнуў балы' });
      } catch (error) {
        const code = errorCode(error), blocked = BLOCKING.includes(code);
        this.store.db.prepare('UPDATE outbox SET status=?,attempts=attempts+1,next=?,error=? WHERE id=?')
          .run(blocked ? 'blocked' : 'pending', this.now() + (error.retryMs ?? Math.min(300_000, 1000 * 2 ** Math.min(row.attempts, 8))), code, row.id);
        this.log('warn', 'outbox.failed', code);
        if (!blocked) return; // сетка або ліміт — астатняе пачакае
      }
    }
  }

  async sendChat(row, payload) {
    if (!this.settings().replies.enabled) return;
    if (!this.store.db.prepare("UPDATE outbox SET status='dispatching',attempts=attempts+1 WHERE id=? AND status='pending'").run(row.id).changes) return;
    try {
      await this.twitch.chat(payload.message);
      this.store.db.prepare("UPDATE outbox SET status='done',error=NULL WHERE id=?").run(row.id);
    } catch (error) {
      const code = errorCode(error);
      const status = code === 'remote_429' ? 'pending' : code === 'network_unavailable' ? 'uncertain' : 'blocked';
      this.store.db.prepare('UPDATE outbox SET status=?,next=?,error=? WHERE id=?').run(status, this.now() + (error.retryMs ?? 30_000), code, row.id);
      this.log('warn', 'chat.delivery', code);
    }
  }

  /** Пасля новага ўваходу ў Twitch — паўтарыць аперацыі, заблакіраваныя памылкай доступу. */
  unblockAccess() {
    this.store.db.prepare("UPDATE outbox SET status='pending',next=0 WHERE status='blocked' AND error IN ('remote_401','remote_403')").run();
  }

  // --- Завяршэнне раўнда ---

  pendingStatuses() {
    return !!this.store.db.prepare("SELECT 1 FROM outbox WHERE kind IN ('cancel','fulfill') AND status='pending' LIMIT 1").get();
  }

  /**
   * Раўнд «finalizing»: спачатку ўзнагароды схаваныя, зверка і outbox, потым вынік.
   * Без падключэння Twitch (уваходу няма зусім) — вынік адразу: пакупак, якія трэба дагнаць, быць не можа.
   */
  async finalize() {
    if (this.voting.current().status !== 'finalizing') return;
    if (this.account()) {
      await this.applyRewardState();
      await this.reconcile();
      await this.drain();
      if (this.pendingStatuses()) throw new Error('finalization_outbox_pending');
    }
    const result = this.voting.close();
    const winner = result.ranked.find(e => e.id === result.winnerId);
    if (this.account() && this.settings().replies.enabled) {
      const message = renderReply(winner ? 'winner' : 'empty', winner ?? {}, this.settings().replies).slice(0, 500);
      this.store.db.prepare('INSERT OR IGNORE INTO outbox(id,kind,payload,status) VALUES (?,?,?,?)')
        .run(`winner:${this.voting.current().id}`, 'chat', JSON.stringify({ account: this.account(), message }), 'pending');
    }
    this.log('info', 'round.closed');
  }

  /** Крок цыкла праграмы (раз у секунду). */
  async tick() {
    const deadline = this.voting.deadline();
    if (deadline && this.now() >= deadline.due && ['open', 'paused'].includes(this.voting.current().status)) this.voting.beginFinalization();
    if (this.voting.current().status === 'finalizing') {
      if (this.now() < this.retryAt) return;
      try { await this.finalize(); this.error = null; }
      catch (error) { this.error = errorCode(error); this.retryAt = this.now() + Math.max(5000, error.retryMs ?? 0); }
      return;
    }
    if (!this.twitch.connected || this.eventsub.state !== 'connected' || this.now() < this.retryAt) return;
    try {
      if (this.reconcileNeeded || this.now() - this.reconciledAt >= RECONCILE_EVERY_MS) await this.reconcile();
      await this.applyRewardState();
      await this.drain();
      this.error = null;
    } catch (error) {
      this.error = errorCode(error);
      this.retryAt = this.now() + Math.max(5000, error.retryMs ?? 0);
      this.log('warn', 'voting.reception', this.error);
    }
  }
}
