// Агучванне платных паведамленняў радка праз OmniVoice (лакальная мадэль).
// Ядро само запускае схаваны працэс Python з асяроддзя OmniVoice (без акна кансолі), трымае мадэль у памяці,
// перазапускае пасля збою і спыняе разам з сабой. Аўдыя — WAV у data\voice, прайграе старонка радка ў OBS.
// Каб не трымаць памяць дарма: прылада на выбар (відэакарта па змаўчанні — ~2 ГБ відэапамяці; працэсар — без яе, але ў 30 разоў павольней),
// колькасць крокаў сінтэзу (16 — удвая хутчэй за 32) і «сон» — мадэль выгружаецца пасля прастою
// і загружаецца зноў, калі прыйшло паведамленне (узнагарода пры гэтым застаецца адкрытай).
// Паведамленне з голасам не пачынае паказ, пакуль аўдыя не гатовае; калі сінтэз не ўдаўся — паказваецца толькі тэкст.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_PERSONAS } from '../../shared/voice-personas.js';

export const voiceDefaults = { version: 1, enabled: false, path: 'D:\\ai models\\OmniVoice', volume: 0.9, device: 'cuda', steps: 16, idle: 15, monitor: true };

const WORKER = fileURLToPath(new URL('./worker.py', import.meta.url));
const SYNTH_TIMEOUT_MS = 120_000;
// На працэсары фраза ~100 знакаў ідзе ~50 с (16 крокаў) і ~110 с (32) — замер 2026-10-28, ADR-030.
const CPU_SYNTH_TIMEOUT_MS = 300_000;
// Мадэль загружаецца ~1 мін. Калі голас не гатовы так доўга, паведамленне ідзе ў эфір без голасу.
const PENDING_GRACE_MS = 240_000;
const RECENT = 12;

