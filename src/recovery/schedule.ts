import { DateTime } from 'luxon';
import { env } from '../config/env';

export const QUIET_HOURS_START = 21;
export const QUIET_HOURS_END = 9;

export function retryDelaysHours(): { attempt1: number; attempt2: number } {
  return env.NODE_ENV === 'development'
    ? { attempt1: 5 / 60, attempt2: 15 / 60 }
    : { attempt1: 24, attempt2: 72 };
}

export function nsfDeferHours(attemptsCount: number): number {
  const delays = retryDelaysHours();
  return attemptsCount <= 0 ? delays.attempt1 : delays.attempt2;
}

export function nextQuietHoursEnd(now: DateTime = DateTime.now().setZone('Asia/Kolkata')): DateTime {
  const t = now as DateTime;
  if (t.hour >= QUIET_HOURS_START) {
    return t.plus({ days: 1 }).set({ hour: QUIET_HOURS_END, minute: 0, second: 0, millisecond: 0 });
  }
  if (t.hour < QUIET_HOURS_END) {
    return t.set({ hour: QUIET_HOURS_END, minute: 0, second: 0, millisecond: 0 });
  }
  return t;
}

export function isQuietHours(now: DateTime = DateTime.now().setZone('Asia/Kolkata')): boolean {
  const hour = (now as DateTime).hour;
  return hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END;
}
