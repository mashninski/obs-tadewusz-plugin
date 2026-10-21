// Трохлітарныя коды пазіцый. Код замацаваны за ID пазіцыі назаўсёды і ніколі не выдаецца паўторна.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CODE_ALGORITHM = 1;
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ў: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '', и: 'i', є: 'ye',
};

export function codeWords(title) {
  return [...String(title).normalize('NFKD').toLowerCase()].map(c => TRANSLIT[c] ?? c).join('')
    .replace(/\p{M}/gu, '').toUpperCase().match(/[A-Z]+/g) ?? [];
}

const encode = n => ALPHABET[Math.floor(n / 676)] + ALPHABET[Math.floor(n / 26) % 26] + ALPHABET[n % 26];

export function allocateCode(title, id, reserved) {
  const words = codeWords(title), letters = words.join(''), initials = words.map(w => w[0]).join('');
  const preferred = [initials.slice(0, 3), words.length === 2 ? (initials + words[1].slice(1)).slice(0, 3) : '', letters.slice(0, 3)];
  for (const code of preferred) if (/^[A-Z]{3}$/.test(code) && !reserved.has(code)) return code;
  // Дэтэрмінаваны поўны перабор ад хэша ID.
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  for (let offset = 0; offset < 17576; offset++) {
    const code = encode((hash % 17576 + offset) % 17576);
    if (!reserved.has(code)) return code;
  }
  throw new Error('entry_codes_exhausted');
}

export function reserveCode(db, entry) {
  const existing = db.prepare('SELECT code FROM entry_codes WHERE entry_id=?').get(entry.id);
  if (existing) return existing.code;
  const reserved = new Set(db.prepare('SELECT code FROM entry_codes').all().map(r => r.code));
  const code = allocateCode(entry.title, entry.id, reserved);
  db.prepare('INSERT INTO entry_codes(entry_id,code,algorithm) VALUES (?,?,?)').run(entry.id, code, CODE_ALGORITHM);
  return code;
}
