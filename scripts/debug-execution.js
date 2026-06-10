const { client } = require('./lib/n8n');
async function main() {
  const { request } = client();
  try {
    const executions = await request('/executions?limit=5');
    if (executions.data && executions.data.length > 0) {
      for (const exec of executions.data) {
        if (exec.status === 'error') {
          const fullExec = await request(`/executions/${exec.id}`);
          console.log(`Execution ${exec.id} Error:`);
          const data = fullExec.data.resultData?.error;
          console.log(JSON.stringify(data, null, 2));
        }
      }
    } else {
      console.log('No executions found');
    }
  } catch (e) {
    console.error(e.message);
  }
}
main();
