import { prisma } from './db';
import { sendWhatsAppMessage, sendInteractiveButtons, sendInteractiveList } from './whatsapp';
import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'America/Belem';

function getBusinessDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long'
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';

  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    weekday: value('weekday')
  };
}

function getBusinessTodayAtNoon() {
  const { year, month, day } = getBusinessDateParts();
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatIsoDatePtBr(dateIso?: string | null) {
  if (!dateIso) return '';
  const [year, month, day] = dateIso.split('-');
  if (!year || !month || !day) return dateIso;
  return `${day}/${month}/${year}`;
}

function getAgeFromBirthDate(day: number, month: number, year: number) {
  const today = getBusinessDateParts();
  let age = today.year - year;
  if (today.month < month || (today.month === month && today.day < day)) {
    age -= 1;
  }
  return age;
}

function getAsaasConfig() {
  const apiKey = process.env.ASAAS_API_KEY;

  if (!apiKey) {
    throw new Error('ASAAS_API_KEY is not configured');
  }

  const env = process.env.ASAAS_ENV?.toLowerCase();
  const isSandbox = env ? env === 'sandbox' || env === 'homologacao' || env === 'homologation' : apiKey.includes('hmlg');

  return {
    apiKey,
    baseUrl: isSandbox ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3'
  };
}

function extractAsaasPaymentId(data: any) {
  return data?.asaas_id || data?.asaasId || data?.payment_id || data?.paymentId || data?.payment?.id || data?.charge?.id;
}

function extractAsaasPaymentUrl(data: any) {
  return data?.payment_link || data?.paymentLink || data?.url || data?.invoiceUrl || data?.invoice_url || data?.payment?.invoiceUrl || data?.charge?.invoiceUrl;
}

async function getAsaasPaymentLink(paymentId: string) {
  const { apiKey, baseUrl } = getAsaasConfig();
  const paymentResponse = await axios.get(`${baseUrl}/payments/${paymentId}`, {
    headers: { access_token: apiKey }
  });

  return extractAsaasPaymentUrl(paymentResponse.data);
}

async function ensureOrderLinkedToAsaas(orderId: string, paymentId: string) {
  if (!/^\d+$/.test(orderId)) {
    throw new Error(`Invalid orderId returned by backend: ${orderId}`);
  }

  const parsedOrderId = BigInt(orderId);
  await prisma.orders.update({
    where: { id: parsedOrderId },
    data: { asaas_id: paymentId }
  });
}

async function getOrderAsaasPaymentId(orderId: string) {
  if (!/^\d+$/.test(orderId)) return null;

  const order = await prisma.orders.findUnique({
    where: { id: BigInt(orderId) },
    select: { asaas_id: true }
  });

  return order?.asaas_id || null;
}

function validateName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2;
}

function validateCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const calculateDigit = (factor: number) => {
    let total = 0;
    for (let i = 0; i < factor - 1; i++) {
      total += Number(digits[i]) * (factor - i);
    }
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(10) === Number(digits[9]) && calculateDigit(11) === Number(digits[10]);
}

function validateDate(dateStr: string) {
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (!regex.test(dateStr)) return false;
  const [, dayStr, monthStr, yearStr] = dateStr.match(regex)!;
  const day = Number(dayStr);
  const month = Number(monthStr);
  const year = Number(yearStr);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (isNaN(date.getTime())) return false;
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
  if (date > getBusinessTodayAtNoon()) return false;

  const age = getAgeFromBirthDate(day, month, year);
  return age >= 0 && age <= 120;
}

async function getOrCreateSession(from: string) {
  const sessionId = `session_${from}`;
  let session = await prisma.session.findUnique({ where: { id: sessionId } });

  if (session) {
    return session;
  }

  const user = await prisma.user.upsert({
    where: { phone: from },
    update: {},
    create: { phone: from }
  });

  session = await prisma.session.create({
    data: { id: sessionId, userId: user.id, state: 'default' }
  });

  return session;
}

async function sendMainMenu(to: string) {
  return sendInteractiveButtons(to, "Olá! Bem-vindo ao atendimento da Gold Star.\n\nComo posso ajudar?", [
    { id: 'comprar_passagem', title: 'Comprar passagem' },
    { id: 'consultar_bilhete', title: 'Consultar bilhete' },
    { id: 'falar_atendente', title: 'Falar com atendente' }
  ]);
}

