import { DateTime } from 'luxon';
import { PolicyEvaluation } from '../types/db';
import { env } from '../config/env';
import { isQuietHours, nextQuietHoursEnd, QUIET_HOURS_END, QUIET_HOURS_START } from '../recovery/schedule';

export class PolicyEngine {
  public static readonly MAX_ATTEMPTS = 3;
  public static readonly MAX_DISCOUNT_PERCENT = 5.0;

  /**
   * Evaluates business and regulatory policies:
   * 1. Max 3 attempts (hard stop)
   * 2. TRAI quiet hours — defer until 9 AM IST, never discard
   * 3. Max 5% discount cap
   */
  public static evaluate(params: {
    attemptsCount: number;
    originalAmount: number;
    proposedDiscountPercent?: number;
    customCheckTimeIST?: DateTime;
    forceQuietHours?: boolean;
  }): PolicyEvaluation {
    const {
      attemptsCount,
      originalAmount,
      proposedDiscountPercent = 0,
      customCheckTimeIST,
      forceQuietHours
    } = params;

    if (attemptsCount >= this.MAX_ATTEMPTS) {
      return {
        allowed: false,
        status: 'HALTED_EXHAUSTED',
        reason: `Exhausted maximum permitted recovery attempts (${this.MAX_ATTEMPTS}). Current attempts: ${attemptsCount}.`,
        approvedDiscountPercent: 0,
        approvedDiscountAmount: 0
      };
    }

    const istTime =
      customCheckTimeIST ||
      (forceQuietHours
        ? DateTime.fromObject({ hour: 22, minute: 30 }, { zone: 'Asia/Kolkata' })
        : DateTime.now().setZone('Asia/Kolkata'));
    // Production always defers during TRAI hours. Development only when a clock is injected or a demo forces quiet hours.
    const applyQuietHours =
      env.NODE_ENV === 'production' || Boolean(customCheckTimeIST) || Boolean(forceQuietHours);
    if (applyQuietHours && isQuietHours(istTime as DateTime)) {
      const wakeAt = nextQuietHoursEnd(istTime as DateTime);
      return {
        allowed: false,
        status: 'DEFERRED',
        reason: `TRAI quiet hours (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00 IST). Nudge deferred until ${wakeAt.toFormat('hh:mm a, dd LLL yyyy')}.`,
        approvedDiscountPercent: 0,
        approvedDiscountAmount: 0,
        nextRetryAt: wakeAt.toJSDate()
      };
    }

    const requested = Math.max(0, proposedDiscountPercent);
    const approvedDiscountPercent = Math.min(requested, this.MAX_DISCOUNT_PERCENT);
    const approvedDiscountAmount = Number(
      ((originalAmount * approvedDiscountPercent) / 100).toFixed(2)
    );

    return {
      allowed: true,
      status: 'INTERVENING',
      reason: `Policy approved: Attempt ${attemptsCount + 1} of ${this.MAX_ATTEMPTS}. Discount capped at ${approvedDiscountPercent}%.`,
      approvedDiscountPercent,
      approvedDiscountAmount
    };
  }

  public static isTraiQuietHours(now = DateTime.now().setZone('Asia/Kolkata')): boolean {
    return isQuietHours(now);
  }
}
