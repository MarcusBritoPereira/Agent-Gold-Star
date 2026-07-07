import { NextResponse } from 'next/server';
import { processChat } from '@/lib/agent';

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
        const msgBody = body.entry[0].changes[0].value.messages[0].text?.body; // text message
        const type = body.entry[0].changes[0].value.messages[0].type;

        if (type === 'text') {
          console.log(`Received message from ${from}: ${msgBody}`);
          
          // Generate a session ID based on phone number and current date (resets daily, for example)
          // For simplicity, just use the phone number as session ID for now
          const sessionId = `session_${from}`;
          
          // Call the AI Agent asynchronously (don't block the webhook response)
          processChat(sessionId, from, msgBody).catch(console.error);
          
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
