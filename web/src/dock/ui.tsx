// Агульныя элементы дока: шапка ўкладкі, поля, пераключальнік, значкі, усплывальныя паведамленні, спіс з перацягваннем.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { InfoTip } from '../music/ui/dock/Section';

export { Section as Card, InfoTip } from '../music/ui/dock/Section';

export type Tone = 'good' | 'bad' | 'wait' | 'off';

export const points = (n: number) => n.toLocaleString('be-BY');
export const time = (ms: number) => new Date(ms).toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (value: string | number) =>
  new Date(value).toLocaleString('be-BY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---------- Усплывальныя паведамленні (па-над зместам, нічога не зрушваюць) ----------

type Toast = { id: number; text: string; error: boolean };
let toasts: Toast[] = [];
let nextToast = 1;
const toastListeners = new Set<(list: Toast[]) => void>();

export function toast(text: string, error = false): void {
  if (!text) return;
  const item = { id: nextToast++, text, error };
  toasts = [...toasts.filter((t) => t.text !== text).slice(-2), item];
  for (const l of toastListeners) l(toasts);
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    for (const l of toastListeners) l(toasts);
  }, error ? 7000 : 2500);
}

export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} class={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>)}
    </div>
  );
}

// ---------- Шапка ўкладкі ----------

/** Стан раздзела і яго галоўнае дзеянне — аднолькава на кожнай укладцы. Вышыня пастаянная. */
export function Hero({ tone, title, detail, children }: {
  tone: Tone; title: string; detail?: ComponentChildren; children?: ComponentChildren;
}) {
  return (
    <div class="hero">
      <span class={`dot ${tone}`} />
      <div class="hero-text">
        <div class="hero-title">{title}</div>
        <div class="hero-detail">{detail}</div>
      </div>
      {children}
    </div>
  );
}

// ---------- Раздзелы ўкладкі «Сістэма» ----------

/**
 * Раздзел-акардэон: загаловак з кароткай зводкай і стрэлкай, змест пад ім.
 * `open` — як раздзел павінен стаяць сам па сабе (напрыклад, «разгорнуты, калі нешта не падключана»).
 * Стрымер можа адкрыць або закрыць яго рукамі; калі `open` змяняецца (усё падключылася), ручны выбар скідаецца.
 * `force` — лічыльнік: кожнае павелічэнне адкрывае раздзел і пракручвае да яго.
 * Без `collapsible` раздзел заўсёды адкрыты.
 */
export function Group({ title, summary, open = true, collapsible, force = 0, children }: {
  title: string; summary?: ComponentChildren; open?: boolean; collapsible?: boolean; force?: number; children: ComponentChildren;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => setManual(null), [open]);
  useEffect(() => {
    if (!force) return;
    setManual(true);
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'start' }));
  }, [force]);
  const head = (
    <>
      <h2 class="group-title">{title}</h2>
      <span class="group-summary">{summary}</span>
      {collapsible && <span class="chevron" aria-hidden="true" />}
    </>
  );
  if (!collapsible) {
    return (
      <section class="group">
        <div class="group-head">{head}</div>
        {children}
      </section>
    );
  }
  const isOpen = manual ?? open;
  return (
    <details ref={ref} class="group" open={isOpen}
      onToggle={(e) => { if (e.currentTarget.open !== isOpen) setManual(e.currentTarget.open); }}>
      <summary class="group-head">{head}</summary>
      {children}
    </details>
  );
}

// ---------- Падключэнні ----------

/**
 * Картка сэрвісу: кропка стану, назва і адзін радок стану, галоўнае дзеянне справа.
 * Падрабязнасці (палі ўваходу і г. д.) — унізе; `collapsible` хавае іх пад стрэлку.
 */
