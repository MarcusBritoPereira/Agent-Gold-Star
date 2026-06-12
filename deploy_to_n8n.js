const fs = require('node:fs');
const path = require('node:path');
const { client, deployableWorkflow } = require('./scripts/lib/n8n');

async function main() {
  const { config, request } = client();
  
  // Find or create the openai credential
  const creds = await request('/credentials');
  let openaiCred = creds.data?.find(c => c.type === 'openAiApi' || c.name.toLowerCase().includes('openai'));
  if (!openaiCred) {
    if (process.env.OPENAI_API_KEY) {
      console.log('Creating OpenAI credential in n8n...');
      openaiCred = await request('/credentials', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Gold Star OpenAI API',
          type: 'openAiApi',
          data: { 
            apiKey: process.env.OPENAI_API_KEY,
            header: false,
            allowedHttpRequestDomains: "none"
          }
        })
      });
    } else {
      throw new Error('Please create an OpenAI credential in the N8N UI or set OPENAI_API_KEY in .env before deploying!');
    }
  }
  process.env.OPENAI_CREDENTIAL_ID = openaiCred.id;
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
