// Аднаразовы перанос са старога spotify-бота (ён жыў на іншым адрасе, таму localStorage быў асобны):
// налады замоў, уваход у Spotify і стан плэера. Ядро трымае іх у DPAPI-сховішчы да першага ўдалага пераносу.

import { SETTINGS_KEY } from './core/settings';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const HEADERS = { 'Content-Type': 'application/json', 'X-Tadewusz': '1' };

export async function importLegacy(storage: StorageLike | null): Promise<void> {
  if (!storage || typeof fetch === 'undefined') return;
  try {
    const response = await fetch('/api/music/import', { cache: 'no-store' });
    if (!response.ok) return;
    const { entries } = (await response.json()) as { entries: Record<string, string> | null };
    if (!entries) return;
    // Калі тут ужо ёсць свае налады, старыя не перазапісваюць іх.
    if (!storage.getItem(SETTINGS_KEY)) for (const [key, value] of Object.entries(entries)) storage.setItem(key, value);
    await fetch('/api/music/import/done', { method: 'POST', headers: HEADERS, body: '{}' });
  } catch {
    // Ядро недаступнае — паспрабуем пры наступным адкрыцці старонкі.
  }
}
