import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { pool } from '@/lib/db';

const TIER_ALLOWANCES: Record<string, { ron: number; process: number; rd: boolean }> = {
  essentials: { ron: 2, process: 0, rd: false },
  growth: { ron: 5, process: 2, rd: false },
  rd_lab_partner: { ron: 15, process: 5, rd: true },
};

export async function POST(req: NextRequest) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook secrets not configured.' }, { status: 503 });
  }

  const stripe = new Stripe(secretKey);
  const sig = req.headers.get('stripe-signature') || '';
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId;
    const tier = session.metadata?.tier || 'essentials';
    const allowance = TIER_ALLOWANCES[tier] || TIER_ALLOWANCES.essentials;

    if (orgId) {
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
        [orgId, String(session.subscription || session.id), tier, allowance.ron, allowance.process, allowance.rd]
      );
    }
  }

  return NextResponse.json({ received: true });
}