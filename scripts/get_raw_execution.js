const { client } = require('./lib/n8n');

async function main() {
  const { request } = client();
  const id = process.argv[2] || '1268';
  try {
    console.log(`Buscando dados brutos da execução ${id}...`);
    const detail = await request(`/executions/${id}`);
    console.log(JSON.stringify(detail, null, 2));
  } catch (e) {
    console.error('Erro ao buscar dados:', e.message);
  }
}
main();
