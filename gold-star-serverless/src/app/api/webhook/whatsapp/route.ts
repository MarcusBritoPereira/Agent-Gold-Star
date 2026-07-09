import { NextResponse } from 'next/server';
import { handleIncomingMessage } from '@/lib/stateMachine';

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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.entry?.[0]?.changes?.[0]?.value?.statuses) {
      const status = body.entry[0].changes[0].value.statuses[0];
      if (status.status === 'failed') {
        console.error('Message failed to deliver:', JSON.stringify(status.errors));
      } else {
        console.log('Message status update:', status.status);
      }
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    if (body.object && body.entry) {
      for (const entry of body.entry) {
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value?.messages) {
              for (const message of change.value.messages) {
                const from = message.from;
                // Let the state machine handle EVERYTHING for each message
                await handleIncomingMessage(from, message);
              }
            }
          }
        }
      }
      return new NextResponse('EVENT_RECEIVED', { status: 200 });
    }

    return new NextResponse('Not a message event', { status: 200 });
  } catch (error) {
    console.error('Error handling webhook:', error);
    // Always return 200 OK so Meta doesn't retry infinitely and crash the server loop
    return new NextResponse('INTERNAL_SERVER_ERROR', { status: 200 });
  }
}
