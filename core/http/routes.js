// API дока і оверлеяў.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ensureIntroScene } from '../obs/intro-scene.js';
import { ensureSeasonSource } from '../obs/season-source.js';

const bool = value => { if (typeof value !== 'boolean') throw new Error('value_format'); return value; };
const id = value => { if (typeof value !== 'string' || !value || value.length > 100) throw new Error('value_format'); return value; };

export function routes(ctx) {
  const { store, settings, saveSettings, vault, twitch, eventsub, voting, votingReception, ticker, tickerReception, voice, notifications,
    obs, steam, music, legacyMusic, intro, season, backups, run, version, replyDefinitions, replyPlaceholders, pauseAllRewards, onTwitchLogin, baseUrl,
    introSourceUrl, pageSourceUrl } = ctx;

  const state = () => {
    const vote = voting.snapshot();
    return {
      version, settings: settings(), vote, reviews: voting.reviews(),
      carryPreview: vote.carryPending ? voting.previewCarry() : null,
      reception: votingReception.snapshot(),
      ticker: { ...ticker.snapshot(), reception: tickerReception.snapshot() },
      voice: voice.snapshot(),
      twitch: { ...twitch.status, login: twitch.identity?.login ?? null, flow: !!twitch.flow },
      legacyMusicRewards: !!legacyMusic.clientId(),
      eventsub: eventsub.state,
      obs: obs.state,
      steam: steam.state,
      backups: backups.snapshot(),
      intro: intro.snapshot(),
      season: season.snapshot(),
      history: store.history(),
      replyDefinitions, replyPlaceholders,
      urls: {
        dock: `${baseUrl()}/`, overlay: `${baseUrl()}/overlay`, ticker: `${baseUrl()}/ticker?source=${ticker.source}`,
        music: `${baseUrl()}/music`, intro: `${baseUrl()}/intro`, season: `${baseUrl()}/season`,
        // Фон для любой сцэны: праз старонку чакання — загрузіцца, нават калі OBS адкрыўся раней за праграму.
        background: pageSourceUrl('background'), spotifyRedirect: `${baseUrl()}/callback.html`,
      },
    };
  };

  const get = {
    '/api/state': () => state(),
    '/api/history': url => {
      const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : undefined;
      const history = store.history({ month: url.searchParams.get('month') || undefined, before, limit: 200 });
      return { history, next: history.length === 200 ? history.at(-1).id : null };
    },
    '/overlay/state': () => {
      const vote = voting.snapshot(), display = settings().display, selection = store.get('display.selection', null);
      const headlineActive = selection && selection.at + display.headlineDuration * 1000 > Date.now();
      const countdown = vote.deadline && vote.status !== 'closed';
      // Закрыты раўнд: оверлей разыгрывае сцэнарый (пераможца, выбылыя) і трымае вынік да новага раўнда.
      const result = vote.status === 'closed' ? vote.result : null;
      const winner = result?.ranked?.find(e => e.id === result.winnerId);
      const show = result ? {
        roundId: vote.roundId, closedAt: result.closedAt,
        winner: winner ? { id: winner.id, title: winner.title } : null,
        removed: result.carryPolicy === 'pending' ? voting.previewCarry().filter(s => s.removed).map(s => ({ id: s.id, title: s.title })) : [],
      } : null;
      return {
        vote: { roundId: vote.roundId, status: vote.status, deadline: vote.deadline, serverNow: vote.serverNow, show,
          entries: vote.entries.map(e => ({ id: e.id, code: e.code, title: e.title, score: e.score, availability: e.availability })) },
        display, notification: countdown || headlineActive ? null : notifications.current(), headlineSelection: selection,
      };
    },
    // Оверлей інтро: налады (апытанне), спіс кліпаў (калі змяніўся) і знак «сцэна стала актыўнай».
    '/intro/state': () => intro.overlayState(),
    '/intro/clips': () => intro.clips(),
    // Актывацыя сцэны і кожныя ~5 хвілін, пакуль яна ў эфіры: абнавіць спіс кліпаў (не часцей за раз у хвіліну).
    '/intro/activate': () => { intro.refresh().catch(() => {}); return { ok: true }; },
    // Старонка «Сезон»: налады і адрасы сваіх карцінак бягучай тэмы (апытанне).
    '/season/state': () => season.overlayState(),
    '/season/image': (url, res) => {
      const { bytes, type } = season.read(url.searchParams.get('theme'), url.searchParams.get('name'));
      // SVG стрымера не павінен выконваць скрыпты, нават калі адкрыць яго адрас напрамую.
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
      res.end(bytes);
    },
    '/steam/callback': async (url, res) => {
      try { await steam.callback(url.searchParams); } catch {}
      res.writeHead(303, { Location: '/' });
      res.end();
    },
    // Аўдыя голасу для старонкі радка і для «Праслухаць» у доку.
    '/ticker/audio': async (url, res) => {
      let bytes;
      try { bytes = await readFile(voice.file(url.searchParams.get('id'))); } catch { throw new Error('voice_audio'); }
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    },
    '/api/music/identity': () => music.identity(),
    '/api/music/obs': () => music.obs(),
    '/api/music/events': (url, res) => { music.attach(res); },
    // Аднаразовы перанос налад і ўваходу Spotify са старога spotify-бота (захоўваецца ў DPAPI да першага чытання).
    '/api/music/import': async () => ({ entries: (await vault.get('musicImport'))?.entries ?? null }),
  };

  const post = {
    // --- Налады і падключэнні ---
    '/api/settings': async body => {
      const before = settings();
      saveSettings({ ...body, schemaVersion: 4 });
      const after = settings();
      if (after.obs.url !== before.obs.url) obs.disconnect();
      if (after.twitch.clientId !== before.twitch.clientId) await run(() => twitch.disconnect());
      return { saved: true };
    },
    '/api/secret': async body => {
      if (!['obsPassword', 'steamKey'].includes(body.key) || typeof body.value !== 'string' || body.value.length > 1024) throw new Error('secret_format');
      await vault.set(body.key, body.value || null);
      if (body.key === 'obsPassword') obs.disconnect();
      return { saved: true };
    },
    '/api/twitch/login': () => twitch.startLogin(),
    '/api/twitch/poll': async () => {
      const result = await twitch.pollLogin();
      if (result.connected) {
        votingReception.unblockAccess();
        tickerReception.unblockAccess();
        onTwitchLogin();
      }
      return result;
    },
    '/api/twitch/disconnect': () => run(async () => {
      await pauseAllRewards();
      await twitch.disconnect();
    }),
    '/api/obs/reconnect': () => { obs.disconnect(); return { ok: true }; },

    // --- Галасаванне ---
    '/api/voting/start': () => run(async () => {
      if (votingReception.rewardIds().length !== votingReception.roles().length) await votingReception.syncRewards();
      votingReception.setWanted(true);
      if (voting.current().status === 'paused') voting.pause(false);
      await votingReception.applyRewardState(true).catch(() => {});
      return votingReception.snapshot();
    }),
    '/api/voting/stop': () => run(async () => {
      votingReception.setWanted(false);
      if (voting.current().status === 'open') voting.pause(true);
      await votingReception.applyRewardState(true).catch(() => {});
      return votingReception.snapshot();
    }),
    '/api/voting/sync-rewards': () => run(() => votingReception.syncRewards()),
    '/api/vote/add': body => {
      let title = body.title, metadata = { availability: 'disabled' };
      if (settings().steam.onlySteam || steam.isSteamLink(title)) {
        const app = steam.resolve(title);
        title = app.title;
        metadata = steam.entryMetadata(app.appId);
      }
      return voting.add(title, metadata, { user: twitch.identity?.login ?? '' });
    },
    '/api/vote/edit': body => voting.edit(id(body.id), body.score),
    '/api/vote/rename': body => voting.rename(id(body.id), body.title),
    '/api/vote/move': body => voting.move(id(body.from), id(body.to)),
    '/api/vote/removal-info': body => voting.removalInfo(id(body.id)),
    '/api/vote/remove': body => run(async () => {
      const result = voting.remove(id(body.id), { burn: body.burn === true });
      await votingReception.drain().catch(() => {});
      return result;
    }),
    '/api/vote/availability': body => voting.availability(id(body.id), body.manual),
    '/api/vote/countdown': body => {
      const seconds = body.seconds ?? 60;
      if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error('countdown_value');
      return voting.startCountdown(seconds);
    },
    '/api/vote/countdown/cancel': () => voting.cancelCountdown(),
    '/api/vote/close': () => { voting.beginFinalization(); return { finalizing: true }; },
    '/api/vote/next': () => ({ roundId: voting.openNext() }),
    '/api/vote/review': body => voting.resolveReview(id(body.id)),
    '/api/headline/show': body => {
      const texts = settings().display.headlines;
      if (!Number.isInteger(body.index) || !texts[body.index]) throw new Error('display_headlines');
      store.transaction(() => {
        notifications.release();
        store.set('display.selection', { id: randomBytes(12).toString('hex'), index: body.index, text: texts[body.index], at: Date.now() });
      });
      return { shown: true };
    },

    // --- Бягучы радок ---
    '/api/ticker/config': body => ticker.save(body),
    '/api/ticker/show': body => ticker.manual(id(body.id)),
    '/api/ticker/cancel': body => ticker.cancel(body),
    '/api/ticker/retry': () => ticker.retry(),
    '/api/ticker/sync-reward': () => run(() => tickerReception.syncReward()),
    '/api/ticker/reception': body => run(async () => {
      tickerReception.setWanted(bool(body.on));
      await tickerReception.applyRewardState().catch(() => {});
      return tickerReception.snapshot();
    }),
    '/ticker/heartbeat': body => ticker.heartbeat(body),

    // --- Голас (OmniVoice) ---
    '/api/voice/config': body => voice.save(body),
    '/api/voice/restart': () => { voice.stop(); voice.failures = 0; voice.restartAt = 0; return { restarted: true }; },
    '/api/voice/test': async body => {
      if (voice.wake()) throw new Error('voice_waking');
      const text = typeof body.text === 'string' && body.text.trim() ? body.text.trim().slice(0, 200) : 'Прывітанне! Так гучыць голас для паведамленняў гледачоў.';
      return voice.test(randomUUID(), text, typeof body.persona === 'string' ? body.persona : voice.pick());
    },
    '/ticker/ack': body => ticker.acknowledge(body),

    // --- Інтро ---
    '/api/intro/config': body => intro.save(body),
    '/api/intro/restart': () => intro.restartCountdown(),
    '/api/intro/refresh': async () => {
      await intro.refresh({ force: true });
      if (intro.error) throw new Error(intro.error);
      return intro.snapshot();
    },
    '/api/intro/scene': () => ensureIntroScene(obs, { url: introSourceUrl() }),

    // --- Сезон ---
    '/api/season/config': body => season.save(body),
    '/api/season/upload': body => season.upload(body),
    '/api/season/remove': body => season.remove(body),
    '/api/season/source': () => ensureSeasonSource(obs, { url: pageSourceUrl('season') }),

    // --- Steam ---
    '/api/steam/login': () => ({ uri: steam.loginUrl() }),
    '/api/steam/library': () => steam.library(),
    '/api/steam/catalog': () => steam.syncCatalog(),
    '/api/steam/search': body => ({ apps: steam.search(body.query) }),

    // --- Даныя ---
    '/api/backup': () => backups.checkpoint(),
    '/api/export': () => ({
      version: 2, exportedAt: new Date().toISOString(), vote: voting.snapshot(),
      rounds: store.db.prepare('SELECT id,opened,closed,status,result FROM rounds').all(),
      ledger: store.db.prepare('SELECT at,round_id,entry_id,delta,reason FROM ledger').all(),
      purchases: store.db.prepare('SELECT purchased,delivered,round_id,entry_id,cost,status,decision FROM purchases').all(),
    }),

    // --- Музыка ---
    '/api/music/helix': body => music.helix(body),
    '/api/music/legacy/start': () => legacyMusic.start(),
    '/api/music/legacy/poll': () => legacyMusic.poll(),
    '/api/music/import/done': async () => { await vault.set('musicImport', null); return { done: true }; },
  };

  // Карцінка «Сезона» (да 2 МБ) прыходзіць у base64 — гэтаму маршруту можна больш.
  return { get, post, limits: { '/api/season/upload': 3 * 1024 * 1024 } };
}
