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

// ═══════════════════════════════════════════════════════════
// RESEND HELPERS
// ═══════════════════════════════════════════════════════════

async function sendResendBroadcast(merchantId, subject, htmlContent, fromName) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) { console.log('RESEND_API_KEY fehlt'); return null; }

    const { data: subscribers } = await supabase
      .from('subscribers').select('email, name')
      .eq('merchant_id', merchantId).eq('status', 'active')
      .not('email', 'is', null);

    if (!subscribers || subscribers.length === 0) {
      console.log('Keine E-Mail Subscriber für:', merchantId);
      return 'no_subscribers';
    }

    console.log('Sending to', subscribers.length, 'subscribers via Resend');
    const fetch = require('node-fetch');
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const from = (fromName || 'Converto') + ' <' + fromEmail + '>';

    const batches = [];
    for (let i = 0; i < subscribers.length; i += 100) batches.push(subscribers.slice(i, i + 100));

    let totalSent = 0;
    for (const batch of batches) {
      const emails = batch.map(sub => ({ from, to: [sub.email], subject, html: htmlContent }));
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(emails)
      });
      const data = await res.json();
      console.log('Resend batch response:', JSON.stringify(data));
      if (data.data) totalSent += data.data.length;
    }
    return totalSent;
  } catch(e) { console.error('Resend broadcast error:', e.message); return null; }
}

// ═══════════════════════════════════════════════════════════
// OTHER HELPERS
// ═══════════════════════════════════════════════════════════

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function sendWhatsApp(merchantId, to, message) {
  try {
    const { data: merchant } = await supabase
      .from('merchants').select('meta_phone_number_id, meta_access_token')
      .eq('id', merchantId).single();

    const phoneId = merchant?.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
    const token   = merchant?.meta_access_token    || process.env.META_ACCESS_TOKEN;
    console.log('sendWhatsApp:', { to, phoneId: phoneId?.substring(0,8), hasToken: !!token });

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
    console.log('WhatsApp API response:', JSON.stringify(data));
    return data.messages?.[0]?.id;
  } catch (e) { console.error('WhatsApp send error:', e); return null; }
}

// ═══════════════════════════════════════════════════════════
// HEALTH & AUTH
// ═══════════════════════════════════════════════════════════

app.get('/',           (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.0.1' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.0.1' }));

