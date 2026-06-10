const { n8nConfig } = require('./config');

function client() {
  const config = n8nConfig();
  async function request(path, options = {}) {
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...options,
      headers: { 'X-N8N-API-KEY': config.apiKey, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) throw new Error(`n8n ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    return body;
  }
  return { config, request };
}

function deployableWorkflow(workflow, config) {
  const copy = structuredClone(workflow);
  delete copy.active;
  delete copy.id;
  delete copy.versionId;
  delete copy.triggerCount;
  delete copy.tags;
  delete copy.pinData;
  for (const workflowNode of copy.nodes || []) {
    if (workflowNode.credentials?.postgres) {
      const credential = workflowNode.credentials.postgres;
      if (!config.credentialId) throw new Error('N8N_POSTGRES_CREDENTIAL_ID is required');
      credential.id = config.credentialId;
      credential.name = config.credentialName;
    }
    delete workflowNode.credentials?.geminiApi;
    delete workflowNode.credentials?.googlePalmApi;
  }
  return copy;
}

module.exports = { client, deployableWorkflow };
