import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT id, intake_uuid, client_name, client_email, division, priority, sha256_receipt, routed_endpoint, spoke_status, status, created_at
       FROM platform_intake_submissions
       ORDER BY id DESC
       LIMIT 15`
    );
    return NextResponse.json({ receipts: result.rows });
  } catch (err) {
    console.error('Failed to query platform_intake_submissions:', err);
    return NextResponse.json({ receipts: [], error: 'Failed to load receipts' }, { status: 500 });
  }
}