export async function handleIncomingMessage(from: string, message: any) {
  const sessionId = `session_${from}`;
  let session = await prisma.session.findUnique({ where: { id: sessionId } });

  const type = message.type;
  const msgBody = type === 'text' ? message.text?.body : null;
  const interactiveId = type === 'interactive' ? (message.interactive?.button_reply?.id || message.interactive?.list_reply?.id) : null;

  const normalizedMsg = msgBody?.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isGreeting = normalizedMsg && type === 'text' ? (/^(ola|oi|menu|iniciar|comecar|bom dia|boa tarde|boa noite|opa|tudo bem)/i.test(normalizedMsg) || msgBody.trim() === '1' || msgBody.trim() === '0') : false;

  // 1. Menu inicial
  if (isGreeting || interactiveId === 'menu_inicial') {
    if (session) {
      session = await prisma.session.update({
        where: { id: sessionId },
        data: { state: 'default' }
      });
    } else {
      session = await getOrCreateSession(from);
    }

    await sendMainMenu(from);
    return;
  }

  if (!session) {
    session = await getOrCreateSession(from);

    if (interactiveId) {
      await handleInteractiveAction(session, from, interactiveId);
      return;
    }

    await sendMainMenu(from);
    return;
  }

  if (interactiveId) {
    await handleInteractiveAction(session, from, interactiveId);
    return;
  }

  if (type === 'text' && msgBody) {
    await processTextByState(session, from, msgBody);
    return;
  }

  await sendWhatsAppMessage(from, "Não consegui entender essa mensagem. Digite 'Menu' para ver as opções de atendimento.");
}

