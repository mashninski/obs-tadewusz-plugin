// Збор праграмы: сховішча, Twitch, OBS, галасаванне, бягучы радок, музыка і HTTP.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './storage/database.js';
import { Backups } from './storage/backups.js';
import { lockDataDirectory } from './storage/lock.js';
import { defaults, validateSettings } from './storage/settings.js';
import { WindowsVault } from './storage/vault.js';
import { createLogger, errorCode } from './util/log.js';
import { TwitchClient } from './twitch/client.js';
import { EventSub } from './twitch/eventsub.js';
import { Voting } from './voting/voting.js';
import { Notifications } from './voting/notifications.js';
import { Bindings, VotingReception } from './voting/reception.js';
import { Ticker } from './ticker/ticker.js';
import { TickerReception } from './ticker/reception.js';
import { tickerSourceStatus } from './obs/ticker-source.js';
import { Obs } from './obs/obs.js';
import { Steam } from './steam/steam.js';
import { MusicBridge } from './music/bridge.js';
import { LegacyMusicRewards } from './music/legacy-rewards.js';
import { replyDefinitions, replyPlaceholders } from './chat/templates.js';
import { startServer } from './http/server.js';
import { routes } from './http/routes.js';

/** Аперацыі, якія ідуць да Twitch, выконваюцца па чарзе — без пераплятання зверкі, outbox і каманд дока. */
function serialQueue() {
  let tail = Promise.resolve();
  const run = fn => {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  };
  run.idle = () => tail;
  return run;
}

