import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

const APPROVED_EVENTS = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const APPROVED_STATUSES = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);

function normalizeBillingType(value?: string | null) {
  return value?.toUpperCase().replace(/[^A-Z]/g, '_') || null;
}

function normalizePaymentMethod(value?: string | null) {
  const normalized = normalizeBillingType(value);
  if (!normalized) return null;
  if (normalized.includes('CREDIT')) return 'CREDIT_CARD';
  if (normalized.includes('PIX')) return 'PIX';
  return normalized;
}

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validatePaymentAgainstOrder(order: any, payment: any) {
  const warnings: string[] = [];
  const paymentValue = toNumber(payment?.value);
  const orderValue = toNumber(order.full_price) ?? toNumber(order.price);
  const orderTax = toNumber(order.full_tax) ?? toNumber(order.tax) ?? 0;
  const expectedValue = orderValue === null ? null : Number((orderValue + orderTax).toFixed(2));

  if (paymentValue !== null && expectedValue !== null && Math.abs(paymentValue - expectedValue) > 0.01) {
    warnings.push(`valor divergente: asaas=${paymentValue} pedido=${expectedValue}`);
  }

  const paymentBillingType = normalizePaymentMethod(payment?.billingType);
  const orderBillingType = normalizePaymentMethod(order.payment_method);
  if (paymentBillingType && orderBillingType && paymentBillingType !== orderBillingType) {
    warnings.push(`billingType divergente: asaas=${paymentBillingType} pedido=${orderBillingType}`);
  }

  return warnings;
}

function formatBrazilPhone(phoneNumber: string) {
  let phone = phoneNumber.replace(/\D/g, '');
  if (phone.length === 10 || phone.length === 11) {
    phone = `55${phone}`;
  }
  return phone;
}

function formatRouteHour(hour?: Date | null) {
  return hour ? hour.toISOString().substring(11, 16) : '08:00';
}

export async function POST(req: Request) {
  try {
    const asaasToken = req.headers.get('asaas-access-token');
    if (asaasToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
      console.warn('[ASAAS WEBHOOK] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const payment = body.payment || {};
    const paymentId = payment.id;
    const externalReference = payment.externalReference;

    console.info('[ASAAS WEBHOOK] Received event', {
      event: body.event,
      paymentId,
      externalReference,
      status: payment.status,
      billingType: payment.billingType,
      value: payment.value
    });

    if (!APPROVED_EVENTS.has(body.event)) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    if (payment.status && !APPROVED_STATUSES.has(payment.status)) {
      console.warn('[ASAAS WEBHOOK] Ignored event with non-approved payment status', {
        event: body.event,
        paymentId,
        status: payment.status
      });
      return NextResponse.json({ ok: true, ignored: true, reason: 'status nao aprovado' });
    }

    if (!externalReference && !paymentId) {
      console.error('[ASAAS WEBHOOK] Missing externalReference and payment id', { event: body.event });
      return NextResponse.json({ ok: false, reason: 'sem referencia' });
    }

    let order: any = null;
    if (externalReference) {
      const orderId = parseInt(externalReference, 10);
      if (!isNaN(orderId)) {
        order = await prisma.orders.findUnique({ where: { id: BigInt(orderId) } });
      } else {
        console.warn('[ASAAS WEBHOOK] externalReference is not a numeric order id', { externalReference, paymentId });
      }
    }

    if (!order && paymentId) {
      order = await prisma.orders.findFirst({ where: { asaas_id: paymentId } });
    }

    if (!order) {
      console.error('[ASAAS WEBHOOK] Order not found for payment', { externalReference, paymentId });
      return NextResponse.json({ ok: false, reason: 'pedido nao encontrado' });
    }

    const validationWarnings = validatePaymentAgainstOrder(order, payment);
    if (validationWarnings.length > 0) {
      console.warn('[ASAAS WEBHOOK] Payment validation warnings', {
        orderId: order.id.toString(),
        paymentId,
        warnings: validationWarnings
      });
    }

    if (order.status === 'approved') {
      return NextResponse.json({ ok: true, duplicated: true, warnings: validationWarnings });
    }

    const { orderCustomers } = await prisma.$transaction(async (tx: any) => {
      const updatedOrder = await tx.orders.update({
        where: { id: order.id },
        data: {
          status: 'approved',
          ...(paymentId && !order.asaas_id ? { asaas_id: paymentId } : {})
        }
      });

      const customers = await tx.order_customers.findMany({
        where: { order_id: updatedOrder.id }
      });

      if (customers.length > 0) {
        await tx.order_customers.updateMany({
          where: { order_id: updatedOrder.id },
          data: { status: 2 }
        });

        await tx.trip_seats.updateMany({
          where: { order_customer_id: { in: customers.map((customer: any) => customer.id) } },
          data: { status: 2 }
        });
      }

      return { orderCustomers: customers };
    });

    if (order.emergency_contact_phone) {
      const route = await prisma.routes.findUnique({
        where: { id: order.route_id },
        select: { hour: true }
      });
      const phone = formatBrazilPhone(order.emergency_contact_phone);
      const confirmationSent = await sendWhatsAppMessage(phone, `Pagamento confirmado.\n\nSua passagem foi confirmada com sucesso.`);
      if (!confirmationSent) {
        console.error('[ASAAS WEBHOOK] Failed to send payment confirmation WhatsApp message', { orderId: order.id.toString(), paymentId });
      }

      const dataFormatada = order.date ? new Date(order.date.getTime() + order.date.getTimezoneOffset() * 60000).toLocaleDateString('pt-BR') : '';
      const passageiro = order.emergency_contact_name || order.username || 'Passageiro';
      const seatNumbers = orderCustomers.map((customer: any) => customer.seat_number).filter(Boolean).join(', ') || 'N/A';
      const bilheteMsg = `Seu bilhete foi emitido.\n\nPassageiro: ${passageiro}\nRota: ${order.origin} → ${order.destination}\nData: ${dataFormatada}\nHorário: ${formatRouteHour(route?.hour)}\nPoltrona: ${seatNumbers}\n\nApresente o bilhete no momento do embarque.`;
      const ticketSent = await sendWhatsAppMessage(phone, bilheteMsg);
      if (!ticketSent) {
        console.error('[ASAAS WEBHOOK] Failed to send ticket WhatsApp message', { orderId: order.id.toString(), paymentId });
      }
    }

    return NextResponse.json({ ok: true, warnings: validationWarnings });
  } catch (error) {
    console.error('Webhook Asaas Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
