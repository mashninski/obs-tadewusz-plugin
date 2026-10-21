// SQLite-сховішча: схема, міграцыі і транзакцыі.
// Перад кожнай міграцыяй існуючай базы робіцца поўная копія побач (VACUUM INTO).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { reserveCode } from '../voting/codes.js';

export const SCHEMA_VERSION = 6;

const SCHEMA_V2 = `
  CREATE TABLE rounds(id TEXT PRIMARY KEY, opened INTEGER NOT NULL, closed INTEGER, status TEXT NOT NULL, result TEXT);
  CREATE TABLE entries(id TEXT PRIMARY KEY, title TEXT NOT NULL, normalized TEXT NOT NULL, score INTEGER NOT NULL CHECK(score>=0),
    created INTEGER NOT NULL, active INTEGER NOT NULL, metadata TEXT NOT NULL);
  CREATE UNIQUE INDEX entry_name ON entries(normalized) WHERE active=1;
  CREATE TABLE purchases(id TEXT PRIMARY KEY, account TEXT NOT NULL, reward TEXT NOT NULL, purchased INTEGER NOT NULL,
    delivered INTEGER NOT NULL, round_id TEXT REFERENCES rounds(id), entry_id TEXT REFERENCES entries(id), cost INTEGER NOT NULL,
    status TEXT NOT NULL, decision TEXT NOT NULL, private TEXT NOT NULL);
  CREATE TABLE ledger(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, round_id TEXT, entry_id TEXT, purchase_id TEXT,
    delta INTEGER NOT NULL, reason TEXT NOT NULL);
  CREATE TABLE outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0, error TEXT);
  CREATE TABLE inbox(id TEXT PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL);
  CREATE TABLE pauses(id INTEGER PRIMARY KEY, round_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER);
  CREATE TABLE notifications(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, entry_id TEXT, payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', shown INTEGER);`;

const SCHEMA_V4 = `
  CREATE TABLE entry_codes(entry_id TEXT PRIMARY KEY REFERENCES entries(id),
    code TEXT NOT NULL UNIQUE CHECK(length(code)=3 AND code NOT GLOB '*[^A-Z]*'), algorithm INTEGER NOT NULL);
  CREATE TABLE entry_names(entry_id TEXT NOT NULL REFERENCES entries(id), normalized TEXT NOT NULL, since INTEGER NOT NULL,
    until INTEGER, PRIMARY KEY(entry_id,normalized,since));`;

const SCHEMA_V5 = `
  CREATE TABLE ticker_jobs(seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, announcement TEXT, purchase TEXT UNIQUE,
    text TEXT NOT NULL, nick TEXT NOT NULL, state TEXT NOT NULL, attempt TEXT, generation INTEGER NOT NULL DEFAULT 0, started INTEGER,
    duration INTEGER, failures INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE ticker_purchases(id TEXT PRIMARY KEY, account TEXT NOT NULL, reward TEXT NOT NULL, redemption TEXT NOT NULL,
    purchased INTEGER NOT NULL, cost INTEGER NOT NULL, status TEXT NOT NULL, decision TEXT NOT NULL, fingerprint TEXT NOT NULL);
  CREATE TABLE ticker_inbox(id TEXT PRIMARY KEY, purchase TEXT NOT NULL);
  CREATE TABLE ticker_outbox(id TEXT PRIMARY KEY, purchase TEXT NOT NULL REFERENCES ticker_purchases(id), target TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0, error TEXT);`;

