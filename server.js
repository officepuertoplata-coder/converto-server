require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── SUPABASE ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', platform: 'Converto API', version: '1.0.0' });
});

// ── AUTH ──────────────────────────────────────────────────
// Zentrales Login für alle App-Teile
app.post('/api/auth/login', async (req, res) => {
  const { slug, password, role } = req.body;
  try {
    if (role === 'superadmin') {
      if (password !== process.env.SUPERADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Falsches Passwort' });
      }
      return res.json({ success: true, role: 'superadmin' });
    }

    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, name, slug, admin_password, wa_enabled, twilio_account_sid')
      .eq('slug', slug)
      .single();

    if (error || !merchant) return res.status(404).json({ error: 'Händler nicht gefunden' });
    if (merchant.admin_password !== password) return res.status(401).json({ error: 'Falsches Passwort' });

    res.json({ success: true, role: 'merchant', merchant });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WHATSAPP SEND ─────────────────────────────────────────
app.post('/api/whatsapp/send', async (req, res) => {
  const { to, message, merchant_id } = req.body;

  try {
    // Merchant Credentials laden
    const { data: merchant } = await supabase
      .from('merchants')
      .select('meta_phone_number_id, meta_access_token')
      .eq('id', merchant_id)
      .single();

    const phoneId = merchant?.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
    const token = merchant?.meta_access_token || process.env.META_ACCESS_TOKEN;

    // Nummer bereinigen
    let cleanTo = to.replace('whatsapp:', '').replace(/\s/g, '');
    if (cleanTo.startsWith('+')) cleanTo = cleanTo.substring(1);

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanTo,
          type: 'text',
          text: { body: message }
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      console.error('Meta API error:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    res.json({ success: true, message_id: data.messages?.[0]?.id });
  } catch (e) {
    console.error('Send error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── WHATSAPP WEBHOOK (eingehende Nachrichten) ─────────────
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_TOKEN) {
    console.log('Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

app.post('/api/whatsapp/webhook', async (req, res) => {
  res.status(200).send('OK'); // Sofort antworten

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const msg of value.messages) {
          const from = msg.from; // Telefonnummer ohne +
          const text = msg.text?.body || '';
          const msgId = msg.id;
          const phoneId = value.metadata?.phone_number_id;

          // Merchant anhand Phone Number ID finden
          const { data: merchant } = await supabase
            .from('merchants')
            .select('id, slug')
            .eq('meta_phone_number_id', phoneId)
            .single();

          const merchantId = merchant?.id;

          // Broadcast-Codewort prüfen
          if (text.toLowerCase().includes('catchaltier') || 
              text.toLowerCase().includes('catch of the day') ||
              text.toLowerCase().includes('fang des tages') ||
              text.toLowerCase().includes('pesca del dia')) {
            await supabase.from('subscribers').upsert({
              whatsapp_number: '+' + from,
              merchant_slug: merchant?.slug || 'sosuapesce',
              source: 'whatsapp_keyword',
              language: detectLanguage(text)
            }, { onConflict: 'whatsapp_number,merchant_slug' });
            console.log('New subscriber:', from);
          }

          // Kontakt finden oder erstellen
          let contactId = null;
          if (merchantId) {
            const { data: existingContact } = await supabase
              .from('comm_contacts')
              .select('id')
              .eq('merchant_id', merchantId)
              .eq('whatsapp_number', '+' + from)
              .single();

            if (existingContact) {
              contactId = existingContact.id;
            } else {
              const { data: newContact } = await supabase
                .from('comm_contacts')
                .insert({
                  merchant_id: merchantId,
                  whatsapp_number: '+' + from,
                  display_name: '+' + from,
                  preferred_language: 'es'
                })
                .select('id')
                .single();
              contactId = newContact?.id;
            }
          }

          // Konversation finden oder erstellen
          let convId = null;
          if (merchantId && contactId) {
            const { data: existingConv } = await supabase
              .from('comm_conversations')
              .select('id')
              .eq('merchant_id', merchantId)
              .eq('contact_id', contactId)
              .eq('status', 'open')
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (existingConv) {
              convId = existingConv.id;
              await supabase.from('comm_conversations').update({
                last_message_at: new Date().toISOString(),
                last_message_preview: text.substring(0, 80),
                unread_count: supabase.rpc('increment', { x: 1 })
              }).eq('id', convId);
            } else {
              const { data: newConv } = await supabase
                .from('comm_conversations')
                .insert({
                  merchant_id: merchantId,
                  contact_id: contactId,
                  status: 'open',
                  last_message_at: new Date().toISOString(),
                  last_message_preview: text.substring(0, 80),
                  unread_count: 1
                })
                .select('id')
                .single();
              convId = newConv?.id;
            }
          }

          // Nachricht speichern
          if (convId) {
            await supabase.from('comm_messages').upsert({
              conversation_id: convId,
              merchant_id: merchantId,
              direction: 'in',
              content_type: 'text',
              original_text: text,
              source: 'whatsapp',
              twilio_message_sid: msgId
            }, { onConflict: 'twilio_message_sid' });
          }

          console.log(`Message from ${from}: ${text}`);
        }
      }
    }
  } catch (e) {
    console.error('Webhook error:', e);
  }
});

// ── TRANSLATION ───────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  const { text, from_lang, to_lang } = req.body;

  if (!text || from_lang === to_lang) {
    return res.json({ translated: text });
  }

  const langNames = { de: 'Deutsch', es: 'Spanisch', en: 'Englisch' };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Übersetze von ${langNames[from_lang] || from_lang} nach ${langNames[to_lang] || to_lang}. Antworte NUR mit der Übersetzung:\n\n${text}`
        }]
      })
    });

    const data = await response.json();
    const translated = data.content?.[0]?.text || text;
    res.json({ translated });
  } catch (e) {
    res.status(500).json({ error: e.message, translated: text });
  }
});

// ── STRIPE WEBHOOK ────────────────────────────────────────
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const refCode = session.client_reference_id;
    const amount = session.amount_total / 100;
    const merchantSlug = session.metadata?.merchant_slug;

    try {
      // Merchant finden
      const { data: merchant } = await supabase
        .from('merchants')
        .select('id')
        .eq('slug', merchantSlug)
        .single();

      if (merchant) {
        // Agent finden
        let agentId = null;
        if (refCode) {
          const { data: agent } = await supabase
            .from('agents')
            .select('id')
            .eq('referral_code', refCode)
            .single();
          agentId = agent?.id;
        }

        // Verkauf speichern
        await supabase.from('sales').insert({
          merchant_id: merchant.id,
          agent_id: agentId,
          amount_rds: amount,
          status: 'completed',
          stripe_session_id: session.id,
          customer_email: session.customer_email
        });

        console.log(`Sale recorded: ${amount} for merchant ${merchantSlug}`);
      }
    } catch (e) {
      console.error('Sale recording error:', e);
    }
  }

  res.json({ received: true });
});

// ── MERCHANTS API ─────────────────────────────────────────
app.get('/api/merchants', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants')
    .select('id, name, slug, status, currency, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/merchants/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('slug', req.params.slug)
    .single();

  if (error) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(data);
});

// ── HELPERS ───────────────────────────────────────────────
function detectLanguage(text) {
  const lower = text.toLowerCase();
  if (/catch of the day|check availability|order/.test(lower)) return 'en';
  if (/fang des tages|verfügbar|bestell/.test(lower)) return 'de';
  return 'es';
}

// ── START ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Converto API läuft auf Port ${PORT}`);
});
