import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { DashboardMetrics } from '@/types/dashboard';

export async function GET() {
  try {
    const result = await query(`
      SELECT
        COUNT(*)::int AS total_failures,
        COUNT(*) FILTER (WHERE status = 'INTERVENING')::int AS active_nudges,
        COUNT(*) FILTER (WHERE status = 'RECOVERED')::int AS recovered_count,
        COUNT(*) FILTER (WHERE status = 'DEFERRED')::int AS deferred_count,
        COUNT(*) FILTER (WHERE status = 'PROMISE_TO_PAY')::int AS promise_to_pay_count,
        COUNT(*) FILTER (WHERE diagnosis_disagreed)::int AS diagnosis_disagreements,
        COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE))::int AS treated_count,
        COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS treated_recovered,
        COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE))::int AS holdout_count,
        COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS holdout_recovered,
        COALESCE(SUM(original_amount), 0)::numeric(12,2) AS total_failed_amount,
        COALESCE(SUM(recovered_amount), 0)::numeric(12,2) AS total_recovered_revenue,
        COALESCE(SUM(original_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_at_risk,
        COALESCE(SUM(recovered_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_recovered_amount,
        COALESCE(SUM(original_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_at_risk,
        COALESCE(SUM(recovered_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_recovered_amount,
        COALESCE(SUM(total_discount_given), 0)::numeric(12,2) AS total_discount_given,
        COALESCE(SUM(total_cost_incurred), 0)::numeric(12,2) AS total_cost_incurred
      FROM transaction_failures
    `);

    const row = result.rows[0] || {};
    const totalFailures = Number(row.total_failures || 0);
    const recoveredCount = Number(row.recovered_count || 0);
    const totalFailedAmount = Number(row.total_failed_amount || 0);
    const totalRecoveredRevenue = Number(row.total_recovered_revenue || 0);
    const activeNudgesSent = Number(row.active_nudges || 0);
    const totalCostIncurred = Number(row.total_cost_incurred || 0);
    const treatedCount = Number(row.treated_count || 0);
    const treatedRecovered = Number(row.treated_recovered || 0);
    const holdoutCount = Number(row.holdout_count || 0);
    const holdoutRecovered = Number(row.holdout_recovered || 0);
    const treatedAtRisk = Number(row.treated_at_risk || 0);
    const treatedRecoveredAmount = Number(row.treated_recovered_amount || 0);
    const holdoutAtRisk = Number(row.holdout_at_risk || 0);
    const holdoutRecoveredAmount = Number(row.holdout_recovered_amount || 0);

    const recoveryRate =
      totalFailures > 0 ? Number(((recoveredCount / totalFailures) * 100).toFixed(1)) : 0;
    const treatedRate = treatedCount > 0 ? Number(((treatedRecovered / treatedCount) * 100).toFixed(1)) : 0;
    const holdoutRate = holdoutCount > 0 ? Number(((holdoutRecovered / holdoutCount) * 100).toFixed(1)) : 0;
    const liftPercentagePoints = Number((treatedRate - holdoutRate).toFixed(1));
    const holdoutRateFraction = holdoutCount > 0 ? holdoutRecoveredAmount / Math.max(holdoutAtRisk, 0.01) : 0;
    const incrementalRevenue = Number((treatedRecoveredAmount - treatedAtRisk * holdoutRateFraction).toFixed(2));
    const netRevenueSaved = Number((totalRecoveredRevenue - totalCostIncurred).toFixed(2));

    const strategyResult = await query(`
      SELECT
        COALESCE(diagnosed_strategy, 'UNCLASSIFIED') AS strategy,
        COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE))::int AS treated_count,
        COUNT(*) FILTER (WHERE NOT COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS treated_recovered,
        COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE))::int AS holdout_count,
        COUNT(*) FILTER (WHERE COALESCE(is_holdout, FALSE) AND status = 'RECOVERED')::int AS holdout_recovered,
        COALESCE(SUM(original_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_at_risk,
        COALESCE(SUM(recovered_amount) FILTER (WHERE NOT COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS treated_recovered_amount,
        COALESCE(SUM(original_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_at_risk,
        COALESCE(SUM(recovered_amount) FILTER (WHERE COALESCE(is_holdout, FALSE)), 0)::numeric(12,2) AS holdout_recovered_amount
      FROM transaction_failures
      WHERE diagnosed_strategy IS NOT NULL
      GROUP BY diagnosed_strategy
      ORDER BY treated_count DESC, holdout_count DESC
    `);

    const strategyLift = strategyResult.rows.map((r: any) => {
      const sTreatedCount = Number(r.treated_count);
      const sTreatedRecovered = Number(r.treated_recovered);
      const sHoldoutCount = Number(r.holdout_count);
      const sHoldoutRecovered = Number(r.holdout_recovered);
      const sTreatedAtRisk = Number(r.treated_at_risk);
      const sTreatedRecoveredAmount = Number(r.treated_recovered_amount);
      const sHoldoutAtRisk = Number(r.holdout_at_risk);
      const sHoldoutRecoveredAmount = Number(r.holdout_recovered_amount);

      const sTreatedRate = sTreatedCount > 0 ? Number(((sTreatedRecovered / sTreatedCount) * 100).toFixed(1)) : 0;
      const sHoldoutRate = sHoldoutCount > 0 ? Number(((sHoldoutRecovered / sHoldoutCount) * 100).toFixed(1)) : 0;
      const sHoldoutRateFraction = sHoldoutCount > 0 ? sHoldoutRecoveredAmount / Math.max(sHoldoutAtRisk, 0.01) : 0;
      const sIncrementalRevenue = Number((sTreatedRecoveredAmount - sTreatedAtRisk * sHoldoutRateFraction).toFixed(2));

      return {
        strategy: r.strategy,
        treatedCount: sTreatedCount,
        treatedRecovered: sTreatedRecovered,
        treatedRatePercent: sTreatedRate,
        holdoutCount: sHoldoutCount,
        holdoutRecovered: sHoldoutRecovered,
        holdoutRatePercent: sHoldoutRate,
        liftPercentagePoints: Number((sTreatedRate - sHoldoutRate).toFixed(1)),
        incrementalRevenue: sIncrementalRevenue
      };
    });

    const metrics: DashboardMetrics = {
      totalFailedAmount,
      totalRecoveredRevenue,
      recoveryRate,
      activeNudgesSent,
      totalFailures,
      recoveredCount,
      netRevenueSaved,
      deferredCount: Number(row.deferred_count || 0),
      treatedRate,
      holdoutRate,
      liftPercentagePoints,
      incrementalRevenue,
      holdoutCount,
      promiseToPayCount: Number(row.promise_to_pay_count || 0),
      diagnosisDisagreements: Number(row.diagnosis_disagreements || 0),
      strategyLift
    };

    return NextResponse.json(metrics);
  } catch (err: any) {
    console.error('Error fetching dashboard metrics:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
