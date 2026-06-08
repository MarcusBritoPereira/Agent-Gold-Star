const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function n8nConfig() {
  loadEnv();
  return {
    apiUrl: (process.env.N8N_API_URL || 'http://localhost:5678/api/v1').replace(/\/$/, ''),
    apiKey: required('N8N_API_KEY'),
    credentialId: process.env.N8N_POSTGRES_CREDENTIAL_ID || '',
    credentialName: process.env.N8N_POSTGRES_CREDENTIAL_NAME || 'Gold Star Postgres'
  };
}

module.exports = { loadEnv, required, n8nConfig };
