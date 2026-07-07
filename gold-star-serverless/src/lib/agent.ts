import { generateText, CoreMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { prisma } from './db';
import { sendWhatsAppMessage } from './whatsapp';
import axios from 'axios';

const SYSTEM_PROMPT = `Você é um atendente humano e paciente de vendas de passagens hidroviárias da empresa Gold Star. Você atende todo tipo de público, então sua linguagem deve ser simples, direta, educada e SEM termos técnicos. Aja como um humano real conversando no WhatsApp.

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
10. Detalhe e apresente os valores detalhadamente (Passagem, Tarifa de Embarque e Total), mostrando sempre a soma total.

FLUXO DE VENDAS OBRIGATÓRIO:
1. Colete a Origem e Destino com empatia.
2. Chame buscar_rotas com a origem. Apresente as opções de horários e preços.
3. Pergunte a data.
4. Chame consultar_assentos. Liste poltronas disponíveis e peça para escolher.
5. Guarde a poltrona.
6. Peça Nome, CPF e Data de Nascimento.
7. Apresente o resumo da reserva e peça confirmação.
8. Após confirmação, chame gerar_pagamento.
9. Envie o link de pagamento ou PIX retornado pela API.`;

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
      buscar_rotas: {
        description: 'Busca as rotas e viagens disponíveis a partir de uma origem e destino.',
        parameters: z.object({
          origem: z.string().describe('Nome da cidade de origem (ex: Santarém, Almeirim)'),
          destino: z.string().describe('Nome da cidade de destino').optional(),
        }),
        execute: async ({ origem, destino }) => {
          try {
            const routes = await prisma.routes.findMany({
              where: {
                origin: { contains: origem, mode: 'insensitive' },
                ...(destino ? { destination: { contains: destino, mode: 'insensitive' } } : {})
              },
              select: {
                id: true,
                origin: true,
                destination: true,
                week_day: true,
                hour: true,
                speed_boat_price: true,
                tax: true
              }
            });
            const serializedRoutes = routes.map(r => ({
              ...r,
              id: r.id.toString(),
              speed_boat_price: r.speed_boat_price?.toString(),
              tax: r.tax?.toString()
            }));
            return { rotas_disponiveis: serializedRoutes };
          } catch (error: any) {
            console.error('Prisma Error buscar_rotas:', error.message);
            return { error: 'Erro ao consultar rotas no sistema.' };
          }
        },
      },
      consultar_assentos: {
        description: 'Consulta as poltronas disponíveis para uma viagem específica em uma data.',
        parameters: z.object({
          routeId: z.string().describe('O ID numérico da rota'),
          data: z.string().describe('Data da viagem no formato YYYY-MM-DD'),
        }),
        execute: async ({ routeId, data }) => {
          try {
            // Find the master trip for this route and date
            const trip = await prisma.trips.findFirst({
              where: {
                master_route_id: BigInt(routeId),
                date: new Date(data)
              }
            });

            if (!trip) {
              return { error: 'Viagem não encontrada para esta data. Solicite outra data.' };
            }

            // Find all reserved seats
            const reservedSeats = await prisma.trip_seats.findMany({
              where: {
                trip_id: trip.id,
                status: 1 // 1 means reserved/occupied
              },
              select: { number: true }
            });

            const occupiedNumbers = reservedSeats.map(s => s.number);
            
            // Assume the boat has 50 seats for now
            const totalSeats = 50;
            const available = [];
            for (let i = 1; i <= totalSeats; i++) {
              if (!occupiedNumbers.includes(i)) {
                available.push(i);
              }
            }

            return { 
              trip_id: trip.id.toString(),
              assentos_livres: available.slice(0, 10), // return top 10 to not overwhelm AI
              mensagem: `Existem ${available.length} assentos livres. Os primeiros são: ${available.slice(0,10).join(', ')}`
            };
          } catch (error: any) {
            console.error('Prisma Error consultar_assentos:', error.message);
            return { error: 'Erro ao consultar poltronas no sistema.' };
          }
        },
      },
      gerar_pagamento: {
        description: 'Gera a cobrança no sistema oficial Embarcar. Chama esta função APÓS o cliente confirmar os dados da viagem e poltrona.',
        parameters: z.object({
          routeId: z.string().describe('O ID numérico da rota selecionada'),
          tripId: z.string().describe('O ID numérico da viagem selecionada retornado em consultar_assentos'),
          origem: z.string(),
          destino: z.string(),
          data_viagem: z.string(),
          price: z.number().describe('Valor total da passagem (sem taxa)'),
          tax: z.number().describe('Valor da taxa de embarque'),
          seat: z.number().describe('Número da poltrona escolhida'),
          nome: z.string(),
          cpf: z.string(),
          telefone: z.string(),
        }),
        execute: async ({ routeId, tripId, origem, destino, data_viagem, price, tax, seat, nome, cpf, telefone }) => {
          try {
            const rId = BigInt(routeId);
            const tId = BigInt(tripId);
            
            // 1. Criar Asaas payment (Mock for now, should call Asaas API)
            // Here we need to call Asaas directly to generate PIX copy-paste
            const asaasPayload = {
              customer: "cus_000000000000", // Would be real customer ID
              billingType: "PIX",
              value: Number(price) + Number(tax),
              dueDate: new Date().toISOString().split('T')[0],
              description: `Passagem: ${origem} -> ${destino}`
            };
            
            const asaasResponse = await axios.post('https://sandbox.asaas.com/api/v3/payments', asaasPayload, {
              headers: {
                'access_token': process.env.ASAAS_API_KEY || '$aact_...',
                'Content-Type': 'application/json'
              }
            }).catch(e => null);
            
            const asaasId = asaasResponse?.data?.id || 'pay_mock_' + Math.floor(Math.random()*10000);
            const pixCode = asaasResponse?.data?.pixCopyPaste || '00020101021126580014br.gov.bcb.pix...';

            // 2. Create Order in Database
            const order = await prisma.orders.create({
              data: {
                route_id: rId,
                asaas_id: asaasId,
                created_at: new Date(),
                updated_at: new Date(),
                status: 'pending',
                code: `AI-${Math.floor(Math.random()*100000)}`,
                date: new Date(data_viagem),
                origin: origem,
                destination: destino,
                username: nome,
                emergency_contact_name: nome,
                emergency_contact_phone: telefone,
                tax: tax,
                full_price: price,
                price: price
              }
            });

            // 3. Create Order Customer
            const orderCustomer = await prisma.order_customers.create({
              data: {
                order_id: order.id,
                customer_id: 1, // Fallback customer ID for now, ideally find or create real customer
                issuer_id: 1,   // Fallback issuer ID
                ticket_price: price,
                tax_price: tax,
                seat_number: seat,
                trip_id: tId,
                status: 1
              }
            });

            // 4. Reserve the seat
            await prisma.trip_seats.create({
              data: {
                status: 1, // 1 = reserved
                number: seat,
                created_at: new Date(),
                updated_at: new Date(),
                trip_id: tId,
                order_customer_id: orderCustomer.id,
                route_id: rId
              }
            });

            return { 
              sucesso: true, 
              mensagem: 'Reserva criada com sucesso!',
              pix_copia_e_cola: pixCode,
              order_code: order.code,
              instrucoes: 'Por favor, realize o pagamento via PIX Copia e Cola acima. Assim que for confirmado, enviaremos o bilhete.'
            };
          } catch (error: any) {
            console.error('Prisma Error gerar_pagamento:', error.message);
            return { error: 'Erro ao gerar pedido no sistema.' };
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
