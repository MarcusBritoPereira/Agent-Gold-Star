# Arquitetura do sistema Gold Star

## Objetivo

O sistema automatiza a consulta e a venda de passagens hidroviárias pelo WhatsApp. A jornada é: mensagem recebida, identificação da intenção, coleta progressiva dos dados, consulta de disponibilidade, criação do pedido, pagamento, alocação da poltrona e envio do voucher.

## Componentes

- **n8n:** orquestra os oito workflows em `workflows/`.
- **PostgreSQL:** usuários, sessões, transições, deduplicação de mensagens e eventos de pagamento.
- **Evolution API:** único gateway adotado para entrada e saída do WhatsApp.
- **OpenAI:** classificador opcional em modo `live`; o modo padrão `mock` permite desenvolvimento sem custo externo.
- **Backend operacional:** adaptador configurável para viagens, assentos, pedidos e vouchers.
- **Asaas:** entrega eventos ao webhook autenticado de pagamento.
- **Receptor de alertas:** endpoint configurável para falhas do n8n.

Toda configuração sensível é fornecida por variáveis de ambiente documentadas em `.env.example`.

## Máquina de estados

`START → COLLECTING_TRIP → COLLECTING_PASSENGER → CREATING_PAYMENT → EXPECTING_PAYMENT → PAID → COMPLETED`

Estados alternativos: `PAYMENT_EXPIRED`, `HUMAN_HANDOFF` e `FAILED`. A intenção fica separada do estado da conversa, e as entidades extraídas são mescladas em `state_payload` para permitir mensagens fragmentadas.

## Workflows

1. **WhatsApp Incoming Router:** normaliza o evento, ignora mensagens próprias, deduplica pelo ID, cria/atualiza o usuário, recupera uma sessão ativa e chama o classificador.
2. **IA Intent Detection:** usa classificador real ou mock, valida a saída estruturada, mescla entidades e encaminha para venda, consulta ou atendimento humano.
3. **Consulta Operacional:** consulta o backend e formata até cinco opções de horário/preço.
4. **Fluxo de Venda:** identifica campos ausentes, coleta dados progressivamente, consulta viagem e escolhe somente uma poltrona informada como disponível.
5. **Pagamento Asaas:** cria o pedido, persiste `order_id` e envia o link pelo WhatsApp.
6. **Webhook Asaas:** autentica, deduplica, processa aprovação/expiração e dispara a entrega.
7. **Confirmação de Compra:** aloca a poltrona, conclui a sessão e envia o voucher.
8. **Monitoramento:** remove dados sensíveis do alerta e entrega o erro a um endpoint configurável.

A comunicação entre workflows usa webhooks internos estáveis, em vez de IDs de workflow específicos de uma instalação.

## Banco de dados

As migrations em `db/migrations/` criam:

- `users` e `conversational_sessions`;
- `inbound_events` para idempotência de mensagens;
- `payment_events` para idempotência de pagamentos;
- `conversation_transitions` para auditoria;
- `routes`, `trips`, `seats`, `bookings` e `tickets` para operação local ou espelhamento.

`seed_data.sql` é opcional e idempotente; ele não apaga dados operacionais.

## Modos de execução

### Mock

É o padrão do Compose. `mock-server/server.js` implementa o contrato mínimo do backend e captura mensagens/alertas, possibilitando testes seguros.

### Live

Requer credenciais válidas e a configuração dos serviços externos descrita no README. Segredos nunca devem ser inseridos nos JSONs ou scripts.

## Limites de responsabilidade

O repositório fornece a camada de orquestração e um backend simulado. Em produção, disponibilidade, retenção temporária da poltrona, cobrança e voucher dependem do backend operacional contratado. A homologação real exige credenciais de sandbox/produção e uma URL pública HTTPS para os webhooks.
