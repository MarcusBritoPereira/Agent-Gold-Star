const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const port = 18090;
let child;
test.before(async () => {
  child = spawn(process.execPath, ['mock-server/server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let attempt=0; attempt<40; attempt++) {
    try { const response=await fetch(`http://127.0.0.1:${port}/health`); if(response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('mock server did not become healthy');
});
test.after(() => child?.kill());

test('mock backend supports route, order, allocation and WhatsApp contracts', async () => {
  const routes = await fetch(`http://127.0.0.1:${port}/api/routes/available_seats/?origin=Manaus&destination=Careiro`).then((response) => response.json());
  assert.equal(routes.trip.id, 'trip-manaus-careiro-0800');
  const order = await fetch(`http://127.0.0.1:${port}/api/orders/create`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({trip_id:routes.trip.id,customer:{name:'Teste'}}) }).then((response) => response.json());
  assert.ok(order.id); assert.match(order.payment_link, /\/pay\//);
  const allocation = await fetch(`http://127.0.0.1:${port}/orders/seats/${order.id}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({seat_numbers:['1A']}) });
  assert.equal(allocation.status, 200);
  const sent = await fetch(`http://127.0.0.1:${port}/message/sendText/goldstar`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({number:'5599999999999',text:'teste'}) });
  assert.equal(sent.status, 200);
  const messages = await fetch(`http://127.0.0.1:${port}/_test/messages`).then((response) => response.json());
  assert.equal(messages.at(-1).text, 'teste');
});
