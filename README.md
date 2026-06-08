# Gold Star — automação de venda de passagens

Automação conversacional para consultar e vender passagens hidroviárias pelo WhatsApp. O n8n coordena cadastro e sessão, classificação da mensagem, consulta de viagens, criação do pedido, confirmação de pagamento, alocação de poltrona e entrega do voucher.

## Início rápido local

Requisitos: Docker Compose, Node.js 20+ e uma chave de API criada no n8n para fazer deploy.

```bash
cp .env.example .env
# Troque POSTGRES_PASSWORD, N8N_ENCRYPTION_KEY e ASAAS_WEBHOOK_TOKEN.
docker compose up -d
```

1. Abra `http://localhost:5678`, conclua o cadastro inicial do n8n e crie uma credencial PostgreSQL apontando para `postgres:5432`.
2. Crie uma API key do n8n.
3. Preencha no `.env` `N8N_API_KEY` e `N8N_POSTGRES_CREDENTIAL_ID`.
4. Gere, valide, publique e ative:

```bash
npm run generate:workflows
npm run test:all
npm run deploy
npm run activate
```

O ambiente inicia em modo mock por padrão. A API local em `http://localhost:8090` simula rotas, pedidos, vouchers e o envio pelo WhatsApp, permitindo validar o fluxo sem cobrar clientes ou enviar mensagens reais.

## Teste de entrada

```bash
node test_system.js "Quero comprar uma passagem de Manaus para Careiro dia 15/07/2026"
```

Para acompanhar as mensagens que o mock recebeu:

```bash
curl http://localhost:8090/_test/messages
```

## Ativação de integrações reais

No `.env`:

- defina `AI_MODE=live` e informe `OPENAI_API_KEY`;
- aponte `BACKEND_BASE_URL` para o backend operacional e `PUBLIC_BACKEND_URL` para sua URL pública;
- aponte `EVOLUTION_API_URL` para a Evolution API e configure a instância indicada em `EVOLUTION_INSTANCE`;
- configure no Asaas o webhook público `https://SEU_N8N/webhook/asaas-payment` e use o mesmo token de `ASAAS_WEBHOOK_TOKEN`;
- aponte `ALERT_WEBHOOK_URL` para um receptor compatível com `{ "text": "..." }`.

A Evolution API é opcional no Compose e pode ser iniciada com:

```bash
docker compose --profile live-whatsapp up -d evolution-api
```

## Contrato do backend operacional

Para desacoplar os workflows de uma implementação específica, o backend deve fornecer:

- `GET /api/routes/show/?origin=&destination=&date=`: lista de viagens;
- `GET /api/routes/available_seats/?origin=&destination=&date=`: `{ "trip": {...}, "trips": [...] }`;
- `POST /api/orders/create`: pedido com `id` e `payment_link`;
- `POST /orders/seats/{order_id}`: confirma a alocação;
- `GET /orders/{order_id}`: voucher público.

Uma viagem deve conter `id`, `route_id`, `price_cents`, `available_seats` e `available_seat_numbers`.

## Segurança e operação

- Nenhum segredo deve ser versionado; `.env` é ignorado.
- As consultas dos workflows usam parâmetros posicionais.
- Eventos de WhatsApp e pagamento são idempotentes por identificador.
- O webhook de pagamento exige `asaas-access-token` ou `x-webhook-token` igual a `ASAAS_WEBHOOK_TOKEN`.
- O sistema não escolhe uma poltrona fixa: usa uma poltrona retornada como disponível pelo backend.
- Dados sensíveis não são incluídos nos alertas de erro.

## Comandos

```bash
npm run generate:workflows  # regenera os oito JSONs versionados
npm run validate            # invariantes estruturais e de segurança
npm test                    # testes unitários/contratuais
npm run deploy              # cria ou atualiza workflows pelo nome
npm run activate            # ativa somente os oito workflows Gold Star
CONFIRM_CLEANUP=yes npm run cleanup
```
