// Аўтра — сцэна ў канцы стрыму: вялікі надпіс, спасылкі з QR і картка рэйду (без кліпаў — рашэнне аўтара 2026-10-28).
// Налады захоўваюцца асобна ад інтро (`outro.settings`); спасылкі па змаўчанні — тыя ж, што ў інтро.
import { plainText, validateLinks } from '../intro/intro.js';

export const outroDefaults = {
  version: 1,
  text: 'Хутка сустрэнемся!',
  ownLinks: false,
  linksTitle: 'Дзе мяне знайсці',
  links: [],
  raidCountdown: 10,
};

export function validateOutro(input) {
  const value = { ...outroDefaults, ...input };
  if (!plainText(value.text, 1, 80)) throw new Error('outro_text');
  if (!plainText(value.linksTitle, 0, 60)) throw new Error('outro_links_title');
  if (typeof value.ownLinks !== 'boolean') throw new Error('outro_options');
  if (!Number.isInteger(value.raidCountdown) || value.raidCountdown < 3 || value.raidCountdown > 60) throw new Error('outro_raid_countdown');
  return {
    version: 1, text: value.text.normalize('NFKC').trim(), ownLinks: value.ownLinks,
    linksTitle: value.linksTitle.normalize('NFKC').trim(), links: validateLinks(value.links, 'outro'), raidCountdown: value.raidCountdown,
  };
}

export class Outro {
  constructor({ store, intro, raid, now = Date.now }) {
    Object.assign(this, { store, intro, raid, now });
  }

  config() {
    try { return validateOutro(this.store.get('outro.settings', outroDefaults)); } catch { return validateOutro(outroDefaults); }
  }

  save(body) {
    const value = validateOutro(body);
    this.store.transaction(() => this.store.set('outro.settings', value));
    return value;
  }

  /** Для старонкі: надпіс, спасылкі (свае або з інтро), рэйд і час ядра для адліку. */
  overlayState() {
    const config = this.config();
    const links = config.ownLinks ? config : this.intro.config();
    return {
      config: { text: config.text, linksTitle: links.linksTitle, links: links.links },
      raid: this.raid.view(), serverNow: this.now(),
    };
  }

  snapshot() {
    return { config: this.config() };
  }
}
