// Дыягнастычны журнал: JSON-радкі, па 512 КБ, тры старыя файлы.
// У журнал пішуцца толькі стабільныя коды, ніколі не токены, паролі або тэкст гледачоў.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SAFE = /^[a-z0-9_.:-]{0,80}$/i;

export function createLogger(directory, { maxBytes = 512 * 1024, echo = false } = {}) {
  const path = join(directory, 'app.log');
  let failed = false;
  const log = (level, event, code = '') => {
    const record = JSON.stringify({
      at: new Date().toISOString(), level,
      event: SAFE.test(event) ? event : 'redacted',
      code: typeof code === 'string' && SAFE.test(code) ? code : 'redacted',
    }) + '\n';
    if (echo) process.stdout.write(record);
    try {
      mkdirSync(directory, { recursive: true });
      if (existsSync(path) && statSync(path).size + record.length > maxBytes) {
        for (let i = 3; i >= 1; i--) {
          const source = i === 1 ? path : `${path}.${i - 1}`, target = `${path}.${i}`;
          if (existsSync(target)) rmSync(target);
          if (existsSync(source)) renameSync(source, target);
        }
      }
      appendFileSync(path, record);
      failed = false;
    } catch {
      if (!failed) process.stderr.write('log.write_failed\n');
      failed = true;
    }
  };
  log.path = path;
  return log;
}

/** Код памылкі для журнала і дока: толькі бяспечныя ідэнтыфікатары. */
export const errorCode = error => (SAFE.test(error?.message ?? '') && error.message ? error.message : 'operation_failed');
