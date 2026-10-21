// Галасаванне: пазіцыі, балы, раўнды і прыём пакупак.
// Кожная змена балаў запісваецца ў ledger у той жа транзакцыі, што і сама змена: score = сума ledger па пазіцыі.
import { randomUUID } from 'node:crypto';
import { reserveCode } from './codes.js';

export const MAX_SCORE = 1_000_000_000_000;
const MAX_COST = 100_000_000;

export function normalize(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('be');
}

function titleOf(value) {
  const title = String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!title || title.length > 100 || /[\p{Cc}\p{Cf}]/u.test(title)) throw new Error('entry_title');
  return title;
}

// Helix можа адкідаць долі секунды, якія ёсць у EventSub: для той жа пакупкі гэта не канфлікт.
function samePurchaseTime(a, b) {
  return a === b || ((a % 1000 === 0 || b % 1000 === 0) && Math.floor(a / 1000) === Math.floor(b / 1000));
}

// Адлегласць Левенштэйна не большая за 2 — толькі для падказак, ніколі не для выбару пазіцыі.
function nearby(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let minimum = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      minimum = Math.min(minimum, next[j]);
    }
    if (minimum > 2) return false;
    row = next;
  }
  return row[b.length] <= 2;
}

/**
 * Правіла пераносу балаў у новы раўнд (зацверджана аўтарам 21.10.2026):
 * пераможцу застаецца 1/5, месцам 2–6 — 2/3, астатнім — без змен;
 * знізу выбывае floor((N−1)/5) пазіцый: 1–5 → 0, 6–10 → 1, 11–15 → 2, 16–20 → 3, 21–25 → 4, 26–30 → 5…
 * @param {{id:string, score:number}[]} ranked у парадку месцаў
 */
export function carryPlan(ranked) {
  const removeCount = ranked.length <= 5 ? 0 : Math.floor((ranked.length - 1) / 5);
  const removedFrom = ranked.length - removeCount;
  return ranked.map((entry, index) => {
    if (index >= removedFrom) return { id: entry.id, before: entry.score, after: 0, removed: true };
    const after = index === 0 ? Math.floor(entry.score / 5) : index < 6 ? Math.floor(entry.score * 2 / 3) : entry.score;
    return { id: entry.id, before: entry.score, after, removed: false };
  });
}

export class Voting {
  constructor({ store, notify = () => {}, now = Date.now }) {
    this.store = store;
    this.db = store.db;
    this.notify = notify;
    this.now = now;
    if (!this.current()) this.store.transaction(() => this.insertRound());
  }

  current() {
    return this.db.prepare('SELECT * FROM rounds ORDER BY opened DESC,rowid DESC LIMIT 1').get();
  }

  entries() {
    return this.db.prepare(`SELECT e.*,c.code FROM entries e JOIN entry_codes c ON c.entry_id=e.id
      WHERE e.active=1 ORDER BY e.score DESC,e.created,e.rowid`).all()
      .map(e => ({ ...JSON.parse(e.metadata), id: e.id, title: e.title, score: e.score, code: e.code }));
  }

  snapshot() {
    const round = this.current();
    const result = round.result ? JSON.parse(round.result) : null;
    return {
      roundId: round.id, status: round.status, open: round.status === 'open', paused: round.status === 'paused',
      openedAt: round.opened, serverNow: this.now(), deadline: this.deadline(), result,
      carryPending: round.status === 'closed' && result?.carryPolicy === 'pending',
      entries: this.entries(),
    };
  }

  emit(kind, entry, extra = {}) {
    this.notify({ kind, entryId: entry?.id, title: entry?.title, ...extra });
  }

  ledger(entryId, delta, reason, purchaseId = null) {
    this.db.prepare('INSERT INTO ledger(at,round_id,entry_id,purchase_id,delta,reason) VALUES (?,?,?,?,?,?)')
      .run(this.now(), this.current().id, entryId, purchaseId, delta, reason);
  }

  activeEntry(id) {
    const entry = this.db.prepare('SELECT * FROM entries WHERE id=? AND active=1').get(id);
    if (!entry) throw new Error('entry_missing');
    return entry;
  }

  assertEditable() {
    if (!['open', 'paused'].includes(this.current().status)) throw new Error('round_closed');
    const deadline = this.deadline();
    if (deadline && this.now() >= deadline.due) throw new Error('countdown_expired');
  }

