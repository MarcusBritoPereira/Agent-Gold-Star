import { generateText, CoreMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { prisma } from './db';
import { sendWhatsAppMessage } from './whatsapp';
import axios from 'axios';

const SYSTEM_PROMPT = `Você é o assistente virtual oficial da Gold Star, uma empresa de transporte fluvial (lanchas rápidas) na Amazônia. 
A Gold Star opera EXCLUSIVAMENTE com lanchas. NUNCA fale que a viagem é de navio, barco, balsa ou ferry. Use sempre o termo 'lancha'.

DIRETRIZES CRÍTICAS (SOB PENA DE DESLIGAMENTO):
- É ESTRITAMENTE PROIBIDO INVENTAR, ADIVINHAR OU LEMBRAR de viagens, datas, preços ou poltronas.
- Você DEVE SEMPRE chamar as ferramentas (listar_cidades, buscar_rotas, consultar_assentos) para obter os dados em tempo real.
- MESMO QUE O CLIENTE DIGA "QUERO VIAJAR SEXTA", VOCÊ NÃO PODE CONFIRMAR SEM ANTES CHAMAR "buscar_rotas" PARA VERIFICAR SE EXISTE VIAGEM NESSA DATA.
- SE VOCÊ NÃO USOU UMA FERRAMENTA NESTE EXATO ATENDIMENTO PARA BUSCAR A INFORMAÇÃO, VOCÊ NÃO A TEM!

Regras de Atendimento:
Você é um atendente humano e paciente de vendas de passagens hidroviárias da empresa Gold Star. Você atende todo tipo de público, então sua linguagem deve ser simples, direta, educada e SEM termos técnicos. Aja como um humano real conversando no WhatsApp.

REGRAS CRÍTICAS DE UX:
1. A Gold Star opera EXCLUSIVAMENTE com lanchas (lanchas rápidas). NUNCA fale que a viagem é de navio, barco, balsa, balsa rápida ou ferry. Use sempre o termo 'lancha'.
2. NÃO USE EMOJIS. Responda de forma natural e madura, sem exagerar na animação. Zero emojis.
3. NUNCA peça para o usuário digitar informações em um formato específico (como AAAA-MM-DD ou incluir traços no CPF). Faça perguntas naturais (ex: "Qual dia você prefere viajar?", "Qual é a sua data de nascimento?"). VOCÊ (a IA) é quem deve formatar a data por trás dos panos antes de chamar as ferramentas.
4. Faça uma pergunta por vez. Não sobrecarregue o usuário com listas longas de perguntas.
5. Se o cliente falar datas relativas ("amanhã", "próxima segunda"), deduza a data exata com base no dia de hoje e converta para YYYY-MM-DD antes de consultar as ferramentas.
6. Limpe caracteres especiais do CPF silenciosamente.
7. NUNCA use links em formato Markdown (ex: [Texto](link)). O WhatsApp não renderiza esse formato. Envie o link de pagamento puro e de forma clara.
8. NUNCA selecione uma poltrona/assento automaticamente para o cliente. Você deve listar as poltronas disponíveis obtidas da ferramenta e pedir para o cliente escolher explicitamente.
9. NUNCA confirme a passagem antes do pagamento. Sempre use o termo 'reserva' e informe que a poltrona ficará reservada aguardando pagamento. Avise que após o pagamento aprovado o bilhete será enviado automaticamente.
11. OBRIGATÓRIO: Ao listar opções de viagens, inclua os IDs (route_id, trip_id) discretamente.
12. OBRIGATÓRIO: NUNCA pule direto para gerar_pagamento sem antes ter validado a viagem (buscar_rotas) e a poltrona (consultar_assentos).

FLUXO DE VENDAS (NÃO PULE ETAPAS):
PASSO 1: O cliente diz "Olá" ou "Quero viajar". Você CHAMA A FERRAMENTA listar_cidades (sem parâmetros) e pergunta a origem, listando as origens recebidas da ferramenta.
PASSO 2: O cliente escolhe a origem. Você CHAMA A FERRAMENTA listar_cidades (passando a origem) e pergunta o destino, listando os destinos recebidos.
PASSO 3: O cliente escolhe o destino. Você CHAMA A FERRAMENTA buscar_rotas e lista EXATAMENTE as datas que a ferramenta retornou (mantendo o ID Rota visível).
PASSO 4: O cliente escolhe a data. Você CHAMA A FERRAMENTA consultar_assentos (repassando o ID Rota lido) e lista EXATAMENTE as poltronas disponíveis. (Nota: Se o usuário já enviar a poltrona escolhida junto com a data, pule este passo e vá direto para o Passo 5 sem chamar a ferramenta).
PASSO 5: O cliente escolhe a poltrona. Peça Nome, CPF e Data de Nascimento.
PASSO 6: O cliente informa os dados. Mostre o resumo e pergunte como ele quer pagar: "PIX ou Cartão de Crédito?".
PASSO 7: O cliente escolhe a forma de pagamento. Você CHAMA A FERRAMENTA gerar_pagamento repassando a forma_pagamento e envia o link.`;

const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';

export async function processChat(sessionId: string, phoneNumber: string, userMessage: string) {
  let session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { messages: { orderBy: { createdAt: 'asc' } } }
  });

  if (!session) {
    let user = await prisma.user.findUnique({ where: { phone: phoneNumber } });
    if (!user) {
      user = await prisma.user.create({ data: { phone: phoneNumber } });
    }
    
    session = await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        messages: {
          create: [{ role: 'system', content: `[Contexto: Hoje é ${new Date().toLocaleDateString('pt-BR')} (Horário de Brasília)]\n\n${SYSTEM_PROMPT}` }]
        }
      },
      include: { messages: true }
    });
  }

  if (['olá', 'ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'quero viajar'].includes(userMessage.trim().toLowerCase())) {
    await prisma.message.deleteMany({
      where: { sessionId: session.id, role: { not: 'system' } }
    });
  }

  await prisma.message.create({
    data: { sessionId: session.id, role: 'user', content: userMessage }
  });

  const allMessages = await prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: 'asc' }
  });

  const coreMessages: CoreMessage[] = allMessages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content
  }));

  const result = await generateText({
    model: openai('gpt-4o-mini'),
    messages: coreMessages,
    tools: {
      listar_cidades: {
        description: 'Lista as cidades de origem ou destino disponíveis. Se não passar parâmetros, retorna todas as origens. Se passar a origem, retorna os destinos válidos para aquela origem.',
        parameters: z.object({
          origem: z.string().describe('Nome da cidade de origem escolhida pelo cliente').optional(),
        }),
        execute: async ({ origem }) => {
          try {
            if (origem) {
               const routes = await prisma.routes.findMany({ 
                 where: { origin: { contains: origem, mode: 'insensitive' } }, 
                 select: { destination: true } 
               });
               const destinos = [...new Set(routes.map(r => r.destination))];
               return { destinos_disponiveis: destinos };
            } else {
               const routes = await prisma.routes.findMany({ select: { origin: true } });
               const origens = [...new Set(routes.map(r => r.origin))];
               return { origens_disponiveis: origens };
            }
          } catch (error: any) {
            console.error('API Error listar_cidades:', error.message);
            return { error: 'Erro ao buscar cidades no sistema.' };
          }
        },
      },
      buscar_rotas: {
        description: 'Busca as próximas viagens disponíveis a partir de uma origem e destino. Retorna as datas (com formatação amigável), horários, preços e IDs (route_id e trip_id).',
        parameters: z.object({
          origem: z.string().describe('Nome da cidade de origem (ex: Santarém)'),
          destino: z.string().describe('Nome da cidade de destino').optional(),
        }),
        execute: async ({ origem, destino }) => {
          try {
            const routes = await prisma.routes.findMany({
              where: {
                origin: { contains: origem, mode: 'insensitive' },
                ...(destino ? { destination: { contains: destino, mode: 'insensitive' } } : {}),
                active: true
              }
            });
            if (routes.length === 0) return { error: 'Nenhuma rota cadastrada para este trecho.' };
            
            const diasSemana: Record<string, number> = {
              'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
              'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
            };
            
            let viagensFormatadas: any[] = [];
            
            routes.forEach(r => {
              if (!r.week_day || diasSemana[r.week_day] === undefined) return;
              const targetDay = diasSemana[r.week_day];
              
              let d = new Date();
              d.setUTCHours(12, 0, 0, 0);
              
              // Find the next occurrence
              while (d.getUTCDay() !== targetDay) {
                d.setUTCDate(d.getUTCDate() + 1);
              }
              
              // Generate the next 4 trips for this route
              for (let i = 0; i < 4; i++) {
                const nextDate = new Date(d);
                nextDate.setUTCDate(d.getUTCDate() + (i * 7));
                
                const day = String(nextDate.getUTCDate()).padStart(2, '0');
                const month = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
                const year = nextDate.getUTCFullYear();
                const dataIso = `${year}-${month}-${day}`;
                
                viagensFormatadas.push({
                  route_id: r.id.toString(),
                  trip_id: 'auto-generated', // Will be auto-corrected in gerar_pagamento
                  origin: r.origin,
                  destination: r.destination,
                  date: dataIso,
                  hour: r.hour ? r.hour.toISOString().substring(11, 16) : '08:00',
                  price: r.speed_boat_price ? Number(r.speed_boat_price) : 0,
                  tax: r.tax ? Number(r.tax) : 0,
                  data_formatada: `${day}/${month}/${year} - ${r.week_day} (ID Rota: ${r.id})`
                });
              }
            });
            
            // Sort by date ascending
            viagensFormatadas.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
            // Return top 10 options
            return { viagens_disponiveis: viagensFormatadas.slice(0, 10) };
          } catch (error: any) {
            console.error('API Error buscar_rotas:', error.message);
            return { error: 'Erro ao consultar viagens no sistema.' };
          }
        },
      },
      consultar_assentos: {
        description: 'Consulta as poltronas disponíveis para uma viagem específica em uma data.',
        parameters: z.object({
          routeId: z.string().describe('O ID numérico da rota (route_id)'),
          data: z.string().describe('Data da viagem no formato YYYY-MM-DD'),
        }),
        execute: async ({ routeId, data }) => {
          console.log("TOOL CALL - consultar_assentos:", { routeId, data });
          try {
            const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
              params: { route_id: routeId, date: data, web: 'true' }
            });
            
            if (response.data.status === 'error') {
               return { error: response.data.message || 'Viagem não encontrada.' };
            }

            const available = response.data.available_seat_numbers || [];
            
            return { 
              assentos_livres: available,
              mensagem: available.length > 0 ? `Existem ${available.length} assentos livres. Os assentos são: ${available.join(', ')}` : 'Nenhum assento disponível.'
            };
          } catch (error: any) {
            console.error('API Error consultar_assentos:', error.response?.data || error.message);
            if (error.response?.status === 404) {
               return { error: 'Viagem não encontrada para a data informada. Verifique se a data escolhida cai no dia da semana correto para esta rota.' };
            }
            return { error: 'Erro ao consultar poltronas no sistema.' };
          }
        },
      },
      gerar_pagamento: {
        description: 'Gera a cobrança no sistema oficial Embarcar. Chama esta função APÓS o cliente confirmar os dados.',
        parameters: z.object({
          routeId: z.string().describe('O route_id da rota selecionada'),
          tripId: z.string().describe('O trip_id da viagem selecionada retornado na busca'),
          data_viagem: z.string().describe('Data da viagem (YYYY-MM-DD)'),
          price: z.number().describe('Valor da passagem (speed_boat_price)'),
          tax: z.number().describe('Valor da taxa (tax)'),
          seat: z.number().describe('Número da poltrona escolhida'),
          nome: z.string(),
          cpf: z.string(),
          telefone: z.string(),
          nascimento: z.string().describe('Data de nascimento (YYYY-MM-DD)'),
          forma_pagamento: z.enum(['PIX', 'CREDIT_CARD']).describe('Forma de pagamento escolhida pelo cliente')
        }),
        execute: async (params) => {
          console.log("TOOL CALL - gerar_pagamento:", params);
          const { routeId, tripId, data_viagem, price, tax, seat, nome, cpf, telefone, nascimento, forma_pagamento } = params;
          try {
            // Auto-correct trip_id by fetching the trip for the specific date
            let finalTripId = tripId;
            try {
              const tripResponse = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
                params: { route_id: routeId, date: data_viagem, web: 'true' }
              });
              if (tripResponse.data.trip?.id) {
                finalTripId = tripResponse.data.trip.id.toString();
              }
            } catch (e) {
              console.log('Failed to auto-correct tripId:', e);
            }

            const payload = {
              route_id: routeId,
              trip_id: finalTripId,
              date: data_viagem,
              payment_method: forma_pagamento,
              installment_count: 1,
              search_trip: "one_way",
              seat_numbers: [seat],
              name: nome,
              phone: telefone,
              customers: { "1": nome },
              documents: { "1": cpf },
              document_types: { "1": "cpf" },
              birthdays: { "1": nascimento },
              phones: { "1": telefone },
              data: JSON.stringify([
                { field: "speed_boat_price", quantity: 1, price: Number(price), tax: Number(tax) }
              ])
            };

            const response = await axios.post(`${API_BASE_URL}/orders/create`, payload, {
               headers: { 'Content-Type': 'application/json' }
            });

            if (response.data.status === 'ok' || response.data.status === 200 || response.status === 200) {
               return { 
                 sucesso: true, 
                 mensagem: 'Reserva criada com sucesso!',
                 payment_link: response.data.payment_link,
                 order_id: response.data.id,
                 instrucoes: 'Por favor, realize o pagamento acessando o link acima. Assim que for confirmado, enviaremos o bilhete.'
               };
            } else {
               return { error: response.data.message || 'Erro ao gerar pagamento.' };
            }
          } catch (error: any) {
            console.error('API Error gerar_pagamento:', error.response?.data || error.message);
            return { error: error.response?.data?.message || 'Erro ao gerar pedido no sistema. Verifique se a data, poltrona, preços e CPF estão corretos.' };
          }
        },
      }
    },
    maxSteps: 5,
  });

  if (result.text) {
    await prisma.message.create({
      data: { sessionId: session.id, role: 'assistant', content: result.text }
    });
    
    await sendWhatsAppMessage(phoneNumber, result.text);
  }
}
