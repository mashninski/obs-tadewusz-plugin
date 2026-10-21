// Мяккія гукавыя сігналы абвестак: узровень залежыць ад гучнасці з налад; «без гуку» — заўсёды цішыня.
// Ніякіх файлаў і знешніх рэсурсаў: ноты сінтэзуюцца ў браўзеры.
export function cueNotes(kind) {
  const note = (at, hz, duration, level = 1, type = 'sine') => ({ at, hz, duration, level, type });
  if (kind === 'add') return [
    note(0, 392, .82, .50, 'triangle'), note(.17, 493.88, .86, .53),
    note(.36, 587.33, .94, .57), note(.57, 783.99, 1.05, .42),
  ];
  if (kind === 'support') return [
    note(0, 440, .90, .45, 'triangle'), note(.18, 659.25, 1.02, .62),
    note(.43, 880, 1.13, .46), note(.60, 659.25, .88, .28),
  ];
  if (kind === 'winner') return [
    note(0, 261.63, 2.45, .24, 'triangle'), note(0, 392, 2.40, .21),
    note(.12, 523.25, 2.25, .38), note(.38, 659.25, 2.10, .39),
    note(.68, 783.99, 2.00, .43), note(.98, 1046.50, 1.85, .29),
  ];
  return [];
}
export function scheduleCue(context, kind, volume, at = context.currentTime) {
  const notes = cueNotes(kind);
  if (!Number.isFinite(volume) || volume <= 0 || !notes.length) return 0;
  const output = context.createGain(), filter = context.createBiquadFilter();
  // Нізкачастотны фільтр і плаўная агінаючая — без рэзкіх пачаткаў і пстрычак.
  output.gain.value = Math.min(1, volume) * .62;
  filter.type = 'lowpass'; filter.frequency.value = 3200; filter.Q.value = .35;
  output.connect(filter); filter.connect(context.destination);
  const end = Math.max(...notes.map(n => n.at + n.duration));
  let remaining = notes.length;
  for (const n of notes) {
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = n.type; osc.frequency.value = n.hz;
    const start = at + n.at, attack = kind === 'winner' ? .10 : .045;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(n.level, start + attack);
    gain.gain.exponentialRampToValueAtTime(n.level * .44, start + n.duration * .48);
    gain.gain.exponentialRampToValueAtTime(.0001, start + n.duration - .035);
    gain.gain.linearRampToValueAtTime(0, start + n.duration);
    osc.connect(gain); gain.connect(output);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); if (--remaining === 0) { output.disconnect(); filter.disconnect(); } };
    osc.start(start); osc.stop(start + n.duration);
  }
  return end;
}
