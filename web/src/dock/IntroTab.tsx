// Укладка «Інтро / Аўтра». Інтро — сцэна чакання перад стрымам: адлік, спасылкі (з QR), кліпы канала і паласа данатаў.
// Аўтра (OutroTab.tsx) — сцэна ў канцы стрыму і рэйд.
// Змены захоўваюцца самі праз імгненне пасля праўкі; оверлей бярэ іх сам — сцэну перастварыць не трэба.
import { useState } from 'preact/hooks';
import { OutroTab } from './OutroTab';
import { CopyRow } from '../music/ui/dock/MusicSettings';
import { api, run, useDraft, type CoreState, type IntroConfig, type IntroLink } from './core';
import { Card, dateTime, Hero, IconButton, moveItem, NumberField, Switch, TextField, toast, useSortable, type Tone } from './ui';

const newId = () => Math.random().toString(36).slice(2, 10);

/** «10:00» → 600; «90» — хвіліны; няправільны час — null. */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  const seconds = parts.length === 1 ? n[0] * 60 : parts.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return seconds >= 10 && seconds <= 6 * 3600 ? seconds : null;
}

export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

export const linksReady = (links: IntroLink[]) => links.every((l) => l.url.trim() && !/\s/.test(l.url.trim()));

const PART_KEY = 'tadewusz.dock.introPart';

/** Перамыкач «Інтро» / «Аўтра»; выбар памятаецца ў доку. Пакуль ідзе рэйд — адкрываецца «Аўтра». */
export function IntroTab({ state }: { state: CoreState }) {
  const [part, setPart] = useState<'intro' | 'outro'>(() => {
    try { return localStorage.getItem(PART_KEY) === 'outro' ? 'outro' : 'intro'; } catch { return 'intro'; }
  });
  const raiding = ['starting', 'pending', 'unconfirmed'].includes(state.raid.current?.phase ?? '');
  const shown = raiding ? 'outro' : part;
  const select = (next: 'intro' | 'outro') => {
    setPart(next);
    try { localStorage.setItem(PART_KEY, next); } catch {}
  };
  return (
    <>
      <div class="segmented" role="tablist">
        {(['intro', 'outro'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={shown === id} class={shown === id ? 'active' : ''} onClick={() => select(id)}>
            {id === 'intro' ? 'Інтро' : 'Аўтра'}
          </button>
        ))}
      </div>
      {shown === 'intro' ? <IntroSection state={state} /> : <OutroTab state={state} />}
    </>
  );
}

function IntroSection({ state }: { state: CoreState }) {
  const intro = state.intro;
  const [draft, update] = useDraft<IntroConfig>(intro.config, (config) => api('/api/intro/config', config));
  const set = (patch: Partial<IntroConfig>, ready = true) => {
    const next = { ...draft, ...patch };
    update(next, ready && linksReady(next.links) && !!next.finishText.trim());
  };

  const tone: Tone = intro.error && !intro.clips ? 'bad' : intro.clips ? 'good' : 'wait';
  const title = intro.clips ? `Кліпаў канала: ${intro.clips}` : intro.fetching ? 'Кліпы загружаюцца…' : 'Кліпаў пакуль няма';
  const detail = intro.error
    ? `Twitch не аддаў спіс (${intro.error}) · грае апошні атрыманы`
    : intro.fetchedAt ? `з іх ад гледачоў ${intro.byViewers} · абноўлена ${dateTime(intro.fetchedAt)}` : 'Спіс абновіцца, калі сцэна стане актыўнай';

  return (
    <>
      <Hero tone={tone} title={title} detail={detail}>
        <button class="btn primary" disabled={!state.obs.connected} title={state.obs.connected ? '' : 'OBS не падключаны'}
          onClick={async () => {
            const result = await run(() => api<{ sceneCreated: boolean; inputCreated: boolean }>('/api/intro/scene'), '');
            if (result) toast(result.sceneCreated || result.inputCreated ? 'Сцэна «Інтро» створана ў OBS' : 'Сцэна «Інтро» абноўлена ў OBS');
          }}>Стварыць / абнавіць сцэну</button>
      </Hero>

      <Countdown draft={draft} set={set} />
      <Links draft={draft} set={set} />

      <Card title="Кліпы" actions={<button class="btn" disabled={intro.fetching} onClick={() => run(() => api('/api/intro/refresh'), 'Спіс кліпаў абноўлены')}>Абнавіць спіс</button>}
        help={'Усе кліпы канала, у тым ліку зробленыя гледачамі, — у перамешаным парадку без паўтораў, пакуль не пакажуцца ўсе; потым калода перамешваецца нанова.\n\nКліпы мяняюцца плаўна: пакуль наступны грузіцца, відаць яго кадр. «Паўза» — колькі секунд трымаць гэты кадр перад кліпам (0 — адразу).\n\nСпіс абнаўляецца з Twitch, калі сцэна становіцца актыўнай, і кожныя 5 хвілін, пакуль яна ў эфіры: новыя кліпы трапляюць у калоду, не перарываючы паказ. Без сувязі з Twitch грае апошні атрыманы спіс.\n\nКліпы паказвае афіцыйны плэер Twitch, файлы не спампоўваюцца. Гук — праз OBS: гучнасць крыніцы «Tadewusz · Інтро» ў мікшары.'}>
        <NumberField label="Паўза паміж кліпамі" suffix="с" value={draft.clipPause} min={0} max={120} onChange={(clipPause) => set({ clipPause })} />
      </Card>

      <Card title="Фон для іншых сцэн"
        help={'Той жа фон, што ў інтро, — асобнай старонкай: ізалініі павольна і бясконца дрэйфуюць (малююцца на хаду, без паўтораў і склеек).\n\n1. У патрэбнай сцэне OBS дадайце крыніцу «Браўзер»\n2. Зніміце галачку «Лакальны файл» і ўстаўце гэты адрас\n3. Шырыня і вышыня — як у вашай сцэны (напрыклад, 1920 і 1080)\n4. Перацягніце крыніцу ў самы ніз спіса, каб яна была фонам'}>
        <CopyRow value={state.urls.background} />
      </Card>

      <Card title="Данаты">
        <Switch label="Паласа данатаў унізе (пакуль загатоўка)" checked={draft.donations} onChange={(donations) => set({ donations })} />
      </Card>
    </>
  );
}

