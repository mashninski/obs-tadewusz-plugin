// Бягучы радок: чарга плашак (аб’явы стрымера па раскладзе, уручную і платныя паведамленні гледачоў).
// Паказ кіруе сервер; старонка ў OBS толькі паведамляе пра этапы (heartbeat/ack).
// Платнае паведамленне становіцца FULFILLED толькі пасля поўнага паказу; адхіленае або скасаванае — CANCELED.
// Калі ўключаны голас (core/voice/voice.js), платнае паведамленне атрымлівае персанажа і чакае аўдыя (audio='pending'),
// а ў эфір ідзе, калі аўдыя гатовае ('ready') або сінтэз не ўдаўся ('failed' — тады толькі тэкст).
import { createHash, randomUUID } from 'node:crypto';
import { cleanViewerText, LEGACY_TICKER_REWARD, PAID_TEXT_LIMIT, tickerDefaults, validateTicker, validateText } from '../../shared/ticker-text.js';

const CLIENT_TTL_MS = 3500;
const MAX_PENDING = 1000;

export class Ticker {
  constructor({ store, now = Date.now, log = () => {}, voice = null }) {
    Object.assign(this, { store, now, log, voice });
    this.db = store.db;
    this.clients = new Map();
    this.readiness = { source: false };
    this.fault = null;
    this.source = store.get('ticker.source', null) ?? randomUUID();
    store.transaction(() => {
      store.set('ticker.source', this.source);
      // Паказ, перапынены выключэннем, пачнецца нанова (пасля 4 няўдач — чакае ручнога паўтору).
      this.db.exec("UPDATE ticker_jobs SET state=CASE WHEN failures>=4 THEN 'waiting' ELSE 'queued' END,failures=failures+1,attempt=NULL WHERE state='showing'");
      this.db.exec("UPDATE ticker_jobs SET state='canceled' WHERE state='exiting'");
      // Пасля перапынку — адна наступная аб’ява праз інтэрвал, не пачак наверстаных.
      store.set('ticker.cycle', { ...store.get('ticker.cycle', { next: null }), due: now() + this.config().interval * 1000 });
    });
  }

  config() {
    try {
      const c = validateTicker(this.store.get('ticker.config', tickerDefaults));
      if (['Segoe UI', 'Manrope'].includes(c.font)) c.font = 'Onest';
      // Узнагарода перайменавана, калі паведамленні сталі агучвацца: старыя назва і падказка па змаўчанні замяняюцца новымі.
      if (c.title === LEGACY_TICKER_REWARD.title) c.title = tickerDefaults.title;
      if (LEGACY_TICKER_REWARD.prompts.includes(c.prompt)) c.prompt = tickerDefaults.prompt;
      return c;
    } catch {
      this.fault = 'ticker_settings';
      return structuredClone(tickerDefaults);
    }
  }

  save(input) {
    const config = validateTicker(input);
    this.commit(() => this.store.set('ticker.config', config));
    if (this.fault === 'ticker_settings') this.fault = null;
    return config;
  }

  commit(fn) {
    try {
      return this.store.transaction(fn);
    } catch (error) {
      if (!/^ticker_/.test(error.message)) { this.fault = 'ticker_storage'; this.log('error', 'ticker.storage'); }
      throw error;
    }
  }

  active() { return this.db.prepare("SELECT * FROM ticker_jobs WHERE state IN ('showing','exiting') ORDER BY seq LIMIT 1").get() ?? null; }
  pending() { return this.db.prepare("SELECT count(*) n FROM ticker_jobs WHERE state IN ('queued','showing','exiting','waiting')").get().n; }
  waiting() { return this.db.prepare("SELECT count(*) n FROM ticker_jobs WHERE state='waiting'").get().n; }

  queue(kind, text, { announcement = null, purchase = null, nick = '', voice = null } = {}) {
    const id = randomUUID();
    this.db.prepare("INSERT INTO ticker_jobs(id,kind,announcement,purchase,text,nick,state,voice,audio,queued_at) VALUES (?,?,?,?,?,?,'queued',?,?,?)")
      .run(id, kind, announcement, purchase, text, nick, voice, voice ? 'pending' : null, this.now());
    return id;
  }

