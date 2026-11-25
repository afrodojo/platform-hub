import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const orgId = (req.nextUrl.searchParams.get('orgId') || '').trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const result = uuidRegex.test(orgId)
      ? await pool.query(
          `SELECT id, org_id, intake_uuid, client_name, client_email, division, priority, sha256_receipt, routed_endpoint, spoke_status, triage_status, needs_approval, status, created_at
           FROM platform_intake_submissions
           WHERE org_id = $1
           ORDER BY id DESC
           LIMIT 20`,
          [orgId]
        )
      : await pool.query(
          `SELECT id, org_id, intake_uuid, client_name, client_email, division, priority, sha256_receipt, routed_endpoint, spoke_status, triage_status, needs_approval, status, created_at
           FROM platform_intake_submissions
           ORDER BY id DESC
           LIMIT 20`
        );

    return NextResponse.json({ receipts: result.rows });
  } catch (err) {
    console.error('Failed to query platform_intake_submissions:', err);
    return NextResponse.json({ receipts: [], error: 'Failed to load receipts' }, { status: 500 });
  }
}