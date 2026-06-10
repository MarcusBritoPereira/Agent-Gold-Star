const { client } = require('./lib/n8n');
async function main() {
  const { request } = client();
  try {
    const executions = await request('/executions?limit=5');
    if (executions.data && executions.data.length > 0) {
      for (const exec of executions.data) {
        if (exec.status === 'error') {
          const fullExec = await request(`/executions/${exec.id}`);
          const data = fullExec.data;
          if (data && data.data && data.data.resultData) {
            console.log(JSON.stringify(data.data.resultData.error, null, 2));
          } else {
            console.log("Keys: ", Object.keys(data || {}));
          }
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