  /** Вынік сінтэзу голасу: 'ready' з працягласцю аўдыя (мс) або 'failed' (паказаць толькі тэкст). */
  setAudio(id, audio, ms = null) {
    if (!['ready', 'failed'].includes(audio)) throw new Error('ticker_audio');
    this.commit(() => this.db.prepare("UPDATE ticker_jobs SET audio=?,audio_ms=? WHERE id=? AND audio='pending'").run(audio, audio === 'ready' ? ms : null, id));
    this.tick();
  }

  /** Паказаць аб’яву зараз (у канцы чаргі; аўтаматычная аб’ява, што чакае, замяняецца). */
  manual(id) {
    const announcement = this.config().announcements.find(a => a.id === id);
    if (!announcement) throw new Error('ticker_announcement');
    if (this.pending() >= MAX_PENDING) throw new Error('ticker_backpressure');
    return this.commit(() => {
      this.db.exec("UPDATE ticker_jobs SET state='superseded' WHERE kind='automatic' AND state='queued'");
      return { id: this.queue('manual', announcement.text, { announcement: id }) };
    });
  }

  /**
   * Новая аб’ява зверху спіса і адразу ў эфір (напрыклад, пераможца галасавання).
   * Аб’ява застаецца ў спісе — стрымер выдаляе яе сам. Калі спіс поўны (40), толькі паказваецца.
   */
  announce(text) {
    validateText(text, 2000);
    return this.commit(() => {
      const config = this.config();
      const id = randomUUID();
      if (config.announcements.length < 40) this.store.set('ticker.config', { ...config, announcements: [{ id, text }, ...config.announcements] });
      this.db.exec("UPDATE ticker_jobs SET state='superseded' WHERE kind='automatic' AND state='queued'");
      return { id: this.queue('manual', text, { announcement: id }) };
    });
  }

  retry() {
    this.fault = null;
    return this.commit(() => { this.db.exec("UPDATE ticker_jobs SET state='queued',failures=0 WHERE state='waiting'"); return { retried: true }; });
  }

  cycleAfter(job) {
    if (job.kind === 'paid') return;
    const c = this.config(), index = c.announcements.findIndex(a => a.id === job.announcement);
    this.store.set('ticker.cycle', { next: c.announcements[(index + 1) % c.announcements.length]?.id ?? null, due: this.now() + c.interval * 1000 });
  }

  intent(purchase, target) {
    this.db.prepare("INSERT OR IGNORE INTO ticker_outbox(id,purchase,target,state) VALUES (?,?,?,'pending')").run(purchase, purchase, target);
  }

  /** Стрымер прыбраў плашку з экрана. Платнае паведамленне вяртаецца гледачу. */
  cancel({ id, attempt, generation }) {
    const job = this.active();
    if (!job || job.id !== id || job.attempt !== attempt || job.generation !== generation || job.state !== 'showing') return { ignored: true };
    return this.commit(() => {
      this.db.prepare("UPDATE ticker_jobs SET state='exiting',started=? WHERE id=?").run(this.now(), id);
      if (job.purchase) {
        this.db.prepare("UPDATE ticker_purchases SET decision='canceled' WHERE id=?").run(job.purchase);
        this.intent(job.purchase, 'CANCELED');
      }
      this.cycleAfter(job);
      return { canceled: true };
    });
  }

  heartbeat({ client, source, visible, obs }) {
    if (source !== this.source || !/^[a-f0-9-]{36}$/i.test(client)) throw new Error('ticker_source');
    for (const [id, c] of this.clients) if (this.now() - c.at > CLIENT_TTL_MS) this.clients.delete(id);
    if (!this.clients.has(client) && this.clients.size >= 8) throw new Error('ticker_clients');
    this.clients.set(client, { at: this.now(), visible: visible === true, obs: obs === true });
    this.tick();
    const live = this.consumer() === client && !this.fault;
    return {
      config: this.config(), job: live ? this.active() : null, ready: live && this.readiness.source, error: this.fault,
      voice: { volume: this.voice?.volume() ?? 1 },
    };
  }

