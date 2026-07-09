import { prisma } from './db';
import { sendWhatsAppMessage, sendInteractiveButtons, sendInteractiveList } from './whatsapp';
import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';

function validateName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2;
}

function validateCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  return true;
}

function validateDate(dateStr: string) {
  const regex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  if (!regex.test(dateStr)) return false;
  const [, day, month, year] = dateStr.match(regex)!;
  const date = new Date(`${year}-${month}-${day}T12:00:00Z`);
  if (isNaN(date.getTime())) return false;
  if (date > new Date()) return false;
  return true;
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
      session = await prisma.session.create({
        data: { id: sessionId, userId: 'default', state: 'default' }
      });
    }

    await sendInteractiveButtons(from, "Olá! Bem-vindo ao atendimento da Gold Star.\n\nComo posso ajudar?", [
      { id: 'comprar_passagem', title: 'Comprar passagem' },
      { id: 'consultar_bilhete', title: 'Consultar bilhete' },
      { id: 'falar_atendente', title: 'Falar com atendente' }
    ]);
    return;
  }

  if (!session) return;

  if (interactiveId) {
    await handleInteractiveAction(session, from, interactiveId);
    return;
  }

  if (type === 'text' && msgBody) {
    await processTextByState(session, from, msgBody);
  }
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
    await avancarParaDadosPassageiro(session.id, from, seatId);
    return;
  }
  
  if (interactiveId === 'escolher_outra_data') {
    await buscarViagensDisponiveis(session.id, session.origin || '', session.destination || '', from);
    return;
  }

  // 6. Pedir nome completo
  if (interactiveId.startsWith('seat_')) {
    const seatId = interactiveId.replace('seat_', '');
    await avancarParaDadosPassageiro(session.id, from, seatId);
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
      { id: 'pagamento_credito', title: 'Cartão de Crédito' }
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
    await sendInteractiveButtons(from, "Em quantas vezes deseja pagar no cartão de crédito?", [
      { id: 'cartao_1x', title: '1x' },
      { id: 'cartao_2x', title: '2x' }
    ]);
    return;
  }

  if (interactiveId === 'cartao_1x' || interactiveId === 'cartao_2x') {
    const installments = interactiveId === 'cartao_2x' ? 2 : 1;
    await prisma.session.update({
      where: { id: session.id },
      data: { state: 'aguardando_pagamento', paymentMethod: 'credit_card' }
    });
    await sendWhatsAppMessage(from, "Aguarde um momento enquanto geramos seu link de pagamento no cartão.");
    await gerarLinkPagamento(session.id, from, 'CREDIT_CARD', installments);
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
    await avancarParaDadosPassageiro(session.id, from, text.trim());
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
      let d = new Date();
      d.setUTCHours(12, 0, 0, 0);
      
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
    
    await Promise.all(viagensGeradas.map(async (viagem) => {
      try {
        const response = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
          params: { route_id: viagem.route_id, date: viagem.dataIso, web: 'true' }
        });
        if (response.data.status !== 'error' && response.data.available_seat_numbers && response.data.available_seat_numbers.length > 0) {
          viagensDisponiveis.push(viagem);
        }
      } catch (err) {
      }
    }));

    viagensDisponiveis.sort((a, b) => new Date(a.dataIso).getTime() - new Date(b.dataIso).getTime());

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
    `Data: ${session.tripDate}\n` +
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

    const response = await axios.post(`${API_BASE_URL}/orders/create`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    const isSuccess = response.data.status === 'success' || response.data.status === 'ok' || response.status === 200;
    if (isSuccess) {
      const orderId = String(response.data.id || response.data.order_id);
      
      // Update session with orderId
      await prisma.session.update({
        where: { id: sessionId },
        data: { orderId }
      });

      // The backend /orders/create already generates the Asaas payment link and sends it via email.
      // We will just extract it from the response to send it via WhatsApp, preventing duplicate links.
      let paymentUrl = response.data.url || response.data.payment_link;
      const valorTotal = Number(session.price || 0) + Number(session.tax || 0);

      const apiKey = (process.env.ASAAS_API_KEY || '').replace(/^\$+/, '$');
      const asaasBaseUrl = apiKey.includes('hmlg') ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3';

      if (billingType === 'CREDIT_CARD') {
        try {
          console.log(`[ASAAS CREDIT CARD FIX] Generating Asaas Payment Link directly for value ${valorTotal}`);
          
          // 1. Find or create Customer
          let customerId = '';
          const customerSearch = await axios.get(`${asaasBaseUrl}/customers`, {
            params: { cpfCnpj: session.passengerCpf },
            headers: { access_token: apiKey }
          });

          if (customerSearch.data && customerSearch.data.data && customerSearch.data.data.length > 0) {
            customerId = customerSearch.data.data[0].id;
          } else {
            const createCustomer = await axios.post(`${asaasBaseUrl}/customers`, {
              name: session.passengerName,
              cpfCnpj: session.passengerCpf,
              phone: session.passengerPhone
            }, {
              headers: { access_token: apiKey }
            });
            customerId = createCustomer.data.id;
          }

          // 2. Create Charge
          // Formata data atual caso tripDate seja inválido ou vazio
          const dueDate = (session.tripDate && session.tripDate.length === 10) ? session.tripDate : new Date().toISOString().split('T')[0];

          const chargePayload: any = {
            customer: customerId,
            billingType: 'CREDIT_CARD',
            dueDate: dueDate,
            description: `Passagem Gold Star - ${session.origin} para ${session.destination}`
          };

          if (installments > 1) {
            chargePayload.installmentCount = installments;
            chargePayload.installmentValue = Number((valorTotal / installments).toFixed(2));
          } else {
            chargePayload.value = valorTotal;
          }

          const chargeResponse = await axios.post(`${asaasBaseUrl}/payments`, chargePayload, {
            headers: { access_token: apiKey }
          });
          
          paymentUrl = chargeResponse.data.invoiceUrl;
          console.log(`[ASAAS CREDIT CARD FIX] New paymentUrl generated: ${paymentUrl}`);

        } catch (err: any) {
          console.error(`[ASAAS CREDIT CARD FIX] Error generating credit card charge:`, err.response?.data || err.message);
          // If error occurs, it will fallback to backend's paymentUrl
        }
      } else {
        // Para PIX e demais casos, usamos a lógica original (que já corrigia installments no backend)
        console.log(`[ASAAS FIX] Original paymentUrl from backend: ${paymentUrl}`);
        if (paymentUrl && paymentUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)) {
          const installmentId = paymentUrl.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)![0];
          console.log(`[ASAAS FIX] Detected installment ID: ${installmentId}`);
          try {
            console.log(`[ASAAS FIX] Fetching payments for installment using baseUrl: ${asaasBaseUrl}`);
            
            const paymentsRes = await axios.get(`${asaasBaseUrl}/payments?installment=${installmentId}`, {
              headers: { access_token: apiKey }
            });
            
            if (paymentsRes.data && paymentsRes.data.data && paymentsRes.data.data.length > 0) {
              // Find the first installment (Parcela 1)
              const firstParcela = paymentsRes.data.data.find((p: any) => p.installmentNumber === 1) || paymentsRes.data.data[0];
              paymentUrl = firstParcela.invoiceUrl;
              console.log(`[ASAAS FIX] Replaced paymentUrl with Parcela 1: ${paymentUrl}`);
            } else {
              console.log(`[ASAAS FIX] No payments found for installment ${installmentId}`);
            }
          } catch (err: any) {
            console.error(`[ASAAS FIX] Failed to fetch installment payments. Error: ${err.message}`);
            if (err.response) {
              console.error(`[ASAAS FIX] Response data:`, err.response.data);
            }
          }
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
        
        await sendWhatsAppMessage(from, msg);
      } else {
        await sendWhatsAppMessage(from, `Não foi possível gerar o link de pagamento. Digite 'Menu' para tentar novamente.`);
      }
    } else {
      await sendWhatsAppMessage(from, `Não foi possível gerar a reserva no sistema. Digite 'Menu' para tentar novamente.`);
    }
  } catch (error) {
    console.error('Error generating payment:', error);
    await sendWhatsAppMessage(from, `Ocorreu um erro ao conectar com o banco de dados de viagens. Tente novamente mais tarde.`);
  }
}

async function consultarBilhete(reservaId: string | null, documento: string | null, from: string) {
  try {
    // In a real scenario, this would query your API. We'll search local sessions first for demonstration.
    // Replace with real backend API request: axios.get(`${API_BASE_URL}/orders/find`, { params: { ... } })
    
    let whereClause: any = { ticketPdfUrl: { not: null } };
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
