// Укладка «Таймер»: мэта і адлік на экране; на нулі — сігнал праз крыніцу OBS.
// Бягучы таймер — у ядры (перажывае перазапуск OBS); налады выгляду захоўваюцца самі.
import { useEffect, useState } from 'preact/hooks';
import { formatLeft } from '../timer/format.js';
import { api, run, useDraft, type CoreState, type TimerConfig, type TimerPosition, type TimerView } from './core';
import { Card, Hero, NumberField, Row, Switch, toast } from './ui';

const POSITIONS: { id: TimerPosition; label: string }[] = [
  { id: 'top-left', label: 'Зверху злева' },
  { id: 'top-center', label: 'Зверху па цэнтры' },
  { id: 'top-right', label: 'Зверху справа' },
  { id: 'bottom-left', label: 'Знізу злева' },
  { id: 'bottom-center', label: 'Знізу па цэнтры' },
  { id: 'bottom-right', label: 'Знізу справа' },
  { id: 'center', label: 'Па цэнтры' },
];

const PRESETS = [1, 5, 10, 15, 30, 60];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Рэшта ў мілісекундах па гадзінніку ядра; перамалёўка 4 разы ў секунду. */
function useLeft(timer: TimerView | null, serverNow: number) {
  const [, setTick] = useState(0);
  const [offset] = useState(() => ({ value: 0 }));
  offset.value = serverNow - Date.now();
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  if (!timer) return 0;
  return timer.paused ? timer.left ?? 0 : Math.max(0, timer.deadline! - (Date.now() + offset.value));
}

export function TimerTab({ state }: { state: CoreState }) {
  const { timer, serverNow, recent } = state.timer;
  const left = useLeft(timer, serverNow);
  const finished = !!timer && !timer.paused && left <= 0;

  const tone = !timer ? 'off' : finished ? 'bad' : timer.paused ? 'wait' : 'good';
  const title = !timer ? 'Таймер не ідзе' : timer.goal || 'Таймер';
  const detail = !timer ? 'Мэта і час — ніжэй' : finished ? 'Час скончыўся' : timer.paused ? `Паўза · ${formatLeft(Math.ceil(left / 1000))}` : `Засталося ${formatLeft(Math.ceil(left / 1000))}`;

  return (
    <>
      <Hero tone={tone} title={title} detail={detail}>
        <button class="btn primary" disabled={!state.obs.connected} title={state.obs.connected ? '' : 'OBS не падключаны'}
          onClick={async () => {
            const result = await run(() => api<{ sceneName: string; itemCreated: boolean }>('/api/timer/source'), '');
            if (result) toast(result.itemCreated ? `Крыніца «Таймер» дададзена ў сцэну «${result.sceneName}»` : `Крыніца «Таймер» абноўлена ў сцэне «${result.sceneName}»`);
          }}>Дадаць крыніцу ў OBS</button>
      </Hero>

      {timer && <Current timer={timer} left={left} finished={finished} />}
      <Start running={!!timer && !finished} recent={recent} />
      <Look config={state.timer.config} />
    </>
  );
}

function Current({ timer, left, finished }: { timer: TimerView; left: number; finished: boolean }) {
  const share = timer.duration ? clamp(left / timer.duration, 0, 1) : 0;
  return (
    <Card title="Зараз">
      <div class="stack">
        <div class={`timer-clock${finished ? ' finished' : timer.paused ? ' paused' : ''}`}>{finished ? 'Час!' : formatLeft(Math.ceil(left / 1000))}</div>
        <div class="timer-bar"><div style={{ transform: `scaleX(${share})` }} /></div>
        {timer.goal && <Row label="Мэта">{timer.goal}</Row>}
        <Row label="Усяго">{formatLeft(Math.round(timer.duration / 1000))}</Row>
        {finished && !timer.shown && <Row label="На экране" tone="muted">схаваны</Row>}
        <div class="actions">
          {!finished && (timer.paused
            ? <button class="btn primary" onClick={() => void run(() => api('/api/timer/resume'), 'Працягнуты')}>Працягнуць</button>
            : <button class="btn" onClick={() => void run(() => api('/api/timer/pause'), 'Паўза')}>Паўза</button>)}
          {!finished && <button class="btn" onClick={() => void run(() => api('/api/timer/add', { seconds: -60 }), '−1 хвіліна')}>−1 хв</button>}
          {!finished && <button class="btn" onClick={() => void run(() => api('/api/timer/add', { seconds: 60 }), '+1 хвіліна')}>+1 хв</button>}
          <button class={finished ? 'btn' : 'btn danger'} onClick={() => void run(() => api('/api/timer/stop'), finished ? 'Скінуты' : 'Спынены')}>
            {finished ? 'Скінуць' : 'Спыніць'}
          </button>
        </div>
      </div>
    </Card>
  );
}