  /** Адзіная бачная старонка бягучага радка ў OBS — толькі ёй дазволена паказваць. */
  consumer() {
    const clients = [...this.clients].filter(([, c]) => c.obs && c.visible && this.now() - c.at <= CLIENT_TTL_MS);
    return clients.length === 1 ? clients[0][0] : null;
  }

  setReady(state) { this.readiness = { source: !!state.source }; this.tick(); }

  ready() { return !!this.consumer() && this.readiness.source && !this.fault; }

  tick() {
    if (this.fault) return;
    let job = this.active();
    if (job?.state === 'exiting') {
      if (this.now() - job.started < 1500) return;
      this.commit(() => { this.db.prepare("UPDATE ticker_jobs SET state='canceled' WHERE id=?").run(job.id); this.cycleAfter(job); });
      job = null;
    }
    if (job && (!this.ready() || this.now() - job.started > (job.duration ?? 180_000) + 5000)) {
      this.commit(() => this.db.prepare("UPDATE ticker_jobs SET state=CASE WHEN failures>=4 THEN 'waiting' ELSE 'queued' END,failures=failures+1,attempt=NULL WHERE id=?").run(job.id));
      return;
    }
    if (job || !this.ready()) return;
    const c = this.config(), cycle = this.store.get('ticker.cycle', { due: this.now() + c.interval * 1000, next: null });
    if (c.enabled && c.announcements.length && this.pending() < MAX_PENDING && this.now() >= cycle.due
      && !this.db.prepare("SELECT 1 FROM ticker_jobs WHERE kind!='paid' AND state IN ('queued','waiting')").get()) {
      const a = c.announcements.find(x => x.id === cycle.next) ?? c.announcements[0];
      this.commit(() => this.queue('automatic', a.text, { announcement: a.id }));
    }
    const next = this.db.prepare("SELECT * FROM ticker_jobs WHERE state='queued' ORDER BY seq LIMIT 1").get();
    // Паведамленне з голасам чакае аўдыя (звычайна некалькі секунд); чарга за ім таксама чакае — парадак захоўваецца.
    if (!next || next.audio === 'pending') return;
    this.commit(() => this.db.prepare("UPDATE ticker_jobs SET state='showing',attempt=?,generation=generation+1,started=?,duration=NULL WHERE id=?")
      .run(randomUUID(), this.now(), next.id));
  }

  /** Этапы паказу ад старонкі: layout (вымераная працягласць), complete, hidden. */
  acknowledge({ client, id, attempt, generation, phase, duration }) {
    const job = this.active();
    if (this.fault || client !== this.consumer() || !this.readiness.source || !job || job.id !== id || job.attempt !== attempt || job.generation !== generation)
      return { ignored: true };
    if (phase === 'hidden' && job.state === 'exiting')
      return this.commit(() => { this.db.prepare("UPDATE ticker_jobs SET state='canceled' WHERE id=?").run(id); this.cycleAfter(job); return { hidden: true }; });
    if (job.state !== 'showing') return { ignored: true };
    if (phase === 'layout') {
      if (!Number.isFinite(duration) || duration < 11_000 || duration > 86_400_000) throw new Error('ticker_duration');
      if (job.duration === null) this.commit(() => this.db.prepare('UPDATE ticker_jobs SET duration=? WHERE id=?').run(duration, id));
      return { measured: true };
    }
    if (phase !== 'complete' || !job.duration || this.now() - job.started < job.duration) return { ignored: true };
    return this.commit(() => {
      this.db.prepare("UPDATE ticker_jobs SET state='completed' WHERE id=?").run(id);
      if (job.purchase) {
        this.db.prepare("UPDATE ticker_purchases SET decision='completed' WHERE id=?").run(job.purchase);
        this.intent(job.purchase, 'FULFILLED');
      }
      this.cycleAfter(job);
      return { completed: true };
    });
  }

