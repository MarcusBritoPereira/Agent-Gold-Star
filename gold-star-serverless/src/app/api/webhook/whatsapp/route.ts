import { NextResponse } from 'next/server';
import { processChat } from '@/lib/agent';
import { sendInteractiveButtons, sendInteractiveList, sendWhatsAppMessage } from '@/lib/whatsapp';
import { processWebhookState, enviarResumoPassagem, processPayment } from '@/lib/stateMachine';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// Meta Verification Endpoint
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return new NextResponse(challenge, { status: 200 });
    } else {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  return new NextResponse('Bad Request', { status: 400 });
}

// Receive Messages Endpoint
export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        const phoneNumberId = body.entry[0].changes[0].value.metadata.phone_number_id;
        const from = body.entry[0].changes[0].value.messages[0].from; // sender phone number
        const message = body.entry[0].changes[0].value.messages[0];
        const type = message.type;
        const sessionId = `session_${from}`;
        
        let session = await prisma.session.findUnique({ where: { id: sessionId } });

        if (type === 'text') {
          const msgBody = message.text?.body;
          console.log(`Received text message from ${from}: ${msgBody}`);
          
          // Intercept initial greetings FIRST, regardless of state
          const normalizedMsg = msgBody?.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const isGreeting = normalizedMsg ? (/^(ola|oi|menu|iniciar|comecar)\b/i.test(normalizedMsg) || msgBody.trim() === '1' || msgBody.trim() === '0') : false;
          
          if (msgBody && isGreeting) {
            await sendInteractiveButtons(from, "Olá! Bem-vindo ao atendimento da Gold Star.\n\nComo posso ajudar?", [
              { id: 'comprar_passagem', title: 'Comprar passagem' },
              { id: 'falar_atendente', title: 'Falar com atendente' }
            ]);
            // Reset the session if they say "Olá"
            await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
            return new NextResponse('EVENT_RECEIVED', { status: 200 });
          }

          // Se a sessão tem um estado de coleta de dados no webhook e NÃO for uma saudação
          if (session && session.state && session.state !== 'default' && !session.state.startsWith('resumo_')) {
            await processWebhookState(session, from, message);
            return new NextResponse('EVENT_RECEIVED', { status: 200 });
          }

          // Caso contrário, manda para a IA
          processChat(sessionId, from, msgBody).catch(console.error);
          
        } else if (type === 'interactive') {
          const buttonId = message.interactive?.button_reply?.id;
          const listId = message.interactive?.list_reply?.id;
          const interactiveId = buttonId || listId;

          if (interactiveId === 'comprar_passagem') {
            const routes = await prisma.routes.findMany({ select: { origin: true } });
            const uniqueOrigins = Array.from(new Set(routes.map(r => r.origin).filter(Boolean))) as string[];
            
            // Meta list rows limit is 10 items per section, so we need to limit if necessary
            // For now, let's limit to 10
            const listItems = uniqueOrigins.slice(0, 10).map(origin => ({
              id: `origem_${origin}`,
              title: origin
            }));

            await sendInteractiveList(
              from, 
              "Para começarmos sua compra, escolha a cidade de origem da viagem:", 
              "Ver origens", 
              listItems
            );
          } else if (interactiveId === 'menu_inicial') {
            await sendInteractiveButtons(from, "Olá! Bem-vindo ao atendimento da Gold Star.\n\nComo posso ajudar?", [
              { id: 'comprar_passagem', title: 'Comprar passagem' },
              { id: 'falar_atendente', title: 'Falar com atendente' }
            ]);
            await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
          } else if (interactiveId === 'falar_atendente' || interactiveId === 'consultar_falar_atendente') {
            await sendWhatsAppMessage(from, "Um momento! Estou transferindo você para um de nossos atendentes humanos...");
          } else if (interactiveId?.startsWith('origem_')) {
            const origemEscolhida = interactiveId.replace('origem_', '');
            
            // Buscar destinos válidos para esta origem
            const routes = await prisma.routes.findMany({ 
              where: { origin: origemEscolhida },
              select: { destination: true } 
            });
            const uniqueDestinations = Array.from(new Set(routes.map(r => r.destination).filter(Boolean))) as string[];
            
            if (uniqueDestinations.length > 0) {
              const listItems = uniqueDestinations.slice(0, 10).map(destino => ({
                // Codificando origem e destino no ID para manter o webhook stateless
                id: `destino_${origemEscolhida}_${destino}`,
                title: destino
              }));

              await sendInteractiveList(
                from, 
                "Agora escolha o destino da viagem:", 
                "Ver destinos", 
                listItems
              );
            } else {
              await sendWhatsAppMessage(from, "Desculpe, não encontramos destinos para esta origem.");
            }
          } else if (interactiveId?.startsWith('destino_')) {
            const [, origem, destino] = interactiveId.split('_');
            
            // Buscar rotas ativas no banco de dados para este trecho
            const routes = await prisma.routes.findMany({
              where: {
                origin: origem,
                destination: destino,
                active: true
              }
            });
            
            if (routes.length === 0) {
              await sendWhatsAppMessage(from, `Desculpe, não encontramos viagens cadastradas de ${origem} para ${destino}.`);
              return new NextResponse('EVENT_RECEIVED', { status: 200 });
            }
            
            const diasSemana: Record<string, number> = {
              'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
              'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
            };
            
            let viagensGeradas: any[] = [];
            
            routes.forEach(r => {
              if (!r.week_day || diasSemana[r.week_day] === undefined) return;
              const targetDay = diasSemana[r.week_day];
              
              let d = new Date();
              d.setUTCHours(12, 0, 0, 0);
              
              while (d.getUTCDay() !== targetDay) {
                d.setUTCDate(d.getUTCDate() + 1);
              }
              
              for (let i = 0; i < 4; i++) {
                const nextDate = new Date(d);
                nextDate.setUTCDate(d.getUTCDate() + (i * 7));
                
                const day = String(nextDate.getUTCDate()).padStart(2, '0');
                const month = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
                const year = nextDate.getUTCFullYear();
                const dataIso = `${year}-${month}-${day}`;
                
                viagensGeradas.push({
                  route_id: r.id.toString(),
                  dataIso,
                  hora: r.hour ? r.hour.toISOString().substring(11, 16) : '08:00',
                  week_day: r.week_day,
                  price: r.speed_boat_price
                });
              }
            });

            // Ordenar por data
            viagensGeradas.sort((a, b) => new Date(a.dataIso).getTime() - new Date(b.dataIso).getTime());

            const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';
            let viagensDisponiveis: any[] = [];

            // Checar disponibilidade (limitado às 10 primeiras para ser rápido no webhook)
            const viagensParaChecar = viagensGeradas.slice(0, 10);
            
            await Promise.all(viagensParaChecar.map(async (viagem) => {
              try {
                const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
                  params: { route_id: viagem.route_id, date: viagem.dataIso, web: 'true' }
                });
                if (response.data.status !== 'error' && response.data.available_seat_numbers && response.data.available_seat_numbers.length > 0) {
                  viagensDisponiveis.push(viagem);
                }
              } catch (err) {
                // Silenciosamente ignora datas sem poltronas ou erros da API para não quebrar a lista
              }
            }));

            // Re-ordenar pois o Promise.all pode retornar fora de ordem
            viagensDisponiveis.sort((a, b) => new Date(a.dataIso).getTime() - new Date(b.dataIso).getTime());

            if (viagensDisponiveis.length > 0) {
              const listItems = viagensDisponiveis.slice(0, 10).map(v => {
                const dataFormatada = v.dataIso.split('-').reverse().slice(0, 2).join('/'); // 13/07
                const diaCurto = v.week_day.substring(0, 3); // Seg
                const totalFormatado = v.price ? `R$ ${Number(v.price).toFixed(2).replace('.', ',')}` : 'Valor sob consulta';
                return {
                  // ID no formato viagem_ROUTEID_DATA
                  id: `viagem_${v.route_id}_${v.dataIso}`,
                  title: `${dataFormatada} - ${diaCurto} - ${v.hora}`,
                  description: `Total: ${totalFormatado}`
                };
              });

              await sendInteractiveList(
                from, 
                `Encontrei viagens disponíveis para ${origem} → ${destino}.\n\nEscolha a data da viagem:`, 
                "Ver viagens", 
                listItems
              );
            } else {
              await sendWhatsAppMessage(from, `Desculpe, no momento não há viagens com assentos disponíveis para a rota ${origem} → ${destino}.`);
            }
          } else if (interactiveId?.startsWith('viagem_')) {
            const [, routeId, dataIso] = interactiveId.split('_');
            const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';
            
            try {
              const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
                params: { route_id: routeId, date: dataIso, web: 'true' }
              });

              if (response.data.status !== 'error' && response.data.available_seat_numbers) {
                const availableSeats = response.data.available_seat_numbers;

                if (availableSeats.length === 0) {
                  await sendWhatsAppMessage(from, "Desculpe, essa viagem acabou de lotar. Por favor, escolha outra data.");
                } else if (availableSeats.length === 1) {
                  const poltrona = availableSeats[0];
                  await sendInteractiveButtons(from, `Temos apenas a poltrona ${poltrona} disponível para essa viagem.\n\nDeseja continuar com essa poltrona?`, [
                    { id: `seat_${routeId}_${dataIso}_${poltrona}`, title: 'Sim, continuar' },
                    { id: 'comprar_passagem', title: 'Outra data' }, // Volta para a escolha de viagem (na verdade seria ideal recarregar a lista de datas, mas voltar para o começo funciona)
                    { id: 'cancelar_compra', title: 'Cancelar' }
                  ]);
                } else {
                  const listItems = availableSeats.slice(0, 10).map((seat: any) => ({
                    id: `seat_${routeId}_${dataIso}_${seat}`,
                    title: `Poltrona ${seat}`
                  }));

                  await sendInteractiveList(
                    from, 
                    "Encontramos poltronas disponíveis para sua viagem.\n\nEscolha uma poltrona para continuar:", 
                    "Ver poltronas", 
                    listItems
                  );
                }
              } else {
                await sendWhatsAppMessage(from, "Erro ao buscar poltronas. Tente novamente mais tarde.");
              }
            } catch (err) {
              await sendWhatsAppMessage(from, "Erro ao buscar poltronas. Tente novamente mais tarde.");
            }
          } else if (interactiveId?.startsWith('seat_')) {
            const [, routeId, dataIso, poltrona] = interactiveId.split('_');
            
            // Save state in the session and ask for name
            await prisma.session.update({
              where: { id: sessionId },
              data: {
                state: 'aguardando_nome_passageiro',
                routeId,
                tripDate: dataIso,
                seat: poltrona
              }
            });

            await sendWhatsAppMessage(
              from, 
              `Perfeito. A poltrona ${poltrona} foi selecionada.\n\nAgora preciso dos dados do passageiro.\n\nInforme o nome completo, igual ao documento.`
            );
          } else if (interactiveId === 'usar_whatsapp_como_telefone') {
            const updatedSession = await prisma.session.update({
              where: { id: sessionId },
              data: {
                passengerPhone: from,
                state: 'resumo_passagem'
              }
            });
            await enviarResumoPassagem(updatedSession, from);
          } else if (interactiveId === 'informar_outro_telefone') {
            await sendWhatsAppMessage(from, "Por favor, digite o telefone de contato com DDD (somente números).");
          } else if (interactiveId === 'gerar_pagamento') {
            await sendInteractiveButtons(from, "Como você prefere realizar o pagamento?", [
              { id: 'pagamento_pix', title: 'PIX' },
              { id: 'pagamento_credito', title: 'Cartão de Crédito' }
            ]);
          } else if (interactiveId === 'pagamento_pix') {
            await sendWhatsAppMessage(from, "Aguarde um momento enquanto geramos seu link de pagamento via PIX...");
            await processPayment(session, from, 'PIX', 1);
          } else if (interactiveId === 'pagamento_credito') {
            await sendInteractiveButtons(from, "Em quantas vezes deseja pagar no cartão de crédito?", [
              { id: 'cartao_1x', title: '1x' },
              { id: 'cartao_2x', title: '2x' }
            ]);
          } else if (interactiveId === 'cartao_1x' || interactiveId === 'cartao_2x') {
            const installments = interactiveId === 'cartao_1x' ? 1 : 2;
            await sendWhatsAppMessage(from, "Aguarde um momento enquanto geramos seu link de pagamento no cartão...");
            await processPayment(session, from, 'CREDIT_CARD', installments);
          } else if (interactiveId === 'cancelar_compra') {
            await sendWhatsAppMessage(from, "Compra cancelada. Se precisar de algo mais, é só chamar!");
            await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
          } else {
            console.log(`Received unknown interactive id: ${interactiveId}`);
            const interactiveText = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
            processChat(sessionId, from, interactiveText).catch(console.error);
          }
        } else {
          console.log(`Received unsupported message type: ${type}`);
        }
      }
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    } else {
      return new NextResponse('Not Found', { status: 404 });
    }
  } catch (error) {
    console.error('Error handling webhook:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
