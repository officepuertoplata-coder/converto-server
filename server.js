require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://officepuertoplata-coder.github.io/sosuapesce';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
    const { data: subscribers } = await supabase.from('subscribers').select('email, name').eq('merchant_id', merchantId).eq('status', 'active').not('email', 'is', null);
    if (!subscribers || subscribers.length === 0) { console.log('Keine E-Mail Subscriber fuer:', merchantId); return 'no_subscribers'; }
    const fetch = require('node-fetch');
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
    const from = (fromName || 'Converto') + ' <' + fromEmail + '>';
    const batches = [];
    for (let i = 0; i < subscribers.length; i += 100) batches.push(subscribers.slice(i, i + 100));
    let totalSent = 0;
    for (const batch of batches) {
      const emails = batch.map(sub => ({ from, to: [sub.email], subject, html: htmlContent }));
      const res = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(emails) });
      const data = await res.json();
      console.log('Resend batch response:', JSON.stringify(data));
      if (data.data) totalSent += data.data.length;
    }
    return totalSent;
  } catch(e) { console.error('Resend broadcast error:', e.message); return null; }
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function sendWhatsApp(merchantId, to, message) {
  try {
    const { data: merchant } = await supabase.from('merchants').select('meta_phone_number_id, meta_access_token').eq('id', merchantId).single();
    const phoneId = merchant?.meta_phone_number_id || process.env.META_PHONE_NUMBER_ID;
    const token   = merchant?.meta_access_token    || process.env.META_ACCESS_TOKEN;
    console.log('sendWhatsApp:', { to, phoneId: phoneId?.substring(0,8), hasToken: !!token });
    let cleanTo = to.replace('whatsapp:', '').replace(/\s/g, '');
    if (cleanTo.startsWith('+')) cleanTo = cleanTo.substring(1);
    const fetch = require('node-fetch');
    const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: cleanTo, type: 'text', text: { body: message } }) });
    const data = await response.json();
    console.log('WhatsApp API response:', JSON.stringify(data));
    return data.messages?.[0]?.id;
  } catch (e) { console.error('WhatsApp send error:', e); return null; }
}

// ═══════════════════════════════════════════════════════════
// HEALTH & AUTH
// ═══════════════════════════════════════════════════════════

