'use client';

import React, { useEffect, useState } from 'react';
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
  Database,
  ShieldAlert,
  BadgeCheck,
  Bot,
  Building2,
  PlusCircle,
} from 'lucide-react';

interface CaseItem {
  id: string;
  division: string;
  title: string;
  priority: string;
  status: string;
  created_at: string;
}

interface AuditReceipt {
  id: number | null;
  org_id?: string | null;
  intake_uuid: string;
  client_name: string;
  division: string;
  priority: string;
  sha256_receipt: string;
  routed_endpoint: string;
  spoke_status?: string;
  status: string;
  created_at: string;
}

interface OrgTenant {
  id: string;
  name: string;
  primary_domain: string | null;
  rd_telemetry_opt_in: boolean;
  tier: string;
  monthly_ron_credits: number;
  remaining_ron_credits: number;
  monthly_process_credits: number;
  remaining_process_credits: number;
  rd_lab_access: boolean;
}

interface AgentRun {
  id: number;
  run_uuid: string;
  domain_category?: string;
  agent_name: string;
  agent_role: string;
  input_sha256: string;
  proposed_actions: Array<{ action?: string; target?: string; credit_deducted?: string; reason?: string }>;
  payload_preview?: { title?: string; targetChannel?: string; summary?: string } | null;
  confidence_score: string | number | null;
  approval_status: string;
  execution_status: string;
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

const HITL_DOMAINS = ['all', 'subscriptions', 'seo', 'marketing', 'social', 'infra', 'operations'] as const;

export default function PortalInteractive(props: Props) {
  const [tenants, setTenants] = useState<OrgTenant[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState(props.orgId);
  const [currentOrgName, setCurrentOrgName] = useState(props.orgName);

  const [division, setDivision] = useState<string>('cyber');
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [latestReceipt, setLatestReceipt] = useState<AuditReceipt | null>(null);
  const [receipts, setReceipts] = useState<AuditReceipt[]>([]);

  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [draftDomain, setDraftDomain] = useState<string>('social');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftChannel, setDraftChannel] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [stagingDraft, setStagingDraft] = useState(false);

  const [verifyState, setVerifyState] = useState<Record<string, 'verifying' | 'verified' | 'mismatch'>>({});
  const [cases, setCases] = useState<CaseItem[]>(props.initialCases);
  const [optIn, setOptIn] = useState(props.rdTelemetryOptIn);

  const [activeTier, setActiveTier] = useState(props.tier);
  const [ronRemaining, setRonRemaining] = useState(props.ronRemaining);
  const [ronMonthly, setRonMonthly] = useState(props.ronMonthly);
  const [processRemaining, setProcessRemaining] = useState(props.processRemaining);
  const [processMonthly, setProcessMonthly] = useState(props.processMonthly);
  const [rdLabAccess, setRdLabAccess] = useState(props.rdLabAccess);
  const [billingLoading, setBillingLoading] = useState<string | null>(null);
  const [billingBanner, setBillingBanner] = useState<string | null>(null);

  async function loadTenantData(targetOrgId: string, targetDomain = domainFilter) {
    const recQuery = targetOrgId ? `?orgId=${encodeURIComponent(targetOrgId)}` : '';
    const agParams = new URLSearchParams();
    if (targetOrgId) agParams.set('orgId', targetOrgId);
    if (targetDomain && targetDomain !== 'all') agParams.set('domain', targetDomain);
    const agQuery = agParams.toString() ? `?${agParams.toString()}` : '';

    const [recRes, agRes] = await Promise.all([
      fetch(`/api/receipts${recQuery}`).then((r) => r.json()).catch(() => ({ receipts: [] })),
      fetch(`/api/agents${agQuery}`).then((r) => r.json()).catch(() => ({ runs: [] })),
    ]);
    if (Array.isArray(recRes.receipts)) setReceipts(recRes.receipts);
    if (Array.isArray(agRes.runs)) setAgentRuns(agRes.runs);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/orgs')
      .then((res) => res.json())
      .then((data) => {
        if (!active || !Array.isArray(data.organizations) || data.organizations.length === 0) return;
        setTenants(data.organizations);
        const found = data.organizations.find((o: OrgTenant) => o.id === currentOrgId) || data.organizations[0];
        if (found) {
          setCurrentOrgId(found.id);
          setCurrentOrgName(found.name);
          setActiveTier(found.tier);
          setRonMonthly(found.monthly_ron_credits);
          setRonRemaining(found.remaining_ron_credits);
          setProcessMonthly(found.monthly_process_credits);
          setProcessRemaining(found.remaining_process_credits);
          setRdLabAccess(found.rd_lab_access);
          setOptIn(found.rd_telemetry_opt_in);
          loadTenantData(found.id, domainFilter);
        }
      })
      .catch(() => {
        loadTenantData(currentOrgId, domainFilter);
      });

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'success') {
        const t = params.get('tier') || props.tier;
        setBillingBanner(`Stripe subscription confirmed — ${t.replace(/_/g, ' ').toUpperCase()} tier active.`);
      }
    }

