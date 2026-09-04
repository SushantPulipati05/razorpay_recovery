import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    let sql = `
      SELECT
        id,
        razorpay_pay_id,
        razorpay_order_id,
        customer_phone,
        customer_email,
        original_amount::numeric(10,2) as original_amount,
        failure_reason,
        failure_source,
        diagnosed_strategy,
        status,
        attempts_count,
        total_discount_given::numeric(10,2) as total_discount_given,
        total_cost_incurred::numeric(10,2) as total_cost_incurred,
        recovered_amount::numeric(10,2) as recovered_amount,
        COALESCE(is_holdout, FALSE) as is_holdout,
        COALESCE(loss_mode, 'PAYMENT_FAILED') as loss_mode,
        rule_strategy,
        groq_strategy,
        COALESCE(diagnosis_disagreed, FALSE) as diagnosis_disagreed,
        promise_at,
        created_at,
        updated_at
      FROM transaction_failures
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      sql += ` AND (razorpay_order_id ILIKE $${paramIndex} OR customer_phone ILIKE $${paramIndex} OR razorpay_pay_id ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status && status !== 'ALL') {
      sql += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    sql += ` ORDER BY created_at DESC LIMIT 50`;

    const result = await query(sql, params);
    return NextResponse.json({
      count: result.rowCount,
      data: result.rows
    });
  } catch (err: any) {
    console.error('Error fetching transactions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}