  // --- Пазіцыі ---

  add(value, metadata = {}, { fromPurchase = false, user = '' } = {}) {
    return this.store.transaction(() => {
      const status = this.current().status;
      if (!fromPurchase) this.assertEditable();
      if (status !== 'open' && !(fromPurchase && ['paused', 'finalizing'].includes(status))) throw new Error('round_closed');
      const title = titleOf(value), normalized = normalize(title);
      if (this.db.prepare('SELECT id FROM entries WHERE normalized=? AND active=1').get(normalized)) throw new Error('entry_duplicate');
      if (metadata.appId && this.entries().some(e => e.appId === metadata.appId)) throw new Error('entry_duplicate');
      const entry = { id: randomUUID(), title, score: 0 };
      this.db.prepare('INSERT INTO entries VALUES (?,?,?,?,?,?,?)').run(entry.id, title, normalized, 0, this.now(), 1, JSON.stringify(metadata));
      entry.code = reserveCode(this.db, entry);
      this.db.prepare('INSERT INTO entry_names VALUES (?,?,?,NULL)').run(entry.id, normalized, this.now());
      this.ledger(entry.id, 0, 'add');
      this.store.record(`Дададзена: ${title}`);
      this.emit('add', entry, { amount: 0, user });
      return entry;
    });
  }

  /** Пошук пазіцыі па трохлітарным кодзе або дакладнай назве (у тым ліку ранейшай на момант пакупкі). */
  match(value, { purchasedAt = this.now() } = {}) {
    const raw = String(value ?? '').trim();
    const entries = this.entries();
    if (/^[A-Za-z]{3}$/.test(raw)) return { entry: entries.find(e => e.code === raw.toUpperCase()) ?? null, suggestions: [] };
    let normalized;
    try { normalized = normalize(titleOf(value)); } catch { return { entry: null, suggestions: [] }; }
    const names = this.db.prepare('SELECT DISTINCT entry_id FROM entry_names WHERE normalized=? AND since<=? AND (until IS NULL OR until>?)')
      .all(normalized, purchasedAt, purchasedAt);
    const exact = names.length === 1 ? entries.find(e => e.id === names[0].entry_id) : null;
    if (exact) return { entry: exact, suggestions: [] };
    const suggestions = entries.filter(e => {
      const title = normalize(e.title);
      return title.includes(normalized) || normalized.includes(title) || (normalized.length >= 3 && nearby(normalized, title));
    }).slice(0, 4).map(e => e.title);
    return { entry: null, suggestions };
  }

  rename(id, value) {
    return this.store.transaction(() => {
      this.assertEditable();
      const entry = this.activeEntry(id);
      const title = titleOf(value), normalized = normalize(title);
      if (this.db.prepare('SELECT id FROM entries WHERE normalized=? AND active=1 AND id!=?').get(normalized, id)) throw new Error('entry_duplicate');
      if (entry.normalized !== normalized) {
        this.db.prepare('UPDATE entry_names SET until=? WHERE entry_id=? AND until IS NULL').run(this.now(), id);
        this.db.prepare('INSERT INTO entry_names VALUES (?,?,?,NULL) ON CONFLICT(entry_id,normalized,since) DO UPDATE SET until=NULL')
          .run(id, normalized, this.now());
      }
      this.db.prepare('UPDATE entries SET title=?,normalized=? WHERE id=?').run(title, normalized, id);
      this.store.record(`Перайменавана: ${entry.title} → ${title}`);
    });
  }

