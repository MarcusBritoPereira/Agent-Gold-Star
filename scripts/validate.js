const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflowDirectory = path.join(root, 'workflows');
const files = fs.readdirSync(workflowDirectory).filter((file) => /^\d{2}_.+\.json$/.test(file)).sort();
const errors = [];
if (files.length !== 8) errors.push(`expected 8 production workflows, found ${files.length}`);
for (const file of files) {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDirectory, file), 'utf8'));
  const names = new Set((workflow.nodes || []).map((item) => item.name));
  if (!workflow.name || !workflow.nodes?.length) errors.push(`${file}: missing name or nodes`);
  for (const [source, outputs] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) errors.push(`${file}: connection source ${source} does not exist`);
    for (const branch of outputs.main || []) for (const target of branch || []) if (!names.has(target.node)) errors.push(`${file}: connection target ${target.node} does not exist`);
  }
  const text = JSON.stringify(workflow);
  for (const forbidden of ['YOUR_PHONE_NUMBER_ID', 'YOUR/SLACK/WEBHOOK', 'graph.facebook.com', 'localhost:8088']) if (text.includes(forbidden)) errors.push(`${file}: contains forbidden legacy value ${forbidden}`);
  for (const workflowNode of workflow.nodes || []) {
    if (workflowNode.type === 'n8n-nodes-base.postgres') {
      if (!workflowNode.parameters.query.includes('$')) errors.push(`${file}/${workflowNode.name}: SQL must use positional parameters`);
      if (!workflowNode.parameters.options?.queryReplacement) errors.push(`${file}/${workflowNode.name}: missing query replacements`);
    }
  }
}
const trackedTextFiles = ['activate_workflows.js','cleanup_n8n.js','deploy_to_n8n.js','test_system.js','system_documentation.md'];
for (const file of trackedTextFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (/eyJhbGciOiJ|gold_star_api_key_123/.test(text)) errors.push(`${file}: appears to contain a committed secret`);
}
if (errors.length) { console.error(errors.map((error) => `- ${error}`).join('\n')); process.exit(1); }
console.log(`validated ${files.length} workflows and repository security invariants`);
