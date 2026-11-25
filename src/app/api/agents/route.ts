import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const orgId = (req.nextUrl.searchParams.get('orgId') || '').trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const runsRes = uuidRegex.test(orgId)
      ? await pool.query(
          `SELECT id, run_uuid, org_id, intake_id, agent_name, agent_role, trigger_source, model_name,
                  input_sha256, output_sha256, proposed_actions, confidence_score,
                  approval_status, approved_by, approved_at, execution_status, created_at
           FROM agent_audit_runs
           WHERE org_id = $1
           ORDER BY id DESC
           LIMIT 15`,
          [orgId]
        )
      : await pool.query(
          `SELECT id, run_uuid, org_id, intake_id, agent_name, agent_role, trigger_source, model_name,
                  input_sha256, output_sha256, proposed_actions, confidence_score,
                  approval_status, approved_by, approved_at, execution_status, created_at
           FROM agent_audit_runs
           ORDER BY id DESC
           LIMIT 15`
        );

    return NextResponse.json({ runs: runsRes.rows });
  } catch (err) {
    console.error('Failed to query agent_audit_runs:', err);
    return NextResponse.json({ runs: [], error: 'Failed to load agent runs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { runId, decision, reviewer } = await req.json();
    if (!runId || (decision !== 'approved' && decision !== 'rejected')) {
      return NextResponse.json({ error: 'Valid runId and decision (approved|rejected) required.' }, { status: 400 });
    }

    const nextExecStatus = decision === 'approved' ? 'executed' : 'blocked';
    const updated = await pool.query(
      `UPDATE agent_audit_runs
       SET approval_status = $1,
           execution_status = $2,
           approved_by = $3,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, run_uuid, agent_name, approval_status, execution_status, approved_by, approved_at`,
      [decision, nextExecStatus, typeof reviewer === 'string' && reviewer.trim() ? reviewer.trim() : 'Founder (HITL)', runId]
    );

    if (updated.rows.length === 0) {
      return NextResponse.json({ error: 'Agent run not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, run: updated.rows[0] });
  } catch (err) {
    console.error('Failed to update agent approval status:', err);
    return NextResponse.json({ error: 'Failed to update approval.' }, { status: 500 });
  }
}