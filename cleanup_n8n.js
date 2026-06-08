const N8N_API_URL = 'http://localhost:5678/api/v1/workflows';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNjBkOTY3OS1jYWY3LTQ0YmUtOTNjMy00Y2E2NjM2NTRjZDEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMmRkNjhkMzAtMWVjMy00MjFkLWExMGEtOTk3NTdiNTZjYTExIiwiaWF0IjoxNzgwNTM4NzQ0fQ.LHHjqu1MP2IsGg_LqxCgSvraAj_2ng23flFm_5BmIzk';

async function cleanup() {
  try {
    // 1. Fetch all workflows
    const response = await fetch(N8N_API_URL, {
      headers: { 'X-N8N-API-KEY': N8N_API_KEY }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch workflows: ${response.statusText}`);
    }
    
    const resData = await response.json();
    const workflows = resData.data;
    
    console.log(`Fetched ${workflows.length} workflows from n8n.`);
    
    // 2. Group by name
    const grouped = {};
    for (const wf of workflows) {
      if (!grouped[wf.name]) {
        grouped[wf.name] = [];
      }
      grouped[wf.name].push(wf);
    }
    
    // 3. Delete duplicates
    for (const name in grouped) {
      const list = grouped[name];
      if (list.length > 1) {
        // Sort by updatedAt descending (newest first)
        list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        
        // Keep the first (newest), delete the rest
        const toKeep = list[0];
        const toDelete = list.slice(1);
        
        console.log(`Workflow "${name}": keeping newest ID ${toKeep.id}, deleting ${toDelete.length} duplicates...`);
        
        for (const wf of toDelete) {
          const deleteRes = await fetch(`${N8N_API_URL}/${wf.id}`, {
            method: 'DELETE',
            headers: { 'X-N8N-API-KEY': N8N_API_KEY }
          });
          
          if (deleteRes.ok) {
            console.log(`  Deleted ID: ${wf.id}`);
          } else {
            console.error(`  Failed to delete ID: ${wf.id} - ${deleteRes.statusText}`);
          }
        }
      }
    }
    console.log('Cleanup finished!');
  } catch (err) {
    console.error('Error during cleanup:', err.message);
  }
}

cleanup();