async function handleInteractiveAction(session: any, from: string, interactiveId: string) {
  // Falar com atendente
  if (interactiveId === 'falar_atendente' || interactiveId === 'consultar_falar_atendente') {
    await sendWhatsAppMessage(from, "Vou transferir você para um de nossos atendentes. Aguarde um momento.");
    await prisma.session.update({ where: { id: session.id }, data: { state: 'atendimento_humano' } });
    return;
  }

  // 2. Escolher origem
  if (interactiveId === 'comprar_passagem') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'escolhendo_origem' }
    });
    
    try {
      const routes = await prisma.routes.findMany({ where: { active: true }, select: { origin: true } });
      const uniqueOrigins = Array.from(new Set(routes.map((r: any) => r.origin).filter(Boolean))) as string[];
      
      const listItems = uniqueOrigins.slice(0, 9).map((origin: string) => ({
        id: `origem_${origin}`,
        title: origin.substring(0, 24)
      }));
      listItems.push({ id: 'origem_outra', title: 'Outra origem' });

      await sendInteractiveList(
        from, 
        "Para começarmos sua compra, escolha a cidade de origem da viagem:", 
        "Ver origens", 
        listItems
      );
    } catch (e) {
      console.error(e);
      await sendWhatsAppMessage(from, "Para começarmos sua compra, digite a cidade de origem da viagem:");
    }
    return;
  }

  // 3. Escolher destino
  if (interactiveId.startsWith('origem_')) {
    const origin = interactiveId.replace('origem_', '');
    if (origin === 'outra') {
      await prisma.session.update({
        where: { id: session.id },
        data: { state: 'escolhendo_origem', origin: null, destination: null }
      });
      await sendWhatsAppMessage(from, "Por favor, digite a cidade de origem:");
      return;
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'escolhendo_destino', origin }
    });

    try {
      const routes = await prisma.routes.findMany({ 
        where: { origin, active: true },
        select: { destination: true } 
      });
      const uniqueDest = Array.from(new Set(routes.map((r: any) => r.destination).filter(Boolean))) as string[];
      
      if (uniqueDest.length > 0) {
        const listItems = uniqueDest.slice(0, 9).map((dest: string) => ({
          id: `destino_${dest}`,
          title: dest.substring(0, 24)
        }));
        listItems.push({ id: 'destino_outro', title: 'Outro destino' });

        await sendInteractiveList(from, "Agora escolha o destino da viagem:", "Ver destinos", listItems);
      } else {
        await sendWhatsAppMessage(from, "Por favor, digite a cidade de destino:");
      }
    } catch (e) {
      await sendWhatsAppMessage(from, "Por favor, digite a cidade de destino:");
    }
    return;
  }

  // 4. Listar viagens disponíveis
  if (interactiveId.startsWith('destino_')) {
    const dest = interactiveId.replace('destino_', '');
    if (dest === 'outro') {
      await prisma.session.update({
        where: { id: session.id },
        data: { state: 'escolhendo_destino', destination: null }
      });
      await sendWhatsAppMessage(from, "Por favor, digite a cidade de destino:");
      return;
    }

    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'escolhendo_viagem', destination: dest }
    });

    await buscarViagensDisponiveis(session.id, session.origin || '', dest, from);
    return;
  }

  // 5. Escolher poltrona
  if (interactiveId.startsWith('trip_')) {
    const tripIdAndDate = interactiveId.replace('trip_', '');
    // format: tripId_date_time_routeId
    const [tripId, tripDate, time, routeId] = tripIdAndDate.split('|');
    
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'escolhendo_poltrona', tripDate, hora: time, routeId }
    });

    try {
      const res = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
        params: { route_id: routeId, date: tripDate, web: 'true' }
      });
      const seats = res.data.seats || [];
      const routeData = await prisma.routes.findUnique({
        where: { id: BigInt(routeId) }
      });
      
      await prisma.session.update({
        where: { id: session.id },
        data: { 
          price: Number(routeData?.speed_boat_price || 0), 
          tax: Number(routeData?.tax || 0) 
        }
      });

      if (res.data.status === 'error' || !res.data.available_seat_numbers || res.data.available_seat_numbers.length === 0) {
        await sendWhatsAppMessage(from, "Não há poltronas disponíveis para esta viagem. Digite 'Menu' para recomeçar.");
        return;
      }
      const availableSeats = res.data.available_seat_numbers;

      if (availableSeats.length === 1) {
        const seatId = availableSeats[0];
        await sendInteractiveButtons(from, `Temos apenas a poltrona ${seatId} disponível para essa viagem.\n\nDeseja continuar com essa poltrona?`, [
          { id: `confirmar_poltrona_${seatId}`, title: 'Sim, continuar' },
          { id: 'escolher_outra_data', title: 'Outra data' },
          { id: 'menu_inicial', title: 'Cancelar' }
        ]);
        return;
      }

      const listItems = availableSeats.slice(0, 10).map((seat: any) => {
        return { id: `seat_${seat}`, title: `Poltrona ${seat}` };
      });

      await sendInteractiveList(from, "Escolha a poltrona desejada para esta viagem:", "Ver poltronas", listItems);
    } catch (e) {
      console.error(e);
      await sendWhatsAppMessage(from, "Não foi possível carregar as poltronas. Digite a poltrona que deseja (ex: 12):");
    }
    return;
  }

  // Confirmar poltrona unica ou outra data
  if (interactiveId.startsWith('confirmar_poltrona_')) {
    const seatId = interactiveId.replace('confirmar_poltrona_', '');
    await tentarAvancarComPoltrona(session, from, seatId);
    return;
  }
  
  if (interactiveId === 'escolher_outra_data') {
    await buscarViagensDisponiveis(session.id, session.origin || '', session.destination || '', from);
    return;
  }

  // 6. Pedir nome completo
  if (interactiveId.startsWith('seat_')) {
    const seatId = interactiveId.replace('seat_', '');
    await tentarAvancarComPoltrona(session, from, seatId);
    return;
  }

  // 9. Confirmar telefone
  if (interactiveId === 'usar_whatsapp_como_telefone') {
    const phone = from.replace(/\D/g, '');
    const updatedSession = await prisma.session.update({
      where: { id: session.id },
      data: { passengerPhone: phone, state: 'resumo_passagem' }
    });
    await exibirResumo(updatedSession, from);
    return;
  }
  
  if (interactiveId === 'informar_outro_telefone') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_telefone_passageiro' }
    });
    await sendWhatsAppMessage(from, "Informe o telefone para contato, com DDD.");
    return;
  }

  // 10. Mostrar resumo da passagem -> Gerar Pagamento ou Alterar
  if (interactiveId === 'gerar_pagamento') {
    await sendInteractiveButtons(from, "Como você prefere realizar o pagamento?", [
      { id: 'pagamento_pix', title: 'PIX' },
      { id: 'pagamento_credito', title: 'Cartão' }
    ]);
    return;
  }

  if (interactiveId === 'alterar_dados') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_nome_passageiro' }
    });
    await sendWhatsAppMessage(from, "Vamos reiniciar os dados do passageiro.\n\nInforme o nome completo, igual ao documento.");
    return;
  }

  // 11. Escolher método de pagamento
  if (interactiveId === 'pagamento_pix') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_pagamento', paymentMethod: 'pix' }
    });
    await sendWhatsAppMessage(from, "Aguarde um momento enquanto geramos seu link de pagamento via PIX.");
    await gerarLinkPagamento(session.id, from, 'PIX', 1);
    return;
  }

  if (interactiveId === 'pagamento_credito') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_pagamento', paymentMethod: 'credit_card' }
    });
    await sendWhatsAppMessage(from, "Aguarde um momento enquanto geramos seu link de pagamento no cartão.");
    await gerarLinkPagamento(session.id, from, 'CREDIT_CARD', 1);
    return;
  }

  // 19. Consultar bilhete
  if (interactiveId === 'consultar_bilhete') {
    await sendInteractiveButtons(from, "Para consultar seu bilhete, escolha uma das opções abaixo.\n\nA consulta pode ser feita pelo número da reserva ou pelo CPF do passageiro.", [
      { id: 'consultar_por_reserva', title: 'Número da reserva' },
      { id: 'consultar_por_documento', title: 'CPF do passageiro' }
    ]);
    return;
  }

  if (interactiveId === 'consultar_por_reserva') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_numero_reserva' }
    });
    await sendWhatsAppMessage(from, "Informe o número da sua reserva.\n\nExemplo:\n3884");
    return;
  }

  if (interactiveId === 'consultar_por_documento') {
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_documento_consulta' }
    });
    await sendWhatsAppMessage(from, "Informe o CPF do passageiro.\n\nExemplo:\n16178319215");
    return;
  }

  if (interactiveId.startsWith('reserva_')) {
    await consultarBilhete(interactiveId.replace('reserva_', ''), null, from);
    return;
  }
}

