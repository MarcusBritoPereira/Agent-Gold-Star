const fs = require('fs');
const path = require('path');

const N8N_API_URL = 'http://localhost:5678/api/v1/workflows';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNjBkOTY3OS1jYWY3LTQ0YmUtOTNjMy00Y2E2NjM2NTRjZDEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMmRkNjhkMzAtMWVjMy00MjFkLWExMGEtOTk3NTdiNTZjYTExIiwiaWF0IjoxNzgwNTM4NzQ0fQ.LHHjqu1MP2IsGg_LqxCgSvraAj_2ng23flFm_5BmIzk';

async function deployWorkflows() {
  const dir = path.join(__dirname, 'workflows');
  if (!fs.existsSync(dir)) {
    console.error('Workflows directory does not exist!');
    process.exit(1);
  }

  // 1. Fetch existing workflows from n8n to avoid duplicates
  let existingWorkflows = [];
  try {
    const listRes = await fetch(N8N_API_URL, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY }
    });
    if (listRes.ok) {
      const resJSON = await listRes.json();
      existingWorkflows = resJSON.data || [];
    }
  } catch (err) {
    console.warn('Could not fetch existing workflows. Proceeding with POST mode.', err.message);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} workflows in project...`);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    delete content.active;

    const matchedWorkflow = existingWorkflows.find(w => w.name === content.name);

    if (matchedWorkflow) {
      console.log(`Updating existing: "${content.name}" (ID: ${matchedWorkflow.id})...`);
      try {
        const response = await fetch(`${N8N_API_URL}/${matchedWorkflow.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-API-KEY': N8N_API_KEY
          },
          body: JSON.stringify(content)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`n8n API responded with ${response.status}: ${errorText}`);
        }

        console.log(`  ✅ Successfully updated.`);
      } catch (err) {
        console.error(`  ❌ Failed to update ${file}:`, err.message);
      }
    } else {
      console.log(`Creating new: "${content.name}"...`);
      try {
        const response = await fetch(N8N_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-N8N-API-KEY': N8N_API_KEY
          },
          body: JSON.stringify(content)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`n8n API responded with ${response.status}: ${errorText}`);
        }

        const resData = await response.json();
        console.log(`  ✅ Successfully created. ID: ${resData.id}`);
      } catch (err) {
        console.error(`  ❌ Failed to create ${file}:`, err.message);
      }
    }
  }
}

deployWorkflows();
