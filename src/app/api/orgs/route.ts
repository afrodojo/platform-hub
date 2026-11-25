import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await pool.query(
      `SELECT
         o.id,
         o.name,
         o.primary_domain,
         o.rd_telemetry_opt_in,
         COALESCE(s.tier, 'essentials') AS tier,
         COALESCE(s.status, 'active') AS subscription_status,
         COALESCE(s.monthly_ron_credits, 2) AS monthly_ron_credits,
         COALESCE(s.remaining_ron_credits, 2) AS remaining_ron_credits,
         COALESCE(s.monthly_process_credits, 0) AS monthly_process_credits,
         COALESCE(s.remaining_process_credits, 0) AS remaining_process_credits,
         COALESCE(s.rd_lab_access, false) AS rd_lab_access
       FROM organizations o
       LEFT JOIN LATERAL (
         SELECT *
         FROM subscriptions sub
         WHERE sub.org_id = o.id
         ORDER BY updated_at DESC
         LIMIT 1
       ) s ON true
       ORDER BY o.created_at ASC`
    );
    return NextResponse.json({ organizations: res.rows });
  } catch (err) {
    console.error('Failed to load organizations:', err);
    return NextResponse.json({ organizations: [], error: 'Failed to load organizations' }, { status: 500 });
  }
}