const http = require('node:http');
const { randomUUID } = require('node:crypto');

const port = Number(process.env.PORT || 8090);
const messages = [];
const alerts = [];
const orders = new Map();
const trips = [
  { id: 'trip-manaus-careiro-0800', route_id: 'route-manaus-careiro', origin: 'Manaus', destination: 'Careiro', departure_time: '08:00', price_cents: 5000, available_seats: 3, available_seat_numbers: ['1A', '1B', '2A'] },
  { id: 'trip-manaus-parintins-0700', route_id: 'route-manaus-parintins', origin: 'Manaus', destination: 'Parintins', departure_time: '07:00', price_cents: 15000, available_seats: 2, available_seat_numbers: ['3A', '3B'] }
];
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); }
async function body(request) { const chunks=[]; for await (const chunk of request) chunks.push(chunk); const raw=Buffer.concat(chunks).toString(); return raw ? JSON.parse(raw) : {}; }
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' });
  if (request.method === 'GET' && url.pathname === '/api/routes/show/') {
    const origin=normalize(url.searchParams.get('origin')); const destination=normalize(url.searchParams.get('destination'));
    return json(response, 200, trips.filter((trip) => (!origin || normalize(trip.origin).includes(origin)) && (!destination || normalize(trip.destination).includes(destination))));
  }
  if (request.method === 'GET' && url.pathname === '/api/routes/available_seats/') {
    const origin=normalize(url.searchParams.get('origin')); const destination=normalize(url.searchParams.get('destination'));
    const matching=trips.filter((trip) => {
      const tripOrg = normalize(trip.origin);
      const tripDest = normalize(trip.destination);
      return (!origin || tripOrg.includes(origin) || origin.includes(tripOrg)) &&
             (!destination || tripDest.includes(destination) || destination.includes(tripDest));
    });
    return json(response, 200, { trips: matching, trip: matching[0] || null });
  }
  if (request.method === 'POST' && url.pathname === '/api/orders/create') {
    const input = await body(request);
    const id = input.external_reference || randomUUID();
    let paymentLink = `http://localhost:${port}/pay/${id}`;
    let customerId = randomUUID();

    const asaasKey = process.env.ASAAS_API_KEY;
    if (asaasKey && asaasKey !== 'change-me') {
      try {
        const isSandbox = asaasKey.startsWith('$aact_hmlg_');
        const asaasUrl = isSandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://www.asaas.com/api/v3';

        // 1. Create customer
        const custRes = await fetch(`${asaasUrl}/customers`, {
          method: 'POST',
          headers: { 'access_token': asaasKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.customer?.name || 'Cliente Gold Star',
            cpfCnpj: input.customer?.cpf || '',
            phone: input.customer?.phone || ''
          })
        });
        const custData = await custRes.json();
        if (custRes.ok && custData.id) {
          customerId = custData.id;
          
          // 2. Create payment
          const payRes = await fetch(`${asaasUrl}/payments`, {
            method: 'POST',
            headers: { 'access_token': asaasKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer: customerId,
              billingType: 'PIX',
              value: (input.price_cents || 5000) / 100,
              dueDate: new Date(Date.now() + 86400000).toISOString().split('T')[0],
              description: `Passagem: ${input.origin || ''} -> ${input.destination || ''}`,
              externalReference: id
            })
          });
          const payData = await payRes.json();
          if (payRes.ok && payData.invoiceUrl) {
            paymentLink = payData.invoiceUrl;
            console.log(`Real Asaas payment link created: ${paymentLink}`);
          } else {
            console.error('Failed to create Asaas payment, falling back to mock:', payData);
          }
        } else {
          console.error('Failed to create Asaas customer, falling back to mock:', custData);
        }
      } catch (err) {
        console.error('Asaas API integration error, falling back to mock:', err.message);
      }
    }

    const order = { id, ...input, payment_link: paymentLink, customers: [{ id: customerId, name: input.customer?.name }] };
    orders.set(id, order);
    return json(response, 201, order);
  }
  const seatMatch=url.pathname.match(/^\/orders\/seats\/([^/]+)$/);
  if (seatMatch && request.method === 'POST') { const order=orders.get(seatMatch[1]); if(!order) return json(response,404,{error:'order_not_found'}); order.allocation=await body(request); return json(response,200,{ok:true,order_id:seatMatch[1]}); }
  if (seatMatch && request.method === 'GET') { const order=orders.get(seatMatch[1]); return order ? json(response,200,order) : json(response,404,{error:'order_not_found'}); }
  if (request.method === 'POST' && /^\/message\/sendText\//.test(url.pathname)) { const input=await body(request); messages.push({...input,sent_at:new Date().toISOString()}); return json(response,200,{key:{id:randomUUID()},message:input}); }
  if (request.method === 'POST' && url.pathname === '/alerts') { alerts.push(await body(request)); return json(response,200,{ok:true}); }
  if (request.method === 'GET' && url.pathname === '/_test/messages') return json(response,200,messages);
  if (request.method === 'GET' && url.pathname === '/_test/alerts') return json(response,200,alerts);
  if (request.method === 'GET' && url.pathname.startsWith('/orders/')) return json(response,200,{voucher:true,order_id:url.pathname.split('/').pop()});
  json(response,404,{error:'not_found',path:url.pathname});
});
server.listen(port, '0.0.0.0', () => console.log(`Gold Star mock API listening on ${port}`));