  edit(id, score) {
    if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) throw new Error('entry_score');
    return this.store.transaction(() => {
      this.assertEditable();
      const entry = this.activeEntry(id);
      if (entry.score === score) return;
      this.ledger(id, score - entry.score, 'manual');
      this.db.prepare('UPDATE entries SET score=? WHERE id=?').run(score, id);
      this.store.record(`Балы зменены: ${entry.title} · ${entry.score} → ${score}`);
    });
  }

  /** Перанос усіх балаў з адной пазіцыі на іншую (напрыклад, калі гульню дадалі двойчы). */
  move(fromId, toId) {
    return this.store.transaction(() => {
      this.assertEditable();
      if (fromId === toId) throw new Error('entry_same');
      const from = this.activeEntry(fromId), to = this.activeEntry(toId);
      if (!from.score) return { moved: 0 };
      if (to.score + from.score > MAX_SCORE) throw new Error('entry_score');
      this.ledger(from.id, -from.score, 'move_out');
      this.ledger(to.id, from.score, 'move_in');
      this.db.prepare('UPDATE entries SET score=0 WHERE id=?').run(from.id);
      this.db.prepare('UPDATE entries SET score=score+? WHERE id=?').run(from.score, to.id);
      this.store.record(`Балы перанесены: ${from.title} → ${to.title} · ${from.score}`);
      return { moved: from.score };
    });
  }

  availability(id, manual) {
    if (![true, false, null].includes(manual)) throw new Error('availability_value');
    return this.store.transaction(() => {
      const entry = this.activeEntry(id);
      const metadata = JSON.parse(entry.metadata);
      metadata.manual = manual;
      metadata.availability = manual === null ? (metadata.syncedAvailability ?? 'unknown') : manual ? 'available' : 'absent';
      this.db.prepare('UPDATE entries SET metadata=? WHERE id=?').run(JSON.stringify(metadata), id);
    });
  }

  /** Што будзе з пакупкамі пры выдаленні: дадаванне яшчэ можна вярнуць, падтрымку — не. */
  removalInfo(id) {
    const entry = this.activeEntry(id);
    const refundable = this.db.prepare("SELECT coalesce(sum(cost),0) n FROM purchases WHERE entry_id=? AND decision='accepted_add' AND status='UNFULFILLED'").get(id).n;
    const review = !!this.db.prepare("SELECT 1 FROM purchases WHERE entry_id=? AND decision='external_cancel_review'").get(id);
    return { score: entry.score, refundable, review };
  }

  /**
   * Выдаленне пазіцыі. Калі на ёй ёсць балы, патрэбна `burn: true` — балы згараюць (Twitch не вяртае
   * ўжо пацверджаныя пакупкі). Дадаванне, якое яшчэ чакае першай падтрымкі, вяртаецца гледачу.
   */
  remove(id, { burn = false } = {}) {
    return this.store.transaction(() => {
      this.assertEditable();
      const entry = this.activeEntry(id);
      const info = this.removalInfo(id);
      if (info.review) throw new Error('external_cancel_review');
      if (entry.score > 0 && !burn) throw new Error('entry_has_points');
      this.releaseHeldAdds(id);
      this.ledger(id, -entry.score, 'manual_remove');
      this.db.prepare('UPDATE entries SET active=0,score=0 WHERE id=?').run(id);
      this.emit('remove', entry, { text: `Выдалена: ${entry.title}` });
      this.store.record(`Выдалена: ${entry.title}${entry.score ? ` · згарэла ${entry.score}` : ''}`);
      return info;
    });
  }

  releaseHeldAdds(entryId) {
    for (const p of this.db.prepare("SELECT * FROM purchases WHERE entry_id=? AND decision='accepted_add'").all(entryId)) {
      if (this.db.prepare("SELECT id FROM outbox WHERE id=? AND status!='done'").get(`fulfill:${p.id}`)) throw new Error('fulfillment_pending');
      if (p.status !== 'UNFULFILLED') continue;
      this.db.prepare("UPDATE purchases SET decision='removed_add' WHERE id=?").run(p.id);
      this.enqueueStatus(p, 'cancel');
    }
  }

  // --- Разбор знешніх скасаванняў ---

  reviews() {
    return this.db.prepare(`SELECT p.id,p.cost,e.title,p.entry_id AS entryId FROM purchases p LEFT JOIN entries e ON e.id=p.entry_id
      WHERE p.decision='external_cancel_review' ORDER BY p.delivered,p.id`).all();
  }

  resolveReview(id) {
    return this.store.transaction(() => {
      const purchase = this.db.prepare("SELECT * FROM purchases WHERE id=? AND decision='external_cancel_review'").get(id);
      if (!purchase) throw new Error('review_missing');
      this.db.prepare("UPDATE purchases SET decision='external_cancel_resolved' WHERE id=?").run(id);
      if (purchase.entry_id) this.ledger(purchase.entry_id, 0, 'external_cancel_keep_score', id);
      this.store.record('Знешняе скасаванне разгледжана: балы пакінуты без змен');
    });
  }

  // --- Раўнд ---

  deadline() {
    return this.store.get(`countdown:${this.current().id}`, null);
  }

  startCountdown(seconds = 60) {
    return this.store.transaction(() => {
      this.assertEditable();
      if (this.deadline()) return this.deadline();
      const value = { roundId: this.current().id, due: this.now() + seconds * 1000 };
      this.store.set(`countdown:${value.roundId}`, value);
      this.store.record(`Завяршэнне праз ${seconds} секунд`);
      return value;
    });
  }

  cancelCountdown() {
    return this.store.transaction(() => {
      const deadline = this.deadline();
      if (deadline && this.now() >= deadline.due) throw new Error('countdown_expired');
      this.store.set(`countdown:${this.current().id}`, null);
      this.store.record('Таймер завяршэння скасаваны');
    });
  }

  pause(paused) {
    return this.store.transaction(() => {
      const round = this.current();
      if (!['open', 'paused'].includes(round.status)) throw new Error('round_closed');
      if ((round.status === 'paused') === paused) return;
      if (paused) this.db.prepare('INSERT INTO pauses(round_id,start) VALUES (?,?)').run(round.id, this.now());
      else this.db.prepare('UPDATE pauses SET end=? WHERE round_id=? AND end IS NULL').run(this.now(), round.id);
      this.db.prepare('UPDATE rounds SET status=? WHERE id=?').run(paused ? 'paused' : 'open', round.id);
      this.store.record(paused ? 'Галасаванне прыпынена' : 'Галасаванне адноўлена');
    });
  }

  /** Прыём спынены; вынік фіксуецца пасля зверкі пакупак з Twitch (гл. Finalization). */
  beginFinalization() {
    return this.store.transaction(() => {
      const round = this.current();
      if (['closed', 'finalizing'].includes(round.status)) return round.id;
      if (this.reviews().length) throw new Error('external_cancel_review');
      const cutoff = Math.min(this.now(), this.deadline()?.due ?? this.now());
      this.store.set(`finalizing:${round.id}`, { cutoff });
      this.db.prepare("UPDATE rounds SET status='finalizing' WHERE id=?").run(round.id);
      this.db.prepare('UPDATE pauses SET end=? WHERE round_id=? AND end IS NULL').run(this.now(), round.id);
      this.store.record('Прыём спынены: вынік чакае зверкі пакупак');
      return round.id;
    });
  }

  close() {
    return this.store.transaction(() => {
      const round = this.current();
      if (round.status === 'closed') return JSON.parse(round.result);
      if (this.reviews().length) throw new Error('external_cancel_review');
      const ranked = this.entries(), winner = ranked[0] ?? null;
      const result = { version: 3, closedAt: this.now(), winnerId: winner?.id ?? null, ranked, carryPolicy: 'pending' };
      const cutoff = this.store.get(`finalizing:${round.id}`, null)?.cutoff ?? result.closedAt;
      this.db.prepare("UPDATE rounds SET closed=?,status='closed',result=? WHERE id=?").run(cutoff, JSON.stringify(result), round.id);
      this.db.prepare('UPDATE pauses SET end=? WHERE round_id=? AND end IS NULL').run(result.closedAt, round.id);
      this.store.set(`finalizing:${round.id}`, null);
      const text = winner ? `Пераможца: ${winner.title} · ${winner.score}` : 'Раўнд завершаны без пазіцый';
      this.store.record(text);
      this.emit('winner', winner, { text });
      return result;
    });
  }

  /** Што зробіць правіла пераносу з бягучым спісам (для папярэдняга прагляду ў доку). */
  previewCarry() {
    const entries = this.entries();
    return carryPlan(entries).map(step => ({ ...step, title: entries.find(e => e.id === step.id).title }));
  }

  /** Новы раўнд: правіла пераносу прымяняецца разам з адкрыццём, у адной транзакцыі. */
  openNext() {
    return this.store.transaction(() => {
      const round = this.current();
      if (round.status === 'finalizing') throw new Error('round_finalizing');
      if (round.status !== 'closed') return round.id;
      const result = JSON.parse(round.result ?? '{}');
      if (result.carryPolicy === 'pending') {
        const plan = this.previewCarry();
        for (const step of plan) {
          if (step.removed) {
            this.releaseHeldAdds(step.id);
            this.db.prepare('UPDATE entries SET active=0,score=0 WHERE id=?').run(step.id);
            this.ledger(step.id, -step.before, 'cleanup');
          } else if (step.after !== step.before) {
            this.db.prepare('UPDATE entries SET score=? WHERE id=?').run(step.after, step.id);
            this.ledger(step.id, step.after - step.before, 'carry');
          }
        }
        this.db.prepare('UPDATE rounds SET result=? WHERE id=?')
          .run(JSON.stringify({ ...result, carryPolicy: 'applied', carry: plan }), round.id);
        const removed = plan.filter(s => s.removed).map(s => s.title);
        this.store.record(`Перанос балаў прыменены${removed.length ? ` · выбылі: ${removed.join(', ')}` : ''}`);
      }
      return this.insertRound();
    });
  }

  insertRound() {
    const id = randomUUID();
    this.db.prepare("INSERT INTO rounds VALUES (?,?,NULL,'open',NULL)").run(id, this.now());
    this.store.record('Новы раўнд адкрыты');
    return id;
  }

  // --- Пакупкі Twitch ---

  enqueueStatus(purchase, kind) {
    const redemptionId = purchase.id.slice(purchase.account.length + 1);
    this.db.prepare('INSERT OR IGNORE INTO outbox(id,kind,payload,status) VALUES (?,?,?,?)')
      .run(`${kind}:${purchase.id}`, kind, JSON.stringify({ account: purchase.account, rewardId: purchase.reward, redemptionId, purchaseId: purchase.id }), 'pending');
  }

  /**
   * Прыём пакупкі (з EventSub або зверкі). Ідэмпатэнтна: паўтор той жа пакупкі не мяняе балы.
   * Дадаванне чакае першай падтрымкі (UNFULFILLED, яго можна вярнуць); падтрымка пацвярджаецца ў Twitch адразу.
   */
  receive(event, { account, role, messageId, delivery = this.now(), rejectReason = null, entryMetadata = {}, resolvedTitle } = {}) {
    return this.store.transaction(() => {
      const rewardId = event.reward?.id;
      if (!['add', 'support'].includes(role) || !event.id || !rewardId || !account) throw new Error('purchase_binding');
      const at = Date.parse(event.redeemed_at), cost = event.reward?.cost;
      if (!Number.isFinite(at) || at > delivery + 1000 || !Number.isSafeInteger(cost) || cost < 1 || cost > MAX_COST) throw new Error('purchase_format');
      const status = String(event.status).toUpperCase();
      if (!['UNFULFILLED', 'FULFILLED', 'CANCELED'].includes(status)) throw new Error('purchase_status');
      const key = `${account}:${event.id}`;
      messageId ??= `${key}:${status}`;
      const duplicate = this.db.prepare('SELECT * FROM purchases WHERE id=?').get(key);
      if (duplicate && (duplicate.reward !== rewardId || duplicate.cost !== cost || !samePurchaseTime(duplicate.purchased, at))) throw new Error('purchase_conflict');
      const journal = JSON.stringify({ key, status });
      const prior = this.db.prepare('SELECT event FROM inbox WHERE id=?').get(messageId);
      if (prior && prior.event !== journal) throw new Error('event_message_conflict');
      this.db.prepare('INSERT OR IGNORE INTO inbox VALUES (?,?,?)').run(messageId, delivery, journal);
      if (duplicate) return this.receiveRepeat(duplicate, status);

      const round = this.db.prepare('SELECT * FROM rounds WHERE opened<=? AND (closed IS NULL OR closed>?) ORDER BY opened DESC,rowid DESC LIMIT 1').get(at, at);
      const paused = round && this.db.prepare('SELECT id FROM pauses WHERE round_id=? AND start<=? AND (end IS NULL OR end>?)').get(round.id, at, at);
      const cutoff = round?.status === 'finalizing' ? this.store.get(`finalizing:${round.id}`, null)?.cutoff
        : round ? this.store.get(`countdown:${round.id}`, null)?.due ?? null : null;
      let reason = status !== 'UNFULFILLED' ? 'terminal_unprocessed'
        : !round ? 'between_rounds'
          : round.closed !== null ? 'late_closed_round'
            : cutoff != null && at >= cutoff ? 'between_rounds'
              : paused ? 'paused_at_purchase' : rejectReason;
      let entry = null, suggestions = [];
      if (!reason) {
        try {
          if (role === 'add') entry = this.add(resolvedTitle ?? event.user_input, entryMetadata, { fromPurchase: true, user: event.user_login || event.user_name });
          else {
            ({ entry, suggestions } = this.match(event.user_input, { purchasedAt: at }));
            if (!entry) reason = suggestions.length ? 'entry_ambiguous' : 'entry_missing';
          }
        } catch (error) {
          reason = error.message;
        }
      }
      const decision = reason ?? `accepted_${role}`;
      const purchase = { id: key, account, reward: rewardId };
      this.db.prepare('INSERT INTO purchases VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(key, account, rewardId, at, delivery,
        round?.id ?? null, entry?.id ?? null, cost, status, decision,
        JSON.stringify({ userId: event.user_id ?? '', user: event.user_name ?? '', input: event.user_input ?? '', suggestions }));
      if (reason) {
        this.store.record(`Пакупка не прынята: ${reason}`);
        this.emit('error', null, { text: 'Пакупка не прынята. Удакладніце назву.' });
        if (status === 'UNFULFILLED') this.enqueueStatus(purchase, 'cancel');
      } else if (role === 'support') {
        const leader = this.entries()[0]?.id;
        const before = this.db.prepare('SELECT score FROM entries WHERE id=?').get(entry.id).score;
        if (before + cost > MAX_SCORE) throw new Error('entry_score');
        this.db.prepare('UPDATE entries SET score=score+? WHERE id=?').run(cost, entry.id);
        this.ledger(entry.id, cost, 'support', key);
        // Першая падтрымка завяршае перыяд, калі дадаванне яшчэ можна было вярнуць.
        for (const addition of this.db.prepare("SELECT * FROM purchases WHERE entry_id=? AND decision='accepted_add' AND status='UNFULFILLED'").all(entry.id))
          this.enqueueStatus(addition, 'fulfill');
        this.enqueueStatus(purchase, 'fulfill');
        this.emit('support', entry, { amount: cost, user: event.user_login || event.user_name || '' });
        if (leader !== this.entries()[0]?.id) this.emit('leader', entry, { text: `Новы лідар: ${entry.title}` });
        this.store.record(`Падтрымка: ${entry.title} · +${cost}`);
      }
      return { decision, entryId: entry?.id, suggestions };
    });
  }

  receiveRepeat(duplicate, status) {
    const key = duplicate.id;
    // Тэрмінальны стан не вяртаецца назад праз позні або паўторны паказ.
    if (duplicate.status === 'UNFULFILLED' && status !== 'UNFULFILLED') {
      this.db.prepare('UPDATE purchases SET status=? WHERE id=?').run(status, key);
      this.db.prepare("UPDATE outbox SET status='done',error=? WHERE id=? AND status!='done'")
        .run(status === 'CANCELED' ? 'external_canceled' : null, `fulfill:${key}`);
      this.db.prepare("UPDATE outbox SET status=?,error=? WHERE id=? AND status!='done'")
        .run(status === 'CANCELED' ? 'done' : 'blocked', status === 'CANCELED' ? null : 'refund_unavailable', `cancel:${key}`);
      if (status === 'CANCELED' && duplicate.decision.startsWith('accepted')) {
        this.db.prepare("UPDATE purchases SET decision='external_cancel_review' WHERE id=?").run(key);
        this.store.record('Twitch скасаваў прынятую пакупку — патрэбная праверка балаў');
        this.emit('error', null, { text: 'Знешняе скасаванне: праверце гісторыю' });
      }
    }
    if (status === 'UNFULFILLED' && duplicate.status === 'UNFULFILLED') {
      if (duplicate.decision === 'accepted_support') this.enqueueStatus(duplicate, 'fulfill');
      // Новае назіранне аднаўляе заблакіраваныя памылкай доступу аперацыі.
      this.db.prepare("UPDATE outbox SET status='pending',next=0,error=NULL WHERE status='blocked' AND id IN (?,?)").run(`cancel:${key}`, `fulfill:${key}`);
    }
    return { duplicate: true, decision: duplicate.decision };
  }
}
