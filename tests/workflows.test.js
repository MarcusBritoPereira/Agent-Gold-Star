const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '..', 'workflows');
const files = fs.readdirSync(directory).filter((file) => /^\d{2}_.+\.json$/.test(file));

test('ships exactly eight production workflows', () => assert.equal(files.length, 8));
test('all workflow connections target existing nodes', () => {
  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    const names = new Set(workflow.nodes.map((item) => item.name));
    for (const [source, outputs] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source), `${file}: ${source}`);
      for (const branch of outputs.main) for (const target of branch) assert.ok(names.has(target.node), `${file}: ${target.node}`);
    }
  }
});
test('PostgreSQL nodes use positional replacements', () => {
  for (const file of files) {
    const workflow = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    for (const item of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.postgres')) {
      assert.match(item.parameters.query, /\$\d/);
      assert.ok(item.parameters.options.queryReplacement);
    }
  }
});
test('legacy providers and secret placeholders are absent', () => {
  const content = files.map((file) => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n');
  assert.doesNotMatch(content, /graph\.facebook\.com|YOUR_PHONE_NUMBER_ID|YOUR\/SLACK\/WEBHOOK|eyJhbGciOiJ/);
});
