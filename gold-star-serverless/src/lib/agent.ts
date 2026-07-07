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
            const url = new URL(`${API_BASE_URL}/routes/show`);
            url.searchParams.append('origin', origem);
            if (destino) url.searchParams.append('destination', destino);
            
            const response = await axios.get(url.toString());
            return response.data;
          } catch (error: any) {
            console.error('API Error buscar_rotas:', error.message);
            return { error: 'Erro ao consultar rotas no sistema.' };
          }
        },
      },
      consultar_assentos: {
        description: 'Consulta as poltronas disponíveis para uma viagem específica em uma data.',
        parameters: z.object({
          routeId: z.string().describe('O ID numérico ou hash da rota'),
          data: z.string().describe('Data da viagem no formato YYYY-MM-DD'),
        }),
        execute: async ({ routeId, data }) => {
          try {
            const url = new URL(`${API_BASE_URL}/routes/available_seats`);
            url.searchParams.append('route_id', routeId);
            url.searchParams.append('date', `${data}T03:00:00.000Z`);
            url.searchParams.append('web', 'false');
            
            const response = await axios.get(url.toString());
            return response.data;
          } catch (error: any) {
            console.error('API Error consultar_assentos:', error.message);
            return { error: 'Erro ao consultar poltronas no sistema.' };
          }
        },
      },
      gerar_pagamento: {
        description: 'Gera a cobrança no sistema oficial Embarcar. Chama esta função APÓS o cliente confirmar os dados da viagem e poltrona.',
        parameters: z.object({
          origem: z.string(),
          destino: z.string(),
          data_viagem: z.string(),
          price: z.number(),
          seat: z.string(),
          nome: z.string(),
          cpf: z.string(),
          telefone: z.string(),
        }),
        execute: async ({ origem, destino, price, seat, nome, cpf, telefone }) => {
          try {
            const payload = {
              origin: origem,
              destination: destino,
              price: price,
              customer: { name: nome, cpf: cpf, phone: telefone },
              allocation: [{ seat: seat }]
            };
            
            const response = await axios.post(`${API_BASE_URL}/orders/create`, payload);
            return response.data;
          } catch (error: any) {
            console.error('API Error gerar_pagamento:', error.message);
            return { error: 'Erro ao gerar pedido no sistema Embarcar.' };
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
