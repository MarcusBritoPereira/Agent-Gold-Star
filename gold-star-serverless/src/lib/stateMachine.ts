import { PrismaClient } from '@prisma/client';
import { sendWhatsAppMessage, sendInteractiveButtons } from './whatsapp';
import { processChat } from './agent';
import axios from 'axios';
const prisma = new PrismaClient();

function validateName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2;
}

function validateCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  // Basic numeric check for now, can be improved
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

export async function processWebhookState(session: any, from: string, message: any) {
  const msgBody = message.type === 'text' ? message.text?.body : (message.interactive?.button_reply?.title || message.interactive?.list_reply?.title);
  
  if (!msgBody) return;

  switch (session.state) {
    case 'aguardando_nome_passageiro':
      if (!validateName(msgBody)) {
        await sendWhatsAppMessage(from, "Por favor, informe o nome completo (nome e sobrenome) igual ao documento.");
        return;
      }
      await prisma.session.update({
        where: { id: session.id },
        data: { passengerName: msgBody.trim(), state: 'aguardando_cpf_passageiro' }
      });
      await sendWhatsAppMessage(from, `Obrigado, ${msgBody.split(' ')[0]}.\n\nAgora informe o CPF do passageiro, somente números.`);
      break;

    case 'aguardando_cpf_passageiro':
      if (!validateCpf(msgBody)) {
        await sendWhatsAppMessage(from, "O CPF informado parece inválido.\n\nPor favor, envie o CPF com 11 números, sem pontos ou traços.");
        return;
      }
      await prisma.session.update({
        where: { id: session.id },
        data: { passengerCpf: msgBody.replace(/\D/g, ''), state: 'aguardando_nascimento_passageiro' }
      });
      await sendWhatsAppMessage(from, "CPF recebido.\n\nAgora informe a data de nascimento no formato DD/MM/AAAA.");
      break;

    case 'aguardando_nascimento_passageiro':
      if (!validateDate(msgBody)) {
        await sendWhatsAppMessage(from, "A data de nascimento parece inválida.\n\nEnvie no formato DD/MM/AAAA. Exemplo: 19/03/1993.");
        return;
      }
      await prisma.session.update({
        where: { id: session.id },
        data: { passengerDob: msgBody.trim(), state: 'aguardando_telefone_passageiro' }
      });
      await sendInteractiveButtons(from, "Deseja usar este número de WhatsApp como telefone de contato?", [
        { id: 'usar_whatsapp_como_telefone', title: 'Usar este número' },
        { id: 'informar_outro_telefone', title: 'Informar outro' }
      ]);
      break;

    case 'aguardando_telefone_passageiro':
      // If user typed a phone number because they clicked "Informar outro" earlier (handled in interactive)
      // Or they just typed it
      const phone = msgBody.replace(/\D/g, '');
      if (phone.length < 10) {
        await sendWhatsAppMessage(from, "Telefone inválido. Por favor, digite o DDD e o número.");
        return;
      }
      const updatedSession = await prisma.session.update({
        where: { id: session.id },
        data: { passengerPhone: msgBody.trim(), state: 'resumo_passagem' }
      });
      await enviarResumoPassagem(updatedSession, from);
      break;
      
    case 'resumo_passagem':
      await sendWhatsAppMessage(from, "Sua passagem já está no resumo. Escolha uma das opções acima para continuar.");
      break;

    default:
      // Se não tem estado reconhecido, passa para a IA
      await processChat(session.id, from, msgBody).catch(console.error);
      break;
  }
}

