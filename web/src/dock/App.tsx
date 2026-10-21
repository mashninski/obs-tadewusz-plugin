// Док Tadewusz для OBS: адна панэль на ўсё — галасаванне, бягучы радок, музыка, падключэнні і налады.
import { useEffect, useState } from 'preact/hooks';
import type { DockController } from '../music/ui/dock/controller';
import { MusicSettings } from '../music/ui/dock/MusicSettings';
import { PlayerTab } from '../music/ui/dock/PlayerTab';
import { useStore } from '../music/ui/shared/hooks';
import { ConnectionsTab } from './ConnectionsTab';
import { useCore } from './core';
import { SettingsTab } from './SettingsTab';
import { StatusTab } from './StatusTab';
import { TickerTab } from './TickerTab';
import { Dot } from './ui';
import { VotingTab } from './VotingTab';

const TABS = [
  { id: 'voting', label: 'Галасаванне' },
  { id: 'ticker', label: 'Радок' },
  { id: 'music', label: 'Музыка' },
  { id: 'connections', label: 'Падключэнні' },
  { id: 'settings', label: 'Налады' },
  { id: 'status', label: 'Стан' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const tabFromHash = (): TabId => {
  const id = location.hash.slice(1);
  return TABS.some((tab) => tab.id === id) ? (id as TabId) : 'voting';
};

export function App({ music }: { music: DockController }) {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const state = useCore();
  const spotify = useStore(music.spotify);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
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
        <button class="dots" title="Падключэнні" onClick={() => select('connections')}>
          <Dot tone={twitchTone} label="Twitch" />
          <Dot tone={obsTone} label="OBS" />
          <Dot tone={spotifyTone} label="Spotify" />
        </button>
      </header>
      <main class="content">
        {!state && tab !== 'music' ? (
          <p class="notice error">Праграма не адказвае. Яна запускаецца разам з OBS — праверце, ці ўключаны скрыпт Tadewusz у «Інструменты → Скрыпты».</p>
        ) : (
          <>
            {tab === 'voting' && state && <VotingTab state={state} />}
            {tab === 'ticker' && state && <TickerTab state={state} />}
            {tab === 'music' && (
              <>
                <PlayerTab controller={music} />
                <MusicSettings controller={music} />
              </>
            )}
            {tab === 'connections' && state && <ConnectionsTab state={state} music={music} />}
            {tab === 'settings' && state && <SettingsTab state={state} />}
            {tab === 'status' && state && <StatusTab state={state} music={music} />}
          </>
        )}
      </main>
    </div>
  );
}
