/**
 * Script de teste do sistema Gold Star
 * Testa o fluxo completo sem OpenAI (usando mock de IA)
 * 
 * Etapas:
 * 1. Deploya o workflow mock (02) no n8n
 * 2. Ativa todos os workflows
 * 3. Envia mensagem simulada de WhatsApp
 * 4. Verifica o resultado no banco de dados
 */

const N8N_API_URL = 'http://localhost:5678/api/v1';
const N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNjBkOTY3OS1jYWY3LTQ0YmUtOTNjMy00Y2E2NjM2NTRjZDEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiMmRkNjhkMzAtMWVjMy00MjFkLWExMGEtOTk3NTdiNTZjYTExIiwiaWF0IjoxNzgwNTM4NzQ0fQ.LHHjqu1MP2IsGg_LqxCgSvraAj_2ng23flFm_5BmIzk';
const WEBHOOK_URL = 'http://localhost:5678/webhook/whatsapp-webhook';

const fs = require('fs');
const path = require('path');

const headers = {
  'Content-Type': 'application/json',
  'X-N8N-API-KEY': N8N_API_KEY
};

// ─── Helpers ────────────────────────────────────────────

function log(emoji, msg) {
  console.log(`\n${emoji}  ${msg}`);
}

function logDetail(msg) {
  console.log(`   ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Step 1: Deploy o mock do workflow 02 ───────────────

async function deployMock() {
  log('📦', 'STEP 1: Deployando Mock IA (workflow 02)...');

  const mockPath = path.join(__dirname, 'workflows', '02_intent_detection_mock.json');
  const mockContent = JSON.parse(fs.readFileSync(mockPath, 'utf8'));

  // Buscar ID do workflow 02 existente
  const res = await fetch(`${N8N_API_URL}/workflows`, { headers });
  const data = await res.json();
  const wf02 = data.data.find(w => w.name.includes('02 - IA Intent Detection'));

  if (!wf02) {
    logDetail('❌ Workflow 02 não encontrado no n8n!');
    return false;
  }

  logDetail(`Encontrado: ID=${wf02.id}`);

  // Desativar antes de atualizar
  await fetch(`${N8N_API_URL}/workflows/${wf02.id}/deactivate`, {
    method: 'POST', headers
  });

  // Atualizar com o mock
  delete mockContent.active;
  const updateRes = await fetch(`${N8N_API_URL}/workflows/${wf02.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(mockContent)
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    logDetail(`❌ Erro ao atualizar: ${err}`);
    return false;
  }

  // Reativar
  await fetch(`${N8N_API_URL}/workflows/${wf02.id}/activate`, {
    method: 'POST', headers
  });

  logDetail('✅ Mock IA deployado e ativado com sucesso!');
  return true;
}

// ─── Step 2: Verificar workflows ativos ─────────────────

async function checkWorkflows() {
  log('🔍', 'STEP 2: Verificando workflows...');

  const res = await fetch(`${N8N_API_URL}/workflows`, { headers });
  const data = await res.json();

  for (const wf of data.data.sort((a, b) => a.name.localeCompare(b.name))) {
    const status = wf.active ? '🟢 Ativo' : '🔴 Inativo';
    logDetail(`${status}  ${wf.name}`);
  }

  // Ativar o webhook (01) se não estiver ativo
  const wf01 = data.data.find(w => w.name.includes('01 -'));
  if (wf01 && !wf01.active) {
    await fetch(`${N8N_API_URL}/workflows/${wf01.id}/activate`, {
      method: 'POST', headers
    });
    logDetail('→ Ativei o webhook router (01)');
  }

  return true;
}

// ─── Step 3: Enviar mensagem simulada ───────────────────

async function sendTestMessage(messageText, testName) {
  log('💬', `STEP 3: Enviando mensagem de teste: "${messageText}" [${testName}]`);

  // Payload que simula a Evolution API enviando uma mensagem do WhatsApp
  const payload = {
    event: "messages.upsert",
    instance: "goldstar",
    data: {
      key: {
        remoteJid: "5591999990001@s.whatsapp.net",
        fromMe: false,
        id: `TEST_${Date.now()}`
      },
      pushName: "Teste Gold Star",
      messageType: "conversation",
      message: {
        conversation: messageText
      }
    },
    sender: "5591999990001@s.whatsapp.net"
  };

  // O webhook do n8n espera o payload no body
  // A Evolution API v2 envia como body direto
  const webhookPayload = {
    body: {
      event: payload.event,
      instance: payload.instance,
      data: payload.data,
      sender: payload.sender
    }
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });

    const statusText = res.ok ? '✅ Aceito' : `⚠️ Status ${res.status}`;
    logDetail(`Webhook respondeu: ${statusText}`);

    try {
      const body = await res.text();
      if (body && body.length < 500) {
        logDetail(`Resposta: ${body}`);
      }
    } catch(e) {}

    return res.ok;
  } catch (err) {
    logDetail(`❌ Erro ao enviar: ${err.message}`);
    return false;
  }
}

