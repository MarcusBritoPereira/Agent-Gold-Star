const { loadEnv } = require('./scripts/lib/config');
loadEnv();
const webhook = `${(process.env.N8N_WEBHOOK_URL || 'http://localhost:5678').replace(/\/$/, '')}/webhook/whatsapp-webhook`;

async function send(message, id = `TEST-${Date.now()}`) {
  const payload = { event: 'messages.upsert', instance: process.env.EVOLUTION_INSTANCE || 'goldstar', data: { key: { remoteJid: '5591999990001@s.whatsapp.net', fromMe: false, id }, pushName: 'Cliente Teste', messageType: 'conversation', message: { conversation: message } }, sender: '5591999990001@s.whatsapp.net' };
  const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`webhook returned ${response.status}: ${await response.text()}`);
  console.log(`accepted ${id}: ${message}`);
}

send(process.argv.slice(2).join(' ') || 'Quero comprar uma passagem de Manaus para Careiro dia 15/07/2026').catch((error) => { console.error(error.message); process.exitCode = 1; });
