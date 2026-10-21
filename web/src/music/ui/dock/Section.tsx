// Картка дока: загаловак, дзеянні справа, падказка «?»; можа згортвацца.

import type { ComponentChildren } from 'preact';

/** Тэкст падказкі: абзацы раздзелены пустым радком, крокі «1. …» — нумараваным спісам. */
function HelpText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((block, i) => {
        const lines = block.split('\n');
        const steps = lines.every((l) => /^\d+\. /.test(l));
        return steps ? (
          <ol key={i} class="help-steps">
            {lines.map((l, j) => (
              <li key={j}>{l.replace(/^\d+\. /, '')}</li>
            ))}
          </ol>
        ) : (
          <p key={i} class="help-par">
            {lines.map((l, j) => (
              <span key={j} class="help-line">
                {l}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span class="info-tip" onClick={(e) => e.preventDefault()}>
      <button type="button" class="info-tip-icon" aria-label="Падказка">
        ?
      </button>
      <span class="info-tip-text" role="tooltip">
        <HelpText text={text} />
      </span>
    </span>
  );
}

interface SectionProps {
  title: string;
  help?: string;
  /** Дадатковыя кнопкі ў загалоўку (злева ад «?»). */
  actions?: ComponentChildren;
  /** Спіс без унутраных адступаў (радкі самі маюць адступы). */
  flush?: boolean;
  /** Картка згортваецца; `open` — ці разгорнутая яна з самага пачатку. */
  collapsible?: boolean;
  open?: boolean;
  children: ComponentChildren;
}

export function Section({ title, help, actions, flush, collapsible, open, children }: SectionProps) {
  const head = (
    <div class="card-head">
      <h2 class="card-title">{title}</h2>
      <div class="card-actions">
        {actions}
        {help && <InfoTip text={help} />}
      </div>
    </div>
  );
  const body = <div class={flush ? 'card-body flush' : 'card-body'}>{children}</div>;
  if (collapsible) {
    return (
      <details class="card" open={open}>
        <summary>{head}</summary>
        {body}
      </details>
    );
  }
  return (
    <section class="card">
      {head}
      {body}
    </section>
  );
}