export class Store {
  constructor(path, { now = Date.now } = {}) {
    this.path = path;
    this.now = now;
    this.depth = 0;
    this.durable = null;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
      this.migrate();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  version() {
    return this.db.prepare('PRAGMA user_version').get().user_version;
  }

  /** Копія ўсёй базы перад зменай схемы. */
  snapshot(label) {
    this.db.prepare('VACUUM INTO ?').run(`${this.path}.before-${label}-${this.now()}.sqlite`);
  }

  migrate() {
    const version = this.version();
    if (version > SCHEMA_VERSION) throw new Error('database_newer_than_app');
    if (version === SCHEMA_VERSION) return;
    if (version > 0) this.snapshot(`v${SCHEMA_VERSION}`);
    this.transaction(() => {
      if (version < 1) {
        this.db.exec(`CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE jobs (id TEXT PRIMARY KEY, due INTEGER NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL);
          CREATE TABLE history (id INTEGER PRIMARY KEY, at TEXT NOT NULL, event TEXT NOT NULL);`);
      }
      if (version < 2) this.db.exec(`ALTER TABLE jobs ADD COLUMN scope TEXT; ${SCHEMA_V2}`);
      if (version < 4) {
        this.db.exec(SCHEMA_V4);
        for (const entry of this.db.prepare('SELECT id,title FROM entries ORDER BY created,rowid').all()) reserveCode(this.db, entry);
        this.db.exec('INSERT INTO entry_names SELECT id,normalized,created,NULL FROM entries');
      }
      if (version < 5) this.db.exec(SCHEMA_V5);
      if (version < 6) this.migrateSettingsV6();
      this.db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    });
  }

  /**
   * v6: службовыя ключы старой праграмы (OBS Bot 0.2.x) зводзяцца да простых.
   * Фінансавыя табліцы (entries, ledger, purchases, outbox, ticker_*) не мяняюцца.
   */
  migrateSettingsV6() {
    const take = key => {
      const value = this.get(key, undefined);
      this.db.prepare('DELETE FROM settings WHERE id=?').run(key);
      return value;
    };
    const bindings = take('prototype.rewardBindings');
    if (bindings && this.get('twitch.rewardBindings', null) === null) this.set('twitch.rewardBindings', bindings);
    // Ранейшы «намер» уключанага прыёму становіцца простым сцяжком.
    const working = take('working.reception');
    const ticker = take('ticker.reception');
    this.set('reception', { voting: !!working, ticker: !!ticker });
    take('voting.policy');
    take('voting.codeTransition');
    take('lifecycle.clean');
    take('twitch.runtime');
    take('test.remote');
    this.db.exec(`DELETE FROM settings WHERE id LIKE 'round.transport:%' OR id LIKE 'working.reward_intent:%'
      OR id LIKE 'ticker.reward_intent:%' OR id LIKE 'live_test.%'`);
    // Адкрытыя рэшткі старой схемы скасавання: «finalizing» для ўжо закрытых раўндаў не патрэбны.
    for (const row of this.db.prepare("SELECT id FROM rounds WHERE status='closed'").all())
      this.db.prepare('DELETE FROM settings WHERE id=?').run(`finalizing:${row.id}`);
  }

  get(key, fallback) {
    const row = this.db.prepare('SELECT value FROM settings WHERE id=?').get(key);
    return row ? JSON.parse(row.value) : structuredClone(fallback);
  }

  set(key, value) {
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  }

  /** Сінхронная транзакцыя; укладзеныя выклікі становяцца SAVEPOINT. Пасля COMMIT — запіс у рэзерв. */
  transaction(fn) {
    const nested = this.depth > 0, name = `tx_${this.depth}`;
    this.db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
    this.depth++;
    let committed = false;
    try {
      const result = fn();
      if (result?.then) throw new Error('transaction_must_be_synchronous');
      this.db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
      committed = true;
      if (!nested) this.durable?.();
      return result;
    } catch (error) {
      if (!committed) this.db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }

  record(event) {
    this.db.prepare('INSERT INTO history(at,event) VALUES (?,?)').run(new Date(this.now()).toISOString(), event);
  }

  history({ month, before = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('history_month');
    if (!Number.isSafeInteger(before) || before < 1) throw new Error('history_cursor');
    return month
      ? this.db.prepare("SELECT id,at,event FROM history WHERE substr(datetime(at,'+4 hours'),1,7)=? AND id<? ORDER BY id DESC LIMIT ?").all(month, before, limit)
      : this.db.prepare('SELECT id,at,event FROM history WHERE id<? ORDER BY id DESC LIMIT ?').all(before, limit);
  }

  close() {
    this.db.close();
  }
}
