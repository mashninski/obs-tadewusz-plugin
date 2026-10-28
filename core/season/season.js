// «Сезон» — лятучыя аб’екты па-над сцэнай: прывіды, сняжынкі, лісце, пялёсткі або свае карцінкі.
// Ядро трымае налады і карцінкі стрымера (data\season\<тэма>\); малюе ўсё старонка season.html у OBS.
// Карцінкі правяраюцца па змесціве (PNG, WebP, SVG), імёны файлаў выбірае ядро — шлях стрымера сюды не трапляе.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEASON_THEMES = ['halloween', 'winter', 'autumn', 'spring', 'custom'];
export const SEASON_MOTIONS = ['float', 'fall', 'tumble'];
/** Рух тэмы па змаўчанні; у наладах `motion: 'auto'` — менавіта ён. */
export const THEME_MOTION = { halloween: 'float', winter: 'fall', autumn: 'tumble', spring: 'tumble', custom: 'float' };
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES = 20;

export const seasonDefaults = {
  version: 1,
  enabled: false,
  theme: 'halloween',
  motion: 'auto',
  count: 5,
  size: 72,
  speed: 1,
  opacity: 0.6,
  fade: true,
};

const IMAGE_NAME = /^[a-f0-9]{16}\.(png|webp|svg)$/;
const TYPES = { png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml' };

export function validateSeason(input) {
  const c = { ...seasonDefaults, ...input };
  if (c.version !== 1 || typeof c.enabled !== 'boolean' || typeof c.fade !== 'boolean') throw new Error('season_settings');
  if (!SEASON_THEMES.includes(c.theme)) throw new Error('season_theme');
  if (c.motion !== 'auto' && !SEASON_MOTIONS.includes(c.motion)) throw new Error('season_motion');
  if (!Number.isInteger(c.count) || c.count < 1 || c.count > 40) throw new Error('season_count');
  if (!Number.isInteger(c.size) || c.size < 16 || c.size > 256) throw new Error('season_size');
  if (!Number.isFinite(c.speed) || c.speed < 0.2 || c.speed > 3) throw new Error('season_speed');
  if (!Number.isFinite(c.opacity) || c.opacity < 0.05 || c.opacity > 1) throw new Error('season_opacity');
  return { version: 1, enabled: c.enabled, theme: c.theme, motion: c.motion, count: c.count, size: c.size, speed: c.speed, opacity: c.opacity, fade: c.fade };
}

/** Тып карцінкі па першых байтах; не карцінка — null. SVG — тэкст з тэгам <svg> напачатку (пасля XML-аб’явы і каментароў). */
export function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  const head = bytes.subarray(0, 4096).toString('utf8').replace(/^﻿/, '');
  if (/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

export class Season {
  constructor({ store, dataDir, log = () => {} }) {
    Object.assign(this, { store, log });
    this.dir = join(dataDir, 'season');
  }

  config() {
    try { return validateSeason(this.store.get('season.config', seasonDefaults)); } catch { return { ...seasonDefaults }; }
  }

  save(body) {
    const value = validateSeason(body);
    this.store.transaction(() => this.store.set('season.config', value));
    return value;
  }

  /** Свае карцінкі тэмы ў парадку загрузкі. */
  images(theme) {
    if (!SEASON_THEMES.includes(theme)) throw new Error('season_theme');
    let names;
    try { names = readdirSync(join(this.dir, theme)).filter(n => IMAGE_NAME.test(n)); } catch { return []; }
    return names
      .map(name => ({ name, at: statSync(join(this.dir, theme, name)).mtimeMs }))
      .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
      .map(i => i.name);
  }

  /** Новая карцінка: `data` — base64. Вяртае згенераванае імя. */
  upload({ theme, data } = {}) {
    if (!SEASON_THEMES.includes(theme)) throw new Error('season_theme');
    if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('season_image');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length) throw new Error('season_image');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('season_image_size');
    const type = imageType(bytes);
    if (!type) throw new Error('season_image_type');
    if (this.images(theme).length >= MAX_IMAGES) throw new Error('season_image_limit');
    const name = `${randomBytes(8).toString('hex')}.${type}`;
    mkdirSync(join(this.dir, theme), { recursive: true });
    writeFileSync(join(this.dir, theme, name), bytes);
    this.log('info', 'season.image_added', theme);
    return { name };
  }

  remove({ theme, name } = {}) {
    rmSync(this.file(theme, name), { force: true });
    return { removed: true };
  }

  /** Шлях да карцінкі толькі для правільных тэмы і імя (ніякіх «..»). */
  file(theme, name) {
    if (!SEASON_THEMES.includes(theme) || typeof name !== 'string' || !IMAGE_NAME.test(name)) throw new Error('season_image');
    return join(this.dir, theme, name);
  }

  read(theme, name) {
    const path = this.file(theme, name);
    return { bytes: readFileSync(path), type: TYPES[name.split('.').pop()] };
  }

  /** Для старонкі ў OBS: налады і адрасы карцінак бягучай тэмы. */
  overlayState() {
    const config = this.config();
    const motion = config.motion === 'auto' ? THEME_MOTION[config.theme] : config.motion;
    const images = this.images(config.theme).map(name => `/season/image?theme=${config.theme}&name=${name}`);
    return { config: { ...config, motion }, images };
  }

  snapshot() {
    return { config: this.config(), images: Object.fromEntries(SEASON_THEMES.map(theme => [theme, this.images(theme)])), maxImages: MAX_IMAGES, maxBytes: MAX_IMAGE_BYTES };
  }
}
