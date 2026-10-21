// Тэхнічныя звесткі музыкі для ўкладкі «Стан»: запіс стрыму без музыкі і падрабязнасці плэера.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { VodFixStep, VodReason, Verdict } from '../../obs/vod-track';
import { t, type MessageKey } from '../../i18n';
import { obsBrowserInfo } from '../shared/diag';
import { useNow, useStore } from '../shared/hooks';
import { clock } from '../shared/leader';
import type { DockController } from './controller';
import { Section } from './Section';
import { NO_MUSIC_NAME, OBS_BROWSER_EXE } from '../../obs/vod-track';

type Tone = '' | 'good' | 'bad' | 'muted';

function Row({ label, tone = '', children }: { label: string; tone?: Tone; children: ComponentChildren }) {
  return (
    <div class="kv">
      <span class="kv-label">{label}</span>
      <span class={`kv-value ${tone}`}>{children}</span>
    </div>
  );
}

/** Плэер відэа ў оверлэі паведамляе пра сябе раз у 5 с. */
const PLAYER_ALIVE_MS = 12_000;

/** Відэа YouTube: ці ёсць плэер у оверлэі і па якой крыніцы рухаецца хваля падчас відэа. */
function YouTubeBlock({ controller }: { controller: DockController }) {
  const youtube = useStore(controller.youtube);
  const chosen = useStore(controller.settings).video.audioSource;
  const alive = youtube.playerSeenAt > 0 && Date.now() - youtube.playerSeenAt < PLAYER_ALIVE_MS;
  const audio = chosen || (youtube.overlayAudio ? youtube.overlaySource : '');
  return (
    <>
      <h3 class="kv-group" title={t('diag.youtube.help')}>{t('diag.youtube')}</h3>
      <Row label={t('diag.youtube.player')} tone={alive ? 'good' : 'bad'}>
        {alive ? t('diag.youtube.player.ok') : t('diag.youtube.player.none')}
      </Row>
      <Row label={t('diag.youtube.audio')} tone={audio ? '' : 'muted'}>
        {audio || t('diag.youtube.audio.simulated')}
      </Row>
      <Row label={t('diag.youtube.overlays')} tone={youtube.overlays === 1 ? '' : 'bad'}>
        {t('diag.youtube.overlays.value', { n: youtube.overlays ?? 0, sound: youtube.soundOverlays ?? 0 })}
      </Row>
      {youtube.overlayVersions && (
        <Row label={t('diag.youtube.overlayVersion')} tone={youtube.overlayVersions === __APP_VERSION__ ? '' : 'bad'}>
          {youtube.overlayVersions}
        </Row>
      )}
      <Row label={t('diag.youtube.ads')} tone={youtube.ads ? 'bad' : 'good'}>
        {youtube.ads ? `${youtube.ads} · ${clock(youtube.lastAdAt)}` : 0}
      </Row>
      {youtube.searchMirror || youtube.searchFailedAt ? (
        <Row label={t('diag.youtube.search')} tone={youtube.searchFailedAt ? 'bad' : 'good'}>
          {youtube.searchFailedAt ? t('diag.youtube.search.failed', { time: clock(youtube.searchFailedAt) }) : youtube.searchMirror}
        </Row>
      ) : null}
      {youtube.lastError && youtube.lastErrorAt ? (
        <>
          <Row label={t('diag.youtube.lastError')} tone="bad">
            {clock(youtube.lastErrorAt)}
          </Row>
          <p class="muted small">{youtube.lastError}</p>
        </>
      ) : null}
    </>
  );
}