async function processTextByState(session: any, from: string, text: string) {
  const state = session.state;

  if (state === 'escolhendo_origem') {
    await prisma.session.update({ where: { id: session.id }, data: { state: 'escolhendo_destino', origin: text.trim() } });
    await sendWhatsAppMessage(from, "Agora digite a cidade de destino da viagem:");
    return;
  }

  if (state === 'escolhendo_destino') {
    await prisma.session.update({ where: { id: session.id }, data: { state: 'escolhendo_viagem', destination: text.trim() } });
    await buscarViagensDisponiveis(session.id, session.origin || '', text.trim(), from);
    return;
  }

  if (state === 'escolhendo_poltrona') {
    await tentarAvancarComPoltrona(session, from, text.trim());
    return;
  }

  if (state === 'aguardando_nome_passageiro') {
    if (!validateName(text)) {
      await sendWhatsAppMessage(from, "Por favor, informe o nome completo (nome e sobrenome) igual ao documento.");
      return;
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { passengerName: text.trim(), state: 'aguardando_cpf_passageiro' }
    });
    await sendWhatsAppMessage(from, `Obrigado, ${text.split(' ')[0]}.\n\nAgora informe o CPF do passageiro, somente números.`);
    return;
  }

  if (state === 'aguardando_cpf_passageiro') {
    if (!validateCpf(text)) {
      await sendWhatsAppMessage(from, "O CPF informado parece inválido.\n\nPor favor, envie o CPF com 11 números, sem pontos ou traços.");
      return;
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { passengerCpf: text.replace(/\D/g, ''), state: 'aguardando_nascimento_passageiro' }
    });
    await sendWhatsAppMessage(from, "CPF recebido.\n\nAgora informe a data de nascimento no formato DD/MM/AAAA.");
    return;
  }

  if (state === 'aguardando_nascimento_passageiro') {
    if (!validateDate(text)) {
      await sendWhatsAppMessage(from, "A data de nascimento parece inválida.\n\nEnvie no formato DD/MM/AAAA. Exemplo: 19/03/1993.");
      return;
    }
    await prisma.session.update({
      where: { id: session.id },
      data: { passengerDob: text.trim(), state: 'aguardando_telefone_passageiro' }
    });
    await sendInteractiveButtons(from, "Deseja usar este número de WhatsApp como telefone de contato?", [
      { id: 'usar_whatsapp_como_telefone', title: 'Usar este número' },
      { id: 'informar_outro_telefone', title: 'Informar outro' }
    ]);
    return;
  }

  if (state === 'aguardando_telefone_passageiro') {
    const phone = text.replace(/\D/g, '');
    if (phone.length < 10) {
      await sendWhatsAppMessage(from, "Telefone inválido. Por favor, digite o DDD e o número.");
      return;
    }
    const updatedSession = await prisma.session.update({
      where: { id: session.id },
      data: { passengerPhone: text.trim(), state: 'resumo_passagem' }
    });
    await exibirResumo(updatedSession, from);
    return;
  }

  if (state === 'aguardando_numero_reserva') {
    await consultarBilhete(text.trim(), null, from);
    return;
  }

  if (state === 'aguardando_documento_consulta') {
    await consultarBilhete(null, text.replace(/\D/g, ''), from);
    return;
  }

  await sendMainMenu(from);
}

