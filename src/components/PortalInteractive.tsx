'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Scale,
  FlaskConical,
  Send,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  FileCheck2,
  Activity,
} from 'lucide-react';

interface CaseItem {
  id: string;
  division: string;
  title: string;
  priority: string;
  status: string;
  created_at: string;
}

interface Props {
  orgId: string;
  orgName: string;
  tier: string;
  ronRemaining: number;
  ronMonthly: number;
  processRemaining: number;
  processMonthly: number;
  rdLabAccess: boolean;
  rdTelemetryOptIn: boolean;
  riskScore: number;
  criticalCount: number;
  highCount: number;
  initialCases: CaseItem[];
}

export default function PortalInteractive(props: Props) {
  const [division, setDivision] = useState<'cyber' | 'notary' | 'training' | 'rd_lab'>('cyber');
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseItem[]>(props.initialCases);
  const [optIn, setOptIn] = useState(props.rdTelemetryOptIn);
  const [billingLoading, setBillingLoading] = useState<string | null>(null);

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !payload.trim()) return;
    setSubmitting(true);
    setIngestFeedback(null);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: props.orgId,
          division,
          title,
          payload,
          sourceChannel: 'web_portal',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      setIngestFeedback(`Queued (${data.sha256.slice(0, 12)}?) and routed to ${division.toUpperCase()} division.`);
      setCases((prev) => [
        {
          id: data.caseId || data.ingestedId,
          division,
          title,
          priority: division === 'cyber' ? 'high' : 'normal',
          status: 'open',
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setTitle('');
      setPayload('');
    } catch (err: unknown) {
      setIngestFeedback(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckout(selectedTier: string) {
    setBillingLoading(selectedTier);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier, orgId: props.orgId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Stripe checkout is not configured yet.');
      }
    } finally {
      setBillingLoading(null);
    }
  }

  async function toggleRdTelemetry() {
    const next = !optIn;
    setOptIn(next);
    await fetch('/api/rd-optin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: props.orgId, optIn: next }),
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Top Status Bar */}
      <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            <Activity className="h-3.5 w-3.5" /> Unified Hub Active ? {props.orgName}
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            SMB Cyber, Legal & Applied R&D Readiness Portal
          </h1>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-wider text-slate-400">Active Subscription</p>
          <p className="text-lg font-semibold capitalize text-emerald-400">
            {props.tier.replace(/_/g, ' ')}
          </p>
        </div>
      </header>

      {/* Division Telemetry KPI Cards */}
      <section className="grid gap-5 md:grid-cols-3">
        {/* Card 1: Cyber Defense & Training */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-400">Cyber & Training Division</span>
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-4xl font-bold text-white">{props.riskScore}</span>
            <span className="text-sm text-slate-400">/ 100 Readiness Score</span>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Nuclei & Strix Continuous Scans: <strong className="text-rose-400">{props.criticalCount} Critical</strong> ?{' '}
            <strong className="text-amber-400">{props.highCount} High</strong>
          </p>
        </div>

        {/* Card 2: Notary & Process Server */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-400">Notary & Process Server</span>
            <Scale className="h-5 w-5 text-sky-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-4">
            <div>
              <span className="text-3xl font-bold text-white">
                {props.ronRemaining}/{props.ronMonthly}
              </span>
              <span className="ml-1.5 text-xs text-slate-400">RON Credits</span>
            </div>
            <div className="border-l border-slate-800 pl-4">
              <span className="text-3xl font-bold text-white">
                {props.processRemaining}/{props.processMonthly}
              </span>
              <span className="ml-1.5 text-xs text-slate-400">Process Serves</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            SHA-256 Tamper-Evident Evidence Vault & Priority Dispatch Ready
          </p>
        </div>

        {/* Card 3: Doctoral R&D Lab */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-400">Doctoral R&D Lab Consortium</span>
            <FlaskConical className="h-5 w-5 text-violet-400" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-lg font-semibold text-white">
              {props.rdLabAccess ? 'Lab Partner Unlocked' : 'Standard Telemetry'}
            </span>
            <button
              type="button"
              onClick={toggleRdTelemetry}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                optIn
                  ? 'bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {optIn ? 'IRB Study Opted-In ?' : 'Opt-In to R&D Study'}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Anonymized longitudinal benchmarks & early access to Sensei-PhD security models.
          </p>
        </div>
      </section>

      {/* Main Workspace: Smart Multi-Division Intake + Collaborative Case Stream */}
      <section className="grid gap-6 lg:grid-cols-5">
        {/* Smart Intake Form */}
        <form
          onSubmit={handleIngest}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Smart Multi-Division Intake</h2>
          </div>
          <p className="text-xs text-slate-400">
            Submit a domain for continuous monitoring, a legal filing for notarization/service, a staff training request, or an R&D pilot payload.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-300">Target Division</label>
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value as 'cyber' | 'notary' | 'training' | 'rd_lab')}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="cyber">Cyber Defense & Attack Surface Monitoring</option>
              <option value="notary">Notary, Affidavit Vault & Process Server</option>
              <option value="training">Cyber Dojo Workforce Training & Phishing</option>
              <option value="rd_lab">Doctoral R&D Lab Pilot / Custom Experiment</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Request / Asset Title</label>
            <input
              type="text"
              required
              placeholder="e.g., Scan portal.company.com or Serve Subpoena #402"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Details, Target URL, or Document Hash/Notes</label>
            <textarea
              rows={4}
              required
              placeholder="Enter domain URLs, recipient jurisdiction, or incident details. Payload is SHA-256 hashed on arrival."
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Hashing & Queuing?' : 'Ingest & Route Workflow'}
          </button>

          {ingestFeedback && (
            <p className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {ingestFeedback}
            </p>
          )}
        </form>

        {/* Cross-Division Collaborative Feed */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-sky-400" />
              <h2 className="text-lg font-semibold text-white">Cross-Division Collaborative Queue</h2>
            </div>
            <span className="text-xs text-slate-400">{cases.length} active items</span>
          </div>

          <div className="mt-4 space-y-3">
            {cases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-400">
                No active cases yet. Submit an asset or document on the left to trigger automated cross-division workflows.
              </div>
            ) : (
              cases.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/70 p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-300">
                        {item.division.replace('_', ' ')}
                      </span>
                      {item.priority === 'high' || item.priority === 'critical' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" /> {item.priority}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 font-medium text-white">{item.title}</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium capitalize text-emerald-400">
                    {item.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Monthly SMB Subscription & R&D Consortium Plans */}
      <section className="space-y-4 pt-4">
        <h2 className="text-xl font-bold text-white">Continuous Protection & R&D Lab Subscriptions</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              id: 'essentials',
              name: 'Essentials',
              subtitle: 'Monitor & Seal',
              price: '$199',
              features: [
                'Monthly Nuclei external vulnerability scan',
                'Monthly employee cyber micro-training',
                '2 Remote Online Notarizations (RON) / mo',
                'Automated compliance deadline alerts',
              ],
            },
            {
              id: 'growth',
              name: 'Growth',
              subtitle: 'Active Defense & Ops',
              price: '$599',
              features: [
                'Weekly Nuclei + Strix AI pen-testing',
                'Quarterly phishing simulations',
                '5 RONs + 2 Priority Process Serves / mo',
                'SHA-256 Notarized Digital Evidence Vault',
              ],
            },
            {
              id: 'rd_lab_partner',
              name: 'R&D Lab Partner',
              subtitle: 'Enterprise Shield + Doctoral Lab',
              price: '$1,950',
              features: [
                'PyRIT AI chatbot red-teaming & SLA response',
                '15 RONs + 5 Priority Process Serves / mo',
                'Doctoral R&D Lab Consortium membership',
                'Early beta access to Sensei-PhD defense tools',
              ],
            },
          ].map((plan) => (
            <div
              key={plan.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">{plan.subtitle}</p>
                <h3 className="mt-1 text-xl font-bold text-white">{plan.name}</h3>
                <p className="mt-3 text-3xl font-extrabold text-white">
                  {plan.price}
                  <span className="text-sm font-normal text-slate-400"> / mo</span>
                </p>
                <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                disabled={billingLoading === plan.id}
                onClick={() => handleCheckout(plan.id)}
                className="mt-6 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950 disabled:opacity-50"
              >
                {billingLoading === plan.id ? 'Redirecting to Stripe?' : `Subscribe to ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}