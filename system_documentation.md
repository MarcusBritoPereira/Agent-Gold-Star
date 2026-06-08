# Documentação do Sistema de Automação Gold Star

Esta documentação descreve a arquitetura, os componentes, as ferramentas e as integrações do sistema de venda e reserva de passagens da **Gold Star**.

---

## 1. Banco de Dados (PostgreSQL)

O banco de dados armazena dados de usuários, sessões de chat, rotas locais e reservas.

* **Servidor local:** PostgreSQL rodando no container Docker `upscribe-db` (porta física `5432`).
  > *Nota de infraestrutura:* O container do banco de dados compartilha o nome `upscribe-db` por questões de ambiente local de desenvolvimento, mas o banco de dados dedicado a este projeto chama-se especificamente **`gold_star`**.
* **Nome do Banco de Dados:** `gold_star`
* **Usuário:** `postgres`
* **Senha:** `postgres`
* **Tabelas Principais:**
  * `users`: Cadastro de passageiros (telefone, CPF, nome completo).
  * `conversational_sessions`: Guarda o estado atual da conversa do chatbot (`START`, `EXPECTING_PAYMENT`, `PAID`, `COMPLETED`, `HUMAN_FALLBACK`) e o payload temporário com os dados da reserva.
  * `routes`, `trips`, `seats`, `bookings`, `tickets`: Tabelas locais para espelhar ou processar dados da viagem.

---

## 2. Evolution API (WhatsApp)

A **Evolution API** é utilizada como gateway para conectar a conta do WhatsApp e gerenciar o envio/recebimento de mensagens.

* **Servidor local:** Docker container `evolution-api` (porta física `8088`).
* **Interface do Gerenciador (Manager):** http://localhost:8088/manager
* **Chave de Autenticação (API Key Global):** `gold_star_api_key_123`
* **Nome da Instância:** `goldstar`
* **Configuração de Webhook:** A instância está configurada para encaminhar todas as mensagens recebidas (`MESSAGES_UPSERT`) para o webhook do n8n em:
  `http://host.docker.internal:5678/webhook/whatsapp-webhook`

---

## 3. n8n (Orquestrador de Workflows)

O **n8n** executa os fluxos de trabalho que recebem as mensagens do WhatsApp, detectam a intenção do usuário, consultam a API externa, integram pagamentos e realizam a emissão do bilhete.

* **Servidor local:** Docker container `n8n` (porta física `5678`).
* **Chave de API do n8n:** Configurada localmente para deploy via scripts.
* **Workflows Deploiados (8 fluxos ativos):**
  1. `01 - WhatsApp Incoming Router`: Recebe a mensagem do WhatsApp, valida o usuário no banco `gold_star`, abre/recupera sessão e encaminha para classificação ou fluxo específico.
  2. `02 - IA Intent Detection`: Envia a mensagem à OpenAI para classificar a intenção e extrair dados da viagem.
  3. `03 - Consulta Operacional`: Processa perguntas sobre horários e rotas.
  4. `04 - Fluxo de Venda`: Verifica se os dados da compra estão completos, checa assentos disponíveis na API da Gold Star e direciona para o pagamento.
  5. `05 - Pagamento Asaas`: Envia os dados para a API externa, cria o pedido no Heroku e gera o link de pagamento.
  6. `06 - Webhook Asaas`: Recebe confirmações de pagamento da Asaas e inicia a entrega.
  7. `07 - Confirmação de Compra`: Reserva os assentos na API externa após pagamento e envia o voucher final no WhatsApp do cliente.
  8. `08 - Monitoramento`: Monitora erros nos workflows e envia alertas (ex: Slack).

---

## 4. Integração de IA (OpenAI)

* **Modelo:** `gpt-4o-mini` (API da OpenAI).
* **Finalidade:** Classificar a mensagem do usuário nas intenções:
  * `BUY_TICKET` (Comprar passagem)
  * `ASK_SCHEDULES` (Consultar horários)
  * `ASK_PRICES` (Consultar preços)
  * `HUMAN_HELP` (Atendimento humano)
  * `OTHER`
* **Extração de Entidades:** Extrai termos como origem, destino, data de viagem, nome do passageiro e CPF diretamente da mensagem de texto.

---

## 5. API Backend Externa (Heroku)

* **Host Base:** `https://embarcar-e83ea296df06.herokuapp.com`
* **Endpoints Utilizados:**
  * `GET /api/routes/`: Listagem de origens e destinos.
  * `GET /api/routes/show/`: Busca de rotas detalhadas.
  * `GET /api/routes/available_seats/`: Consulta de mapa de assentos e quantidade disponível.
  * `POST /api/orders/create`: Criação do pedido (Checkout).
  * `POST /orders/seats/{order_id}`: Seleção/alocação de poltronas pós-pagamento.
  * `GET /orders/{id}`: Link do voucher impresso enviado ao cliente.