app.get('/',           (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.2.0' }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', platform: 'Converto API', version: '2.2.0' }));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich' });
  try {
    if (username.toLowerCase() === 'admin' && process.env.SUPERADMIN_PASSWORD && password === process.env.SUPERADMIN_PASSWORD) {
      const { data: merchants } = await supabase.from('merchants').select('id, name, slug, status').order('name');
      return res.json({ success: true, role: 'superadmin', user: { id: 'superadmin', name: 'Superadmin', username: 'admin' }, merchants: merchants || [] });
    }
    const { data: user, error: uErr } = await supabase.from('users').select('*').eq('username', username.toLowerCase().trim()).single();
    if (user && !uErr) {
      if (!user.active) return res.status(401).json({ error: 'Account deaktiviert' });
      if (user.password !== password) return res.status(401).json({ error: 'Falsches Passwort' });
      await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
      if (user.role === 'superadmin') { const { data: merchants } = await supabase.from('merchants').select('id, name, slug, status').order('name'); return res.json({ success: true, role: 'superadmin', user: { id: user.id, name: user.name, username: user.username }, merchants: merchants || [] }); }
      if (user.role === 'staff') { const { data: access } = await supabase.from('user_merchant_access').select('merchant_id, merchants(id, name, slug, status)').eq('user_id', user.id); const merchants = (access || []).map(a => a.merchants).filter(Boolean); return res.json({ success: true, role: 'staff', user: { id: user.id, name: user.name, username: user.username }, merchants }); }
      if (user.role === 'merchant') { const { data: merchant } = await supabase.from('merchants').select('*').eq('id', user.merchant_id).single(); return res.json({ success: true, role: 'merchant', user: { id: user.id, name: user.name, username: user.username }, merchant }); }
    }
    const { data: merchant, error: mErr } = await supabase.from('merchants').select('id, name, slug, admin_password, wa_enabled, meta_phone_number_id').eq('slug', username).single();
    if (!mErr && merchant && merchant.admin_password === password) return res.json({ success: true, role: 'merchant', merchant, legacy: true });
    return res.status(401).json({ error: 'Ungueltige Zugangsdaten' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users', async (req, res) => { try { const { data, error } = await supabase.from('users').select('id, username, role, name, email, active, merchant_id, last_login, created_at').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/users', async (req, res) => { try { const { username, password, role, name, email, merchant_id, merchant_ids } = req.body; if (!username || !password || !role) return res.status(400).json({ error: 'Username, Passwort und Rolle erforderlich' }); const { data: user, error } = await supabase.from('users').insert({ username: username.toLowerCase().trim(), password, role, name, email, merchant_id: merchant_id || null }).select().single(); if (error) return res.status(400).json({ error: error.message }); if (role === 'staff' && merchant_ids?.length > 0) await supabase.from('user_merchant_access').insert(merchant_ids.map(mid => ({ user_id: user.id, merchant_id: mid }))); res.json({ success: true, user }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/users/:id', async (req, res) => { try { const { password, name, email, active, merchant_id, merchant_ids } = req.body; const updates = {}; if (password) updates.password = password; if (name !== undefined) updates.name = name; if (email !== undefined) updates.email = email; if (active !== undefined) updates.active = active; if (merchant_id !== undefined) updates.merchant_id = merchant_id; const { data, error } = await supabase.from('users').update(updates).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); if (merchant_ids !== undefined) { await supabase.from('user_merchant_access').delete().eq('user_id', req.params.id); if (merchant_ids.length > 0) await supabase.from('user_merchant_access').insert(merchant_ids.map(mid => ({ user_id: req.params.id, merchant_id: mid }))); } res.json({ success: true, user: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/users/:id', async (req, res) => { try { const { error } = await supabase.from('users').delete().eq('id', req.params.id); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/merchants', async (req, res) => { try { const { name, slug, admin_password, currency, wa_number, description } = req.body; if (!name || !slug || !admin_password) return res.status(400).json({ error: 'Name, Slug und Passwort erforderlich' }); const { data, error } = await supabase.from('merchants').insert({ name, slug: slug.toLowerCase().trim(), admin_password, currency: currency || 'EUR', wa_number: wa_number || null, description: description || null, status: 'active' }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, merchant: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/merchants/:id', async (req, res) => { try { const updates = req.body; delete updates.id; const { data, error } = await supabase.from('merchants').update(updates).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, merchant: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/merchants', async (req, res) => { const { data, error } = await supabase.from('merchants').select('id, name, slug, status, currency, created_at').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data); });
app.get('/api/merchants/:slug', async (req, res) => { const { data, error } = await supabase.from('merchants').select('*').eq('slug', req.params.slug).single(); if (error) return res.status(404).json({ error: 'Nicht gefunden' }); res.json(data); });

// ═══════════════════════════════════════════════════════════
// PRODUKTE / SESSION CONFIG
// ═══════════════════════════════════════════════════════════

app.get('/api/products/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('merchant_products').select('*').eq('merchant_id', req.params.merchantId).order('sort_order', { ascending: true }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/products', async (req, res) => { try { const { data, error } = await supabase.from('merchant_products').insert(req.body).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, product: data }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/products/:id', async (req, res) => { try { const { data, error } = await supabase.from('merchant_products').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, product: data }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/products/:id', async (req, res) => { try { const { error } = await supabase.from('merchant_products').delete().eq('id', req.params.id); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/session-config/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('merchant_session_config').select('*').eq('merchant_id', req.params.merchantId).single(); if (error) return res.status(404).json({ error: 'Nicht gefunden' }); res.json(data); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/session-config', async (req, res) => { try { const { data, error } = await supabase.from('merchant_session_config').upsert(req.body, { onConflict: 'merchant_id' }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, config: data }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ═══════════════════════════════════════════════════════════
// AVAILABILITY
// ═══════════════════════════════════════════════════════════

app.get('/api/availability/today/:merchantId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    let { data: avail } = await supabase.from('daily_availability').select('*, daily_products(*)').eq('merchant_id', req.params.merchantId).eq('date', today).single();
    if (!avail) { const { data: products } = await supabase.from('merchant_products').select('*').eq('merchant_id', req.params.merchantId).eq('available', true).order('sort_order', { ascending: true }); return res.json({ id: null, date: today, published: false, delivery_active: false, pickup_active: true, note: '', available_until: '17:00', daily_products: (products || []).map(p => ({ product_id: p.id, name: p.name, price_today: p.price || 0, unit: p.unit || 'piece', unit_label: p.unit_label || 'Stueck', quantity_start: 0, quantity_left: 0, active: false, step_quantity: p.step_quantity || 0.5 })) }); }
    if (!avail.daily_products || avail.daily_products.length === 0) { const { data: products } = await supabase.from('merchant_products').select('*').eq('merchant_id', req.params.merchantId).eq('available', true).order('sort_order', { ascending: true }); avail.daily_products = (products || []).map(p => ({ product_id: p.id, name: p.name, price_today: p.price || 0, unit: p.unit || 'piece', unit_label: p.unit_label || 'Stueck', quantity_start: 0, quantity_left: 0, active: false, step_quantity: p.step_quantity || 0.5 })); }
    res.json(avail);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/availability/yesterday/:merchantId', async (req, res) => { try { const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]; const { data } = await supabase.from('daily_availability').select('*, daily_products(*)').eq('merchant_id', req.params.merchantId).eq('date', yesterday).single(); res.json(data || null); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/availability', async (req, res) => {
  try {
    const { merchant_id, date, products, delivery_active, pickup_active, available_until, delivery_area, note } = req.body;
    const today = date || new Date().toISOString().split('T')[0];
    const { data: avail, error: availError } = await supabase.from('daily_availability').upsert({ merchant_id, date: today, delivery_active, pickup_active, available_until, delivery_area, note, published: false, updated_at: new Date().toISOString() }, { onConflict: 'merchant_id,date' }).select().single();
    if (availError) return res.status(400).json({ error: availError.message });
    await supabase.from('daily_products').delete().eq('availability_id', avail.id);
    if (products?.length > 0) { const active = products.filter(p => p.active && p.quantity_start > 0); if (active.length > 0) await supabase.from('daily_products').insert(active.map((p, i) => ({ availability_id: avail.id, merchant_id, product_id: p.product_id || null, name: p.name, price_today: p.price_today, unit: p.unit, unit_label: p.unit_label, quantity_start: p.quantity_start, quantity_left: p.quantity_start, active: true, sort_order: i }))); }
    res.json({ success: true, availability: avail });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/availability/:id/publish', async (req, res) => { try { const { data: avail, error } = await supabase.from('daily_availability').update({ published: true, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*, daily_products(*)').single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, availability: avail }); } catch (e) { res.status(500).json({ error: e.message }); } });

// ═══════════════════════════════════════════════════════════
// KUNDEN-SESSIONS
// ═══════════════════════════════════════════════════════════

app.post('/api/sessions', async (req, res) => {
  try {
    const { merchant_id, service_type, customer_wa, customer_name, customer_language, availability_id } = req.body;
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const { data: session, error } = await supabase.from('customer_sessions').insert({ token, merchant_id, service_type: service_type || 'order', customer_wa, customer_name, customer_language: customer_language || 'de', availability_id: availability_id || null, status: 'open', expires_at: expiresAt }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, session, url: `${BASE_URL}/session.html?s=${token}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sessions/:token', async (req, res) => {
  try {
    const { data: session, error } = await supabase.from('customer_sessions').select('*').eq('token', req.params.token).single();
    if (error || !session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (new Date(session.expires_at) < new Date() && session.status === 'open') { await supabase.from('customer_sessions').update({ status: 'expired' }).eq('id', session.id); return res.status(410).json({ error: 'Session abgelaufen' }); }
    const { data: merchant } = await supabase.from('merchants').select('id, name, slug, currency').eq('id', session.merchant_id).single();
    const { data: config } = await supabase.from('merchant_session_config').select('*').eq('merchant_id', session.merchant_id).single();
    const today = new Date().toISOString().split('T')[0];
    const { data: avail } = await supabase.from('daily_availability').select('*, daily_products(*)').eq('merchant_id', session.merchant_id).eq(session.availability_id ? 'id' : 'date', session.availability_id || today).eq('published', true).single();
    let products = [];
    if (avail?.daily_products?.length > 0) { products = avail.daily_products.filter(p => p.active && p.quantity_left > 0); } else { const { data: allProducts } = await supabase.from('merchant_products').select('*').eq('merchant_id', session.merchant_id).eq('available', true).order('sort_order'); products = (allProducts || []).map(p => ({ product_id: p.id, name: p.name, price_today: p.price, unit: p.unit, unit_label: p.unit_label, quantity_left: null, active: true })); }
    res.json({ session, merchant, config, availability: avail || null, products });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/sessions/:token', async (req, res) => { try { const { data, error } = await supabase.from('customer_sessions').update({ ...req.body, updated_at: new Date().toISOString() }).eq('token', req.params.token).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, session: data }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.post('/api/sessions/:token/order', async (req, res) => {
  try {
    const { data: session } = await supabase.from('customer_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const { data: order, error } = await supabase.from('orders').insert({ session_id: session.id, merchant_id: session.merchant_id, customer_wa: session.customer_wa, customer_name: session.customer_name, items: session.items, subtotal: session.subtotal, delivery_fee: session.delivery_fee, total: session.total, delivery_type: session.delivery_type, delivery_address: session.delivery_address, note: session.note, status: 'new' }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    await supabase.from('customer_sessions').update({ status: 'confirmed' }).eq('id', session.id);
    const itemsList = (session.items || []).map(i => `  • ${i.name}: ${i.quantity} ${i.unit_label || ''} = ${i.total}€`).join('\n');
    if (session.customer_wa) await sendWhatsApp(session.merchant_id, session.customer_wa, `✅ *Bestellung bestätigt!*\n\nBestellnr: ${order.order_number}\n\n${itemsList}\n\n💰 Gesamt: ${session.total}€\n\nWir melden uns gleich! 👋`);
    res.json({ success: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// BESTELLUNGEN / BROADCAST / WHATSAPP
// ═══════════════════════════════════════════════════════════

app.get('/api/orders/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('orders').select('*').eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch (e) { res.status(500).json({ error: e.message }); } });
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updates = { status, updated_at: new Date().toISOString() };
    if (status === 'delivered') updates.delivered_at = new Date().toISOString();
    if (status === 'confirmed') updates.confirmed_at = new Date().toISOString();
    const { data, error } = await supabase.from('orders').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    const msgs = { confirmed: '✅ Bestätigt!', preparing: '👨‍🍳 Wird vorbereitet...', ready: '✅ Bereit!', delivered: '🎉 Geliefert!' };
    if (data.customer_wa && msgs[status]) await sendWhatsApp(data.merchant_id, data.customer_wa, `${msgs[status]}\nBestellnr: ${data.order_number}`);
    res.json({ success: true, order: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/broadcast', async (req, res) => {
  try {
    const { merchant_id, message, availability_id, recipients } = req.body;
    let query = supabase.from('subscribers').select('whatsapp, email').eq('merchant_id', merchant_id).eq('active', true);
    if (recipients !== 'all') query = query.neq('status', 'pending');
    const { data: subscribers } = await query;
    if (!subscribers?.length) return res.json({ success: true, sent: 0 });
    let sent = 0;
    for (const sub of subscribers) { if (sub.whatsapp) { const result = await sendWhatsApp(merchant_id, sub.whatsapp, message); if (result) sent++; await new Promise(r => setTimeout(r, 200)); } }
    if (availability_id) await supabase.from('daily_availability').update({ broadcast_sent: true }).eq('id', availability_id);
    res.json({ success: true, sent, total: subscribers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/whatsapp/send', async (req, res) => { const { to, message, merchant_id } = req.body; try { const msgId = await sendWhatsApp(merchant_id, to, message); if (!msgId) return res.status(400).json({ error: 'Senden fehlgeschlagen' }); res.json({ success: true, message_id: msgId }); } catch (e) { res.status(500).json({ error: e.message }); } });

app.get('/api/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'], token = req.query['hub.verify_token'], challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_TOKEN) { console.log('✅ Webhook verified'); res.status(200).send(challenge); } else { res.status(403).send('Forbidden'); }
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
        if (!value?.messages) continue;
        for (const msg of value.messages) {
          const from = msg.from, text = (msg.text?.body || '').toLowerCase().trim(), phoneId = value.metadata?.phone_number_id, msgType = msg.type;
          if (msgType === 'image' && msg.image?.id) {
            console.log('VK: Image received from', from, 'media_id:', msg.image.id);
            try { const { data: merchant } = await supabase.from('merchants').select('id').eq('meta_phone_number_id', phoneId).single(); await vkHandleWhatsAppImage(from, msg.image.id, merchant?.id || null); } catch(e) { console.error('VK image handler error:', e.message); }
            continue;
          }
          const { data: merchant, error: mErr } = await supabase.from('merchants').select('id, name, slug').eq('meta_phone_number_id', phoneId).single();
          console.log('Merchant lookup phoneId:', phoneId, 'found:', merchant?.id, 'error:', mErr?.message);
          if (!merchant) continue;
          try { await supabase.from('comm_messages').insert({ merchant_id: merchant.id, direction: 'inbound', content_type: 'text', original_text: msg.text?.body || '', source: 'whatsapp' }); } catch(e) {}
          const stopWords = ['stop', 'abmelden', 'cancelar'], subWords = ['subscribe', 'anmelden', 'suscribir', 'info', 'notify'], orderWords = ['bestellen', 'order', 'comprar', 'kaufen', 'pedido'];
          if (stopWords.some(k => text.includes(k))) {
            await supabase.from('subscribers').update({ active: false, status: 'inactive', opted_out_at: new Date().toISOString() }).eq('whatsapp', '+' + from).eq('merchant_id', merchant.id);
            await sendWhatsApp(merchant.id, '+' + from, '✅ Du wurdest abgemeldet. Schreibe "INFO" um dich wieder anzumelden.');
          } else if (['ja','yes','si','sí'].includes(text)) {
            let pending = null;
            try { const { data } = await supabase.from('subscribers').select('id').eq('whatsapp', '+' + from).eq('merchant_id', merchant.id).eq('status', 'pending').single(); pending = data; } catch(e) {}
            if (pending) { await supabase.from('subscribers').update({ active: true, status: 'active', opted_in_at: new Date().toISOString(), consent_text: 'Kunde hat JA geantwortet. Zeitstempel: ' + new Date().toISOString() }).eq('id', pending.id); await sendWhatsApp(merchant.id, '+' + from, '✅ Perfekt! Du bist jetzt angemeldet!\n\nSchreibe jederzeit STOP zum Abmelden. 🙏'); }
          } else if (subWords.some(k => text.includes(k))) {
            const mName = merchant.name || 'uns';
            try { await supabase.from('subscribers').upsert({ whatsapp: '+' + from, merchant_id: merchant.id, source: 'whatsapp_keyword', active: false, status: 'pending' }, { onConflict: 'whatsapp,merchant_id' }); } catch(e) {}
            await sendWhatsApp(merchant.id, '+' + from, '👋 Hallo! Möchtest du das Tagesangebot von ' + mName + ' per WhatsApp erhalten?\n\nAntworte JA zum Bestätigen\nSchreibe STOP zum Ablehnen');
          } else if (orderWords.some(k => text.includes(k))) {
            const today = new Date().toISOString().split('T')[0]; let availId = null;
            try { const { data: avail } = await supabase.from('daily_availability').select('id').eq('merchant_id', merchant.id).eq('date', today).eq('published', true).single(); availId = avail?.id || null; } catch(e) {}
            const token = generateToken();
            try { await supabase.from('customer_sessions').insert({ token, merchant_id: merchant.id, service_type: 'order', customer_wa: '+' + from, availability_id: availId, status: 'open', expires_at: new Date(Date.now() + 4*60*60*1000).toISOString() }); } catch(e) {}
            await sendWhatsApp(merchant.id, '+' + from, `👋 Hier kannst du bestellen:\n\n${BASE_URL}/session.html?s=${token}\n\n⏰ Gültig für 4 Stunden.`);
          }
        }
      }
    }
  } catch (e) { console.error('Webhook error:', e); }
});

// ═══════════════════════════════════════════════════════════
// EMAIL / STRIPE / SUBSCRIBERS
// ═══════════════════════════════════════════════════════════

app.post('/api/email/subscribe', async (req, res) => { try { const { email, name, merchant_id, merchant_slug } = req.body; if (!email) return res.status(400).json({ error: 'Email fehlt' }); let mId = merchant_id; if (!mId && merchant_slug) { const { data: m } = await supabase.from('merchants').select('id').eq('slug', merchant_slug).single(); mId = m?.id; } if (!mId) return res.status(400).json({ error: 'Merchant nicht gefunden' }); const { data, error } = await supabase.from('subscribers').upsert({ email, name: name || '', merchant_id: mId, channel: 'email', status: 'active', active: true, opted_in_at: new Date().toISOString() }, { onConflict: 'email,merchant_id' }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, subscriber: data }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/mailerlite/daily-offer', async (req, res) => {
  try {
    const { merchant_id, products, note, merchant_name, wa_number } = req.body;
    const waLink = wa_number ? 'https://wa.me/' + wa_number.replace('+', '') + '?text=Bestellen' : null;
    const productRows = (products || []).map(p => '<tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0">' + p.name + '</td><td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:700;color:#2d7a4f">' + (p.price_today || 0).toFixed(2) + '€ ' + (p.unit_label || '') + '</td></tr>').join('');
    const waButton = waLink ? '<a href="' + waLink + '" style="display:inline-block;background:#25d366;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin-top:20px">💬 Jetzt per WhatsApp bestellen</a>' : '';
    const today = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)"><div style="background:#1b4332;color:#fff;padding:28px 32px"><div style="font-size:22px;font-weight:800">🐟 ${merchant_name}</div><div style="font-size:14px;opacity:.7;margin-top:4px">${today}</div></div><div style="padding:28px 32px"><div style="font-size:18px;font-weight:700;color:#1b4332;margin-bottom:16px">Unser heutiges Angebot 🎣</div>${note ? '<div style="background:#f0fdf4;border-left:3px solid #2d7a4f;padding:10px 14px;border-radius:4px;font-size:14px;color:#1b4332;margin-bottom:16px">' + note + '</div>' : ''}<table style="width:100%;border-collapse:collapse">${productRows}</table><div style="text-align:center">${waButton}</div></div><div style="background:#f9f9f9;padding:16px 32px;font-size:12px;color:#999;text-align:center">Du erhältst diese E-Mail weil du dich für unser Tagesangebot angemeldet hast.</div></div></body></html>`;
    const subject = '🐟 ' + merchant_name + ' – Angebot ' + today;
    const sent = await sendResendBroadcast(merchant_id, subject, html, merchant_name);
    res.json({ success: true, sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']; let event;
  try { const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET); } catch (e) { return res.status(400).send(`Webhook Error: ${e.message}`); }
  if (event.type === 'checkout.session.completed') {
    const stripeSession = event.data.object, sessionToken = stripeSession.metadata?.session_token, merchantSlug = stripeSession.metadata?.merchant_slug;
    try {
      if (sessionToken) { const { data: cs } = await supabase.from('customer_sessions').select('*').eq('token', sessionToken).single(); if (cs) { await supabase.from('customer_sessions').update({ status: 'paid', paid_at: new Date().toISOString(), stripe_session_id: stripeSession.id }).eq('id', cs.id); const { data: order } = await supabase.from('orders').insert({ session_id: cs.id, merchant_id: cs.merchant_id, customer_wa: cs.customer_wa, items: cs.items, subtotal: cs.subtotal, delivery_fee: cs.delivery_fee, total: cs.total, delivery_type: cs.delivery_type, note: cs.note, status: 'new', paid_at: new Date().toISOString() }).select().single(); if (cs.customer_wa && order) await sendWhatsApp(cs.merchant_id, cs.customer_wa, `✅ Zahlung erhalten! Bestellnr: ${order.order_number}\nGesamt: ${cs.total}€\n\nDanke! 🙏`); } }
      else if (merchantSlug) { const { data: merchant } = await supabase.from('merchants').select('id').eq('slug', merchantSlug).single(); if (merchant) await supabase.from('sales').insert({ merchant_id: merchant.id, amount_rds: stripeSession.amount_total / 100, status: 'completed', stripe_session_id: stripeSession.id, customer_email: stripeSession.customer_email }); }
    } catch (e) { console.error('Stripe webhook error:', e); }
  }
  res.json({ received: true });
});

app.get('/api/subscribers/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('subscribers').select('*').eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });
app.patch('/api/subscribers/:id', async (req, res) => { try { const { data, error } = await supabase.from('subscribers').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, subscriber: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/subscribers', async (req, res) => { try { const { data, error } = await supabase.from('subscribers').insert(req.body).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, subscriber: data }); } catch(e) { res.status(500).json({ error: e.message }); } });

// ═══════════════════════════════════════════════════════════
// LANDINGPAGE
// ═══════════════════════════════════════════════════════════

app.get('/api/pages/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('merchant_pages').select('*').eq('merchant_id', req.params.merchantId).single(); if (error) return res.status(404).json({ error: 'Keine Seite gefunden' }); res.json(data); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/pages', async (req, res) => {
  try {
    const { merchant_id, slug, html_content, settings_json, published } = req.body;
    if (!merchant_id || !html_content) return res.status(400).json({ error: 'merchant_id und html_content erforderlich' });
    const { data: existing } = await supabase.from('merchant_pages').select('id').eq('merchant_id', merchant_id).maybeSingle();
    let data, error;
    if (existing?.id) { ({ data, error } = await supabase.from('merchant_pages').update({ slug, html_content, settings_json: settings_json || {}, published: published || false, updated_at: new Date().toISOString() }).eq('merchant_id', merchant_id).select().single()); }
    else { ({ data, error } = await supabase.from('merchant_pages').insert({ merchant_id, slug, html_content, settings_json: settings_json || {}, published: published || false }).select().single()); }
    if (error) { console.error("Pages save error:", error.message); return res.status(400).json({ error: error.message }); }
    res.json({ success: true, page: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pages/extract-doc', async (req, res) => {
  try {
    const { base64, media_type, filename } = req.body;
    if (!base64) return res.status(400).json({ error: 'base64 fehlt' });
    const fetch = require('node-fetch');
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: media_type || 'application/pdf', data: base64 } }, { type: 'text', text: 'Extrahiere alle relevanten Informationen aus diesem Dokument für eine Firmen-Landingpage. Strukturiere die Ausgabe: Firmenname, Beschreibung, Leistungen, Zielgruppe, USP, Kontakt, Zahlen/Statistiken, Referenzen. Nur die extrahierten Infos, kein Kommentar.' }] }] }) });
    const data = await response.json();
    res.json({ success: true, extracted: data.content?.[0]?.text || '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pages/extract-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL fehlt' });
    const fetch = require('node-fetch');
    const webRes = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ConverdinoBot/1.0)' }, timeout: 10000 });
    if (!webRes.ok) throw new Error('Website nicht erreichbar: ' + webRes.status);
    let text = (await webRes.text()).replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().substring(0, 8000);
    if (!text || text.length < 50) throw new Error('Kein lesbarer Inhalt gefunden');
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 2000, messages: [{ role: 'user', content: `Analysiere diesen Website-Inhalt:\n${text}\n\nExtrahiere: Firmenname, Beschreibung, Leistungen, Zielgruppe, USP, Kontakt.` }] }) });
    const aiData = await aiRes.json();
    if (aiData.error) throw new Error(aiData.error.message);
    res.json({ success: true, extracted: aiData.content?.[0]?.text || '', url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/pages/:merchantId', async (req, res) => { try { const { error } = await supabase.from('merchant_pages').delete().eq('merchant_id', req.params.merchantId); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/pages/chat-patch', async (req, res) => {
  try {
    const { merchant_id, prompt, html } = req.body;
    if (!prompt || !html) return res.status(400).json({ error: 'prompt und html erforderlich' });
    const fetch = require('node-fetch');
    const compressedHtml = html.replace(/\s{3,}/g, ' ').replace(/<!--[\s\S]*?-->/g, '');
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 8000, system: 'Du bist ein Frontend-Entwickler. Gib NUR das vollständige geänderte HTML zurück, beginnend mit <!DOCTYPE html>. Keine Erklärungen, kein Markdown.', messages: [{ role: 'user', content: `AUFGABE: ${prompt}\n\nHTML:\n${compressedHtml.substring(0, 12000)}` }] }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    let newHtml = data.content?.[0]?.text || '';
    const doctypeIdx = newHtml.indexOf('<!DOCTYPE'); if (doctypeIdx > 0) newHtml = newHtml.substring(doctypeIdx);
    if (!newHtml.startsWith('<!DOCTYPE') && !newHtml.startsWith('<html')) throw new Error('Ungültige Antwort');
    if (merchant_id) { const { data: existing } = await supabase.from('merchant_pages').select('id').eq('merchant_id', merchant_id).maybeSingle(); if (existing?.id) await supabase.from('merchant_pages').update({ html_content: newHtml, updated_at: new Date().toISOString() }).eq('merchant_id', merchant_id); }
    res.json({ success: true, html: newHtml });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/pages/generate', async (req, res) => {
  try {
    const { merchant_id, settings, extracted_text, prompt, images } = req.body;
    const s = settings || {};
    const fetch = require('node-fetch');
    const systemPrompt = `Du bist ein Experte für hochwertige Landingpage Erstellung. Du gibst NUR valides, vollständiges HTML zurück – keine Erklärungen, kein Markdown, keine Backticks. Das HTML muss eigenständig funktionieren (inline CSS, Google Fonts erlaubt). Erstelle professionelle, conversion-optimierte Landingpages ohne leere weiße Bereiche.`;
    const color1 = s.color1 || s.primary_color || '#1b4332', color2 = s.color2 || '#25D366', color3 = s.color3 || '#f4a100', color4 = s.color4 || '#ffffff';
    const langs = Array.isArray(s.languages) ? s.languages : [s.language || 'de'], isMultilang = langs.length > 1;
    const langNames = { de: 'Deutsch', en: 'English', es: 'Español' };
    const langLabel = langs.map(l => langNames[l] || l).join(' + ');
    const sections = s.sections || 'Hero, Leistungen, Über uns, Kontakt';
    if (s.description && s.description.length > 500) s.description = s.description.substring(0, 500);
    if (s.services && s.services.length > 300) s.services = s.services.substring(0, 300);
    const imgBlocks = [], imgInstructions = [];
    if (images && images.length > 0) { images.forEach((img, i) => { if (img.base64 && img.base64.length > 100) { imgBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.base64 } }); imgInstructions.push(img.role === 'logo' ? 'LOGO: <img src="data:' + (img.media_type||'image/jpeg') + ';base64,' + img.base64 + '" style="height:40px;object-fit:contain" alt="Logo">' : img.role === 'hero' ? 'HERO: background-image:url(data:' + (img.media_type||'image/jpeg') + ';base64,' + img.base64 + ');background-size:cover' : `BILD ${i+1}: base64 src verwenden`); } }); }
    const imgNote = imgInstructions.length > 0 ? '\n\nBILDER (PFLICHT):\n' + imgInstructions.join('\n') : '';
    const waNum = s.whatsapp ? s.whatsapp.replace(/[^0-9]/g,'') : '';
    const userPrompt = `Erstelle eine vollständige, professionelle HTML Landingpage:\n\nFIRMA: ${s.company_name || 'Unbekannt'}\nBRANCHE: ${s.industry || 'Allgemein'}\nBESCHREIBUNG: ${s.description || ''}\nZIELGRUPPE: ${s.target_audience || ''}\nUSP: ${s.usp || ''}\nLEISTUNGEN: ${s.services || ''}\nCTA: ${s.cta || 'Jetzt anfragen'}\nWHATSAPP: ${s.whatsapp || ''}\nEMAIL: ${s.email || ''}\nSPRACHE(N): ${langLabel}\nSECTIONS: ${sections}${extracted_text ? '\nZUSATZ-INFO:\n' + extracted_text.substring(0, 1000) : ''}${imgNote}\n\nFARBEN: Primär ${color1}, Sekundär ${color2}, Akzent1 ${color3}, Akzent2 ${color4}\n${isMultilang ? `MEHRSPRACHIG: Sprachwechsler (${langs.map(l=>langNames[l]).join(' | ')}). Standard: ${langNames[langs[0]]}.` : `SPRACHE: ${langNames[langs[0]]||'Deutsch'}.`}\n${waNum ? `WhatsApp Float Button mit href="https://wa.me/${waNum}"` : ''}\n\nGib NUR das HTML zurück, beginnend mit <!DOCTYPE html>.`;
    const msgContent = [...imgBlocks, { type: 'text', text: userPrompt }];
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 8000, system: systemPrompt, messages: [{ role: 'user', content: msgContent }] }) });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    let html = data.content?.[0]?.text || '';
    if (!prompt) { const doctypeIdx = html.indexOf('<!DOCTYPE'); if (doctypeIdx > 0) html = html.substring(doctypeIdx); else if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) throw new Error('Ungültige AI Antwort'); }
    res.json({ success: true, html });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// PARTNERS / QR / OFFER LINKS / NEWSLETTER / AVAILABILITY CURRENT
// ═══════════════════════════════════════════════════════════

app.get('/api/partners/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('partners').select('*').eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/partners', async (req, res) => { try { const { merchant_id, name, email, phone, commission_type, commission_value } = req.body; if (!merchant_id || !name) return res.status(400).json({ error: 'merchant_id und name erforderlich' }); const code = name.substring(0,3).toUpperCase() + Math.random().toString(36).substring(2,6).toUpperCase(); const { data, error } = await supabase.from('partners').insert({ merchant_id, name, email: email||null, phone: phone||null, referral_code: code, commission_type: commission_type || 'percentage', commission_value: parseFloat(commission_value) || 10, status: 'active' }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, partner: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/partners/:id', async (req, res) => { try { const { data, error } = await supabase.from('partners').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, partner: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/partners/:id', async (req, res) => { try { const { error } = await supabase.from('partners').delete().eq('id', req.params.id); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

function generateQRCode() { return 'QR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2,6).toUpperCase(); }
app.post('/api/qr/generate', async (req, res) => { try { const { merchant_id, order_id, product_name, customer_name, customer_email, quantity, valid_until, metadata } = req.body; if (!merchant_id) return res.status(400).json({ error: 'merchant_id erforderlich' }); const code = generateQRCode(); const { data, error } = await supabase.from('qr_codes').insert({ merchant_id, order_id: order_id||null, code, product_name: product_name||null, customer_name: customer_name||null, customer_email: customer_email||null, quantity: quantity||1, status: 'open', valid_until: valid_until||null, metadata: metadata||null }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, qr: data, code }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/qr/:code', async (req, res) => { try { const { data, error } = await supabase.from('qr_codes').select('*').eq('code', req.params.code).single(); if (error || !data) return res.status(404).json({ error: 'QR Code nicht gefunden' }); if (data.valid_until && new Date(data.valid_until) < new Date()) { await supabase.from('qr_codes').update({ status: 'expired' }).eq('id', data.id); data.status = 'expired'; } res.json(data); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/qr/redeem', async (req, res) => { try { const { code, redeemed_by } = req.body; if (!code) return res.status(400).json({ error: 'code erforderlich' }); const { data: qr } = await supabase.from('qr_codes').select('*').eq('code', code).single(); if (!qr) return res.status(404).json({ error: 'QR Code nicht gefunden' }); if (qr.status === 'redeemed') return res.status(409).json({ error: 'Bereits eingeloest', qr }); if (qr.status === 'expired') return res.status(410).json({ error: 'Abgelaufen', qr }); if (qr.valid_until && new Date(qr.valid_until) < new Date()) return res.status(410).json({ error: 'Abgelaufen', qr }); const { data, error } = await supabase.from('qr_codes').update({ status: 'redeemed', redeemed_at: new Date().toISOString(), redeemed_by: redeemed_by||'unbekannt' }).eq('id', qr.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, qr: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/qr-list/:merchantId', async (req, res) => { try { const { data, error } = await supabase.from('qr_codes').select('*').eq('merchant_id', req.params.merchantId).order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/offer-links', async (req, res) => { try { const { merchant_id, customer_name, customer_wa, items, total, note, expires_hours } = req.body; if (!merchant_id || !items) return res.status(400).json({ error: 'merchant_id und items erforderlich' }); const token = generateToken(); const expiresAt = new Date(Date.now() + (expires_hours||48) * 60 * 60 * 1000).toISOString(); const { data, error } = await supabase.from('offer_links').insert({ merchant_id, token, customer_name: customer_name||null, customer_wa: customer_wa||null, items, total: total||null, note: note||null, status: 'open', expires_at: expiresAt }).select().single(); if (error) return res.status(400).json({ error: error.message }); const url = BASE_URL + '/angebot.html?t=' + token; const waNum = customer_wa ? customer_wa.replace(/[^0-9]/g,'') : null; const waText = encodeURIComponent('Hallo ' + (customer_name||'') + '!\n\nHier ist dein persoenliches Angebot:\n' + url); const waLink = waNum ? 'https://wa.me/' + waNum + '?text=' + waText : null; res.json({ success: true, offer: data, url, waLink }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.get('/api/offer-links/:token', async (req, res) => { try { const { data, error } = await supabase.from('offer_links').select('*').eq('token', req.params.token).single(); if (error || !data) return res.status(404).json({ error: 'Angebot nicht gefunden' }); if (new Date(data.expires_at) < new Date() && data.status === 'open') { await supabase.from('offer_links').update({ status: 'expired' }).eq('id', data.id); return res.status(410).json({ error: 'Angebot abgelaufen' }); } res.json(data); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/newsletter/subscribe', async (req, res) => { try { const { email, name, whatsapp, merchant_id, merchant_slug } = req.body; if (!email) return res.status(400).json({ error: 'E-Mail erforderlich' }); let mId = merchant_id; if (!mId && merchant_slug) { const { data: m } = await supabase.from('merchants').select('id').eq('slug', merchant_slug).single(); mId = m?.id; } if (!mId) return res.status(400).json({ error: 'Merchant nicht gefunden' }); const { data, error } = await supabase.from('subscribers').upsert({ email, name: name||'', merchant_id: mId, channel: 'email', status: 'active', active: true, opted_in_at: new Date().toISOString() }, { onConflict: 'email,merchant_id' }).select().single(); if (error) return res.status(400).json({ error: error.message }); if (whatsapp) { try { await supabase.from('subscribers').update({ whatsapp, channel: 'both' }).eq('id', data.id); const { data: merchant } = await supabase.from('merchants').select('name').eq('id', mId).single(); await sendWhatsApp(mId, '+' + whatsapp.replace(/[^0-9]/g,''), 'Hallo ' + (name||'') + '! Antworte JA fuer WhatsApp-Updates.\nSTOP zum Ablehnen.'); } catch(e) {} } res.json({ success: true, subscriber: data }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/availability/current/:merchantId', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: avails } = await supabase.from('daily_availability').select('*, daily_products(*)').eq('merchant_id', req.params.merchantId).order('updated_at', { ascending: false });
    if (!avails || avails.length === 0) return res.json(null);
    const current = avails.find(a => { if (a.period_type === 'permanent') return true; if (a.period_type === 'today' && a.date === today) return true; if (a.period_type === 'range' && a.period_from <= today && (!a.period_to || a.period_to >= today)) return true; if (!a.period_type && a.date === today) return true; return false; });
    if (!current) return res.json(null);
    if (current.daily_products && current.daily_products.length > 0) { const productIds = current.daily_products.map(dp => dp.product_id).filter(Boolean); if (productIds.length > 0) { const { data: products } = await supabase.from('merchant_products').select('id, purchasable, stripe_link').in('id', productIds); current.daily_products = current.daily_products.map(dp => { const prod = products?.find(p => p.id === dp.product_id); return { ...dp, purchasable: prod?.purchasable !== false, stripe_link: prod?.stripe_link }; }); } }
    res.json(current);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// CHECK-PAYMENT (Webhook-Fallback) – NUR EINMAL!
// ═══════════════════════════════════════════════════════════

app.post('/api/vk/check-payment', async (req, res) => {
  try {
    const { token } = req.body;
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (!session.stripe_session_id) return res.json({ paid: false, status: session.status });
    if (['analyzing', 'done', 'paid'].includes(session.status)) return res.json({ paid: true, status: session.status });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const checkout = await stripe.checkout.sessions.retrieve(session.stripe_session_id);
    console.log('check-payment:', checkout.payment_status, '/', session.status);

    if (checkout.payment_status === 'paid') {
      const now = new Date();
      await supabase.from('vk_sessions').update({ status: 'analyzing', paid_at: now.toISOString(), total_price: checkout.amount_total / 100 }).eq('id', session.id);

      (async () => {
        try {
          const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
          for (const article of (articles || [])) {
            if (!(article.vk_photos || []).length) continue;
            const analysis = await vkAnalyzeArticle(article, article.vk_photos, session ? session.phone : '');
            const newTitle = analysis.title_short || null;
          const articleUpdate = { analysis, status: 'analyzed' };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id);
            if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : '').catch(function(e){console.error('Market bg:',e.message);}); }
          }
          const anyExtended = (articles || []).some(a => a.extended);
          const days = anyExtended ? 7 : 3;
          await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString(), delete_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() }).eq('id', session.id);
          const link = `https://converdino.com/ergebnis.html?s=${token}`;
          const allLink = `https://converdino.com/auftraege.html?p=${encodeURIComponent(session.phone)}`;
          await vkSendWhatsApp(session.phone, `Dein Verkaufsreport ist fertig!\n\nErgebnis:\n${link}\n\nAlle Auftraege:\n${allLink}\n\nWird in ${days} Tagen geloescht.`);
          console.log('check-payment: analysis done for', token);
        } catch(e) {
          console.error('check-payment analysis error:', e.message);
          await supabase.from('vk_sessions').update({ status: 'error' }).eq('token', token);
        }
      })();

      return res.json({ paid: true, status: 'analyzing' });
    }

    res.json({ paid: false, status: session.status });
  } catch(e) {
    console.error('check-payment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════


// ── PDF EXPORT: print-optimiertes HTML ────────────────────────
app.get('/api/vk/pdf/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).send('Session nicht gefunden');

    const { data: articles } = await supabase.from('vk_articles')
      .select('*, vk_photos(*)').eq('session_id', session.id).order('sort_order', { ascending: true });

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    let body = '';
    (articles || []).forEach(function(a, i) {
      const an = a.analysis || {};
      const photos = a.vk_photos || [];
      if (!an.title_short) return;

      body += `<div class="article">
        <h2>${i+1}. ${esc(a.title || 'Artikel')}</h2>`;

      // Fotos einbinden
      if (photos.length > 0) {
        body += `<div class="photos">`;
        photos.forEach(function(p) {
          body += `<img src="${p.public_url}" alt="Produktfoto">`;
        });
        body += `</div>`;
      }

      if (an.title_short) body += `<p><strong>Kurztitel:</strong> ${esc(an.title_short)}</p>`;
      if (an.title_long)  body += `<p><strong>Ausführlicher Titel:</strong> ${esc(an.title_long)}</p>`;
      if (an.price_recommended) body += `<p><strong>Empfohlener Preis:</strong> €${an.price_recommended} &nbsp;|&nbsp; Min: €${an.price_min||0} &nbsp;|&nbsp; Max: €${an.price_max||0}</p>`;
      if (an.short_desc) body += `<p><strong>Kurzbeschreibung:</strong><br>${esc(an.short_desc)}</p>`;
      if (an.long_desc)  body += `<p><strong>Beschreibung:</strong><br>${esc(an.long_desc)}</p>`;
      if (an.bullet_points && an.bullet_points.length) {
        body += `<p><strong>Highlights:</strong></p><ul>`;
        an.bullet_points.forEach(b => { body += `<li>${esc(b)}</li>`; });
        body += `</ul>`;
      }
      if (an.keywords && an.keywords.length) body += `<p><strong>Keywords:</strong> ${esc(an.keywords.join(', '))}</p>`;
      if (an.condition) body += `<p><strong>Zustand:</strong> ${esc(an.condition)}</p>`;
      if (an.price_reasoning) body += `<p><strong>Preisbegründung:</strong> ${esc(an.price_reasoning)}</p>`;
      if (an.tips && an.tips.length) {
        body += `<p><strong>Verkaufstipps:</strong></p><ul>`;
        an.tips.forEach(t => { body += `<li>${esc(t)}</li>`; });
        body += `</ul>`;
      }
      body += `</div>`;
    });

    const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
<title>Verkaufsreport ${esc(session.phone)}</title>
<style>
  body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;font-size:13px;line-height:1.5;}
  h1{color:#2d7a4f;border-bottom:2px solid #2d7a4f;padding-bottom:8px;margin-bottom:20px;}
  h2{color:#1b4332;margin:20px 0 8px;font-size:15px;border-left:4px solid #25D366;padding-left:10px;}
  p{margin:4px 0;}
  ul{margin:4px 0 8px 20px;}
  .article{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px;page-break-inside:avoid;}
  .meta{color:#6b7280;font-size:11px;margin-bottom:16px;}
  .print-btn{background:#2d7a4f;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;margin-bottom:20px;}
  .photos{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 14px;}
  .photos img{width:160px;height:160px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;}
  @media print{.print-btn{display:none;} .photos img{width:140px;height:140px;} .article{page-break-inside:avoid;}}
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨️ Als PDF drucken / speichern</button>
<h1>📊 Verkaufsreport</h1>
<div class="meta">Telefon: ${esc(session.phone)} · Erstellt: ${new Date(session.created_at).toLocaleDateString('de-AT')} · ${(articles||[]).length} Artikel</div>
${body}
<script>
  // Automatisch Druckdialog öffnen
  // window.onload = function() { window.print(); }
</script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Fehler: ' + e.message); }
});



// ═══════════════════════════════════════════════════════════
// BUSINESS DISCOUNTS (Firmen-Rabatte)
// ═══════════════════════════════════════════════════════════

app.get('/api/vk/admin/business-discounts', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_business_discounts')
      .select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/admin/business-discounts', async (req, res) => {
  try {
    const { company_name, phone, discount_percent, valid_until, max_uses, notes, sales_commission_percent, landingpage_enabled, wise_email, seller_email, seller_address, seller_zip, seller_city, seller_uid } = req.body;
    if (!company_name || !phone || !discount_percent)
      return res.status(400).json({ error: 'company_name, phone und discount_percent erforderlich' });
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    const { data, error } = await supabase.from('vk_business_discounts').insert({
      company_name, phone: cleanPhone,
      discount_percent: parseInt(discount_percent),
      valid_until: valid_until || null,
      max_uses: max_uses || null,
      notes: notes || null,
      sales_commission_percent: parseInt(sales_commission_percent) || 0,
      landingpage_enabled: landingpage_enabled === true || landingpage_enabled === 'true',
      wise_email: wise_email || null,
      seller_email: seller_email || null,
      seller_address: seller_address || null,
      seller_zip: seller_zip || null,
      seller_city: seller_city || null,
      seller_uid: seller_uid || null,
      active: true, used_count: 0
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, discount: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/business-discounts/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_business_discounts')
      .update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, discount: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vk/admin/business-discounts/:id', async (req, res) => {
  try {
    await supabase.from('vk_business_discounts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Session: Business-Rabatt Info abrufen – immer frisch aus vk_business_discounts
app.get('/api/vk/session/:token/discount', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select('phone, business_discount_id').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    // Direkt via business_discount_id laden (aktueller Wert)
    if (session.business_discount_id) {
      const { data: bd } = await supabase.from('vk_business_discounts')
        .select('company_name, discount_percent, active, valid_until, max_uses, used_count')
        .eq('id', session.business_discount_id).single();
      if (bd && bd.active) {
        const isExpired = bd.valid_until && new Date(bd.valid_until) < new Date();
        const isFull = bd.max_uses && bd.used_count >= bd.max_uses;
        if (!isExpired && !isFull) {
          // Session-Wert auch aktualisieren
          await supabase.from('vk_sessions').update({ business_discount_pct: bd.discount_percent }).eq('token', req.params.token);
          return res.json({ has_discount: true, percent: bd.discount_percent, company: bd.company_name, landingpage_enabled: !!bd.landingpage_enabled });
        }
      }
    }

    // Fallback: Telefonnummer prüfen (falls business_discount_id nicht gesetzt)
    if (session.phone) {
      const bd = await vkGetBusinessDiscount(session.phone);
      if (bd) {
        await supabase.from('vk_sessions').update({ business_discount_id: bd.id, business_discount_pct: bd.discount_percent }).eq('token', req.params.token);
        return res.json({ has_discount: true, percent: bd.discount_percent, company: bd.company_name, landingpage_enabled: !!bd.landingpage_enabled });
      }
    }

    res.json({ has_discount: false, landingpage_enabled: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── BUSINESS FREE: 100% Firmenrabatt → direkt analysieren ──
app.post('/api/vk/business-free', async (req, res) => {
  try {
    const { token } = req.body;
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    // Prüfen ob wirklich 100% Business Rabatt
    if (!session.business_discount_pct || session.business_discount_pct < 100) {
      return res.status(400).json({ error: 'Kein 100% Firmenrabatt auf dieser Session' });
    }

    const now = new Date();
    await supabase.from('vk_sessions').update({
      status: 'analyzing',
      paid_at: now.toISOString(),
      total_price: 0
    }).eq('id', session.id);

    // Nutzungszähler des Business-Rabatts erhöhen
    if (session.business_discount_id) {
      const { data: bd } = await supabase.from('vk_business_discounts').select('used_count').eq('id', session.business_discount_id).single();
      if (bd) await supabase.from('vk_business_discounts').update({ used_count: (bd.used_count||0) + 1 }).eq('id', session.business_discount_id);
    }

    res.json({ success: true, status: 'analyzing' });

    // Analyse im Hintergrund
    (async () => {
      try {
        const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
        for (const article of (articles || [])) {
          if (!(article.vk_photos || []).length) continue;
          const analysis = await vkAnalyzeArticle(article, article.vk_photos, session ? session.phone : '');
          const newTitle = analysis.title_short || null;
          const articleUpdate = { analysis, status: 'analyzed' };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id);
          if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : '').catch(function(e){console.error('Market bg:',e.message);}); }
        }
        const anyExtended = (articles || []).some(a => a.extended);
        const days = anyExtended ? 7 : 3;
        await supabase.from('vk_sessions').update({
          status: 'done',
          analyzed_at: new Date().toISOString(),
          delete_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
        }).eq('id', session.id);
        const link = `https://converdino.com/ergebnis.html?s=${token}`;
        await vkSendWhatsApp(session.phone, `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\n${link}\n\n🗑️ Wird in ${days} Tagen gelöscht.`);
      } catch(e) {
        console.error('Business-free analysis error:', e.message);
        await supabase.from('vk_sessions').update({ status: 'error' }).eq('token', token);
      }
    })();

  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ═══════════════════════════════════════════════════════════
// PRODUKT-LANDINGPAGES – p.converdino.com/p/:slug
// ═══════════════════════════════════════════════════════════

// Slug aus Titel generieren
function vkGenerateSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9\s-]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .substring(0, 60)
    .replace(/^-|-$/g,'')
    + '-' + Math.random().toString(36).substring(2,7);
}

// Produktseite HTML generieren
function vkBuildLandingpageHTML(article, session, lp, sellerInfo) {
  const an = article.analysis || {};
  const photos = article.vk_photos || [];
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const price = parseFloat(lp.sale_price || an.price_recommended || 0);
  const priceStr = price > 0 ? '€\u00a0' + price.toLocaleString('de-AT', {minimumFractionDigits:2,maximumFractionDigits:2}) : 'Preis auf Anfrage';

  // Foto Gallery
  const photoSlides = photos.map((p,i) =>
    '<div class="slide' + (i===0?' active':'') + '" style="display:'+(i===0?'block':'none')+';">' +
    '<img src="' + p.public_url + '" alt="' + esc(article.title||'Produkt') + ' Foto ' + (i+1) + '">' +
    '</div>'
  ).join('');

  const photoDots = photos.length > 1 ? photos.map((_,i) =>
    '<span class="dot' + (i===0?' active':'') + '" onclick="goSlide(' + i + ')"></span>'
  ).join('') : '';

  const photoNav = photos.length > 1 ? '<button class="nav-btn nav-prev" onclick="changeSlide(-1)">&#8249;</button><button class="nav-btn nav-next" onclick="changeSlide(1)">&#8250;</button>' : '';

  // Delivery
  const deliveryItems = [];
  if (lp.delivery_pickup) {
    deliveryItems.push('<div class="delivery-item"><div class="delivery-icon">🤝</div><div><div class="delivery-title">Selbstabholung</div>' + (lp.pickup_location ? '<div class="delivery-sub">' + esc(lp.pickup_location) + '</div>' : '') + '</div></div>');
  }
  if (lp.delivery_shipping) {
    deliveryItems.push('<div class="delivery-item"><div class="delivery-icon">📦</div><div><div class="delivery-title">Versand möglich</div><div class="delivery-sub">Versandkosten: €' + parseFloat(lp.shipping_cost||0).toFixed(2) + '</div></div></div>');
  }

  // Highlights
  const bulletHTML = (an.bullet_points||[]).slice(0,6).map(b =>
    '<li class="highlight-item"><span class="highlight-dot">✓</span><span>' + esc(b) + '</span></li>'
  ).join('');

  // Keywords
  const keywordHTML = (an.keywords||[]).slice(0,8).map(k =>
    '<span class="tag">' + esc(k) + '</span>'
  ).join('');

  // Condition badge
  const conditionColor = { 'Neu': '#059669', 'Neuwertig': '#059669', 'Sehr gut': '#2d7a4f', 'Gut': '#d97706', 'Gebraucht': '#9ca3af' };
  const condClass = an.condition ? (Object.keys(conditionColor).find(k => (an.condition||'').includes(k)) || '') : '';
  const condColor = conditionColor[condClass] || '#6b7280';

  // Active until
  let expiryNote = '';
  if (lp.active_until) {
    const days = Math.ceil((new Date(lp.active_until) - new Date()) / (1000*60*60*24));
    if (days > 0) expiryNote = '<div class="expiry-note">⏳ Angebot noch ' + days + ' Tag' + (days===1?'':'e') + ' verfügbar</div>';
  }

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(an.title_short || article.title || 'Produkt')} – Converdino</title>
<meta name="description" content="${esc(an.short_desc || '')}">
<meta property="og:title" content="${esc(an.title_short || article.title || 'Produkt')}">
<meta property="og:description" content="${esc(an.short_desc || '')}">
${photos[0] ? '<meta property="og:image" content="' + photos[0].public_url + '">' : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',sans-serif;background:#f8f9fa;color:#1a1a1a;min-height:100vh;}

/* HEADER */
.top-bar{background:#fff;border-bottom:1px solid #e5e7eb;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06);}
.logo-area{display:flex;align-items:center;gap:8px;}
.logo-badge{width:32px;height:32px;background:linear-gradient(135deg,#25D366,#128C7E);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;}
.logo-text{font-weight:800;font-size:.95rem;color:#1a1a1a;}
.logo-sub{font-size:.7rem;color:#9ca3af;font-weight:500;}
.share-btn{padding:7px 14px;background:#f3f4f6;border:none;border-radius:8px;font-size:.8rem;font-weight:600;cursor:pointer;color:#374151;display:flex;align-items:center;gap:5px;}
.share-btn:hover{background:#e5e7eb;}

/* GALLERY */
.gallery-wrap{position:relative;background:#000;max-height:420px;overflow:hidden;}
.slide img{width:100%;max-height:420px;object-fit:contain;display:block;}
.nav-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,.5);color:#fff;border:none;width:40px;height:40px;border-radius:50%;font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:10;transition:background .2s;}
.nav-btn:hover{background:rgba(0,0,0,.8);}
.nav-prev{left:10px;}
.nav-next{right:10px;}
.dots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:6px;}
.dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.5);cursor:pointer;transition:all .2s;}
.dot.active{background:#fff;width:20px;border-radius:4px;}
.photo-count{position:absolute;top:12px;right:12px;background:rgba(0,0,0,.6);color:#fff;padding:3px 8px;border-radius:12px;font-size:.72rem;font-weight:600;}

/* MAIN CONTENT */
.main{max-width:640px;margin:0 auto;padding:16px;}

/* PRICE CARD */
.price-card{background:#fff;border-radius:14px;padding:20px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);}
.article-title{font-size:1.15rem;font-weight:700;line-height:1.4;color:#1a1a1a;margin-bottom:8px;}
.condition-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#f0fdf4;border-radius:20px;font-size:.72rem;font-weight:700;margin-bottom:12px;}
.price-main{font-size:2.2rem;font-weight:900;color:#15803d;letter-spacing:-1px;margin-bottom:4px;}
.price-range{font-size:.8rem;color:#9ca3af;margin-bottom:16px;}
${expiryNote ? '.expiry-note{background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;font-size:.8rem;color:#92400e;font-weight:600;margin-bottom:12px;}' : ''}
.cta-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:16px;background:linear-gradient(135deg,#25D366,#1da851);color:#fff;border:none;border-radius:12px;font-size:1.05rem;font-weight:800;cursor:pointer;text-decoration:none;box-shadow:0 4px 12px rgba(37,211,102,.35);transition:all .2s;letter-spacing:.2px;}
.cta-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(37,211,102,.45);}
.cta-btn:active{transform:translateY(0);}

/* SECTIONS */
.section-card{background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.07);}
.section-heading{font-size:.72rem;font-weight:800;color:#9ca3af;text-transform:uppercase;letter-spacing:.8px;margin-bottom:12px;display:flex;align-items:center;gap:6px;}

/* HIGHLIGHTS */
.highlight-list{list-style:none;display:flex;flex-direction:column;gap:8px;}
.highlight-item{display:flex;align-items:flex-start;gap:10px;font-size:.88rem;line-height:1.5;}
.highlight-dot{width:20px;height:20px;border-radius:50%;background:#dcfce7;color:#15803d;font-size:.75rem;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;}

/* DESCRIPTION */
.desc-text{font-size:.88rem;line-height:1.7;color:#374151;}

/* DELIVERY */
.delivery-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;}
.delivery-item:last-child{border-bottom:none;}
.delivery-icon{width:36px;height:36px;border-radius:10px;background:#f0fdf4;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;}
.delivery-title{font-weight:700;font-size:.88rem;margin-bottom:2px;}
.delivery-sub{font-size:.78rem;color:#6b7280;}

/* TAGS */
.tags-wrap{display:flex;flex-wrap:wrap;gap:6px;}
.tag{padding:4px 10px;background:#f3f4f6;border-radius:20px;font-size:.72rem;color:#374151;font-weight:500;}

/* CONDITION */
.condition-box{background:#f9fafb;border-radius:10px;padding:12px 14px;font-size:.85rem;line-height:1.6;color:#374151;}

/* DISCLAIMER */
.disclaimer{background:#f9fafb;border-radius:10px;padding:14px;font-size:.72rem;color:#9ca3af;line-height:1.6;margin-top:4px;margin-bottom:20px;}
.disclaimer a{color:#9ca3af;}

/* FOOTER */
.site-footer{text-align:center;padding:20px;font-size:.72rem;color:#d1d5db;}
.footer-logo{font-weight:800;color:#25D366;font-size:.85rem;}

@media(max-width:400px){
  .price-main{font-size:1.8rem;}
  .gallery-wrap{max-height:280px;}
  .slide img{max-height:280px;}
}
</style>
</head>
<body>

<div class="top-bar">
  <div class="logo-area">
    <div class="logo-badge">📦</div>
    <div>
      <div class="logo-text">Converdino</div>
      <div class="logo-sub">Geprüftes Angebot</div>
    </div>
  </div>
  <button class="share-btn" onclick="shareLP()">↗ Teilen</button>
</div>

${photos.length > 0 ? `
<div class="gallery-wrap">
  ${photoSlides}
  ${photoNav}
  ${photos.length > 1 ? '<div class="dots">' + photoDots + '</div>' : ''}
  ${photos.length > 1 ? '<div class="photo-count">📷 ' + photos.length + ' Fotos</div>' : ''}
</div>` : ''}

<div class="main">

  <div class="price-card">
    <div class="article-title">${esc(an.title_long || article.title || 'Produkt')}</div>
    ${an.condition ? '<div class="condition-badge" style="color:' + condColor + ';background:' + condColor + '18;">⬤ ' + esc(an.condition.split('.')[0]) + '</div>' : ''}
    <div class="price-main">${priceStr}</div>
    ${an.price_min && an.price_max ? '<div class="price-range">Marktpreis: €' + an.price_min + ' – €' + an.price_max + '</div>' : ''}
    ${expiryNote}
    <a class="cta-btn" href="/p/${lp.slug}/buy" id="cta-btn">
      🛒 Jetzt kaufen
    </a>
    <div style="text-align:center;margin-top:8px;font-size:.75rem;color:#9ca3af;">Sichere Zahlung via Stripe</div>
  </div>

  ${bulletHTML ? `
  <div class="section-card">
    <div class="section-heading">✨ Highlights</div>
    <ul class="highlight-list">${bulletHTML}</ul>
  </div>` : ''}

  ${an.short_desc || an.long_desc ? `
  <div class="section-card">
    <div class="section-heading">📋 Beschreibung</div>
    <p class="desc-text">${esc(an.long_desc || an.short_desc || '')}</p>
  </div>` : ''}

  ${an.condition ? `
  <div class="section-card">
    <div class="section-heading">🔍 Zustand</div>
    <div class="condition-box">${esc(an.condition)}</div>
  </div>` : ''}

  ${deliveryItems.length ? `
  <div class="section-card">
    <div class="section-heading">🚚 Lieferung & Abholung</div>
    ${deliveryItems.join('')}
  </div>` : ''}

  ${keywordHTML ? `
  <div class="section-card">
    <div class="section-heading">🏷 Tags</div>
    <div class="tags-wrap">${keywordHTML}</div>
  </div>` : ''}

  ${sellerInfo ? `
  <div class="section-card">
    <div class="section-heading">👤 Anbieter dieses Artikels</div>
    <div style="font-size:.85rem;line-height:1.8;color:#374151;">
      <strong>${esc(sellerInfo.company_name || '')}</strong><br>
      ${sellerInfo.seller_address ? esc(sellerInfo.seller_address) + '<br>' : ''}
      ${sellerInfo.seller_zip && sellerInfo.seller_city ? esc(sellerInfo.seller_zip) + ' ' + esc(sellerInfo.seller_city) + '<br>' : ''}
      ${sellerInfo.seller_email ? '<a href="mailto:' + esc(sellerInfo.seller_email) + '" style="color:#25D366;">' + esc(sellerInfo.seller_email) + '</a><br>' : ''}
      ${sellerInfo.phone ? 'Tel: ' + esc(sellerInfo.phone) : ''}
      ${sellerInfo.seller_uid ? '<br>UID: ' + esc(sellerInfo.seller_uid) : ''}
    </div>
  </div>` : ''}

  <div class="disclaimer">
    <strong>Hinweis:</strong> Converdino ist ausschließlich Vermittler zwischen Käufer und Verkäufer. Vertragspartner des Kaufvertrags ist ausschließlich der Anbieter dieses Artikels. Converdino übernimmt keine Haftung für Produktbeschaffenheit, Lieferung oder Gewährleistungsansprüche. Diese richten sich ausschließlich an den Verkäufer.
  </div>

</div>

<div class="site-footer">
  <div class="footer-logo">Converdino</div>
  <div style="margin-top:4px;margin-bottom:8px;">Der smarte Weg zum Verkauf</div>
  <div style="font-size:.68rem;color:#9ca3af;line-height:1.6;">
    Betrieben von <strong style="color:#6b7280;">Ynhald Corp</strong><br>
    425 W Colonial Dr Ste 303 #292, Orlando, FL 32804, USA<br>
    <a href="mailto:office@ynhald.com" style="color:#9ca3af;">office@ynhald.com</a>
  </div>
</div>

<script>
// ── FOTO GALLERY ──────────────────────────────────────────
var currentSlide = 0;
var slides = document.querySelectorAll('.slide');
var dots = document.querySelectorAll('.dot');

function goSlide(n) {
  if (!slides.length) return;
  slides[currentSlide].style.display = 'none';
  dots[currentSlide] && dots[currentSlide].classList.remove('active');
  currentSlide = (n + slides.length) % slides.length;
  slides[currentSlide].style.display = 'block';
  dots[currentSlide] && dots[currentSlide].classList.add('active');
}
function changeSlide(dir) { goSlide(currentSlide + dir); }

// Touch/Swipe
var tsX = 0;
var galleryEl = document.querySelector('.gallery-wrap');
if (galleryEl) {
  galleryEl.addEventListener('touchstart', function(e) { tsX = e.touches[0].clientX; }, {passive:true});
  galleryEl.addEventListener('touchend', function(e) {
    var diff = tsX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) changeSlide(diff > 0 ? 1 : -1);
  }, {passive:true});
}

// ── SHARE ─────────────────────────────────────────────────
function shareLP() {
  var url = window.location.href;
  var title = document.title;
  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(function(){});
  } else {
    navigator.clipboard && navigator.clipboard.writeText(url).then(function() {
      var btn = document.querySelector('.share-btn');
      if (btn) { btn.textContent = '✓ Kopiert!'; setTimeout(function(){btn.innerHTML='↗ Teilen';},2000); }
    });
  }
}
</script>

</body>
</html>`;
}

// ── ROUTE: Produktseite ausliefern ─────────────────────────
app.get('/p/:slug', async (req, res) => {
  try {
    const { data: lp } = await supabase.from('vk_landingpages')
      .select('*, vk_articles(*, vk_photos(*)), vk_sessions(phone, business_discount_id)')
      .eq('slug', req.params.slug)
      .single();

    // Verkäufer-Stammdaten laden
    let sellerInfo = null;
    if (lp && lp.vk_sessions && lp.vk_sessions.business_discount_id) {
      const { data: bd } = await supabase.from('vk_business_discounts')
        .select('company_name, phone, seller_email, seller_address, seller_zip, seller_city, seller_uid')
        .eq('id', lp.vk_sessions.business_discount_id).single();
      if (bd) sellerInfo = bd;
    }

    if (!lp) return res.status(404).send('<h1>Seite nicht gefunden</h1>');
    if (lp.status !== 'active') return res.status(410).send('<h1>Dieses Angebot ist nicht mehr verfügbar.</h1>');
    if (lp.active_until && new Date(lp.active_until) < new Date()) {
      await supabase.from('vk_landingpages').update({ status: 'expired' }).eq('id', lp.id);
      return res.status(410).send('<h1>Dieses Angebot ist abgelaufen.</h1>');
    }

    // View Counter erhöhen
    await supabase.from('vk_landingpages').update({ views: (lp.views||0) + 1 }).eq('id', lp.id);

    const html = vkBuildLandingpageHTML(lp.vk_articles, lp.vk_sessions, lp, sellerInfo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) {
    console.error('LP route error:', e.message);
    res.status(500).send('<h1>Fehler beim Laden</h1>');
  }
});

// ── ROUTE: LP erstellen ────────────────────────────────────
app.post('/api/vk/landingpage', async (req, res) => {
  try {
    const { article_id, session_id, days, has_bot, delivery_pickup, delivery_shipping, shipping_cost, pickup_location, sale_price } = req.body;
    if (!article_id || !session_id || !days) return res.status(400).json({ error: 'article_id, session_id und days erforderlich' });

    // Business-Check: Landingpage aktiviert?
    const { data: session } = await supabase.from('vk_sessions').select('business_discount_id, phone').eq('id', session_id).single();
    if (session && session.business_discount_id) {
      const { data: bd } = await supabase.from('vk_business_discounts').select('landingpage_enabled').eq('id', session.business_discount_id).single();
      if (!bd || !bd.landingpage_enabled) return res.status(403).json({ error: 'Landingpage für diesen Account nicht freigeschaltet' });
    }

    const { data: article } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('id', article_id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    const slug = vkGenerateSlug(article.title || (article.analysis?.title_short) || 'produkt');
    const activeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const { data: lp, error } = await supabase.from('vk_landingpages').insert({
      article_id, session_id, slug,
      active_until: activeUntil,
      has_bot: !!has_bot,
      delivery_pickup: delivery_pickup !== false,
      delivery_shipping: !!delivery_shipping,
      shipping_cost: parseFloat(shipping_cost) || 0,
      pickup_location: pickup_location || null,
      sale_price: parseFloat(sale_price) || null,
      status: 'active', views: 0
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, landingpage: lp, url: 'https://p.converdino.com/p/' + slug });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTE: LP Info abrufen ─────────────────────────────────
app.get('/api/vk/landingpage/article/:articleId', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_landingpages')
      .select('*').eq('article_id', req.params.articleId)
      .neq('status', 'deleted').order('created_at', { ascending: false }).limit(1).maybeSingle();
    res.json(data || null);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTE: LP deaktivieren ─────────────────────────────────
app.delete('/api/vk/landingpage/:id', async (req, res) => {
  try {
    await supabase.from('vk_landingpages').update({ status: 'deleted' }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── ROUTE: LP Sofortkauf Stripe Checkout ──────────────────
app.get('/p/:slug/buy', async (req, res) => {
  try {
    const { data: lp } = await supabase.from('vk_landingpages')
      .select('*, vk_articles(title, analysis), vk_sessions(phone, business_discount_id)')
      .eq('slug', req.params.slug).single();

    if (!lp || lp.status !== 'active') return res.status(410).send('<h1>Angebot nicht mehr verfügbar.</h1>');
    if (lp.active_until && new Date(lp.active_until) < new Date()) return res.status(410).send('<h1>Angebot abgelaufen.</h1>');

    const article = lp.vk_articles || {};
    const an = article.analysis || {};
    const price = parseFloat(lp.sale_price || an.price_recommended || 0);
    if (!price || price <= 0) return res.status(400).send('<h1>Kein Preis definiert.</h1>');

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const isShipping = !!lp.delivery_shipping;

    const checkoutParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      customer_creation: 'always',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: an.title_short || article.title || 'Produkt',
            description: an.short_desc || null
          },
          unit_amount: Math.round(price * 100)
        },
        quantity: 1
      }],
      metadata: {
        lp_id: lp.id,
        lp_slug: lp.slug,
        session_id: lp.session_id,
        article_id: lp.article_id,
        delivery_type: isShipping ? 'shipping' : 'pickup'
      },
      success_url: 'https://p.converdino.com/p/' + lp.slug + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://p.converdino.com/p/' + lp.slug,
      billing_address_collection: 'required'
    };

    // Immer: E-Mail abfragen (Pflicht für Bestätigung)
    // Stripe sammelt E-Mail automatisch wenn customer_creation: 'always'

    // Versand: zusätzlich Adresse abfragen + Versandkosten
    if (isShipping) {
      checkoutParams.shipping_address_collection = { allowed_countries: ['AT', 'DE', 'CH'] };
      if (lp.shipping_cost > 0) {
        checkoutParams.line_items.push({
          price_data: {
            currency: 'eur',
            product_data: { name: 'Versandkosten' },
            unit_amount: Math.round(lp.shipping_cost * 100)
          },
          quantity: 1
        });
      }
    }

    const checkout = await stripe.checkout.sessions.create(checkoutParams);
    res.redirect(303, checkout.url);
  } catch(e) {
    console.error('LP checkout error:', e.message);
    res.status(500).send('Fehler beim Checkout: ' + e.message);
  }
});

// ── ROUTE: LP Kauf Bestätigung ────────────────────────────
app.get('/p/:slug/success', async (req, res) => {
  try {
    const { session_id } = req.query;
    const { data: lp } = await supabase.from('vk_landingpages')
      .select('*, vk_articles(title, analysis), vk_sessions(phone, business_discount_id)')
      .eq('slug', req.params.slug).single();

    if (!lp) return res.status(404).send('<h1>Nicht gefunden</h1>');

    // Stripe Session laden
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let stripeSession = null;
    if (session_id) {
      stripeSession = await stripe.checkout.sessions.retrieve(session_id);
    }

    const isShipping = lp.delivery_shipping;
    const sellerPhone = lp.vk_sessions ? lp.vk_sessions.phone : null;
    const an = (lp.vk_articles || {}).analysis || {};

    // QR Code für Übergabe generieren
    const qrCode = require('crypto').randomBytes(8).toString('hex').toUpperCase();
    const qrData = 'CONV-' + qrCode;

    // QR Code in DB speichern
    await supabase.from('qr_codes').insert({
      merchant_id: null,
      code: qrData,
      product_name: an.title_short || lp.vk_articles?.title || 'Produkt',
      customer_name: stripeSession?.customer_details?.name || 'Käufer',
      customer_email: stripeSession?.customer_details?.email || null,
      quantity: 1,
      status: 'open',
      metadata: { lp_id: lp.id, lp_slug: lp.slug, stripe_session: session_id }
    });

    // Verkauf + Provision in vk_landingpages speichern
    const saleAmount = stripeSession ? (stripeSession.amount_total / 100) : parseFloat(lp.sale_price || 0);
    // Provision aus Business Discount laden
    let commissionPct = 0;
    if (lp.vk_sessions && lp.vk_sessions.business_discount_id) {
      const { data: bdComm } = await supabase.from('vk_business_discounts')
        .select('sales_commission_percent').eq('id', lp.vk_sessions.business_discount_id).single();
      if (bdComm) commissionPct = bdComm.sales_commission_percent || 0;
    }
    const commissionAmount = Math.round(saleAmount * commissionPct / 100 * 100) / 100;
    const soldAt = new Date();
    // payout_due_at: Abholung = sofort, Versand = +14 Tage
    const payoutDueAt = isShipping
      ? new Date(soldAt.getTime() + 14 * 24 * 60 * 60 * 1000)
      : soldAt;

    await supabase.from('vk_landingpages').update({
      sold_at: soldAt.toISOString(),
      buyer_email: stripeSession?.customer_details?.email || null,
      sale_amount: saleAmount,
      stripe_session_id: session_id || null,
      commission_amount: commissionAmount,
      payout_status: 'open',
      payout_due_at: payoutDueAt.toISOString()
    }).eq('id', lp.id);

    console.log('Sale saved: EUR ' + saleAmount + ', commission: EUR ' + commissionAmount + ', due: ' + payoutDueAt.toISOString());

    // Verkäufer-Info laden (wird für WhatsApp + E-Mail benötigt)
    let sellerBd = null;
    if (lp.vk_sessions && lp.vk_sessions.business_discount_id) {
      const { data: bdData } = await supabase.from('vk_business_discounts')
        .select('company_name, phone, seller_email, seller_address, seller_zip, seller_city')
        .eq('id', lp.vk_sessions.business_discount_id).single();
      if (bdData) sellerBd = bdData;
    }

    // Verkäufer per WhatsApp informieren
    if (sellerPhone) {
      const article = lp.vk_articles || {};
      const buyerName = stripeSession?.customer_details?.name || 'Käufer';
      const buyerEmail = stripeSession?.customer_details?.email || '';
      const amount = stripeSession ? (stripeSession.amount_total / 100).toFixed(2) : lp.sale_price;
      let sellerMsg = 'Artikel verkauft!\n\n';
      sellerMsg += 'Artikel: ' + (an.title_short || article.title || 'Produkt') + '\n';
      sellerMsg += 'Betrag: EUR ' + amount + '\n\n';
      if (isShipping && stripeSession?.shipping_details) {
        const addr = stripeSession.shipping_details.address;
        sellerMsg += 'VERSAND an:\n';
        sellerMsg += buyerName + '\n';
        sellerMsg += addr.line1 + (addr.line2 ? ', ' + addr.line2 : '') + '\n';
        sellerMsg += addr.postal_code + ' ' + addr.city + ', ' + addr.country + '\n';
        if (buyerEmail) sellerMsg += 'Email: ' + buyerEmail + '\n';
      } else {
        sellerMsg += 'Abholung - Kaeufer kommt zu dir.\n';
        sellerMsg += 'QR Code: ' + qrData;
      }
      await vkSendWhatsApp(sellerPhone, sellerMsg);
    }

    // E-Mail an Käufer senden via Resend
    // E-Mail aus Stripe Session - mehrere Quellen prüfen
    const buyerEmailAddr = stripeSession?.customer_details?.email 
      || stripeSession?.customer_email
      || null;
    console.log('Buyer email:', buyerEmailAddr, 'Session ID:', session_id);
    if (buyerEmailAddr) {
      try {
        const articleTitle = an.title_short || (lp.vk_articles || {}).title || 'Produkt';
        const lpUrl = 'https://p.converdino.com/p/' + lp.slug;
        const qrImgForEmail = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrData) + '&color=1b4332&margin=10';

        let emailHtml = '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:20px;">';
        emailHtml += '<h2 style="color:#1b4332;">Zahlung bestaetigt!</h2>';
        emailHtml += '<p>Vielen Dank fuer deinen Kauf bei Converdino.</p>';
        emailHtml += '<p><strong>Artikel:</strong> ' + articleTitle + '</p>';
        emailHtml += '<p><strong>Betrag:</strong> EUR ' + (stripeSession.amount_total / 100).toFixed(2) + '</p>';

        if (isShipping) {
          emailHtml += '<p>Der Verkäufer wurde informiert und wird deinen Artikel versenden.</p>';
        } else {
          emailHtml += '<h3 style="color:#1b4332;">Dein QR Code fuer die Abholung:</h3>';
          emailHtml += '<img src="' + qrImgForEmail + '" style="width:200px;height:200px;" alt="QR Code">';
          emailHtml += '<p style="font-family:monospace;font-size:1.1rem;font-weight:bold;">' + qrData + '</p>';
          emailHtml += '<p>Zeige diesen QR Code bei der Abholung vor.</p>';
        }

        // Verkäufer-Kontaktdaten in E-Mail
        if (sellerBd) {
          emailHtml += '<hr style="margin:20px 0;">';
          emailHtml += '<h3 style="color:#1b4332;">' + (isShipping ? 'Versender' : 'Abholadresse') + '</h3>';
          emailHtml += '<p>' + (sellerBd.company_name || '') + '<br>';
          if (sellerBd.seller_address) emailHtml += sellerBd.seller_address + '<br>';
          if (sellerBd.seller_zip && sellerBd.seller_city) emailHtml += sellerBd.seller_zip + ' ' + sellerBd.seller_city + '<br>';
          if (sellerBd.phone) emailHtml += 'Tel: ' + sellerBd.phone + '<br>';
          if (sellerBd.seller_email) emailHtml += 'E-Mail: ' + sellerBd.seller_email;
          emailHtml += '</p>';
        }

        emailHtml += '<hr style="margin:20px 0;">';
        emailHtml += '<p style="font-size:.8rem;color:#9ca3af;">Converdino – Betrieben von Ynhald Corp, 425 W Colonial Dr Ste 303 #292, Orlando, FL 32804, USA</p>';
        emailHtml += '</div>';

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
          body: JSON.stringify({
            from: 'Converdino <noreply@converdino.com>',
            to: buyerEmailAddr,
            subject: 'Zahlung bestaetigt: ' + articleTitle,
            html: emailHtml
          })
        });
        console.log('Buyer email sent to:', buyerEmailAddr);
      } catch(emailErr) {
        console.error('Buyer email error:', emailErr.message);
      }
    }

    // Bestätigungsseite für Käufer
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const qrImgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(qrData) + '&color=1b4332&margin=10';

    // Verkäufer-Info für Bestätigungsseite (sellerBd bereits geladen)
    let sellerHtml = '';
    if (sellerBd) {
      sellerHtml = '<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px;margin-bottom:16px;">' +
        '<div style="font-weight:800;color:#15803d;margin-bottom:8px;">' + (isShipping ? 'Versender' : 'Abholadresse') + '</div>' +
        '<div style="font-size:.9rem;line-height:1.8;">' +
        '<strong>' + esc(sellerBd.company_name||'') + '</strong><br>' +
        (sellerBd.seller_address ? esc(sellerBd.seller_address) + '<br>' : '') +
        (sellerBd.seller_zip && sellerBd.seller_city ? esc(sellerBd.seller_zip) + ' ' + esc(sellerBd.seller_city) + '<br>' : '') +
        (sellerBd.phone ? 'Tel: ' + esc(sellerBd.phone) + '<br>' : '') +
        (sellerBd.seller_email ? '<a href="mailto:' + esc(sellerBd.seller_email) + '" style="color:#25D366;">' + esc(sellerBd.seller_email) + '</a>' : '') +
        '</div></div>';
    }

    const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kauf bestätigt – Converdino</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',sans-serif;background:#f8f9fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
.card{background:#fff;border-radius:16px;padding:28px 24px;max-width:480px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.08);}
.check{width:64px;height:64px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto 16px;}
h1{font-size:1.3rem;font-weight:800;text-align:center;margin-bottom:6px;}
.sub{font-size:.88rem;color:#6b7280;text-align:center;margin-bottom:20px;}
.qr-box{text-align:center;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px;margin-bottom:16px;}
.qr-box img{width:160px;height:160px;border-radius:8px;display:block;margin:0 auto 8px;}
.qr-label{font-size:.75rem;font-weight:700;color:#15803d;}
.qr-code{font-family:monospace;font-size:1rem;font-weight:800;color:#1b4332;margin-top:4px;}
.footer{font-size:.72rem;color:#9ca3af;text-align:center;margin-top:16px;}
</style></head><body>
<div class="card">
  <div class="check"></div>
  <h1>Zahlung bestätigt!</h1>
  <p class="sub">Vielen Dank für deinen Kauf.</p>

  ${isShipping ? '<div style="background:#dbeafe;border:1.5px solid #93c5fd;border-radius:12px;padding:14px;margin-bottom:16px;font-size:.88rem;color:#1e40af;"> Der Verkäufer wurde informiert und wird deinen Artikel versenden.</div>' :
  '<div class="qr-box"><img src="' + qrImgUrl + '" alt="QR Code"><div class="qr-label">Zeige diesen QR Code bei der Abholung</div><div class="qr-code">' + qrData + '</div></div>'}

  ${sellerHtml}

  <div class="footer">Converdino – Sicherer Marktplatz</div>
</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) {
    console.error('LP success error:', e.message);
    res.status(500).send('Fehler: ' + e.message);
  }
});


// ── ROUTE: Druckbares Produktetikett ──────────────────────
app.get('/api/vk/lp/label/:slug', async (req, res) => {
  try {
    const { data: lp } = await supabase.from('vk_landingpages')
      .select('*, vk_articles(title, analysis, vk_photos(public_url))')
      .eq('slug', req.params.slug).single();

    if (!lp) return res.status(404).send('<h1>Nicht gefunden</h1>');

    const article = lp.vk_articles || {};
    const an = article.analysis || {};
    const photos = article.vk_photos || [];
    const url = 'https://p.converdino.com/p/' + lp.slug;
    const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(url) + '&color=1b4332&bgcolor=ffffff&margin=20';
    const title = an.title_short || article.title || 'Produkt';
    const price = lp.sale_price ? '€ ' + parseFloat(lp.sale_price).toLocaleString('de-AT', {minimumFractionDigits:2}) : '';
    const condition = an.condition ? an.condition.split('.')[0] : '';
    const photo = photos[0] ? photos[0].public_url : null;
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Produktetikett – ${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; background: #fff; }

  /* Druckseite: A4 */
  .page { max-width: 800px; margin: 0 auto; padding: 20px; }

  /* Print Button */
  .print-btn { display: block; margin: 0 auto 24px; padding: 12px 32px; background: #1b4332; color: #fff; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; }
  @media print { .print-btn { display: none; } }

  /* Etikett Grid – 2 pro Reihe */
  .label-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .label {
    border: 2px solid #1b4332;
    border-radius: 12px;
    padding: 16px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    page-break-inside: avoid;
    background: #fff;
  }
  .label-left { flex: 1; min-width: 0; }
  .label-brand { font-size: .6rem; font-weight: 800; color: #25D366; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .label-title { font-size: .78rem; font-weight: 700; line-height: 1.3; margin-bottom: 6px; color: #1a1a1a; }
  .label-price { font-size: 1.3rem; font-weight: 900; color: #1b4332; margin-bottom: 4px; }
  .label-condition { font-size: .65rem; color: #6b7280; margin-bottom: 8px; }
  .label-scan { font-size: .6rem; color: #6b7280; font-weight: 700; text-align: center; margin-top: 4px; }
  .label-right { flex-shrink: 0; text-align: center; }
  .label-right img.qr { width: 90px; height: 90px; border: 1px solid #e5e7eb; border-radius: 6px; }
  .label-right img.photo { width: 90px; height: 70px; object-fit: cover; border-radius: 6px; border: 1px solid #e5e7eb; display: block; margin-bottom: 4px; }
  .label-logo { font-size: .55rem; font-weight: 900; color: #1b4332; letter-spacing: .5px; }

  /* Hinweis */
  .hint { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: .82rem; color: #15803d; }
</style>
</head>
<body>
<div class="page">
  <button class="print-btn" onclick="window.print()">Etiketten drucken</button>

  <div class="hint">
    Diese Seite enthält 4 identische Etiketten zum Ausschneiden. Einfach ausdrucken, ausschneiden und am Produkt befestigen.
    Jeder QR Code führt direkt zur Produktseite.
  </div>

  <div class="label-grid">
    ${[1,2,3,4].map(() => `
    <div class="label">
      <div class="label-left">
        <div class="label-brand">Converdino Marktplatz</div>
        <div class="label-title">${esc(title)}</div>
        ${price ? `<div class="label-price">${esc(price)}</div>` : ''}
        ${condition ? `<div class="label-condition">${esc(condition)}</div>` : ''}
      </div>
      <div class="label-right">
        ${photo ? `<img class="photo" src="${photo}" alt="Foto">` : ''}
        <img class="qr" src="${qrUrl}" alt="QR Code">
        <div class="label-scan">Jetzt scannen</div>
        <div class="label-logo">converdino.com</div>
      </div>
    </div>`).join('')}
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch(e) {
    console.error('LP label error:', e.message);
    res.status(500).send('Fehler: ' + e.message);
  }
});


// ── ROUTE: Verkäufe & Provisionen ────────────────────────
app.get('/api/vk/admin/verkaeufe', async (req, res) => {
  try {
    // Step 1: LPs mit Verkäufen laden
    const { data, error } = await supabase
      .from('vk_landingpages')
      .select('id, slug, sale_price, sale_amount, commission_amount, payout_status, payout_due_at, sold_at, buyer_email, delivery_pickup, delivery_shipping, article_id, session_id')
      .not('sold_at', 'is', null)
      .order('sold_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Step 2: Artikel + Session Daten separat laden und zusammenführen
    const result = await Promise.all((data || []).map(async v => {
      let productTitle = 'Produkt';
      let companyName = '-';

      if (v.article_id) {
        const { data: art } = await supabase.from('vk_articles')
          .select('title, analysis').eq('id', v.article_id).single();
        if (art) productTitle = art.analysis?.title_short || art.title || 'Produkt';
      }

      if (v.session_id) {
        const { data: sess } = await supabase.from('vk_sessions')
          .select('phone, business_discount_id').eq('id', v.session_id).single();
        if (sess && sess.business_discount_id) {
          const { data: bd } = await supabase.from('vk_business_discounts')
            .select('company_name').eq('id', sess.business_discount_id).single();
          if (bd) companyName = bd.company_name || '-';
        }
      }

      return {
        id: v.id,
        slug: v.slug,
        product_title: productTitle,
        company_name: companyName,
        sale_amount: parseFloat(v.sale_amount || v.sale_price || 0),
        commission_amount: parseFloat(v.commission_amount || 0),
        payout_status: v.payout_status || 'open',
        payout_due_at: v.payout_due_at,
        sold_at: v.sold_at,
        buyer_email: v.buyer_email,
        delivery_type: v.delivery_pickup ? 'Abholung' : 'Versand'
      };
    }));

    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTE: Auszahlungsstatus ändern ──────────────────────
app.put('/api/vk/admin/verkaeufe/:id/payout', async (req, res) => {
  try {
    const { payout_status } = req.body;
    if (!['open','done','suspended'].includes(payout_status))
      return res.status(400).json({ error: 'Ungültiger Status' });
    const { error } = await supabase.from('vk_landingpages')
      .update({ payout_status }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════
// CRON CLEANUP ENDPOINT – wird von Railway Cron aufgerufen
// ═══════════════════════════════════════════════════════════
app.post('/api/vk/cron/cleanup', async (req, res) => {
  // Secret-Key Schutz
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const nowIso = now.toISOString();
    let deleted = 0, fixed = 0;

    // ── SCHRITT 1: Sessions mit delete_at = NULL reparieren ──
    // Fertige Sessions ohne delete_at → delete_at setzen
    const { data: nullSessions } = await supabase.from('vk_sessions')
      .select('id, status, created_at, analyzed_at, extended')
      .is('delete_at', null)
      .neq('status', 'deleted');

    for (const s of (nullSessions || [])) {
      let baseDate = s.analyzed_at ? new Date(s.analyzed_at) : new Date(s.created_at);
      let days = s.extended ? 7 : 3;

      // Offene Sessions die älter als 48h sind → 48h Frist ab Erstellung
      if (s.status === 'open') {
        baseDate = new Date(s.created_at);
        days = 2; // 48 Stunden
      }

      const deleteAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
      await supabase.from('vk_sessions')
        .update({ delete_at: deleteAt.toISOString() })
        .eq('id', s.id);
      fixed++;
    }

    // ── SCHRITT 2: Abgelaufene Sessions löschen ──────────────
    const { data: expired } = await supabase.from('vk_sessions')
      .select('id')
      .lte('delete_at', nowIso)
      .neq('status', 'deleted');

    for (const s of (expired || [])) {
      // Fotos aus Storage löschen
      const { data: photos } = await supabase.from('vk_photos')
        .select('storage_path').eq('session_id', s.id);
      if (photos?.length) {
        await supabase.storage.from('vk-photos').remove(photos.map(p => p.storage_path));
      }
      // DB bereinigen
      await supabase.from('vk_photos').delete().eq('session_id', s.id);
      await supabase.from('vk_articles').delete().eq('session_id', s.id);
      await supabase.from('vk_sessions').update({ status: 'deleted' }).eq('id', s.id);
      deleted++;
    }

    console.log(`Cron cleanup: ${fixed} fixed, ${deleted} deleted`);
    res.json({ success: true, fixed, deleted, timestamp: nowIso });

  } catch(e) {
    console.error('Cron cleanup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Converto API v2.2.0 läuft auf Port ${PORT}`);
});

// ═══════════════════════════════════════════════════════════
// VERKAUFSREPORT (VK) – Bildanalyse & Verkaufstexte
// ═══════════════════════════════════════════════════════════

function vkCalcPrice(articles) {
  let total = 1.00; // Grundpreis pro Auftrag
  for (const a of articles) {
    const photoCount = a.photo_count || (a.vk_photos || []).length || 0;
    if (photoCount > 0) {
      total += 1.00;                              // 1. Foto = 1€
      total += Math.max(0, photoCount - 1) * 0.25; // weitere Fotos 0.25€
    }
    if (a.extended) total += 1.00; // 7-Tage Speicherung
    // LP Kosten
    if (a.lp_booked && a.lp_days > 0) {
      const lpRate = a.lp_has_bot ? 1.00 : 0.40;
      total += Math.round(a.lp_days * lpRate * 100) / 100;
    }
  }
  return Math.round(total * 100) / 100;
}

function vkCalcDiscount(coupon, price) {
  let discount = 0, isFree = false;
  const val = parseFloat(coupon.value) || 0;
  if (coupon.type === 'percent') { discount = Math.round((price * val / 100) * 100) / 100; discount = Math.min(discount, price); }
  else if (coupon.type === 'fixed') { discount = Math.min(val, price); }
  else if (coupon.type === 'free') { discount = price; isFree = true; }
  if (!isFree && discount >= price) isFree = true;
  return { discount, isFree };
}

function vkToken() { return Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }

async function vkSaveWhatsAppImage(mediaId, sessionId, articleId, sortOrder) {
  const fetch = require('node-fetch');
  const token = process.env.META_ACCESS_TOKEN;
  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const metaData = await metaRes.json();
  if (!metaData.url) throw new Error('Meta URL nicht gefunden');
  const imgRes = await fetch(metaData.url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer = await imgRes.buffer();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const path = `${sessionId}/${articleId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error('Storage upload: ' + error.message);
  const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
  return { path, url: urlData.publicUrl };
}


// ── MARKTVERGLEICH: Regionale Plattformen ────────────────────
async function vkMarketSearch(productTitle, phone) {
  try {
    const fetch = require('node-fetch');
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    const isDE = cleanPhone.startsWith('49');
    const region = isDE ? 'Deutschland' : 'Oesterreich';
    const searchQuery = isDE ? productTitle + ' gebraucht kaufen Deutschland Kleinanzeigen' : productTitle + ' gebraucht kaufen Oesterreich Willhaben';
    const prompt = 'Suche im Web nach aktuellen Verkaufsangeboten fuer "' + productTitle + '" in ' + region + '. Schau auf Plattformen wie ' + (isDE ? 'kleinanzeigen.de, mobile.de, autoscout24.de' : 'willhaben.at, autoscout24.at, ebay.at') + '. Sei grosszuegig bei der Suche - auch aehnliche Modelle oder Varianten zaehlen. Antworte NUR mit diesem JSON ohne Markdown: {"found":true,"platform":"Willhaben","listings_count":5,"price_range_min":15000,"price_range_max":35000,"price_avg":25000,"assessment":"Dein Artikel liegt im mittleren Preissegment","note":""}. Nur wenn wirklich gar nichts gefunden: {"found":false,"platform":"","listings_count":0,"price_range_min":0,"price_range_max":0,"price_avg":0,"assessment":"","note":"Derzeit keine vergleichbaren Angebote in ' + region + ' gefunden."}';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Du bist Marktanalyse-Experte. Suche aktiv und grosszuegig nach Vergleichspreisen. Antworte IMMER nur mit validem JSON, kein Markdown, keine Erklaerungen.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    const textBlock = (data.content || []).find(function(b) { return b.type === 'text'; });
    if (!textBlock || !textBlock.text) return { found: false, note: 'Derzeit keine vergleichbaren Angebote in ' + region + ' gefunden.' };
    try {
      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      console.log('Market search result for "' + productTitle + '":', JSON.stringify(parsed));
      return parsed;
    } catch(e) {
      console.error('Market JSON parse error:', e.message, 'Raw:', textBlock.text.substring(0, 200));
      return { found: false, note: 'Derzeit keine vergleichbaren Angebote in ' + region + ' gefunden.' };
    }
  } catch(e) {
    console.error('vkMarketSearch error:', e.message);
    return { found: false, note: 'Marktvergleich temporaer nicht verfuegbar.' };
  }
}

async function vkAnalyzeArticle(article, photos, phone) {
  const fetch = require('node-fetch');
  const imageBlocks = photos.map(p => ({ type: 'image', source: { type: 'url', url: p.public_url } }));
  const notesText = article.notes ? '\n\nZusatzinfos vom Verkaeufer: ' + article.notes : '';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-5', max_tokens: 2000,
      system: 'Du bist ein Experte fuer Online-Verkauf (eBay, Willhaben, Kleinanzeigen, Facebook Marketplace). Analysiere die Produktfotos und erstelle einen professionellen Verkaufsbericht. Antworte NUR mit validem JSON, kein Markdown, keine Erklaerungen.',
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: 'Analysiere dieses Produkt und erstelle folgendes JSON:\n{\n  "title_short": "Kurztitel (max 60 Zeichen, SEO-optimiert)",\n  "title_long": "Ausfuehrlicher Titel mit Keywords",\n  "title_quick": "Quick-Sale Titel",\n  "short_desc": "2-3 Saetze Kurzbeschreibung",\n  "long_desc": "Ausfuehrliche Beschreibung",\n  "bullet_points": ["Highlight 1", "Highlight 2", "Highlight 3"],\n  "price_min": 0, "price_max": 0, "price_recommended": 0,\n  "price_reasoning": "Begruendung",\n  "condition": "Zustandsbeschreibung",\n  "keywords": ["keyword1", "keyword2"],\n  "tips": ["Verkaufstipp 1", "Verkaufstipp 2"],\n  "category": "Produktkategorie"\n}' + notesText }] }]
    })
  });
  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';
  let analysis;
  try { analysis = JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch(e) { analysis = { title_short: 'Analyse fehlgeschlagen', error: e.message }; }
  return analysis;
}

// Marktvergleich separat – wird NACH dem Speichern der Analyse aufgerufen
async function vkRunMarketSearch(articleId, title, phone) {
  try {
    const market = await vkMarketSearch(title, phone || '');
    const { data: current } = await supabase.from('vk_articles').select('analysis').eq('id', articleId).single();
    if (current && current.analysis) {
      const updated = Object.assign({}, current.analysis, { market_comparison: market });
      await supabase.from('vk_articles').update({ analysis: updated }).eq('id', articleId);
      console.log('Market search saved for article', articleId, '- found:', market.found);
    }
  } catch(e) {
    console.error('vkRunMarketSearch error:', e.message);
  }
}

// ── VK ENDPOINTS ───────────────────────────────────────────

app.post('/api/vk/session', async (req, res) => {
  try {
    const { phone, media_id, customer_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone erforderlich' });
    const token = vkToken();
    const { data: session, error: sErr } = await supabase.from('vk_sessions').insert({ phone, token, customer_name: customer_name || null, status: 'open' }).select().single();
    if (sErr) return res.status(400).json({ error: sErr.message });
    const { data: article, error: aErr } = await supabase.from('vk_articles').insert({ session_id: session.id, title: 'Artikel ' + (Date.now() % 1000), extended: false }).select().single();
    if (aErr) return res.status(400).json({ error: aErr.message });
    let photoUrl = null;
    if (media_id) { try { const saved = await vkSaveWhatsAppImage(media_id, session.id, article.id, 1); await supabase.from('vk_photos').insert({ article_id: article.id, session_id: session.id, storage_path: saved.path, public_url: saved.url, source: 'whatsapp', sort_order: 1 }); photoUrl = saved.url; } catch(e) { console.error('Photo save error:', e.message); } }
    const link = `https://converdino.com/bericht.html?s=${session.token}`;
    res.json({ success: true, session, article, link, photo_url: photoUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/sessions/phone/:phone', async (req, res) => { try { const phone = decodeURIComponent(req.params.phone); const { data, error } = await supabase.from('vk_sessions').select('*, vk_articles(id, title, status, vk_photos(id, public_url))').eq('phone', phone).neq('status', 'deleted').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/vk/session/:token', async (req, res) => {
  try {
    const { data: session, error } = await supabase.from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (error || !session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id).order('sort_order', { ascending: true });
    const enriched = (articles || []).map(a => ({ ...a, photo_count: (a.vk_photos || []).length }));
    const price = vkCalcPrice(enriched);
    res.json({ ...session, articles: enriched, price });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/article', async (req, res) => { try { const { token, title } = req.body; const { data: session } = await supabase.from('vk_sessions').select('id').eq('token', token).single(); if (!session) return res.status(404).json({ error: 'Session nicht gefunden' }); const { data: count } = await supabase.from('vk_articles').select('id', { count: 'exact' }).eq('session_id', session.id); if ((count?.length || 0) >= 20) return res.status(400).json({ error: 'Maximal 20 Artikel' }); const { data, error } = await supabase.from('vk_articles').insert({ session_id: session.id, title: title || 'Neuer Artikel', sort_order: (count?.length || 0) + 1, extended: false }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, article: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/vk/article/:id/notes', async (req, res) => {
  try {
    const { notes, title, lp_booked, lp_days, lp_has_bot } = req.body;
    const updates = {};
    if (notes !== undefined) updates.notes = notes || null;
    if (title !== undefined && title.trim()) updates.title = title.trim();
    if (lp_booked !== undefined) updates.lp_booked = !!lp_booked;
    if (lp_days !== undefined) updates.lp_days = parseInt(lp_days) || 7;
    if (lp_has_bot !== undefined) updates.lp_has_bot = !!lp_has_bot;
    const { data, error } = await supabase.from('vk_articles').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, article: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/vk/article/:id', async (req, res) => { try { const { error } = await supabase.from('vk_articles').delete().eq('id', req.params.id); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/vk/photo', async (req, res) => {
  try {
    const { article_id, session_id, image_base64, content_type } = req.body;
    if (!article_id || !image_base64) return res.status(400).json({ error: 'article_id und image_base64 erforderlich' });
    const { data: existing } = await supabase.from('vk_photos').select('id').eq('article_id', article_id);
    if ((existing?.length || 0) >= 4) return res.status(400).json({ error: 'Maximal 4 Fotos pro Artikel' });
    const ext = (content_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const path = `${session_id}/${article_id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(image_base64, 'base64');
    const { error: upErr } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType: content_type || 'image/jpeg', upsert: false });
    if (upErr) return res.status(400).json({ error: upErr.message });
    const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
    const { data, error } = await supabase.from('vk_photos').insert({ article_id, session_id, storage_path: path, public_url: urlData.publicUrl, source: 'upload', sort_order: (existing?.length || 0) + 1 }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, photo: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vk/photo/:id', async (req, res) => { try { const { data: photo } = await supabase.from('vk_photos').select('storage_path').eq('id', req.params.id).single(); if (photo?.storage_path) await supabase.storage.from('vk-photos').remove([photo.storage_path]); await supabase.from('vk_photos').delete().eq('id', req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/vk/article/:id/extended', async (req, res) => { try { const { extended } = req.body; const { data, error } = await supabase.from('vk_articles').update({ extended: !!extended }).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, article: data }); } catch(e) { res.status(500).json({ error: e.message }); } });

app.post('/api/vk/checkout', async (req, res) => {
  try {
    const { token } = req.body;
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(id)').eq('session_id', session.id);
    const enriched = (articles || []).map(a => ({ ...a, photo_count: (a.vk_photos || []).length }));
    if (!enriched.length) return res.status(400).json({ error: 'Keine Artikel vorhanden' });
    const price = vkCalcPrice(enriched);
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const couponCode = req.body.coupon_code;
    let finalPrice = price;
    let discountLabel = null;

    // Business-Rabatt prüfen (hat Vorrang vor Gutschein)
    if (session.business_discount_pct && session.business_discount_pct > 0) {
      const pct = session.business_discount_pct;
      const disc = Math.round(price * pct / 100 * 100) / 100;
      finalPrice = pct >= 100 ? 0 : Math.max(0.50, price - disc);
      discountLabel = pct + '% Firmenrabatt';
      // Nutzungszähler erhöhen
      if (session.business_discount_id) {
        await supabase.from('vk_business_discounts')
          .update({ used_count: supabase.rpc ? undefined : undefined })
          .eq('id', session.business_discount_id);
        // Einfacher Counter-Update
        const { data: bd } = await supabase.from('vk_business_discounts').select('used_count').eq('id', session.business_discount_id).single();
        if (bd) await supabase.from('vk_business_discounts').update({ used_count: (bd.used_count||0) + 1 }).eq('id', session.business_discount_id);
      }
      console.log('Business discount applied at checkout:', pct + '%', 'price:', price, '->', finalPrice);
    } else if (couponCode) {
      const { data: coupon } = await supabase.from('vk_coupons').select('*').eq('code', couponCode.toUpperCase()).single();
      if (coupon && coupon.active) {
        const { discount: couponDisc } = vkCalcDiscount(coupon, price);
        finalPrice = Math.max(0.50, price - couponDisc);
        discountLabel = 'Gutschein ' + couponCode;
        await supabase.from('vk_coupons').update({ used_count: (coupon.used_count||0) + 1 }).eq('id', coupon.id);
      }
    }
    const checkout = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], line_items: [{ price_data: { currency: 'eur', product_data: { name: 'Verkaufsreport – ' + enriched.length + ' Artikel', description: enriched.map(a => a.title).join(', ') }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }], metadata: { vk_token: token, vk_session_id: session.id }, success_url: `https://converdino.com/bericht.html?s=${token}&paid=1`, cancel_url: `https://converdino.com/bericht.html?s=${token}` });
    await supabase.from('vk_sessions').update({ stripe_session_id: checkout.id, total_price: finalPrice, coupon_code: couponCode || null }).eq('id', session.id);
    res.json({ success: true, url: checkout.url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_VK_SECRET || process.env.STRIPE_WEBHOOK_SECRET); } catch(e) { return res.status(400).send('Webhook Error: ' + e.message); }
    if (event.type === 'checkout.session.completed') {
      const stripeSession = event.data.object, vkToken = stripeSession.metadata?.vk_token;
      if (!vkToken) return res.json({ received: true });
      const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', vkToken).single();
      if (!session) return res.json({ received: true });
      const now = new Date();
      await supabase.from('vk_sessions').update({ status: 'analyzing', paid_at: now.toISOString(), stripe_session_id: stripeSession.id, total_price: stripeSession.amount_total / 100 }).eq('id', session.id);
      (async () => {
        try {
          const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
          for (const article of (articles || [])) { const photos = article.vk_photos || []; if (!photos.length) continue; const analysis = await vkAnalyzeArticle(article, photos, session ? session.phone : (phone || '')); const newTitle = analysis.title_short || null;
          const articleUpdate = { analysis, status: 'analyzed' };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id); if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : (phone || '')).catch(function(e){console.error('Market bg:',e.message);}); } }
          const anyExtended = (articles || []).some(a => a.extended), days = anyExtended ? 7 : 3;
          await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString(), delete_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() }).eq('id', session.id);
          const link = `https://converdino.com/ergebnis.html?s=${vkToken}`;
          const allLink = `https://converdino.com/auftraege.html?p=${encodeURIComponent(session.phone)}`;
          await vkSendWhatsApp(session.phone, `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\n${link}\n\n📂 Alle Auftraege:\n${allLink}\n\n🗑️ Wird in ${days} Tagen geloescht.`);
        } catch(e) { console.error('VK analysis error:', e.message); await supabase.from('vk_sessions').update({ status: 'error' }).eq('token', vkToken); }
      })();
    }
    res.json({ received: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/results/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (!['done', 'analyzing'].includes(session.status)) return res.status(400).json({ error: 'Analyse noch nicht abgeschlossen', status: session.status });
    const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id).order('sort_order', { ascending: true });
    if (!session.result_viewed_at) await supabase.from('vk_sessions').update({ result_viewed_at: new Date().toISOString() }).eq('id', session.id);
    res.json({ ...session, articles: articles || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/admin/sessions', async (req, res) => { try { const { data, error } = await supabase.from('vk_sessions').select('*, vk_articles(id, status, extended)').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });

app.get('/api/vk/admin/stats', async (req, res) => {
  try {
    const { data: sessions } = await supabase.from('vk_sessions').select('*');
    const all = sessions || [];
    const now = new Date();
    const h24  = new Date(now.getTime() - 24  * 60 * 60 * 1000);
    const d30  = new Date(now.getTime() - 30  * 24 * 60 * 60 * 1000);
    const d365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Derzeit gültige Aufträge: delete_at in der Zukunft ODER kein delete_at, und nicht gelöscht
    const valid = all.filter(s => s.status !== 'deleted' && s.status !== 'expired' &&
      (!s.delete_at || new Date(s.delete_at) > now)).length;

    res.json({
      total:           all.length,
      valid:           valid,
      last_24h:        all.filter(s => new Date(s.created_at) >= h24).length,
      revenue_24h:     all.filter(s => s.paid_at && new Date(s.paid_at) >= h24 ).reduce((t,s) => t+(parseFloat(s.total_price)||0),0),
      revenue_30d:     all.filter(s => s.paid_at && new Date(s.paid_at) >= d30 ).reduce((t,s) => t+(parseFloat(s.total_price)||0),0),
      revenue_365d:    all.filter(s => s.paid_at && new Date(s.paid_at) >= d365).reduce((t,s) => t+(parseFloat(s.total_price)||0),0),
      by_status: {
        open:      all.filter(s => s.status === 'open').length,
        analyzing: all.filter(s => s.status === 'analyzing').length,
        done:      all.filter(s => s.status === 'done').length,
        expired:   all.filter(s => s.status === 'expired').length,
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/admin/analyze/:sessionId', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('id', req.params.sessionId).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    await supabase.from('vk_sessions').update({ status: 'analyzing' }).eq('id', session.id);
    res.json({ success: true, message: 'Analyse gestartet' });
    (async () => {
      const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
      for (const article of (articles || [])) { const photos = article.vk_photos || []; if (!photos.length) continue; const analysis = await vkAnalyzeArticle(article, photos, session ? session.phone : (phone || '')); const newTitle = analysis.title_short || null;
          const articleUpdate = { analysis, status: 'analyzed' };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id); if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : (phone || '')).catch(function(e){console.error('Market bg:',e.message);}); } }
      const anyExtended = (articles || []).some(a => a.extended), days = anyExtended ? 7 : 3;
      await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString(), delete_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() }).eq('id', session.id);
      const link = `https://converdino.com/ergebnis.html?s=${session.token}`;
      await vkSendWhatsApp(session.phone, `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\n${link}\n\nWird in ${days} Tagen gelöscht.`);
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vk/admin/session/:id', async (req, res) => { try { const { data: photos } = await supabase.from('vk_photos').select('storage_path').eq('session_id', req.params.id); if (photos?.length) await supabase.storage.from('vk-photos').remove(photos.map(p => p.storage_path)); await supabase.from('vk_sessions').delete().eq('id', req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/vk/admin/session/:id/extend', async (req, res) => { try { const { days } = req.body; const newDeleteAt = new Date(Date.now() + (days || 7) * 24 * 60 * 60 * 1000); const { data, error } = await supabase.from('vk_sessions').update({ delete_at: newDeleteAt.toISOString() }).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, session: data }); } catch(e) { res.status(500).json({ error: e.message }); } });

setInterval(async () => {
  try {
    const now = new Date().toISOString();
    const { data: expired } = await supabase.from('vk_sessions').select('id').lte('delete_at', now).neq('status', 'deleted');
    for (const s of (expired || [])) {
      // Fotos aus Storage löschen
      const { data: photos } = await supabase.from('vk_photos').select('storage_path').eq('session_id', s.id);
      if (photos?.length) await supabase.storage.from('vk-photos').remove(photos.map(p => p.storage_path));
      // DB-Einträge löschen
      await supabase.from('vk_photos').delete().eq('session_id', s.id);
      await supabase.from('vk_articles').delete().eq('session_id', s.id);
      await supabase.from('vk_sessions').update({ status: 'deleted' }).eq('id', s.id);
      console.log('VK session auto-deleted:', s.id);
    }
  } catch(e) { console.error('VK cleanup error:', e.message); }
}, 60 * 60 * 1000);

async function vkSendWhatsApp(phone, message) {
  try {
    const { data: merchant } = await supabase.from('merchants').select('id, meta_phone_number_id, meta_access_token').eq('slug', 'sosuapesce').single();
    if (merchant) { const formattedPhone = phone.startsWith('+') ? phone : '+' + phone.replace(/[^0-9]/g,''); await sendWhatsApp(merchant.id, formattedPhone, message); }
    else {
      const fetch = require('node-fetch'), phoneId = process.env.META_PHONE_NUMBER_ID, token = process.env.META_ACCESS_TOKEN;
      const to = '+' + phone.replace(/[^0-9]/g, '');
      const r = await fetch('https://graph.facebook.com/v18.0/' + phoneId + '/messages', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: message } }) });
      console.log('vkSendWhatsApp fallback:', JSON.stringify(await r.json()));
    }
  } catch(e) { console.error('vkSendWhatsApp error:', e.message); }
}


// ── BUSINESS RABATT: Telefonnummer prüfen ─────────────────
async function vkGetBusinessDiscount(phone) {
  try {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const { data } = await supabase.from('vk_business_discounts')
      .select('*')
      .eq('active', true)
      .or('phone.eq.'+cleanPhone+',phone.eq.+'+cleanPhone)
      .single();
    if (!data) return null;
    if (data.valid_until && new Date(data.valid_until) < new Date()) return null;
    if (data.max_uses && data.used_count >= data.max_uses) return null;
    return data;
  } catch(e) { return null; }
}

// In-Memory Debounce Map: phone → { timer, sessionId, sessionToken, batchCount, merchantId }
const vkPendingWA = new Map();

async function vkHandleWhatsAppImage(phone, mediaId, merchantId) {
  try {
    let session, article, pending;

    if (vkPendingWA.has(phone)) {
      // ── Phone bereits im Map → Session aus Memory ──
      pending = vkPendingWA.get(phone);

      // Falls Session noch nicht fertig (parallel Request) → kurz warten
      let waited = 0;
      while (!pending.sessionId && waited < 3000) {
        await new Promise(r => setTimeout(r, 100));
        pending = vkPendingWA.get(phone) || pending;
        waited += 100;
      }

      // batchCount = nur neue Fotos in DIESEM Batch (nicht alte Artikel)
      pending.batchCount++;
      session = { id: pending.sessionId, token: pending.sessionToken };

      const { data: newArticle, error: aErr } = await supabase.from('vk_articles')
        .insert({ session_id: session.id, title: 'Artikel ' + (Date.now() % 1000), sort_order: pending.sessionArticleBase + pending.batchCount, extended: false })
        .select().single();
      if (aErr) throw new Error(aErr.message);
      article = newArticle;
      console.log('VK debounce: reuse session', session.token, 'batch count now', pending.batchCount);

    } else {
      // ── Erstes Foto – SOFORT Platzhalter setzen ──
      pending = { sessionId: null, sessionToken: null, batchCount: 1, sessionArticleBase: 0, merchantId, timer: null };
      vkPendingWA.set(phone, pending);

      // DB prüfen: offene Session < 2h
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: existingSession } = await supabase.from('vk_sessions')
        .select('*, vk_articles(id)')
        .eq('phone', phone).eq('status', 'open')
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();

      if (existingSession) {
        session = existingSession;
        const existingCount = (existingSession.vk_articles || []).length;
        pending.sessionArticleBase = existingCount; // vorhandene Artikel merken
        const { data: newArticle, error: aErr } = await supabase.from('vk_articles')
          .insert({ session_id: session.id, title: 'Artikel ' + (Date.now() % 1000), sort_order: existingCount + 1, extended: false })
          .select().single();
        if (aErr) throw new Error(aErr.message);
        article = newArticle;
        console.log('VK debounce: existing session from DB', session.token, 'base articles:', existingCount);
      } else {
        const token = vkToken();
        // Business-Rabatt prüfen
        const bizDiscount = await vkGetBusinessDiscount(phone);
        const sessionInsert = { phone, token, status: 'open' };
        if (bizDiscount) {
          sessionInsert.business_discount_id = bizDiscount.id;
          sessionInsert.business_discount_pct = bizDiscount.discount_percent;
          console.log('Business discount applied:', bizDiscount.discount_percent + '%', 'for', phone);
        }
        const { data: newSession, error: sErr } = await supabase.from('vk_sessions')
          .insert(sessionInsert).select().single();
        if (sErr) throw new Error(sErr.message);
        session = newSession;
        const { data: newArticle, error: aErr } = await supabase.from('vk_articles')
          .insert({ session_id: session.id, title: 'Artikel ' + (Date.now() % 1000) })
          .select().single();
        if (aErr) throw new Error(aErr.message);
        article = newArticle;
        console.log('VK debounce: new session created', session.token);
      }

      // Session-Daten setzen – wartende Requests können jetzt weitermachen
      pending.sessionId = session.id;
      pending.sessionToken = session.token;
      vkPendingWA.set(phone, pending);
    }

    // ── Foto speichern ──
    try {
      const saved = await vkSaveWhatsAppImage(mediaId, session.id, article.id, 1);
      await supabase.from('vk_photos').insert({
        article_id: article.id, session_id: session.id,
        storage_path: saved.path, public_url: saved.url,
        source: 'whatsapp', sort_order: pending.batchCount
      });
    } catch(e) { console.error('Photo save error:', e.message); }

    // ── Debounce Timer: clearTimeout HIER (direkt vor neuem Timer) ──
    const link = 'https://converdino.com/bericht.html?s=' + pending.sessionToken;
    const allLink = 'https://converdino.com/auftraege.html?p=' + encodeURIComponent(phone);

    clearTimeout(pending.timer); // immer alten Timer löschen bevor neuer gesetzt wird
    const timer = setTimeout(async () => {
      const final = vkPendingWA.get(phone);
      vkPendingWA.delete(phone);
      const batchCount = final ? final.batchCount : pending.batchCount;
      let msg;
      if (batchCount === 1) {
        msg = '✅ Foto erhalten! Hier ist dein Auftrag-Link:\n\n' + link +
              '\n\nDort kannst du:\n• Weitere Fotos hinzufügen\n• Neue Artikel anlegen\n• Deinen Bericht bestellen' +
              '\n\n📂 Alle Aufträge:\n' + allLink;
      } else {
        msg = '✅ ' + batchCount + ' Fotos erhalten! Dein Auftrag hat ' + batchCount + ' neue Artikel.\n\n' +
              '🔗 Hier zum Auftrag:\n' + link +
              '\n\nFotos prüfen, weitere hinzufügen oder Bericht bestellen.' +
              '\n\n📂 Alle Aufträge:\n' + allLink;
      }
      await sendWhatsApp(pending.merchantId, '+' + phone.replace(/[^0-9]/g,''), msg);
      console.log('VK debounce: WA sent for', phone, 'batch:', batchCount);
    }, 5000);

    pending.timer = timer;

  } catch(e) { console.error('VK WhatsApp handler error:', e.message); }
}

module.exports = { vkHandleWhatsAppImage };

// ═══════════════════════════════════════════════════════════
// GUTSCHEIN SYSTEM
// ═══════════════════════════════════════════════════════════

app.post('/api/vk/coupon/validate', async (req, res) => {
  try {
    const { code, token } = req.body;
    if (!code) return res.status(400).json({ error: 'Code fehlt' });
    const { data: coupon, error } = await supabase.from('vk_coupons').select('*').eq('code', code.toUpperCase().trim()).single();
    if (error || !coupon) return res.status(404).json({ error: 'Ungültiger Code' });
    if (!coupon.active) return res.status(400).json({ error: 'Code ist nicht mehr aktiv' });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.status(400).json({ error: 'Code ist abgelaufen' });
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses) return res.status(400).json({ error: 'Code wurde bereits zu oft verwendet' });
    let discount = 0, isFree = false;
    if (token) {
      const { data: session } = await supabase.from('vk_sessions').select('*, vk_articles(id, extended, vk_photos(id))').eq('token', token).single();
      if (session) { const articles = (session.vk_articles||[]).map(a => ({...a, photo_count: (a.vk_photos||[]).length})); const price = vkCalcPrice(articles); ({ discount, isFree } = vkCalcDiscount(coupon, price)); }
    }
    res.json({ success: true, coupon: { code: coupon.code, type: coupon.type, value: coupon.value, discount, is_free: isFree, description: coupon.description } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/coupon/redeem', async (req, res) => {
  try {
    const { code, token } = req.body;
    const { data: coupon } = await supabase.from('vk_coupons').select('*').eq('code', code.toUpperCase().trim()).single();
    if (!coupon) return res.status(404).json({ error: 'Ungültiger Code' });
    const { data: session } = await supabase.from('vk_sessions').select('*, vk_articles(id, extended, vk_photos(id))').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const articles = (session.vk_articles||[]).map(a => ({...a, photo_count: (a.vk_photos||[]).length}));
    const price = vkCalcPrice(articles);
    const { discount: disc, isFree: free } = vkCalcDiscount(coupon, price);
    const finalPrice = free ? 0 : Math.max(0, price - disc);
    await supabase.from('vk_coupons').update({ used_count: (coupon.used_count||0) + 1 }).eq('id', coupon.id);
    await supabase.from('vk_coupon_uses').insert({ coupon_id: coupon.id, session_id: session.id, discount: price - finalPrice });
    if (finalPrice === 0) {
      await supabase.from('vk_sessions').update({ status: 'analyzing', paid_at: new Date().toISOString(), total_price: 0, coupon_code: code.toUpperCase() }).eq('id', session.id);
      (async () => {
        try {
          const { data: arts } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
          for (const article of (arts||[])) { if (!(article.vk_photos||[]).length) continue; const analysis = await vkAnalyzeArticle(article, article.vk_photos, session ? session.phone : ''); const newTitle = analysis.title_short || null;
          const articleUpdate = { analysis, status: 'analyzed' };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id); if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : '').catch(function(e){console.error('Market bg:',e.message);}); } }
          const anyExtended = (arts||[]).some(a => a.extended), days = anyExtended ? 7 : 3;
          await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString(), delete_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() }).eq('id', session.id);
          await vkSendWhatsApp(session.phone, `✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\nhttps://converdino.com/ergebnis.html?s=${token}\n\nWird in ${days} Tagen gelöscht.`);
        } catch(e) { console.error('Coupon analysis error:', e.message); }
      })();
      return res.json({ success: true, is_free: true, redirect: `/bericht.html?s=${token}&paid=1` });
    }
    res.json({ success: true, is_free: false, final_price: finalPrice, discount: price - finalPrice });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/admin/coupons', async (req, res) => { try { const { data, error } = await supabase.from('vk_coupons').select('*').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/vk/admin/coupons', async (req, res) => { try { const { code, type, value, max_uses, expires_at, description } = req.body; const finalCode = (code || Math.random().toString(36).substring(2,8)).toUpperCase(); const { data, error } = await supabase.from('vk_coupons').insert({ code: finalCode, type: type || 'free', value: value || 100, max_uses: max_uses || null, expires_at: expires_at || null, description: description || null, active: true, used_count: 0 }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, coupon: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/vk/admin/coupons/:id', async (req, res) => { try { const { data, error } = await supabase.from('vk_coupons').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, coupon: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/vk/admin/coupons/:id', async (req, res) => { try { await supabase.from('vk_coupons').delete().eq('id', req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
