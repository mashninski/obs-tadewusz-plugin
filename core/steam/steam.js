// Steam (неабавязкова): уваход праз OpenID для SteamID, каталог гульняў для пошуку і праверка асабістай бібліятэкі.
import { randomBytes } from 'node:crypto';

async function getJson(fetchImpl, url) {
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) }); } catch { throw new Error('steam_unavailable'); }
  if (!response.ok) throw new Error(`steam_${response.status}`);
  try { return await response.json(); } catch { throw new Error('steam_format'); }
}

const STEAM_LINK = /^https:\/\/store\.steampowered\.com\/app\/(\d+)(?:\/[^\s]*)?\/?$/;
const fold = value => String(value).normalize('NFKC').trim().toLocaleLowerCase();

export class Steam {
  constructor({ vault, settings, saveSettings, fetchImpl = fetch, now = Date.now }) {
    Object.assign(this, { vault, settings, saveSettings, fetch: fetchImpl, now });
    this.baseUrl = '';
    this.flow = null;
    this.catalog = null;
    this.owned = null;
    this.state = { catalog: 'disabled', library: 'disabled' };
  }

  isSteamLink(value) { return STEAM_LINK.test(String(value ?? '').trim()); }

  loginUrl() {
    const state = randomBytes(32).toString('hex');
    const returnTo = `${this.baseUrl}/steam/callback?state=${state}`;
    this.flow = { returnTo, state, expires: this.now() + 600_000 };
    return 'https://steamcommunity.com/openid/login?' + new URLSearchParams({
      'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo,
      'openid.realm': `${this.baseUrl}/`, 'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    });
  }

  async callback(params) {
    const flow = this.flow;
    this.flow = null;
    if (!flow || this.now() > flow.expires || params.get('state') !== flow.state || params.get('openid.return_to') !== flow.returnTo
      || params.get('openid.mode') !== 'id_res' || params.get('openid.op_endpoint') !== 'https://steamcommunity.com/openid/login') throw new Error('steam_identity');
    const claimed = params.get('openid.claimed_id') ?? '';
    const signed = new Set((params.get('openid.signed') ?? '').split(','));
    if (['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'].some(k => !signed.has(k))) throw new Error('steam_identity');
    const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
    if (!match || params.get('openid.identity') !== claimed) throw new Error('steam_identity');
    const check = new URLSearchParams([...params].filter(([key]) => key.startsWith('openid.')));
    check.set('openid.mode', 'check_authentication');
    let text;
    try {
      const response = await this.fetch('https://steamcommunity.com/openid/login', { method: 'POST', body: check, signal: AbortSignal.timeout(10_000) });
      text = response.ok ? await response.text() : '';
    } catch { throw new Error('steam_unavailable'); }
    if (!text.split(/\r?\n/).includes('is_valid:true')) throw new Error('steam_identity');
    const settings = this.settings();
    this.saveSettings({ ...settings, steam: { ...settings.steam, steamId: match[1] } });
  }

  async key() {
    const key = await this.vault.get('steamKey');
    if (!key) throw new Error('steam_connection_required');
    return key;
  }

  async library() {
    const id = this.settings().steam.steamId;
    try {
      if (!id) throw new Error('steam_connection_required');
      const data = await getJson(this.fetch, 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?'
        + new URLSearchParams({ key: await this.key(), steamid: id, include_appinfo: 'true', include_played_free_games: 'true' }));
      if (!Array.isArray(data.response?.games)) throw new Error('steam_library_private_or_unavailable');
      this.owned = new Set(data.response.games.map(game => game.appid));
      this.state.library = 'confirmed';
      return { games: data.response.games.length };
    } catch (error) {
      this.owned = null;
      this.state.library = 'error';
      throw error;
    }
  }

  async syncCatalog() {
    const key = await this.key();
    this.state.catalog = 'checking';
    const apps = new Map();
    let last = 0;
    try {
      for (let page = 0; page < 100; page++) {
        const data = await getJson(this.fetch, 'https://api.steampowered.com/IStoreService/GetAppList/v1/?' + new URLSearchParams({
          key, input_json: JSON.stringify({ include_games: true, include_dlc: true, include_software: true, max_results: 50000, last_appid: last }),
        }));
        const result = data.response;
        if (!Array.isArray(result?.apps)) throw new Error('steam_catalog_format');
        for (const app of result.apps) if (Number.isSafeInteger(app.appid) && typeof app.name === 'string') apps.set(app.appid, { appId: app.appid, title: app.name });
        if (!result.have_more_results) {
          this.catalog = apps;
          this.state.catalog = 'confirmed';
          return { count: apps.size };
        }
        const next = result.last_appid ?? result.apps.at(-1)?.appid;
        if (!Number.isSafeInteger(next) || next <= last) throw new Error('steam_catalog_cursor');
        last = next;
      }
      throw new Error('steam_catalog_page_limit');
    } catch (error) {
      this.catalog = null;
      this.state.catalog = 'error';
      throw error;
    }
  }

  search(value) {
    if (!this.catalog) throw new Error('steam_catalog_unavailable');
    const query = fold(value);
    if (!query || query.length > 100) throw new Error('entry_title');
    return [...this.catalog.values()].filter(app => app.title.toLocaleLowerCase().includes(query)).slice(0, 20);
  }

  resolve(value) {
    if (!this.catalog) throw new Error('steam_catalog_unavailable');
    const link = STEAM_LINK.exec(String(value).trim());
    const matches = link ? [this.catalog.get(Number(link[1]))].filter(Boolean) : [...this.catalog.values()].filter(app => fold(app.title) === fold(value));
    if (matches.length !== 1) throw new Error(matches.length ? 'steam_catalog_ambiguous' : 'steam_catalog_not_confirmed');
    return matches[0];
  }

  entryMetadata(appId, manual = null) {
    const synced = !this.settings().steam.checkLibrary ? 'disabled' : this.state.library === 'error' ? 'error' : this.owned?.has(appId) ? 'available' : 'unknown';
    return { appId, manual, syncedAvailability: synced, availability: manual === null ? synced : manual ? 'available' : 'absent' };
  }

  /** Як пакупка «дадаць пазіцыю» становіцца пазіцыяй: са Steam-каталогам — па спасылцы або дакладнай назве. */
  prepare(input) {
    if (this.settings().steam.onlySteam || this.isSteamLink(input)) {
      const app = this.resolve(input);
      return { resolvedTitle: app.title, entryMetadata: this.entryMetadata(app.appId) };
    }
    return { entryMetadata: { availability: this.settings().steam.checkLibrary ? 'unknown' : 'disabled' } };
  }
}
