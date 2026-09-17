import "server-only";

import { neon } from "@neondatabase/serverless";
import { withSessionScope } from "@/lib/scoped-sql";

// New for robust_onboading — with_robust_app has no equivalent yet. The
// `agent_templates` / `complex_template_seeds` tables (same AGENTS_DATABASE_URL
// database as `agents`) were already designed for this in with_robust_app's
// db/agent_templates.sql — "When a complex is provisioned, the app is
// expected to copy the union of active system templates and the templates
// of the complex's chain (if any) into real rows in `agents`... No such
// provisioning code exists yet." This file is that provisioning code.

function getAgentsDatabaseUrl() {
  const url = process.env.AGENTS_DATABASE_URL;
  if (!url) throw new Error("AGENTS_DATABASE_URL is not set");
  return url;
}

// Complex-scoped RLS (with_robust_app's db/agents_complex_scoped_rls.sql,
// same database) - this app is only ever used by a real super_admin
// session (gated by requireSuperAdmin()), which every policy there already
// bypasses on.
export const agentsSql = withSessionScope(neon(getAgentsDatabaseUrl()));

export type AgentTemplateRecord = {
  id: string;
  scope: "system" | "chain";
  chain_id: string | null;
  name: string;
  prompt: string | null;
  trigger_type: string | null;
  trigger_config: unknown;
  output_type: string | null;
  output_config: unknown;
};

export async function listActiveAgentTemplates(
  chainId: string | null,
): Promise<AgentTemplateRecord[]> {
  const rows = await agentsSql`
    SELECT id, scope, chain_id, name, prompt, trigger_type, trigger_config, output_type, output_config
    FROM agent_templates
    WHERE deleted_at IS NULL
      AND is_active
      AND (scope = 'system' OR (scope = 'chain' AND chain_id = ${chainId}))
    ORDER BY sort_index ASC, created_at ASC
  `;
  return rows as AgentTemplateRecord[];
}

/**
 * Copies every active default agent template (system-wide, plus the
 * complex's chain templates when it has one) into real `agents` rows for a
 * newly created complex, recording provenance (`source_template_id`) and
 * idempotency (`complex_template_seeds`) exactly as db/agent_templates.sql
 * and db/complex_template_seeds.sql anticipated.
 */
export async function seedDefaultAgentsForComplex(
  complexId: string,
  chainId: string | null,
  userId: string,
): Promise<number> {
  const templates = await listActiveAgentTemplates(chainId);
  let seeded = 0;

  for (const template of templates) {
    const [inserted] = await agentsSql`
      INSERT INTO agents (
        name, status, prompt, trigger_type, trigger_config,
        output_type, output_config, current_step, created_by, complex_id, source_template_id
      ) VALUES (
        ${template.name}, 'active', ${template.prompt},
        ${template.trigger_type}, ${JSON.stringify(template.trigger_config)},
        ${template.output_type}, ${JSON.stringify(template.output_config)},
        1, ${userId}, ${complexId}, ${template.id}
      )
      RETURNING id
    `;
    if (!inserted) continue;

    await agentsSql`
      INSERT INTO complex_template_seeds (complex_id, template_id)
      VALUES (${complexId}, ${template.id})
      ON CONFLICT (complex_id, template_id) DO NOTHING
    `;
    seeded += 1;
  }

  return seeded;
}
