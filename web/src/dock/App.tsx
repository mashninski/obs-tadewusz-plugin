// Док Tadewusz для OBS: адна панэль на ўсё — галасаванне, бягучы радок, музыка, інтро / аўтра, сезон і «Сістэма» (стан, падключэнні, налады).
import { useEffect, useState } from 'preact/hooks';
import type { DockController } from '../music/ui/dock/controller';
import { MusicHero, MusicRules, MusicSound } from '../music/ui/dock/MusicSettings';
import { PlayerTab } from '../music/ui/dock/PlayerTab';
import { useStore } from '../music/ui/shared/hooks';
import { useCore } from './core';
import { IntroTab } from './IntroTab';
import { SeasonTab } from './SeasonTab';
import { SystemTab } from './SystemTab';
import { TickerTab } from './TickerTab';
import { Dot, Hero, toast, Toasts } from './ui';
import { VotingTab } from './VotingTab';

const TABS = [
  { id: 'voting', label: 'Галасаванне' },
  { id: 'ticker', label: 'Радок' },
  { id: 'music', label: 'Музыка' },
  { id: 'intro', label: 'Інтро / Аўтра' },
  { id: 'season', label: 'Сезон' },
  { id: 'system', label: 'Сістэма' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Ранейшыя ўкладкі цяпер раздзелы «Сістэмы»; `#connections` (так вяртаюцца Spotify і YouTube) адкрывае падключэнні. */
const OLD_TABS = ['connections', 'settings', 'status'];

const tabFromHash = (): TabId => {
  const id = location.hash.slice(1);
  if (OLD_TABS.includes(id)) return 'system';
  return TABS.some((tab) => tab.id === id) ? (id as TabId) : 'voting';
};

export function App({ music }: { music: DockController }) {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [focusConnections, setFocusConnections] = useState(() => (location.hash === '#connections' ? 1 : 0));
  const state = useCore();
  const spotify = useStore(music.spotify);

  // Паведамленні музыкі (замова адхілена, Spotify не адказаў…) — тымі ж усплывальнымі паведамленнямі, што і ўвесь док.
  useEffect(() => music.notice.subscribe((n) => n && toast(n.text, n.kind === 'error')), [music]);

  useEffect(() => {
    const onHash = () => {
      if (location.hash === '#connections') {
        setFocusConnections((n) => n + 1);
        history.replaceState(null, '', '#system');
      }
      setTab(tabFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: TabId) => {
    history.replaceState(null, '', `#${id}`);
    setTab(id);
  };

  const twitchTone = !state ? 'off' : state.twitch.state === 'connected' ? (state.eventsub === 'connected' ? 'good' : 'wait') : 'bad';
  const obsTone = !state ? 'off' : state.obs.connected ? 'good' : 'bad';
  const spotifyTone = spotify.status === 'ok' ? 'good' : spotify.status === 'off' ? 'off' : spotify.status === 'connecting' ? 'wait' : 'bad';

  return (
    <div class="dock">
      <header class="topbar">
        <nav class="tabs" role="tablist">
          {TABS.map((item) => (
            <button key={item.id} role="tab" aria-selected={tab === item.id} class={tab === item.id ? 'tab active' : 'tab'} onClick={() => select(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <button class="dots" title="Падключэнне" onClick={() => { select('system'); setFocusConnections((n) => n + 1); }}>
          <Dot tone={twitchTone} label="Twitch" />
          <Dot tone={obsTone} label="OBS" />
          <Dot tone={spotifyTone} label="Spotify" />
        </button>
      </header>
      <main class="content">
        {!state && tab !== 'music' ? (
          <Hero tone="bad" title="Праграма не адказвае" detail="Яна запускаецца разам з OBS — праверце скрыпт Tadewusz у «Інструменты → Скрыпты»" />
        ) : (
          <>
            {tab === 'voting' && state && <VotingTab state={state} />}
            {tab === 'ticker' && state && <TickerTab state={state} />}
            {tab === 'music' && (
              <>
                <MusicHero controller={music} />
                <PlayerTab controller={music} />
                <MusicRules controller={music} />
                <MusicSound controller={music} />
              </>
            )}
            {tab === 'intro' && state && <IntroTab state={state} />}
            {tab === 'season' && state && <SeasonTab state={state} />}
            {tab === 'system' && state && <SystemTab state={state} music={music} focusConnections={focusConnections} />}
          </>
        )}
      </main>
      <Toasts />
    </div>
  );
}
