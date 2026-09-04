import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    // 1. Failure reason distribution (for Donut / Pie Chart)
    const reasonRes = await query(`
      SELECT
        COALESCE(failure_reason, 'UNKNOWN') AS reason,
        COUNT(*)::int AS count
      FROM transaction_failures
      GROUP BY failure_reason
      ORDER BY count DESC
      LIMIT 6
    `);

    // Format human-friendly labels
    const failureReasons = reasonRes.rows.map((r) => ({
      reason: formatReasonLabel(r.reason),
      count: Number(r.count)
    }));

    // 2. Daily revenue trend for the past 7 days (for Area Chart)
    const trendRes = await query(`
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT
        TO_CHAR(d.day, 'Mon DD') AS date,
        COALESCE(SUM(tf.recovered_amount), 0)::numeric(12,2) AS "recoveredAmount",
        COALESCE(SUM(tf.original_amount), 0)::numeric(12,2) AS "failedAmount"
      FROM days d
      LEFT JOIN transaction_failures tf ON DATE(tf.updated_at) = d.day
      GROUP BY d.day
      ORDER BY d.day ASC
    `);

    const dailyTrend = trendRes.rows.map((r) => ({
      date: r.date,
      recoveredAmount: Number(r.recoveredAmount || 0),
      failedAmount: Number(r.failedAmount || 0)
    }));

    return NextResponse.json({
      failureReasons,
      dailyTrend
    });
  } catch (err: any) {
    console.error('Error fetching analytics data:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
}

function formatReasonLabel(raw: string): string {
  const map: Record<string, string> = {
    payment_authentication_failed: 'OTP / Auth Failed',
    bad_request_error: 'User Cancelled',
    bank_system_error: 'Bank System Offline',
    gateway_error: 'Gateway Timeout',
    insufficient_funds: 'Insufficient Funds',
    fraud_suspicious_activity: 'Fraud Security Flag'
  };
  const key = raw.toLowerCase();
  return map[key] || raw.replace(/_/g, ' ').toUpperCase();
}