/** Тэкст аднаго кроку «Наладзіць» — тое, што стрымер убачыць да пацверджання. */
function stepText(step: VodFixStep): string[] {
  if (step.type === 'enable-vod') {
    const text = t(`vod.step.enable-vod.${step.mode}`, { track: step.vodTrack });
    return step.restart ? [text, t('vod.step.restart')] : [text];
  }
  if (step.type === 'create-no-music') {
    const lines = [t('vod.step.create', { name: NO_MUSIC_NAME, n: step.scenes.length })];
    return step.executables.includes(OBS_BROWSER_EXE) ? [...lines, t('vod.step.browser', { source: NO_MUSIC_NAME })] : lines;
  }
  if (step.type === 'exclusions') {
    const lines = [t('vod.step.exclusions', { source: step.source, list: step.executables.join(', ') })];
    return step.executables.includes(OBS_BROWSER_EXE) ? [...lines, t('vod.step.browser', { source: step.source })] : lines;
  }
  if (step.type === 'overlay-obs-audio') return [t('vod.step.overlayObs', { source: step.source })];
  const params = { source: step.source, track: step.vodTrack };
  if (!step.tracks[step.vodTrack - 1]) return [t('vod.step.offVod', params)];
  const onlyVod = step.tracks.every((on, n) => on === (n + 1 === step.vodTrack));
  return [t(onlyVod ? 'vod.step.onlyVod' : 'vod.step.toVod', params)];
}

const reasonText = (r: VodReason) => t(`vod.reason.${r.code}`, 'source' in r ? { source: r.source } : undefined);
const verdictTone = (v: Verdict): Tone => (v === 'safe' ? 'good' : v === 'leak' ? 'bad' : 'muted');

