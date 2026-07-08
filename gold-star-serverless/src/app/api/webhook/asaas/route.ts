import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export async function POST(req: Request) {
  try {
    const asaasToken = req.headers.get('asaas-access-token');
    if (asaasToken !== process.env.ASAAS_WEBHOOK_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // Check if it's a payment confirmation event
    if (body.event === 'PAYMENT_RECEIVED' || body.event === 'PAYMENT_CONFIRMED') {
      const paymentId = body.payment?.id;
      const externalReference = body.payment?.externalReference;

      if (!externalReference && !paymentId) {
        return NextResponse.json({ ok: false, reason: "sem referencia" });
      }

      // Find the order by External Reference or Asaas ID
      let order = null;
      if (externalReference) {
        const orderId = parseInt(externalReference, 10);
        if (!isNaN(orderId)) {
          order = await prisma.orders.findUnique({ where: { id: orderId } });
        }
      }
      
      if (!order && paymentId) {
        order = await prisma.orders.findFirst({
          where: { asaas_id: paymentId }
        });
      }

      if (!order) {
        return NextResponse.json({ ok: false, reason: "pedido nao encontrado" });
      }

      // Se já estiver pago e bilhete já enviado, não faz nada
      if (order.status === 'approved') {
        return NextResponse.json({ ok: true, duplicated: true });
      }

      // Marcar como pago
      await prisma.orders.update({
        where: { id: order.id },
        data: { status: 'approved' }
      });

      // Find the order customer to update status
      const orderCustomer = await prisma.order_customers.findFirst({
        where: { order_id: order.id }
      });

      if (orderCustomer) {
        await prisma.order_customers.update({
          where: { id: orderCustomer.id },
          data: { status: 2 } // 2 = Approved
        });

        // Find the trip seat to update status
        const tripSeat = await prisma.trip_seats.findFirst({
          where: { order_customer_id: orderCustomer.id }
        });

        if (tripSeat) {
          await prisma.trip_seats.update({
            where: { id: tripSeat.id },
            data: { status: 2 } // 2 = Approved
          });
        }
      }

      // Send WhatsApp Messages
      if (order.emergency_contact_phone) {
        // Format phone number to E.164 (ensure country code +55 exists)
        let phone = order.emergency_contact_phone.replace(/\D/g, '');
        if (phone.length === 10 || phone.length === 11) {
          phone = `55${phone}`;
        }

        // Mensagem 1: Confirmação
        await sendWhatsAppMessage(phone, `Pagamento confirmado.\n\nSua passagem foi confirmada com sucesso.`);

        // Mensagem 2: Bilhete
        // Convert dates correctly accounting for UTC if needed
        const dataFormatada = order.date ? new Date(order.date.getTime() + order.date.getTimezoneOffset() * 60000).toLocaleDateString('pt-BR') : '';
        const passageiro = order.emergency_contact_name || order.username || 'Passageiro';
        
        const bilheteMsg = `Seu bilhete foi emitido.\n\nPassageiro: ${passageiro}\nRota: ${order.origin} → ${order.destination}\nData: ${dataFormatada}\nHorário: 08:00\nPoltrona: ${orderCustomer?.seat_number || 'N/A'}\n\nApresente o bilhete no momento do embarque.`;
        await sendWhatsAppMessage(phone, bilheteMsg);
        
        // Mensagem 3: PDF (Current workaround since no PDF generator is available)
        // In the future: await sendWhatsAppDocument(phone, ticket.pdfUrl, `bilhete_${order.id}.pdf`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook Asaas Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
