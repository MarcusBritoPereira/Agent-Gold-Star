const fs = require('node:fs');
const path = require('node:path');
const { client, deployableWorkflow } = require('./scripts/lib/n8n');

async function main() {
  const { config, request } = client();
  const directory = path.join(__dirname, 'workflows');
  const files = fs.readdirSync(directory).filter((file) => /^\d{2}_.+\.json$/.test(file)).sort();
  const listed = await request('/workflows?limit=250');
  const existing = listed.data || [];
  for (const file of files) {
    const source = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    const payload = deployableWorkflow(source, config);
    const match = existing.find((item) => item.name === payload.name);
    if (match) {
      await request(`/workflows/${match.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      await request(`/workflows/${match.id}/activate`, { method: 'POST', body: '{}' });
      console.log(`updated and activated ${payload.name} (${match.id})`);
    } else {
      const created = await request('/workflows', { method: 'POST', body: JSON.stringify(payload) });
      await request(`/workflows/${created.id}/activate`, { method: 'POST', body: '{}' });
      console.log(`created and activated ${payload.name} (${created.id})`);
    }
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
