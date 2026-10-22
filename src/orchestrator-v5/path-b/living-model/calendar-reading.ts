/**
 * ⭐ THE DAY OLUMI READ A CALENDAR DEADLINE IS THE HOST'S, AND A SAVED READING STANDS WHILE ITS WORDS DO (Codex r1 on #3674).
 * The AI reads the date a calendar deadline fixes (`period_deadline`, labelled `period_by: 'olumi'`); at write time the host:
 *  · records the day of a NEW reading as today, never a day the AI sent (a wrong or future day would move the window);
 *  · keeps a SAVED reading, its date and its day, while the aim's deadline words are unchanged, whatever the AI sent;
 *  · drops a month count beside a reading (`period_months`): the mapper works the window out, so a count there is no one's.
 * Run on the kernelled model, so ids are canonical. Pure: today is passed in.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import { plain } from './kernel.js';

export function withCalendarReadings(model: LivingModelT, saved: LivingModelT | undefined, today: string): LivingModelT {
  return {
    ...model,
    aims: model.aims.map((a) => {
      const t = a.target;
      if (t === null) return a;
      const was = saved?.aims.find((s) => s.id === a.id)?.target ?? null;
      if (was !== null && was.period_by === 'olumi' && was.by_when !== null && t.by_when !== null && plain(was.by_when) === plain(t.by_when)) {
        return { ...a, target: { ...t, period_months: null, period_by: 'olumi' as const, period_deadline: was.period_deadline, period_read_on: was.period_read_on } };
      }
      if (t.period_by === 'olumi') return { ...a, target: { ...t, period_months: null, period_read_on: today } };
      return t.period_deadline === null && t.period_read_on === null ? a : { ...a, target: { ...t, period_deadline: null, period_read_on: null } };
    }),
  };
}
