import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';
import { verifyRotatingCode } from '@/lib/rotatingCode';

export const dynamic = 'force-dynamic';

const ALLOWED_DOMAINS = new Set([
  'subscriptions',
  'seo',
  'marketing',
  'social',
  'infra',
  'operations',
]);

const HIGH_RISK_DOMAINS = new Set(['subscriptions', 'infra']);

const DOMAIN_AGENT_MAP: Record<string, { name: string; role: string; defaultAction: string }> = {
  subscriptions: {
    name: 'BillingOpsAgent',
    role: 'Subscription & Credit Specialist',
    defaultAction: 'review_tier_or_credit_adjustment',
  },
  seo: {
    name: 'SeoGrowthAgent',
    role: 'Technical & Search Growth Specialist',
    defaultAction: 'publish_seo_metadata_or_brief',
  },
  marketing: {
    name: 'CampaignAgent',
    role: 'Demand & Funnel Specialist',
    defaultAction: 'launch_campaign_or_outreach_batch',
  },
  social: {
    name: 'SocialMediaAgent',
    role: 'Channel & Distribution Specialist',
    defaultAction: 'publish_social_post',
  },
  infra: {
    name: 'InfraScaleAgent',
    role: 'Infrastructure & Capacity Specialist',
    defaultAction: 'scale_or_recreate_service',
  },
  operations: {
    name: 'ChiefOfStaffAgent',
    role: 'Executive Chief of Staff',
    defaultAction: 'execute_operational_task',
  },
};

export async function GET(req: NextRequest) {
  try {
    const orgId = (req.nextUrl.searchParams.get('orgId') || '').trim();
    const domain = (req.nextUrl.searchParams.get('domain') || '').trim().toLowerCase();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (uuidRegex.test(orgId)) {
      params.push(orgId);
      conditions.push(`org_id = $${params.length}`);
    }

    if (domain && domain !== 'all' && ALLOWED_DOMAINS.has(domain)) {
      params.push(domain);
      conditions.push(`domain_category = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const runsRes = await pool.query(
      `SELECT id, run_uuid, org_id, intake_id, domain_category, agent_name, agent_role,
              trigger_source, model_name, input_sha256, output_sha256,
              proposed_actions, payload_preview, confidence_score,
              requires_step_up_code, step_up_verified_at,
              approval_status, approved_by, approved_at, execution_status, created_at
       FROM agent_audit_runs
       ${whereClause}
       ORDER BY id DESC
       LIMIT 25`,
      params
    );

    return NextResponse.json({ runs: runsRes.rows });
  } catch (err) {
    console.error('Failed to query agent_audit_runs:', err);
    return NextResponse.json({ runs: [], error: 'Failed to load agent runs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'stage_draft') {
      const rawDomain = typeof body.domainCategory === 'string' ? body.domainCategory.trim().toLowerCase() : 'operations';
      const domainCategory = ALLOWED_DOMAINS.has(rawDomain) ? rawDomain : 'operations';
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : '';
      const draftBody = typeof body.draftBody === 'string' ? body.draftBody.trim().slice(0, 4000) : '';
      const targetChannel = typeof body.targetChannel === 'string' ? body.targetChannel.trim().slice(0, 120) : '';
      const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : null;

      if (!title || !draftBody) {
        return NextResponse.json({ error: 'Draft title and content are required.' }, { status: 400 });
      }

      const requiresStepUpCode = HIGH_RISK_DOMAINS.has(domainCategory) || Boolean(body.requiresStepUpCode);
      const meta = DOMAIN_AGENT_MAP[domainCategory] || DOMAIN_AGENT_MAP.operations;
      const previewObj = {
        title,
        targetChannel: targetChannel || domainCategory,
        summary: draftBody,
        stagedAt: new Date().toISOString(),
      };
      const inputSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify({ domainCategory, title, draftBody }))
        .digest('hex');
      const outputSha256 = crypto
        .createHash('sha256')
        .update(JSON.stringify(previewObj))
        .digest('hex');
      const proposedActions = [
        {
          action: meta.defaultAction,
          target: targetChannel || domainCategory,
          reason: title,
        },
      ];

      const inserted = await pool.query(
        `INSERT INTO agent_audit_runs (
           org_id, domain_category, agent_name, agent_role, trigger_source, model_name,
           input_sha256, output_sha256, tool_calls, proposed_actions, payload_preview,
           confidence_score, requires_step_up_code, approval_status, execution_status
         )
         VALUES ($1, $2, $3, $4, 'founder_hitl_draft', 'hitl-drafter-v1', $5, $6, '[]'::jsonb, $7::jsonb, $8::jsonb, 0.920, $9, 'pending_approval', 'staged_for_review')
         RETURNING id, run_uuid, org_id, intake_id, domain_category, agent_name, agent_role,
                   trigger_source, model_name, input_sha256, output_sha256,
                   proposed_actions, payload_preview, confidence_score,
                   requires_step_up_code, step_up_verified_at,
                   approval_status, approved_by, approved_at, execution_status, created_at`,
        [
          orgId,
          domainCategory,
          meta.name,
          meta.role,
          inputSha256,
          outputSha256,
          JSON.stringify(proposedActions),
          JSON.stringify(previewObj),
          requiresStepUpCode,
        ]
      );

      return NextResponse.json({ ok: true, run: inserted.rows[0] }, { status: 201 });
    }

    const { runId, decision, reviewer, rotatingCode } = body;
    if (!runId || (decision !== 'approved' && decision !== 'rejected')) {
      return NextResponse.json({ error: 'Valid runId and decision (approved|rejected) required.' }, { status: 400 });
    }

    const existingRes = await pool.query(
      `SELECT id, domain_category, requires_step_up_code FROM agent_audit_runs WHERE id = $1 LIMIT 1`,
      [runId]
    );

    if (existingRes.rows.length === 0) {
      return NextResponse.json({ error: 'Agent run not found.' }, { status: 404 });
    }

    const targetRun = existingRes.rows[0];
    const needsStepUp =
      decision === 'approved' &&
      (Boolean(targetRun.requires_step_up_code) ||
        HIGH_RISK_DOMAINS.has(String(targetRun.domain_category || '').toLowerCase()));

    if (needsStepUp && !verifyRotatingCode(rotatingCode)) {
      return NextResponse.json(
        { error: 'Valid 6-digit rotating code required to approve high-risk actions.' },
        { status: 401 }
      );
    }

    const nextExecStatus = decision === 'approved' ? 'approved_for_execution' : 'blocked_by_reviewer';
    const updated = await pool.query(
      `UPDATE agent_audit_runs
       SET approval_status = $1,
           execution_status = $2,
           approved_by = $3,
           approved_at = NOW(),
           step_up_verified_at = CASE WHEN $4 THEN NOW() ELSE step_up_verified_at END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, run_uuid, org_id, intake_id, domain_category, agent_name, agent_role,
                 trigger_source, model_name, input_sha256, output_sha256,
                 proposed_actions, payload_preview, confidence_score,
                 requires_step_up_code, step_up_verified_at,
                 approval_status, approved_by, approved_at, execution_status, created_at`,
      [
        decision,
        nextExecStatus,
        typeof reviewer === 'string' && reviewer.trim() ? reviewer.trim() : 'Founder (HITL)',
        needsStepUp,
        runId,
      ]
    );

    return NextResponse.json({ ok: true, run: updated.rows[0] });
  } catch (err) {
    console.error('Failed to process /api/agents request:', err);
    return NextResponse.json({ error: 'Failed to process agent action.' }, { status: 500 });
  }
}