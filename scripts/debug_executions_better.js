const { client } = require('./lib/n8n');

async function main() {
  const { request } = client();
  try {
    const res = await request('/executions?limit=5');
    const executions = res.data || res || [];
    console.log(`Encontradas ${executions.length} execuções no n8n.`);
    
    for (const exec of executions) {
      console.log(`\n======================================================`);
      console.log(`Execution ID: ${exec.id}`);
      console.log(`Workflow ID: ${exec.workflowId}`);
      console.log(`Status: ${exec.status}`);
      console.log(`Início: ${exec.startedAt}`);
      
      if (exec.status === 'error' || exec.status === 'failed' || true) {
        try {
          const detail = await request(`/executions/${exec.id}`);
          // n8n às vezes retorna o objeto diretamente ou envelopado em { data: ... }
          const execData = detail.data || detail;
          console.log(`Erro registrado:`, JSON.stringify(execData.data?.resultData?.error || execData.data?.error || execData.error || 'Nenhum erro explícito encontrado no JSON principal.'));
          
          if (execData.data?.resultData?.runData) {
            console.log('Detalhes dos Nós Executados:');
            const runData = execData.data.resultData.runData;
            for (const nodeName of Object.keys(runData)) {
              const nodeRuns = runData[nodeName];
              for (const run of nodeRuns) {
                if (run.error) {
                  console.log(`❌ Nó "${nodeName}" falhou:`, JSON.stringify(run.error, null, 2));
                }
              }
            }
          }
        } catch (err) {
          console.log(`Não foi possível carregar detalhes para a ID ${exec.id}: ${err.message}`);
        }
      }
    }
  } catch (e) {
    console.error('Erro geral no debug:', e.message);
  }
}
main();
