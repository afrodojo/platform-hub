import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { pool } from '@/lib/db';

const TIER_ALLOWANCES: Record<string, { ron: number; process: number; rd: boolean }> = {
  essentials: { ron: 2, process: 0, rd: false },
  growth: { ron: 5, process: 2, rd: false },
  rd_lab_partner: { ron: 15, process: 5, rd: true },
};

async function provisionTier(
  orgId: string,
  subscriptionId: string,
  tier: string,
  status: string,
  customerId?: string | null
) {
  const allowance = TIER_ALLOWANCES[tier] || TIER_ALLOWANCES.essentials;

  if (customerId) {
    await pool.query(
      `UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2 AND (stripe_customer_id IS NULL OR stripe_customer_id = '')`,
      [customerId, orgId]
    );
  }

  await pool.query(
    `INSERT INTO subscriptions (org_id, stripe_subscription_id, tier, status, monthly_ron_credits, remaining_ron_credits, monthly_process_credits, remaining_process_credits, rd_lab_access)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7)
     ON CONFLICT (stripe_subscription_id) DO UPDATE
     SET tier = EXCLUDED.tier,
         status = EXCLUDED.status,
         monthly_ron_credits = EXCLUDED.monthly_ron_credits,
         remaining_ron_credits = EXCLUDED.remaining_ron_credits,
         monthly_process_credits = EXCLUDED.monthly_process_credits,
         remaining_process_credits = EXCLUDED.remaining_process_credits,
         rd_lab_access = EXCLUDED.rd_lab_access,
         updated_at = NOW()`,
    [orgId, subscriptionId, tier, status, allowance.ron, allowance.process, allowance.rd]
  );
}

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
  } catch {
    return NextResponse.json({ error: 'Invalid webhook signature.' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const orgId = session.metadata?.orgId || session.client_reference_id || '';
    const tier = session.metadata?.tier || 'essentials';
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subId = String(session.subscription || session.id);

    if (orgId) {
      await provisionTier(orgId, subId, tier, 'active', customerId);
    }
  } else if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const tier = sub.metadata?.tier || 'essentials';
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

    let orgId = sub.metadata?.orgId || '';
    if (!orgId && customerId) {
      const orgLookup = await pool.query(
        `SELECT id FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
        [customerId]
      );
      orgId = orgLookup.rows[0]?.id || '';
    }

    if (orgId) {
      await provisionTier(orgId, sub.id, tier, status, customerId);
    }
  }

  return NextResponse.json({ received: true });
}