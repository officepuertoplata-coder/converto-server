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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', platform: 'Converto API', version: '1.0.0' });
});

// ── AUTH ──────────────────────────────────────────────────
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
      .select('id, name, slug, admin_password, wa_enabled, meta_phone_number_id')
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
    const { data: merchant } = await supabase
      .from('merchants')
      .select('meta_phone_number_id, meta_access_token')
      .eq('id', merchant_id)
      .single();

    const phoneId = merchant?.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
    const token = merchant?.meta_access_token || process.env.META_ACCESS_TOKEN;

    let cleanTo = to.replace('whatsapp:', '').replace(/\s/g, '');
    if (cleanTo.startsWith('+')) cleanTo = cleanTo.substring(1);

    const fetch = require('node-fetch');
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
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ success: true, message_id: data.messages?.[0]?.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WHATSAPP WEBHOOK VERIFICATION ────────────────────────
app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ── WHATSAPP WEBHOOK INCOMING ─────────────────────────────
app.post('/api/whatsapp/webhook', async (req, res) => {
  res.status(200).send('OK');

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const msg of value.messages) {
          const from = msg.from;
          const text = msg.text?.body || '';
          const phoneId = value.metadata?.phone_number_id;

          const { data: merchant } = await supabase
            .from('merchants')
            .select('id, slug')
            .eq('meta_phone_number_id', phoneId)
            .single();

          // Subscriber eintragen bei Keyword
          const keywords = ['catchaltier', 'catch of the day', 'fang des tages', 'pesca del dia', 'subscribe', 'suscribir'];
          if (keywords.some(k => text.toLowerCase().includes(k))) {
            await supabase.from('subscribers').upsert({
              whatsapp_number: '+' + from,
              merchant_slug: merchant?.slug || 'sosuapesce',
              source: 'whatsapp_keyword',
              active: true
            }, { onConflict: 'whatsapp_number,merchant_slug' });
            console.log(`✅ New subscriber: +${from}`);
          }

          // Nachricht in DB speichern
          await supabase.from('messages').insert({
            merchant_id: merchant?.id,
            direction: 'inbound',
            from_number: '+' + from,
            body: text,
            wa_message_id: msg.id
          });
        }
      }
    }
  } catch (e) {
    console.error('Webhook error:', e);
  }
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
      const { data: merchant } = await supabase
        .from('merchants').select('id').eq('slug', merchantSlug).single();

      if (merchant) {
        let agentId = null;
        if (refCode) {
          const { data: agent } = await supabase
            .from('agents').select('id').eq('referral_code', refCode).single();
          agentId = agent?.id;
        }

        await supabase.from('sales').insert({
          merchant_id: merchant.id,
          agent_id: agentId,
          amount_rds: amount,
          status: 'completed',
          stripe_session_id: session.id,
          customer_email: session.customer_email
        });
      }
    } catch (e) {
      console.error('Sale recording error:', e);
    }
  }

  res.json({ received: true });
});

// ── START ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Converto API läuft auf Port ${PORT}`);
});
