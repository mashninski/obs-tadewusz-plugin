// Чарга абвестак для оверлея галасавання («@нік мацуе гульню на 500», «Пераможца…»).
// Падтрымкі аднаго гледача за 10 секунд на адну пазіцыю зліваюцца ў адну абвестку.
export class Notifications {
  constructor({ store, settings, now = Date.now }) {
    Object.assign(this, { store, settings, now });
    this.db = store.db;
    // Абвестка, пачатая да перазапуску, не паўтараецца.
    this.db.prepare("UPDATE notifications SET status='done' WHERE status='shown'").run();
  }

  show(event) {
    const at = this.now();
    if (event.kind === 'support') {
      const queued = this.db.prepare(`SELECT * FROM notifications WHERE kind='support' AND entry_id=? AND status='pending' AND at>=?
        AND COALESCE(json_extract(payload,'$.user'),'')=? ORDER BY id DESC LIMIT 1`).get(event.entryId, at - 10_000, event.user ?? '');
      if (queued) {
        const payload = JSON.parse(queued.payload);
        payload.amount += event.amount;
        payload.people.push({ user: event.user, amount: event.amount });
        this.db.prepare('UPDATE notifications SET payload=? WHERE id=?').run(JSON.stringify(payload), queued.id);
        return;
      }
      event = { ...event, people: [{ user: event.user, amount: event.amount }] };
    }
    this.db.prepare('INSERT INTO notifications(at,kind,entry_id,payload) VALUES (?,?,?,?)').run(at, event.kind, event.entryId ?? null, JSON.stringify(event));
  }

  /** Бягучая абвестка для оверлея. Тэрміновыя (пераможца, выдаленне, вяртанне) ідуць без чаргі. */
  current() {
    const at = this.now(), duration = (this.settings().display.duration ?? 10) * 1000;
    let urgent = this.db.prepare("SELECT * FROM notifications WHERE status='pending' AND kind IN ('winner','remove','refund') ORDER BY CASE kind WHEN 'winner' THEN 0 ELSE 1 END,id LIMIT 1").get();
    const active = this.db.prepare("SELECT * FROM notifications WHERE status='shown' ORDER BY id LIMIT 1").get();
    const running = active && active.shown + duration > at;
    if (running && (active.kind === 'winner' || (['remove', 'refund'].includes(active.kind) && urgent?.kind !== 'winner'))) urgent = null;
    if (running && urgent) this.db.prepare("UPDATE notifications SET status='pending',shown=NULL WHERE id=?").run(active.id);
    if (running && !urgent) return this.format(active, duration);
    if (active && (!urgent || !running)) this.db.prepare("UPDATE notifications SET status='done' WHERE id=?").run(active.id);
    const next = urgent ?? this.db.prepare("SELECT * FROM notifications WHERE status='pending' ORDER BY id LIMIT 1").get();
    if (!next) return null;
    this.db.prepare("UPDATE notifications SET status='shown',shown=? WHERE id=?").run(at, next.id);
    return this.format({ ...next, shown: at }, duration);
  }

  /** Раўнд закрыты: абвесткі, што не паспелі (у тым ліку пра галасы падчас таймера), ужо не паказваюцца. */
  discard() {
    this.db.prepare("UPDATE notifications SET status='done' WHERE status IN ('pending','shown')").run();
  }

  /** Перапыніць бягучую абвестку (напрыклад, каб адразу паказаць загаловак). */
  release() {
    this.db.prepare("UPDATE notifications SET status='pending',shown=NULL WHERE status='shown'").run();
  }

  format(row, duration) {
    const event = JSON.parse(row.payload);
    const nick = value => `@${String(value || 'глядач').trim().replace(/^@+/, '')}`;
    let text = event.text ?? event.title ?? '';
    if (event.kind === 'support') {
      const people = new Map();
      for (const person of event.people ?? [{ user: event.user, amount: event.amount }]) people.set(nick(person.user), (people.get(nick(person.user)) ?? 0) + person.amount);
      text = [...people].map(([user, amount]) => `${user} мацуе ${event.title} на ${amount}`).join('\n');
    } else if (event.kind === 'add') {
      text = `${nick(event.user)} дадае ${event.title}`;
    }
    return { id: row.id, kind: row.kind, text, expiresAt: row.shown + duration };
  }
}