  /** Пакупка «паведамленне на экране». `admitted` — купленая, пакуль узнагарода была адкрытая. */
  ingest(event, messageId, { account, reward, admitted }) {
    if (event.reward?.id !== reward) return { ignored: true };
    const status = String(event.status).toUpperCase(), purchased = Date.parse(event.redeemed_at), cost = event.reward.cost;
    if (!event.id || typeof event.id !== 'string' || event.id.length > 200 || !Number.isFinite(purchased) || purchased > this.now() + 1000
      || !Number.isSafeInteger(cost) || cost < 1) throw new Error('ticker_purchase_format');
    const id = `${account}:${event.id}`, prior = this.db.prepare('SELECT * FROM ticker_purchases WHERE id=?').get(id);
    const fingerprint = time => createHash('sha256').update(JSON.stringify([reward, time, cost, event.user_input, event.user_id])).digest('hex');
    if (prior && prior.fingerprint !== fingerprint(purchased)) {
      // Helix можа адкідаць долі секунды, якія ёсць у EventSub.
      const sameSecond = Math.floor(purchased / 1000) === Math.floor(prior.purchased / 1000);
      const lostFraction = purchased % 1000 === 0 || prior.purchased % 1000 === 0;
      if (!sameSecond || !lostFraction || prior.fingerprint !== fingerprint(prior.purchased)) throw new Error('ticker_purchase_conflict');
    }
    return this.commit(() => {
      const inbox = this.db.prepare('SELECT purchase FROM ticker_inbox WHERE id=?').get(messageId);
      if (inbox && inbox.purchase !== id) throw new Error('ticker_message_conflict');
      this.db.prepare('INSERT OR IGNORE INTO ticker_inbox VALUES (?,?)').run(messageId, id);
      if (prior) {
        if (status !== 'UNFULFILLED' && status !== prior.status && prior.status === 'UNFULFILLED') {
          this.db.prepare('UPDATE ticker_purchases SET status=? WHERE id=?').run(status, id);
          const target = this.db.prepare('SELECT target FROM ticker_outbox WHERE purchase=?').get(id)?.target;
          if (target && target !== status) this.db.prepare("UPDATE ticker_outbox SET state='blocked',error='ticker_terminal_conflict' WHERE purchase=?").run(id);
          this.db.prepare("UPDATE ticker_jobs SET state='external_terminal' WHERE purchase=? AND state IN ('queued','showing')").run(id);
        }
        return { duplicate: true };
      }
      if (!['UNFULFILLED', 'FULFILLED', 'CANCELED'].includes(status)) throw new Error('ticker_purchase_format');
      // Нябачныя знакі не адхіляюць пакупку — яны выкідаюцца (іх устаўляюць пашырэнні чата Twitch).
      const text = cleanViewerText(event.user_input);
      let valid = true;
      try { validateText(text, PAID_TEXT_LIMIT); validateText(event.user_name || event.user_login, 80); } catch { valid = false; }
      const decision = status !== 'UNFULFILLED' ? 'external_terminal' : valid && admitted && this.pending() < MAX_PENDING ? 'queued' : 'rejected';
      if (decision === 'rejected') this.log('warn', 'ticker.rejected', !valid ? 'text' : !admitted ? 'closed' : 'backpressure');
      this.db.prepare('INSERT INTO ticker_purchases VALUES (?,?,?,?,?,?,?,?,?)').run(id, account, reward, event.id, purchased, cost, status, decision, fingerprint(purchased));
      if (decision === 'queued') this.queue('paid', text, {
        purchase: id, nick: event.user_name || event.user_login, voice: this.voice?.wanted() ? this.voice.pick() : null,
      });
      if (decision === 'rejected') this.intent(id, 'CANCELED');
      return { accepted: decision === 'queued', decision };
    });
  }

  snapshot() {
    return {
      config: this.config(), source: this.source, current: this.active(), waiting: this.waiting(),
      queue: this.db.prepare("SELECT id,kind,nick,text,state,voice,audio FROM ticker_jobs WHERE state IN ('queued','waiting') ORDER BY seq LIMIT 50").all(),
      cycle: this.store.get('ticker.cycle', {}), ready: this.readiness, consumer: !!this.consumer(), error: this.fault,
      refunds: this.db.prepare('SELECT target,state,error,count(*) AS count FROM ticker_outbox GROUP BY target,state,error ORDER BY target,state,error').all(),
    };
  }
}
