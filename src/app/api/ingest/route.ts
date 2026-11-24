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

    const priority = division === 'cyber' ? 'high' : 'standard';
    const n8nDivision = division === 'rd_lab' ? 'rd' : division;
    const outboundPayload = {
      client_name: orgName || 'SMB Portal Client',
      client_email: 'portal@localhost',
      division: n8nDivision,
      priority,
      title,
      scope: payloadText,
      org_id: orgId || null,
    };

    let receipt: {
      status: string;
      db_id: number | null;
      intake_id: string;
      division: string;
      routed_endpoint: string;
      sha256_receipt: string;
      timestamp: string;
    } | null = null;

    // Primary path: Dispatch through internal n8n webhook -> C++20 core-cpp -> Postgres
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

    // Fallback path: Direct C++20 OpenSSL attestation + Postgres persistence
    if (!receipt) {
      const rawJson = JSON.stringify(outboundPayload);
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
        // Fallback to local SHA-256 if core-cpp is restarting
      }
      if (!sha256) {
        sha256 = crypto.createHash('sha256').update(rawJson).digest('hex');
      }

      const intakeUuid = `INT-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const routedEndpoint = ROUTE_MAP[division] || 'http://hub-web:3000/';

      const dbInsert = await pool.query(
        `INSERT INTO platform_intake_submissions (intake_uuid, client_name, client_email, division, priority, payload, sha256_receipt, routed_endpoint, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'persisted')
         RETURNING id, created_at`,
        [
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
        sha256_receipt: sha256,
        timestamp: dbInsert.rows[0]?.created_at ?? new Date().toISOString(),
      };
    }

    // Preserve existing ingested_items, division_cases, and Redis queue sync
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
            division === 'cyber' ? 'high' : 'normal',
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
      timestamp: receipt.timestamp,
      status: receipt.status,
    });
  } catch (err) {
    console.error('Ingestion error:', err);
    return NextResponse.json({ error: 'Failed to ingest submission.' }, { status: 500 });
  }
}