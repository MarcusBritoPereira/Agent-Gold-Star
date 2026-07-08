import axios from 'axios';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v19.0';

export async function sendWhatsAppMessage(to: string, text: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('Missing WhatsApp credentials');
    return false;
  }

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
    
    // Fallback for Brazil 9-digit issue
    if (error.response?.data?.error?.code === 131030 && to.startsWith('55') && to.length === 12) {
      console.log('Trying fallback with 9 digit...');
      const fallbackTo = to.slice(0, 4) + '9' + to.slice(4);
      try {
        const fallbackResponse = await axios.post(
          `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: fallbackTo,
            type: 'text',
            text: { body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        return fallbackResponse.data;
      } catch (fallbackError: any) {
        console.error('Fallback failed:', fallbackError.response?.data || fallbackError.message);
      }
    }
    
    return false;
  }
}

export async function sendInteractiveButtons(to: string, text: string, buttons: { id: string; title: string }[]) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('Missing WhatsApp credentials');
    return false;
  }

  const actionButtons = buttons.map(b => ({
    type: 'reply',
    reply: {
      id: b.id,
      title: b.title
    }
  }));

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: text },
          action: { buttons: actionButtons }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error sending interactive buttons:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 131030 && to.startsWith('55') && to.length === 12) {
      console.log('Trying fallback with 9 digit for buttons...');
      const fallbackTo = to.slice(0, 4) + '9' + to.slice(4);
      try {
        const fallbackResponse = await axios.post(
          `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: fallbackTo,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: text },
              action: { buttons: actionButtons }
            }
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        return fallbackResponse.data;
      } catch (fallbackError: any) {
        console.error('Fallback failed:', fallbackError.response?.data || fallbackError.message);
      }
    }
    
    return false;
  }
}

export async function sendInteractiveList(to: string, text: string, buttonText: string, items: { id: string; title: string; description?: string }[]) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.error('Missing WhatsApp credentials');
    return false;
  }

  const rows = items.map(i => ({
    id: i.id,
    title: i.title,
    ...(i.description ? { description: i.description } : {})
  }));

  try {
    const response = await axios.post(
      `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: text },
          action: {
            button: buttonText,
            sections: [
              {
                title: 'Opções',
                rows: rows
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error sending interactive list:', error.response?.data || error.message);
    
    if (error.response?.data?.error?.code === 131030 && to.startsWith('55') && to.length === 12) {
      console.log('Trying fallback with 9 digit for list...');
      const fallbackTo = to.slice(0, 4) + '9' + to.slice(4);
      try {
        const fallbackResponse = await axios.post(
          `${WHATSAPP_API_URL}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: fallbackTo,
            type: 'interactive',
            interactive: {
              type: 'list',
              body: { text: text },
              action: {
                button: buttonText,
                sections: [
                  {
                    title: 'Opções',
                    rows: rows
                  }
                ]
              }
            }
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        return fallbackResponse.data;
      } catch (fallbackError: any) {
        console.error('Fallback failed:', fallbackError.response?.data || fallbackError.message);
      }
    }
    
    return false;
  }
}
