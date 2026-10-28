// «Інтро / Аўтра» → «Аўтра»: сцэна ў канцы стрыму (надпіс, спасылкі, кліпы) і рэйд.
// Twitch не дазваляе націснуць Raid Now праз API: праграма адкрывае акно рэйду, адлічвае час да моманту,
// калі кнопка ў чаце становіцца актыўнай, і нагадвае стрымеру націснуць яе (гук — толькі ў доку).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DeviceCode, useDeviceFlow } from './ConnectionsSection';
import { api, run, useDraft, type CoreState, type OutroConfig, type RaidChannel, type RaidState } from './core';
import { Links, linksReady } from './IntroTab';
import { Card, Hero, NumberField, Pill, Row, Switch, TextField, toast, type Tone } from './ui';

export function OutroTab({ state }: { state: CoreState }) {
  const [draft, update] = useDraft<OutroConfig>(state.outro.config, (config) => api('/api/outro/config', config));
  const set = (patch: Partial<OutroConfig>, ready = true) => {
    const next = { ...draft, ...patch };
    update(next, ready && !!next.text.trim() && (!next.ownLinks || linksReady(next.links)));
  };
  const intro = state.intro.config;
  const raid = state.raid;
  const phase = raid.current?.phase;

  const tone: Tone = phase === 'done' ? 'good' : phase === 'pending' || phase === 'starting' ? 'wait'
    : phase === 'unconfirmed' || phase === 'failed' ? 'bad' : raid.outroOnAir ? 'good' : 'off';
  const detail = raid.outroOnAir === true ? 'У эфіры' : raid.outroOnAir === false ? 'Не ў эфіры' : 'OBS не падключаны';

  return (
    <>
      <Hero tone={tone} title="Аўтра" detail={detail}>
        <button class="btn primary" disabled={!state.obs.connected} title={state.obs.connected ? '' : 'OBS не падключаны'}
          onClick={async () => {
            const result = await run(() => api<{ sceneCreated: boolean; inputCreated: boolean }>('/api/outro/scene'), '');
            if (result) toast(result.sceneCreated || result.inputCreated ? 'Сцэна «Аўтра» створана ў OBS' : 'Сцэна «Аўтра» абноўлена ў OBS');
          }}>Стварыць / абнавіць сцэну</button>
      </Hero>

      <RaidSection raid={raid} />

      <Card title="Экран" help={'Вялікі надпіс справа, спасылкі з QR злева, кліпы канала справа зверху\n\nПадчас рэйду на месцы кліпаў — картка канала і адлік'}>
        <div class="stack">
          <TextField label="Надпіс" value={draft.text} maxLength={80} onChange={(text) => set({ text }, !!text.trim())} />
          <NumberField label="Адлік да Raid Now" suffix="с" value={draft.raidCountdown} min={3} max={60}
            onChange={(n) => set({ raidCountdown: Math.max(3, Math.min(60, Math.round(n))) })} />
          <Switch label="Свае спасылкі для аўтра" checked={draft.ownLinks}
            onChange={(ownLinks) => set(ownLinks && !draft.links.length ? { ownLinks, links: intro.links, linksTitle: intro.linksTitle } : { ownLinks })} />
          {!draft.ownLinks && <Row label="Спасылкі">як у інтро · {intro.links.length}</Row>}
        </div>
      </Card>

      {draft.ownLinks && (
        <Links draft={draft} set={set} help="Спіс злева на экране аўтра (інтро не мяняецца). Парадак — перацягваннем за ⠿" />
      )}
    </>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};
const viewers = (n: number) => `${n.toLocaleString('be-BY')} ${plural(n, 'глядач', 'гледачы', 'гледачоў')}`;

/** Два кароткія тоны — толькі ў доку (у эфір не ідуць, калі прылада доку не захопліваецца ў OBS). */
function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.22].forEach((at, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = i ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.2);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {}
}

