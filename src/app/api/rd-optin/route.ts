import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const { orgId, optIn } = await req.json();
    if (typeof orgId !== 'string' || typeof optIn !== 'boolean') {
      return NextResponse.json({ error: 'orgId and boolean optIn are required.' }, { status: 400 });
    }

    await pool.query(
      `UPDATE organizations
       SET rd_telemetry_opt_in = $1,
           irb_consent_version = CASE WHEN $1 THEN 'IRB-2026-v1' ELSE NULL END
       WHERE id = $2`,
      [optIn, orgId]
    );

    return NextResponse.json({ ok: true, optIn });
  } catch (err) {
    console.error('R&D opt-in update error:', err);
    return NextResponse.json({ error: 'Failed to update R&D telemetry preference.' }, { status: 500 });
  }
}