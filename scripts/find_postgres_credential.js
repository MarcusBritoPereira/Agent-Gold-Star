const { client } = require('./lib/n8n');

async function main() {
  const { request } = client();
  console.log('Buscando credenciais registradas no n8n...');
  const credentials = await request('/credentials');
  
  console.log('\nCredenciais encontradas no n8n:');
  const postgresCreds = [];
  
  const list = Array.isArray(credentials) ? credentials : (credentials.data || []);
  
  for (const cred of list) {
    console.log(`- Nome: "${cred.name}" | ID: "${cred.id}" | Tipo: "${cred.type}"`);
    if (cred.type === 'postgres') {
      postgresCreds.push(cred);
    }
  }
  
  if (postgresCreds.length > 0) {
    console.log('\n======================================================');
    console.log('🟢 CREDENCIAIS POSTGRES ENCONTRADAS:');
    for (const cred of postgresCreds) {
      console.log(`Use esta ID no seu .env:`);
      console.log(`N8N_POSTGRES_CREDENTIAL_ID="${cred.id}"`);
      console.log(`N8N_POSTGRES_CREDENTIAL_NAME="${cred.name}"`);
    }
    console.log('======================================================');
  } else {
    console.log('\n❌ Nenhuma credencial do tipo "postgres" encontrada no seu n8n.');
    console.log('Por favor, acesse o painel do n8n, vá em Credentials e crie uma credencial Postgres apontando para o seu banco.');
  }
}

main().catch(err => {
  console.error('\n❌ Erro ao buscar credenciais:', err.message);
  process.exitCode = 1;
});