export async function processPayment(session: any, from: string, paymentMethod: string, installments: number = 1) {
  const API_BASE_URL = process.env.API_BASE_URL || 'https://lanchasgoldstar.com.br/api';
  try {
    let finalTripId = '1';
    let price = session.price || 0;
    let tax = session.tax || 0;

    try {
      const tripResponse = await axios.get(`${API_BASE_URL}/routes/available_seats`, {
        params: { route_id: session.routeId, date: session.tripDate, web: 'true' }
      });
      if (tripResponse.data.trip?.id) {
        finalTripId = tripResponse.data.trip.id.toString();
      }
      if (tripResponse.data.route) {
        price = tripResponse.data.route.speed_boat_price || 0;
        tax = tripResponse.data.route.tax || 0;
      }
    } catch (e) {
      console.log('Failed to fetch trip info for payment:', e);
    }

    const payload: any = {
      route_id: session.routeId,
      trip_id: finalTripId,
      date: session.tripDate,
      payment_method: paymentMethod, // mantendo pra retrocompatibilidade
      billingType: paymentMethod,
      chargeType: installments > 1 ? "INSTALLMENT" : "DETACHED",
      installment_count: installments,
      maxInstallmentCount: installments > 1 ? installments : undefined,
      dueDateLimitDays: paymentMethod === 'PIX' ? 1 : undefined,
      search_trip: "one_way",
      seat_numbers: [parseInt(session.seat)],
      name: session.passengerName,
      phone: session.passengerPhone,
      customers: { "1": session.passengerName },
      documents: { "1": session.passengerCpf },
      document_types: { "1": "cpf" },
      birthdays: { "1": session.passengerDob },
      phones: { "1": session.passengerPhone },
      data: JSON.stringify([
        { field: "speed_boat_price", quantity: 1, price: Number(price), tax: Number(tax) }
      ])
    };

    const response = await axios.post(`${API_BASE_URL}/orders/create`, payload, {
        headers: { 'Content-Type': 'application/json' }
    });

    const isSuccess = response.data.status === 'success' || response.data.status === 'ok' || response.status === 200;
    
    if (isSuccess) {
      const orderId = response.data.id || response.data.order_id;
      
      // Generate Asaas link manually
      const apiKey = (process.env.ASAAS_API_KEY || '').replace(/^\$+/, '$');
      // Default to sandbox if key has hmlg, otherwise prod
      const asaasBaseUrl = apiKey.includes('hmlg') ? 'https://sandbox.asaas.com/api/v3' : 'https://api.asaas.com/v3';
      
      const asaasPayload: any = {
        name: `Passagem Gold Star - Rota ${session.routeId}`,
        description: `Viagem em ${session.tripDate}, poltrona ${session.seat}. Passageiro: ${session.passengerName}`,
        value: Number(price) + Number(tax),
        billingType: paymentMethod,
        chargeType: installments > 1 ? 'INSTALLMENT' : 'DETACHED',
        externalReference: orderId ? String(orderId) : undefined
      };
      
      if (installments > 1) {
        asaasPayload.maxInstallmentCount = installments;
      }
      
      let paymentUrl = '';
      try {
        const asaasRes = await axios.post(`${asaasBaseUrl}/paymentLinks`, asaasPayload, {
          headers: { access_token: apiKey }
        });
        paymentUrl = asaasRes.data.url;
      } catch (err) {
        console.error('Failed to create Asaas link', err);
        // Fallback to the link provided by backend if Asaas fails
        paymentUrl = response.data.url || response.data.payment_link;
      }

      if (paymentUrl) {
        const valorTotal = (Number(price) + Number(tax)).toFixed(2).replace('.', ',');
        let sucessoMsg = `Seu link de pagamento ${paymentMethod === 'PIX' ? 'via PIX' : 'no cartão'} foi gerado.\n\nTotal: R$ ${valorTotal}\n`;
        if (installments > 1) {
          sucessoMsg += `Parcelamento: ${installments}x\n\n`;
        } else {
          sucessoMsg += '\n';
        }
        sucessoMsg += `Toque no link abaixo para pagar:\n${paymentUrl}`;
        await sendWhatsAppMessage(from, sucessoMsg);
      } else {
        await sendWhatsAppMessage(from, `Não foi possível gerar o link de pagamento. Tente novamente mais tarde.`);
      }
    } else {
      console.log('Payment success falsy, response:', response.data);
      await sendWhatsAppMessage(from, `Não foi possível gerar a reserva no sistema. Tente novamente mais tarde.`);
    }
  } catch (error: any) {
    console.error('API Error gerar_pagamento:', error.response?.data || error.message);
    await sendWhatsAppMessage(from, `Ocorreu um erro ao gerar o pagamento. Tente novamente.`);
  }
}

export async function enviarResumoPassagem(session: any, from: string) {
  // Format dates and prices
  let routeInfo = `Rota ID ${session.routeId}`;
  let taxFormated = 'R$ 0,00';
  let totalFormated = 'Valor sob consulta';
  
  const dataParts = session.tripDate?.split('-');
  const dataFormatada = dataParts && dataParts.length === 3 ? `${dataParts[2]}/${dataParts[1]}/${dataParts[0]}` : session.tripDate;

  // We should try to get the route details if we have routeId
  if (session.routeId) {
    const r = await prisma.routes.findUnique({ where: { id: parseInt(session.routeId) } });
    if (r) {
      routeInfo = `${r.origin} → ${r.destination}`;
      
      const price = Number(r.speed_boat_price || 0);
      const tax = Number(r.tax || 0);
      
      taxFormated = `R$ ${tax.toFixed(2).replace('.', ',')}`;
      totalFormated = `R$ ${(price + tax).toFixed(2).replace('.', ',')}`;

      // Salva os valores na sessão para serem usados na hora de gerar o pagamento
      await prisma.session.update({
        where: { id: session.id },
        data: { price, tax }
      });
    }
  }

  const message = `Confira os dados da sua passagem:

Passageiro: ${session.passengerName}
CPF: ${session.passengerCpf?.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
Nascimento: ${session.passengerDob}
Rota: ${routeInfo}
Data: ${dataFormatada}
Horário: ${session.hora || '08:00'}
Poltrona: ${session.seat}
Taxa de embarque: ${taxFormated}
Total: ${totalFormated}

Deseja confirmar e gerar o pagamento?`;

  await sendInteractiveButtons(from, message, [
    { id: 'gerar_pagamento', title: 'Gerar pagamento' },
    { id: 'comprar_passagem', title: 'Alterar dados' },
    { id: 'cancelar_compra', title: 'Cancelar' }
  ]);
}
