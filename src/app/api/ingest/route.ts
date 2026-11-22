import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, getRedis } from '@/lib/db';

const ALLOWED_DIVISIONS = new Set(['cyber', 'notary', 'training', 'rd_lab', 'toc']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = typeof body.orgId === 'string' ? body.orgId.trim() : '';
    const division = typeof body.division === 'string' ? body.division.trim() : 'toc';
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const payloadText = typeof body.payload === 'string' ? body.payload.trim().slice(0, 10000) : '';
    const sourceChannel = typeof body.sourceChannel === 'string' ? body.sourceChannel.slice(0, 50) : 'web_portal';

    if (!ALLOWED_DIVISIONS.has(division) || !title || !payloadText) {
      return NextResponse.json(
        { error: 'Valid division, title, and payload are required.' },
        { status: 400 }
      );
    }

    const sha256 = crypto.createHash('sha256').update(payloadText).digest('hex');

    const ingestRes = await pool.query(
      `INSERT INTO ingested_items (org_id, source_channel, file_name, sha256_hash, clamav_status, extracted_entities, target_division, processing_status)
       VALUES ($1, $2, $3, $4, 'clean', $5::jsonb, $6, 'queued')
       RETURNING id, created_at`,
      [
        orgId || null,
        sourceChannel,
        title,
        sha256,
        JSON.stringify({ rawInput: payloadText, submittedAt: new Date().toISOString() }),
        division,
      ]
    );

    const ingestedId = ingestRes.rows[0].id;

    let caseId: string | null = null;
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
          JSON.stringify({ sha256, stage: 'queued_for_worker' }),
        ]
      );
      caseId = caseRes.rows[0].id;
    }

    const redis = getRedis();
    if (redis) {
      await redis.lpush(
        'hub:ingestion_queue',
        JSON.stringify({ ingestedId, caseId, orgId, division, title, sha256 })
      );
    }

    return NextResponse.json({
      ok: true,
      ingestedId,
      caseId,
      sha256,
      status: 'queued',
    });
  } catch (err) {
    console.error('Ingestion error:', err);
    return NextResponse.json({ error: 'Failed to ingest submission.' }, { status: 500 });
  }
}