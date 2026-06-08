const fs = require('node:fs');
const path = require('node:path');
const { loadEnv, required } = require('./scripts/lib/config');

loadEnv();
const credentialId = required('N8N_POSTGRES_CREDENTIAL_ID');
const credentialName = process.env.N8N_POSTGRES_CREDENTIAL_NAME || 'Gold Star Postgres';
const directory = path.join(__dirname, 'workflows');
for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
  const filePath = path.join(directory, file);
  const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let changed = false;
  for (const workflowNode of workflow.nodes || []) {
    if (!workflowNode.credentials?.postgres) continue;
    workflowNode.credentials.postgres = { id: credentialId, name: credentialName };
    changed = true;
  }
  if (changed) fs.writeFileSync(filePath, `${JSON.stringify(workflow, null, 2)}\n`);
}
console.log('PostgreSQL credential references injected');
