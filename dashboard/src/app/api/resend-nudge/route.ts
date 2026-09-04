import { NextRequest, NextResponse } from 'next/server';

const RECOVERY_SERVICE_URL = process.env.RECOVERY_SERVICE_URL || 'http://localhost:4000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionId } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });
    }

    const res = await fetch(`${RECOVERY_SERVICE_URL}/api/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId })
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    console.error('Error triggering manual resend:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to resend nudge. Is the recovery service running on port 4000?' },
      { status: 500 }
    );
  }
}
