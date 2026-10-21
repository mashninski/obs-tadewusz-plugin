// Укладка «Стан»: падключэнні, рэзервовыя копіі, адрасы для OBS, гісторыя і праверка музыкі.
import { useState } from 'preact/hooks';
import { CopyRow } from '../music/ui/dock/MusicSettings';
import { DiagnosticsTab } from '../music/ui/dock/DiagnosticsTab';
import type { DockController } from '../music/ui/dock/controller';
import { Section } from '../music/ui/dock/Section';
import { api, useAction, type CoreState } from './core';
import { dateTime, Notice, Row } from './ui';

export function StatusTab({ state, music }: { state: CoreState; music: DockController }) {
  const { notice, run } = useAction();
  const [month, setMonth] = useState('');
  const [history, setHistory] = useState<CoreState['history'] | null>(null);
  const pending = state.reception.outbox.reduce((n, row) => n + row.count, 0);

  const exportData = () => run(async () => {
    const data = await api('/api/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `tadewusz-galasavanne-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'Экспарт гатовы');

  return (
    <div class="status">
      <Section title="Праграма">
        <Row label="Версія">{state.version}</Row>
        <Row label="Twitch" tone={state.twitch.state === 'connected' ? 'good' : 'bad'}>{state.twitch.login ?? 'не падключаны'}</Row>
        <Row label="Падзеі Twitch" tone={state.eventsub === 'connected' ? 'good' : 'bad'}>{state.eventsub}</Row>
        <Row label="OBS" tone={state.obs.connected ? 'good' : 'bad'}>{state.obs.connected ? (state.obs.streaming ? 'эфір ідзе' : 'падключаны') : 'не падключаны'}</Row>
        <Row label="Апошняя зверка" tone={state.reception.reconciledAt ? '' : 'muted'}>{state.reception.reconciledAt ? dateTime(state.reception.reconciledAt) : '—'}</Row>
        <Row label="Чакаюць Twitch" tone={pending ? 'bad' : ''}>{pending}</Row>
      </Section>

      <Section title="Рэзервовыя копіі">
        <Row label="Апошняя" tone={state.backups.error ? 'bad' : ''}>{state.backups.at ? dateTime(state.backups.at) : '—'}{state.backups.error ? ' · памылка' : ''}</Row>
        <Row label="Дзённая">{state.backups.daily ? dateTime(state.backups.daily) : '—'}</Row>
        <Row label="Тэчка">{state.backups.external}</Row>
        <div class="row-actions">
          <button class="btn" onClick={() => run(() => api('/api/backup'), 'Копія зроблена і праверана')}>Зрабіць копію зараз</button>
          <button class="btn" onClick={() => void exportData()}>Экспарт JSON</button>
        </div>
        <Notice notice={notice} />
      </Section>

      <Section title="Адрасы для OBS" help="Крыніцы «Браўзер» у OBS. Лепш дадаваць іх праз старонку чакання obs/start.html — тады яны загрузяцца нават калі OBS адкрыўся раней за праграму.">
        <div class="field"><span>Док</span><CopyRow value={state.urls.dock} /></div>
        <div class="field"><span>Галасаванне</span><CopyRow value={state.urls.overlay} /></div>
        <div class="field"><span>Бягучы радок</span><CopyRow value={state.urls.ticker} /></div>
        <div class="field"><span>Музыка</span><CopyRow value={state.urls.music} /></div>
      </Section>

      <Section title="Гісторыя">
        <form class="inline" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const response = await fetch(`/api/history?month=${encodeURIComponent(month)}`);
            setHistory((await response.json()).history);
          }, '');
        }}>
          <input type="month" value={month} aria-label="Месяц" onInput={(e) => setMonth(e.currentTarget.value)} />
          <button class="btn" disabled={!month}>Паказаць месяц</button>
        </form>
        <ul class="history">
          {(history ?? state.history).map((item) => <li key={item.id}><span class="muted">{dateTime(item.at)}</span> {item.event}</li>)}
        </ul>
      </Section>

      <DiagnosticsTab controller={music} />
    </div>
  );
}
