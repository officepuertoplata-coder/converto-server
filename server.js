require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://officepuertoplata-coder.github.io/sosuapesce';

// ── SUPABASE ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HELPERS ───────────────────────────────────────────────
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function sendWhatsApp(merchantId, to, message) {
  try {
    const { data: merchant } = await supabase
      .from('merchants').select('meta_phone_number_id, meta_access_token')
      .eq('id', merchantId).single();

    const phoneId = merchant?.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
    const token = merchant?.meta_access_token || process.env.META_ACCESS_TOKEN;

    let cleanTo = to.replace('whatsapp:', '').replace(/\s/g, '');
    if (cleanTo.startsWith('+')) cleanTo = cleanTo.substring(1);

    const fetch = require('node-fetch');
    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: cleanTo,
        type: 'text', text: { body: message }
      })
    });
    const data = await response.json();
    return data.messages?.[0]?.id;
  } catch (e) {
    console.error('WhatsApp send error:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// HEALTH & AUTH
// ═══════════════════════════════════════════════════════════

app.get('/', (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.0.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.0.0' }));

app.post('/api/auth/login', async (req, res) => {
  const { slug, password, role } = req.body;
  try {
    if (role === 'superadmin') {
      if (password !== process.env.SUPERADMIN_PASSWORD)
        return res.status(401).json({ error: 'Falsches Passwort' });
      return res.json({ success: true, role: 'superadmin' });
    }
    const { data: merchant, error } = await supabase
      .from('merchants').select('id, name, slug, admin_password, wa_enabled, meta_phone_number_id')
      .eq('slug', slug).single();
    if (error || !merchant) return res.status(404).json({ error: 'Händler nicht gefunden' });
    if (merchant.admin_password !== password) return res.status(401).json({ error: 'Falsches Passwort' });
    res.json({ success: true, role: 'merchant', merchant });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// MERCHANTS
// ═══════════════════════════════════════════════════════════

app.get('/api/merchants', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants').select('id, name, slug, status, currency, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/merchants/:slug', async (req, res) => {
  const { data, error } = await supabase
    .from('merchants').select('*').eq('slug', req.params.slug).single();
  if (error) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(data);
});

// ═══════════════════════════════════════════════════════════
// PRODUKTE
// ═══════════════════════════════════════════════════════════

app.get('/api/products/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_products').select('*')
      .eq('merchant_id', req.params.merchantId)
      .order('sort_order', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_products').insert(req.body).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, product: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_products').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, product: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('merchant_products').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// SESSION CONFIG
// ═══════════════════════════════════════════════════════════

app.get('/api/session-config/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_session_config').select('*').eq('merchant_id', req.params.merchantId).single();
    if (error) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/session-config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_session_config')
      .upsert(req.body, { onConflict: 'merchant_id' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, config: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// HÄNDLER-SESSION (Tagesverfügbarkeit)
// ═══════════════════════════════════════════════════════════

app.get('/api/availability/today/:merchantId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let { data: avail } = await supabase
      .from('daily_availability').select('*, daily_products(*)')
      .eq('merchant_id', req.params.merchantId).eq('date', today).single();

    if (!avail) {
      const { data: products } = await supabase
        .from('merchant_products').select('*')
        .eq('merchant_id', req.params.merchantId).eq('available', true)
        .order('sort_order');
      return res.json({
        id: null, date: today, published: false,
        delivery_active: false, pickup_active: true, note: '',
        daily_products: (products || []).map(p => ({
          product_id: p.id, name: p.name, price_today: p.price,
          unit: p.unit, unit_label: p.unit_label,
          quantity_start: 0, quantity_left: 0, active: false
        }))
      });
    }
    res.json(avail);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/availability/yesterday/:merchantId', async (req, res) => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const { data } = await supabase
      .from('daily_availability').select('*, daily_products(*)')
      .eq('merchant_id', req.params.merchantId).eq('date', yesterday).single();
    res.json(data || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/availability', async (req, res) => {
  try {
    const { merchant_id, date, products, delivery_active,
            pickup_active, available_until, delivery_area, note } = req.body;
    const today = date || new Date().toISOString().split('T')[0];

    const { data: avail, error: availError } = await supabase
      .from('daily_availability')
      .upsert({ merchant_id, date: today, delivery_active, pickup_active,
                available_until, delivery_area, note, published: false,
                updated_at: new Date().toISOString() },
               { onConflict: 'merchant_id,date' }).select().single();

    if (availError) return res.status(400).json({ error: availError.message });

    await supabase.from('daily_products').delete().eq('availability_id', avail.id);

    if (products?.length > 0) {
      const active = products.filter(p => p.active && p.quantity_start > 0);
      if (active.length > 0) {
        await supabase.from('daily_products').insert(
          active.map((p, i) => ({
            availability_id: avail.id, merchant_id,
            product_id: p.product_id || null, name: p.name,
            price_today: p.price_today, unit: p.unit, unit_label: p.unit_label,
            quantity_start: p.quantity_start, quantity_left: p.quantity_start,
            active: true, sort_order: i
          }))
        );
      }
    }
    res.json({ success: true, availability: avail });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/availability/:id/publish', async (req, res) => {
  try {
    const { data: avail, error } = await supabase
      .from('daily_availability')
      .update({ published: true, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select('*, daily_products(*)').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, availability: avail });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// KUNDEN-SESSION
// ═══════════════════════════════════════════════════════════

app.post('/api/sessions', async (req, res) => {
  try {
    const { merchant_id, service_type, customer_wa, customer_name,
            customer_language, availability_id } = req.body;
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    const { data: session, error } = await supabase
      .from('customer_sessions')
      .insert({ token, merchant_id, service_type: service_type || 'order',
                customer_wa, customer_name, customer_language: customer_language || 'de',
                availability_id: availability_id || null,
                status: 'open', expires_at: expiresAt })
      .select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, session, url: `${BASE_URL}/session.html?s=${token}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions/:token', async (req, res) => {
  try {
    const { data: session, error } = await supabase
      .from('customer_sessions').select('*').eq('token', req.params.token).single();
    if (error || !session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (new Date(session.expires_at) < new Date() && session.status === 'open') {
      await supabase.from('customer_sessions').update({ status: 'expired' }).eq('id', session.id);
      return res.status(410).json({ error: 'Session abgelaufen' });
    }

    const { data: merchant } = await supabase
      .from('merchants').select('id, name, slug, currency').eq('id', session.merchant_id).single();
    const { data: config } = await supabase
      .from('merchant_session_config').select('*').eq('merchant_id', session.merchant_id).single();

    let availability = null;
    const today = new Date().toISOString().split('T')[0];
    const { data: avail } = await supabase
      .from('daily_availability').select('*, daily_products(*)')
      .eq('merchant_id', session.merchant_id)
      .eq(session.availability_id ? 'id' : 'date', session.availability_id || today)
      .eq('published', true).single();
    availability = avail;

    let products = [];
    if (availability?.daily_products?.length > 0) {
      products = availability.daily_products.filter(p => p.active && p.quantity_left > 0);
    } else {
      const { data: allProducts } = await supabase
        .from('merchant_products').select('*')
        .eq('merchant_id', session.merchant_id).eq('available', true)
        .order('sort_order');
      products = (allProducts || []).map(p => ({
        product_id: p.id, name: p.name, price_today: p.price,
        unit: p.unit, unit_label: p.unit_label, quantity_left: null, active: true
      }));
    }

    res.json({ session, merchant, config, availability, products });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sessions/:token', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customer_sessions')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('token', req.params.token).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, session: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sessions/:token/order', async (req, res) => {
  try {
    const { data: session } = await supabase
      .from('customer_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    const { data: order, error } = await supabase.from('orders').insert({
      session_id: session.id, merchant_id: session.merchant_id,
      customer_wa: session.customer_wa, customer_name: session.customer_name,
      items: session.items, subtotal: session.subtotal,
      delivery_fee: session.delivery_fee, total: session.total,
      delivery_type: session.delivery_type,
      delivery_address: session.delivery_address,
      note: session.note, status: 'new'
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('customer_sessions').update({ status: 'confirmed' }).eq('id', session.id);

    // WhatsApp Bestätigungen
    const itemsList = (session.items || [])
      .map(i => `  • ${i.name}: ${i.quantity} ${i.unit_label || ''} = ${i.total}€`).join('\n');

    if (session.customer_wa) {
      await sendWhatsApp(session.merchant_id, session.customer_wa,
        `✅ *Bestellung bestätigt!*\n\nBestellnr: ${order.order_number}\n\n${itemsList}\n\n💰 Gesamt: ${session.total}€\n\nWir melden uns gleich! 👋`);
    }

    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// BESTELLUNGEN
// ═══════════════════════════════════════════════════════════

app.get('/api/orders/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders').select('*').eq('merchant_id', req.params.merchantId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'delivered') updates.delivered_at = new Date().toISOString();
    if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('orders').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    const msgs = { confirmed: '✅ Bestätigt!', preparing: '👨‍🍳 Wird vorbereitet...',
                   ready: '✅ Bereit!', delivered: '🎉 Geliefert!' };
    if (data.customer_wa && msgs[status]) {
      await sendWhatsApp(data.merchant_id, data.customer_wa,
        `${msgs[status]}\nBestellnr: ${data.order_number}`);
    }
    res.json({ success: true, order: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════════════════════════

app.post('/api/broadcast', async (req, res) => {
  try {
    const { merchant_id, merchant_slug, message, availability_id } = req.body;
    const { data: subscribers } = await supabase
      .from('subscribers').select('whatsapp_number')
      .eq('merchant_slug', merchant_slug || '').eq('active', true);

    if (!subscribers?.length) return res.json({ success: true, sent: 0 });

    let sent = 0;
    for (const sub of subscribers) {
      const result = await sendWhatsApp(merchant_id, sub.whatsapp_number, message);
      if (result) sent++;
      await new Promise(r => setTimeout(r, 200));
    }

    if (availability_id) {
      await supabase.from('daily_availability')
        .update({ broadcast_sent: true }).eq('id', availability_id);
    }

    res.json({ success: true, sent, total: subscribers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// WHATSAPP
// ═══════════════════════════════════════════════════════════

app.post('/api/whatsapp/send', async (req, res) => {
  const { to, message, merchant_id } = req.body;
  try {
    const msgId = await sendWhatsApp(merchant_id, to, message);
    if (!msgId) return res.status(400).json({ error: 'Senden fehlgeschlagen' });
    res.json({ success: true, message_id: msgId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
          const text = (msg.text?.body || '').toLowerCase().trim();
          const phoneId = value.metadata?.phone_number_id;

          const { data: merchant } = await supabase
            .from('merchants').select('id, slug').eq('meta_phone_number_id', phoneId).single();
          if (!merchant) continue;

          // Nachricht speichern
          await supabase.from('comm_messages').insert({
            merchant_id: merchant.id, direction: 'inbound',
            content_type: 'text', original_text: msg.text?.body || '', source: 'whatsapp'
          }).catch(() => {});

          // Keywords
          const stopWords = ['stop', 'abmelden', 'cancelar'];
          const subWords = ['subscribe', 'anmelden', 'suscribir', 'info', 'notify'];
          const orderWords = ['bestellen', 'order', 'comprar', 'kaufen', 'pedido'];

          if (stopWords.some(k => text.includes(k))) {
            await supabase.from('subscribers')
              .update({ active: false })
              .eq('whatsapp_number', '+' + from)
              .eq('merchant_slug', merchant.slug);
            await sendWhatsApp(merchant.id, '+' + from,
              '✅ Du wurdest abgemeldet. Schreibe "INFO" um dich wieder anzumelden.');

          } else if (subWords.some(k => text.includes(k))) {
            await supabase.from('subscribers').upsert({
              whatsapp_number: '+' + from, merchant_slug: merchant.slug,
              source: 'whatsapp_keyword', active: true
            }, { onConflict: 'whatsapp_number,merchant_slug' });
            await sendWhatsApp(merchant.id, '+' + from,
              '✅ Angemeldet! Du bekommst ab sofort Benachrichtigungen.\n\nSchreibe "STOP" zum Abmelden.');

          } else if (orderWords.some(k => text.includes(k))) {
            const today = new Date().toISOString().split('T')[0];
            const { data: avail } = await supabase
              .from('daily_availability').select('id')
              .eq('merchant_id', merchant.id).eq('date', today).eq('published', true).single();

            const token = generateToken();
            await supabase.from('customer_sessions').insert({
              token, merchant_id: merchant.id, service_type: 'order',
              customer_wa: '+' + from, availability_id: avail?.id || null,
              status: 'open', expires_at: new Date(Date.now() + 4*60*60*1000).toISOString()
            });

            await sendWhatsApp(merchant.id, '+' + from,
              `👋 Hier kannst du bestellen:\n\n${BASE_URL}/session.html?s=${token}\n\n⏰ Gültig für 4 Stunden.`);
          }
        }
      }
    }
  } catch (e) { console.error('Webhook error:', e); }
});

// ═══════════════════════════════════════════════════════════
// STRIPE
// ═══════════════════════════════════════════════════════════

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) { return res.status(400).send(`Webhook Error: ${e.message}`); }

  if (event.type === 'checkout.session.completed') {
    const stripeSession = event.data.object;
    const sessionToken = stripeSession.metadata?.session_token;
    const merchantSlug = stripeSession.metadata?.merchant_slug;

    try {
      if (sessionToken) {
        const { data: cs } = await supabase
          .from('customer_sessions').select('*').eq('token', sessionToken).single();
        if (cs) {
          await supabase.from('customer_sessions')
            .update({ status: 'paid', paid_at: new Date().toISOString(),
                      stripe_session_id: stripeSession.id }).eq('id', cs.id);

          const { data: order } = await supabase.from('orders').insert({
            session_id: cs.id, merchant_id: cs.merchant_id,
            customer_wa: cs.customer_wa, items: cs.items,
            subtotal: cs.subtotal, delivery_fee: cs.delivery_fee,
            total: cs.total, delivery_type: cs.delivery_type,
            note: cs.note, status: 'new', paid_at: new Date().toISOString()
          }).select().single();

          if (cs.customer_wa && order.data) {
            await sendWhatsApp(cs.merchant_id, cs.customer_wa,
              `✅ Zahlung erhalten! Bestellnr: ${order.data.order_number}\nGesamt: ${cs.total}€\n\nDanke! 🙏`);
          }
        }
      } else if (merchantSlug) {
        const { data: merchant } = await supabase
          .from('merchants').select('id').eq('slug', merchantSlug).single();
        if (merchant) {
          await supabase.from('sales').insert({
            merchant_id: merchant.id,
            amount_rds: stripeSession.amount_total / 100,
            status: 'completed', stripe_session_id: stripeSession.id,
            customer_email: stripeSession.customer_email
          });
        }
      }
    } catch (e) { console.error('Stripe webhook error:', e); }
  }

  res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`✅ Converto API v2.0 läuft auf Port ${PORT}`);
});
