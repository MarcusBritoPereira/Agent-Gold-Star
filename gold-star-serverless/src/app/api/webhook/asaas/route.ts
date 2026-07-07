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
      const paymentId = body.payment.id;

      // Find the order by Asaas ID
      const order = await prisma.orders.findFirst({
        where: { asaas_id: paymentId }
      });

      if (order) {
        // Update Order Status to approved
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

        // Generate text ticket (since we don't have a PDF generator here)
        const ticketMessage = `🎉 *PAGAMENTO APROVADO!* 🎉

Aqui está o seu bilhete de embarque, ${order.username}! 🎫

*Código Localizador:* ${order.code}
*Origem:* ${order.origin}
*Destino:* ${order.destination}
*Data:* ${order.date?.toLocaleDateString('pt-BR')}
*Poltrona:* ${orderCustomer?.seat_number}

Por favor, apresente este bilhete e um documento com foto no momento do embarque. Desejamos uma excelente viagem! 🚤💨`;

        // Send WhatsApp Message
        if (order.emergency_contact_phone) {
          // Format phone number to E.164 (ensure country code +55 exists)
          let phone = order.emergency_contact_phone.replace(/\D/g, '');
          if (phone.length === 10 || phone.length === 11) {
            phone = `55${phone}`;
          }

          await sendWhatsAppMessage(phone, ticketMessage);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Webhook Asaas Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
