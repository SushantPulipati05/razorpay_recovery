export interface StrategyLift {
  strategy: string;
  treatedCount: number;
  treatedRecovered: number;
  treatedRatePercent: number;
  holdoutCount: number;
  holdoutRecovered: number;
  holdoutRatePercent: number;
  liftPercentagePoints: number;
  incrementalRevenue: number;
}

export interface DashboardMetrics {
  totalFailedAmount: number;
  totalRecoveredRevenue: number;
  recoveryRate: number;
  activeNudgesSent: number;
  totalFailures: number;
  recoveredCount?: number;
  netRevenueSaved: number;
  deferredCount?: number;
  treatedRate?: number;
  holdoutRate?: number;
  liftPercentagePoints?: number;
  incrementalRevenue?: number;
  holdoutCount?: number;
  promiseToPayCount?: number;
  diagnosisDisagreements?: number;
  strategyLift?: StrategyLift[];
}

export interface FailureReasonCount {
  reason: string;
  count: number;
}

export interface DailyRevenueTrend {
  date: string;
  recoveredAmount: number;
  failedAmount: number;
}

export interface TransactionRecord {
  id: string;
  razorpay_pay_id: string;
  razorpay_order_id: string;
  customer_phone: string;
  customer_email: string | null;
  original_amount: number;
  failure_reason: string;
  failure_source: string;
  diagnosed_strategy: string | null;
  status:
    | 'PENDING'
    | 'INTERVENING'
    | 'RECOVERED'
    | 'HALTED_POLICY'
    | 'HALTED_EXHAUSTED'
    | 'DEFERRED'
    | 'HOLDOUT'
    | 'PROMISE_TO_PAY';
  attempts_count: number;
  total_discount_given: number;
  total_cost_incurred: number;
  recovered_amount: number;
  is_holdout?: boolean;
  loss_mode?: string;
  rule_strategy?: string | null;
  groq_strategy?: string | null;
  diagnosis_disagreed?: boolean;
  promise_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogItem {
  id: string;
  transaction_id: string;
  order_id?: string;
  step: string;
  reasoning: string;
  cost_incurred: number;
  timestamp: string;
}
