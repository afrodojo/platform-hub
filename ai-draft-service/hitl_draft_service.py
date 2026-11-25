import hashlib
import json
import os
import urllib.request
from datetime import datetime, timezone
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

try:
    import psycopg2
except ImportError:
    psycopg2 = None

app = FastAPI(title="EDS-360 HITL Draft, RBAC & Attestation Service")

LLM_BASE_URL = os.getenv("LOCAL_LLM_URL", "http://host.docker.internal:4000/v1/chat/completions")
LLM_MODEL = os.getenv("LOCAL_LLM_MODEL", "local-sovereign-model")
PG_HOST = os.getenv("PG_HOST", "postgres")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_DB = os.getenv("PG_DB", "postgres")
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "postgres")

ROLE_PERMISSIONS = {
    "executive_sponsor": {
        "scopes": {"*"},
        "keys": {"*"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": True,
        "can_dispatch": True,
        "can_read_audit": True,
    },
    "cyber_soc_lead": {
        "scopes": {"it"},
        "keys": {"devsecops", "compliance_analysts", "cyber_soc"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": True,
        "can_dispatch": True,
        "can_read_audit": True,
    },
    "soc_analyst": {
        "scopes": {"it"},
        "keys": {"devsecops", "compliance_analysts", "cyber_soc"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": False,
        "can_dispatch": False,
        "can_read_audit": False,
    },
    "noc_lead": {
        "scopes": {"it"},
        "keys": {"devops", "networking", "it_engineers", "noc"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": False,
        "can_dispatch": False,
        "can_read_audit": False,
    },
    "noc_engineer": {
        "scopes": {"it"},
        "keys": {"devops", "networking", "noc"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": False,
        "can_dispatch": False,
        "can_read_audit": False,
    },
    "devops_lead": {
        "scopes": {"it"},
        "keys": {"devops", "networking", "it_engineers", "developers", "change_mgmt"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": False,
        "can_dispatch": False,
        "can_read_audit": False,
    },
    "department_lead": {
        "scopes": {"department"},
        "keys": {"finance", "pmo", "hr", "legal", "marketing", "physical_security"},
        "can_ingest": True,
        "can_intelligence": True,
        "can_approve": True,
        "can_dispatch": False,
        "can_read_audit": False,
    },
    "auditor_readonly": {
        "scopes": {"it", "department"},
        "keys": {"compliance_analysts", "cyber_soc", "noc", "legal", "finance", "pmo"},
        "can_ingest": False,
        "can_intelligence": False,
        "can_approve": False,
        "can_dispatch": False,
        "can_read_audit": True,
    },
}

OPERATIONAL_CAPABILITIES = {
    "cyber_soc": {
        "name": "Cybersecurity Operations & SOC",
        "scope": "it",
        "primary_keys": ["devsecops", "compliance_analysts"],
        "capabilities": [
            "24/7/365 SIEM / Wazuh alert ingestion & triage",
            "UEBA & File Integrity Monitoring (FIM) anomaly correlation",
            "HITL draft generation, operator approval & SHA-256 attestation",
            "CMMC L2 & CDM evidence alignment (SI.L2-3.14.1, AU.L2-3.3.1, IR.L2-3.6.1)",
        ],
    },
    "noc": {
        "name": "Network Operations Center (NOC)",
        "scope": "it",
        "primary_keys": ["devops", "networking", "it_engineers"],
        "capabilities": [
            "Caddy reverse proxy, TLS & Cloudflare Tunnel health monitoring",
            "VLAN 10 / 20 segmentation & container runtime/volume health (hub-web, n8n, redis, postgres)",
            "13-repository & 9-website HTTP/CI/Dependabot telemetry sync",
            "Incident routing & escalation to SOC / CAB / Engineering",
        ],
    },
}

class DraftRequest(BaseModel):
    tenantId: str = "eds-360"
    scope: str = "it"
    key: str = "devsecops"
    item: dict = {}
    risk: dict = {}
    defaultDraft: dict = {}

class ApproveRequest(BaseModel):
    draft: dict
    approved_by: str
    tenantId: str = "eds-360"
    scope: str = "it"
    key: str = "devsecops"
    item_ref: str = ""

class DispatchRequest(BaseModel):
    attested_record: dict
    target_endpoint: str | None = None
    tenantId: str = "eds-360"
    scope: str = "it"
    key: str = "devsecops"
    item_ref: str = ""

SYSTEM_PROMPT = """You are a grounded CMMC Level 2 / DHS CDM security & network operations drafting assistant.
Rules:
1. Use ONLY facts present in the provided item, risk, and defaultDraft JSON.
2. Do NOT invent hostnames, IP addresses, CVE numbers, log timestamps, or completed actions.
3. Produce concise, actionable human-in-the-loop (HITL) triage wording requiring operator approval.
4. Respond strictly as JSON with keys: recipient_email, subject, body, controls (array of strings)."""

def authorize_action(action: str, role: str, department: str, scope: str, func_key: str):
    role_clean = (role or "").strip().lower()
    perms = ROLE_PERMISSIONS.get(role_clean)
    if not perms:
        raise HTTPException(status_code=403, detail=f"Unknown or missing role: {role}")

    action_flags = {
        "intelligence": "can_intelligence",
        "approve": "can_approve",
        "dispatch": "can_dispatch",
        "audit": "can_read_audit",
    }
    flag = action_flags.get(action)
    if not flag or not perms.get(flag):
        raise HTTPException(status_code=403, detail=f"Role '{role_clean}' is not permitted to '{action}'")

    if "*" not in perms["scopes"] and scope not in perms["scopes"]:
        raise HTTPException(status_code=403, detail=f"Role '{role_clean}' cannot access scope '{scope}'")

    if "*" not in perms["keys"] and func_key and func_key not in perms["keys"]:
        raise HTTPException(status_code=403, detail=f"Role '{role_clean}' cannot access key '{func_key}'")

    dept_clean = (department or "").strip().lower()
    if role_clean == "department_lead" and dept_clean and scope == "department" and func_key and func_key != dept_clean:
        raise HTTPException(status_code=403, detail=f"Department lead for '{dept_clean}' cannot act on '{func_key}'")

def canonical_sha256(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()

def verify_staged_draft(draft: dict) -> bool:
    provided_hash = draft.get("draft_sha256", "")
    staged_core = {
        "recipient_email": draft.get("recipient_email", ""),
        "subject": draft.get("subject", ""),
        "body": draft.get("body", ""),
        "controls": draft.get("controls", []),
        "approval_status": draft.get("approval_status", "pending_approval"),
    }
    return bool(provided_hash) and canonical_sha256(staged_core) == provided_hash

def approve_and_sign_draft(draft: dict, approved_by: str, role: str, department: str) -> dict:
    staged_valid = verify_staged_draft(draft)
    approved_at = datetime.now(timezone.utc).isoformat()
    record = {
        "recipient_email": draft.get("recipient_email", ""),
        "subject": draft.get("subject", ""),
        "body": draft.get("body", ""),
        "controls": draft.get("controls", []),
        "approval_status": "approved",
        "approved_by": approved_by,
        "approved_at": approved_at,
        "authorized_role": role,
        "authorized_department": department,
        "staged_hash_verified": staged_valid,
        "prior_draft_sha256": draft.get("draft_sha256", ""),
    }
    record["attestation_sha256"] = canonical_sha256(record)
    return record

def verify_dispatch_attestation(attested_record: dict) -> bool:
    expected_hash = attested_record.get("attestation_sha256", "")
    if not expected_hash or attested_record.get("approval_status") != "approved":
        return False
    unsigned = {k: v for k, v in attested_record.items() if k != "attestation_sha256"}
    return canonical_sha256(unsigned) == expected_hash

def get_pg_conn():
    if psycopg2 is None:
        return None
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DB,
        user=PG_USER,
        password=PG_PASSWORD,
        connect_timeout=5,
    )

def ensure_table():
    conn = get_pg_conn()
    if conn is None:
        return False
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS hitl_attestations (
                        id SERIAL PRIMARY KEY,
                        attestation_sha256 TEXT UNIQUE NOT NULL,
                        prior_draft_sha256 TEXT,
                        tenant_id TEXT NOT NULL,
                        scope TEXT NOT NULL,
                        func_key TEXT NOT NULL,
                        item_ref TEXT,
                        recipient_email TEXT,
                        subject TEXT,
                        body TEXT,
                        controls_json JSONB,
                        approval_status TEXT NOT NULL,
                        staged_hash_verified BOOLEAN NOT NULL DEFAULT FALSE,
                        approved_by TEXT NOT NULL,
                        approved_at TIMESTAMPTZ NOT NULL,
                        dispatched_at TIMESTAMPTZ,
                        dispatch_status TEXT NOT NULL DEFAULT 'approved_pending_dispatch',
                        payload_json JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                """)
        return True
    finally:
        conn.close()

def persist_attestation(record: dict, tenant_id: str, scope: str, func_key: str, item_ref: str, dispatch_status: str, dispatched: bool) -> bool:
    if not ensure_table():
        return False
    conn = get_pg_conn()
    if conn is None:
        return False
    try:
        now_ts = datetime.now(timezone.utc)
        dispatched_ts = now_ts if dispatched else None
        with conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO hitl_attestations (
                        attestation_sha256, prior_draft_sha256, tenant_id, scope, func_key,
                        item_ref, recipient_email, subject, body, controls_json,
                        approval_status, staged_hash_verified, approved_by, approved_at,
                        dispatched_at, dispatch_status, payload_json
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s::jsonb,
                        %s, %s, %s, %s,
                        %s, %s, %s::jsonb
                    )
                    ON CONFLICT (attestation_sha256) DO UPDATE SET
                        dispatched_at = COALESCE(EXCLUDED.dispatched_at, hitl_attestations.dispatched_at),
                        dispatch_status = EXCLUDED.dispatch_status,
                        payload_json = EXCLUDED.payload_json;
                """, (
                    record["attestation_sha256"],
                    record.get("prior_draft_sha256", ""),
                    tenant_id,
                    scope,
                    func_key,
                    item_ref,
                    record.get("recipient_email", ""),
                    record.get("subject", ""),
                    record.get("body", ""),
                    json.dumps(record.get("controls", [])),
                    record.get("approval_status", "approved"),
                    bool(record.get("staged_hash_verified", False)),
                    record.get("approved_by", ""),
                    record.get("approved_at"),
                    dispatched_ts,
                    dispatch_status,
                    json.dumps(record),
                ))
        return True
    finally:
        conn.close()

@app.on_event("startup")
def on_startup():
    try:
        ensure_table()
    except Exception:
        pass

@app.get("/health")
def health():
    db_ok = False
    try:
        db_ok = ensure_table()
    except Exception:
        db_ok = False
    return {
        "ok": True,
        "service": "eds360-local-hitl-draft",
        "rbac_enabled": True,
        "roles_count": len(ROLE_PERMISSIONS),
        "operational_capabilities": list(OPERATIONAL_CAPABILITIES.keys()),
        "llm_url": LLM_BASE_URL,
        "model": LLM_MODEL,
        "postgres_ready": db_ok,
    }

@app.get("/rbac/capabilities")
def get_capabilities(
    x_user_role: str = Header(default="auditor_readonly"),
    x_user_department: str = Header(default="compliance"),
):
    role_clean = (x_user_role or "").strip().lower()
    perms = ROLE_PERMISSIONS.get(role_clean)
    if not perms:
        raise HTTPException(status_code=403, detail=f"Unknown role: {x_user_role}")
    return {
        "ok": True,
        "role": role_clean,
        "department": x_user_department,
        "permissions": {
            **perms,
            "scopes": sorted(list(perms["scopes"])),
            "keys": sorted(list(perms["keys"])),
        },
        "operational_capabilities": OPERATIONAL_CAPABILITIES,
    }

@app.post("/intelligence")
def generate_draft(
    req: DraftRequest,
    x_user_role: str = Header(default="cyber_soc_lead"),
    x_user_department: str = Header(default="cyber_soc"),
):
    authorize_action("intelligence", x_user_role, x_user_department, req.scope, req.key)
    fallback = {
        "recipient_email": req.defaultDraft.get("recipient_email", "secops@emergingdefensesolutions.com"),
        "subject": req.defaultDraft.get("subject", f"[HITL Review] {req.item.get('ref', 'ITEM')}"),
        "body": req.defaultDraft.get(
            "body",
            f"Review {req.item.get('ref', 'item')} ({req.item.get('detail', 'no detail')}) and record disposition with SHA-256 attestation."
        ),
        "controls": req.defaultDraft.get("controls", ["SI.L2-3.14.1", "AU.L2-3.3.1"]),
    }

    payload = {
        "model": LLM_MODEL,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({"item": req.item, "risk": req.risk, "defaultDraft": fallback})},
        ],
    }

    try:
        http_req = urllib.request.Request(
            LLM_BASE_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(http_req, timeout=15) as resp:
            llm_resp = json.loads(resp.read().decode("utf-8"))
        parsed = json.loads(llm_resp["choices"][0]["message"]["content"])
        draft = {
            "recipient_email": str(parsed.get("recipient_email") or fallback["recipient_email"]),
            "subject": str(parsed.get("subject") or fallback["subject"]),
            "body": str(parsed.get("body") or fallback["body"]),
            "controls": list(parsed.get("controls") or fallback["controls"]),
            "approval_status": "pending_approval",
        }
    except Exception:
        draft = {**fallback, "approval_status": "pending_approval"}

    draft["draft_sha256"] = canonical_sha256(draft)
    return {"ok": True, "authorized_role": x_user_role.strip().lower(), "draft": draft}

@app.post("/approve")
def approve_endpoint(
    req: ApproveRequest,
    x_user_role: str = Header(default="cyber_soc_lead"),
    x_user_department: str = Header(default="cyber_soc"),
):
    role_clean = (x_user_role or "").strip().lower()
    dept_clean = (x_user_department or "").strip().lower()
    authorize_action("approve", role_clean, dept_clean, req.scope, req.key)
    if not req.approved_by.strip():
        raise HTTPException(status_code=400, detail="approved_by is required for HITL sign-off")

    signed = approve_and_sign_draft(req.draft, req.approved_by.strip(), role_clean, dept_clean)
    ref = req.item_ref or signed.get("subject", "")
    persisted = persist_attestation(
        signed,
        tenant_id=req.tenantId,
        scope=req.scope,
        func_key=req.key,
        item_ref=ref,
        dispatch_status="approved_pending_dispatch",
        dispatched=False,
    )
    return {
        "ok": True,
        "staged_hash_verified": signed["staged_hash_verified"],
        "persisted_to_postgres": persisted,
        "authorized_role": role_clean,
        "attested_record": signed,
    }

@app.post("/dispatch")
def dispatch_endpoint(
    req: DispatchRequest,
    x_user_role: str = Header(default="cyber_soc_lead"),
    x_user_department: str = Header(default="cyber_soc"),
):
    role_clean = (x_user_role or "").strip().lower()
    dept_clean = (x_user_department or "").strip().lower()
    authorize_action("dispatch", role_clean, dept_clean, req.scope, req.key)
    if not verify_dispatch_attestation(req.attested_record):
        raise HTTPException(status_code=409, detail="SHA-256 attestation mismatch or missing human approval; dispatch blocked")

    ref = req.item_ref or req.attested_record.get("subject", "")
    persisted = persist_attestation(
        req.attested_record,
        tenant_id=req.tenantId,
        scope=req.scope,
        func_key=req.key,
        item_ref=ref,
        dispatch_status="attested_dispatched",
        dispatched=True,
    )
    return {
        "ok": True,
        "dispatch_status": "attested_dispatched",
        "persisted_to_postgres": persisted,
        "authorized_role": role_clean,
        "attestation_sha256": req.attested_record["attestation_sha256"],
        "approved_by": req.attested_record["approved_by"],
        "approved_at": req.attested_record["approved_at"],
    }

@app.get("/attestations")
def list_attestations(
    limit: int = 20,
    x_user_role: str = Header(default="cyber_soc_lead"),
    x_user_department: str = Header(default="cyber_soc"),
):
    authorize_action("audit", x_user_role, x_user_department, "it", "compliance_analysts")
    if not ensure_table():
        raise HTTPException(status_code=503, detail="PostgreSQL unavailable")
    conn = get_pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, attestation_sha256, prior_draft_sha256, tenant_id, scope, func_key,
                       item_ref, recipient_email, subject, approval_status,
                       staged_hash_verified, approved_by, approved_at, dispatched_at, dispatch_status
                FROM hitl_attestations
                ORDER BY id DESC
                LIMIT %s;
            """, (max(1, min(limit, 200)),))
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, [str(v) if v is not None and not isinstance(v, (bool, int)) else v for v in r])) for r in cur.fetchall()]
        return {"ok": True, "count": len(rows), "attestations": rows}
    finally:
        conn.close()