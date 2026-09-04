import { env } from '../config/env';

export type RecoveryCohort = 'holdout' | 'treated';

/**
 * Deterministic 30% holdout so the same payment always lands in the same cohort.
 * Optional forceCohort is for the batch demo (explicit treated vs control).
 */
export function assignCohort(payId: string, forceCohort?: RecoveryCohort): RecoveryCohort {
  if (forceCohort === 'holdout' || forceCohort === 'treated') {
    return forceCohort;
  }
  let hash = 0;
  for (let i = 0; i < payId.length; i++) {
    hash = (hash * 31 + payId.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < env.HOLDOUT_PERCENT ? 'holdout' : 'treated';
}