function Countdown({ draft, set }: { draft: IntroConfig; set: (patch: Partial<IntroConfig>, ready?: boolean) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? formatDuration(draft.countdown);
  const parsed = parseDuration(shown);
  const commit = () => {
    if (text === null) return;
    if (parsed !== null && parsed !== draft.countdown) set({ countdown: parsed });
    setText(null);
  };
  return (
    <Card title="Адлік" actions={<button class="btn" onClick={() => run(() => api('/api/intro/restart'), 'Адлік пачаўся нанова')}>Перазапусціць</button>}
      help="Адлік пачынаецца, калі сцэна «Інтро» становіцца актыўнай. На нулі замест лічбаў з’яўляецца надпіс; сцэна сама не пераключаецца.">
      <div class="fields wide">
        <label class="field">
          <span>Час, хв:сс</span>
          <input value={shown} class={parsed === null ? 'invalid' : ''} spellcheck={false}
            onInput={(e) => setText(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        </label>
        <TextField label="Надпіс на 00:00" value={draft.finishText} maxLength={80} onChange={(finishText) => set({ finishText }, !!finishText.trim())} />
      </div>
    </Card>
  );
}

type LinksDraft = { linksTitle: string; links: IntroLink[] };

export function Links({ draft, set, help }: {
  draft: LinksDraft; set: (patch: Partial<LinksDraft>, ready?: boolean) => void; help?: string;
}) {
  const links = draft.links;
  const change = (index: number, patch: Partial<IntroLink>) => set({ links: links.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const sortable = useSortable((from, to) => set({ links: moveItem(links, from, to) }));
  return (
    <Card title="Спасылкі" flush
      actions={<IconButton icon="plus" label="Новая спасылка" disabled={links.length >= 8}
        onClick={() => set({ links: [...links, { id: newId(), url: '', label: '', qr: false }] }, false)} />}
      help={help ?? "Спіс злева на экране інтро. Адрас — як яго ўбачаць гледачы (https:// можна не пісаць), подпіс — над ім. QR — квадратны код побач, яго можна сканаваць тэлефонам. Парадак — перацягваннем за ⠿."}>
      <div class="add-row" style={{ borderTop: 0 }}>
        <input value={draft.linksTitle} maxLength={60} placeholder="Загаловак блока" aria-label="Загаловак блока спасылак"
          onInput={(e) => set({ linksTitle: e.currentTarget.value })} />
      </div>
      <ul class="list">
        {links.map((link, index) => {
          const row = sortable.row(index);
          return (
            <li key={link.id} {...row} class={`${row.class} intro-link`}>
              <span class="icon-btn small handle" title="Перацягнуць" {...sortable.handle(index)}>⠿</span>
              <div class="grow intro-link-fields">
                <input class="bare" value={link.label} maxLength={60} placeholder="Подпіс" aria-label={`Подпіс спасылкі ${index + 1}`}
                  onInput={(e) => change(index, { label: e.currentTarget.value })} />
                <input class="bare mono-input" value={link.url} maxLength={200} placeholder="адрас, напрыклад twitch.tv/…" spellcheck={false}
                  aria-label={`Адрас спасылкі ${index + 1}`} onInput={(e) => change(index, { url: e.currentTarget.value })} />
              </div>
              <div class="row-tools">
                <IconButton icon="qr" label={link.qr ? 'Схаваць QR-код' : 'Паказаць QR-код'} tone={link.qr ? 'on' : ''} onClick={() => change(index, { qr: !link.qr })} />
                <IconButton icon="close" label="Выдаліць спасылку" tone="danger" onClick={() => set({ links: links.filter((_, i) => i !== index) })} />
              </div>
            </li>
          );
        })}
      </ul>
      {links.length === 0 && <p class="empty-line">Спасылак няма · «+» дадае новую</p>}
    </Card>
  );
}
