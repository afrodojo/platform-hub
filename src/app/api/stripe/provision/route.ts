import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

const TIER_ALLOWANCES: Record<string, { ron: number; process: number; rd: boolean }> = {
  essentials: { ron: 2, process: 0, rd: false },
  growth: { ron: 5, process: 2, rd: false },
  rd_lab_partner: { ron: 15, process: 5, rd: true },
};

export async function POST(req: NextRequest) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (secretKey && !secretKey.startsWith('sk_test_replace')) {
      return NextResponse.json(
        { error: 'Live Stripe mode is active; use /api/stripe/checkout.' },
        { status: 403 }
      );
    }

    const { orgId, tier } = await req.json();
    if (!orgId || !TIER_ALLOWANCES[tier]) {
      return NextResponse.json({ error: 'Valid orgId and tier are required.' }, { status: 400 });
    }

    const allowance = TIER_ALLOWANCES[tier];
    const sandboxSubId = `sub_sandbox_${orgId.slice(0, 8)}`;
    const sandboxCustId = `cus_sandbox_${orgId.slice(0, 8)}`;

    await pool.query(
      `UPDATE organizations SET stripe_customer_id = COALESCE(NULLIF(stripe_customer_id, ''), $1) WHERE id = $2`,
      [sandboxCustId, orgId]
    );

    await pool.query(
      `INSERT INTO subscriptions (org_id, stripe_subscription_id, tier, status, monthly_ron_credits, remaining_ron_credits, monthly_process_credits, remaining_process_credits, rd_lab_access)
       VALUES ($1, $2, $3, 'active', $4, $4, $5, $5, $6)
       ON CONFLICT (stripe_subscription_id) DO UPDATE
       SET tier = EXCLUDED.tier,
           status = 'active',
           monthly_ron_credits = EXCLUDED.monthly_ron_credits,
           remaining_ron_credits = EXCLUDED.remaining_ron_credits,
           monthly_process_credits = EXCLUDED.monthly_process_credits,
           remaining_process_credits = EXCLUDED.remaining_process_credits,
           rd_lab_access = EXCLUDED.rd_lab_access,
           updated_at = NOW()`,
      [orgId, sandboxSubId, tier, allowance.ron, allowance.process, allowance.rd]
    );

    return NextResponse.json({
      ok: true,
      tier,
      ronMonthly: allowance.ron,
      ronRemaining: allowance.ron,
      processMonthly: allowance.process,
      processRemaining: allowance.process,
      rdLabAccess: allowance.rd,
    });
  } catch (err) {
    console.error('Sandbox tier provisioning error:', err);
    return NextResponse.json({ error: 'Failed to provision tier.' }, { status: 500 });
  }
}