import { DateTime } from 'luxon';

const PROMISE_WORDS =
  /\b(promise|kal|parso|parson|dunga|dungaa|karunga|karungi|pay later|will pay|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i;

/**
 * Parse a WhatsApp-style reply into a wake time in Asia/Kolkata.
 * Unrecognised text returns null — do not invent a promise.
 */
export function parsePromiseReply(
  text: string,
  now: DateTime = DateTime.now().setZone('Asia/Kolkata')
): Date | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) {
    const d = DateTime.fromISO(iso[0], { zone: 'Asia/Kolkata' }).set({
      hour: 9,
      minute: 0,
      second: 0,
      millisecond: 0
    });
    if (d.isValid && d > now) return d.toJSDate();
  }

  const lower = raw.toLowerCase();
  const atNine = (dt: DateTime) =>
    dt.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

  if (/\bkal\b/.test(lower)) {
    return atNine(now.plus({ days: 1 })).toJSDate();
  }
  if (/\bpars[oa]n?\b/.test(lower)) {
    return atNine(now.plus({ days: 2 })).toJSDate();
  }

  const weekdays: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 7
  };
  for (const [name, weekday] of Object.entries(weekdays)) {
    if (lower.includes(name)) {
      let dt = now.set({ weekday: weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7 });
      if (dt <= now) dt = dt.plus({ days: 7 });
      return atNine(dt).toJSDate();
    }
  }

  if (PROMISE_WORDS.test(raw) || /\b(baad mein|phir try)\b/i.test(raw)) {
    return atNine(now.plus({ hours: 48 })).toJSDate();
  }

  return null;
}