// ─── Step 4: Verificar banco de dados ───────────────────

async function checkDatabase() {
  log('🗄️', 'STEP 4: Para verificar o banco, execute:');
  logDetail('docker exec upscribe-db psql -U postgres -d gold_star -c "SELECT * FROM users ORDER BY created_at DESC LIMIT 3;"');
  logDetail('docker exec upscribe-db psql -U postgres -d gold_star -c "SELECT id, user_id, current_state, state_payload FROM conversational_sessions ORDER BY created_at DESC LIMIT 3;"');
}

// ─── Main ───────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('   🧪  TESTE DO SISTEMA GOLD STAR (SEM OPENAI)');
  console.log('═══════════════════════════════════════════════');

  // Step 1: Deploy mock
  const mockOk = await deployMock();
  if (!mockOk) {
    console.log('\n❌ Falhou no deploy do mock. Abortando.');
    process.exit(1);
  }

  // Step 2: Check workflows
  await checkWorkflows();

  // Step 3: Aguardar um segundo para o n8n registrar o webhook
  logDetail('Aguardando n8n registrar webhooks...');
  await sleep(3000);

  // Step 3: Enviar mensagens de teste
  const tests = [
    { msg: 'Quero comprar uma passagem de Belém para Macapá dia 15/07', name: 'BUY_TICKET' },
    { msg: 'Qual o horário do próximo barco?', name: 'ASK_SCHEDULES' },
    { msg: 'Quanto custa a passagem?', name: 'ASK_PRICES' },
    { msg: 'Preciso falar com um atendente', name: 'HUMAN_HELP' },
    { msg: 'Boa noite!', name: 'OTHER' }
  ];

  // Enviar apenas o primeiro teste para não sobrecarregar
  const sent = await sendTestMessage(tests[0].msg, tests[0].name);

  if (sent) {
    await sleep(2000);
    log('✅', 'Mensagem enviada com sucesso ao webhook!');
    logDetail('O workflow 01 deve ter recebido, processado e chamado o mock da IA.');
  }

  // Step 4: Instruções para verificar DB
  await checkDatabase();

  console.log('\n═══════════════════════════════════════════════');
  console.log('   📋  TESTES ADICIONAIS (copie e cole no terminal)');
  console.log('═══════════════════════════════════════════════');
  console.log(`
  # Testar intenção ASK_SCHEDULES:
  curl -s -X POST ${WEBHOOK_URL} \\
    -H "Content-Type: application/json" \\
    -d '{"body":{"event":"messages.upsert","instance":"goldstar","data":{"key":{"remoteJid":"5591999990002@s.whatsapp.net","fromMe":false,"id":"TEST2"},"pushName":"Maria Teste","messageType":"conversation","message":{"conversation":"Qual o horário do próximo barco para Santarém?"}},"sender":"5591999990002@s.whatsapp.net"}}'

  # Testar intenção HUMAN_HELP:
  curl -s -X POST ${WEBHOOK_URL} \\
    -H "Content-Type: application/json" \\
    -d '{"body":{"event":"messages.upsert","instance":"goldstar","data":{"key":{"remoteJid":"5591999990003@s.whatsapp.net","fromMe":false,"id":"TEST3"},"pushName":"João Teste","messageType":"conversation","message":{"conversation":"Quero falar com um atendente humano"}},"sender":"5591999990003@s.whatsapp.net"}}'
  `);

  console.log('═══════════════════════════════════════════════');
  console.log('   🎉  Teste concluído!');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
