// «Сістэма → Стан»: як працуе праграма — зверка з Twitch, чарга адказаў, рэзервовыя копіі, гісторыя, адрасы і музыка.
// Зверху — кампактная зводка; падрабязнасці — у згорнутых картках. Уваходы ў сэрвісы — у раздзеле «Падключэнне».
import { useState } from 'preact/hooks';
import type { DockController } from '../music/ui/dock/controller';
import { MusicDiagnostics, VodCard } from '../music/ui/dock/Diagnostics';
import { CopyRow } from '../music/ui/dock/MusicSettings';
import { useStore } from '../music/ui/shared/hooks';
import { api, errorText, run, useDraft, type CoreState } from './core';
import { Card, dateTime, Hero, Row, toast, type Tone } from './ui';

/** Што зараз не так — першы радок ідзе ў шапку. */
function problems(state: CoreState, musicAlive: boolean): string[] {
  const list: string[] = [];
  if (state.twitch.state !== 'connected') list.push('Twitch не падключаны');
  else if (state.eventsub !== 'connected') list.push('Падзеі Twitch не ідуць — пакупкі даганяюцца зверкай');
  if (!state.obs.connected) list.push('OBS не падключаны');
  if (state.reception.outbox.some((row) => row.error)) list.push('Twitch не прымае адказы — гл. «Чакаюць Twitch»');
  if (state.backups.error) list.push('Рэзервовая копія не запісалася');
  if (!musicAlive) list.push('Плэер музыкі не адказвае');
  return list;
}

export function StatusSection({ state, music }: { state: CoreState; music: DockController }) {
  const leader = useStore(music.leader);
  const list = problems(state, !!leader);
  const pending = state.reception.outbox.reduce((n, row) => n + row.count, 0);
  const tone: Tone = list.length ? 'bad' : 'good';

  return (
    <>
      <Hero tone={tone} title={list.length ? list[0] : 'Усё працуе'}
        detail={list.length > 1 ? `І яшчэ ${list.length - 1}: ${list.slice(1).join(' · ')}` : `Tadewusz ${state.version}`} />

      <Card title="Праца з Twitch" help="Праграма звярае пакупкі з Twitch пры кожным падключэнні і пасля раўнда, таму пакупка не губляецца, нават калі падзея не дайшла. «Чакаюць Twitch» — пацверджанні і вяртанні балаў, якія Twitch яшчэ не прыняў: праграма паўтарае іх сама.">
        <div class="kv-pair">
          <Row label="Падзеі" tone={state.eventsub === 'connected' ? 'good' : 'bad'}>{state.eventsub === 'connected' ? 'ідуць' : state.eventsub === 'connecting' ? 'падключэнне…' : 'не ідуць'}</Row>
          <Row label="Чакаюць" tone={pending ? 'bad' : ''}>{pending || 'нічога'}</Row>
        </div>
        <Row label="Апошняя зверка" tone={state.reception.reconciledAt ? '' : 'muted'}>{state.reception.reconciledAt ? dateTime(state.reception.reconciledAt) : '—'}</Row>
        {state.reception.outbox.filter((row) => row.error).map((row) => (
          <p key={`${row.kind}-${row.status}`} class="hint bad">{row.kind} · {row.count}: {errorText(new Error(row.error ?? ''))}</p>
        ))}
      </Card>

      <Backups state={state} />
      <History state={state} />
      <VodCard controller={music} />

      <Card title="Адрасы для OBS" collapsible help="Крыніцы «Браўзер» у OBS. Лепш дадаваць іх праз старонку чакання obs/start.html — тады яны загрузяцца, нават калі OBS адкрыўся раней за праграму. Сцэну «Інтро» праграма стварае сама (укладка «Інтро»).">
        <div class="stack">
          <div class="field"><span>Док</span><CopyRow value={state.urls.dock} /></div>
          <div class="field"><span>Галасаванне</span><CopyRow value={state.urls.overlay} /></div>
          <div class="field"><span>Бягучы радок</span><CopyRow value={state.urls.ticker} /></div>
          <div class="field"><span>Музыка</span><CopyRow value={state.urls.music} /></div>
          <div class="field"><span>Інтро</span><CopyRow value={state.urls.intro} /></div>
          <div class="field"><span>Фон (для любой сцэны)</span><CopyRow value={state.urls.background} /></div>
        </div>
      </Card>

      <MusicDiagnostics controller={music} />
    </>
  );
}

function Backups({ state }: { state: CoreState }) {
  const [backup, update] = useDraft(state.settings.backup, (value) => api('/api/settings', { ...state.settings, backup: value }));
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
    <Card title="Рэзервовыя копіі" collapsible open={!!state.backups.error}
      actions={<>
        <span class={`count ${state.backups.error ? 'bad' : ''}`} title="Апошняя копія">{state.backups.error ? 'памылка' : state.backups.at ? dateTime(state.backups.at) : '—'}</span>
        <button class="btn ghost" onClick={() => void exportData()}>Экспарт</button>
        <button class="btn" onClick={() => run(() => api('/api/backup'), 'Копія зроблена і праверана')}>Зрабіць копію</button>
      </>}
      help="Праграма робіць копію базы галасавання кожныя 10 хвілін (калі нешта змянілася) і адну ў дзень — у асобную тэчку на 90 дзён. Лепш, каб тэчка была на іншым дыску або ў воблаку. «Экспарт» — увесь спіс і гісторыя балаў у JSON.">
      <Row label="Апошняя" tone={state.backups.error ? 'bad' : ''}>{state.backups.at ? dateTime(state.backups.at) : '—'}{state.backups.error ? ' · памылка' : ''}</Row>
      <Row label="Дзённая">{state.backups.daily ? dateTime(state.backups.daily) : '—'}</Row>
      <label class="field" style={{ marginTop: 6 }}>
        <span>Тэчка дзённых копій</span>
        <input value={backup.directory} placeholder={state.backups.external} spellcheck={false} onInput={(e) => update({ directory: e.currentTarget.value })} />
      </label>
    </Card>
  );
}

/** Апошнія 12 месяцаў для выбару ў гісторыі. */
const MONTHS = () => Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - i);
  return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('be-BY', { month: 'long', year: 'numeric' }) };
});

function History({ state }: { state: CoreState }) {
  const [month, setMonth] = useState('');
  const [items, setItems] = useState<CoreState['history'] | null>(null);
  const pick = async (value: string) => {
    setMonth(value);
    if (!value) return setItems(null);
    try {
      const response = await fetch(`/api/history?month=${encodeURIComponent(value)}`);
      setItems((await response.json()).history);
    } catch (error) {
      toast(errorText(error), true);
    }
  };
  const list = items ?? state.history;
  return (
    <Card title="Гісторыя" flush collapsible
      actions={
        <select value={month} aria-label="Месяц" style={{ width: 'auto' }} onChange={(e) => void pick(e.currentTarget.value)}>
          <option value="">Апошнія падзеі</option>
          {MONTHS().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      }>
      <ul class="history">
        {list.map((item) => <li key={item.id}><time>{dateTime(item.at)}</time><span>{item.event}</span></li>)}
      </ul>
      {list.length === 0 && <p class="empty-line">Падзей няма</p>}
    </Card>
  );
}
