const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = `You are a helpful assistant for Mati Carbon, a company that works with smallholder farmers using enhanced rock weathering — spreading crushed basalt rock dust on farmland to remove carbon dioxide, correct soil acidity, release nutrients, raise crop yields, and increase farmer incomes. Farmers will message you on WhatsApp with questions in Hindi, English, or Hinglish (a mix of both). Always reply in whatever mix of language the farmer used. Keep answers short, warm, and simple — assume the farmer may have limited formal education. You can explain what rock dust does to soil, why it helps crops, and how carbon removal works in general terms. For the exact quantity of rock dust or any specific change to fertilizer amount for their particular plot, do not invent a number — say that Mati's local field team will confirm the exact quantity for their land based on soil testing. If you don't know something, say so honestly and suggest they ask their local Mati field officer.`;

const FALLBACK_MESSAGE = 'Maaf kijiye, abhi thodi dikkat aa rahi hai. Kripya thodi der baad phir se try karein. (Sorry, we are having a temporary issue — please try again shortly.)';

const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(apiKey, farmerMessage) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: farmerMessage }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Gemini API error ${response.status}: ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned no text');
  }

  return text.trim();
}

async function getGeminiReply(farmerMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  try {
    return await callGemini(apiKey, farmerMessage);
  } catch (err) {
    if (err.status === 503) {
      console.warn('Gemini returned 503 (model overloaded), retrying once after delay');
      await sleep(RETRY_DELAY_MS);
      return await callGemini(apiKey, farmerMessage);
    }
    throw err;
  }
}

async function logConversation(farmerNumber, farmerMessage, botResponse) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase environment variables are not set');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { error } = await supabase.from('conversations').insert({
    farmer_number: farmerNumber,
    farmer_message: farmerMessage,
    bot_response: botResponse,
  });

  if (error) {
    throw new Error(`Supabase insert error: ${error.message}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const { Body, From } = req.body || {};

  let replyText;
  try {
    replyText = await getGeminiReply(Body || '');
  } catch (err) {
    console.error('Gemini request failed:', err);
    replyText = FALLBACK_MESSAGE;
  }

  try {
    await logConversation(From, Body, replyText);
  } catch (err) {
    console.error('Supabase logging failed:', err);
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(replyText);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
};
