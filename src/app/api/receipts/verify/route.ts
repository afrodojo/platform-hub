import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id = typeof body.id === 'number' ? body.id : null;
    const intakeUuid = typeof body.intake_uuid === 'string' ? body.intake_uuid.trim() : '';

    let rawPayload = typeof body.payload === 'string' ? body.payload : '';
    let expectedSha = typeof body.sha256 === 'string' ? body.sha256.trim() : '';

    if (id !== null || intakeUuid) {
      const lookup = id !== null
        ? await pool.query(
            `SELECT id, intake_uuid, raw_payload, payload::text AS payload_text, sha256_receipt
             FROM platform_intake_submissions WHERE id = $1 LIMIT 1`,
            [id]
          )
        : await pool.query(
            `SELECT id, intake_uuid, raw_payload, payload::text AS payload_text, sha256_receipt
             FROM platform_intake_submissions WHERE intake_uuid = $1 LIMIT 1`,
            [intakeUuid]
          );

      if (lookup.rows.length === 0) {
        return NextResponse.json({ error: 'Receipt not found in audit ledger.' }, { status: 404 });
      }
      const row = lookup.rows[0];
      rawPayload = row.raw_payload ?? row.payload_text ?? '';
      expectedSha = row.sha256_receipt ?? '';
    }

    if (!expectedSha) {
      return NextResponse.json({ error: 'No SHA-256 digest available for verification.' }, { status: 400 });
    }

    // Call C++20 OpenSSL constant-time CRYPTO_memcmp verifier
    try {
      const cppRes = await fetch('http://core-cpp:8080/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: rawPayload, sha256: expectedSha }),
        signal: AbortSignal.timeout(3500),
      });
      if (cppRes.ok) {
        const cppData = await cppRes.json();
        return NextResponse.json({
          verified: Boolean(cppData.verified),
          engine: 'core-crypto-engine (C++20/OpenSSL)',
          computed_sha256: cppData.computed_sha256,
          expected_sha256: cppData.expected_sha256,
        });
      }
    } catch {
      // Fallback to Node timingSafeEqual if core-cpp is temporarily restarting
    }

    const computed = crypto.createHash('sha256').update(rawPayload).digest('hex');
    const a = Buffer.from(computed, 'utf8');
    const b = Buffer.from(expectedSha, 'utf8');
    const verified = a.length === b.length && crypto.timingSafeEqual(a, b);

    return NextResponse.json({
      verified,
      engine: 'node-crypto-fallback',
      computed_sha256: computed,
      expected_sha256: expectedSha,
    });
  } catch (err) {
    console.error('Receipt verification error:', err);
    return NextResponse.json({ error: 'Failed to verify receipt.' }, { status: 500 });
  }
}