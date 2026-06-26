const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');

// Carrega .env
function loadEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnv();
  
  // Como o script roda no host do VPS, usamos o POSTGRES_PORT exposto (5439 ou 5436 no .env)
  // E o host localhost.
  const port = Number(process.env.POSTGRES_PORT || 5432);
  const config = {
    host: 'localhost',
    port: port,
    database: process.env.POSTGRES_DB || 'gold_star',
    user: process.env.POSTGRES_USER || 'gold_star',
    password: process.env.POSTGRES_PASSWORD || 'change-me'
  };
  
  console.log(`Conectando ao banco PostgreSQL em ${config.host}:${config.port}...`);
  const client = new Client(config);
  await client.connect();
  
  const id = Number(process.argv[2] || '1268');
  try {
    console.log(`Buscando no banco a execução ID: ${id}...`);
    // n8n pode usar "execution_entity"
    let res;
    try {
      res = await client.query('SELECT data FROM execution_entity WHERE id = $1', [id]);
    } catch (e) {
      console.log('execution_entity não funcionou, tentando tabela execution...');
      res = await client.query('SELECT data FROM execution WHERE id = $1', [id]);
    }
    
    if (res.rows.length > 0) {
      const data = JSON.parse(res.rows[0].data);
      console.log('\n======================================================');
      console.log('🟢 DADOS DA EXECUÇÃO ENCONTRADOS NO BANCO:');
      
      if (data.resultData?.error) {
        console.log('Erro geral da execução:', JSON.stringify(data.resultData.error, null, 2));
      }
      
      if (data.resultData?.runData) {
        console.log('\nNós executados e seus status/erros:');
        const runData = data.resultData.runData;
        for (const nodeName of Object.keys(runData)) {
          const runs = runData[nodeName];
          for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            console.log(`- Nó: "${nodeName}" | Iteração: ${i} | Sucesso: ${!run.error}`);
            if (run.error) {
              console.log(`  ❌ ERRO DO NÓ:`, JSON.stringify(run.error, null, 2));
            }
          }
        }
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
      console.log('======================================================');
    } else {
      console.log(`\n❌ Nenhuma execução com ID ${id} encontrada no banco de dados.`);
    }
  } catch (err) {
    console.error('Erro na consulta:', err.message);
  } finally {
    await client.end();
  }
}

main();