function RaidSection({ raid }: { raid: RaidState }) {
  const login = useDeviceFlow<{ connected?: boolean }>('/api/twitch/poll', (r) => !!r.connected, 'Уваход абноўлены');
  const phase = raid.current?.phase;
  const help = 'Twitch адкрые акно рэйду ў чаце. Націснуць Raid Now праграма не можа — гэта трэба зрабіць самому, калі адлік дойдзе да нуля\n\nБез націску Twitch пачне рэйд сам праз ~90 с\n\nНе больш за 10 рэйдаў за 10 хвілін';

  if (raid.access === 'twitch_connect_required') {
    return <Card title="Рэйд" help={help}><Row label="Twitch" tone="bad">не падключаны · Сістэма → Падключэнне</Row></Card>;
  }
  if (raid.access === 'raid_scopes') {
    return (
      <Card title="Рэйд" help={help}>
        <div class="stack">
          <div class="raid-alert calm">Патрэбны паўторны ўваход у Twitch<small>Новыя правы: рэйд і спіс падпісак</small></div>
          {login.flow ? <DeviceCode flow={login.flow} /> : (
            <div class="actions">
              <button class="btn primary" onClick={() => void login.start(() => api('/api/twitch/login'))}>Увайсці ў Twitch</button>
            </div>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card title="Рэйд" help={help}>
      {phase && phase !== 'failed' && phase !== 'cancelled' ? <RaidProgress raid={raid} /> : <RaidPicker raid={raid} />}
    </Card>
  );
}

function RaidPicker({ raid }: { raid: RaidState }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const load = (force: boolean) => run(() => api('/api/raid/channels', { force }), '');
  const channels = raid.list.channels;
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? channels.filter((c) => [c.name, c.login, c.game, c.title].some((v) => v.toLowerCase().includes(q))) : channels;
  }, [channels, query]);
  const target = channels.find((c) => c.id === selected) ?? null;
  const last = raid.current;

  const start = async () => {
    if (!target) return;
    if (!confirm(`Пачаць рэйд на ${target.name}?\n\nTwitch адкрые акно рэйду ў чаце · Raid Now націскаеце самі`)) return;
    const result = await run(() => api('/api/raid/start', { id: target.id }), '');
    if (result) { setOpen(false); setSelected(null); }
  };

  return (
    <div class="stack">
      {last?.phase === 'failed' && <Row label="Апошні рэйд" tone="bad">не пачаўся · {last.target.name}</Row>}
      {last?.phase === 'cancelled' && <Row label="Апошні рэйд" tone="muted">адменены · {last.target.name}</Row>}
      {raid.outroOnAir === false && <Row label="Сцэна «Аўтра»" tone="bad">не ў эфіры</Row>}
      {!open ? (
        <div class="actions">
          <button class="btn primary" onClick={() => { setOpen(true); void load(false); }}>Абраць канал</button>
        </div>
      ) : (
        <>
          <div class="inline">
            <input class="raid-search" value={query} placeholder="Пошук: канал, гульня, назва" spellcheck={false}
              onInput={(e) => setQuery(e.currentTarget.value)} />
            <button class="btn" disabled={raid.list.loading} onClick={() => void load(true)}>{raid.list.loading ? '…' : 'Абнавіць'}</button>
          </div>
          {raid.list.error && <Row label="Спіс" tone="bad">не загрузіўся</Row>}
          <ul class="raid-list">
            {found.map((c) => <ChannelRow key={c.id} channel={c} selected={c.id === selected} onSelect={() => setSelected(c.id)} />)}
          </ul>
          {!found.length && (
            <p class="empty-line">{raid.list.loading ? 'Загружаю…' : channels.length ? 'Нічога не знойдзена' : 'Ніхто з падпісак не ў эфіры'}</p>
          )}
          <div class="actions">
            <button class="btn primary" disabled={!target} onClick={() => void start()}>{target ? `Пачаць рэйд · ${target.name}` : 'Пачаць рэйд'}</button>
            <button class="btn ghost" onClick={() => { setOpen(false); setSelected(null); }}>Схаваць</button>
          </div>
        </>
      )}
    </div>
  );
}

function ChannelRow({ channel: c, selected, onSelect }: { channel: RaidChannel; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button class={`raid-row ${selected ? 'selected' : ''}`} onClick={onSelect} title={c.title}>
        {c.avatar ? <img src={c.avatar} alt="" loading="lazy" /> : <span class="raid-noavatar" />}
        <span class="grow">
          <span class="raid-row-name"><span class="ellipsis">{c.name}</span>{c.mature && <Pill tone="bad">18+</Pill>}</span>
          <span class="raid-row-meta ellipsis" style={{ display: 'block' }}>{c.game || 'Без катэгорыі'}</span>
          <span class="raid-row-title ellipsis" style={{ display: 'block' }}>{c.title}</span>
        </span>
        <span class="raid-viewers">{c.viewers.toLocaleString('be-BY')}</span>
      </button>
    </li>
  );
}

function RaidProgress({ raid }: { raid: RaidState }) {
  const current = raid.current!;
  const { phase, target } = current;
  // Час ядра: стан прыходзіць раз у 1,5 с, а адлік ідзе плаўна па розніцы гадзіннікаў.
  const offset = useRef(0);
  offset.current = raid.serverNow - Date.now();
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const now = Date.now() + offset.current;
  const left = current.deadline ? Math.max(0, Math.ceil((current.deadline - now) / 1000)) : null;
  const atZero = phase === 'pending' && left === 0;

  // Сігнал — адзін раз на рэйд, калі адлік дайшоў да нуля.
  const beeped = useRef<number | null>(null);
  useEffect(() => {
    if (atZero && beeped.current !== current.startedAt) { beeped.current = current.startedAt; beep(); }
  }, [atZero, current.startedAt]);

  const cancel = () => run(() => api('/api/raid/cancel'), 'Рэйд адменены');
  const close = () => run(() => api('/api/raid/reset'), '');

  return (
    <div class="stack">
      <div class="raid-target">
        {target.avatar && <img src={target.avatar} alt="" />}
        <div class="grow">
          <div class="ellipsis" style={{ fontWeight: 600 }}>{target.name}</div>
          <div class="muted small ellipsis">{target.game || 'Без катэгорыі'} · {viewers(target.viewers)}</div>
        </div>
      </div>

      {phase === 'starting' && <div class="raid-alert calm">Запускаю рэйд…</div>}
      {phase === 'pending' && !atZero && <div class="raid-count">Raid Now праз {left} с</div>}
      {atZero && <div class="raid-alert">Націсні Raid Now у чаце Twitch<small>Інакш Twitch пачне рэйд сам</small></div>}
      {phase === 'unconfirmed' && <div class="raid-alert bad">Рэйд не пацверджаны · праверце чат</div>}
      {phase === 'done' && <div class="raid-alert calm">Рэйд адбыўся</div>}

      {phase === 'done' && current.viewers !== null && <Row label="Перайшло" tone="good">{viewers(current.viewers)}</Row>}
      {(phase === 'pending' || phase === 'starting') && raid.outroOnAir === false && <Row label="Сцэна «Аўтра»" tone="bad">не ў эфіры</Row>}

      <div class="actions">
        {(phase === 'pending' || phase === 'unconfirmed') && <button class="btn danger" onClick={() => void cancel()}>Адмяніць рэйд</button>}
        {(phase === 'done' || phase === 'unconfirmed') && <button class="btn" onClick={() => void close()}>Закрыць</button>}
      </div>
    </div>
  );
}