// Helpers

async function buscarViagensDisponiveis(sessionId: string, origin: string, dest: string, from: string) {
  try {
    const routes = await prisma.routes.findMany({
      where: {
        origin: origin,
        destination: dest,
        active: true
      }
    });

    if (routes.length === 0) {
      await sendWhatsAppMessage(from, `Não encontrei rotas diretas para ${origin} → ${dest}. Tente novamente digitando 'Menu'.`);
      return;
    }

    const diasSemana: Record<string, number> = {
      'Domingo': 0, 'Segunda-feira': 1, 'Terça-feira': 2,
      'Quarta-feira': 3, 'Quinta-feira': 4, 'Sexta-feira': 5, 'Sábado': 6
    };

    let viagensGeradas: any[] = [];
    routes.forEach((r: any) => {
      if (!r.week_day || diasSemana[r.week_day] === undefined) return;
      const targetDay = diasSemana[r.week_day];
      
      let count = 0;
      let d = getBusinessTodayAtNoon();
      
      while (d.getUTCDay() !== targetDay) {
        d.setUTCDate(d.getUTCDate() + 1);
      }
      
      while (count < 4) {
        const nextDate = new Date(d);
        const day = String(nextDate.getUTCDate()).padStart(2, '0');
        const month = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
        const year = nextDate.getUTCFullYear();
        const dataIso = `${year}-${month}-${day}`;
        const horaStr = r.hour ? r.hour.toISOString().substring(11, 16) : '08:00';
        
        const tripDateTime = new Date(`${dataIso}T${horaStr}:00-03:00`);
        const now = new Date();
        
        if (tripDateTime > now) {
          viagensGeradas.push({
            route_id: r.id.toString(),
            dataIso,
            hora: horaStr,
            week_day: r.week_day,
            price: r.speed_boat_price
          });
          count++;
        }
        
        d.setUTCDate(d.getUTCDate() + 7);
      }
    });

    viagensGeradas.sort((a, b) => new Date(a.dataIso).getTime() - new Date(b.dataIso).getTime());

    let viagensDisponiveis: any[] = [];
    
    let availabilityErrors = 0;

    await Promise.all(viagensGeradas.map(async (viagem) => {
      try {
        const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
          params: { route_id: viagem.route_id, date: viagem.dataIso, web: 'true' }
        });
        if (response.data.status !== 'error' && response.data.available_seat_numbers && response.data.available_seat_numbers.length > 0) {
          viagensDisponiveis.push(viagem);
        }
      } catch (err: any) {
        availabilityErrors++;
        console.error('[TRIPS] Failed to check seat availability', {
          sessionId,
          routeId: viagem.route_id,
          date: viagem.dataIso,
          error: err.response?.data || err.message
        });
      }
    }));

    viagensDisponiveis.sort((a, b) => new Date(a.dataIso).getTime() - new Date(b.dataIso).getTime());

    if (viagensDisponiveis.length === 0 && availabilityErrors === viagensGeradas.length) {
      await sendWhatsAppMessage(from, `Não consegui consultar a disponibilidade das viagens agora.\n\nDigite 'Menu' para tentar novamente em alguns instantes.`);
      return;
    }

    if (viagensDisponiveis.length === 0) {
      await sendWhatsAppMessage(from, `Não encontrei viagens disponíveis para ${origin} → ${dest} nos próximos dias.\n\nDigite 'Menu' para recomeçar.`);
      return;
    }

    const listItems = viagensDisponiveis.slice(0, 10).map((t: any) => {
      const dataFormatada = t.dataIso.split('-').reverse().slice(0, 2).join('/');
      const diaCurto = t.week_day.substring(0, 3);
      const title = `${dataFormatada} - ${diaCurto} - ${t.hora}`;
      // Usamos id trip_ID|DATE|TIME|ROUTEID
      return { id: `trip_${t.route_id}|${t.dataIso}|${t.hora}|${t.route_id}`, title };
    });

    await sendInteractiveList(from, `Encontrei viagens disponíveis para ${origin} → ${dest}.\n\nEscolha a data da viagem:`, "Ver datas", listItems);
  } catch (e) {
    console.error(e);
    await sendWhatsAppMessage(from, "Ocorreu um erro ao buscar viagens. Digite 'Menu' para tentar novamente.");
  }
}

type SeatValidationResult =
  | { valid: true; seatId: string }
  | { valid: false; message: string };

