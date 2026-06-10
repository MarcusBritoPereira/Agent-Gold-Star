const { loadEnv } = require('./lib/config');

async function main() {
  loadEnv();

  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || 'goldstar';
  // Use a URL interna do docker-compose para a comunicação local do script se rodar no VPS,
  // ou a URL externa se rodar fora do docker.
  const isVps = process.cwd().includes('/opt/gold-star');
  const evoUrl = isVps ? 'http://localhost:8088' : (process.env.EVOLUTION_API_URL || 'http://localhost:8088');
  const n8nBaseUrl = isVps ? 'https://n8n.lanchasgoldstar.com.br' : (process.env.N8N_WEBHOOK_URL || 'http://localhost:5679');

  console.log('=== Iniciando Configuração do Modo Live ===');
  console.log(`Evolution API URL: ${evoUrl}`);
  console.log(`N8N Webhook Base: ${n8nBaseUrl}`);
  console.log(`Instância: ${instance}`);

  if (!apiKey || apiKey === 'change-me' || apiKey === 'gold_star_api_key_123') {
    throw new Error('Erro: EVOLUTION_API_KEY inválida ou não configurada no .env');
  }

  // 1. Criar a instância na Evolution API
  console.log('\n[1/3] Criando instância na Evolution API...');
  const createRes = await fetch(`${evoUrl}/instance/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey
    },
    body: JSON.stringify({
      instanceName: instance,
      token: apiKey,
      qrcode: true
    })
  });

  const createData = await createRes.json();
  const errorMsg = createData.message || createData.response?.message || '';
  const errorStr = Array.isArray(errorMsg) ? errorMsg.join(' ') : String(errorMsg);
  if (createRes.ok) {
    console.log(`✔ Instância "${instance}" criada com sucesso!`);
  } else {
    // Se já existe, tudo bem
    if (errorStr.toLowerCase().includes('already exists') || errorStr.toLowerCase().includes('already in use')) {
      console.log(`✔ Instância "${instance}" já existe.`);
    } else {
      throw new Error(`Falha ao criar instância: ${JSON.stringify(createData)}`);
    }
  }

  // 2. Configurar o Webhook
  console.log('\n[2/3] Configurando o Webhook do WhatsApp na Evolution API...');
  const webhookUrl = `${n8nBaseUrl.replace(/\/$/, '')}/webhook/whatsapp-webhook`;
  console.log(`Registrando webhook: ${webhookUrl}`);

  const webhookRes = await fetch(`${evoUrl}/webhook/set/${instance}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': apiKey
    },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        events: ['MESSAGES_UPSERT', 'SEND_MESSAGE']
      }
    })
  });

  const webhookData = await webhookRes.json();
  if (webhookRes.ok) {
    console.log('✔ Webhook registrado com sucesso!');
  } else {
    throw new Error(`Falha ao configurar webhook: ${JSON.stringify(webhookData)}`);
  }

  // 3. Obter QR Code de Conexão
  console.log('\n[3/3] Recuperando QR Code para conexão...');
  const qrRes = await fetch(`${evoUrl}/instance/connect/${instance}`, {
    method: 'GET',
    headers: {
      'apikey': apiKey
    }
  });

  const qrData = await qrRes.json();
  if (qrRes.ok) {
    if (qrData.instance?.state === 'open') {
      console.log('✔ WhatsApp já está conectado!');
    } else if (qrData.code) {
      console.log('\n================================================================');
      console.log('QR CODE OBTIDO COM SUCESSO!');
      console.log('Escaneie o QR Code abaixo no seu celular para conectar o WhatsApp:');
      console.log('================================================================\n');
      console.log(qrData.code);
      console.log('\n================================================================');
    } else if (qrData.base64) {
      console.log('✔ QR Code disponível como imagem Base64. (Escaneie no Evolution Manager ou painel)');
    } else {
      console.log('Instância criada, mas o QR Code não pôde ser renderizado agora. Verifique se o celular já está conectado.');
    }
  } else {
    console.log(`Aviso: não foi possível carregar o status de conexão atual: ${JSON.stringify(qrData)}`);
  }

  console.log('\nConfiguração concluída com sucesso!');
}

main().catch((err) => {
  console.error(`\n❌ Erro durante a configuração: ${err.message}`);
  process.exitCode = 1;
});
