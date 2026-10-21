// Агульныя дробныя элементы дока.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export const points = (n: number) => n.toLocaleString('be-BY');
export const time = (ms: number) => new Date(ms).toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit' });
export const dateTime = (value: string | number) =>
  new Date(value).toLocaleString('be-BY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Notice({ notice }: { notice: { text: string; error: boolean } | null }) {
  if (!notice) return null;
  return <p class={`notice ${notice.error ? 'error' : ''}`} role="status">{notice.text}</p>;
}

export function Row({ label, tone = '', children }: { label: string; tone?: '' | 'good' | 'bad' | 'muted'; children: ComponentChildren }) {
  return (
    <div class="kv">
      <span class="kv-label">{label}</span>
      <span class={`kv-value ${tone}`}>{children}</span>
    </div>
  );
}

/** Лікавае поле: пакуль стрымер піша, значэнне трымаецца ў полі; захоўваецца па Enter або пры выхадзе. */
export function NumberField({ label, value, min = 0, max, step = 1, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void;
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
      <span>{label}</span>
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
      <input type={type} value={value} placeholder={placeholder} maxLength={maxLength} spellcheck={false}
        onInput={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Кропка стану ў верхнім радку дока. */
export function Dot({ tone, label }: { tone: 'good' | 'bad' | 'wait' | 'off'; label: string }) {
  return <span class={`dot ${tone}`} title={label} aria-label={label} role="img" />;
}