export function ServiceCard({ name, detail, tone, action, help, collapsible, open, children }: {
  name: string; detail: ComponentChildren; tone: Tone; action?: ComponentChildren; help?: string;
  collapsible?: boolean; open?: boolean; children?: ComponentChildren;
}) {
  const head = (
    <div class="card-head">
      <span class={`dot ${tone}`} />
      <div class="service-name">{name}<small>{detail}</small></div>
      <div class="card-actions">
        {action}
        {help && <InfoTip text={help} />}
        {collapsible && <span class="chevron" aria-hidden="true" />}
      </div>
    </div>
  );
  const body = children ? <div class="card-body">{children}</div> : null;
  if (collapsible) {
    return (
      <details class="card service" open={open}>
        <summary>{head}</summary>
        {body}
      </details>
    );
  }
  return <section class="card service">{head}{body}</section>;
}

// ---------- Поля ----------

export function Row({ label, tone = '', children }: { label: string; tone?: '' | 'good' | 'bad' | 'muted'; children: ComponentChildren }) {
  return (
    <div class="kv">
      <span class="kv-label">{label}</span>
      <span class={`kv-value ${tone}`}>{children}</span>
    </div>
  );
}

/** Лікавае поле: пакуль стрымер піша, значэнне трымаецца ў полі; захоўваецца па Enter або пры выхадзе. */
export function NumberField({ label, value, min = 0, max, step = 1, suffix, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n) && n !== value) onChange(n);
    setDraft(null);
  };
  return (
    <label class="field">
      <span>{label}{suffix ? `, ${suffix}` : ''}</span>
      <input type="number" min={min} max={max} step={step} value={draft ?? String(value)}
        onInput={(e) => setDraft(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

export function TextField({ label, value, onChange, type = 'text', placeholder, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string; maxLength?: number;
}) {
  return (
    <label class="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} maxLength={maxLength} spellcheck={false} autocomplete="off"
        onInput={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

export function Switch({ label, checked, onChange, disabled }: { label: ComponentChildren; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label class="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span class="track" />
      <span>{label}</span>
    </label>
  );
}

export function Dot({ tone, label }: { tone: Tone; label: string }) {
  return <span class={`dot ${tone}`} title={label} aria-label={label} role="img" />;
}

export function Pill({ tone = '', children }: { tone?: '' | 'good' | 'bad' | 'wait'; children: ComponentChildren }) {
  return <span class={`pill ${tone}`}>{children}</span>;
}

// ---------- Значкі ----------

const PATHS: Record<string, JSX.Element> = {
  grip: <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" stroke-width="2.2" stroke-linecap="round" />,
  play: <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  bold: <path d="M5 3.5h4a2.25 2.25 0 010 4.5H5zM5 8h4.6a2.25 2.25 0 010 4.5H5z" stroke-width="1.6" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  arrow: <path d="M8 3.5v9M4.5 9L8 12.5 11.5 9" />,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none" />,
  qr: <path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9.5 9.5h1M12.5 9.5h.5M9.5 12.5h3.5M11 11h.01" stroke-width="1.3" />,
};

export function Icon({ name, size = 14 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function IconButton({ icon, label, onClick, disabled, tone = '', type = 'button', ...rest }: {
  icon: string; label: string; onClick?: () => void; disabled?: boolean; tone?: '' | 'danger' | 'on'; type?: 'button' | 'submit';
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'onClick' | 'type'>) {
  return (
    <button type={type} class={`icon-btn ${tone}`} title={label} aria-label={label} disabled={disabled} onClick={onClick} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

// ---------- Перацягванне радкоў ----------

/** Парадак радкоў мяняецца перацягваннем за значок ⠿ (HTML Drag and Drop працуе і ў доках OBS). */
export function useSortable(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  return {
    row: (index: number) => ({
      class: dragging === index ? 'dragging' : over === index && dragging !== null && dragging !== index ? 'drop-target' : '',
      onDragOver: (e: DragEvent) => { if (dragging === null) return; e.preventDefault(); setOver(index); },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        if (dragging !== null && dragging !== index) onMove(dragging, index);
        setDragging(null);
        setOver(null);
      },
    }),
    handle: (index: number) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => { e.dataTransfer?.setData('text/plain', String(index)); setDragging(index); },
      onDragEnd: () => { setDragging(null); setOver(null); },
    }),
  };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