function Start({ running, recent }: { running: boolean; recent: string[] }) {
  const [goal, setGoal] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [seconds, setSeconds] = useState(0);
  const total = minutes * 60 + seconds;

  const start = () => {
    if (total < 1) return toast('Час — хаця б секунда', true);
    void run(() => api('/api/timer/start', { goal: goal.trim(), seconds: total }), `Таймер на ${formatLeft(total)}`);
  };

  return (
    <Card title="Новы таймер" help={running ? 'Новы таймер замяняе бягучы' : undefined}>
      <div class="stack">
        <label class="field"><span>Мэта</span>
          <input type="text" value={goal} maxLength={80} list="timer-recent" placeholder="Можна пакінуць пустой" spellcheck={false} autocomplete="off"
            onInput={(e) => setGoal(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />
          <datalist id="timer-recent">{recent.map((g) => <option key={g} value={g} />)}</datalist>
        </label>
        <div class="timer-presets">
          {PRESETS.map((m) => (
            <button key={m} class={total === m * 60 ? 'btn active' : 'btn'} onClick={() => { setMinutes(m); setSeconds(0); }}>
              {m === 60 ? '1 г' : `${m} хв`}
            </button>
          ))}
        </div>
        <div class="fields wide">
          <NumberField label="Хвіліны" value={minutes} min={0} max={720} onChange={(n) => setMinutes(clamp(Math.round(n), 0, 720))} />
          <NumberField label="Секунды" value={seconds} min={0} max={59} onChange={(n) => setSeconds(clamp(Math.round(n), 0, 59))} />
        </div>
        <div class="actions">
          <button class="btn primary" disabled={total < 1} onClick={start}>{running ? 'Пачаць нанова' : 'Пачаць'}</button>
        </div>
      </div>
    </Card>
  );
}

function Look({ config }: { config: TimerConfig }) {
  const [draft, update] = useDraft<TimerConfig>(config, (value) => api('/api/timer/config', value));
  const set = (patch: Partial<TimerConfig>) => update({ ...draft, ...patch });
  return (
    <Card title="Выгляд і сігнал"
      help={'Кнопка зверху кладзе празрыстую крыніцу «Tadewusz · Таймер» на ўвесь кадр, верхнім слоем у сцэну ў эфіры\n\nСігнал ідзе праз мікшар OBS — у эфір'}>
      <div class="stack">
        <div class="fields wide">
          <label class="field"><span>Месца</span>
            <select value={draft.position} onChange={(e) => set({ position: e.currentTarget.value as TimerPosition })}>
              {POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <NumberField label="Памер" suffix="%" value={Math.round(draft.scale * 100)} min={50} max={200} step={10}
            onChange={(n) => set({ scale: clamp(Math.round(n), 50, 200) / 100 })} />
          <NumberField label="Пасля нуля" suffix="с" value={draft.hold} min={0} max={600} step={5}
            onChange={(n) => set({ hold: clamp(Math.round(n), 0, 600) })} />
          <NumberField label="Гучнасць" suffix="%" value={Math.round(draft.volume * 100)} min={0} max={100} step={5}
            onChange={(n) => set({ volume: clamp(Math.round(n), 0, 100) / 100 })} />
        </div>
        <Switch label="Сігнал на нулі" checked={draft.sound} onChange={(sound) => set({ sound })} />
        <Switch label="Чуць сігнал самому" checked={draft.monitor} onChange={(monitor) => set({ monitor })} />
      </div>
    </Card>
  );
}