async function validarPoltronaDisponivel(session: any, seatId: string): Promise<SeatValidationResult> {
  if (!session.routeId || !session.tripDate) {
    return { valid: false, message: "Não consegui identificar a viagem selecionada. Digite 'Menu' para recomeçar." };
  }

  const seatNumber = Number(seatId);
  if (!Number.isInteger(seatNumber) || seatNumber <= 0) {
    return { valid: false, message: "Informe apenas o número da poltrona desejada. Exemplo: 12." };
  }

  const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
    params: { route_id: session.routeId, date: session.tripDate, web: 'true' }
  });

  const availableSeats = response.data.available_seat_numbers || [];
  const isAvailable = availableSeats.map(String).includes(String(seatNumber));

  if (!isAvailable) {
    const visibleSeats = availableSeats.slice(0, 20).join(', ');
    return {
      valid: false,
      message: visibleSeats
        ? `Essa poltrona não está disponível. Escolha uma das poltronas livres: ${visibleSeats}.`
        : "Não há poltronas disponíveis para esta viagem. Digite 'Menu' para recomeçar."
    };
  }

  return { valid: true, seatId: String(seatNumber) };
}

async function tentarAvancarComPoltrona(session: any, from: string, seatId: string) {
  try {
    const validation = await validarPoltronaDisponivel(session, seatId);
    if (!validation.valid) {
      await sendWhatsAppMessage(from, validation.message);
      return;
    }

    await avancarParaDadosPassageiro(session.id, from, validation.seatId || seatId);
  } catch (err: any) {
    console.error('[SEATS] Failed to validate selected seat', {
      sessionId: session.id,
      routeId: session.routeId,
      tripDate: session.tripDate,
      seatId,
      error: err.response?.data || err.message
    });
    await sendWhatsAppMessage(from, "Não consegui confirmar a disponibilidade dessa poltrona agora. Digite 'Menu' para tentar novamente.");
  }
}

async function avancarParaDadosPassageiro(sessionId: string, from: string, seatId: string) {
  await prisma.session.update({
    where: { id: sessionId },
    data: { seat: seatId, state: 'aguardando_nome_passageiro' }
  });
  await sendWhatsAppMessage(from, `Perfeito. A poltrona ${seatId} foi selecionada.\n\nAgora preciso dos dados do passageiro.\n\nInforme o nome completo, igual ao documento.`);
}

async function exibirResumo(session: any, from: string) {
  const total = (Number(session.price || 0) + Number(session.tax || 0)).toFixed(2).replace('.', ',');
  const price = Number(session.price || 0).toFixed(2).replace('.', ',');
  const tax = Number(session.tax || 0).toFixed(2).replace('.', ',');

  const resumo = `Confira os dados da sua passagem:\n\n` +
    `Passageiro: ${session.passengerName}\n` +
    `CPF: ${session.passengerCpf}\n` +
    `Nascimento: ${session.passengerDob}\n\n` +
    `Rota: ${session.origin} → ${session.destination}\n` +
    `Data: ${formatIsoDatePtBr(session.tripDate)}\n` +
    `Horário: ${session.hora || '08:00'}\n` +
    `Poltrona: ${session.seat}\n\n` +
    `Passagem: R$ ${price}\n` +
    `Tarifa de embarque: R$ ${tax}\n` +
    `Total: R$ ${total}\n\n` +
    `Deseja confirmar e gerar o pagamento?`;

  await sendInteractiveButtons(from, resumo, [
    { id: 'gerar_pagamento', title: 'Gerar pagamento' },
    { id: 'alterar_dados', title: 'Alterar dados' },
    { id: 'menu_inicial', title: 'Cancelar' }
  ]);
}

