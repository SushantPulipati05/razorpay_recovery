import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // The Agent Activity tab needs enough history to follow a transaction end
    // to end, not just the 20 most recent events. Clamped so a stray ?limit
    // can't ask for the whole table.
    const requested = Number(request.nextUrl.searchParams.get('limit'));
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 500) : 200;

    const result = await query(
      `
      SELECT
        al.id,
        al.transaction_id,
        tf.razorpay_order_id AS order_id,
        al.step,
        al.reasoning,
        al.cost_incurred::numeric(10,2) AS cost_incurred,
        al.timestamp
      FROM audit_logs al
      JOIN transaction_failures tf ON al.transaction_id = tf.id
      ORDER BY al.timestamp DESC
      LIMIT $1
    `,
      [limit]
    );

    return NextResponse.json({
      count: result.rowCount,
      data: result.rows
    });
  } catch (err: any) {
    console.error('Error fetching audit logs:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}
