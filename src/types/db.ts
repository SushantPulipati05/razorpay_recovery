export type RecoveryStatus =
  | 'PENDING'
  | 'INTERVENING'
  | 'RECOVERED'
  | 'HALTED_POLICY'
  | 'HALTED_EXHAUSTED'
  | 'DEFERRED'
  | 'HOLDOUT'
  | 'PROMISE_TO_PAY';

export type LossMode = 'PAYMENT_FAILED' | 'SUBSCRIPTION_FAILED' | 'INVOICE_OVERDUE';

export type DiagnosedStrategy =
  | 'BANK_OUTAGE_ALTERNATIVE_RAIL'
  | 'CUSTOMER_DROP_INCENTIVE_5_PERCENT'
  | 'INSUFFICIENT_FUNDS_DEFERRED'
  | 'FRAUD_DECLINE_NO_RETRY';

export interface TransactionFailureRow {
  id: string;
  razorpay_pay_id: string;
  razorpay_order_id: string;
  customer_phone: string;
  customer_email: string | null;
  original_amount: number | string;
  failure_reason: string;
  failure_source: string;
  diagnosed_strategy: string | null;
  status: RecoveryStatus;
  attempts_count: number;
  total_cost_incurred: number | string;
  total_discount_given: number | string;
  recovered_amount: number | string;
  payment_link_id: string | null;
  next_retry_at: Date | null;
  is_holdout: boolean;
  loss_mode: LossMode | string;
  error_code: string | null;
  error_description: string | null;
  error_step: string | null;
  preferred_method: string | null;
  promise_at: Date | null;
  defer_reason: string | null;
  rule_strategy: string | null;
  groq_strategy: string | null;
  diagnosis_disagreed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLogRow {
  id: string;
  transaction_id: string;
  step: string;
  reasoning: string;
  cost_incurred: number | string;
  timestamp: Date;
}

export type FailureCategory = 'CUSTOMER_ERROR' | 'BANK_NETWORK_ERROR';

export interface DiagnosticResult {
  category: FailureCategory;
  strategy: DiagnosedStrategy;
  recommendedDiscountPercent: number;
  explanation: string;
  source?: 'rules' | 'groq' | 'merged';
  ruleStrategy?: DiagnosedStrategy;
  groqStrategy?: DiagnosedStrategy | null;
  disagreed?: boolean;
}

export interface StrategyLiftRow {
  strategy: string;
  treated_count: number;
  treated_recovered: number;
  treated_rate_percent: number;
  holdout_count: number;
  holdout_recovered: number;
  holdout_rate_percent: number;
  lift_percentage_points: number;
  incremental_revenue: number;
}

export interface PolicyEvaluation {
  allowed: boolean;
  status: RecoveryStatus;
  reason: string;
  approvedDiscountPercent: number;
  approvedDiscountAmount: number;
  nextRetryAt?: Date;
}

export interface RecoverySummary {
  total_failures: number;
  pending: number;
  intervening: number;
  recovered: number;
  halted_policy: number;
  halted_exhausted: number;
  deferred: number;
  holdout: number;
  total_original_at_risk: number;
  total_recovered_amount: number;
  total_discount_given: number;
  total_cost_incurred: number;
  recovery_rate_percent: number;
  treated_count: number;
  treated_recovered: number;
  treated_recovery_rate_percent: number;
  holdout_count: number;
  holdout_recovered: number;
  holdout_recovery_rate_percent: number;
  lift_percentage_points: number;
  incremental_revenue: number;
  net_revenue_saved: number;
  promise_to_pay: number;
  diagnosis_disagreements: number;
  strategy_lift: StrategyLiftRow[];
}
