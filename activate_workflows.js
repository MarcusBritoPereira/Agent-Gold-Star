const { client } = require('./scripts/lib/n8n');

async function main() {
  const { request } = client();
  const response = await request('/workflows?limit=250');
  const workflows = (response.data || []).filter((item) => /^0[1-8] - /.test(item.name));
  for (const workflow of workflows) {
    if (workflow.active) { console.log(`already active ${workflow.name}`); continue; }
    await request(`/workflows/${workflow.id}/activate`, { method: 'POST' });
    console.log(`activated ${workflow.name}`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