    return () => {
      active = false;
    };
  }, []);

  function handleOrgSwitch(nextOrgId: string) {
    const selected = tenants.find((t) => t.id === nextOrgId);
    if (!selected) return;
    setCurrentOrgId(selected.id);
    setCurrentOrgName(selected.name);
    setActiveTier(selected.tier);
    setRonMonthly(selected.monthly_ron_credits);
    setRonRemaining(selected.remaining_ron_credits);
    setProcessMonthly(selected.monthly_process_credits);
    setProcessRemaining(selected.remaining_process_credits);
    setRdLabAccess(selected.rd_lab_access);
    setOptIn(selected.rd_telemetry_opt_in);
    setLatestReceipt(null);
    setBillingBanner(null);
    loadTenantData(selected.id, domainFilter);
  }

  function handleDomainTab(nextDomain: string) {
    setDomainFilter(nextDomain);
    loadTenantData(currentOrgId, nextDomain);
  }

  async function handleStageDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draftTitle.trim() || !draftBody.trim()) return;
    setStagingDraft(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stage_draft',
          orgId: currentOrgId,
          domainCategory: draftDomain,
          title: draftTitle,
          targetChannel: draftChannel,
          draftBody,
        }),
      });
      const data = await res.json();
      if (res.ok && data.run) {
        setDraftTitle('');
        setDraftChannel('');
        setDraftBody('');
        await loadTenantData(currentOrgId, domainFilter);
      }
    } finally {
      setStagingDraft(false);
    }
  }

  async function handleAgentDecision(runId: number, decision: 'approved' | 'rejected') {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, decision, reviewer: 'Founder (HITL)' }),
    });
    const data = await res.json();
    if (res.ok && data.run) {
      setAgentRuns((prev) =>
        prev.map((item) =>
          item.id === runId
            ? {
                ...item,
                approval_status: data.run.approval_status,
                execution_status: data.run.execution_status,
              }
            : item
        )
      );
    }
  }

  async function handleVerifyReceipt(receipt: AuditReceipt) {
    const key = receipt.intake_uuid;
    setVerifyState((prev) => ({ ...prev, [key]: 'verifying' }));
    try {
      const res = await fetch('/api/receipts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: receipt.id,
          intake_uuid: receipt.intake_uuid,
          sha256: receipt.sha256_receipt,
        }),
      });
      const data = await res.json();
      setVerifyState((prev) => ({
        ...prev,
        [key]: res.ok && data.verified ? 'verified' : 'mismatch',
      }));
    } catch {
      setVerifyState((prev) => ({ ...prev, [key]: 'mismatch' }));
    }
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !payload.trim()) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: currentOrgId,
          orgName: currentOrgName,
          division,
          title,
          payload,
          sourceChannel: 'web_portal',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');

      if (data.credits) {
        setRonRemaining(data.credits.remainingRon);
        setProcessRemaining(data.credits.remainingProcess);
        setTenants((prev) =>
          prev.map((t) =>
            t.id === currentOrgId
              ? {
                  ...t,
                  remaining_ron_credits: data.credits.remainingRon,
                  remaining_process_credits: data.credits.remainingProcess,
                }
              : t
          )
        );
      }

      const newReceipt: AuditReceipt = {
        id: data.dbId ?? null,
        org_id: currentOrgId,
        intake_uuid: data.intakeId || `INT-${Date.now()}`,
        client_name: currentOrgName,
        division,
        priority: division === 'cyber' ? 'high' : 'standard',
        sha256_receipt: data.sha256,
        routed_endpoint: data.routedEndpoint || 'http://hub-web:3000/',
        spoke_status: data.spokeStatus || 'delivered_http_200',
        status: data.status || 'persisted',
        created_at: data.timestamp || new Date().toISOString(),
      };

      setLatestReceipt(newReceipt);
      setReceipts((prev) => [newReceipt, ...prev].slice(0, 20));
      setCases((prev) => [
        {
          id: data.caseId || data.ingestedId || newReceipt.intake_uuid,
          division,
          title,
          priority: division === 'cyber' ? 'high' : 'normal',
          status: 'attested',
          created_at: newReceipt.created_at,
        },
        ...prev,
      ]);
      await loadTenantData(currentOrgId, domainFilter);
      setTitle('');
      setPayload('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Submission error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckout(selectedTier: string) {
    setBillingLoading(selectedTier);
    setBillingBanner(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: selectedTier, orgId: currentOrgId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.sandboxAvailable) {
        const provRes = await fetch('/api/stripe/provision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId: currentOrgId, tier: selectedTier }),
        });
        const provData = await provRes.json();
        if (provRes.ok && provData.ok) {
          setActiveTier(provData.tier);
          setRonMonthly(provData.ronMonthly);
          setRonRemaining(provData.ronRemaining);
          setProcessMonthly(provData.processMonthly);
          setProcessRemaining(provData.processRemaining);
          setRdLabAccess(provData.rdLabAccess);
          setBillingBanner(
            `Provisioned ${selectedTier.replace(/_/g, ' ').toUpperCase()} tier in PostgreSQL (${provData.ronMonthly} RONs, ${provData.processMonthly} Process Serves).`
          );
          return;
        }
      }

      alert(data.error || 'Stripe checkout is not configured yet.');
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
      body: JSON.stringify({ orgId: currentOrgId, optIn: next }),
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Top Status Bar + Multi-Tenant Selector */}
      <header className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/30">
            <Activity className="h-3.5 w-3.5" /> Unified Hub Active • {currentOrgName}
          </span>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            SMB Cyber, Legal & Applied R&D Readiness Portal
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {tenants.length > 0 && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
              <Building2 className="h-4 w-4 text-sky-400" />
              <select
                value={currentOrgId}
                onChange={(e) => handleOrgSwitch(e.target.value)}
                className="bg-transparent font-medium text-white focus:outline-none"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2.5 text-right">
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Active Subscription</p>
            <p className="text-sm font-semibold capitalize text-emerald-400">
              {activeTier.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
      </header>

      {billingBanner && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>{billingBanner}</span>
        </div>
      )}

      {/* Division Telemetry KPI Cards */}
      <section className="grid gap-5 md:grid-cols-3">
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
            Nuclei & Strix Continuous Scans: <strong className="text-rose-400">{props.criticalCount} Critical</strong> •{' '}
            <strong className="text-amber-400">{props.highCount} High</strong>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-400">Notary & Process Server</span>
            <Scale className="h-5 w-5 text-sky-400" />
          </div>
          <div className="mt-4 flex items-baseline gap-4">
            <div>
              <span className="text-3xl font-bold text-white">
                {ronRemaining}/{ronMonthly}
              </span>
              <span className="ml-1.5 text-xs text-slate-400">RON Credits</span>
            </div>
            <div className="border-l border-slate-800 pl-4">
              <span className="text-3xl font-bold text-white">
                {processRemaining}/{processMonthly}
              </span>
              <span className="ml-1.5 text-xs text-slate-400">Process Serves</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Atomic PostgreSQL Credit Deduction on Notary & Process Filings
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-400">Doctoral R&D Lab Consortium</span>
            <FlaskConical className="h-5 w-5 text-violet-400" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-lg font-semibold text-white">
              {rdLabAccess ? 'Lab Partner Unlocked' : 'Standard Telemetry'}
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
              {optIn ? 'IRB Study Opted-In ✓' : 'Opt-In to R&D Study'}
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Anonymized longitudinal benchmarks & early access to Sensei-PhD security models.
          </p>
        </div>
      </section>

      {/* Main Workspace: Smart Multi-Division Intake + Collaborative Queue & Audit Ledger */}
      <section className="grid gap-6 lg:grid-cols-5">
        <form
          onSubmit={handleIngest}
          className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 lg:col-span-2"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">Smart Multi-Division Intake</h2>
          </div>
          <p className="text-xs text-slate-400">
            Attested via C++20 OpenSSL, routed by n8n, logged with agent triage, and persisted in PostgreSQL.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-300">Target Division</label>
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="cyber">Cyber Defense & Attack Surface Monitoring</option>
              <option value="defense">Defense Training Division</option>
              <option value="notary">Notary, Affidavit Vault & Process Server</option>
              <option value="training">Cyber Dojo Workforce Training & Phishing</option>
              <option value="toc">TOC Enterprise Security Core</option>
              <option value="hive">Hive Alignment Coordination</option>
              <option value="unity">Morman Empowered Unity</option>
              <option value="rd_lab">Doctoral R&D Lab Pilot (Sensei-PhD)</option>
              <option value="corporate">Emerging Defense Solutions Corporate</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Request / Asset Title</label>
            <input
              type="text"
              required
              placeholder="e.g., Notarize Affidavit or Serve Subpoena #402"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300">Details, Target URL, or Document Notes</label>
            <textarea
              rows={4}
              required
              placeholder="Enter domain URLs, recipient jurisdiction, or incident details. Payload is SHA-256 attested via C++20 OpenSSL."
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
            {submitting ? 'Attesting & Dispatching...' : 'Ingest, Attest & Route Workflow'}
          </button>

          {errorMsg && (
            <p className="rounded-lg border border-rose-800 bg-rose-950/60 p-2.5 text-xs text-rose-300">
              {errorMsg}
            </p>
          )}

          {latestReceipt && (
            <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-xs">
              <div className="flex items-center justify-between text-emerald-300">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Postgres Row #{latestReceipt.id ?? 'Saved'}
                </span>
                <span className="font-mono text-[11px]">{latestReceipt.intake_uuid}</span>
              </div>
              <p className="font-mono text-[11px] text-slate-300">
                Spoke: {latestReceipt.routed_endpoint} ({latestReceipt.spoke_status || 'delivered'})
              </p>
              <p className="break-all font-mono text-[11px] text-emerald-400">
                SHA-256: {latestReceipt.sha256_receipt}
              </p>
              <button
                type="button"
                onClick={() => handleVerifyReceipt(latestReceipt)}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
              >
                <BadgeCheck className="h-3.5 w-3.5" />
                {verifyState[latestReceipt.intake_uuid] === 'verifying'
                  ? 'Verifying via C++20...'
                  : verifyState[latestReceipt.intake_uuid] === 'verified'
                  ? 'C++20 CRYPTO_memcmp Verified ✓'
                  : verifyState[latestReceipt.intake_uuid] === 'mismatch'
                  ? 'Digest Mismatch ✗'
                  : 'Verify Digest via C++20'}
              </button>
            </div>
          )}
        </form>

        <div className="space-y-6 lg:col-span-3">
          {/* Cross-Division Collaborative Feed */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-sky-400" />
                <h2 className="text-lg font-semibold text-white">Cross-Division Collaborative Queue</h2>
              </div>
              <span className="text-xs text-slate-400">{cases.length} active items</span>
            </div>

            <div className="mt-4 space-y-3">
              {cases.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
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

          {/* Persisted Postgres Cryptographic Audit Ledger */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-emerald-400" />
                <h2 className="text-lg font-semibold text-white">PostgreSQL Cryptographic Audit Ledger</h2>
              </div>
              <span className="text-xs text-slate-400">{receipts.length} tenant receipts</span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2 pr-3">ID</th>
                    <th className="pb-2 pr-3">Intake UUID</th>
                    <th className="pb-2 pr-3">Division</th>
                    <th className="pb-2 pr-3">C++20 SHA-256</th>
                    <th className="pb-2 pr-3">Spoke</th>
                    <th className="pb-2 text-right">Attestation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono text-slate-300">
                  {receipts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center font-sans text-slate-500">
                        No persisted receipts for this organization yet.
                      </td>
                    </tr>
                  ) : (
                    receipts.map((r, idx) => {
                      const vState = verifyState[r.intake_uuid];
                      return (
                        <tr key={r.intake_uuid || idx}>
                          <td className="py-2.5 pr-3 text-slate-400">#{r.id ?? '-'}</td>
                          <td className="py-2.5 pr-3 text-white">{r.intake_uuid}</td>
                          <td className="py-2.5 pr-3 uppercase text-sky-400">{r.division}</td>
                          <td className="py-2.5 pr-3 text-emerald-400" title={r.sha256_receipt}>
                            {r.sha256_receipt ? `${r.sha256_receipt.slice(0, 14)}...` : 'N/A'}
                          </td>
                          <td className="py-2.5 pr-3 text-[11px] text-slate-400">
                            {r.spoke_status || 'routed'}
                          </td>
                          <td className="py-2.5 text-right font-sans">
                            {vState === 'verified' ? (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                                <BadgeCheck className="h-3.5 w-3.5" /> Verified
                              </span>
                            ) : vState === 'mismatch' ? (
                              <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-300">
                                <ShieldAlert className="h-3.5 w-3.5" /> Mismatch
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={vState === 'verifying'}
                                onClick={() => handleVerifyReceipt(r)}
                                className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
                              >
                                {vState === 'verifying' ? 'Checking...' : 'Verify SHA-256'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise HITL Command Center: Stage Drafts & Approve/Reject Across Domains */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Enterprise HITL Command & Draft Gate</h2>
              <p className="text-xs text-slate-400">
                Stage and review proposed agent actions across subscriptions, SEO, marketing, social, and infrastructure.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {HITL_DOMAINS.map((dom) => (
              <button
                key={dom}
                type="button"
                onClick={() => handleDomainTab(dom)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                  domainFilter === dom
                    ? 'bg-violet-500/25 text-violet-200 ring-1 ring-violet-500/50'
                    : 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {dom}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Stage HITL Draft Form */}
          <form
            onSubmit={handleStageDraft}
            className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 lg:col-span-2"
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-violet-300">
              <PlusCircle className="h-4 w-4" /> Stage Proposed Agent Action
            </div>

            <div>
              <label className="block text-[11px] text-slate-400">Domain Category</label>
              <select
                value={draftDomain}
                onChange={(e) => setDraftDomain(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-violet-500 focus:outline-none"
              >
                <option value="subscriptions">Subscriptions & Credits</option>
                <option value="seo">SEO & Search Metadata</option>
                <option value="marketing">Marketing & Funnels</option>
                <option value="social">Social Media Queue</option>
                <option value="infra">Infrastructure & Scaling</option>
                <option value="operations">Operations & Chief of Staff</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400">Action Title</label>
              <input
                type="text"
                required
                placeholder="e.g., Publish CMMC L2 LinkedIn Brief or Scale Worker"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400">Target Channel / Service (Optional)</label>
              <input
                type="text"
                placeholder="e.g., LinkedIn / X / /cyber / n8n-worker"
                value={draftChannel}
                onChange={(e) => setDraftChannel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400">Draft Payload / Rationale</label>
              <textarea
                rows={3}
                required
                placeholder="Enter post copy, SEO tags, campaign summary, or scaling justification..."
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={stagingDraft}
              className="w-full rounded-lg bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-200 ring-1 ring-violet-500/40 transition hover:bg-violet-500/30 disabled:opacity-50"
            >
              {stagingDraft ? 'Staging Draft...' : 'Stage for HITL Approval'}
            </button>
          </form>

          {/* Pending & Audited Runs List */}
          <div className="space-y-3 lg:col-span-3">
            {agentRuns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
                No agent runs or staged drafts in this domain yet.
              </div>
            ) : (
              agentRuns.slice(0, 8).map((run) => (
                <div
                  key={run.id}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800/90 bg-slate-950/70 p-3.5 text-xs sm:flex-row sm:items-center"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-300">
                        {run.domain_category || 'operations'}
                      </span>
                      <span className="font-semibold text-white">{run.agent_name}</span>
                      <span className="text-[11px] text-slate-400">({run.agent_role})</span>
                    </div>
                    {run.payload_preview?.title && (
                      <p className="font-medium text-slate-200">{run.payload_preview.title}</p>
                    )}
                    {run.payload_preview?.summary && (
                      <p className="line-clamp-2 text-[11px] text-slate-400">{run.payload_preview.summary}</p>
                    )}
                    <p className="font-mono text-[10px] text-slate-500">
                      {Array.isArray(run.proposed_actions) && run.proposed_actions[0]?.action
                        ? `Action: ${run.proposed_actions[0].action} • Target: ${run.proposed_actions[0].target || 'internal'}`
                        : `Run #${run.id} • ${run.execution_status}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {run.approval_status === 'pending_approval' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleAgentDecision(run.id, 'approved')}
                          className="rounded-md bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAgentDecision(run.id, 'rejected')}
                          className="rounded-md bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-500/40 hover:bg-rose-500/30"
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${
                          run.approval_status === 'rejected'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-emerald-500/15 text-emerald-300'
                        }`}
                      >
                        {run.approval_status.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
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
          ].map((plan) => {
            const isCurrent = activeTier === plan.id;
            return (
              <div
                key={plan.id}
                className={`flex flex-col justify-between rounded-2xl border p-6 ${
                  isCurrent
                    ? 'border-emerald-500/60 bg-emerald-950/20'
                    : 'border-slate-800 bg-slate-900/60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">{plan.subtitle}</p>
                    {isCurrent && (
                      <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                        Current Plan
                      </span>
                    )}
                  </div>
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
                  disabled={billingLoading === plan.id || isCurrent}
                  onClick={() => handleCheckout(plan.id)}
                  className="mt-6 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500 hover:text-slate-950 disabled:opacity-50"
                >
                  {isCurrent
                    ? 'Active Subscription'
                    : billingLoading === plan.id
                    ? 'Provisioning...'
                    : `Subscribe to ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}