async function gerarLinkPagamento(sessionId: string, from: string, billingType: string, installments: number) {
  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return;
  
  // Create order via backend
  try {
    let finalTripId = '1';
    try {
      const tripResponse = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
        params: { route_id: session.routeId, date: session.tripDate, web: 'true' }
      });
      if (tripResponse.data.trip?.id) {
        finalTripId = tripResponse.data.trip.id.toString();
      }
    } catch (e) {
      console.log('Failed to fetch trip info for payment:', e);
    }

    const payload: any = {
      route_id: session.routeId,
      trip_id: finalTripId,
      date: session.tripDate,
      payment_method: billingType,
      billingType: billingType,
      chargeType: installments > 1 ? "INSTALLMENT" : "DETACHED",
      installment_count: installments,
      maxInstallmentCount: installments > 1 ? installments : undefined,
      dueDateLimitDays: billingType === 'PIX' ? 1 : undefined,
      search_trip: "one_way",
      seat_numbers: [parseInt(session.seat!)],
      name: session.passengerName,
      phone: session.passengerPhone,
      customers: { "1": session.passengerName },
      documents: { "1": session.passengerCpf },
      document_types: { "1": "cpf" },
      birthdays: { "1": session.passengerDob },
      phones: { "1": session.passengerPhone },
      data: JSON.stringify([
        { field: "speed_boat_price", quantity: 1, price: Number(session.price || 0), tax: Number(session.tax || 0) }
      ])
    };

    console.info('[ASAAS ORDER] Creating order via backend', {
      sessionId,
      routeId: session.routeId,
      tripDate: session.tripDate,
      billingType,
      installments,
      seat: session.seat
    });

    const response = await axios.post(`${API_BASE_URL}/orders/create`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const isSuccess = response.data.status === 'success' || response.data.status === 'ok' || response.status === 200;
    if (isSuccess) {
      const orderId = String(response.data.id || response.data.order_id);
      if (!/^\d+$/.test(orderId)) {
        console.error('[ASAAS ORDER] Backend did not return a valid numeric order id', { sessionId, response: response.data });
        await sendWhatsAppMessage(from, `Não foi possível identificar a reserva criada. Digite 'Menu' para tentar novamente.`);
        return;
      }

      console.info('[ASAAS ORDER] Backend order created', {
        sessionId,
        orderId,
        returnedAsaasPaymentId: extractAsaasPaymentId(response.data),
        returnedPaymentUrl: Boolean(extractAsaasPaymentUrl(response.data))
      });
      
      // Update session with orderId
      await prisma.session.update({
        where: { id: sessionId },
        data: { orderId }
      });

      // The backend /orders/create is the single owner of the Asaas charge creation.
      // We reuse the Asaas charge/link it created instead of creating a second
      // payment directly here, keeping orders.asaas_id aligned with webhook events.
      let asaasPaymentId = extractAsaasPaymentId(response.data);
      let paymentUrl = extractAsaasPaymentUrl(response.data);
      const valorTotal = Number(session.price || 0) + Number(session.tax || 0);

      if (!asaasPaymentId) {
        asaasPaymentId = await getOrderAsaasPaymentId(orderId);
      }

      if (asaasPaymentId) {
        try {
          await ensureOrderLinkedToAsaas(orderId, asaasPaymentId);
          console.info('[ASAAS ORDER] Order linked to Asaas payment', { sessionId, orderId, asaasPaymentId });
        } catch (err: any) {
          console.error('[ASAAS LINK] Failed to link order to Asaas payment:', err.response?.data || err.message);
        }
      } else {
        console.warn('[ASAAS ORDER] Backend did not return or persist an Asaas payment id', { sessionId, orderId });
      }

      if (!paymentUrl && asaasPaymentId) {
        try {
          paymentUrl = await getAsaasPaymentLink(asaasPaymentId);
          console.info('[ASAAS LINK] Payment link fetched from Asaas', { sessionId, orderId, asaasPaymentId });
        } catch (err: any) {
          console.error('[ASAAS LINK] Failed to fetch Asaas payment link:', err.response?.data || err.message);
        }
      }

      if (paymentUrl) {
        await prisma.session.update({
          where: { id: sessionId },
          data: { paymentLink: paymentUrl }
        });
      }

      if (paymentUrl) {
        const valorFormatado = valorTotal.toFixed(2).replace('.', ',');
        let msg = `Seu link de pagamento ${billingType === 'PIX' ? 'via PIX' : 'no cartão'} foi gerado.\n\nTotal: R$ ${valorFormatado}\n`;
        if (installments > 1) msg += `Parcelamento: até ${installments}x\n\n`;
        else msg += '\n';
        msg += `Toque no link abaixo para pagar:\n${paymentUrl}`;
        
        const sent = await sendWhatsAppMessage(from, msg);
        if (!sent) {
          console.error('[ASAAS LINK] Failed to send payment link via WhatsApp', { sessionId, orderId, asaasPaymentId });
        }
      } else {
        console.error('[ASAAS LINK] Payment URL missing after backend/Asaas lookup', { sessionId, orderId, asaasPaymentId });
        await sendWhatsAppMessage(from, `Não foi possível gerar o link de pagamento. Digite 'Menu' para tentar novamente.`);
      }
    } else {
      console.error('[ASAAS ORDER] Backend failed to create order', { sessionId, status: response.status, response: response.data });
      await sendWhatsAppMessage(from, `Não foi possível gerar a reserva no sistema. Digite 'Menu' para tentar novamente.`);
    }
  } catch (error) {
    console.error('Error generating payment:', error);
    await sendWhatsAppMessage(from, `Ocorreu um erro ao conectar com o banco de dados de viagens. Tente novamente mais tarde.`);
  }
}

