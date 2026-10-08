import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, "")];
  }));
}

const env = { ...envFile(path.join(process.cwd(), ".env.local")), ...process.env };
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: test-dc-budget-concurrency requiere VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(0);
}

const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const marker = `economy-concurrency-${crypto.randomUUID()}`;
let budgetId;
try {
  const { data: budget, error: insertError } = await client.from("dc_budgets").insert({ is_dadofit_internal: true, budget_dc: 50, used_dc: 0, status: "active", starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString() }).select("id").single();
  if (insertError) throw insertError;
  budgetId = budget.id;
  const consume = (amount, key) => client.rpc("consume_dc_budget_internal", { p_dc_budget_id: budgetId, p_amount: amount, p_direction: "grant", p_reason: marker, p_external_source: "economy_test", p_idempotency_key: key });
  const [a, b] = await Promise.all([consume(30, `${marker}:a`), consume(30, `${marker}:b`)]);
  if (a.error || b.error) throw a.error ?? b.error;
  const successes = [a.data, b.data].filter((result) => result?.success);
  if (successes.length !== 1) throw new Error(`Expected exactly one concurrent grant, received ${successes.length}`);
  const first = await consume(10, `${marker}:idem`);
  const replay = await consume(10, `${marker}:idem`);
  if (first.error || replay.error || !first.data?.success || !replay.data?.idempotent_replay) throw first.error ?? replay.error ?? new Error("Idempotency assertion failed");
  console.log("PASS: DC budget concurrency and idempotency.");
} finally {
  if (budgetId) {
    await client.from("dc_budget_transactions").delete().eq("dc_budget_id", budgetId);
    await client.from("dc_budgets").delete().eq("id", budgetId);
  }
}