export function validateVoice(input) {
  const c = { ...voiceDefaults, ...input };
  if (c.version !== 1 || typeof c.enabled !== 'boolean' || typeof c.path !== 'string' || !c.path.trim() || c.path.length > 260
    || /[\p{Cc}"*?<>|]/u.test(c.path) || !Number.isFinite(c.volume) || c.volume < 0 || c.volume > 1
    || !['cpu', 'cuda'].includes(c.device) || ![16, 32].includes(c.steps)
    || !Number.isInteger(c.idle) || c.idle < 0 || c.idle > 240 || typeof c.monitor !== 'boolean') throw new Error('voice_settings');
  return { version: 1, enabled: c.enabled, path: c.path.trim(), volume: c.volume, device: c.device, steps: c.steps, idle: c.idle, monitor: c.monitor };
}

export class Voice {
  constructor({ store, dataDir, log = () => {}, now = Date.now, spawn = nodeSpawn, python = path => join(path, '.venv', 'Scripts', 'python.exe') }) {
    Object.assign(this, { store, log, now, spawnImpl: spawn, pythonPath: python });
    this.dir = join(dataDir, 'voice');
    this.logPath = join(dataDir, 'logs', 'voice.log');
    this.child = null;
    this.state = 'off'; // off | missing | starting | ready | sleeping | failed
    this.detail = null;
    this.device = null;
    this.memory = null; // { vramMb, ramMb, loadMs } — апошняя загрузка
    this.lastTook = null; // мс на апошні сінтэз
    this.lastUse = 0;
    this.waking = false; // загрузка пасля сну: прыём не закрываецца
    this.restartAt = 0;
    this.failures = 0;
    this.pending = new Map(); // id → { resolve, reject, timer }
    this.busy = false;
    this.lastCleanup = 0;
    this.closed = false;
  }

  config() {
    try { return validateVoice(this.store.get('voice.config', voiceDefaults)); } catch { return { ...voiceDefaults }; }
  }

  save(input) {
    const before = this.config(), config = validateVoice(input);
    this.store.transaction(() => this.store.set('voice.config', config));
    const reload = before.path !== config.path || before.device !== config.device || before.steps !== config.steps;
    if (reload || !config.enabled) this.stop();
    if (reload && config.enabled) this.restartAt = 0;
    if (config.enabled && this.state !== 'ready' && this.state !== 'starting') { this.restartAt = 0; this.failures = 0; }
    return config;
  }

  wanted() { return this.config().enabled; }
  ready() { return this.state === 'ready'; }
  /** Голас будзе: мадэль загружаная, спіць або прачынаецца пасля сну. Тады ўзнагарода можа быць адкрытай. */
  available() { return this.state === 'ready' || this.state === 'sleeping' || (this.state === 'starting' && this.waking); }

  /** Выпадковы персанаж, які не паўтараецца з апошнімі некалькімі. */
  pick(random = Math.random) {
    const recent = this.store.get('voice.recent', []);
    const pool = VOICE_PERSONAS.filter(p => !recent.includes(p.id));
    const persona = (pool.length ? pool : VOICE_PERSONAS)[Math.floor(random() * (pool.length || VOICE_PERSONAS.length))];
    this.store.set('voice.recent', [persona.id, ...recent].slice(0, RECENT));
    return persona.id;
  }

  file(id) {
    if (typeof id !== 'string' || !/^(test-)?[a-f0-9-]{36}$/i.test(id)) throw new Error('voice_audio');
    return join(this.dir, `${id}.wav`);
  }

  // --- Працэс OmniVoice ---

  start() {
    if (this.child || this.closed) return;
    const { path } = this.config(), python = this.pythonPath(path);
    if (!existsSync(python)) {
      this.state = 'missing';
      this.detail = python;
      this.restartAt = this.now() + 30_000;
      return;
    }
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(join(this.logPath, '..'), { recursive: true });
    try { writeFileSync(this.logPath, `--- ${new Date(this.now()).toISOString()} ${python}\n`); } catch { /* журнал не абавязковы */ }
    this.state = 'starting';
    this.detail = null;
    const config = this.config();
    let child;
    try {
      child = this.spawnImpl(python, ['-u', WORKER], {
        cwd: path, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env, HF_HOME: join(path, 'hf_cache'), HF_HUB_OFFLINE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1',
          TADEWUSZ_VOICE_DEVICE: config.device, TADEWUSZ_VOICE_STEPS: String(config.steps),
        },
      });
    } catch (error) {
      this.fail('voice_spawn', error.message);
      return;
    }
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) this.message(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { try { appendFileSync(this.logPath, chunk); } catch { /* ігнараваць */ } });
    child.on('error', error => this.exited(child, error.code ?? 'voice_spawn'));
    child.on('exit', code => this.exited(child, `exit_${code}`));
    this.log('info', 'voice.starting');
  }

  message(line) {
    let data;
    try { data = JSON.parse(line); } catch { return; }
    if (data.event === 'ready') {
      this.state = 'ready';
      this.device = data.device ?? null;
      this.memory = { vramMb: data.vram_mb ?? null, ramMb: data.ram_mb ?? null, loadMs: data.load_ms ?? null };
      this.failures = 0;
      this.waking = false;
      this.lastUse = this.now();
      this.log('info', 'voice.ready', this.device === 'cpu' ? 'cpu' : 'cuda');
      return;
    }
    if (data.event === 'failed') { this.detail = String(data.error ?? '').slice(0, 300); return; }
    const task = this.pending.get(data.id);
    if (!task) return;
    this.pending.delete(data.id);
    clearTimeout(task.timer);
    this.lastUse = this.now();
    if (Number.isFinite(data.took)) this.lastTook = Math.round(data.took);
    if (data.ok && Number.isFinite(data.ms) && data.ms > 0) task.resolve({ ms: Math.round(data.ms) });
    else task.reject(Object.assign(new Error('voice_synthesis'), { detail: String(data.error ?? '').slice(0, 300) }));
  }

  exited(child, code) {
    if (this.child !== child) return;
    this.child = null;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('voice_worker_exited')); }
    this.pending.clear();
    if (this.closed || !this.wanted()) { this.state = 'off'; return; }
    this.fail('voice_worker_exited', this.detail ?? code);
  }

  fail(code, detail) {
    this.state = 'failed';
    this.waking = false;
    this.detail = String(detail ?? code).slice(0, 300);
    this.failures++;
    this.restartAt = this.now() + Math.min(300_000, 10_000 * 2 ** Math.min(this.failures - 1, 5));
    this.log('warn', code);
  }

  stop(state = 'off') {
    const child = this.child;
    this.child = null;
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(new Error('voice_stopped')); }
    this.pending.clear();
    this.state = state;
    this.waking = false;
    this.device = null;
    if (child) { try { child.stdin.end(); } catch { /* ужо закрыты */ } setTimeout(() => { try { child.kill(); } catch { /* ужо завяршыўся */ } }, 3000).unref?.(); }
  }

  close() { this.closed = true; this.stop(); }

  synthesize(id, text, persona) {
    if (!this.child || this.state !== 'ready') return Promise.reject(new Error('voice_not_ready'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('voice_timeout'));
        // Працэс завіс — перазапусціць.
        const child = this.child;
        if (child) { this.exited(child, 'voice_timeout'); try { child.kill(); } catch { /* ігнараваць */ } }
      }, this.config().device === 'cpu' ? CPU_SYNTH_TIMEOUT_MS : SYNTH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, text, instruct: persona.instruct, speed: persona.speed, out: this.file(id) }) + '\n');
    });
  }

  // --- Праца з чаргой радка (кожную секунду з цыкла ядра) ---

  /** @param {import('../ticker/ticker.js').Ticker} ticker */
  pump(ticker) {
    if (this.closed) return;
    const wanted = this.wanted(), { idle } = this.config();
    const job = ticker.db.prepare("SELECT id,text,voice,queued_at FROM ticker_jobs WHERE state='queued' AND audio='pending' ORDER BY seq LIMIT 1").get();
    if (!wanted && (this.child || this.state === 'sleeping')) this.stop();
    // Сон: прыйшло паведамленне — загрузіць мадэль зноў.
    if (wanted && this.state === 'sleeping' && job) { this.waking = true; this.state = 'off'; this.start(); }
    if (wanted && !this.child && this.state !== 'sleeping' && this.now() >= this.restartAt) this.start();
    // Доўгі прастой — выгрузіць мадэль (вызваляе відэапамяць або RAM).
    if (wanted && idle > 0 && this.ready() && !job && !this.busy && this.now() - this.lastUse > idle * 60_000) {
      this.stop('sleeping');
      this.log('info', 'voice.sleep');
    }
    if (this.now() - this.lastCleanup > 60_000) this.cleanup(ticker);
    if (!job) return;
    const persona = VOICE_PERSONAS.find(p => p.id === job.voice);
    // Голас выключаны, персанаж невядомы або мадэль так і не загрузілася — паказаць толькі тэкст.
    if (!wanted || !persona || (!this.ready() && this.now() - (job.queued_at ?? 0) > PENDING_GRACE_MS)) {
      ticker.setAudio(job.id, 'failed');
      return;
    }
    if (this.busy || !this.ready()) return;
    this.busy = true;
    this.synthesize(job.id, job.text, persona)
      .then(({ ms }) => ticker.setAudio(job.id, 'ready', ms))
      .catch(error => {
        this.log('warn', 'voice.job', error.message);
        if (error.detail) this.detail = error.detail;
        // Пасля перазапуску працэсу — яшчэ адна спроба (да ліміту чакання), інакш толькі тэкст.
        if (error.message !== 'voice_worker_exited' && error.message !== 'voice_timeout') ticker.setAudio(job.id, 'failed');
      })
      .finally(() => { this.busy = false; });
  }

  /** Выдаліць аўдыя паведамленняў, якія ўжо не ў эфіры і не ў чарзе. */
  cleanup(ticker) {
    this.lastCleanup = this.now();
    if (!existsSync(this.dir)) return;
    const live = new Set(ticker.db.prepare("SELECT id FROM ticker_jobs WHERE state IN ('queued','showing','exiting','waiting') AND audio IS NOT NULL").all().map(r => r.id));
    for (const name of readdirSync(this.dir)) {
      const id = name.replace(/\.wav(\.part)?$/, '');
      const path = join(this.dir, name);
      try {
        if (id.startsWith('test-') ? this.now() - statSync(path).mtimeMs > 600_000 : !live.has(id)) rmSync(path, { force: true });
      } catch { /* файл заняты — у наступны раз */ }
    }
  }

  /** Прачнуцца са сну без паведамлення (напрыклад, «Праслухаць» у доку). */
  wake() {
    if (this.state !== 'sleeping') return false;
    this.waking = true;
    this.state = 'off';
    this.start();
    return true;
  }

  /** Праслухаць у доку: асобны файл test-<uuid>.wav, не звязаны з чаргой. */
  async test(id, text, personaId) {
    const persona = VOICE_PERSONAS.find(p => p.id === personaId);
    if (!persona) throw new Error('voice_persona');
    const result = await this.synthesize(`test-${id}`, text, persona);
    return { id, persona: persona.id, ms: result.ms };
  }

  snapshot() {
    return {
      config: this.config(), state: this.state, available: this.available(), detail: this.detail, device: this.device, memory: this.memory,
      lastTook: this.lastTook, personas: VOICE_PERSONAS.length,
    };
  }
}
