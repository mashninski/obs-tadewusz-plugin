// Сакрэты (токены Twitch, пароль OBS, ключ Steam) у файле, зашыфраваным Windows DPAPI для бягучага карыстальніка.
// Файл чытаецца адзін раз пры запуску (з паўторамі) і далей жыве ў памяці: збой PowerShell-памочніка
// больш не выглядае як «Twitch адключаны». Запіс — уся мапа цалкам, паслядоўна, з паўторамі.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./vault.ps1', import.meta.url));

/** Выклік PowerShell-памочніка: на ўваход JSON, на выхад JSON. */
function runHelper(vaultPath, request, { timeoutMs = 30000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER, '-VaultPath', vaultPath],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '', done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('vault_timeout')); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => finish(new Error('vault_unavailable')));
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`vault_exit_${code}`));
      try { finish(null, JSON.parse(output)); } catch { finish(new Error('vault_format')); }
    });
    child.stdin.on('error', () => finish(new Error('vault_unavailable')));
    child.stdin.end(JSON.stringify(request));
  });
}

export class WindowsVault {
  constructor(directory, { log = () => {}, helper = runHelper, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
    this.path = join(directory, 'secrets.dpapi.json');
    this.log = log;
    this.helper = helper;
    this.wait = wait;
    this.values = null;
    this.loading = null;
    this.writing = Promise.resolve();
    this.dirty = false;
  }

  /** Чытанне з паўторамі: 1, 2, 4, 8 с. Пасля апошняй няўдачы — памылка (праграма пакажа яе, а не «выйдзіце»). */
  load() {
    return this.loading ??= (async () => {
      if (!existsSync(this.path)) return (this.values = {});
      let lastError;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const values = await this.helper(this.path, { action: 'read' });
          return (this.values = values && typeof values === 'object' ? values : {});
        } catch (error) {
          lastError = error;
          this.log('warn', 'vault.read_retry', error.message);
          await this.wait(1000 * 2 ** attempt);
        }
      }
      this.loading = null;
      throw lastError;
    })();
  }

  async get(key) {
    const values = this.values ?? await this.load();
    return values[key] ?? null;
  }

  /** Значэнне адразу даступнае ў памяці; запіс на дыск — у чарзе з паўторамі. */
  async set(key, value) {
    const values = this.values ?? await this.load();
    if (value === null || value === undefined) delete values[key];
    else values[key] = value;
    this.dirty = true;
    return this.flush();
  }

  flush() {
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          this.dirty = false;
          await this.helper(this.path, { action: 'write', values: this.values });
          return;
        } catch (error) {
          this.dirty = true;
          this.log('warn', 'vault.write_retry', error.message);
          await this.wait(1000 * 2 ** attempt);
        }
      }
      this.log('error', 'vault.write_failed');
      throw new Error('vault_write_failed');
    });
    const result = this.writing;
    this.writing = result.catch(() => {});
    return result;
  }
}

/** Сховішча ў памяці — для тэстаў і запуску без Windows. */
export class MemoryVault {
  constructor(values = {}) { this.values = { ...values }; }
  async load() { return this.values; }
  async get(key) { return this.values[key] ?? null; }
  async set(key, value) { if (value === null || value === undefined) delete this.values[key]; else this.values[key] = value; }
  async flush() {}
}