async function consultarBilhete(reservaId: string | null, documento: string | null, from: string) {
  try {
    console.info('[TICKET LOOKUP] Searching ticket', { reservaId, documento: documento ? '***' : null });

    const orderWhere: any = {};
    if (reservaId && /^\d+$/.test(reservaId)) {
      orderWhere.id = BigInt(reservaId);
    }
    if (documento) {
      orderWhere.order_customers = {
        some: {
          customers: {
            document: documento
          }
        }
      };
    }

    const orders = Object.keys(orderWhere).length > 0 ? await prisma.orders.findMany({
      where: orderWhere,
      include: {
        order_customers: {
          include: {
            customers: true
          }
        }
      },
      orderBy: { created_at: 'desc' },
      take: 5
    }) : [];

    if (orders.length > 0) {
      if (orders.length === 1) {
        const order = orders[0];
        const passenger = order.order_customers[0]?.customers?.name || order.emergency_contact_name || order.username || 'Passageiro';
        const seat = order.order_customers[0]?.seat_number || 'N/A';
        const dataFormatada = order.date ? new Date(order.date.getTime() + order.date.getTimezoneOffset() * 60000).toLocaleDateString('pt-BR') : '';
        const status = order.status === 'approved' ? 'Emitido' : 'Aguardando pagamento';
        const msg = `Bilhete encontrado.\n\nReserva: ${order.id}\nPassageiro: ${passenger}\nRota: ${order.origin} → ${order.destination}\nData: ${dataFormatada}\nPoltrona: ${seat}\nStatus: ${status}\n\n${order.status === 'approved' ? 'Apresente este bilhete no momento do embarque.' : 'O bilhete será emitido após a confirmação do pagamento.'}`;
        await sendWhatsAppMessage(from, msg);
        return;
      }

      const listItems = orders.slice(0, 10).map((order: any) => ({
        id: `reserva_${order.id.toString()}`,
        title: `Reserva ${order.id.toString()}`.substring(0, 24),
        description: `${order.origin || ''} → ${order.destination || ''}`.substring(0, 72)
      }));
      await sendInteractiveList(from, "Encontrei mais de uma reserva para este documento. Escolha qual deseja consultar:", "Ver reservas", listItems);
      return;
    }

    let whereClause: any = {};
    if (reservaId) whereClause.orderId = reservaId;
    if (documento) whereClause.passengerCpf = documento;

    const tickets = await prisma.session.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    if (tickets.length === 0) {
      await sendInteractiveButtons(from, "Não encontrei nenhum bilhete emitido com os dados informados.\n\nConfira se o número da reserva, CPF ou RG foi digitado corretamente.\n\nDeseja tentar novamente?", [
        { id: 'consultar_bilhete', title: 'Tentar novamente' },
        { id: 'falar_atendente', title: 'Falar atendente' },
        { id: 'menu_inicial', title: 'Menu inicial' }
      ]);
      return;
    }

    if (tickets.length === 1) {
      const t = tickets[0];
      const msg = `Bilhete encontrado.\n\nPassageiro: ${t.passengerName}\nRota: ${t.origin} → ${t.destination}\nData: ${t.tripDate}\nHorário: ${t.hora}\nPoltrona: ${t.seat}\nStatus: Emitido\n\nApresente este bilhete no momento do embarque.`;
      await sendWhatsAppMessage(from, msg);
      // Aqui enviaria o PDF também, se t.ticketPdfUrl não for null
      // await sendWhatsAppDocument(from, t.ticketPdfUrl, "bilhete.pdf", "Aqui está seu bilhete.");
      return;
    }

    // Se tiver vários
    let listItems = tickets.slice(0, 10).map((t, idx) => ({
      id: `ver_bilhete_${t.id}`,
      title: `${t.tripDate} - Pol ${t.seat}`
    }));
    await sendInteractiveList(from, "Encontrei mais de um bilhete vinculado a esse documento.\n\nEscolha qual deseja consultar:", "Ver bilhetes", listItems);

  } catch (error) {
    await sendWhatsAppMessage(from, "Ocorreu um erro ao consultar os bilhetes. Digite 'Menu' para tentar novamente.");
  }
}
