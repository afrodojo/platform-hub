CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    primary_domain TEXT,
    stripe_customer_id TEXT UNIQUE,
    rd_telemetry_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    irb_consent_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('essentials', 'growth', 'rd_lab_partner')),
    status TEXT NOT NULL DEFAULT 'active',
    monthly_ron_credits INT NOT NULL DEFAULT 2,
    remaining_ron_credits INT NOT NULL DEFAULT 2,
    monthly_process_credits INT NOT NULL DEFAULT 0,
    remaining_process_credits INT NOT NULL DEFAULT 0,
    rd_lab_access BOOLEAN NOT NULL DEFAULT FALSE,
    current_period_end TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingested_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    source_channel TEXT NOT NULL,
    file_name TEXT,
    sha256_hash TEXT,
    clamav_status TEXT NOT NULL DEFAULT 'pending' CHECK (clamav_status IN ('pending', 'clean', 'quarantined')),
    extracted_entities JSONB NOT NULL DEFAULT '{}'::jsonb,
    target_division TEXT NOT NULL CHECK (target_division IN ('cyber', 'notary', 'training', 'rd_lab', 'toc')),
    processing_status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS division_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    ingestion_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL,
    division TEXT NOT NULL CHECK (division IN ('cyber', 'notary', 'training', 'rd_lab')),
    title TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'open',
    assigned_staff_email TEXT,
    workflow_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notarized_evidence_vault (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    case_id UUID REFERENCES division_cases(id) ON DELETE SET NULL,
    artifact_type TEXT NOT NULL,
    sha256_digest TEXT NOT NULL,
    notary_commission_id TEXT,
    jurisdiction TEXT,
    notarized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cyber_monitoring_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    target_asset TEXT NOT NULL,
    scanner_tool TEXT NOT NULL,
    risk_score INT CHECK (risk_score BETWEEN 0 AND 100),
    critical_count INT NOT NULL DEFAULT 0,
    high_count INT NOT NULL DEFAULT 0,
    report_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rd_lab_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_hash TEXT NOT NULL,
    experiment_domain TEXT NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingested_org_status ON ingested_items(org_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_cases_org_division ON division_cases(org_id, division, status);
CREATE INDEX IF NOT EXISTS idx_cyber_runs_org ON cyber_monitoring_runs(org_id, executed_at DESC);