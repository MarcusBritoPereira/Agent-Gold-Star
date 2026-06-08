const { client } = require('./scripts/lib/n8n');

async function main() {
  if (process.env.CONFIRM_CLEANUP !== 'yes') throw new Error('Set CONFIRM_CLEANUP=yes to delete Gold Star workflows');
  const { request } = client();
  const response = await request('/workflows?limit=250');
  const workflows = (response.data || []).filter((item) => /^0[1-8] - /.test(item.name));
  for (const workflow of workflows) {
    if (workflow.active) await request(`/workflows/${workflow.id}/deactivate`, { method: 'POST' });
    await request(`/workflows/${workflow.id}`, { method: 'DELETE' });
    console.log(`deleted ${workflow.name}`);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
