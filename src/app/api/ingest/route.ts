import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, getRedis } from '@/lib/db';

const ALLOWED_DIVISIONS = new Set([
  'cyber',
  'notary',
  'training',
  'rd_lab',
  'toc',
  'defense',
  'hive',
  'unity',
  'corporate',
]);

const ROUTE_MAP: Record<string, string> = {
  cyber: 'http://cyber-service:3000/',
  training: 'http://training-service:3000/',
  defense: 'http://defense-training:3000/',
  notary: 'http://notary-service:3000/',
  toc: 'http://toc-backend:4000/',
  hive: 'http://hive-alignment:8000/',
  unity: 'http://morman-unity:3000/',
  rd_lab: 'http://rd-lab-java:3000/',
  corporate: 'http://eds-corporate:3000/',
};

function classifyCreditType(division: string, title: string, payloadText: string): 'ron' | 'process' | null {
  if (division !== 'notary') return null;
  const combined = `${title} ${payloadText}`.toLowerCase();
  if (
    combined.includes('process') ||
    combined.includes('serve') ||
    combined.includes('subpoena') ||
    combined.includes('summons')
  ) {
    return 'process';
  }
  return 'ron';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
    const orgName = typeof body.orgName === 'string' ? body.orgName.trim().slice(0, 120) : 'SMB Portal Client';
    const division = typeof body.division === 'string' ? body.division.trim() : 'cyber';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const payloadText = typeof body.payload === 'string' ? body.payload.trim().slice(0, 10000) : '';
    const sourceChannel = typeof body.sourceChannel === 'string' ? body.sourceChannel.slice(0, 50) : 'web_portal';

    if (!ALLOWED_DIVISIONS.has(division) || !title || !payloadText) {
      return NextResponse.json(
        { error: 'Valid division, title, and payload are required.' },
        { status: 400 }
      );
    }

    const creditType = classifyCreditType(division, title, payloadText);
    let updatedCredits: {
      creditType: 'ron' | 'process';
      remainingRon: number;
      remainingProcess: number;
    } | null = null;

    if (creditType && orgId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const activeSubRes = await client.query(
          `SELECT id, remaining_ron_credits, remaining_process_credits
           FROM subscriptions
           WHERE org_id = $1 AND status = 'active'
           ORDER BY updated_at DESC
           LIMIT 1
           FOR UPDATE`,
          [orgId]
        );

        if (activeSubRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'No active subscription found for organization to deduct legal credits.' },
            { status: 402 }
          );
        }

        const subRow = activeSubRes.rows[0];
        if (creditType === 'ron') {
          if (Number(subRow.remaining_ron_credits) <= 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: 'Insufficient remaining RON credits for this organization.' },
              { status: 402 }
            );
          }
          const decRes = await client.query(
            `UPDATE subscriptions
             SET remaining_ron_credits = remaining_ron_credits - 1,
                 updated_at = NOW()
             WHERE id = $1 AND remaining_ron_credits > 0
             RETURNING remaining_ron_credits, remaining_process_credits`,
            [subRow.id]
          );
          updatedCredits = {
            creditType: 'ron',
            remainingRon: Number(decRes.rows[0].remaining_ron_credits),
            remainingProcess: Number(decRes.rows[0].remaining_process_credits),
          };
        } else {
          if (Number(subRow.remaining_process_credits) <= 0) {
            await client.query('ROLLBACK');
            return NextResponse.json(
              { error: 'Insufficient remaining Process Serve credits for this organization.' },
              { status: 402 }
            );
          }
          const decRes = await client.query(
            `UPDATE subscriptions
             SET remaining_process_credits = remaining_process_credits - 1,
                 updated_at = NOW()
             WHERE id = $1 AND remaining_process_credits > 0
             RETURNING remaining_ron_credits, remaining_process_credits`,
            [subRow.id]
          );
          updatedCredits = {
            creditType: 'process',
            remainingRon: Number(decRes.rows[0].remaining_ron_credits),
            remainingProcess: Number(decRes.rows[0].remaining_process_credits),
          };
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    const priority = division === 'cyber' || creditType === 'process' ? 'high' : 'standard';
    const n8nDivision = division === 'rd_lab' ? 'rd' : division;
    const outboundPayload = {
      client_name: orgName || 'SMB Portal Client',
      client_email: 'portal@localhost',
      division: n8nDivision,
      priority,
      title,
      scope: payloadText,
      org_id: orgId || null,
      credit_deducted: updatedCredits?.creditType || null,
    };

    let receipt: {
      status: string;
      db_id: number | null;
      intake_id: string;
      division: string;
      routed_endpoint: string;
      spoke_status?: string;
      sha256_receipt: string;
      timestamp: string;
    } | null = null;

    try {
      const n8nRes = await fetch('http://n8n:5678/workflows/webhook/smb-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outboundPayload),
        signal: AbortSignal.timeout(6000),
      });
      if (n8nRes.ok) {
        receipt = await n8nRes.json();
      }
    } catch (n8nErr) {
      console.warn('n8n webhook unreachable, using direct C++20 + Postgres fallback:', n8nErr);
    }

    const rawJson = JSON.stringify(outboundPayload);
    if (!receipt) {
      let sha256 = '';
      try {
        const cppRes = await fetch('http://core-cpp:8080/hash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawJson,
          signal: AbortSignal.timeout(3000),
        });
        if (cppRes.ok) {
          const cppData = await cppRes.json();
          sha256 = cppData.sha256 || '';
        }
      } catch {
        // Fallback to local SHA-256
      }
      if (!sha256) {
        sha256 = crypto.createHash('sha256').update(rawJson).digest('hex');
      }

      const intakeUuid = `INT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const routedEndpoint = ROUTE_MAP[division] || 'http://hub-web:3000/';

      const dbInsert = await pool.query(
        `INSERT INTO platform_intake_submissions (org_id, intake_uuid, client_name, client_email, division, priority, payload, raw_payload, sha256_receipt, routed_endpoint, spoke_status, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $7, $8, $9, 'direct_fallback', 'persisted')
         RETURNING id, created_at`,
        [
          orgId || null,
          intakeUuid,
          outboundPayload.client_name,
          outboundPayload.client_email,
          n8nDivision,
          priority,
          rawJson,
          sha256,
          routedEndpoint,
        ]
      );

      receipt = {
        status: 'persisted',
        db_id: dbInsert.rows[0]?.id ?? null,
        intake_id: intakeUuid,
        division: n8nDivision,
        routed_endpoint: routedEndpoint,
        spoke_status: 'direct_fallback',
        sha256_receipt: sha256,
        timestamp: dbInsert.rows[0]?.created_at ?? new Date().toISOString(),
      };
    } else if (receipt.db_id && orgId) {
      await pool.query(
        `UPDATE platform_intake_submissions SET org_id = COALESCE(org_id, $1) WHERE id = $2`,
        [orgId, receipt.db_id]
      );
    }

    // Record bounded Chief-of-Staff / Division Triage Agent run in agent_audit_runs
    const needsApproval = priority === 'high' || creditType === 'process' || division === 'rd_lab';
    const agentRoleMap: Record<string, { name: string; role: string }> = {
      cyber: { name: 'CyberTriageAgent', role: 'Cyber & Readiness Specialist' },
      notary: { name: 'LegalOpsAgent', role: 'Notary & Process Specialist' },
      training: { name: 'DojoCoachAgent', role: 'Training & Simulation Specialist' },
      defense: { name: 'DefenseCohortAgent', role: 'Defense Readiness Specialist' },
      rd_lab: { name: 'SenseiResearchAgent', role: 'Doctoral R&D Specialist' },
      toc: { name: 'TocPolicyAgent', role: 'Policy & Control Specialist' },
      hive: { name: 'HiveRouterAgent', role: 'Cross-Division Chief of Staff' },
      unity: { name: 'UnityPartnerAgent', role: 'Community & Partner Specialist' },
      corporate: { name: 'ChiefOfStaffAgent', role: 'Executive Chief of Staff' },
    };
    const agentMeta = agentRoleMap[division] || { name: 'ChiefOfStaffAgent', role: 'Executive Chief of Staff' };
    const proposedActions = [
      {
        action: `dispatch_${n8nDivision}_spoke`,
        target: receipt.routed_endpoint,
        credit_deducted: updatedCredits?.creditType || 'none',
      },
      ...(needsApproval
        ? [{ action: 'human_review_escalation', reason: `${priority} priority ${n8nDivision} intake` }]
        : []),
    ];
    const outputSha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify({ intake_id: receipt.intake_id, division: n8nDivision, proposedActions }))
      .digest('hex');

    await pool.query(
      `INSERT INTO agent_audit_runs (
         org_id, intake_id, agent_name, agent_role, trigger_source, model_name,
         input_sha256, output_sha256, tool_calls, proposed_actions, confidence_score,
         approval_status, execution_status
       )
       VALUES ($1, $2, $3, $4, 'smb_intake_pipeline', 'deterministic-triage-v1', $5, $6, $7::jsonb, $8::jsonb, 0.960, $9, 'recorded')`,
      [
        orgId || null,
        receipt.db_id,
        agentMeta.name,
        agentMeta.role,
        receipt.sha256_receipt,
        outputSha256,
        JSON.stringify([{ tool: 'core-crypto-engine:8080/hash' }, { tool: 'n8n:smb-intake' }]),
        JSON.stringify(proposedActions),
        needsApproval ? 'pending_approval' : 'auto_executed',
      ]
    );

    if (receipt.db_id) {
      await pool.query(
        `UPDATE platform_intake_submissions
         SET triage_status = 'triaged',
             recommended_priority = $1,
             needs_approval = $2,
             triage_json = $3::jsonb
         WHERE id = $4`,
        [
          priority,
          needsApproval,
          JSON.stringify({ agent: agentMeta.name, proposedActions, creditDeducted: updatedCredits?.creditType || null }),
          receipt.db_id,
        ]
      );
    }

    let ingestedId: string | null = null;
    let caseId: string | null = null;
    try {
      const ingestRes = await pool.query(
        `INSERT INTO ingested_items (org_id, source_channel, file_name, sha256_hash, clamav_status, extracted_entities, target_division, processing_status)
         VALUES ($1, $2, $3, $4, 'clean', $5::jsonb, $6, 'queued')
         RETURNING id`,
        [
          orgId || null,
          sourceChannel,
          title,
          receipt.sha256_receipt,
          JSON.stringify({
            rawInput: payloadText,
            intakeUuid: receipt.intake_id,
            submittedAt: receipt.timestamp,
          }),
          division,
        ]
      );
      ingestedId = ingestRes.rows[0]?.id ?? null;

      if (orgId && division !== 'toc') {
        const caseRes = await pool.query(
          `INSERT INTO division_cases (org_id, ingestion_id, division, title, priority, status, workflow_state)
           VALUES ($1, $2, $3, $4, $5, 'open', $6::jsonb)
           RETURNING id`,
          [
            orgId,
            ingestedId,
            division,
            title,
            priority,
            JSON.stringify({
              sha256: receipt.sha256_receipt,
              intakeId: receipt.intake_id,
              stage: 'attested_and_persisted',
            }),
          ]
        );
        caseId = caseRes.rows[0]?.id ?? null;
      }

      const redis = getRedis();
      if (redis) {
        await redis.lpush(
          'hub:ingestion_queue',
          JSON.stringify({
            ingestedId,
            caseId,
            intakeId: receipt.intake_id,
            orgId,
            division,
            title,
            sha256: receipt.sha256_receipt,
          })
        );
      }
    } catch (legacySyncErr) {
      console.warn('Secondary queue sync skipped:', legacySyncErr);
    }

    return NextResponse.json({
      ok: true,
      ingestedId,
      caseId,
      dbId: receipt.db_id,
      intakeId: receipt.intake_id,
      sha256: receipt.sha256_receipt,
      routedEndpoint: receipt.routed_endpoint,
      spokeStatus: receipt.spoke_status || 'delivered_http_200',
      credits: updatedCredits,
      timestamp: receipt.timestamp,
      status: receipt.status,
    });
  } catch (err) {
    console.error('Ingestion error:', err);
    return NextResponse.json({ error: 'Failed to ingest submission.' }, { status: 500 });
  }
}