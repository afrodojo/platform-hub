import { pool } from '@/lib/db';
import PortalInteractive from '@/components/PortalInteractive';

export const dynamic = 'force-dynamic';

async function getPortalSnapshot() {
  try {
    let orgRes = await pool.query(
      `SELECT id, name, rd_telemetry_opt_in FROM organizations ORDER BY created_at ASC LIMIT 1`
    );

    if (orgRes.rows.length === 0) {
      orgRes = await pool.query(
        `INSERT INTO organizations (name, primary_domain, rd_telemetry_opt_in)
         VALUES ('Emerging Defense Founding Client', 'example-smb.com', FALSE)
         RETURNING id, name, rd_telemetry_opt_in`
      );
    }

    const org = orgRes.rows[0];

    const subRes = await pool.query(
      `SELECT tier, monthly_ron_credits, remaining_ron_credits, monthly_process_credits, remaining_process_credits, rd_lab_access
       FROM subscriptions WHERE org_id = $1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1`,
      [org.id]
    );

    const sub = subRes.rows[0] ?? {
      tier: 'essentials',
      monthly_ron_credits: 2,
      remaining_ron_credits: 2,
      monthly_process_credits: 0,
      remaining_process_credits: 0,
      rd_lab_access: false,
    };

    const cyberRes = await pool.query(
      `SELECT risk_score, critical_count, high_count
       FROM cyber_monitoring_runs WHERE org_id = $1 ORDER BY executed_at DESC LIMIT 1`,
      [org.id]
    );

    const cyber = cyberRes.rows[0] ?? { risk_score: 94, critical_count: 0, high_count: 1 };

    const casesRes = await pool.query(
      `SELECT id, division, title, priority, status, created_at
       FROM division_cases WHERE org_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [org.id]
    );

    return {
      orgId: org.id,
      orgName: org.name,
      rdTelemetryOptIn: org.rd_telemetry_opt_in,
      tier: sub.tier,
      ronMonthly: sub.monthly_ron_credits,
      ronRemaining: sub.remaining_ron_credits,
      processMonthly: sub.monthly_process_credits,
      processRemaining: sub.remaining_process_credits,
      rdLabAccess: sub.rd_lab_access,
      riskScore: cyber.risk_score ?? 94,
      criticalCount: cyber.critical_count ?? 0,
      highCount: cyber.high_count ?? 0,
      initialCases: casesRes.rows.map((r) => ({
        ...r,
        created_at: new Date(r.created_at).toISOString(),
      })),
    };
  } catch {
    return {
      orgId: '',
      orgName: 'Preview Workspace (Connect Postgres)',
      rdTelemetryOptIn: false,
      tier: 'essentials',
      ronMonthly: 2,
      ronRemaining: 2,
      processMonthly: 0,
      processRemaining: 0,
      rdLabAccess: false,
      riskScore: 94,
      criticalCount: 0,
      highCount: 0,
      initialCases: [],
    };
  }
}

export default async function HomePage() {
  const snapshot = await getPortalSnapshot();
  return <PortalInteractive {...snapshot} />;
}