// ── AUTH LOGIN (users table + legacy merchant login) ──────
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });
  try {
    // 0. Superadmin ENV Fallback (funktioniert auch ohne users Tabelle)
    if (username.toLowerCase() === 'admin' && process.env.SUPERADMIN_PASSWORD && password === process.env.SUPERADMIN_PASSWORD) {
      const { data: merchants } = await supabase.from('merchants').select('id, name, slug, status').order('name');
      return res.json({ success: true, role: 'superadmin',
        user: { id: 'superadmin', name: 'Superadmin', username: 'admin' },
        merchants: merchants || [] });
    }

    // 1. Users Tabelle prüfen
    const { data: user, error: uErr } = await supabase
      .from('users').select('*').eq('username', username.toLowerCase().trim()).single();

    if (user && !uErr) {
      if (!user.active) return res.status(401).json({ error: 'Account deaktiviert' });
      if (user.password !== password) return res.status(401).json({ error: 'Falsches Passwort' });

      // Last login updaten
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

      if (user.role === 'superadmin') {
        // Alle Händler laden
        const { data: merchants } = await supabase
          .from('merchants').select('id, name, slug, status').order('name');
        return res.json({ success: true, role: 'superadmin', user: { id: user.id, name: user.name, username: user.username }, merchants: merchants || [] });
      }

      if (user.role === 'staff') {
        // Zugewiesene Händler laden
        const { data: access } = await supabase
          .from('user_merchant_access')
          .select('merchant_id, merchants(id, name, slug, status)')
          .eq('user_id', user.id);
        const merchants = (access || []).map(a => a.merchants).filter(Boolean);
        return res.json({ success: true, role: 'staff', user: { id: user.id, name: user.name, username: user.username }, merchants });
      }

      if (user.role === 'merchant') {
        // Eigenen Händler laden
        const { data: merchant } = await supabase
          .from('merchants').select('*').eq('id', user.merchant_id).single();
        return res.json({ success: true, role: 'merchant', user: { id: user.id, name: user.name, username: user.username }, merchant });
      }
    }

    // 2. Legacy: Merchant slug/password Login (für bestehende admin.html compatibility)
    const { data: merchant, error: mErr } = await supabase
      .from('merchants').select('id, name, slug, admin_password, wa_enabled, meta_phone_number_id')
      .eq('slug', username).single();
    if (!mErr && merchant && merchant.admin_password === password) {
      return res.json({ success: true, role: 'merchant', merchant, legacy: true });
    }

    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── USER MANAGEMENT (Superadmin) ───────────────────────────
app.get('/api/users', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users')
      .select('id, username, role, name, email, active, merchant_id, last_login, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, role, name, email, merchant_id, merchant_ids } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Username, Passwort und Rolle erforderlich' });

    const { data: user, error } = await supabase.from('users')
      .insert({ username: username.toLowerCase().trim(), password, role, name, email, merchant_id: merchant_id || null })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Staff: Händler-Zugriff setzen
    if (role === 'staff' && merchant_ids?.length > 0) {
      await supabase.from('user_merchant_access').insert(
        merchant_ids.map(mid => ({ user_id: user.id, merchant_id: mid }))
      );
    }
    res.json({ success: true, user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { password, name, email, active, merchant_id, merchant_ids } = req.body;
    const updates = {};
    if (password)  updates.password = password;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (active !== undefined) updates.active = active;
    if (merchant_id !== undefined) updates.merchant_id = merchant_id;

    const { data, error } = await supabase.from('users').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Staff Händler-Zugriff updaten
    if (merchant_ids !== undefined) {
      await supabase.from('user_merchant_access').delete().eq('user_id', req.params.id);
      if (merchant_ids.length > 0) {
        await supabase.from('user_merchant_access').insert(
          merchant_ids.map(mid => ({ user_id: req.params.id, merchant_id: mid }))
        );
      }
    }
    res.json({ success: true, user: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Händler anlegen (Superadmin)
app.post('/api/merchants', async (req, res) => {
  try {
    const { name, slug, admin_password, currency, wa_number, description } = req.body;
    if (!name || !slug || !admin_password) return res.status(400).json({ error: 'Name, Slug und Passwort erforderlich' });
    const { data, error } = await supabase.from('merchants')
      .insert({ name, slug: slug.toLowerCase().trim(), admin_password, currency: currency || 'EUR', wa_number: wa_number || null, description: description || null, status: 'active' })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, merchant: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/merchants/:id', async (req, res) => {
  try {
    const updates = req.body;
    delete updates.id;
    const { data, error } = await supabase.from('merchants').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, merchant: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const { data, error } = await supabase.from('merchant_products').insert(req.body).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, product: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('merchant_products').update(req.body).eq('id', req.params.id).select().single();
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
        .order('sort_order', { ascending: true });
      return res.json({
        id: null, date: today, published: false,
        delivery_active: false, pickup_active: true, note: '',
        available_until: '17:00',
        daily_products: (products || []).map(p => ({
          product_id: p.id, name: p.name, price_today: p.price || 0,
          unit: p.unit || 'piece', unit_label: p.unit_label || 'Stück',
          quantity_start: 0, quantity_left: 0, active: false,
          step_quantity: p.step_quantity || 0.5
        }))
      });
    }

    if (!avail.daily_products || avail.daily_products.length === 0) {
      const { data: products } = await supabase
        .from('merchant_products').select('*')
        .eq('merchant_id', req.params.merchantId).eq('available', true)
        .order('sort_order', { ascending: true });
      avail.daily_products = (products || []).map(p => ({
        product_id: p.id, name: p.name, price_today: p.price || 0,
        unit: p.unit || 'piece', unit_label: p.unit_label || 'Stück',
        quantity_start: 0, quantity_left: 0, active: false,
        step_quantity: p.step_quantity || 0.5
      }));
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
    const token     = generateToken();
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

    const today = new Date().toISOString().split('T')[0];
    const { data: avail } = await supabase
      .from('daily_availability').select('*, daily_products(*)')
      .eq('merchant_id', session.merchant_id)
      .eq(session.availability_id ? 'id' : 'date', session.availability_id || today)
      .eq('published', true).single();

    let products = [];
    if (avail?.daily_products?.length > 0) {
      products = avail.daily_products.filter(p => p.active && p.quantity_left > 0);
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
    res.json({ session, merchant, config, availability: avail || null, products });
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
      delivery_type: session.delivery_type, delivery_address: session.delivery_address,
      note: session.note, status: 'new'
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });

    await supabase.from('customer_sessions').update({ status: 'confirmed' }).eq('id', session.id);

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
    const { merchant_id, message, availability_id, recipients } = req.body;
    let query = supabase.from('subscribers').select('whatsapp, email')
      .eq('merchant_id', merchant_id).eq('active', true);
    if (recipients !== 'all') query = query.neq('status', 'pending');
    const { data: subscribers } = await query;
    if (!subscribers?.length) return res.json({ success: true, sent: 0 });
    let sent = 0;
    for (const sub of subscribers) {
      if (sub.whatsapp) {
        const result = await sendWhatsApp(merchant_id, sub.whatsapp, message);
        if (result) sent++;
        await new Promise(r => setTimeout(r, 200));
      }
    }
    if (availability_id) {
      await supabase.from('daily_availability').update({ broadcast_sent: true }).eq('id', availability_id);
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
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
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
    console.log('Webhook received:', JSON.stringify(body).substring(0, 300));
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        console.log('Change field:', change.field, 'has messages:', !!value?.messages, 'msgs count:', value?.messages?.length);
        if (!value?.messages) continue;

        for (const msg of value.messages) {
          const from    = msg.from;
          const text    = (msg.text?.body || '').toLowerCase().trim();
          const phoneId = value.metadata?.phone_number_id;
          const msgType = msg.type; // text | image | audio | video | document

          // ── BILD EMPFANGEN → Verkaufsreport ────────────
          if (msgType === 'image' && msg.image?.id) {
            console.log('VK: Image received from', from, 'media_id:', msg.image.id);
            try {
              // Merchant finden (für WhatsApp-Antwort)
              const { data: merchant } = await supabase
                .from('merchants').select('id').eq('meta_phone_number_id', phoneId).single();
              const merchantId = merchant?.id || null;
              await vkHandleWhatsAppImage(from, msg.image.id, merchantId);
            } catch(e) { console.error('VK image handler error:', e.message); }
            continue; // Nicht weiter verarbeiten
          }

          // Merchant per phone_number_id finden
          const { data: merchant, error: mErr } = await supabase
            .from('merchants').select('id, name, slug').eq('meta_phone_number_id', phoneId).single();
          console.log('Merchant lookup phoneId:', phoneId, 'found:', merchant?.id, 'error:', mErr?.message);
          if (!merchant) continue;

          // Nachricht in comm_messages speichern (Fehler ignorieren)
          try {
            await supabase.from('comm_messages').insert({
              merchant_id:  merchant.id,
              direction:    'inbound',
              content_type: 'text',
              original_text: msg.text?.body || '',
              source:       'whatsapp'
            });
          } catch(e) { console.log('comm_messages insert skipped:', e.message); }

          const stopWords  = ['stop', 'abmelden', 'cancelar'];
          const subWords   = ['subscribe', 'anmelden', 'suscribir', 'info', 'notify'];
          const orderWords = ['bestellen', 'order', 'comprar', 'kaufen', 'pedido'];

          if (stopWords.some(k => text.includes(k))) {
            // ── ABMELDEN ──────────────────────────────────
            await supabase.from('subscribers')
              .update({ active: false, status: 'inactive', opted_out_at: new Date().toISOString() })
              .eq('whatsapp', '+' + from).eq('merchant_id', merchant.id);
            await sendWhatsApp(merchant.id, '+' + from,
              '✅ Du wurdest abgemeldet. Schreibe "INFO" um dich wieder anzumelden.');

          } else if (['ja','yes','si','sí'].includes(text)) {
            // ── OPT-IN BESTÄTIGEN ─────────────────────────
            let pending = null;
            try {
              const { data } = await supabase.from('subscribers')
                .select('id').eq('whatsapp', '+' + from)
                .eq('merchant_id', merchant.id).eq('status', 'pending').single();
              pending = data;
            } catch(e) { /* kein pending subscriber */ }

            if (pending) {
              await supabase.from('subscribers')
                .update({
                  active: true, status: 'active',
                  opted_in_at: new Date().toISOString(),
                  consent_text: 'Kunde hat JA geantwortet. Zeitstempel: ' + new Date().toISOString()
                }).eq('id', pending.id);
              await sendWhatsApp(merchant.id, '+' + from,
                '✅ Perfekt! Du bist jetzt angemeldet und bekommst unser Tagesangebot direkt per WhatsApp.\n\nSchreibe jederzeit STOP zum Abmelden. 🙏');
            }

          } else if (subWords.some(k => text.includes(k))) {
            // ── OPT-IN ANFRAGE ────────────────────────────
            const mName = merchant.name || 'uns';
            try {
              await supabase.from('subscribers').upsert({
                whatsapp: '+' + from, merchant_id: merchant.id,
                source: 'whatsapp_keyword', active: false, status: 'pending'
              }, { onConflict: 'whatsapp,merchant_id' });
            } catch(e) { console.log('subscribers upsert error:', e.message); }

            await sendWhatsApp(merchant.id, '+' + from,
              '👋 Hallo! Möchtest du das Tagesangebot von ' + mName + ' per WhatsApp erhalten?\n\n' +
              'Du bekommst täglich:\n🛒 Aktuelle Produkte & Preise\n🔗 Direkt-Bestelllink\n\n' +
              'Antworte JA zum Bestätigen\nSchreibe STOP zum Ablehnen');

          } else if (orderWords.some(k => text.includes(k))) {
            // ── BESTELLUNG ────────────────────────────────
            const today = new Date().toISOString().split('T')[0];
            let availId = null;
            try {
              const { data: avail } = await supabase
                .from('daily_availability').select('id')
                .eq('merchant_id', merchant.id).eq('date', today).eq('published', true).single();
              availId = avail?.id || null;
            } catch(e) { /* keine availability */ }

            const token = generateToken();
            try {
              await supabase.from('customer_sessions').insert({
                token, merchant_id: merchant.id, service_type: 'order',
                customer_wa: '+' + from, availability_id: availId,
                status: 'open', expires_at: new Date(Date.now() + 4*60*60*1000).toISOString()
              });
            } catch(e) { console.log('session insert error:', e.message); }

            await sendWhatsApp(merchant.id, '+' + from,
              `👋 Hier kannst du bestellen:\n\n${BASE_URL}/session.html?s=${token}\n\n⏰ Gültig für 4 Stunden.`);
          }
        }
      }
    }
  } catch (e) { console.error('Webhook error:', e); }
});

// ═══════════════════════════════════════════════════════════
// EMAIL ENDPOINTS (Resend)
// ═══════════════════════════════════════════════════════════

app.post('/api/email/subscribe', async (req, res) => {
  try {
    const { email, name, merchant_id, merchant_slug } = req.body;
    if (!email) return res.status(400).json({ error: 'Email fehlt' });
    let mId = merchant_id;
    if (!mId && merchant_slug) {
      const { data: m } = await supabase.from('merchants').select('id').eq('slug', merchant_slug).single();
      mId = m?.id;
    }
    if (!mId) return res.status(400).json({ error: 'Merchant nicht gefunden' });
    const { data, error } = await supabase.from('subscribers').upsert({
      email, name: name || '', merchant_id: mId,
      channel: 'email', status: 'active', active: true,
      opted_in_at: new Date().toISOString()
    }, { onConflict: 'email,merchant_id' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, subscriber: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mailerlite/daily-offer', async (req, res) => {
  try {
    const { merchant_id, products, note, merchant_name, wa_number } = req.body;
    const waLink = wa_number
      ? 'https://wa.me/' + wa_number.replace('+', '') + '?text=Bestellen'
      : null;

    const productRows = (products || []).map(p =>
      '<tr>' +
      '<td style="padding:8px 0;border-bottom:1px solid #f0f0f0">' + p.name + '</td>' +
      '<td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#2d7a4f">' +
      (p.price_today || 0).toFixed(2) + '€ ' + (p.unit_label || '') + '</td>' +
      '</tr>'
    ).join('');

    const waButton = waLink
      ? '<a href="' + waLink + '" style="display:inline-block;background:#25d366;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-top:20px">💬 Jetzt per WhatsApp bestellen</a>'
      : '';

    const today = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
    <div style="background:#1b4332;color:#fff;padding:28px 32px">
      <div style="font-size:22px;font-weight:800">🐟 ${merchant_name}</div>
      <div style="font-size:14px;opacity:.7;margin-top:4px">${today}</div>
    </div>
    <div style="padding:28px 32px">
      <div style="font-size:18px;font-weight:700;color:#1b4332;margin-bottom:16px">Unser heutiges Angebot 🎣</div>
      ${note ? '<div style="background:#f0fdf4;border-left:3px solid #2d7a4f;padding:10px 14px;border-radius:4px;font-size:14px;color:#1b4332;margin-bottom:16px">' + note + '</div>' : ''}
      <table style="width:100%;border-collapse:collapse">${productRows}</table>
      <div style="text-align:center">${waButton}</div>
    </div>
    <div style="background:#f9f9f9;padding:16px 32px;font-size:12px;color:#999;text-align:center">
      Du erhältst diese E-Mail weil du dich für unser Tagesangebot angemeldet hast.
    </div>
  </div>
</body></html>`;

    const subject = '🐟 ' + merchant_name + ' – Angebot ' + today;
    const sent    = await sendResendBroadcast(merchant_id, subject, html, merchant_name);
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
    const sessionToken  = stripeSession.metadata?.session_token;
    const merchantSlug  = stripeSession.metadata?.merchant_slug;
    try {
      if (sessionToken) {
        const { data: cs } = await supabase
          .from('customer_sessions').select('*').eq('token', sessionToken).single();
        if (cs) {
          await supabase.from('customer_sessions')
            .update({ status: 'paid', paid_at: new Date().toISOString(),
                      stripe_session_id: stripeSession.id }).eq('id', cs.id);
          const { data: order } = await supabase.from('orders').insert({
            session_id: cs.id, merchant_id: cs.merchant_id, customer_wa: cs.customer_wa,
            items: cs.items, subtotal: cs.subtotal, delivery_fee: cs.delivery_fee,
            total: cs.total, delivery_type: cs.delivery_type, note: cs.note,
            status: 'new', paid_at: new Date().toISOString()
          }).select().single();
          if (cs.customer_wa && order) {
            await sendWhatsApp(cs.merchant_id, cs.customer_wa,
              `✅ Zahlung erhalten! Bestellnr: ${order.order_number}\nGesamt: ${cs.total}€\n\nDanke! 🙏`);
          }
        }
      } else if (merchantSlug) {
        const { data: merchant } = await supabase
          .from('merchants').select('id').eq('slug', merchantSlug).single();
        if (merchant) {
          await supabase.from('sales').insert({
            merchant_id: merchant.id, amount_rds: stripeSession.amount_total / 100,
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
// SUBSCRIBERS
// ═══════════════════════════════════════════════════════════

app.get('/api/subscribers/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers').select('*')
      .eq('merchant_id', req.params.merchantId)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/subscribers/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('subscribers').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, subscriber: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/subscribers', async (req, res) => {
  try {
    const { data, error } = await supabase.from('subscribers').insert(req.body).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, subscriber: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// LANDINGPAGE
// ═══════════════════════════════════════════════════════════

// Seite laden
app.get('/api/pages/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('merchant_pages').select('*')
      .eq('merchant_id', req.params.merchantId).single();
    if (error) return res.status(404).json({ error: 'Keine Seite gefunden' });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Seite speichern
app.post('/api/pages', async (req, res) => {
  try {
    const { merchant_id, slug, html_content, settings_json, published } = req.body;
    if (!merchant_id || !html_content) return res.status(400).json({ error: 'merchant_id und html_content erforderlich' });

    // Check if page exists → INSERT or UPDATE
    const { data: existing } = await supabase
      .from('merchant_pages').select('id').eq('merchant_id', merchant_id).maybeSingle();

    let data, error;
    if (existing?.id) {
      ({ data, error } = await supabase
        .from('merchant_pages')
        .update({ slug, html_content,
          settings_json: settings_json || {},
          published: published || false,
          updated_at: new Date().toISOString() })
        .eq('merchant_id', merchant_id).select().single());
    } else {
      ({ data, error } = await supabase
        .from('merchant_pages')
        .insert({ merchant_id, slug, html_content,
          settings_json: settings_json || {},
          published: published || false })
        .select().single());
    }

    if (error) { console.error("Pages save error:", error.message); return res.status(400).json({ error: error.message }); }
    console.log('Page saved OK for:', merchant_id);
    res.json({ success: true, page: data });
  } catch(e) { console.error("Pages save exception:", e.message); res.status(500).json({ error: e.message }); }
});

// Dokument analysieren (Base64 → Claude → extrahierter Text)
app.post('/api/pages/extract-doc', async (req, res) => {
  try {
    const { base64, media_type, filename } = req.body;
    if (!base64) return res.status(400).json({ error: 'base64 fehlt' });

    const fetch = require('node-fetch');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: media_type || 'application/pdf', data: base64 }
            },
            {
              type: 'text',
              text: 'Extrahiere alle relevanten Informationen aus diesem Dokument für eine Firmen-Landingpage. Strukturiere die Ausgabe: Firmenname, Beschreibung, Leistungen, Zielgruppe, USP, Kontakt, Zahlen/Statistiken, Referenzen. Nur die extrahierten Infos, kein Kommentar.'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    const extracted = data.content?.[0]?.text || '';
    console.log('Doc extracted:', filename, extracted.substring(0, 100));
    res.json({ success: true, extracted });
  } catch(e) {
    console.error('extract-doc error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Website URL analysieren → Claude extrahiert Content
app.post('/api/pages/extract-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL fehlt' });

    console.log('Fetching URL:', url);
    const fetch = require('node-fetch');

    // Website laden
    const webRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConverdinoBot/1.0)' },
      timeout: 10000
    });

    if (!webRes.ok) throw new Error('Website nicht erreichbar: ' + webRes.status);

    let html = await webRes.text();

    // HTML bereinigen – nur Text behalten
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .substring(0, 8000);

    if (!text || text.length < 50) throw new Error('Kein lesbarer Inhalt gefunden');

    // Claude extrahiert relevante Infos
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Analysiere diesen Website-Inhalt und extrahiere alle relevanten Informationen für eine Landingpage. 

WEBSITE INHALT:
${text}

Strukturiere die Ausgabe klar:
- Firmenname:
- Beschreibung (was das Unternehmen macht):
- Leistungen/Produkte:
- Zielgruppe:
- USP / Alleinstellungsmerkmale:
- Kontaktdaten (Tel, Email, Adresse):
- Zahlen & Statistiken (falls vorhanden):
- Referenzen/Kunden (falls vorhanden):
- Besondere Phrasen oder Slogans:

Nur die extrahierten Informationen, kein Kommentar.`
        }]
      })
    });

    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message);

    const extracted = aiData.content?.[0]?.text || '';
    console.log('URL extracted:', url, 'chars:', extracted.length);
    res.json({ success: true, extracted, url });

  } catch(e) {
    console.error('extract-url error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Seite löschen
app.delete('/api/pages/:merchantId', async (req, res) => {
  try {
    const { error } = await supabase
      .from('merchant_pages').delete().eq('merchant_id', req.params.merchantId);
    if (error) return res.status(400).json({ error: error.message });
    console.log('Page deleted for merchant:', req.params.merchantId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CHAT PATCH: Seite direkt anpassen + speichern ──────────
app.post('/api/pages/chat-patch', async (req, res) => {
  try {
    const { merchant_id, prompt, html } = req.body;
    if (!prompt || !html) return res.status(400).json({ error: 'prompt und html erforderlich' });

    const fetch = require('node-fetch');

    // Nur die relevante Section finden und patchen
    // Claude bekommt das volle HTML und gibt das volle geänderte HTML zurück
    // Mit streaming-freundlichem Ansatz: erst komprimieren
    const compressedHtml = html
      .replace(/\s{3,}/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, '');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
        system: 'Du bist ein Frontend-Entwickler. Du bekommst eine HTML-Seite und eine Aufgabe. Gib NUR das vollständige geänderte HTML zurück, beginnend mit <!DOCTYPE html>. Keine Erklärungen, kein Markdown.',
        messages: [{
          role: 'user',
          content: `AUFGABE: ${prompt}

HTML:
${compressedHtml.substring(0, 12000)}`
        }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let newHtml = data.content?.[0]?.text || '';
    const doctypeIdx = newHtml.indexOf('<!DOCTYPE');
    if (doctypeIdx > 0) newHtml = newHtml.substring(doctypeIdx);
    if (!newHtml.startsWith('<!DOCTYPE') && !newHtml.startsWith('<html'))
      throw new Error('Ungültige Antwort');

    console.log('Chat patch for merchant:', merchant_id, 'chars:', newHtml.length);

    // Sofort in Supabase speichern wenn merchant_id vorhanden
    if (merchant_id) {
      const { data: existing } = await supabase
        .from('merchant_pages').select('id').eq('merchant_id', merchant_id).maybeSingle();
      if (existing?.id) {
        await supabase.from('merchant_pages')
          .update({ html_content: newHtml, updated_at: new Date().toISOString() })
          .eq('merchant_id', merchant_id);
      }
      console.log('Chat patch saved to Supabase');
    }

    res.json({ success: true, html: newHtml });
  } catch(e) {
    console.error('chat-patch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Landingpage generieren via Claude AI
app.post('/api/pages/generate', async (req, res) => {
  try {
    const { merchant_id, settings, extracted_text, prompt, images } = req.body;
    const s = settings || {};
    const fetch = require('node-fetch');

    // ── SYSTEM PROMPT ──────────────────────────────────
    const systemPrompt = `Du bist ein Experte für hochwertige Landingpage Erstellung.
Du gibst NUR valides, vollständiges HTML zurück – keine Erklärungen, kein Markdown, keine Backticks.
Das HTML muss eigenständig funktionieren (inline CSS, Google Fonts erlaubt).
Erstelle professionelle, conversion-optimierte Landingpages ohne leere weiße Bereiche.`;

    // ── FARBEN & SPRACHE ────────────────────────────────
    const color1 = s.color1 || s.primary_color || '#1b4332';
    const color2 = s.color2 || '#25D366';
    const color3 = s.color3 || '#f4a100';
    const color4 = s.color4 || '#ffffff';
    const langs      = Array.isArray(s.languages) ? s.languages : [s.language || 'de'];
    const isMultilang = langs.length > 1;
    const langNames  = { de: 'Deutsch', en: 'English', es: 'Español' };
    const langLabel  = langs.map(l => langNames[l] || l).join(' + ');
    const sections   = s.sections || 'Hero, Leistungen, Über uns, Kontakt';
      // Texte kürzen um Timeout zu vermeiden
      if (s.description && s.description.length > 500) s.description = s.description.substring(0, 500);
      if (s.services && s.services.length > 300) s.services = s.services.substring(0, 300);

    // ── BILDER CONTENT BLOCKS ───────────────────────────
    const imgBlocks = [];
    const imgInstructions = [];
    if (images && images.length > 0) {
      images.forEach((img, i) => {
        if (img.base64 && img.base64.length > 100) {
          imgBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.base64 }
          });
          const placement = img.role === 'logo'
            ? 'LOGO: Verwende dieses Bild als Firmen-Logo in der Navigation und im Footer. Exakter HTML: <img src="data:' + (img.media_type||'image/jpeg') + ';base64,' + img.base64 + '" style="height:40px;object-fit:contain" alt="Logo">'
            : img.role === 'hero'
            ? 'HERO BILD: Verwende dieses Bild als Hero-Hintergrund oder Hero-Hauptbild. Als Background: background-image:url(data:' + (img.media_type||'image/jpeg') + ';base64,' + img.base64 + ');background-size:cover'
            : `BILD ${i+1} (${img.label||'Zusatzbild'}): Verwende dieses Bild im passenden Abschnitt (Bild-Tag mit base64 src).`;
          imgInstructions.push(placement);
        }
      });
    }
    const imgNote = imgInstructions.length > 0
      ? '\n\nBILDER (PFLICHT - alle verwenden):\n' + imgInstructions.join('\n')
      : '';

    // ── PROMPT AUFBAUEN ─────────────────────────────────
    let userPrompt = '';

    if (prompt && extracted_text && extracted_text.length > 500) {
      // CHAT-MODUS: nur JS-Patch zurückgeben, kein neues HTML
      userPrompt = `Du bist ein Frontend-Entwickler. Du bekommst eine Aufgabe zur Anpassung einer Webseite.

AUFGABE: ${prompt}

Gib NUR reines JavaScript zurück das die Änderung per DOM-Manipulation umsetzt.
REGELN:
- Kein HTML, kein CSS-Block, keine Erklärungen, keine Backticks, kein Markdown
- Nur ausführbarer JS-Code der sofort läuft
- Nutze document.querySelector/querySelectorAll um Elemente zu finden
- Für Stil-Änderungen: element.style.xxx = '...'
- Für neue Elemente: createElement + appendChild
- Für Text-Änderungen: element.textContent = '...' oder innerHTML

BEISPIEL für "Füge Text unter WhatsApp Button":
const wa = document.querySelector('a[href*="wa.me"]');
if(wa){const t=document.createElement('div');t.style.cssText='position:fixed;bottom:90px;right:16px;font-size:11px;color:#25D366;font-weight:800;z-index:9999;text-align:center;';t.textContent='Schreib mit uns';document.body.appendChild(t);}

Gib NUR den JavaScript-Code zurück, nichts anderes.`;
    } else {
      // NEU GENERIEREN
      const waNum = s.whatsapp ? s.whatsapp.replace(/[^0-9]/g,'') : '';
      const waBtn = waNum ? `<a href="https://wa.me/${waNum}?text=Hallo%2C%20ich%20interessiere%20mich" style="position:fixed;bottom:24px;right:24px;z-index:9999;width:60px;height:60px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(37,211,102,0.5);text-decoration:none"><svg width="28" height="28" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg></a>` : '';

      userPrompt = `Erstelle eine vollständige, professionelle HTML Landingpage:

FIRMA: ${s.company_name || 'Unbekannt'}
BRANCHE: ${s.industry || 'Allgemein'}
BESCHREIBUNG: ${s.description || ''}
ZIELGRUPPE: ${s.target_audience || ''}
USP: ${s.usp || ''}
LEISTUNGEN: ${s.services || ''}
CTA: ${s.cta || 'Jetzt anfragen'}
WHATSAPP: ${s.whatsapp || ''}
EMAIL: ${s.email || ''}
BUCHUNGSLINK: ${s.booking_link || ''}
STIL: ${s.style || 'modern, professionell'}
${s.impressum_url || s.imp_firma ? `IMPRESSUM URL: ${s.impressum_url || ''}` : ''}
${s.dsgvo_url ? `DSGVO URL: ${s.dsgvo_url}` : ''}
${s.agb_url ? `AGB URL: ${s.agb_url}` : ''}
${s.cookie_url ? `COOKIE POLICY URL: ${s.cookie_url}` : ''}
${s.imp_firma ? `IMPRESSUM DATEN: ${s.imp_firma}, ${s.imp_adresse || ''}, GF: ${s.imp_gf || ''}, UID: ${s.imp_uid || ''}` : ''}
SPRACHE(N): ${langLabel}
SECTIONS: ${sections}
${extracted_text ? '\nZUSATZ-INFO:\n' + extracted_text.substring(0, 1000) : ''}
${imgNote}

FARBEN (STRIKT EINHALTEN – keine anderen):
- Primär ${color1}: NavBar Hintergrund, Hero Hintergrund, Footer, dunkle Sections
- Sekundär ${color2}: CTA-Buttons, Hover, Links, Highlights
- Akzent1 ${color3}: Badges, Tags, Icons, kleine Akzente
- Akzent2 ${color4}: Text auf dunklen Flächen, Kontrastelement

LAYOUT (PFLICHT):
- Hero: volle Breite, zentrierter Inhalt, Primärfarbe als Hintergrund, kein leerer weißer Bereich
- KEIN 2-Spalten Layout ohne echtes Bild auf der rechten Seite
- Sections: padding 80px 0, abwechselnd weiß / #f8f9fa
- Einheitliche Ausrichtung: alles zentriert

MOBILE (PFLICHT):
- Hamburger Nav auf Mobile (max-width:768px)
- Alle Grids → 1 Spalte auf Mobile
- Hero Text: 100% Breite, zentriert
- Schriftgrößen 15% kleiner auf Mobile

TYPOGRAFIE: Google Fonts Nunito (700,800) + Inter (400,500)

${isMultilang ? `MEHRSPRACHIG: Sprachwechsler oben rechts (${langs.map(l=>langNames[l]).join(' | ')}). JS wechselt per data-lang Attribut. Standard: ${langNames[langs[0]]}.` : `SPRACHE: Alles auf ${langNames[langs[0]]||'Deutsch'}.`}

${(s.impressum_url || s.dsgvo_url || s.imp_firma) ? `FOOTER RECHTLICHES (PFLICHT wenn Daten vorhanden):
- Footer muss Links enthalten: ${s.impressum_url ? `<a href="${s.impressum_url}">Impressum</a>` : (s.imp_firma ? '<a href="#impressum">Impressum</a>' : '')} ${s.dsgvo_url ? `<a href="${s.dsgvo_url}">Datenschutz</a>` : ''} ${s.agb_url ? `<a href="${s.agb_url}">AGB</a>` : ''} ${s.cookie_url ? `<a href="${s.cookie_url}">Cookie Policy</a>` : ''}
${s.sections && s.sections.includes('Impressum') && s.imp_firma ? `- Impressum Section am Ende der Seite mit: Firma: ${s.imp_firma}, Adresse: ${s.imp_adresse}, GF: ${s.imp_gf}, UID: ${s.imp_uid}` : ''}` : ''}

${waNum ? `PFLICHT WhatsApp Float Button (exakt so einfügen vor </body>):\n${waBtn}` : ''}

Gib NUR das HTML zurück, beginnend mit <!DOCTYPE html>.`;
    }

    // ── API CALL ─────────────────────────────────────────
    const msgContent = [];
    if (imgBlocks.length > 0) msgContent.push(...imgBlocks);
    msgContent.push({ type: 'text', text: userPrompt });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: msgContent }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let html = data.content?.[0]?.text || '';

    // Chat-Modus gibt JS zurück – keine HTML-Prüfung
    if (!prompt) {
      // Generierungs-Modus: HTML validieren und bereinigen
      const doctypeIdx = html.indexOf('<!DOCTYPE');
      if (doctypeIdx > 0) html = html.substring(doctypeIdx);
      else if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html'))
        throw new Error('Ungültige AI Antwort – kein HTML');
    }

    console.log('Response for merchant:', merchant_id, 'chars:', html.length, 'chat:', !!prompt);
    res.json({ success: true, html });

  } catch(e) {
    console.error('generate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// PARTNERS (ehem. Agenten)
// ═══════════════════════════════════════════════════════════

app.get('/api/partners/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('partners').select('*')
      .eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/partners', async (req, res) => {
  try {
    const { merchant_id, name, email, phone, commission_type, commission_value } = req.body;
    if (!merchant_id || !name) return res.status(400).json({ error: 'merchant_id und name erforderlich' });
    const code = name.substring(0,3).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase();
    const { data, error } = await supabase.from('partners').insert({
      merchant_id, name, email: email||null, phone: phone||null,
      referral_code: code,
      commission_type: commission_type || 'percentage',
      commission_value: parseFloat(commission_value) || 10,
      status: 'active'
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, partner: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/partners/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('partners').update(req.body)
      .eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, partner: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/partners/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('partners').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// QR CODES
// ═══════════════════════════════════════════════════════════

function generateQRCode() {
  return 'QR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2,6).toUpperCase();
}

app.post('/api/qr/generate', async (req, res) => {
  try {
    const { merchant_id, order_id, product_name, customer_name, customer_email, quantity, valid_until, metadata } = req.body;
    if (!merchant_id) return res.status(400).json({ error: 'merchant_id erforderlich' });
    const code = generateQRCode();
    const { data, error } = await supabase.from('qr_codes').insert({
      merchant_id, order_id: order_id||null, code,
      product_name: product_name||null, customer_name: customer_name||null,
      customer_email: customer_email||null, quantity: quantity||1,
      status: 'open', valid_until: valid_until||null, metadata: metadata||null
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    console.log('QR generated:', code, 'for merchant:', merchant_id);
    res.json({ success: true, qr: data, code });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/qr/:code', async (req, res) => {
  try {
    const { data, error } = await supabase.from('qr_codes').select('*').eq('code', req.params.code).single();
    if (error || !data) return res.status(404).json({ error: 'QR Code nicht gefunden' });
    if (data.valid_until && new Date(data.valid_until) < new Date()) {
      await supabase.from('qr_codes').update({ status: 'expired' }).eq('id', data.id);
      data.status = 'expired';
    }
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/qr/redeem', async (req, res) => {
  try {
    const { code, redeemed_by } = req.body;
    if (!code) return res.status(400).json({ error: 'code erforderlich' });
    const { data: qr } = await supabase.from('qr_codes').select('*').eq('code', code).single();
    if (!qr) return res.status(404).json({ error: 'QR Code nicht gefunden' });
    if (qr.status === 'redeemed') return res.status(409).json({ error: 'Bereits eingeloest', qr });
    if (qr.status === 'expired') return res.status(410).json({ error: 'Abgelaufen', qr });
    if (qr.valid_until && new Date(qr.valid_until) < new Date()) return res.status(410).json({ error: 'Abgelaufen', qr });
    const { data, error } = await supabase.from('qr_codes')
      .update({ status: 'redeemed', redeemed_at: new Date().toISOString(), redeemed_by: redeemed_by||'unbekannt' })
      .eq('id', qr.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    console.log('QR redeemed:', code, 'by:', redeemed_by);
    res.json({ success: true, qr: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/qr-list/:merchantId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('qr_codes').select('*')
      .eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// OFFER LINKS (Angebotslinks)
// ═══════════════════════════════════════════════════════════

app.post('/api/offer-links', async (req, res) => {
  try {
    const { merchant_id, customer_name, customer_wa, items, total, note, expires_hours } = req.body;
    if (!merchant_id || !items) return res.status(400).json({ error: 'merchant_id und items erforderlich' });
    const token = generateToken();
    const expiresAt = new Date(Date.now() + (expires_hours||48) * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('offer_links').insert({
      merchant_id, token, customer_name: customer_name||null,
      customer_wa: customer_wa||null, items, total: total||null,
      note: note||null, status: 'open', expires_at: expiresAt
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    const url = BASE_URL + '/angebot.html?t=' + token;
    const waNum = customer_wa ? customer_wa.replace(/[^0-9]/g,'') : null;
    const waText = encodeURIComponent('Hallo ' + (customer_name||'') + '!\n\nHier ist dein persoenliches Angebot:\n' + url + '\n\nGueltig bis: ' + new Date(expiresAt).toLocaleDateString('de-AT'));
    const waLink = waNum ? 'https://wa.me/' + waNum + '?text=' + waText : null;
    res.json({ success: true, offer: data, url, waLink });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/offer-links/:token', async (req, res) => {
  try {
    const { data, error } = await supabase.from('offer_links').select('*').eq('token', req.params.token).single();
    if (error || !data) return res.status(404).json({ error: 'Angebot nicht gefunden' });
    if (new Date(data.expires_at) < new Date() && data.status === 'open') {
      await supabase.from('offer_links').update({ status: 'expired' }).eq('id', data.id);
      return res.status(410).json({ error: 'Angebot abgelaufen' });
    }
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// NEWSLETTER SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, name, whatsapp, merchant_id, merchant_slug } = req.body;
    if (!email) return res.status(400).json({ error: 'E-Mail erforderlich' });
    let mId = merchant_id;
    if (!mId && merchant_slug) {
      const { data: m } = await supabase.from('merchants').select('id').eq('slug', merchant_slug).single();
      mId = m?.id;
    }
    if (!mId) return res.status(400).json({ error: 'Merchant nicht gefunden' });
    const { data, error } = await supabase.from('subscribers').upsert({
      email, name: name||'', merchant_id: mId,
      channel: 'email', status: 'active', active: true,
      opted_in_at: new Date().toISOString()
    }, { onConflict: 'email,merchant_id' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    if (whatsapp) {
      try {
        await supabase.from('subscribers').update({ whatsapp, channel: 'both' }).eq('id', data.id);
        await supabase.from('subscribers').upsert({ whatsapp, merchant_id: mId, source: 'newsletter_form', active: false, status: 'pending' }, { onConflict: 'whatsapp,merchant_id' });
        const { data: merchant } = await supabase.from('merchants').select('name').eq('id', mId).single();
        await sendWhatsApp(mId, '+' + whatsapp.replace(/[^0-9]/g,''),
          'Hallo ' + (name||'') + '! Danke fuer deine Anmeldung bei ' + (merchant?.name||'uns') + '.\n\nAntworte JA fuer WhatsApp-Updates.\nSTOP zum Ablehnen.');
      } catch(e) { console.log('WA opt-in error:', e.message); }
    }
    res.json({ success: true, subscriber: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// VERFUEGBARKEIT CURRENT (fuer Landingpage)
// ═══════════════════════════════════════════════════════════

app.get('/api/availability/current/:merchantId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: avails } = await supabase.from('daily_availability').select('*, daily_products(*)')
      .eq('merchant_id', req.params.merchantId).order('updated_at', { ascending: false });
    if (!avails || avails.length === 0) return res.json(null);
    const current = avails.find(a => {
      if (a.period_type === 'permanent') return true;
      if (a.period_type === 'today' && a.date === today) return true;
      if (a.period_type === 'range' && a.period_from <= today && (!a.period_to || a.period_to >= today)) return true;
      if (!a.period_type && a.date === today) return true;
      return false;
    });
    if (!current) return res.json(null);
    if (current.daily_products && current.daily_products.length > 0) {
      const productIds = current.daily_products.map(dp => dp.product_id).filter(Boolean);
      if (productIds.length > 0) {
        const { data: products } = await supabase.from('merchant_products').select('id, purchasable, stripe_link').in('id', productIds);
        current.daily_products = current.daily_products.map(dp => {
          const prod = products?.find(p => p.id === dp.product_id);
          return { ...dp, purchasable: prod?.purchasable !== false, stripe_link: prod?.stripe_link };
        });
      }
    }
    res.json(current);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`✅ Converto API v2.1.0 läuft auf Port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════
// VERKAUFSREPORT (VK) – Bildanalyse & Verkaufstexte
// ═══════════════════════════════════════════════════════════

// Preisberechnung
function vkCalcPrice(articles) {
  let total = 1.00; // Grundpreis pro Auftrag
  for (const a of articles) {
    total += 1.00; // pro Artikel
    const extraPhotos = Math.max(0, (a.photo_count || 1) - 1);
    total += extraPhotos * 0.25; // zusätzliche Fotos
    if (a.extended) total += 1.00; // verlängerte Datenhaltung
  }
  return Math.round(total * 100) / 100;
}

// Token generieren
function vkToken() {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// Bild von Meta herunterladen und in Supabase Storage speichern
async function vkSaveWhatsAppImage(mediaId, sessionId, articleId, sortOrder) {
  const fetch = require('node-fetch');
  const token = process.env.META_ACCESS_TOKEN;

  // 1. Media URL von Meta holen
  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();
  if (!metaData.url) throw new Error('Meta URL nicht gefunden');

  // 2. Bild herunterladen
  const imgRes = await fetch(metaData.url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const buffer = await imgRes.buffer();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  // 3. In Supabase Storage speichern
  const path = `${sessionId}/${articleId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('vk-photos').upload(path, buffer, {
    contentType, upsert: false
  });
  if (error) throw new Error('Storage upload: ' + error.message);

  const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
  return { path, url: urlData.publicUrl };
}

// Claude Bildanalyse für einen Artikel
async function vkAnalyzeArticle(article, photos) {
  const fetch = require('node-fetch');

  const imageBlocks = photos.map(p => ({
    type: 'image',
    source: { type: 'url', url: p.public_url }
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      system: `Du bist ein Experte für Online-Verkauf (eBay, Willhaben, Kleinanzeigen, Facebook Marketplace).
Analysiere die Produktfotos und erstelle einen professionellen Verkaufsbericht.
Antworte NUR mit validem JSON, kein Markdown, keine Erklärungen.`,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Analysiere dieses Produkt und erstelle folgendes JSON:
{
  "title_short": "Kurztitel (max 60 Zeichen, SEO-optimiert)",
  "title_long": "Ausführlicher Titel mit Keywords",
  "title_quick": "Quick-Sale Titel (günstig/schnell)",
  "short_desc": "2-3 Sätze Kurzbeschreibung",
  "long_desc": "Ausführliche Beschreibung mit Zustand, Details, Besonderheiten",
  "bullet_points": ["Highlight 1", "Highlight 2", "Highlight 3"],
  "price_min": 0,
  "price_max": 0,
  "price_recommended": 0,
  "price_reasoning": "Begründung für den Preis",
  "condition": "Zustandsbeschreibung",
  "keywords": ["keyword1", "keyword2"],
  "tips": ["Verkaufstipp 1", "Verkaufstipp 2"],
  "category": "Produktkategorie"
}`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { title_short: 'Analyse fehlgeschlagen', error: e.message };
  }
}

// ── VK SESSION ERSTELLEN (WhatsApp) ────────────────────────
app.post('/api/vk/session', async (req, res) => {
  try {
    const { phone, media_id, customer_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone erforderlich' });

    // Immer neue Session pro Foto erstellen
    const token = vkToken();
    const { data: session, error: sErr } = await supabase.from('vk_sessions')
      .insert({ phone, token, customer_name: customer_name || null, status: 'open' })
      .select().single();
    if (sErr) return res.status(400).json({ error: sErr.message });

    // Artikel anlegen
    const { data: article, error: aErr } = await supabase.from('vk_articles')
      .insert({ session_id: session.id, title: 'Artikel ' + (Date.now() % 1000) })
      .select().single();
    if (aErr) return res.status(400).json({ error: aErr.message });

    // Foto speichern wenn vorhanden
    let photoUrl = null;
    if (media_id) {
      try {
        const saved = await vkSaveWhatsAppImage(media_id, session.id, article.id, 1);
        await supabase.from('vk_photos').insert({
          article_id: article.id, session_id: session.id,
          storage_path: saved.path, public_url: saved.url,
          source: 'whatsapp', sort_order: 1
        });
        photoUrl = saved.url;
      } catch(e) { console.error('Photo save error:', e.message); }
    }

    const link = `https://converdino.com/bericht.html?s=${session.token}`;
    console.log('VK session created:', session.token, 'for', phone);
    res.json({ success: true, session, article, link, photo_url: photoUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ALLE SESSIONS PER TELEFON ─────────────────────────────
app.get('/api/vk/sessions/phone/:phone', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone);
    const { data, error } = await supabase.from('vk_sessions')
      .select('*, vk_articles(id, title, status, vk_photos(id))')
      .eq('phone', phone)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VK SESSION LADEN ───────────────────────────────────────
app.get('/api/vk/session/:token', async (req, res) => {
  try {
    const { data: session, error } = await supabase
      .from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (error || !session) return res.status(404).json({ error: 'Session nicht gefunden' });

    // Artikel + Fotos laden
    const { data: articles } = await supabase.from('vk_articles')
      .select('*, vk_photos(*)')
      .eq('session_id', session.id)
      .order('sort_order', { ascending: true });

    const enriched = (articles || []).map(a => ({
      ...a,
      photo_count: (a.vk_photos || []).length
    }));

    const price = vkCalcPrice(enriched);
    res.json({ ...session, articles: enriched, price });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ARTIKEL HINZUFÜGEN ─────────────────────────────────────
app.post('/api/vk/article', async (req, res) => {
  try {
    const { token, title } = req.body;
    const { data: session } = await supabase.from('vk_sessions')
      .select('id').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    const { data: count } = await supabase.from('vk_articles')
      .select('id', { count: 'exact' }).eq('session_id', session.id);
    if ((count?.length || 0) >= 20) return res.status(400).json({ error: 'Maximal 20 Artikel' });

    const { data, error } = await supabase.from('vk_articles')
      .insert({ session_id: session.id, title: title || 'Neuer Artikel', sort_order: (count?.length || 0) + 1 })
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, article: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ARTIKEL LÖSCHEN ────────────────────────────────────────
app.delete('/api/vk/article/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('vk_articles').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FOTO HOCHLADEN (Web Upload) ────────────────────────────
app.post('/api/vk/photo', async (req, res) => {
  try {
    const { article_id, session_id, image_base64, content_type } = req.body;
    if (!article_id || !image_base64) return res.status(400).json({ error: 'article_id und image_base64 erforderlich' });

    // Prüfen ob max 4 Fotos
    const { data: existing } = await supabase.from('vk_photos')
      .select('id').eq('article_id', article_id);
    if ((existing?.length || 0) >= 4) return res.status(400).json({ error: 'Maximal 4 Fotos pro Artikel' });

    const ext = (content_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const path = `${session_id}/${article_id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(image_base64, 'base64');

    const { error: upErr } = await supabase.storage.from('vk-photos')
      .upload(path, buffer, { contentType: content_type || 'image/jpeg', upsert: false });
    if (upErr) return res.status(400).json({ error: upErr.message });

    const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
    const { data, error } = await supabase.from('vk_photos').insert({
      article_id, session_id, storage_path: path,
      public_url: urlData.publicUrl, source: 'upload',
      sort_order: (existing?.length || 0) + 1
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, photo: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FOTO LÖSCHEN ───────────────────────────────────────────
app.delete('/api/vk/photo/:id', async (req, res) => {
  try {
    const { data: photo } = await supabase.from('vk_photos')
      .select('storage_path').eq('id', req.params.id).single();
    if (photo?.storage_path) {
      await supabase.storage.from('vk-photos').remove([photo.storage_path]);
    }
    await supabase.from('vk_photos').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DATENHALTUNG TOGGLE ────────────────────────────────────
app.put('/api/vk/article/:id/extended', async (req, res) => {
  try {
    const { extended } = req.body;
    const { data, error } = await supabase.from('vk_articles')
      .update({ extended: !!extended }).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, article: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STRIPE CHECKOUT ERSTELLEN ──────────────────────────────
app.post('/api/vk/checkout', async (req, res) => {
  try {
    const { token } = req.body;
    const { data: session } = await supabase.from('vk_sessions')
      .select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    const { data: articles } = await supabase.from('vk_articles')
      .select('*, vk_photos(id)').eq('session_id', session.id);
    const enriched = (articles || []).map(a => ({ ...a, photo_count: (a.vk_photos || []).length }));
    if (!enriched.length) return res.status(400).json({ error: 'Keine Artikel vorhanden' });

    const price = vkCalcPrice(enriched);
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'Verkaufsreport – ' + enriched.length + ' Artikel',
            description: enriched.map(a => a.title).join(', ')
          },
          unit_amount: Math.round(price * 100)
        },
        quantity: 1
      }],
      metadata: { vk_token: token, vk_session_id: session.id },
      success_url: `https://converdino.com/bericht.html?s=${token}&paid=1`,
      cancel_url: `https://converdino.com/bericht.html?s=${token}`
    });

    await supabase.from('vk_sessions').update({ stripe_session_id: checkout.id })
      .eq('id', session.id);

    res.json({ success: true, url: checkout.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STRIPE WEBHOOK → ANALYSE STARTEN ──────────────────────
app.post('/api/vk/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_VK_SECRET || process.env.STRIPE_WEBHOOK_SECRET);
    } catch(e) { return res.status(400).send('Webhook Error: ' + e.message); }

    if (event.type === 'checkout.session.completed') {
      const stripeSession = event.data.object;
      const vkToken = stripeSession.metadata?.vk_token;
      if (!vkToken) return res.json({ received: true });

      const { data: session } = await supabase.from('vk_sessions')
        .select('*').eq('token', vkToken).single();
      if (!session) return res.json({ received: true });

      // Status auf paid setzen
      const now = new Date();
      await supabase.from('vk_sessions').update({
        status: 'analyzing', paid_at: now.toISOString(),
        stripe_session_id: stripeSession.id
      }).eq('id', session.id);

      // Analyse asynchron starten
      (async () => {
        try {
          const { data: articles } = await supabase.from('vk_articles')
            .select('*, vk_photos(*)').eq('session_id', session.id);

          for (const article of (articles || [])) {
            const photos = article.vk_photos || [];
            if (!photos.length) continue;
            const analysis = await vkAnalyzeArticle(article, photos);
            await supabase.from('vk_articles').update({ analysis, status: 'analyzed' }).eq('id', article.id);
          }

          // Ablaufdatum setzen
          const anyExtended = (articles || []).some(a => a.extended);
          const days = anyExtended ? 7 : 3;
          const deleteAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

          await supabase.from('vk_sessions').update({
            status: 'done', analyzed_at: new Date().toISOString(),
            delete_at: deleteAt.toISOString()
          }).eq('id', session.id);

          // WhatsApp Nachricht senden
          const link = `https://converdino.com/ergebnis.html?s=${vkToken}`;
          const allLink = `https://converdino.com/auftraege.html?p=${encodeURIComponent(session.phone)}`;
          const msg = `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis ansehen:\n${link}\n\n📂 Alle deine Aufträge:\n${allLink}\n\n🗑️ Daten werden in ${days} Tagen gelöscht.`;
          await vkSendWhatsApp(session.phone, msg);
          console.log('VK analysis done for session:', vkToken);
        } catch(e) {
          console.error('VK analysis error:', e.message);
          await supabase.from('vk_sessions').update({ status: 'error' }).eq('token', vkToken);
        }
      })();
    }
    res.json({ received: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ERGEBNISSE LADEN ───────────────────────────────────────
app.get('/api/vk/results/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (!['done', 'analyzing'].includes(session.status))
      return res.status(400).json({ error: 'Analyse noch nicht abgeschlossen', status: session.status });

    const { data: articles } = await supabase.from('vk_articles')
      .select('*, vk_photos(*)').eq('session_id', session.id)
      .order('sort_order', { ascending: true });

    // Erstes Abrufen der Ergebnisse → viewed_at setzen
    if (!session.result_viewed_at) {
      await supabase.from('vk_sessions').update({ result_viewed_at: new Date().toISOString() }).eq('id', session.id);
    }
    res.json({ ...session, articles: articles || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: ALLE SESSIONS ───────────────────────────────────
app.get('/api/vk/admin/sessions', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_sessions')
      .select('*, vk_articles(id, status, extended)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: STATISTIKEN ─────────────────────────────────────
app.get('/api/vk/admin/stats', async (req, res) => {
  try {
    const { data: sessions } = await supabase.from('vk_sessions').select('*');
    const all = sessions || [];
    const today = new Date(); today.setHours(0,0,0,0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    res.json({
      total: all.length,
      today: all.filter(s => new Date(s.created_at) >= today).length,
      this_month: all.filter(s => new Date(s.created_at) >= thisMonth).length,
      revenue_total: all.filter(s => s.paid_at).reduce((t, s) => t + (parseFloat(s.total_price) || 0), 0),
      revenue_month: all.filter(s => s.paid_at && new Date(s.paid_at) >= thisMonth).reduce((t, s) => t + (parseFloat(s.total_price) || 0), 0),
      by_status: {
        open: all.filter(s => s.status === 'open').length,
        paid: all.filter(s => s.status === 'paid').length,
        analyzing: all.filter(s => s.status === 'analyzing').length,
        done: all.filter(s => s.status === 'done').length,
        expired: all.filter(s => s.status === 'expired').length
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: ANALYSE MANUELL STARTEN ────────────────────────
app.post('/api/vk/admin/analyze/:sessionId', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select('*').eq('id', req.params.sessionId).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    await supabase.from('vk_sessions').update({ status: 'analyzing' }).eq('id', session.id);
    res.json({ success: true, message: 'Analyse gestartet' });

    // Async analysieren
    (async () => {
      const { data: articles } = await supabase.from('vk_articles')
        .select('*, vk_photos(*)').eq('session_id', session.id);
      for (const article of (articles || [])) {
        const photos = article.vk_photos || [];
        if (!photos.length) continue;
        const analysis = await vkAnalyzeArticle(article, photos);
        await supabase.from('vk_articles').update({ analysis, status: 'analyzed' }).eq('id', article.id);
      }
      const anyExtended = (articles || []).some(a => a.extended);
      const days = anyExtended ? 7 : 3;
      const deleteAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      await supabase.from('vk_sessions').update({
        status: 'done', analyzed_at: new Date().toISOString(),
        delete_at: deleteAt.toISOString()
      }).eq('id', session.id);
      const link = `https://converdino.com/ergebnis.html?s=${session.token}`;
      const allLink2 = `https://converdino.com/auftraege.html?p=${encodeURIComponent(session.phone)}`;
      await vkSendWhatsApp(session.phone,
        `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\n${link}\n\n📂 Alle Aufträge:\n${allLink2}\n\nWird in ${days} Tagen gelöscht.`);
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: SESSION LÖSCHEN ─────────────────────────────────
app.delete('/api/vk/admin/session/:id', async (req, res) => {
  try {
    // Fotos aus Storage löschen
    const { data: photos } = await supabase.from('vk_photos')
      .select('storage_path').eq('session_id', req.params.id);
    if (photos?.length) {
      await supabase.storage.from('vk-photos').remove(photos.map(p => p.storage_path));
    }
    await supabase.from('vk_sessions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN: SESSION VERLÄNGERN ──────────────────────────────
app.put('/api/vk/admin/session/:id/extend', async (req, res) => {
  try {
    const { days } = req.body;
    const newDeleteAt = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000);
    const { data, error } = await supabase.from('vk_sessions')
      .update({ delete_at: newDeleteAt.toISOString() }).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, session: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CRON: AUTOMATISCHE LÖSCHUNG (täglich) ─────────────────
setInterval(async () => {
  try {
    const now = new Date().toISOString();
    const { data: expired } = await supabase.from('vk_sessions')
      .select('id').lte('delete_at', now).neq('status', 'deleted');
    for (const s of (expired || [])) {
      const { data: photos } = await supabase.from('vk_photos')
        .select('storage_path').eq('session_id', s.id);
      if (photos?.length) {
        await supabase.storage.from('vk-photos').remove(photos.map(p => p.storage_path));
      }
      await supabase.from('vk_sessions').update({ status: 'deleted' }).eq('id', s.id);
      console.log('VK session auto-deleted:', s.id);
    }
  } catch(e) { console.error('VK cleanup error:', e.message); }
}, 60 * 60 * 1000); // stündlich prüfen

// ── WHATSAPP HANDLER: Fotos erkennen ─────────────────────
// (Ergänzung zum bestehenden Webhook - wird im Webhook aufgerufen)
async function vkSendWhatsApp(phone, message) {
  // Sosuapesce Merchant direkt laden (hat den WhatsApp Token)
  try {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('id, meta_phone_number_id, meta_access_token')
      .eq('slug', 'sosuapesce')
      .single();

    if (merchant) {
      const formattedPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/[^0-9]/g,'');
      console.log('vkSendWhatsApp via merchant:', merchant.id, 'to:', formattedPhone);
      await sendWhatsApp(merchant.id, formattedPhone, message);
    } else {
      // Fallback auf ENV
      const fetch = require('node-fetch');
      const phoneId = process.env.META_PHONE_NUMBER_ID;
      const token   = process.env.META_ACCESS_TOKEN;
      const to = '+' + phone.replace(/[^0-9]/g, '');
      const r = await fetch('https://graph.facebook.com/v18.0/' + phoneId + '/messages', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } })
      });
      const d = await r.json();
      console.log('vkSendWhatsApp fallback response:', JSON.stringify(d));
    }
  } catch(e) { console.error('vkSendWhatsApp error:', e.message); }
}

async function vkHandleWhatsAppImage(phone, mediaId, merchantId) {
  try {
    const result = await fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/vk/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, media_id: mediaId })
    });
    const data = await result.json();
    if (!data.success) return;
    const link = data.link;
    const allLink = 'https://converdino.com/auftraege.html?p=' + encodeURIComponent(phone);
    const msg = '✅ Foto erhalten! Hier ist dein Auftrag-Link:\n\n' + link + '\n\nDort kannst du:\n• Weitere Fotos hinzufügen\n• Neue Artikel anlegen\n• Deinen Bericht bestellen\n\n📂 Alle deine Aufträge:\n' + allLink + '\n\n💡 Max. 4 Fotos pro Artikel möglich.';
    await sendWhatsApp(merchantId, '+' + phone.replace(/[^0-9]/g,''), msg);
  } catch(e) { console.error('VK WhatsApp handler error:', e.message); }
}

// Exportieren damit der Webhook es nutzen kann
module.exports = { vkHandleWhatsAppImage };