export async function createApp({ dataDir, webRoot, port = 18745, version = 'dev', vault: injectedVault, fetchImpl = fetch,
  Socket = globalThis.WebSocket, autoStart = true, echoLog = false, backupDirectory }) {
  mkdirSync(dataDir, { recursive: true });
  const releaseLock = await lockDataDirectory(dataDir);
  const log = createLogger(join(dataDir, 'logs'), { echo: echoLog });
  let store;
  try { store = new Store(join(dataDir, 'obs-bot.sqlite')); }
  catch (error) { await releaseLock(); throw error; }

  // Налады: старая схема пераўтвараецца ў бягучую адзін раз.
  const settings = () => validateSettings(store.get('settings', defaults));
  const saved = store.get('settings', null);
  if (saved && JSON.stringify(saved) !== JSON.stringify(settings())) store.set('settings', settings());
  const saveSettings = value => store.transaction(() => store.set('settings', validateSettings(value)));
  let session = store.get('http.session', null);
  if (!session) { session = randomBytes(32).toString('hex'); store.set('http.session', session); }

  const backups = new Backups(store, { dataDir, external: () => backupDirectory ?? settings().backup.directory, log });
  store.durable = () => backups.touch();
  backups.checkpoint();

  const vault = injectedVault ?? new WindowsVault(dataDir, { log });
  const twitch = new TwitchClient({ vault, settings, fetchImpl, log });
  const eventsub = new EventSub({ twitch, Socket, log });
  const bindings = new Bindings(store);
  const notifications = new Notifications({ store, settings });
  const voting = new Voting({ store, notify: event => notifications.show(event) });
  const steam = new Steam({ vault, settings, saveSettings, fetchImpl });
  const votingReception = new VotingReception({
    store, voting, twitch, eventsub, settings, bindings, log,
    prepare: (event, role) => (role === 'add' ? steam.prepare(event.user_input) : {}),
  });
  const ticker = new Ticker({ store, log });
  const tickerReception = new TickerReception({ store, ticker, twitch, eventsub, bindings, log });
  const obs = new Obs({ url: () => settings().obs.url, password: async () => (await vault.get('obsPassword')) ?? '', log });
  const ownedRewardIds = () => { try { return bindings.ids(twitch.account()); } catch { return []; } };
  const music = new MusicBridge({
    twitch, eventsub, ownedRewardIds, log,
    obsSettings: async () => ({ url: settings().obs.url, password: (await vault.get('obsPassword')) ?? '' }),
  });

  /** Пры спыненні і выхадзе з Twitch: усе ўзнагароды праграмы на паўзу (музыкі — таксама). */
  const pauseAllRewards = async () => {
    if (!twitch.connected) return;
    try {
      await votingReception.shutdown();
      await tickerReception.shutdown();
      for (const reward of await twitch.rewards())
        if (!reward.is_paused) await twitch.updateReward(reward.id, { is_paused: true });
    } catch (error) {
      log('warn', 'rewards.pause_all', errorCode(error));
    }
  };

  const legacyMusic = new LegacyMusicRewards({ store, fetchImpl, log });

  const run = serialQueue();
  eventsub.onEvent((type, event, messageId) => run(async () => {
    try {
      if (!(await votingReception.onEvent(type, event, messageId))) await tickerReception.onEvent(type, event, messageId);
    } catch (error) {
      log('warn', 'event.failed', errorCode(error));
    }
  }));

  // Twitch: падключэнне пры запуску і паўторы пры часовых збоях (сетка, сховішча).
  let authRetryAt = 0, authAttempt = 0;
  const connectTwitch = async () => {
    try {
      await twitch.credentials();
      authAttempt = 0;
      if (eventsub.state === 'off') eventsub.start();
    } catch (error) {
      if (error.message === 'twitch_connect_required') { eventsub.stop(); authRetryAt = Infinity; return; }
      authRetryAt = Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(authAttempt++, 6));
      log('warn', 'twitch.connect', errorCode(error));
    }
  };
  twitch.onChange(status => { if (status.state === 'disconnected') eventsub.stop(); });

  let tickerCheckAt = 0, tickerSourceName = null, tickerRefreshTried = false;
  const checkTickerSource = async () => {
    if (Date.now() < tickerCheckAt) return;
    tickerCheckAt = Date.now() + 3000;
    const proof = await tickerSourceStatus(obs, ticker.source);
    ticker.setReady(proof);
    tickerSourceName = proof.name ?? null;
    // Крыніца ёсць у эфіры, а старонка не адказвае (напрыклад, адкрылася раней за ядро) — адзін раз абнавіць яе.
    if (proof.source && !ticker.consumer() && tickerSourceName && !tickerRefreshTried) {
      tickerRefreshTried = true;
      obs.refreshBrowser(tickerSourceName).catch(() => {});
    }
    if (ticker.consumer()) tickerRefreshTried = false;
  };

  let stopping = false;
  const loop = async () => {
    if (stopping) return;
    await obs.tick().catch(() => {});
    await checkTickerSource().catch(() => {});
    ticker.tick();
    await run(async () => {
      if (!twitch.connected && Date.now() >= authRetryAt) await connectTwitch();
      await votingReception.tick();
      await tickerReception.tick();
      backups.tick();
    });
  };
  let looping = false;
  const timer = setInterval(() => {
    if (looping) return;
    looping = true;
    loop().catch(error => log('warn', 'loop.failed', errorCode(error))).finally(() => { looping = false; });
  }, 1000);

  const http = await startServer({
    port, webRoot, session, version, log,
    ...routes({
      store, settings, saveSettings, vault, twitch, eventsub, voting, votingReception, ticker, tickerReception, notifications, obs,
      steam, music, legacyMusic, backups, run, version, replyDefinitions, replyPlaceholders, pauseAllRewards, onTwitchLogin: () => { authRetryAt = 0; },
      baseUrl: () => http?.origin,
    }),
  }).catch(async error => {
    clearInterval(timer);
    store.close();
    await releaseLock();
    throw error;
  });
  steam.baseUrl = http.origin;
  if (autoStart) obs.start();
  log('info', 'app.started', version);

  let closing;
  const close = () => closing ??= (async () => {
    stopping = true;
    clearInterval(timer);
    await run.idle();
    await run(pauseAllRewards);
    eventsub.stop();
    obs.stop();
    music.close();
    await http.close();
    try { backups.checkpoint(); } catch {}
    await vault.flush?.().catch(() => {});
    store.close();
    await releaseLock();
    log('info', 'app.stopped');
  })();

  return { origin: http.origin, store, voting, ticker, twitch, eventsub, votingReception, tickerReception, backups, close };
}
