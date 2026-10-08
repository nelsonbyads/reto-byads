import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function envFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("=")).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).replace(/^["']|["']$/g, "")]; }));
}

const env = { ...envFile(path.join(process.cwd(), ".env.local")), ...process.env };
if (!env.VITE_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SKIP: test-economy-2-1 requiere SUPABASE_SERVICE_ROLE_KEY para fixtures aislados.");
  process.exit(0);
}

const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const requiredRpcs = ["get_dadofit_marketplace", "get_partner_marketplace", "get_my_dc_budgets", "get_partner_point_analytics"];
const health = await client.rpc("dadofit_health");
if (health.error) throw health.error;
const version = await client.rpc("get_dadofit_schema_version");
if (version.error) throw version.error;
if (!String(version.data).includes("eco4h")) throw new Error(`Economy schema not applied: ${version.data}`);
for (const rpc of requiredRpcs) {
  const args = rpc === "get_partner_marketplace" || rpc === "get_partner_point_analytics" ? { p_organization_id: crypto.randomUUID() } : undefined;
  const result = await client.rpc(rpc, args);
  if (result.error && !["P0001", "42501"].includes(result.error.code)) throw new Error(`${rpc}: ${result.error.message}`);
}
console.log("PASS: Economy 2.1 schema, marketplace split, budget visibility and analytics RPCs are reachable.");
