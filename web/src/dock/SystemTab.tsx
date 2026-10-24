// Укладка «Сістэма»: стан праграмы, падключэнні і налады ў адным месцы — трыма раздзеламі-акардэонамі.
// «Стан» заўсёды адкрыты і стаіць першым; «Падключэнне» згортваецца само, калі ўсё падключана; «Налады» згорнутыя.
import type { DockController } from '../music/ui/dock/controller';
import { useStore } from '../music/ui/shared/hooks';
import { ConnectionsSection } from './ConnectionsSection';
import type { CoreState } from './core';
import { SettingsSection } from './SettingsSection';
import { StatusSection } from './StatusSection';
import { Dot, Group, type Tone } from './ui';

export function SystemTab({ state, music, focusConnections }: { state: CoreState; music: DockController; focusConnections: number }) {
  const spotify = useStore(music.spotify);
  const services: { name: string; tone: Tone }[] = [
    { name: 'Twitch', tone: state.twitch.state === 'connected' ? (state.eventsub === 'connected' ? 'good' : 'wait') : 'bad' },
    { name: 'OBS', tone: state.obs.connected ? 'good' : 'bad' },
    // Spotify неабавязковы: не падключаны (off) — не праблема, праблема — памылка або доўгае падключэнне.
    { name: 'Spotify', tone: spotify.status === 'ok' ? 'good' : spotify.status === 'off' ? 'off' : spotify.status === 'connecting' ? 'wait' : 'bad' },
  ];
  const missing = services.filter((s) => s.tone === 'bad' || s.tone === 'wait').map((s) => s.name);
  const allConnected = missing.length === 0;

  return (
    <>
      <Group title="Стан">
        <StatusSection state={state} music={music} />
      </Group>

      <Group title="Падключэнне" collapsible open={!allConnected} force={focusConnections}
        summary={<>
          <span class="group-dots">{services.map((s) => <Dot key={s.name} tone={s.tone} label={s.name} />)}</span>
          {allConnected ? 'усё падключана' : `не гатова: ${missing.join(', ')}`}
        </>}>
        <ConnectionsSection state={state} music={music} />
      </Group>

      <Group title="Налады" collapsible open={false} summary="узнагароды, загалоўкі, адказы, выгляд">
        <SettingsSection state={state} />
      </Group>
    </>
  );
}
