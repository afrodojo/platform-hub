"use client";

import React, { useState } from "react";

interface IntakeReceipt {
  status: string;
  db_id: number | null;
  intake_id: string;
  division: string;
  routed_endpoint: string;
  sha256_receipt: string;
  timestamp: string;
}

const DIVISIONS = [
  { id: "cyber", label: "Cybersecurity & CMMC Readiness" },
  { id: "defense", label: "Defense Training Division" },
  { id: "training", label: "Cyber Dojo Sensei" },
  { id: "notary", label: "Notary & Process Server Division" },
  { id: "toc", label: "TOC Enterprise Security Core" },
  { id: "hive", label: "Hive Alignment" },
  { id: "unity", label: "Morman Empowered Unity" },
  { id: "rd", label: "Applied R&D Lab (Sensei PhD)" },
  { id: "corporate", label: "Emerging Defense Solutions Corporate" },
];

export default function SmbIntakePortal() {
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [division, setDivision] = useState("cyber");
  const [priority, setPriority] = useState("standard");
  const [scope, setScope] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<IntakeReceipt | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/workflows/webhook/smb-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientName,
          client_email: clientEmail,
          division,
          priority,
          scope,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Intake gateway returned HTTP ${response.status}: ${text}`);
      }

      const data: IntakeReceipt = await response.json();
      setReceipt(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit intake request");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-800 bg-slate-950 p-6 text-slate-100 shadow-lg">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Unified SMB Division Intake</h2>
        <p className="text-sm text-slate-400">
          Submissions are routed via n8n, attested by the C++20 OpenSSL engine, and logged to PostgreSQL.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-400">
              Organization / Client Name
            </label>
            <input
              type="text"
              required
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Acme Defense LLC"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-400">
              Contact Email
            </label>
            <input
              type="email"
              required
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="ops@acmedefense.example"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-400">
              Target Division
            </label>
            <select
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              {DIVISIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-slate-400">
              Priority Tier
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            >
              <option value="standard">Standard</option>
              <option value="high">High Priority</option>
              <option value="critical">Critical / Immediate</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-slate-400">
            Engagement Scope & Requirements
          </label>
          <textarea
            rows={3}
            required
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="Describe compliance scope, training cohort size, or legal/notary request..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {submitting ? "Attesting & Dispatching..." : "Submit & Generate Crypto Receipt"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {receipt && (
        <div className="space-y-2 rounded-lg border border-emerald-800/80 bg-emerald-950/30 p-4 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-emerald-400">
              Attested & Persisted Audit Receipt
            </span>
            <span className="rounded bg-emerald-900/80 px-2 py-0.5 font-mono text-emerald-200">
              DB Row #{receipt.db_id ?? "N/A"}
            </span>
          </div>
          <div className="grid gap-1 font-mono text-slate-300">
            <div>Intake ID: {receipt.intake_id}</div>
            <div>Division: {receipt.division} ({receipt.routed_endpoint})</div>
            <div>Timestamp: {receipt.timestamp}</div>
            <div className="break-all text-emerald-300">SHA-256: {receipt.sha256_receipt}</div>
          </div>
        </div>
      )}
    </div>
  );
}
