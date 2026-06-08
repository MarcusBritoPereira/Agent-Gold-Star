const N8N_API_URL = 'http://localhost:5678/api/v1/workflows';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNjBkOTY3OS1jYWY3LTQ0YmUtOTNjMy00Y2E2NjM2NTRjZDEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMmRkNjhkMzAtMWVjMy00MjFkLWExMGEtOTk3NTdiNTZjYTExIiwiaWF0IjoxNzgwNTM4NzQ0fQ.LHHjqu1MP2IsGg_LqxCgSvraAj_2ng23flFm_5BmIzk';

async function activateWorkflows() {
  try {
    const listRes = await fetch(N8N_API_URL, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY }
    });
    if (!listRes.ok) {
      console.error('Failed to fetch workflows');
      return;
    }
    const resJSON = await listRes.json();
    const workflows = resJSON.data || [];

    for (const wf of workflows) {
      if (!wf.active) {
        console.log(`Activating workflow: "${wf.name}" (ID: ${wf.id})...`);
        const updateRes = await fetch(`${N8N_API_URL}/${wf.id}/activate`, {
          method: 'POST',
          headers: {
            'X-N8N-API-KEY': N8N_API_KEY
          }
        });

        if (updateRes.ok) {
          console.log(`  ✅ Activated successfully.`);
        } else {
          const errText = await updateRes.text();
          console.error(`  ❌ Failed to activate: ${errText}`);
        }
      } else {
        console.log(`Workflow "${wf.name}" is already active.`);
      }
    }
  } catch (err) {
    console.error('Error during activation:', err.message);
  }
}

activateWorkflows();