/** Запіс стрыму без музыкі: ці трапяць Spotify і відэа ў VOD Twitch, чаму і кнопка «Наладзіць». */
export function VodCard({ controller }: { controller: DockController }) {
  const vod = useStore(controller.vod);
  const obs = useStore(controller.obs);
  const [confirm, setConfirm] = useState(false);
  const connected = obs.status === 'connected';
  // Пры адкрыцці «Стану» — свежая праверка, не чакаючы планавай.
  useEffect(() => {
    if (connected) controller.checkVod();
  }, [connected]);
  useEffect(() => {
    if (!vod.plan.length) setConfirm(false);
  }, [vod.plan.length]);

  const report = connected ? vod.report : null;
  const actions =
    report && vod.plan.length && !confirm ? (
      <button class="btn" disabled={vod.fixing} onClick={() => setConfirm(true)}>
        {vod.fixing ? t('vod.fix.running') : t('vod.fix')}
      </button>
    ) : null;

  return (
    <Section title={t('diag.vod')} help={t('diag.vod.help')} actions={actions} collapsible open={report?.spotify === 'leak' || report?.video === 'leak'}>
      {!connected ? (
        <p class="muted small">{t('diag.vod.noObs')}</p>
      ) : !report ? (
        <p class="muted small">{vod.error ? t('diag.vod.error', { error: vod.error }) : t('diag.vod.checking')}</p>
      ) : (
        <>
          <Row label={t('diag.vod.spotify')} tone={verdictTone(report.spotify)}>
            {t(`diag.vod.${report.spotify}`)}
          </Row>
          <Row label={t('diag.vod.video')} tone={verdictTone(report.video)}>
            {t(`diag.vod.${report.video}`)}
          </Row>
          {report.vodEnabled && (
            <Row label={t('diag.vod.tracks')}>{t('diag.vod.tracks.value', { live: report.liveTrack, vod: report.vodTrack })}</Row>
          )}
          {report.reasons.length > 0 && (
            <ul class="vod-reasons small">
              {report.reasons.map((r, i) => (
                <li key={i} class={r.code === 'streaming' || r.code === 'no-overlay' ? 'muted' : ''}>
                  {reasonText(r)}
                </li>
              ))}
            </ul>
          )}
          {vod.fixError && <p class="bad small">{t('vod.fix.failed', { error: vod.fixError })}</p>}
          {confirm && vod.plan.length > 0 && (
            <div class="vod-confirm">
              <p class="small">{t('vod.fix.title')}</p>
              <ul class="vod-reasons small">
                {vod.plan.flatMap(stepText).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <div class="row-actions">
                <button
                  class="btn primary"
                  disabled={vod.fixing}
                  onClick={() => {
                    setConfirm(false);
                    controller.fixVod();
                  }}
                >
                  {t('vod.fix.apply')}
                </button>
                <button class="btn" onClick={() => setConfirm(false)}>
                  {t('vod.fix.cancel')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

export function MusicDiagnostics({ controller }: { controller: DockController }) {
  useNow(1000);
  const channel = useStore(controller.channel);
  const obs = useStore(controller.obs);
  const leader = useStore(controller.leader);
  const conflicts = useStore(controller.conflicts);
  const spotify = useStore(controller.spotify);
  const twitch = useStore(controller.twitch);
  const env = obsBrowserInfo();

  const where = !leader ? 'none' : leader.id === controller.id ? `here.${leader.page}` : leader.page;
  const windowTone: Tone = spotify.windowWatch === 'ok' ? 'good' : 'muted';
  const eventsTone: Tone = twitch.events === 'ok' ? 'good' : twitch.events === 'off' ? 'bad' : 'muted';

  return (
    <Section title="Музыка · падрабязнасці" collapsible help={t('diag.brain.help')}>
      <h3 class="kv-group">{t('diag.brain')}</h3>
      <Row label={t('diag.brain.where')} tone={where === 'none' ? 'bad' : ''}>
        {t(`diag.brain.where.${where}` as MessageKey)}
      </Row>
      {leader && <Row label={t('diag.brain.since')}>{clock(leader.since)}</Row>}
      <Row label={t('diag.brain.version')}>{__APP_VERSION__}</Row>
      {!controller.locksSupported && (
        <Row label={t('diag.brain.choice')} tone="bad">
          {t('diag.brain.dockOnly')}
        </Row>
      )}
      {conflicts > 0 && (
        <Row label={t('diag.brain.conflicts')} tone="bad">
          {conflicts}
        </Row>
      )}

      {twitch.status !== 'off' && (
        <>
          <h3 class="kv-group" title={t('diag.twitch.help')}>{t('diag.twitch')}</h3>
          <Row label={t('diag.twitch.events')} tone={eventsTone}>
            {t(`diag.twitch.events.${twitch.events}`)}
          </Row>
          <Row label={t('diag.twitch.lastEvent')} tone={twitch.lastEventAt ? '' : 'muted'}>
            {twitch.lastEventAt ? clock(twitch.lastEventAt) : t('diag.none')}
          </Row>
          <Row label={t('diag.twitch.pending')} tone={twitch.pending ? 'bad' : ''}>
            {twitch.pending}
          </Row>
        </>
      )}

      {spotify.status !== 'off' && (
        <>
          <h3 class="kv-group" title={t('diag.spotify.help')}>{t('diag.spotify')}</h3>
          <Row label={t('diag.spotify.requests')}>{spotify.requestsToday}</Row>
          <Row label={t('diag.spotify.window')} tone={windowTone}>
            {t(`diag.spotify.window.${spotify.windowWatch}`)}
          </Row>
        </>
      )}

      <YouTubeBlock controller={controller} />

      <h3 class="kv-group" title={t('diag.obs.help')}>{t('diag.obs')}</h3>
      <Row label={t('diag.obs.page')}>{env.inObs ? env.version : t('diag.obs.notObs')}</Row>
      <Row label="obs-websocket" tone={obs.version ? '' : 'muted'}>
        {obs.version || t('diag.none')}
      </Row>
      <Row label={t('diag.obs.channel')} tone={channel.mode === 'none' ? 'muted' : ''}>
        {t(`diag.obs.channel.${channel.mode}`)}
      </Row>
      <Row label={t('diag.obs.sent')}>{channel.sent}</Row>
      <Row label={t('diag.obs.errors')} tone={channel.errors ? 'bad' : ''}>
        {channel.errors}
      </Row>
      {channel.lastError && <p class="muted small mono">{channel.lastError}</p>}
    </Section>
  );
}
