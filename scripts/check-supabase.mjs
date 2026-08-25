import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};
  const content = fs.readFileSync(filePath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const root = process.cwd();
const localEnv = parseEnvFile(path.join(root, '.env.local'));
const baseEnv = parseEnvFile(path.join(root, '.env'));
const env = { ...baseEnv, ...localEnv, ...process.env };

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error('ERROR: faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY.');
  process.exit(1);
}

const client = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const { data, error } = await client.rpc('dadofit_health');

if (error) {
  console.error('ERROR: Supabase respondio, pero el healthcheck fallo.');
  console.error(`${error.code ?? 'UNKNOWN'}: ${error.message}`);
  console.error('Confirma que ejecutaste: npx supabase db push');
  process.exit(1);
}

console.log('DadoFit -> Supabase: OK');
console.log(`Project: ${new URL(url).hostname}`);
console.log(`Schema: ${data?.schema_version ?? 'unknown'}`);
console.log(`Server time: ${data?.server_time ?? 'unknown'}`);
