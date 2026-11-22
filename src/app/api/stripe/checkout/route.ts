import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const TIERS: Record<string, { name: string; unitAmount: number; description: string }> = {
  essentials: {
    name: 'Essentials ? Monitor & Seal',
    unitAmount: 19900,
    description: 'Monthly Nuclei external scan, staff cyber micro-training, and 2 Remote Online Notarizations/mo.',
  },
  growth: {
    name: 'Growth ? Active Defense & Ops',
    unitAmount: 59900,
    description: 'Weekly Nuclei + Strix AI pen-testing, phishing sims, 5 RONs/mo, priority process serving & evidence vault.',
  },
  rd_lab_partner: {
    name: 'R&D Lab Partner ? Enterprise Shield',
    unitAmount: 195000,
    description: 'PyRIT AI red-teaming, priority legal dispatch SLA, and Doctoral R&D Lab Consortium membership.',
  },
};

export async function POST(req: NextRequest) {
  try {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey || secretKey.startsWith('sk_test_replace')) {
      return NextResponse.json(
        { error: 'Configure STRIPE_SECRET_KEY in .env to enable live checkout.' },
        { status: 503 }
      );
    }

    const stripe = new Stripe(secretKey);
    const { tier, orgId } = await req.json();
    const selected = TIERS[tier];

    if (!selected) {
      return NextResponse.json({ error: 'Invalid subscription tier.' }, { status: 400 });
    }

    const origin = req.headers.get('origin') || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
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