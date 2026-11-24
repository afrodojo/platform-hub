import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { pool } from '@/lib/db';
import { isLiveStripeConfigured } from '@/lib/stripeConfig';

const TIERS: Record<string, { name: string; unitAmount: number; description: string }> = {
  essentials: {
    name: 'Essentials — Monitor & Seal',
    unitAmount: 19900,
    description: 'Monthly Nuclei external scan, staff cyber micro-training, and 2 Remote Online Notarizations/mo.',
  },
  growth: {
    name: 'Growth — Active Defense & Ops',
    unitAmount: 59900,
    description: 'Weekly Nuclei + Strix AI pen-testing, phishing sims, 5 RONs/mo, priority process serving & evidence vault.',
  },
  rd_lab_partner: {
    name: 'R&D Lab Partner — Enterprise Shield',
    unitAmount: 195000,
    description: 'PyRIT AI red-teaming, priority legal dispatch SLA, and Doctoral R&D Lab Consortium membership.',
  },
};

export async function POST(req: NextRequest) {
  try {
    const { tier, orgId } = await req.json();
    const selected = TIERS[tier];

    if (!selected) {
      return NextResponse.json({ error: 'Invalid subscription tier.' }, { status: 400 });
    }

    if (!isLiveStripeConfigured()) {
      return NextResponse.json({
        sandboxAvailable: true,
        tier,
        message: 'Placeholder STRIPE_SECRET_KEY detected; sandbox provisioning active.',
      });
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    let existingCustomerId: string | undefined;
    if (orgId) {
      const orgRes = await pool.query(
        `SELECT stripe_customer_id FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId]
      );
      if (orgRes.rows[0]?.stripe_customer_id) {
        existingCustomerId = orgRes.rows[0].stripe_customer_id;
      }
    }

    const forwardedHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost';
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
    const origin = req.headers.get('origin') || `${forwardedProto}://${forwardedHost}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      ...(existingCustomerId ? { customer: existingCustomerId } : {}),
      client_reference_id: orgId || undefined,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            recurring: { interval: 'month' },
            unit_amount: selected.unitAmount,
            product_data: {
              name: selected.name,
              description: selected.description,
            },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: { orgId: orgId || '', tier },
      },
      metadata: { orgId: orgId || '', tier },
      success_url: `${origin}/?checkout=success&tier=${tier}`,
      cancel_url: `${origin}/?checkout=cancelled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return NextResponse.json({ error: 'Unable to create checkout session.' }, { status: 500 });
  }
}