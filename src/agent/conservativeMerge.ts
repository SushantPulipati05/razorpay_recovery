import { DiagnosedStrategy, DiagnosticResult, FailureCategory } from '../types/db';

/** Higher = more restrictive (less contact, less discount). */
const STRICTNESS: Record<DiagnosedStrategy, number> = {
  FRAUD_DECLINE_NO_RETRY: 4,
  INSUFFICIENT_FUNDS_DEFERRED: 3,
  BANK_OUTAGE_ALTERNATIVE_RAIL: 2,
  CUSTOMER_DROP_INCENTIVE_5_PERCENT: 1
};

function categoryFor(strategy: DiagnosedStrategy): FailureCategory {
  return strategy === 'BANK_OUTAGE_ALTERNATIVE_RAIL' ? 'BANK_NETWORK_ERROR' : 'CUSTOMER_ERROR';
}

function discountFor(strategy: DiagnosedStrategy): number {
  return strategy === 'CUSTOMER_DROP_INCENTIVE_5_PERCENT' ? 5 : 0;
}

/**
 * If Groq and rules disagree, keep the stricter action.
 * Fraud from either source always wins. Discount is the minimum.
 */
export function mergeDiagnoses(
  rules: DiagnosticResult,
  groq: DiagnosticResult | null
): DiagnosticResult {
  if (!groq) {
    return {
      ...rules,
      source: 'rules',
      ruleStrategy: rules.strategy,
      groqStrategy: null,
      disagreed: false
    };
  }

  const disagreed = rules.strategy !== groq.strategy;
  const picked =
    STRICTNESS[rules.strategy] >= STRICTNESS[groq.strategy] ? rules.strategy : groq.strategy;
  const recommendedDiscountPercent = Math.min(
    discountFor(picked),
    rules.recommendedDiscountPercent,
    groq.recommendedDiscountPercent
  );

  return {
    category: categoryFor(picked),
    strategy: picked,
    recommendedDiscountPercent,
    explanation: disagreed
      ? `Disagreement: rules=${rules.strategy} groq=${groq.strategy}. Conservative pick=${picked}. ${rules.explanation}`
      : groq.explanation || rules.explanation,
    source: disagreed ? 'merged' : groq.source === 'groq' ? 'groq' : 'rules',
    ruleStrategy: rules.strategy,
    groqStrategy: groq.strategy,
    disagreed
  };
}
