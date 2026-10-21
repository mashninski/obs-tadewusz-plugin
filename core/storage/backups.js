// Рэзервовыя копіі базы галасавання.
//  • бягучыя: раз у 10 хвілін, калі нешта змянілася, — апошнія 36 (6 гадзін) у DATA/backups;
//  • дзённыя: адна на дзень і пры кожным спыненні — 90 дзён у асобнай тэчцы (па змаўчанні Дакументы).
// Кожная копія — асобная цэлая база (VACUUM INTO), правераная PRAGMA integrity_check.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const defaultBackupDirectory = () => join(homedir(), 'Documents', 'obs-tadewusz-backups');

const stamp = at => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function verify(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('backup_integrity');
    return {
      entries: db.prepare('SELECT count(*) n FROM entries WHERE active=1').get().n,
      points: db.prepare('SELECT coalesce(sum(score),0) n FROM entries WHERE active=1').get().n,
    };
  } finally { db.close(); }
}

export class Backups {
  constructor(store, { dataDir, external = () => '', log = () => {}, now = Date.now, recentKeep = 36, dailyKeep = 90, recentEveryMs = 600_000 } = {}) {
    Object.assign(this, { store, log, now, recentKeep, dailyKeep, recentEveryMs, external });
    this.recentDir = join(dataDir, 'backups');
    this.lastRecent = 0;
    this.lastChange = 0;
    this.state = { at: null, error: null, daily: null, location: null };
  }

  /** Выклікаецца пасля кожнай транзакцыі. */
  touch() { this.lastChange = this.now(); }

  externalDir() { return this.external() || defaultBackupDirectory(); }

  /** Адна копія: спачатку ў часовы файл, праверка, потым перайменаванне. */
  write(directory, name) {
    mkdirSync(directory, { recursive: true });
    const target = join(directory, name), temp = `${target}.tmp`;
    rmSync(temp, { force: true });
    this.store.db.prepare('VACUUM INTO ?').run(temp);
    const summary = verify(temp);
    renameSync(temp, target);
    return { path: target, ...summary };
  }

  prune(directory, prefix, keep) {
    if (!existsSync(directory)) return;
    const files = readdirSync(directory).filter(n => n.startsWith(prefix) && n.endsWith('.sqlite')).sort().reverse();
    for (const name of files.slice(keep)) rmSync(join(directory, name), { force: true });
  }

  recent() {
    const at = this.now();
    const copy = this.write(this.recentDir, `recent-${stamp(at)}.sqlite`);
    this.prune(this.recentDir, 'recent-', this.recentKeep);
    this.lastRecent = at;
    this.state = { ...this.state, at: new Date(at).toISOString(), error: null, location: this.recentDir };
    return copy;
  }

  /** Дзённая копія ў знешнюю тэчку; `force` — яшчэ адна за той жа дзень (напрыклад, пры спыненні). */
  daily({ force = false } = {}) {
    const at = this.now(), directory = this.externalDir(), day = stamp(at).slice(0, 8);
    const exists = existsSync(directory) && readdirSync(directory).some(n => n.startsWith(`daily-${day}T`));
    if (exists && !force) return null;
    const copy = this.write(directory, `daily-${stamp(at)}.sqlite`);
    this.prune(directory, 'daily-', this.dailyKeep);
    this.state = { ...this.state, daily: new Date(at).toISOString(), error: null };
    this.log('info', 'backup.daily');
    return copy;
  }

  tick() {
    try {
      if (this.lastChange > this.lastRecent && this.now() - this.lastRecent >= this.recentEveryMs) this.recent();
      this.daily();
    } catch (error) {
      this.state.error = 'backup_failed';
      this.log('error', 'backup.failed', error.message);
    }
  }

  /** Пры запуску і спыненні: абедзве копіі адразу. */
  checkpoint() {
    try {
      this.recent();
      return this.daily({ force: true });
    } catch (error) {
      this.state.error = 'backup_failed';
      this.log('error', 'backup.failed', error.message);
      throw new Error('backup_failed');
    }
  }

  snapshot() { return { ...this.state, external: this.externalDir() }; }
}
