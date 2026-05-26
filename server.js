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
// ── KI MODEL CONFIG ──────────────────────────────────────────
const AI = {
  grouping:   'claude-haiku-4-5-20251001',
  extraction: 'claude-haiku-4-5-20251001',
  market:     'claude-haiku-4-5-20251001',
  analysis:   'claude-opus-4-6',
  dna:        'claude-opus-4-6',
  bot:        'claude-sonnet-4-6',
  correction: 'claude-sonnet-4-6'
};
app.use(cors({ origin: '*' }));
const path = require('path');
app.use(express.static(__dirname));

// No-cache für alle API-Endpoints (verhindert 304)
app.use('/api/', function(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.json({ limit: '50mb' }));
express.urlencoded({ extended: true, limit: '50mb' })



function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function sendWhatsApp(merchantId, to, message) {
  try {
    const phoneId = process.env.META_PHONE_NUMBER_ID;
    const token = process.env.META_ACCESS_TOKEN;
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
async function vkSendWhatsApp(phone, message) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  return sendWhatsApp(null, '+' + cleanPhone, message);
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
          // ── LP BOT: Prüfe ob Nachricht LP-Kontext hat ──────
          const rawText = msg.text?.body || '';
          const lpSlugMatch = rawText.match(/p\.converdino\.com\/p\/([\w-]+)/);
          if (lpSlugMatch && msgType === 'text') {
            try {
              await vkHandleLPBot(from, rawText, lpSlugMatch[1], phoneId);
              continue;
            } catch(lpErr) {
              console.error('LP Bot error:', lpErr.message);
            }
          }

          // Prüfe ob aktive LP Bot Konversation läuft
          if (msgType === 'text') {
            const hasActiveBot = await vkCheckActiveLPBot(from);
            if (hasActiveBot === 'recover') {
              // Wiedererweckung: Session neu starten mit gespeichertem LP
              const rec = vkLPBotRecovery.get(from);
              vkLPBotRecovery.delete(from);
              try {
                console.log('LP Bot RECOVERY for', from, 'slug:', rec.lpSlug);
                await vkHandleLPBot(from, rawText, rec.lpSlug, rec.phoneId || phoneId);
                continue;
              } catch(recErr) { console.error('LP Bot recovery error:', recErr.message); }
            } else if (hasActiveBot) {
              try {
                await vkHandleLPBotReply(from, rawText, phoneId);
                continue;
              } catch(lpErr) {
                console.error('LP Bot reply error:', lpErr.message);
              }
            }
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
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: media_type || 'application/pdf', data: base64 } }, { type: 'text', text: 'Extrahiere alle relevanten Informationen aus diesem Dokument für eine Firmen-Landingpage. Strukturiere die Ausgabe: Firmenname, Beschreibung, Leistungen, Zielgruppe, USP, Kontakt, Zahlen/Statistiken, Referenzen. Nur die extrahierten Infos, kein Kommentar.' }] }] }) });
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
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2000, messages: [{ role: 'user', content: `Analysiere diesen Website-Inhalt:\n${text}\n\nExtrahiere: Firmenname, Beschreibung, Leistungen, Zielgruppe, USP, Kontakt.` }] }) });
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
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, system: systemPrompt, messages: [{ role: 'user', content: msgContent }] }) });
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
         
          // Authentizitäts-basierte Compliance
const AUTH_CATS = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
const comp = analysis.compliance || {};
const auth = analysis.authenticity || {};
const authScore = (auth && auth.score !== null && auth.score !== undefined) ? auth.score : null;
const needsAuthReview = authScore !== null && authScore < 60 && AUTH_CATS.includes(analysis.article_category || '');
 
const articleUpdate = {
  analysis,
  status: 'analyzed',
  article_category: analysis.article_category || 'standard',
  compliance_status: comp.blocked ? 'blocked'
    : (comp.category <= 2 || needsAuthReview) ? 'needs_review' : 'approved',
  compliance_category: comp.category || 3,
  compliance_flags: comp.flags || [],
  compliance_blocked_reason: comp.reason || null,
  authenticity_score: authScore,
  authenticity_verdict: auth.verdict || null,
  authenticity_flags: auth.flags || [],
  authenticity_warning: auth.warning || null
};
if (analysis.title_short) articleUpdate.title = analysis.title_short;
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id);

          // Compliance Log
         if (comp.blocked || comp.category <= 2 || needsAuthReview) {
            await supabase.from('vk_compliance_log').insert({
              article_id: article.id,
              action: comp.blocked ? 'auto_blocked' : 'needs_review',
              reason: comp.reason || (comp.category === 2 ? 'Kategorie 2 - manuelle Prüfung erforderlich' : null)
            });
          }
            if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : '').catch(function(e){console.error('Market bg:',e.message);}); }
          // Docs automatisch analysieren nach Artikel-Analyse (sequential)
          (async function autoAnalyzeDocs() {
            try {
              const fetch2 = require('node-fetch');
              const { data: artDocs } = await supabase.from('vk_article_docs').select('*').eq('article_id', article.id);
              if (!artDocs || !artDocs.length) return;
              console.log('Auto-doc: analyzing', artDocs.length, 'docs for article', article.id);
              for (const doc of artDocs) {
                if (!doc.public_url) continue;
                try {
                  const docRes = await fetch2(doc.public_url);
                  const docBuf = Buffer.from(await docRes.arrayBuffer());
                  const base64 = docBuf.toString('base64');
                  const ct = doc.content_type || 'application/pdf';
                  const blocks = [
                    { type: 'document', source: { type: 'base64', media_type: ct, data: base64 } },
                    { type: 'text', text: 'Extrahiere ALLE technischen Fakten aus dem Dokument als JSON (kein Markdown):\n{"extracted_facts":{"q_model":"Modell/Typ oder null","q_year":"Baujahr oder null","q_hours":"Betriebsstunden oder null","q_km":"KM-Stand oder null","q_condition":"Zustand oder null","q_serial":"Seriennummer oder null"},"extra_facts":[{"key":"Bezeichnung","value":"Wert"}]}\nPFLICHT: Jeden Wert aus dem Dokument als extra_facts Eintrag erfassen.' }
                  ];
                  const er = await fetch2('https://api.anthropic.com/v1/messages', {
                    method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: AI.extraction, max_tokens: 1500, messages: [{ role: 'user', content: blocks }] })
                  });
                  const ed = await er.json();
                  const et = (ed.content?.[0]?.text || '{}').replace(/```json|```/g,'').trim();
                  const parsed = JSON.parse(et.substring(et.indexOf('{'), et.lastIndexOf('}')+1));
                  const { data: artNow } = await supabase.from('vk_articles').select('answers').eq('id', article.id).single();
                  const ans = Object.assign({}, artNow?.answers || {});
                  Object.entries(parsed.extracted_facts || {}).forEach(function([k,v]){ if(v && v!=='null') ans[k]=String(v); });
                  const extras = (parsed.extra_facts || []).filter(function(e){ return e.key && e.value; });
                  if (extras.length) {
                    const existing = ans['q_extra'] ? ans['q_extra'].split('|||') : [];
                    ans['q_extra'] = [...existing, ...extras.map(function(e){ return e.key+': '+e.value; })].join('|||');
                  }
                  await supabase.from('vk_articles').update({ answers: ans }).eq('id', article.id);
                  console.log('Auto-doc: extracted', extras.length, 'facts from', doc.label);
                } catch(de) { console.error('Auto-doc error:', doc.label, de.message); }
              }
            } catch(e) { console.error('autoAnalyzeDocs error:', e.message); }
          })();
          }
          const anyExtended = (articles || []).some(a => a.extended);
          const days = anyExtended ? 7 : 3;
          // Haiku Doc-Analyse BEVOR 'done' gesetzt wird
      try {
        for (const article of (articles || [])) {
          const { data: artDocs2 } = await supabase.from('vk_article_docs').select('*').eq('article_id', article.id);
          if (!artDocs2 || !artDocs2.length) continue;
          const { data: artNow2 } = await supabase.from('vk_articles').select('answers').eq('id', article.id).single();
          const ans2 = Object.assign({}, artNow2?.answers || {});
          const allExtras = ans2.q_extra ? ans2.q_extra.split('|||') : [];
          for (const doc of artDocs2) {
            if (!doc.public_url) continue;
            try {
              const docRes2 = await fetch(doc.public_url);
              const docBuf2 = Buffer.from(await docRes2.arrayBuffer());
              const haikusRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: AI.grouping,
                  max_tokens: 2000,
                  system: 'Extrahiere ALLE Fakten aus dem Dokument. Antworte NUR mit JSON Array: [{"k":"Bezeichnung","v":"Wert"}]. Kein Markdown.',
                  messages: [{ role: 'user', content: [
                    { type: 'document', source: { type: 'base64', media_type: doc.content_type || 'application/pdf', data: docBuf2.toString('base64') } },
                    { type: 'text', text: 'Liste ALLE Fakten als JSON Array [{k,v}]. Jeden Wert einzeln erfassen.' }
                  ]}]
                })
              });
              const hd = await haikusRes.json();
              const ht = (hd.content?.[0]?.text || '[]').replace(/```json|```/g,'').trim();
              const si = ht.indexOf('['), ei = ht.lastIndexOf(']');
              if (si >= 0 && ei > si) {
                JSON.parse(ht.substring(si, ei+1)).filter(p => p.k && p.v).forEach(p => allExtras.push(p.k+': '+p.v));
              }
            } catch(de2) { console.error('Doc haiku error:', de2.message); }
          }
          if (allExtras.length > 0) {
            ans2.q_extra = allExtras.join('|||');
            await supabase.from('vk_articles').update({ answers: ans2 }).eq('id', article.id);
          }
        }
      } catch(docErr2) { console.error('Doc block error:', docErr2.message); }

      await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString(), delete_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString() }).eq('id', session.id);
          const link = `https://converdino.com/ergebnis.html?s=${token}`;
          const allLink = `https://converdino.com/auftraege.html?p=${encodeURIComponent(session.phone)}`;
          await vkSendWhatsApp(session.phone, `Dein Verkaufsreport ist fertig!\n\nErgebnis:\n${link}\n\nAlle Auftraege:\n${allLink}\n\nWird in ${days} Tagen geloescht.`);
          console.log('check-payment: analysis done for', token);
        } catch(e) {
          console.error('check-payment analysis error:', e.message);
          // Retry once after 10 seconds
          setTimeout(async function() {
            try {
              console.log('Retrying analysis for token:', token);
              const { data: arts2 } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
              for (const art2 of (arts2||[])) {
                if (art2.status !== 'analyzed' && (art2.vk_photos||[]).length > 0) {
                  const analysis2 = await vkAnalyzeArticle(art2, art2.vk_photos, session.phone);
                  await supabase.from('vk_articles').update({ analysis: analysis2, status: 'analyzed', title: analysis2.title_short||art2.title }).eq('id', art2.id);
                }
              }
              await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString() }).eq('id', session.id);
              console.log('Retry analysis success for token:', token);
            } catch(e2) {
              console.error('Retry also failed:', e2.message);
              await supabase.from('vk_sessions').update({ status: 'error' }).eq('token', token);
            }
          }, 10000);
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


// ── PDF EXPORT: print-optimiertes HTML ────────────────────────
app.get('/api/vk/pdf/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).send('Session nicht gefunden');

    const { data: articles } = await supabase.from('vk_articles')
      .select('*, vk_photos(*), vk_landingpages(id, slug, bot_config, has_bot, status, bot_goal, anrede), answers, questions').eq('session_id', session.id).order('sort_order', { ascending: true });

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
      // Spezifische Produktdaten (Wissensdatenbank)
      const answers = a.answers || {};
      const questions = a.questions || [];
      const hasAnswers = Object.values(answers).some(v => v && v !== '');
      const extraFacts = [];
      if (answers.q_extra) {
        const sep = answers.q_extra.indexOf('|||') >= 0 ? '|||' : ',';
        answers.q_extra.split(sep).forEach(function(p) {
          const s = p.indexOf(':');
          if (s > 0) extraFacts.push({k: p.slice(0,s).trim(), v: p.slice(s+1).trim()});
        });
      }
      if (hasAnswers || extraFacts.length) {
        body += '<h3 style="color:#1b4332;font-size:13px;margin:16px 0 8px;border-left:3px solid #25D366;padding-left:8px;">Spezifische Produktdaten</h3>';
        body += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
        // Standard-Felder
        const fieldLabels = {q_model:'Modell/Typ',q_year:'Baujahr',q_km:'Kilometerstand',q_hours:'Betriebsstunden',q_condition:'Zustand',q_serial:'Seriennummer',q_service:'Serviceheft',q_tuev:'TÜV bis',q_owners:'Vorbesitzer',q_accident:'Unfallschäden',q_last_service:'Letzte Wartung'};
        Object.entries(fieldLabels).forEach(function([k,label]) {
          if (answers[k] && answers[k] !== 'null') {
            body += '<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:5px 8px;color:#6b7280;width:40%;">'+label+'</td><td style="padding:5px 8px;font-weight:600;">'+esc(answers[k])+'</td></tr>';
          }
        });
        // Extra-Fakten aus PDF
        extraFacts.forEach(function(f) {
          body += '<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:5px 8px;color:#6b7280;">'+esc(f.k)+'</td><td style="padding:5px 8px;font-weight:600;">'+esc(f.v)+'</td></tr>';
        });
        body += '</table>';
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
      upload_mode: req.body.upload_mode || 'standard',
      active: true, used_count: 0
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, discount: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/business-discounts/:id', async (req, res) => {
  try {
    // Nur erlaubte Felder updaten
    const allowed = ['company_name','phone','discount_percent','valid_until','max_uses','notes',
      'sales_commission_percent','landingpage_enabled','wise_email','seller_email',
      'seller_address','seller_zip','seller_city','seller_uid','upload_mode','active',
      'escalation_title','escalation_availability'];
    const updates = {};
    allowed.forEach(function(k){ if(req.body[k] !== undefined) updates[k] = req.body[k]; });
    const { data, error } = await supabase.from('vk_business_discounts')
      .update(updates).eq('id', req.params.id).select().single();
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

    // Analyse im Hintergrund - sofort 'analyzing' zurück
    res.json({ success: true, status: 'analyzing' });

    (async () => {
      try {
        const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
        for (const article of (articles || [])) {
          if (!(article.vk_photos || []).length) continue;
          const analysis = await vkAnalyzeArticle(article, article.vk_photos, session ? session.phone : '');
          const newTitle = analysis.title_short || null;
          const comp = analysis.compliance || {};
          const auth = analysis.authenticity || {};
          const articleUpdate = {
            analysis,
            status: 'analyzed',
            article_category: analysis.article_category || 'standard',
            compliance_status: comp.blocked ? 'blocked' : (comp.category <= 2 ? 'needs_review' : 'approved'),
            compliance_category: comp.category || 3,
            compliance_flags: comp.flags || [],
            compliance_blocked_reason: comp.reason || null,
            authenticity_score: auth.score || null,
            authenticity_verdict: auth.verdict || null,
            authenticity_flags: auth.flags || [],
            authenticity_warning: auth.warning || null
          };
          if (newTitle) articleUpdate.title = newTitle;
          await supabase.from('vk_articles').update(articleUpdate).eq('id', article.id);

          // Compliance Log
          if (comp.blocked || comp.category <= 2) {
            await supabase.from('vk_compliance_log').insert({
              article_id: article.id,
              action: comp.blocked ? 'auto_blocked' : 'needs_review',
              reason: comp.reason || (comp.category === 2 ? 'Kategorie 2 - manuelle Prüfung erforderlich' : null)
            });
          }
          if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') { vkRunMarketSearch(article.id, analysis.title_short, session ? session.phone : '').catch(function(e){console.error('Market bg:',e.message);}); }
        }
        const anyExtended = (articles || []).some(a => a.extended);
        const days = anyExtended ? 7 : 3;
        await supabase.from('vk_sessions').update({
          status: 'done',
          analyzed_at: new Date().toISOString(),
          delete_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
        }).eq('id', session.id);
        const link = 'https://converdino.com/ergebnis.html?s=' + token;
        await vkSendWhatsApp(session.phone, '✅ Dein Verkaufsreport ist fertig!\n\n📋 Ergebnis:\n' + link + '\n\n🗑️ Wird in ' + days + ' Tagen gelöscht.');
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
function vkBuildAnswerFakten(answers, questions) {
  if (!answers) return '';
  const skip = ['q_sonstige', 'q_extra'];
  const rows = [];
  const icons = {
    'Baujahr': '📅', 'Baujahr / Erstzulassung': '📅',
    'Kilometerstand': '🔢', 'Betriebsstunden': '⏱',
    'Serviceheft': '📋', 'Wartungsbuch': '📋',
    'Letzte Wartung': '🔧', 'Wann war die letzte Wartung': '🔧',
    'Vorbesitzer': '👤', 'Anzahl Vorbesitzer': '👤',
    'Unfallschaden': '💥', 'Unfallschäden': '💥',
    'Motor': '⚙️', 'Motor- und Getriebeuntersuchung': '⚙️',
    'Antrieb': '🚗', 'Hubhöhe': '📐', 'Tragkraft': '🏋',
    'Maximale Hubhöhe': '📐', 'Antriebsart': '⚡',
    'TÜV': '✅', 'Hauptuntersuchung': '✅'
  };
  const yesNo = { 'ja': '✅ Ja', 'nein': '❌ Nein', 'weiß nicht': '—' };
  questions.filter(function(q){ return !skip.includes(q.id); }).forEach(function(q) {
    var val = answers[q.id];
    if (!val || val === '') return;
    var displayVal = yesNo[val.toLowerCase()] || val;
    var icon = '•';
    Object.keys(icons).forEach(function(k){ if (q.label && q.label.toLowerCase().includes(k.toLowerCase())) icon = icons[k]; });
    rows.push('<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0fdf4;">'
      + '<span style="font-size:1rem;width:22px;text-align:center;flex-shrink:0;">' + icon + '</span>'
      + '<span style="font-size:.82rem;color:#6b7280;flex:1;">' + (q.label||q.id) + '</span>'
      + '<span style="font-size:.85rem;font-weight:700;color:#1b4332;">' + displayVal + '</span>'
      + '</div>');
  });
  // Extra KV Paare
  if (answers['q_extra']) {
    answers['q_extra'].replace(/\|\|\|/g,',').split(',').forEach(function(kv){
      var parts = kv.split(':');
      if (parts.length >= 2) {
        rows.push('<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0fdf4;">'
          + '<span style="font-size:1rem;width:22px;text-align:center;flex-shrink:0;">•</span>'
          + '<span style="font-size:.82rem;color:#6b7280;flex:1;">' + parts[0].trim() + '</span>'
          + '<span style="font-size:.85rem;font-weight:700;color:#1b4332;">' + parts.slice(1).join(':').trim() + '</span>'
          + '</div>');
      }
    });
  }
  if (!rows.length) return '';
  return '<div class="section-card" style="background:#f0fdf4;border:1.5px solid #86efac;padding:0;">'
    + '<div onclick="this.parentElement.classList.toggle(\'open\')" style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:14px 16px;user-select:none;">'
    + '<span style="color:#15803d;font-weight:700;font-size:.85rem;">✅ Angaben — vom Verkäufer bestätigt</span>'
    + '<span class="facts-chevron" style="font-size:.9rem;color:#15803d;transition:transform .25s;">▼</span>'
    + '</div>'
    + '<div class="facts-body" style="display:none;padding:0 16px 14px;">'
    + '<div>' + rows.join('') + '</div>'
    + '</div>'
    + '</div>'
    + '<style>.section-card.open .facts-body{display:block!important}.section-card.open .facts-chevron{transform:rotate(180deg)}</style>';
}

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
const badgeHTML = (lp.show_score_badge && an && an.authenticity && an.authenticity.score !== null) ? '<div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px 20px;margin-bottom:16px;"><div style="display:flex;align-items:center;gap:12px;"><div style="font-size:1.5rem;">🔍</div><div><strong style="color:#15803d;">Authentizitätsprüfung: ' + an.authenticity.score + '/100</strong><br><span style="font-size:.8rem;color:#4b5563;">' + (an.authenticity.verdict==='authentic'?'✅ Keine Fälschungsmerkmale erkannt':'⚠️ Merkmale überprüft') + '</span></div></div></div>' : '';
  // Highlights
  const bulletHTML = (an.bullet_points||[]).slice(0,6).map(b =>
    '<li class="highlight-item"><span class="highlight-dot">✓</span><span>' + esc(b) + '</span></li>'
  ).join('');

  // Keywords
  const keywordHTML = (an.keywords||[]).slice(0,8).map(k =>
    '<span class="tag">' + esc(k) + '</span>'
  ).join('');

  // Fakten aus Fragebogen-Antworten
  const faktenHTML = vkBuildAnswerFakten(article.answers || {}, article.questions || []);

  // Condition badge
  const conditionColor = { 'Neu': '#059669', 'Neuwertig': '#059669', 'Sehr gut': '#2d7a4f', 'Gut': '#d97706', 'Gebraucht': '#9ca3af' };
  const condClass = an.condition ? (Object.keys(conditionColor).find(k => (an.condition||'').includes(k)) || '') : '';
  const condColor = conditionColor[condClass] || '#6b7280';

  // Active until
  let expiryNote = '';
  if (lp.active_until) {
    const days = Math.ceil((new Date(lp.active_until) - new Date()) / (1000*60*60*24));
   if (days > 0) {
    var d=new Date(lp.active_until);
    expiryNote = '<div class="expiry-note">⏳ Angebot gültig bis ' + d.getDate() + '.' + (d.getMonth()+1) + '.' + d.getFullYear() + '</div>';
  }
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
.gallery-wrap{position:relative;background:##1b4332;max-height:420px;overflow:hidden;}
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
    ${lp.badge_type && lp.badge_type !== 'none' ? `
    <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:700;margin-bottom:8px;background:${lp.badge_type === 'admin_verified' ? '#f5f3ff' : lp.badge_type === 'seller_confirmed' ? '#f0fdf4' : '#eff6ff'};color:${lp.badge_type === 'admin_verified' ? '#6d28d9' : lp.badge_type === 'seller_confirmed' ? '#15803d' : '#1d4ed8'};">
      ${lp.badge_type === 'admin_verified' ? '🏆 Vom Converdino Team geprüft' : lp.badge_type === 'seller_confirmed' ? '✅ Vom Verkäufer bestätigt' : '🔍 KI-geprüft'}
    </div>` : ''}
    <div class="price-main">${priceStr}</div>
    

    ${expiryNote}
    ${(function(){
      const goals = (lp.bot_goal || 'direktkauf').split(',').map(function(g){return g.trim();});
      const goal = goals[0];
      const artTitle = esc(an.title_short || article.title || 'Produkt');
      const baseUrl = 'https://p.converdino.com/p/' + lp.slug;
      const waNum = '4367764118066';

      function waBtn(emoji, label, msg, primary) {
        const url = 'https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg);
        const style = primary
          ? 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:15px;background:#25D366;border-radius:12px;font-size:.95rem;font-weight:800;color:#fff;text-decoration:none;margin-top:10px;'
          : 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:13px;background:#fff;border:2px solid #25D366;border-radius:12px;font-size:.88rem;font-weight:700;color:#25D366;text-decoration:none;margin-top:8px;';
        return '<a href="' + url + '" target="_blank" style="' + style + '">' + emoji + ' ' + label + '</a>';
      }

      // Alle gewählten Goals als Buttons
      var btns = '';
      var first = true;
      goals.forEach(function(g) {
        if (g === 'direktkauf') {
          if (first) btns += '<a class="cta-btn" href="/p/' + lp.slug + '/buy" id="cta-btn" style="margin-top:10px;">🛒 Jetzt kaufen – EUR ' + price + '</a><div style="text-align:center;margin-top:6px;font-size:.75rem;color:#9ca3af;">Sichere Zahlung via Stripe</div>';
          else btns += waBtn('🛒', 'Jetzt kaufen – EUR ' + price, 'Hallo! Ich möchte "' + artTitle + '" kaufen. ' + baseUrl, false);
        } else if (g === 'besichtigung') {
          btns += waBtn('📍', 'Besichtigung vereinbaren', 'Hallo! Ich möchte "' + artTitle + '" besichtigen und einen Termin vereinbaren. ' + baseUrl, first);
        } else if (g === 'kontakt') {
          btns += waBtn('📞', 'Rückruf anfordern', 'Hallo! Ich bitte um Rückruf zu "' + artTitle + '". ' + baseUrl, first);
        } else if (g === 'angebot') {
          btns += waBtn('📋', 'Angebot / Inzahlungnahme', 'Hallo! Ich möchte ein Angebot für "' + artTitle + '" anfragen. ' + baseUrl, first);
        } else if (g === 'leasing') {
          btns += waBtn('💶', 'Finanzierung anfragen', 'Hallo! Ich interessiere mich für Leasing/Finanzierung von "' + artTitle + '". ' + baseUrl, first);
        }
        first = false;
      });
      if (!goals.includes('direktkauf')) {
        btns += waBtn('💬', 'Mehr Informationen', 'Hallo! Ich interessiere mich für "' + artTitle + '" und habe Fragen. ' + baseUrl, false);
      }
      return btns || waBtn('💬', 'Anfragen', 'Hallo! Ich interessiere mich für "' + artTitle + '". ' + baseUrl, true);
    })()}
  </div>

  ${bulletHTML ? `
  <div class="section-card">
    <div class="section-heading">✨ Highlights</div>
    <ul class="highlight-list">${bulletHTML}</ul>
  </div>` : ''}

  ${faktenHTML}

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
   ${badgeHTML}
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
      .select('*, vk_articles(*, vk_photos(*), questions, answers), vk_sessions(phone)')
      .eq('slug', req.params.slug)
      .single();

    // Verkäufer-Stammdaten laden
    let sellerInfo = null;
    if (lp && lp.session_id) {
      const { data: sess } = await supabase.from('vk_sessions')
        .select('business_discount_id').eq('id', lp.session_id).maybeSingle();
      if (sess && sess.business_discount_id) {
        const { data: bd } = await supabase.from('vk_business_discounts')
          .select('company_name, phone, seller_email, seller_address, seller_zip, seller_city, seller_uid')
          .eq('id', sess.business_discount_id).maybeSingle();
        if (bd) sellerInfo = bd;
      }
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

// ── DNA GENERIEREN (ohne LP) ──────────────────────────────────────────
app.post('/api/vk/article/:id/generate-dna', async (req, res) => {
  try {
    const { data: article } = await supabase.from('vk_articles')
      .select('*, analysis, questions, answers').eq('id', req.params.id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    if (!article.analysis || !article.analysis.title_short)
      return res.status(400).json({ error: 'Artikel noch nicht analysiert' });
    // Antworten speichern wenn mitgeschickt
    if (req.body.answers) {
      await supabase.from('vk_articles').update({ answers: req.body.answers }).eq('id', req.params.id);
    }
    // DNA generieren
    vkAutoGenerateDNA(req.params.id, article.analysis, article.ai_mode || 'sachbearbeiter')
      .then(function(){ console.log('DNA generated for', req.params.id); })
      .catch(function(e){ console.error('DNA error:', e.message); });
    res.json({ success: true, message: 'DNA wird generiert' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/landingpage', async (req, res) => {
  try {
    const { article_id, session_id, days, has_bot, delivery_pickup, delivery_shipping, shipping_cost, pickup_location, sale_price, show_score_badge, stock_quantity } = req.body;
    if (!article_id || !session_id || !days) return res.status(400).json({ error: 'article_id, session_id und days erforderlich' });

    // Business-Check: Landingpage aktiviert?
    const { data: session } = await supabase.from('vk_sessions').select('business_discount_id, phone, ai_mode').eq('id', session_id).single();
    if (session && session.business_discount_id) {
      const { data: bd } = await supabase.from('vk_business_discounts').select('landingpage_enabled').eq('id', session.business_discount_id).single();
      if (!bd || !bd.landingpage_enabled) return res.status(403).json({ error: 'Landingpage für diesen Account nicht freigeschaltet' });
    }

    const { data: article } = await supabase.from('vk_articles').select('*, vk_photos(*), ai_mode').eq('id', article_id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    const slug = vkGenerateSlug(article.title || (article.analysis?.title_short) || 'produkt');
    const activeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
const authScore = article.analysis?.authenticity?.score ?? null;
const showBadge = !!show_score_badge && authScore !== null && authScore >= 60;
    // Extrafelder die in bot_config JSONB gespeichert werden (keine extra DB-Spalten nötig)
    const lpBotConfig = {
      bot_name_override: req.body.bot_name_override || null,
      stock_quantity: stock_quantity ? parseInt(stock_quantity) : null,
      mwst_included: !!req.body.mwst_included,
      mwst_rate: parseFloat(req.body.mwst_rate) || 20,
      min_price: parseFloat(req.body.min_price) || null
    };

    const { data: lp, error } = await supabase.from('vk_landingpages').insert({
      article_id, session_id, slug,
      active_until: activeUntil,
      has_bot: !!has_bot,
      delivery_pickup: delivery_pickup !== false,
      delivery_shipping: !!delivery_shipping,
      shipping_cost: parseFloat(shipping_cost) || 0,
      pickup_location: pickup_location || null,
      sale_price: parseFloat(sale_price) || null,
      min_price: parseFloat(req.body.min_price) || null,
      status: 'active', views: 0,
      show_score_badge: showBadge,
      stock_quantity: stock_quantity ? parseInt(stock_quantity) : null,
      stock_sold: 0,
      ai_mode: article?.ai_mode || session?.ai_mode || 'sachbearbeiter',
      anrede: req.body.anrede || 'Sie',
      bot_goal: Array.isArray(req.body.bot_goals) ? JSON.stringify(req.body.bot_goals) : (req.body.bot_goal || 'direktkauf'),
      bot_config: lpBotConfig
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, landingpage: lp, url: 'https://p.converdino.com/p/' + slug });

    // DNA wird nach Analyse automatisch generiert (vkRunMarketSearch → vkAutoGenerateDNA)
    // Falls Analyse bereits vorhanden: sofort generieren
    if (article.analysis && article.analysis.title_short) {
      vkAutoGenerateDNA(article_id, article.analysis, article.ai_mode || session?.ai_mode).catch(function(e){ console.error('DNA immediate:', e.message); });
    }

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
app.put('/api/vk/landingpage/:id', async (req, res) => {
  try {
    const allowed = ['sale_price','min_price','delivery_pickup','delivery_shipping','shipping_cost','pickup_location','has_bot','stock_quantity','show_score_badge','ai_mode','badge_type'];
    const updates = {};
    allowed.forEach(function(k){ if(req.body[k]!==undefined) updates[k]=req.body[k]; });
    const { data, error } = await supabase.from('vk_landingpages').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, landingpage: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
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
      .select('*, vk_articles(title, analysis), vk_sessions(phone)')
      .eq('slug', req.params.slug).single();

    if (!lp || lp.status !== 'active') return res.status(410).send('<h1>Angebot nicht mehr verfügbar.</h1>');
    if (lp.active_until && new Date(lp.active_until) < new Date()) return res.status(410).send('<h1>Angebot abgelaufen.</h1>');

    const article = lp.vk_articles || {};
    const an = article.analysis || {};
    const price = parseFloat(lp.sale_price || an.price_recommended || 0);
    if (!price || price <= 0) return res.status(400).send('<h1>Kein Preis definiert.</h1>');

    // Wenn beide Optionen aktiv → Auswahl anzeigen
    const deliveryType = req.query.type;
    if (lp.delivery_pickup && lp.delivery_shipping && !deliveryType) {
      const esc2 = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      return res.send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lieferung wählen</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:sans-serif;background:#f8f9fa;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}.card{background:#fff;border-radius:16px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 4px 20px rgba(0,0,0,.08);}.title{font-size:1rem;font-weight:800;margin-bottom:4px;}.price{font-size:1.8rem;font-weight:900;color:#15803d;margin-bottom:18px;}.q{font-size:.9rem;color:#6b7280;font-weight:600;margin-bottom:16px;}.opt{display:block;width:100%;padding:16px;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;text-decoration:none;text-align:center;margin-bottom:10px;}.opt-pickup{background:#f0fdf4;border:2px solid #25D366;color:#15803d;}.opt-ship{background:#eff6ff;border:2px solid #3b82f6;color:#1d4ed8;}.sub{font-size:.76rem;font-weight:500;opacity:.8;display:block;margin-top:3px;}</style></head><body><div class="card"><div class="title">${esc2(an.title_short||article.title||'Produkt')}</div><div class="price">€ ${parseFloat(lp.sale_price||an.price_recommended||0).toLocaleString('de-AT',{minimumFractionDigits:2})}</div><div class="q">Wie möchtest du den Artikel erhalten?</div><a class="opt opt-pickup" href="/p/${lp.slug}/buy?type=pickup">🤝 Selbstabholung<span class="sub">${lp.pickup_location||'Abholung beim Verkäufer'}</span></a><a class="opt opt-ship" href="/p/${lp.slug}/buy?type=shipping">📦 Versand<span class="sub">Versandkosten: €${parseFloat(lp.shipping_cost||0).toFixed(2)}</span></a></div></body></html>`);
    }

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const isShipping = deliveryType ? deliveryType === 'shipping' : !!lp.delivery_shipping;

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
      .select('*, vk_articles(title, analysis), vk_sessions(phone)')
      .eq('slug', req.params.slug).single();

    if (!lp) return res.status(404).send('<h1>Nicht gefunden</h1>');

    // Stripe Session laden
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    let stripeSession = null;
    if (session_id) {
      stripeSession = await stripe.checkout.sessions.retrieve(session_id);
    }

    const isShipping = stripeSession?.metadata?.delivery_type === 'shipping';
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
    if (lp.session_id) {
      const { data: sessComm } = await supabase.from('vk_sessions')
        .select('business_discount_id').eq('id', lp.session_id).maybeSingle();
      if (sessComm && sessComm.business_discount_id) {
        const { data: bdComm } = await supabase.from('vk_business_discounts')
          .select('sales_commission_percent').eq('id', sessComm.business_discount_id).maybeSingle();
        if (bdComm) commissionPct = bdComm.sales_commission_percent || 0;
      }
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
// Stock decrementieren
if (lp.stock_quantity !== null) {
  const newSold = (lp.stock_sold || 0) + 1;
  const updateData = { stock_sold: newSold };
  if (newSold >= lp.stock_quantity) updateData.status = 'sold_out';
  await supabase.from('vk_landingpages').update(updateData).eq('id', lp.id);
  console.log('Stock update: sold=' + newSold + '/' + lp.stock_quantity);
}
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
          .select('title, analysis').eq('id', v.article_id).maybeSingle();
        if (art) productTitle = art.analysis?.title_short || art.title || 'Produkt';
      }

      if (v.session_id) {
        const { data: sess } = await supabase.from('vk_sessions')
          .select('phone, business_discount_id').eq('id', v.session_id).maybeSingle();
        if (sess && sess.business_discount_id) {
          const { data: bd } = await supabase.from('vk_business_discounts')
            .select('company_name').eq('id', sess.business_discount_id).maybeSingle();
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



// ── ROUTE: Aktive LPs für Sandbox Dropdown ───────────────
app.get('/api/vk/admin/active-lps', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vk_landingpages')
      .select('id, slug, sale_price, min_price, negotiation_level, status, vk_articles(title, analysis)')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const result = (data || []).map(lp => ({
      slug: lp.slug,
      sale_price: lp.sale_price,
      min_price: lp.min_price,
      negotiation_level: lp.negotiation_level || 'professional',
      ai_mode: lp.ai_mode || 'sachbearbeiter',
      anrede: lp.anrede || 'Sie',
      title: lp.vk_articles?.analysis?.title_short || lp.vk_articles?.title || lp.slug
    }));

    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTE: LP Bot Sandbox (Admin Test ohne WhatsApp) ──────
app.post('/api/vk/admin/bot-sandbox', async (req, res) => {
  try {
    const { lp_slug, messages } = req.body;
    if (!lp_slug || !messages) return res.status(400).json({ error: 'lp_slug und messages erforderlich' });

    const { data: lp } = await supabase.from('vk_landingpages')
      .select('*, vk_articles(title, analysis, ai_mode, id), bot_config, ai_mode, anrede, min_price, sale_price, bot_goal')
      .eq('slug', lp_slug).maybeSingle();

    if (!lp) return res.status(404).json({ error: 'LP nicht gefunden' });

    // Dokumente für diesen Artikel laden
    if (lp.vk_articles?.id || lp.article_id) {
      try {
        const artId = lp.vk_articles?.id || lp.article_id;
        const { data: _docs } = await supabase.from('vk_article_docs')
          .select('label, public_url, type').eq('article_id', artId);
        if (_docs && _docs.length) lp._docs = _docs;
        // Hidden Photos wenn freigegeben
        const artData = lp.vk_articles || {};
        if (artData.bot_share_hidden) {
          const { data: _hidden } = await supabase.from('vk_photos')
            .select('public_url').eq('article_id', artId).eq('is_hidden', true);
          if (_hidden && _hidden.length) lp._hidden_photos = _hidden.map(function(p){ return p.public_url; });
        }
      } catch(e) { console.error('Sandbox docs:', e.message); }
    }

    const article = lp.vk_articles || {};
    const an = article.analysis || {};
    const price = parseFloat(lp.sale_price || an.price_recommended || 0);
    const minPrice = parseFloat(lp.min_price || price * 0.8);
    const botConfig = lp.bot_config || {};

    const aggrLevel = lp.negotiation_level || 'professional';
    const aggrMap = {
      friendly:     { label: 'freundlich', maxDiscount: 0.10, patience: 4 },
      professional: { label: 'professionell', maxDiscount: 0.06, patience: 3 },
      hard:         { label: 'hart', maxDiscount: 0.03, patience: 2 }
    };
    const aggr = aggrMap[aggrLevel] || aggrMap.professional;
    const absoluteMin = Math.max(minPrice, price - Math.round(price * aggr.maxDiscount));

    const botName = botConfig.bot_name_override || botConfig.bot_name || 'ein Verkaufsassistent';
    // Context: aus bot_config oder automatisch aus LP ai_mode ableiten
    const autoContext = botConfig.context || (lp.ai_mode !== 'sachbearbeiter' ? 'haendler' : 'privat');
    const contextMap = { privat:'Du verkaufst dein eigenes Stueck privat - du kennst es gut und hast eine persoenliche Bindung dazu.', haendler:'Du bist ein professioneller Haendler - kennst dein Sortiment, gibst aber keine Garantien die du nicht halten kannst.', geschaeft:'Du repraesentierst ein Unternehmen - professionell und kompetent.', nachlass:'Du loest einen Nachlass auf - respektvoll und sachlich.' };

    const catContextBot = vkGetCategoryContext(article.article_category || 'standard');
    const systemPrompt = `=== DEIN CHARAKTER ===
Du bist ${botName}. ${contextMap[botConfig.context]||'Du bist ein erfahrener Verkaeufer.'}
Du wirkst wie ein echter Mensch - kein Bot, kein Assistent.

ANREDE: Spreche den Kaeufer ausschliesslich mit "${lp.anrede === 'du' ? 'du/dein/dir' : 'Sie/Ihr/Ihnen'}" an.
${lp.anrede === 'du' ? 'Niemals "Sie" verwenden.' : 'Niemals "du", "dein", "dir" verwenden. Immer "Sie", "Ihr", "Ihnen".'} Diese Regel gilt absolut fuer JEDE Nachricht.

SPRACHE & TON:
Korrektes natuerliches Deutsch. Keine Anglizismen, kein Jugendslang.
VERBOTEN: "wearable", "Evergreen", "mega", "voll [Adj]", "das Teil", "cool", "nice", "okay so", "basically"
RICHTIG: "tragbar" statt "wearable" | "zeitlos" statt "Evergreen" | "sehr" statt "mega" | "das Kleid/Stueck/Geraet" statt "das Teil"
Ton: freundlich-professionell wie ein guter Verkaeufer. Vollstaendige grammatikalisch korrekte Saetze.

=== PRODUKT-DNA ===
${botConfig.product_story ? 'DEINE GESCHICHTE MIT DEM PRODUKT:\n' + botConfig.product_story : ''}
${botConfig.emotion ? 'EMOTIONALER KERN:\n' + botConfig.emotion : ''}
${botConfig.persona ? 'DEIN IDEALER KAEUFER:\n' + botConfig.persona : ''}

=== ABSOLUTE REGEL: NUR VERIFIZIERTE FAKTEN VERWENDEN ===
VERBOTEN: Eigenschaften erwaehnen die nicht in den verifizierten Fakten stehen.
VERBOTEN: Wartungsbuch, Serviceheft, Zertifikate oder andere Merkmale ohne expliziten Nachweis.
Bei Kaeufer-Fragen zu nicht vorhandenen Fakten: ehrlich sagen "Das kann ich dir gerade nicht bestaetigen."

=== DAS PRODUKT ===
Artikel: ${an.title_short || article.title || 'Produkt'}
Zustand: ${an.condition ? an.condition.split('.')[0] : 'Gut erhalten'}
Beschreibung: ${an.short_desc || ''}
Marktpreis: EUR ${an.price_min || Math.round(price * 0.9)} - EUR ${an.price_max || Math.round(price * 1.15)}
Lieferung: ${lp.delivery_pickup ? 'Abholung in ' + (lp.pickup_location || 'Wien') : ''}${lp.delivery_shipping ? (lp.delivery_pickup?' oder ':'')+'Versand EUR '+(lp.shipping_cost||0) : ''}
${botConfig.location ? 'Standort: ' + botConfig.location : ''}

=== VERIFIZIERTE FAKTEN (NUR DIESE VERWENDEN) ===
${lp._verifiedFacts || 'Keine zusaetzlichen Fakten hinterlegt.'}
${lp._docs && lp._docs.length ? '\nVERFUEGBARE UNTERLAGEN (auf Anfrage zusenden):\n' + lp._docs.map(function(d){return '- ' + d.label;}).join('\n') : ''}

=== NUTZEN (nur diese nennen, keine technischen Merkmale) ===
${(botConfig.feature_benefits||[]).filter(f=>f.feature&&f.benefit).map(f=>'- ' + f.benefit).join('\n')}

=== PRODUKTWERTE ===
${(botConfig.product_values||[]).filter(v=>v.label&&v.meaning).map(v=>'- ' + v.label + ': ' + v.meaning).join('\n')}

=== FAQ ===
${(botConfig.qa_pairs||[]).filter(qa=>qa.q&&qa.a).map(qa=>'Frage "'+qa.q+'" -> "'+qa.a+'"').join('\n')}
${botConfig.notes ? 'WICHTIG: ' + botConfig.notes : ''}

=== FOMO (situativ, max 1x) ===
${(botConfig.fomo_list||[]).filter(f=>f.argument).map(f=>(f.situation?f.situation+': ':'')+f.argument).join('\n')}
${botConfig.fomo ? botConfig.fomo : ''}

=== PREISREGELN ===
Festpreis: EUR ${price} | Minimum: EUR ${absoluteMin} (NIEMALS nennen)
1. Preis nie selbst ansprechen - nur auf Frage
2. Erste Preisfrage: Wert durch Marktpreis + Zustand + Emotion begruenden. Kein Nachgeben.
3. Zweite Preisfrage: EINMALIG max EUR ${Math.round(price * aggr.maxDiscount)} Nachlass - dann eisern
4. Weiteres Draengen: "Das ist mein letztes Wort."
5. Unter EUR ${absoluteMin}: "Das geht wirklich nicht."
6. EINIGUNG: Erst Freude/Bestaetigung ("Super, das freut mich!"), DANN "ZAHLUNG_LINK:[BETRAG]", DANN Naechste Schritte erklaeren ("Nach der Zahlung melden wir uns zur Uebergabe"). NIE nur den Trigger.

=== EINTAUSCH ===
Wenn Kaeufer Eintausch erwaehnt oder fragt ob moeglich:
1. Sofort bestaetigen: "Ja, das machen wir - welches Fahrzeug, Baujahr und ungefaehre KM?"
2. Mit diesen Infos: IMMER grobe Orientierung nennen: "Ein [Modell] Baujahr [X] mit [KM] km liegt am Markt grob bei EUR X-Y - haengt vom Zustand ab"
3. Erst DANN: "Den genauen Eintauschwert bestimmen wir beim Besichtigungstermin - da schaut sich unser Kollege beides an"
VERBOTEN: "Weiss ich nicht" / "Kann ich nicht sagen" / nur auf Termin verweisen ohne Orientierung zu geben.

=== WISSENSLUECKEN (wenn du eine Frage nicht beantworten kannst) ===
NIEMALS: "Ich habe keine verifizierten Informationen" → und dann sofort Rueckruf anbieten.
RICHTIG: 3-Schritt-Antwort:
1. Ehrlich anerkennen: "Ehrlich gesagt habe ich das gerade nicht zur Hand"
2. Losung anbieten: "Das klaere ich fuer Sie ab - ich oder ein Kollege melden sich kurz mit der Information"
3. Gespraech weiterführen: "Was interessiert Sie noch am Geraet?" oder naechste Qualifizierungsfrage stellen
Ziel: Im Gespraech bleiben, nicht eskalieren nur weil eine Detail-Frage offen ist.
Eskalation (KONTAKT_ANFRAGE / Verkaufsleiter) NUR wenn Kaeufer explizit Rueckruf moechte oder Preis-Verhandlung festgefahren ist.

=== KAEUFER-KONTAKT ===
Der Kaeufer kommuniziert per WhatsApp - seine Nummer ist bekannt.
Wenn Rueckruf gewuenscht: "Soll ich dich auf dieser WhatsApp-Nummer zurueckrufen oder hast du eine andere?" - NIE nach Telefonnummer fragen die schon bekannt ist.
Fuer Trigger TERMIN_ANFRAGE und KONTAKT_ANFRAGE: verwende "[kaeufer-wa-nummer]" als Platzhalter - die echte Nummer wird automatisch eingesetzt.

=== GESPRAECHSFUEHRUNG ===

DEIN GESPRAECHSZIEL: ${(function(){var g=(lp.bot_goal||'direktkauf').split(',')[0].trim();var m={direktkauf:'DIREKTKAUF → Zahlungslink',besichtigung:'BESICHTIGUNG → Termin vereinbaren',kontakt:'RUECKRUF → Kontaktdaten sammeln',angebot:'ANGEBOT → Anfrage aufnehmen',leasing:'FINANZIERUNG → Beratungstermin'};return m[g]||m.direktkauf;})()}

EROEFFNUNG (erste Nachricht - IMMER dieses Schema):
"Hallo! Ich bin [BotName]. Womit kann ich ${lp.anrede === 'du' ? 'dir' : 'Ihnen'} helfen?"
KURZ. OFFEN. Keine Produktnennung, keine vorformulierte Frage, kein Pitch.
Der Kaeufer hat bereits Interesse gezeigt (LP-Link geoeffnet) - lass ihn sagen was er braucht.
Dann gezielt auf seine Antwort eingehen.

VERFUEGBARKEIT ("noch verfuegbar?") = KAUFSIGNAL → Ja + Knappheit: "Ja, noch da - hat aber schon Interessenten, wird nicht lange bleiben. Was moechtest du wissen?"
ZUSTANDSFRAGEN → Ehrlich mit Charme: "Vintage hat Geschichte - sauber und gepflegt, aber wie neu kann ich nicht garantieren. Wer es traegt sieht darin fantastisch aus."
REAKTION: A) Konkret → Loesung + Ziel-Action | B) Vage → 1 Frage → Loesung | C) Preis → nennen + Wert | D) Signal → sofort Action | E) Einwand → loesen
MAX 3 FRAGEN dann immer Action.
EINIGUNG: Immer erst menschliche Bestaetigung, dann Trigger in neuer Zeile.
Kauf → Freude zeigen + "ZAHLUNG_LINK:[BETRAG]" + naechste Schritte erklaeren
Termin → "TERMIN_ANFRAGE:[name]:[kaeufer-wa-nummer]:[datum]"
Rueckruf → "KONTAKT_ANFRAGE:[name]:[kaeufer-wa-nummer]:[zeit]" (Telefon nicht abfragen)

=== UNIVERSELLE VERKAUFSPRINZIPIEN ===
${vkSalesPrinciplesText()}

=== KATEGORIE: ${catContextBot.label} ===
Naechster Schritt wenn Interesse: ${catContextBot.next_step}
Qualifizierung: ${catContextBot.qualify}
Wertargumente: ${catContextBot.value_args}

=== EXIT-STRATEGIE (wenn Kaeufer unter Mindestpreis bleibt) ===
Wenn Kaeufer unter EUR ${absoluteMin} bleibt UND du bereits "letztes Wort" gesagt hast:

SCHRITT 1 - Letzte Argumente (nutze diese in dieser Reihenfolge, 1 pro Nachricht):
${(botConfig.exit_strategy_args||[]).filter(function(a){return a.argument;}).map(function(a,i){return (i+1)+'. '+a.argument;}).join('\n')}

SCHRITT 2 - Falls Kaeufer immer noch nicht kauft:
Sage: "Ich darf leider nicht weiter runtergehen als den Preis den ich dir genannt habe. Mein Vorschlag: Ich leite dich an unseren Verkaufsexperten weiter - der hat manchmal noch Moeglichkeiten. Waere das ok?"
Bei JA: "Super. Kannst du mir noch kurz deine E-Mail geben und wann du am besten erreichbar bist?"
Sobald du E-Mail und Zeitpunkt hast: sende NUR "VERKAUFSLEITER_ANFRAGE:[email]:[zeitpunkt]"

${vkBotGoalPrompt(lp, lp.anrede||'Sie')}

=== VERBOTEN — ABSOLUTE REGELN ===
1. NIEMALS Gespraechsabschluss wenn Kaeufer eine offene Anfrage/Kaufsignal hat.
   Verabschiedung NUR bei explizit: "kein Interesse", "ich will nicht", "zu teuer tschuess" - nicht bei "Nein".

2. NEIN AM SATZANFANG - NIEMALS automatisch als Ablehnung:
   PREISVERHANDLUNG: "nein 45 Euro" / "nein, maximal 45" / "nein, ich biete 45" = GEGENANGEBOT - weiter verhandeln!
   - "Nein das gefaellt mir" = positiv, weiter verkaufen
   - "Nein ich kaufe es" = Kauf, abschliessen
   - "Nein 45 Euro das ist mein Entgegenkommen" = Preisangebot 45 EUR - pruefen ob akzeptierbar
   Echte Ablehnung NUR: "kein Interesse", "ich will nicht", "tschuess"

3. PREIS-GEGENANGEBOT ("nein [Betrag]" / "[Betrag] ist mein letztes Wort"):
   - Betrag >= Mindestpreis: SOFORT annehmen → ZAHLUNG_LINK:[Betrag]
   - Betrag < Mindestpreis: EINMAL letzter Gegenvorschlag (halbweg zwischen beiden), dann Eskalation anbieten
   - NIEMALS verabschieden bei laufender Preisverhandlung

4. KAUFSIGNAL: "kaufe ich um X" / "zahle X" / "wenn X dann kaufe ich" → sofort reagieren.

5. Dossier/Angebot → E-Mail → DOSSIER_SENDEN.

6. ANREDE ABSOLUT: Einmal "du" = immer "du" bis Gespraechsende. Einmal "Sie" = immer "Sie". KEIN Wechsel, auch nicht in der letzten Nachricht.

=== VERBOTEN — ABSOLUTE REGELN ===
- Verabschiedung NUR bei: "kein Interesse", "ich will nicht" - NIEMALS bei "Nein" + Preis
- "nein 45 Euro" / "nein, maximal 45" = PREISGEGENANGEBOT - pruefen ob >= Mindestpreis, dann annehmen
- "Nein das gefaellt" = positiv. "Nein ich kaufe" = Kauf. Immer REST des Satzes lesen!
- Kaufsignal "kaufe ich um X" → sofort reagieren
- Dossier/Angebot → E-Mail → DOSSIER_SENDEN
- ANREDE: einmal "du" = immer "du". Einmal "Sie" = immer "Sie". Absolut kein Wechsel.

=== VERBOTEN ===
${lp._hidden_photos && lp._hidden_photos.length ? `VERSTECKTE FOTOS FREIGEGEBEN (nur auf Anfrage senden):\n` + lp._hidden_photos.map(function(u,i){ return 'Foto ' + (i+1) + ': ' + u; }).join('\n') + `\nWenn Kaeufer nach Fotos, Bildern, Nahaufnahmen fragt: Sende diese Links direkt.` : ''}
${lp._answers && lp._answers.length ? `\nVERIFIZIERTE FAKTEN - VOM VERKAEUFER BESTAETIGT (immer verwenden wenn gefragt):\n` + lp._answers.map(function(a){ return '- ' + a.label + ': ' + a.value; }).join('\n') : ''}
${lp._docs && lp._docs.length ? `DOKUMENTE AKTIV ANBIETEN:\nDu hast folgende Unterlagen die du auf Anfrage als Link zusenden kannst:\n${lp._docs.map(d => '- ' + d.label + ': ' + d.public_url).join('\n')}\n\nWenn Kaeufer nach Unterlagen/Dossier/Fotos/Protokollen/Servicebuch fragt:\n→ Frage nach E-Mail: "An welche E-Mail soll ich die Unterlagen schicken?"\n→ Wenn Kaeufer E-Mail nennt: Antworte NUR mit: DOSSIER_SENDEN:[email]\nDu kannst proaktiv anbieten: "Ich habe Wartungsprotokoll und Unterlagen - soll ich die zusenden?"` : '- Fotos, Bilder, Dokumente senden anbieten - du bist reiner Textbot, kannst KEINE Medien senden'}
- "Ich schicke/sende dir Fotos/Bilder/Dokumente" - NIEMALS (ausser Dokumente sind hinterlegt)
- "Passt das zu dir?" nach Preisnennung
- Preis oder Rabatt ohne Kaeufer-Frage ansprechen
- Mehr als 3 Saetze pro Nachricht
- Markdown, Listen, Sternchen, Aufzaehlungen
- Marketingfloskeln: "Top-Deal", "Gerne", "Natuerlich", "Absolut"


=== SPRACHE & STIL ===
Schreib wie ein normaler Mensch im Gespraech - nicht wie eine Broschüre.

EINFACH & KLAR:
- Kurze Saetze. Ein Gedanke pro Satz.
- Woerter die jeder kennt. Kein Businessdeutsch.
- NICHT: "Im Rahmen einer umfassenden Pruefung wurde festgestellt..."
- SONDERN: "Wir haben alles gecheckt - laeuft einwandfrei."
- NICHT: "Ich moechte Sie darauf hinweisen, dass..."  
- SONDERN: "Wichtig:" oder einfach direkt sagen

VERBOTENE WOERTER & FLOSKELN:
- "gerne" / "natuerlich" / "selbstverstaendlich" / "absolut"
- "im Rahmen" / "hinsichtlich" / "bezueglich"
- "Ich moechte Ihnen mitteilen" / "Ich darf darauf hinweisen"
- "Premium" / "exklusiv" / "hochwertig" (ausser es stimmt wirklich)
- Saetze die mit "Es" beginnen wenn man es vermeiden kann
ANREDE: ${lp.anrede === 'du' ? 'DU-Form: du/dein/dir - niemals Sie' : 'SIE-Form: Sie/Ihr/Ihnen - niemals du'}


TYPISCHE FEHLER VERMEIDEN:
- Nicht zu viele Adjektive ("der wunderbare, hochwertige, gepflegte Stapler")
- Nicht redundant ("Das Fahrzeug ist ein Stapler der als Gabelstapler funktioniert")
- Nicht ausweichen wenn man direkt antworten kann
- Nicht kuenstlich Begeisterung zeigen ("Das ist eine tolle Frage!")

=== STIL ===
WhatsApp eines echten Menschen. Locker, direkt. Max 2-3 Saetze. Kein Markdown. Immer auf Deutsch ausser Kaeufer schreibt andere Sprache.`;

     // Modell = LP ai_mode – wenn nicht gesetzt, aus Artikel lesen
    const lpAiMode = lp.ai_mode || lp.vk_articles?.ai_mode || 'abteilungsleiter';
    const aiModeMap = { sachbearbeiter: 'claude-sonnet-4-6', abteilungsleiter: 'claude-sonnet-4-6', experte: 'claude-opus-4-6' }; // Sachbearbeiter → Sonnet: Haiku zu schwach für emotionale Verkaufsgespräche
    const model = aiModeMap[lpAiMode] || 'claude-sonnet-4-6';
    console.log('bot-sandbox: lp.ai_mode=', lp.ai_mode, '→ lpAiMode=', lpAiMode, '→ model=', model);

    const fetch = require('node-fetch');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 400, system: systemPrompt, messages })
    });
    const data = await response.json();
    if (data.error) {
      console.error('Anthropic API error in sandbox:', JSON.stringify(data.error));
      return res.status(500).json({ error: 'API Fehler: ' + data.error.message + ' (Modell: ' + model + ')' });
    }
    const reply = data.content?.[0]?.text || 'Fehler bei der Antwort';

    const paymentMatch = reply.match(/ZAHLUNG_LINK:(\d+(?:\.\d+)?)/);
    const vkLeiterMatch = reply.match(/VERKAUFSLEITER_ANFRAGE:([^:]+):(.+)/);
    res.json({
      reply,
      model,
      payment_link: paymentMatch ? { amount: parseFloat(paymentMatch[1]) } : null,
      vk_leiter: vkLeiterMatch ? { email: vkLeiterMatch[1].trim(), zeitpunkt: vkLeiterMatch[2].trim() } : null
    });
  } catch(e) {
    console.error('bot-sandbox error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── ROUTE: Compliance Freigabe ────────────────────────────
app.put('/api/vk/admin/compliance/:articleId', async (req, res) => {
  try {
    const { action, reason } = req.body;
    // action: 'approve' | 'reject'
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    const { data: article } = await supabase.from('vk_articles')
      .select('id, title, session_id')
      .eq('id', req.params.articleId).maybeSingle();

    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    await supabase.from('vk_articles').update({
      compliance_status: newStatus,
      admin_verified: action === 'approve',
      compliance_blocked_reason: action === 'reject' ? reason : null
    }).eq('id', req.params.articleId);

    // Compliance Log
    await supabase.from('vk_compliance_log').insert({
      article_id: req.params.articleId,
      action: action === 'approve' ? 'admin_approved' : 'admin_rejected',
      reason: reason || null
    });

    // Bei Ablehnung: E-Mail an Verkäufer
    if (action === 'reject' && reason) {
      const { data: sess } = await supabase.from('vk_sessions')
        .select('phone, business_discount_id')
        .eq('id', article.session_id).maybeSingle();

      if (sess) {
        // WhatsApp Benachrichtigung
        const waMsg = 'Dein Artikel "' + (article.title || 'Unbekannt') + '" wurde leider nicht freigegeben.\n\nGrund: ' + reason + '\n\nBei Fragen: office@ynhald.com';
        await vkSendWhatsApp(sess.phone, waMsg);

        // E-Mail wenn vorhanden
        let sellerEmail = null;
        if (sess.business_discount_id) {
          const { data: bd } = await supabase.from('vk_business_discounts')
            .select('seller_email, company_name').eq('id', sess.business_discount_id).maybeSingle();
          if (bd && bd.seller_email) {
            sellerEmail = bd.seller_email;
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
              body: JSON.stringify({
                from: 'Converdino <noreply@converdino.com>',
                to: sellerEmail,
                subject: 'Ihr Artikel wurde nicht freigegeben',
                html: '<p>Guten Tag,</p><p>leider koennen wir folgenden Artikel nicht freigeben:</p><p><strong>' + (article.title || '') + '</strong></p><p>Grund: ' + reason + '</p><p>Bei Fragen: <a href="mailto:office@ynhald.com">office@ynhald.com</a></p><p>Mit freundlichen Gruessen<br>Das Converdino Team</p>'
              })
            });
          }
        }
      }
    }

    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ROUTE: Admin Verifizierung (Auth Badge) ───────────────
app.put('/api/vk/admin/verify/:articleId', async (req, res) => {
  try {
    await supabase.from('vk_articles')
      .update({ admin_verified: true, compliance_status: 'approved' })
      .eq('id', req.params.articleId);
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

// ── Sandbox/Start: Session für Report Test erstellen ────────────────────
app.post('/api/vk/sandbox/start', async (req, res) => {
  try {
    const { phone, ai_mode } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone fehlt' });
    const cleanPhone = String(phone).replace(/[^0-9]/g, '');
    const token = generateToken();
    const sessionInsert = { token, phone: cleanPhone, status: 'open', ai_mode: ai_mode || 'abteilungsleiter', expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
    // Business-Rabatt prüfen
    const bd = await vkGetBusinessDiscount(cleanPhone);
    if (bd) { sessionInsert.business_discount_id = bd.id; sessionInsert.business_discount_pct = bd.discount_percent; }
    const { data: session, error } = await supabase.from('vk_sessions').insert(sessionInsert).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, token, session_id: session.id, url: 'https://converdino.com/bericht.html?s=' + token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Test-Session (Sandbox) ─────────────────────────
app.post('/api/vk/admin/new-session', async (req, res) => {
  try {
    const { password, phone } = req.body;
    if (password !== process.env.ADMIN_PASSWORD && password !== process.env.SUPERADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Falsches Passwort' });
    }
    const token = generateToken();
    const { business_phone } = req.body;
    const testPhone = business_phone || phone || ('test' + Date.now());
    const sessionInsert = { token, phone: testPhone, status: 'open', expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
    if (business_phone) {
      const bd = await vkGetBusinessDiscount(business_phone);
      if (bd) { sessionInsert.business_discount_id = bd.id; sessionInsert.business_discount_pct = bd.discount_percent; }
    }
    const { data: session, error } = await supabase.from('vk_sessions').insert(sessionInsert).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, token, url: 'https://converdino.com/bericht.html?s=' + token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── Artikel neu analysieren (nur Business, max 3x) ────────
app.post('/api/vk/article/:id/reanalyze', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: article } = await supabase.from('vk_articles')
      .select('*, vk_photos(*), vk_sessions(phone, business_discount_id)')
      .eq('id', id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    const isBusiness = !!article.vk_sessions?.business_discount_id;
    if (!isBusiness) return res.status(403).json({ error: 'Nur fuer Business-Kunden' });
    const currentCount = article.analysis_count || 1;
    if (currentCount >= 3) return res.status(400).json({ error: 'Maximum 3 Analysen erreicht', count: currentCount });

    await supabase.from('vk_articles').update({ status: 'pending', analysis_count: currentCount + 1 }).eq('id', id);
    res.json({ success: true, message: 'Neuanalyse gestartet', count: currentCount + 1 });

    (async () => {
      try {
        const phone = article.vk_sessions?.phone || null;
       const { data: freshPhotos } = await supabase.from('vk_photos').select('*').eq('article_id', id);
const analysis = await vkAnalyzeArticle(article, freshPhotos || [], phone);
        const AUTH_CATS = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
        const auth = analysis.authenticity || {};
        const authScore = (auth && auth.score != null) ? auth.score : null;
        const needsAuthReview = authScore !== null && authScore < 60 && AUTH_CATS.includes(analysis.article_category || '');
        await supabase.from('vk_articles').update({
          analysis, status: 'analyzed',
          article_category: analysis.article_category || 'standard',
          authenticity_score: authScore,
          authenticity_verdict: auth.verdict || null,
          authenticity_flags: auth.flags || [],
          authenticity_warning: auth.warning || null,
          compliance_status: needsAuthReview ? 'needs_review' : 'approved'
        }).eq('id', id);
        if (analysis.title_short && analysis.title_short !== 'Analyse fehlgeschlagen') {
          vkRunMarketSearch(article.id, analysis.title_short, phone).catch(e => console.error('Market bg:', e.message));
        }
      } catch(e) {
        console.error('Reanalyze error:', e);
        await supabase.from('vk_articles').update({ status: 'error' }).eq('id', id);
      }
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── ADMIN: Alle VK-Daten löschen (Nuclear Reset) ─────────────────────────
app.post('/api/vk/admin/nuke-all', async (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD && password !== process.env.SUPERADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  try {
    const log = [];

    // 1. Storage leeren
    try {
      const { data: files } = await supabase.storage.from('vk-photos').list('', { limit: 1000 });
      if (files && files.length) {
        // Alle Unterordner auflisten und leeren
        for (const folder of files) {
          if (folder.id === null) { // ist ein Ordner
            const { data: subFiles } = await supabase.storage.from('vk-photos').list(folder.name, { limit: 1000 });
            if (subFiles && subFiles.length) {
              for (const subFolder of subFiles) {
                const { data: photos } = await supabase.storage.from('vk-photos').list(folder.name + '/' + subFolder.name, { limit: 1000 });
                if (photos && photos.length) {
                  const paths = photos.map(p => folder.name + '/' + subFolder.name + '/' + p.name);
                  await supabase.storage.from('vk-photos').remove(paths);
                }
              }
            }
          }
        }
        log.push('Storage: Fotos gelöscht');
      }
    } catch(storageErr) { log.push('Storage Fehler: ' + storageErr.message); }

    // 2. DB löschen (Reihenfolge: Foreign Keys beachten)
    const tables = [
      'vk_compliance_log',
      'vk_coupon_uses',
      'vk_landingpages',
      'vk_photos',
      'vk_articles',
      'vk_sessions'
    ];
    for (const table of tables) {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) log.push(table + ' Fehler: ' + error.message);
      else log.push(table + ': gelöscht');
    }

    // QR Codes ohne merchant (LP-Käufe)
    await supabase.from('qr_codes').delete().is('merchant_id', null);
    log.push('qr_codes (LP): gelöscht');

    console.log('NUKE-ALL executed:', log.join(', '));
    res.json({ success: true, log });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ETag deaktivieren - verhindert 304 Caching-Probleme
app.set('etag', false);


// ══════════════════════════════════════════════════════════
// FREICODES
// ══════════════════════════════════════════════════════════

// Admin: Freicode generieren
app.post('/api/vk/freicodes/generate', async (req, res) => {
  try {
    const { note, merchant_id } = req.body;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const { data, error } = await supabase.from('vk_freicodes').insert({
      code,
      note: note || null,
      merchant_id: merchant_id || null,
      status: 'active'
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, freicode: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: Freicode Liste
app.get('/api/vk/freicodes', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_freicodes')
      .select('*, vk_sessions(phone)')
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    const enriched = (data || []).map(function(fc) {
      return Object.assign({}, fc, { redeemed_by_phone: fc.vk_sessions ? fc.vk_sessions.phone : null });
    });
    res.json({ freicodes: enriched });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Kunde: Freicode einlösen
app.post('/api/vk/freicodes/redeem', async (req, res) => {
  try {
    const { code, session_id, article_id } = req.body;
    if (!code) return res.status(400).json({ error: 'Code fehlt' });
    const { data: fc } = await supabase.from('vk_freicodes')
      .select('*').eq('code', code.toUpperCase().trim()).single();
    if (!fc) return res.status(404).json({ error: 'Code nicht gefunden' });
    if (fc.status !== 'active') return res.status(400).json({ error: 'Code bereits eingelöst oder deaktiviert' });
    // Code einlösen
    await supabase.from('vk_freicodes').update({
      status: 'used',
      used_at: new Date().toISOString(),
      used_by_session: session_id || null,
      article_id: article_id || null
    }).eq('id', fc.id);
    // Session auf analyzing setzen (100% frei)
    if (session_id) {
      await supabase.from('vk_sessions').update({
        status: 'analyzing',
        paid_at: new Date().toISOString(),
        total_price: 0,
        freicode: code.toUpperCase()
      }).eq('id', session_id);
    }
    res.json({ success: true, message: 'Freicode eingelöst — Analyse wird gestartet' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, async () => {
  console.log('✅ Converto API v2.2.0 läuft auf Port ' + PORT);

  // Watchdog: Steckengebliebene 'analyzing' Sessions neu starten
  setTimeout(async function() {
    try {
      const { data: stuckSessions } = await supabase.from('vk_sessions')
        .select('id, token, phone, ai_mode')
        .eq('status', 'analyzing')
        .limit(10);
      if (!stuckSessions || !stuckSessions.length) return;
      console.log('Watchdog: ' + stuckSessions.length + ' stuck sessions found');
      for (const sess of stuckSessions) {
        try {
          const { data: arts } = await supabase.from('vk_articles')
            .select('id, status, title, ai_mode, vk_photos(*)')
            .eq('session_id', sess.id);
          console.log('Watchdog session', sess.token, ': articles=', (arts||[]).length);
          let anyFixed = false;
          for (const art of arts) {
            console.log('Watchdog: article', art.id, 'status=', art.status, 'photos=', (art.vk_photos||[]).length);
            if ((art.status !== 'analyzed' || !art.analysis || !art.analysis.title_short) && (art.vk_photos||[]).length > 0) {
              console.log('Watchdog: analyzing article', art.id);
              const analysis = await vkAnalyzeArticle(art, art.vk_photos, sess.phone);
              console.log('Watchdog: analysis done, title=', analysis.title_short, 'error=', analysis.error);
              await supabase.from('vk_articles').update({ analysis, status: 'analyzed', title: analysis.title_short||art.title }).eq('id', art.id);
              anyFixed = true;
            }
          }
          if (anyFixed) {
            await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString() }).eq('id', sess.id);
            console.log('Watchdog: fixed session', sess.id);
            }
          // Auch wenn bereits analyzed - session auf done setzen
          const _allDone2 = (arts||[]).every(a => a.status==='analyzed');
          if (!anyFixed && _allDone2 && (arts||[]).length > 0) {
            await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString() }).eq('id', sess.id);
            console.log('Watchdog: session already done, fixed', sess.token);
          }
          if (false) {
          }
        } catch(e) { console.error('Watchdog error for session', sess.id, ':', e.message); }
      }
    } catch(e) { console.error('Watchdog startup error:', e.message); }
  }, 5000);
});



function vkCalcPrice(articles) {
  let total = 1.00;
  for (const a of articles) {
    const photoCount = a.photo_count || (a.vk_photos || []).length || 0;
    if (photoCount > 0) {
      total += 1.00;
      total += Math.max(0, photoCount - 1) * 0.25;
    }
    if (a.extended) total += 1.00;
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
// ── MARKTSUCHE V2: Kategoriespezifisch + Stufensuche ───────────────────
async function vkRunMarketSearchV2(articleId, title, category, answers) {
  try {
    const platMap = {
      industrial: 'maschinensucher.de, surplex.com, machineseeker.com, wotol.com',
      vehicle: 'autoscout24.at, willhaben.at/autos, mobile.de',
      luxury_watch: 'chrono24.com, watchfinder.co.uk, chrono24.de',
      electronics: 'willhaben.at, ebay.at, rebuy.de',
      jewelry: 'chrono24.com, dorotheum.at, ebay.at',
      art: 'dorotheum.at, ebay.at, artprice.com',
      standard: 'willhaben.at, ebay.at, kleinanzeigen.de'
    };
    const platforms = platMap[category] || platMap.standard;
    const ans = answers || {};

    // Suchanfrage mit bekannten Fakten anreichern
    const extras = [
      ans.q2 && 'Baujahr ' + ans.q2,
      ans.q1 && ans.q1 + ' Betriebsstunden',
      ans.km && ans.km + ' km',
    ].filter(Boolean).join(' ');

    const market = await vkMarketSearchV2Call(title, extras, platforms, category);
    const { data: current } = await supabase.from('vk_articles').select('analysis').eq('id', articleId).single();
    if (current?.analysis) {
      await supabase.from('vk_articles').update({ analysis: { ...current.analysis, market_comparison: market } }).eq('id', articleId);
    }
  } catch(e) { console.error('MarketV2 error:', e.message); }
}

async function vkMarketSearchV2Call(title, extras, platforms, category) {
  try {
    const fetch = require('node-fetch');
    const searchQ = (title + ' ' + (extras || '') + ' gebraucht kaufen').trim();
    const prompt = 'Suche auf ' + platforms + ' nach aktuellen Angeboten fuer: ' + searchQ + '.\n\nWICHTIG: Nur echte gefundene Angebote. Wenn nichts gefunden → found:false. KEINE Schaetzungen.\n\nJSON: {"found":true,"platform":"Name","listings_count":3,"price_range_min":2500,"price_range_max":4200,"price_avg":3200,"assessment":"Einschaetzung","search_query":"' + searchQ + '"} ODER {"found":false,"platform":"","listings_count":0,"price_range_min":0,"price_range_max":0,"price_avg":0,"assessment":"","note":"Keine Angebote gefunden"}';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: 'Marktanalyst. Suche aktiv nach echten Angeboten. Antworte IMMER mit validem JSON. NIEMALS Preise schaetzen wenn nichts gefunden.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const d = await r.json();
    const textBlock = (d.content || []).find(b => b.type === 'text');
    if (!textBlock?.text) return { found: false, note: 'Suche nicht verfuegbar' };
    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}')+1));
    console.log('MarketV2 result:', JSON.stringify(result));
    return result;
  } catch(e) {
    console.error('MarketV2Call error:', e.message);
    return { found: false, note: 'Marktvergleich temporaer nicht verfuegbar' };
  }
}

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
        model: AI.market,
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
  if (!photos || !photos.length) {
    const { data: fp } = await supabase.from('vk_photos').select('*').eq('article_id', article.id);
    photos = fp || [];
  }
 const imageBlocks = [];
  const SUPPORTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  for (const p of (photos || [])) {
    try {
      const imgRes = await fetch(p.public_url);
      let ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].toLowerCase();
      // AVIF/HEIC/BMP nicht unterstützt → überspringen
      if (!SUPPORTED_TYPES.includes(ct)) {
        console.warn('Unsupported image format skipped:', ct, p.public_url);
        // Versuche trotzdem als JPEG zu senden (manchmal falscher Content-Type)
        ct = 'image/jpeg';
      }
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      // Prüfe ob es tatsächlich ein Bild ist (magic bytes)
      const header = imgBuf.slice(0, 4).toString('hex');
      // AVIF magic: 00000020667479706176696600000000 (ftyp)
      // JPEG magic: ffd8ff
      // PNG magic: 89504e47
      if (header.startsWith('0000') || header.includes('6674797061766966')) {
        console.warn('AVIF/HEIF format detected - skipping:', p.public_url);
        continue;
      }
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: ct, data: imgBuf.toString('base64') } });
    } catch(imgErr) { console.error('Image download error:', imgErr.message, p.public_url); }
  }
  if (!imageBlocks.length) return { title_short: 'Analyse fehlgeschlagen', error: 'Keine Bilder ladbar' };
   const notesText = article.notes ? '\n\nZusatzinfos vom Verkaeufer: ' + article.notes : '';
 
 // Authentizitaet: Claude entscheidet selbst ob relevant
  const authBlock = `  "authenticity": {
    "score": null,
    "verdict": null,
    "positive_indicators": [],
    "flags": [],
    "warning": null
  }`;
 
  const authInstructions = `\n\nAUTHENTIZITAET - Immer ausfuellen:
- Score 0-100 (Echtheitsbewertung anhand sichtbarer Merkmale auf den Fotos)
- verdict: "authentic" / "suspicious" / "cannot_determine"
- positive_indicators: Array mit positiven Echtheitsnachweisen
- flags: Array mit Auffaelligkeiten oder Verdachtsmomenten
- warning: Warntext wenn verdaechtig, sonst null
- Bei nicht-physischen Produkten oder unklaren Fotos: score null setzen`; 
 
  const prompt = `Analysiere dieses Produkt und erstelle folgendes JSON:${notesText}
{
  "title_short": "Kurztitel (max 60 Zeichen, SEO-optimiert)",
  "title_long": "Ausfuehrlicher Titel mit Keywords",
  "title_quick": "Quick-Sale Titel",
  "short_desc": "2-3 Saetze Kurzbeschreibung",
  "long_desc": "Ausfuehrliche Beschreibung",
  "bullet_points": ["Highlight 1", "Highlight 2", "Highlight 3"],
  "price_min": 0,
  "price_max": 0,
  "price_recommended": 0,
  "price_unknown": false,
  "price_reasoning": "Begruendung (NUR auf echten Fakten basieren, nie erfinden)",
  "condition": "Zustandsbeschreibung",
  "keywords": ["keyword1", "keyword2"],
  "tips": ["Verkaufstipp 1", "Verkaufstipp 2"],
  "article_category": "luxury_watch ODER luxury_bag ODER jewelry ODER electronics ODER vehicle ODER medical ODER industrial ODER art ODER standard",
${authBlock}
}${authInstructions}`;
 
 const analysisModel = AI.analysis;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: analysisModel,
        max_tokens: 2000,
system: 'Du bist ein erfahrener Verkaufstexter fuer Online-Marktplaetze (Willhaben, eBay, Kleinanzeigen, Maschinensucher).\nAufgabe: Artikel verkaufsorientiert beschreiben - positiv, ueberzeugend, OHNE zu luegen.\n\nSCHREIBREGELN:\n- Staerken in den Vordergrund, Schwaechen konstruktiv formulieren\n- Zustand immer aus Verkaeufer-Perspektive formulieren\n\nDOKUMENT-VORRANG: Wenn Dokumente (PDF/Dossier) beigefuegt sind:\n- Alle Daten aus Dokumenten haben ABSOLUTE PRIORITAET vor Foto-Schaetzungen\n- Preis, Baujahr, KM-Stand, Ausstattung aus Dokument IMMER verwenden\n- tech_specs: ALLE technischen Daten aus Dokumenten einzeln auflisten\n\nPREISREGELN:\n- Preis aus Dokument direkt uebernehmen wenn vorhanden\n- Ohne Dokument: Neupreis NICHT schaetzen, price_unknown=true\n- Preisbegruendung nur auf ECHTEN Fakten\n\nAntworte NUR mit validem JSON, kein Markdown, keine Erklaerungen.',      
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }]
    })
  });
 
  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';
  let analysis;
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('Kein JSON gefunden in: ' + cleaned.substring(0,100));
    analysis = JSON.parse(cleaned.substring(jsonStart, jsonEnd+1));
    if (!analysis.title_short) throw new Error('JSON unvollstaendig - kein title_short');
  } catch(e) {
    console.error('vkAnalyzeArticle JSON parse error:', e.message, 'text[:200]:', text.substring(0,200));
    // Bei Parse-Fehler: NICHT als analyzed speichern - throw damit retry greift
    throw new Error('Analyse JSON ungueltig: ' + e.message);
  }
  return analysis;
}

// ── AUTO-DNA: Generiert bot_config für alle LPs eines Artikels ──────────
// ═══════════════════════════════════════════════════════════════════════
// UNIVERSELLE VERKAUFSPRAXIS (erweiterbar — neue Prinzipien unten hinzufügen)
// ═══════════════════════════════════════════════════════════════════════
const UNIVERSAL_SALES_PRINCIPLES = [
  {
    id: 'availability_fomo',
    label: 'Verfügbarkeit + FOMO',
    text: 'Bestätige sofort die Verfügbarkeit. Erwähne konkret dass es andere Interessenten gibt aber noch kein Abschluss. Biete sofort den nächsten konkreten Schritt an (Besichtigung, Termin, Demo, Musterversand).'
  },
  {
    id: 'price_with_value',
    label: 'Preis immer mit Wert begründen',
    text: 'Nenne den Preis IMMER mit Begründung was inkludiert ist (Zustand, Garantie, Service, Zertifikate, Ausstattung, Besonderheiten). Niemals nur die Zahl nennen ohne Kontext.'
  },
  {
    id: 'discount_qualify_first',
    label: 'Rabatt → erst qualifizieren',
    text: 'Nie sofort nachgeben. Zuerst fragen: Gibt es ein Produkt zum Eintausch / Inzahlungnahme? Ist der Käufer entscheidungsbereit heute? Welche Timeline hat er? Erst dann und nur dann über Spielraum reden.'
  },
  {
    id: 'appointment_concrete',
    label: 'Termin konkret organisieren',
    text: 'Nicht vage "kommen Sie vorbei" sondern: "Nennen Sie mir 2-3 Termine wann es für Sie passt und ich organisiere alles." Immer den Ball zurückspielen mit einer konkreten Handlungsaufforderung.'
  }
  // ← Neue Prinzipien hier hinzufügen
];

// ── KATEGORIE-SPEZIFISCHE ERGÄNZUNGEN ──────────────────────────────────
function vkGetCategoryContext(category) {
  const cat = (category || 'standard').toLowerCase();
  const contexts = {
    vehicle: {
      label: 'Fahrzeug / KFZ',
      next_step: 'Probefahrt anbieten',
      qualify: 'Eintausch vorhanden? Wenn ja: Marke, Modell, Baujahr, KM abfragen fuer grobe Schaetzung. Finanzierung: Orientierung geben (Monatliche Rate ca. X EUR), Genaueres beim Termin.',
      value_args: 'Serviceheft lückenlos, TÜV/HU, Garantie, Kilometerstand, Unfallfreiheit, AHK, Ausstattung',
      buyer_types: 'Familie (Platz+Sicherheit), Gewerbe (Kapazität+Steuer), Einzelperson (Komfort+Status)'
    },
    industrial: {
      label: 'Maschine / Industrie',
      next_step: 'Maschinenvorführung / Besichtigung',
      qualify: 'Inzahlungnahme alte Maschine? Wann Produktionsstart geplant? Finanzierung?',
      value_args: 'Betriebsstunden, Wartungsprotokoll, Ersatzteilversorgung, CE-Konformität',
      buyer_types: 'Produktion (Kapazität+Ausfallsicherheit), Händler (Wiederverkauf), Handwerk (Vielseitigkeit)'
    },
    medical: {
      label: 'Medizintechnik',
      next_step: 'Demo-Termin oder Teststellung anbieten',
      qualify: 'Welche Anwendung genau? Wie viele Patienten/Behandlungen täglich? Zertifizierungsbedarf?',
      value_args: 'Kalibrierung aktuell, CE-Zertifikat, Herstellergarantie, Schulungsangebot',
      buyer_types: 'Praxis (Effizienz+Abrechnung), Klinik (Volumen+Wartung), Händler (Marge+Support)'
    },
    cosmetics: {
      label: 'Kosmetik / Beauty',
      next_step: 'Musterversand anbieten oder Zertifikate zusenden',
      qualify: 'B2B oder Endkunde? Mindestbestellmenge? Eigenmarke oder Weiterverkauf?',
      value_args: 'INCI-Liste, Zertifikate (bio/vegan/cruelty-free), Chargen-Dokumentation, Haltbarkeit',
      buyer_types: 'Salon (Weiterverkauf+Marge), Händler (Volumen+Exklusivität), Endkunde (Eigennutz+Qualität)'
    },
    standard: {
      label: 'Allgemein',
      next_step: 'Besichtigung oder weitere Informationen anbieten',
      qualify: 'Wofür wird das Produkt genutzt? Kaufbereit oder noch vergleichen?',
      value_args: 'Zustand, Vollständigkeit, Herkunft, besondere Eigenschaften',
      buyer_types: 'Privatperson (Eigennutz), Händler (Weiterverkauf), Gewerbe (Betriebsmittel)'
    }
  };
  return contexts[cat] || contexts['standard'];
}

// ── Helper: Verkaufsprinzipien als Prompt-Text ─────────────────────────
function vkSalesPrinciplesText() {
  return UNIVERSAL_SALES_PRINCIPLES.map(function(p){
    return p.label.toUpperCase() + ':\n' + p.text;
  }).join('\n\n');
}

async function vkAutoGenerateDNA(articleId, analysis, sessionAiMode) {
  try {
    const fetch = require('node-fetch');

    // ── 1. LPs für diesen Artikel laden ────────────────────────────────────
    const { data: lps } = await supabase.from('vk_landingpages')
      .select('id, ai_mode, anrede, sale_price')
      .eq('article_id', articleId)
      .eq('status', 'active');
    if (!lps || !lps.length) return;

    const an = analysis || {};

    // ── 2. Artikel-Daten laden: Fragen + Fotos + Dossier ───────────────────
    const { data: artData } = await supabase.from('vk_articles')
      .select('answers, questions, title')
      .eq('id', articleId)
      .single();
    const artAnswers = (artData && artData.answers) || {};
    const artQuestions = (artData && artData.questions) || [];

    // Fragen → verifizierte Fakten
    const faktenLines = artQuestions
      .filter(function(q){ return artAnswers[q.id] && q.id !== 'q_sonstige'; })
      .map(function(q){ return (q.label || q.id) + ': ' + artAnswers[q.id]; });
    if (artAnswers['q_extra']) faktenLines.push('Zusatz: ' + artAnswers['q_extra']);
    const faktenText = faktenLines.length
      ? '\nVERIFIZIERTE FAKTEN (vom Verkaeufer bestätigt – im Bot-Gesprach direkt verwenden):\n' + faktenLines.join('\n')
      : '';

    // Fotos laden (max 4 für DNA-Analyse, sichtbare zuerst)
    const { data: photos } = await supabase.from('vk_photos')
      .select('public_url, storage_path')
      .eq('article_id', articleId)
      .order('sort_order', { ascending: true })
      .limit(4);
    const photoUrls = (photos || []).map(function(p){ return p.public_url; }).filter(Boolean);

    // Dossier-Dokumente laden (Labels für DNA-Kontext)
    const { data: docs } = await supabase.from('vk_article_docs')
      .select('label, content_type, public_url')
      .eq('article_id', articleId);
    const dossierText = (docs && docs.length)
      ? '\nDOSSIER-DOKUMENTE (vorhanden – Bot kann auf Anfrage zusenden):\n' + docs.map(function(d){ return '- ' + d.label; }).join('\n')
      : '';

    // ── 3. Pro LP: DNA generieren ──────────────────────────────────────────
    for (const lp of lps) {
      try {
        const lpAiMode = lp.ai_mode || sessionAiMode || 'abteilungsleiter';
        const dnaModel = AI.dna;

        const productInfo = [
          an.title_short && 'Produkt: ' + an.title_short,
          an.short_desc && 'Beschreibung: ' + an.short_desc,
          an.condition && 'Zustand: ' + an.condition,
          (an.bullet_points||[]).length && 'Highlights: ' + an.bullet_points.join(' | '),
          lp.sale_price && 'Verkaufspreis: EUR ' + lp.sale_price,
          an.price_min && 'Marktpreis: EUR ' + an.price_min + ' – EUR ' + (an.price_max || ''),
        ].filter(Boolean).join('\n') + faktenText + dossierText;

        if (!productInfo.trim()) {
          console.log('vkAutoGenerateDNA: kein productInfo fuer Artikel', articleId);
          continue;
        }

        // Kategorie aus Analyse ermitteln
        const articleCategory = an.article_category || 'standard';
        const catCtx = vkGetCategoryContext(articleCategory);
        const salesPrinciples = vkSalesPrinciplesText();

        const dnaInstruction = 'Du bist Experte fuer Verkaufspsychologie und Copywriting.\n' +
          '\n=== ABSOLUTE REGEL: NUR VERIFIZIERTE FAKTEN ===\n' +
          'VERBOTEN: Eigenschaften, Ausstattung oder Serviceinformationen erwaehnen die NICHT in den untenstehenden Fakten stehen.\n' +
          'VERBOTEN: Wartungsbuch, Serviceheft, Zertifikate, Garantien oder andere Merkmale ohne expliziten Nachweis in den Fakten.\n' +
          'WENN ETWAS NICHT IN DEN FAKTEN STEHT: nicht erwaehnen, nicht erfinden, nicht ableiten.\n' +
          '\n=== UNIVERSELLE VERKAUFSPRINZIPIEN ===\n' +
          salesPrinciples + '\n' +
          '\n=== KATEGORIE: ' + catCtx.label + ' ===\n' +
          'Naechster Schritt: ' + catCtx.next_step + '\n' +
          'Qualifizierung: ' + catCtx.qualify + '\n' +
          'Kaeufertypen: ' + catCtx.buyer_types + '\n' +
          (dossierText ? '\nDOSSIER VERFUEGBAR: Bot kann Unterlagen auf Anfrage zusenden. Inhalte NUR aus den verifizierten Fakten verwenden.\n' : '') +
          '\nqa_pairs NUR aus verifizierten Fakten generieren - jede Antwort muss belegbar sein.\n' +
          '\nAntworte NUR mit JSON, kein Markdown:\n' +
          '{\n' +
          '  "bot_name": "passender Vorname",\n' +
          '  "product_story": "Geschichte in 2-3 Saetzen (warum ist das Produkt besonders)",\n' +
          '  "emotion": "Emotionaler Kern (2-3 Saetze – was bedeutet dieses Produkt dem Kaeufer)",\n' +
          '  "fomo": "Konkretes Knappheitsargument passend zur Kategorie",\n' +
          '  "persona": "Zielgruppe konkret beschreiben – passend zu den Kaeufertypen der Kategorie",\n' +
          '  "feature_benefits": [{"feature": "Konkretes Merkmal vom Foto/Fakten/Dossier", "benefit": "Nutzen fuer den Kaeufer"}],\n' +
          '  "product_values": [{"label": "Wertkategorie", "meaning": "Konkrete Bedeutung"}],\n' +
          '  "fomo_list": [{"situation": "Wann einsetzen", "argument": "Konkretes Knappheitsargument"}],\n' +
          '  "qa_pairs": [{"q": "Kaeufer-Frage zu verifizierten Fakten", "a": "Direkte Antwort mit Zahlen/Fakten"}],\n' +
          '  "exit_strategy_args": [{"label": "Bezeichnung", "argument": "Argument wenn kein weiterer Rabatt moeglich"}],\n' +
          '  "next_step_script": "Konkreter Satz um ' + catCtx.next_step + ' zu initiieren",\n' +
          '  "qualify_script": "Konkreter Satz fuer Qualifizierungsfrage: ' + catCtx.qualify.split('?')[0] + '",\n' +
          '  "notes": "Besondere Hinweise fuer den Bot max 2 Saetze"\n' +
          '}\n' +
          'Min. 4 feature_benefits, 3 product_values, 3 fomo_list, 4 qa_pairs, 3 exit_strategy_args. Sprache: Deutsch.';

        // Message-Content: Fotos + Text zusammenbauen
        let msgContent;
        if (photoUrls.length > 0) {
          // Mit Fotos: multimodal (URL-basiert via text block mit Foto-Listing + text prompt)
          // Fotos als base64 laden für Vision
          const photoBlocks = [];
          for (const url of photoUrls) {
            try {
              const imgRes = await fetch(url);
              const arrayBuffer = await imgRes.arrayBuffer();
              const base64 = Buffer.from(arrayBuffer).toString('base64');
              const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
              photoBlocks.push({ type: 'image', source: { type: 'base64', media_type: ct, data: base64 } });
            } catch(imgErr) {
              console.error('DNA foto laden fehler:', imgErr.message);
            }
          }
          msgContent = [
            ...photoBlocks,
            { type: 'text', text: '=== PRODUKT-INFORMATIONEN ===\n' + productInfo + '\n\n' + dnaInstruction }
          ];
        } else {
          // Ohne Fotos: nur Text
          msgContent = '=== PRODUKT-INFORMATIONEN ===\n' + productInfo + '\n\n' + dnaInstruction;
        }

        const dnaRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: dnaModel, max_tokens: 4000, messages: [{ role: 'user', content: msgContent }] })
        });
        const dnaData = await dnaRes.json();
        const dnaText = dnaData.content?.[0]?.text || '{}';
        const dnaClean = dnaText.replace(/```json|```/g, '').trim();
        const dna = JSON.parse(dnaClean);

        await supabase.from('vk_landingpages').update({ bot_config: dna }).eq('id', lp.id);
        console.log('DNA auto-generated for LP', lp.id, 'model:', dnaModel,
          'artikel:', an.title_short, 'fotos:', photoBlocks ? photoBlocks.length : 0,
          'fakten:', faktenLines.length, 'docs:', docs ? docs.length : 0);

        // ── DNA-Score berechnen (ohne DB-Spalten die noch nicht existieren) ──
        const dnaScore = (dna.qa_pairs || []).length + (dna.feature_benefits || []).length;
        const dnaComplete = faktenLines.length >= 2 && dnaScore >= 6;

        // ── Wenn unzureichend → Branchen-Fragen automatisch generieren ───
        if (!dnaComplete) {
          console.log('DNA score', dnaScore, '/ fakten', faktenLines.length, '→ auto-generate Fragen für Artikel', articleId);
          (async function genQuestions() {
            try {
              const { data: artCheck } = await supabase.from('vk_articles')
                .select('questions').eq('id', articleId).single();
              if (artCheck && artCheck.questions && artCheck.questions.length > 0) return; // Fragen schon da
              const cat = an.article_category || 'standard';
              const catHints = {
                vehicle:    'KM-Stand, TÜV bis, Vorbesitzer Anzahl, Serviceheft vorhanden, Unfallschäden, Motor/Getriebetyp, Farbe',
                industrial: 'Tragkraft, Betriebsstunden, letzte Wartung, Wartungsbuch vorhanden, Neupreis, Verkaufsgrund',
                luxury_watch:'Referenznummer, Box & Papers vorhanden, Servicehistorie, Kaufjahr, Neupreis',
                electronics:'Seriennummer/Modell, Kaufjahr, Zustand, Zubehör vollständig, Garantie aktiv',
                jewelry:    'Material/Legierung, Zertifikate vorhanden, Karat/Gewicht, Schätzwert',
                standard:   'Kaufjahr/Baujahr, Neupreis, Zustand genau beschreiben, Zubehör, Verwendung'
              };
              const catHint = catHints[cat] || catHints.standard;
              const fetch = require('node-fetch');
              const qRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'claude-haiku-4-5-20251001', max_tokens: 1500,
                  messages: [{ role: 'user', content:
                    'Erstelle branchen-spezifische Verkäufer-Fragen für: ' + (an.title_short || 'Artikel') + ' (Kategorie: ' + cat + ').\n' +
                    'Wichtige Informationen die fehlen könnten: ' + catHint + '\n' +
                    'Nur Fragen die auf Fotos NICHT sichtbar sind. Max 8 Fragen, direkt und konkret.\n' +
                    'JSON: {"questions":[{"id":"q_model","label":"Exakte Modellbezeichnung","placeholder":"z.B. Toyota 8FBE20","type":"text","important":true}]}\n' +
                    'type: text | number | yesno. important:true für die 3 wichtigsten Fragen.'
                  }]
                })
              });
              const qData = await qRes.json();
              const qText = qData.content?.[0]?.text || '{"questions":[]}';
              const qClean = qText.replace(/```json|```/g, '').trim();
              const qParsed = JSON.parse(qClean.substring(qClean.indexOf('{'), qClean.lastIndexOf('}')+1));
              let questions = qParsed.questions || [];
              if (!questions.find(function(q){ return q.id === 'q_model'; })) {
                questions.unshift({ id: 'q_model', label: 'Exakte Modellbezeichnung / Typ', placeholder: 'z.B. Toyota 8FBE20', type: 'text', important: true });
              }
              questions.push({ id: 'q_sonstige', label: 'Zusätzliche Informationen / Korrekturen', placeholder: 'Weitere wichtige Fakten...', type: 'text', important: false });
              await supabase.from('vk_articles').update({ questions }).eq('id', articleId);
              console.log('Auto-Branchen-Fragen generiert für Artikel', articleId, '(', questions.length, 'Fragen, Kategorie:', cat + ')');
            } catch(qErr) { console.error('Auto-Fragen Fehler:', qErr.message); }
          })();
        }
      } catch(lpErr) { console.error('DNA LP error:', lpErr.message); }
    }
  } catch(e) { console.error('vkAutoGenerateDNA error:', e.message); }
}

// Marktvergleich separat – wird NACH dem Speichern der Analyse aufgerufen
async function vkRunMarketSearch(articleId, title, phone) {
  try {
    const market = await vkMarketSearch(title, phone || '');
    const { data: current } = await supabase.from('vk_articles').select('analysis').eq('id', articleId).single();
    if (current && current.analysis) {
      const updated = Object.assign({}, current.analysis, { market_comparison: market });
      await supabase.from('vk_articles').update({ analysis: updated }).eq('id', articleId);
      // Plausibilitätsprüfung: Marktpreise müssen zum empfohlenen Preis passen
      const recPrice = updated.price_recommended || 0;
      if (recPrice > 0 && market.found && market.price_avg > 0) {
        const ratio = market.price_avg / recPrice;
        // Wenn Marktdurchschnitt mehr als 60% unter oder 50% über empfohlenem Preis → verwerfen
        if (ratio < 0.4 || ratio > 1.5) {
          console.warn('Market data implausible: avg=' + market.price_avg + ' vs recommended=' + recPrice + ' ratio=' + ratio);
          market = { found: false, note: 'Kein plausibler Marktvergleich gefunden.' };
          await supabase.from('vk_articles').update({ analysis: { ...updated, market_comparison: market } }).eq('id', articleId);
        }
      }
      console.log('Market search saved for article', articleId, '- found:', market.found);
      // DNA nach Markt-Suche generieren (Analyse + Marktdaten komplett)
      vkAutoGenerateDNA(articleId, updated, null).catch(function(e){ console.error('DNA after market:', e.message); });
    }
  } catch(e) {
    console.error('vkRunMarketSearch error:', e.message);
  }
}

// ── VK ENDPOINTS ───────────────────────────────────────────


// ── FRAGEKATALOG: Schritt 1 nach Erstanalyse ────────────────────────────
app.get('/api/vk/article/:id/questions', async (req, res) => {
  try {
    const { data: article } = await supabase.from('vk_articles')
      .select('id, title, analysis, article_category, questions, answers').eq('id', req.params.id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    // Bereits generierte Fragen zurückgeben - aber Pflichtfelder immer sicherstellen
    if (article.questions && article.questions.length > 0) {
      let qs = article.questions;
      // q_model immer als erstes Feld
      if (!qs.find(function(q){ return q.id === 'q_model'; })) {
        qs = [{ id: 'q_model', label: 'Exakte Modellbezeichnung / Typ', placeholder: 'z.B. Jungheinrich EFG 316, Toyota 8FBE20', type: 'text', important: true }].concat(qs);
      }
      // q_sonstige immer als letztes Feld
      if (!qs.find(function(q){ return q.id === 'q_sonstige'; })) {
        qs = qs.concat([{ id: 'q_sonstige', label: 'Zusätzliche Informationen / Korrekturen', placeholder: 'z.B. Tragkraft 2,4t statt 4,5t, Farbe blau, Baujahr 1998...', type: 'text', important: false }]);
      }
      return res.json({ questions: qs, answers: article.answers || {} });
    }

    const an = article.analysis || {};
    const cat = article.article_category || an.article_category || 'standard';
    const fetch = require('node-fetch');

    // Kategorie-spezifische Basis-Fragen
    const catPrompts = {
      vehicle:    'Fahrzeug/Kfz: KM-Stand, Baujahr, TÜV bis, Vorbesitzer, Serviceheft, Unfallschäden, Motor/Getriebe Zustand',
      industrial: 'Industriemaschine: Tragkraft, Hubhöhe, Baujahr, Betriebsstunden, letzte Wartung, Wartungsbuch, Neuanschaffungspreis, Verkaufsgrund',
      luxury_watch:'Luxusuhr: Referenznummer, Baujahr/Kaufdatum, Box & Papers vorhanden, Servicehistorie, Laufzeit/Ganggenauigkeit, Neupreis',
      electronics:'Elektronik: Modellnummer/Seriennummer, Kaufjahr, Zustand Display/Gehäuse, originales Zubehör, Garantie noch aktiv, Neupreis',
      jewelry:    'Schmuck: Material/Legierung, Zertifikate vorhanden, Herkunft, Schätzwert, Zustand Fassung/Steine',
      art:        'Kunst/Antiquität: Künstler/Hersteller, Entstehungsjahr, Provenienz, Zertifikate/Gutachten, Schätzwert',
      standard:   'Allgemein: Baujahr/Kaufjahr, Neupreis, Zustand Details, Zubehör, Verwendung, Verkaufsgrund'
    };
    const catHint = catPrompts[cat] || catPrompts.standard;

    const prompt = 'Du bist ein Verkaufsexperte. Erstelle einen Fragekatalog fuer: ' + (an.title_short || article.title || 'Artikel') + ' (Kategorie: ' + cat + ').\n\nPFLICHT: Die ersten 2 Fragen IMMER:\n1. Exakte Modellbezeichnung / Typ (id: q_model, important: true)\n2. Baujahr / Erstzulassung (id: q_year, important: true)\n\nDann max 6 weitere kategoriespezifische Fragen: ' + catHint + '\nNur Fragen die auf Fotos NICHT sichtbar sind.\n\nJSON: {"questions":[{"id":"q_model","label":"Exakte Modellbezeichnung / Typ","placeholder":"z.B. Toyota 8FBE20, Jungheinrich EFG 316","type":"text","important":true}]}\ntype: text|number|yesno. important:true fuer die 3 wichtigsten.';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const text = d.content?.[0]?.text || '{"questions":[]}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}')+1));
    let questions = parsed.questions || [];
    // Sonstige Informationen / Korrekturen immer am Ende
    const hasModel = questions.some(function(q){ return q.id === 'q_model'; });
    if (!hasModel) {
      questions.unshift({ id: 'q_model', label: 'Exakte Modellbezeichnung / Typ', placeholder: 'z.B. Toyota 8FBE20, Jungheinrich EFG 316', type: 'text', important: true });
    }
    questions.push({
      id: 'q_sonstige',
      label: 'Sonstige Angaben / Korrekturen der KI-Analyse',
      placeholder: 'z.B. Tragkraft 2,4t statt 4,5t, Farbe blau, Baujahr 1998...',
      type: 'text',
      important: false
    });

    await supabase.from('vk_articles').update({ questions }).eq('id', req.params.id);
    // Aus Analyse vorbelegen
    const prefilled = Object.assign({}, article.answers || {});
    const anData = article.analysis || {};
    if (!prefilled.q_condition && anData.condition) prefilled.q_condition = anData.condition;
    if (!prefilled.q_model && anData.title_short) prefilled.q_model = anData.title_short;
    const descTxt = (anData.short_desc||'') + ' ' + (anData.long_desc||'');
    const kmM = descTxt.match(/([0-9]{1,3}[.,][0-9]{3})\s*km/i);
    if (kmM && !prefilled.q_km) prefilled.q_km = kmM[1].replace('.','').replace(',','');
    res.json({ questions, answers: prefilled });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ANTWORTEN SPEICHERN ──────────────────────────────────────────────────

// ── HIDDEN PHOTOS FÜR BOT FREIGEBEN ─────────────────────────────────────
app.post('/api/vk/article/:id/bot-share-hidden', async (req, res) => {
  try {
    const { enabled } = req.body;
    await supabase.from('vk_articles').update({ bot_share_hidden: !!enabled }).eq('id', req.params.id);
    res.json({ success: true, bot_share_hidden: !!enabled });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/article/:id/answers', async (req, res) => {
  try {
    const { answers } = req.body;
    await supabase.from('vk_articles').update({ answers }).eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ANALYSE SCHRITT 2: Mit Antworten optimieren ──────────────────────────
app.post('/api/vk/article/:id/analyze-step2', async (req, res) => {
  try {
    const { einspruch } = req.body || {};
    const { data: article } = await supabase.from('vk_articles')
      .select('*, vk_photos(*), analysis, questions, answers').eq('id', req.params.id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    const fetch = require('node-fetch');
    const an = article.analysis || {};
    const answers = article.answers || {};
    const questions = article.questions || [];
    const correctionRound = (an.correction_round || 0) + 1;

    // Einspruch hat ABSOLUT HÖCHSTE PRIORITÄT - überschreibt alles
    const einspruchText = einspruch ? einspruch.trim() : '';
    if (einspruchText && answers) {
      // Einspruch auch in answers speichern für DNA-Generierung
      answers['q_sonstige'] = (answers['q_sonstige'] ? answers['q_sonstige'] + ' | ' : '') + einspruchText;
      await supabase.from('vk_articles').update({ answers }).eq('id', req.params.id);
    }

    // Antworten als Text aufbereiten
    const sonstige = answers['q_sonstige'] || '';
    const extraKV = answers['q_extra'] || '';
    const answersText = (einspruchText ? '=== EINSPRUCH KUNDE – ABSOLUT KORREKT, ÜBERSCHREIBT ALLES ===\n' + einspruchText + '\n=== ENDE EINSPRUCH ===\n\n' : '')
      + (sonstige && sonstige !== einspruchText ? 'WEITERE KORREKTUREN: ' + sonstige + '\n' : '')
      + (extraKV ? 'ZUSAETZLICHE ANGABEN: ' + extraKV + '\n\n' : '')
      + questions
      .filter(q => answers[q.id] && answers[q.id] !== '')
      .map(q => q.label + ': ' + answers[q.id])
      .join('\n');

    // Fotos laden
    const imageBlocks = [];
    for (const p of (article.vk_photos || [])) {
      try {
        const imgRes = await fetch(p.public_url);
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: ct, data: imgBuf.toString('base64') } });
      } catch(e) { console.error('img load:', e.message); }
    }

    const prompt = 'Optimierter Verkaufsbericht. VERKAEUFER-ANGABEN haben hoechste Prioritaet - ueberschreiben alles:\n' + (answersText || 'keine') + '\n\nALTE ANALYSE (NUR als Basis, wird ueberschrieben wenn Verkaeufer andere Angaben macht):\nTitel alt: ' + (an.title_short||'') + ', Zustand: ' + (an.condition||'') + '\n\nWICHTIG: Wenn Verkaeufer-Angaben Modell/Typ enthalten → ALLE Titelfelder (title_short, title_long, title_quicksale) NEU generieren mit korrektem Modell.\nJSON mit ALLEN Feldern vollstaendig ausfuellen:\n'
      + '{"title_short":"Kurztitel max 60Z mit korrektem Modell","title_long":"Ausfuehrl. Titel mit Specs","title_quicksale":"Kurztitel Schnellverkauf max 50Z","article_category":"vehicle/industrial/etc","short_desc":"2-3 Saetze","long_desc":"Beschreibung mit Specs","bullet_points":["Highlight1","Highlight2"],"price_min":0,"price_max":0,"price_recommended":0,"price_unknown":false,"price_reasoning":"Begruendung","condition":"Zustand","keywords":["kw1"],"tips":["Tipp1"]}';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI.analysis,
        max_tokens: 3000,
        system: 'Du bist Verkaufstexter. Erstelle verkaufsoptimierte Texte basierend auf echten Verkaeufer-Angaben. Keine Halluzinationen. Antworte NUR mit JSON. Halte Texte kompakt - max 3 Saetze pro Feld.',
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });
    const text = data.content?.[0]?.text || '{}';
    let analysis;
    try { 
      const clean = text.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('Kein JSON-Block in Antwort');
      // Wenn JSON abgeschnitten: versuche zu reparieren
      let jsonStr = jsonEnd !== -1 ? clean.substring(jsonStart, jsonEnd+1) : clean.substring(jsonStart) + '}';
      try { analysis = JSON.parse(jsonStr); }
      catch(e2) { 
        // Letztes vollständiges Feld finden und JSON schließen
        const lastComma = jsonStr.lastIndexOf(',"');
        if (lastComma > 0) { jsonStr = jsonStr.substring(0, lastComma) + '}'; }
        analysis = JSON.parse(jsonStr);
      }
    } catch(e) { return res.status(500).json({ error: 'JSON Parse Fehler: ' + e.message + ' (Antwort: ' + text.substring(0,100) + ')' }); }

    // Marktsuche mit echten Daten starten
    const searchTitle = analysis.title_short || an.title_short || article.title;
    // Neue Analyse gewinnt immer - alte Daten werden überschrieben
    const mergedAnalysis = { ...an, ...analysis };
    if (analysis.title_short) mergedAnalysis.title_short = analysis.title_short;
    if (analysis.title_long) mergedAnalysis.title_long = analysis.title_long;
    if (analysis.title_quicksale) mergedAnalysis.title_quicksale = analysis.title_quicksale;
    if (analysis.short_desc) mergedAnalysis.short_desc = analysis.short_desc;
    if (analysis.long_desc) mergedAnalysis.long_desc = analysis.long_desc;
    if (analysis.condition) mergedAnalysis.condition = analysis.condition;
    // Marktvergleich immer löschen - wird neu generiert mit korrektem Modell
    delete mergedAnalysis.market_comparison;

    // correction_round tracken
    mergedAnalysis.correction_round = correctionRound;
    if (einspruchText) mergedAnalysis.last_einspruch = einspruchText;
    if (correctionRound >= 3) mergedAnalysis.needs_escalation = true;
    const step2Update = { analysis: mergedAnalysis, status: 'analyzed' };
    // article.title mit neuem Kurztitel synchronisieren
    if (mergedAnalysis.title_short) step2Update.title = mergedAnalysis.title_short;
    await supabase.from('vk_articles').update(step2Update).eq('id', req.params.id);

    if (searchTitle) vkRunMarketSearchV2(req.params.id, searchTitle, article.article_category, answers).catch(e => console.error('Market v2:', e.message));

    // DNA nach Step2 automatisch neu generieren (mit korrigierten Daten)
    vkAutoGenerateDNA(req.params.id, mergedAnalysis, article.ai_mode || 'abteilungsleiter').catch(e => console.error('DNA step2:', e.message));

    res.json({ success: true, analysis });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── ARTIKEL DOKUMENTE (PDFs + Links) ─────────────────────────────────────
app.get('/api/vk/article/:id/docs', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_article_docs')
      .select('*').eq('article_id', req.params.id).order('created_at');
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/article/:id/doc', async (req, res) => {
  try {
    const { type, label, url, file_base64, file_name, content_type, session_id } = req.body;
    if (!type || !label) return res.status(400).json({ error: 'type und label erforderlich' });

    let publicUrl = url || null;
    let storagePath = null;

    // PDF hochladen
    if (type === 'pdf' && file_base64) {
      const buffer = Buffer.from(file_base64, 'base64');
      const ext = (file_name || 'doc.pdf').split('.').pop() || 'pdf';
      const path = req.params.id + '/' + Date.now() + '.' + ext;
      const { error: upErr } = await supabase.storage.from('vk-docs')
        .upload(path, buffer, { contentType: content_type || 'application/pdf', upsert: false });
      if (upErr) return res.status(400).json({ error: upErr.message });
      const { data: urlData } = supabase.storage.from('vk-docs').getPublicUrl(path);
      publicUrl = urlData.publicUrl;
      storagePath = path;
    }

    // TXT / Notiz hochladen
    if (type === 'note' && file_base64) {
      const textContent = Buffer.from(file_base64, 'base64').toString('utf-8');
      // Als URL speichern wir den Text-Inhalt direkt (max 5000 Zeichen)
      publicUrl = textContent.substring(0, 5000);
    }

    const { data, error } = await supabase.from('vk_article_docs').insert({
      article_id: req.params.id,
      session_id: session_id || null,
      type, label,
      public_url: publicUrl,
      storage_path: storagePath,
      file_name: file_name || null
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, doc: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vk/doc/:id', async (req, res) => {
  try {
    const { data: doc } = await supabase.from('vk_article_docs')
      .select('storage_path').eq('id', req.params.id).single();
    if (doc?.storage_path) {
      await supabase.storage.from('vk-docs').remove([doc.storage_path]);
    }
    await supabase.from('vk_article_docs').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/session', async (req, res) => {
  try {
    const { phone, media_id, customer_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone erforderlich' });
    const token = generateToken();
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


// ── RETRIGGER ANALYSE für ausstehende Artikel ────────────────────────────

// Session auf done setzen (wenn Frontend erkennt dass alle Artikel fertig)
app.post('/api/vk/session-done/:token', async (req, res) => {
  try {
    await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString() }).eq('token', req.params.token);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/retrigger-analysis', async (req, res) => {
  try {
    const { article_id, token } = req.body;
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const { data: article } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('id', article_id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    if (!(article.vk_photos||[]).length) return res.status(400).json({ error: 'Keine Fotos vorhanden' });

    res.json({ success: true, message: 'Analyse gestartet' });

    // Analyse im Hintergrund
    (async () => {
      try {
        const analysis = await vkAnalyzeArticle(article, article.vk_photos, session.phone);
        const comp = analysis.compliance || {};
        if (!analysis.title_short || analysis.error) {
          console.error('Retrigger: invalid analysis, not saving:', JSON.stringify(analysis).substring(0,100));
          return;
        }
        await supabase.from('vk_articles').update({
          analysis, status: 'analyzed',
          article_category: analysis.article_category || 'standard',
          title: analysis.title_short || article.title,
          compliance_status: comp.blocked ? 'blocked' : (comp.category <= 2 ? 'needs_review' : 'approved'),
          compliance_category: comp.category || 3
        }).eq('id', article_id);
        // Session auf done setzen wenn alle Artikel fertig
        const { data: arts } = await supabase.from('vk_articles').select('id, status').eq('session_id', session.id);
        const allDone = (arts||[]).every(a => a.status === 'analyzed');
        if (allDone) {
          await supabase.from('vk_sessions').update({ status: 'done', analyzed_at: new Date().toISOString() }).eq('id', session.id);
        }
        if (analysis.title_short) {
          vkRunMarketSearch(article_id, analysis.title_short, session.phone).catch(e => console.error('Market retrigger:', e.message));
        }
        console.log('Retrigger analysis done for article', article_id);
      } catch(e) { console.error('Retrigger error:', e.message); }
    })();
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
// ══════════════════════════════════════════════════════
// IN server.js EINFÜGEN – direkt nach:
//   app.delete('/api/vk/article/:id', async (req, res) => { ... });
// ══════════════════════════════════════════════════════

app.put('/api/vk/photo/:photoId/move', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { article_id } = req.body;
    if (!article_id) return res.status(400).json({ error: 'article_id fehlt' });
    const { error } = await supabase.from('vk_photos')
      .update({ article_id })
      .eq('id', photoId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    console.error('Photo move error:', e);
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/vk/photo', async (req, res) => {
  try {
    const { article_id, session_id, image_base64, content_type } = req.body;
    if (!article_id || !image_base64) return res.status(400).json({ error: 'article_id und image_base64 erforderlich' });
    const { data: existing } = await supabase.from('vk_photos').select('id').eq('article_id', article_id);
    if ((existing?.length || 0) >= 99) return res.status(400).json({ error: 'Maximal 4 Fotos pro Artikel' });
    const ext = (content_type || 'image/jpeg').includes('png') ? 'png' : 'jpg';
    const path = `${session_id}/${article_id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(image_base64, 'base64');
    const { error: upErr } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType: content_type || 'image/jpeg', upsert: false });
    if (upErr) return res.status(400).json({ error: upErr.message });
    const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
    // Warnung wenn AVIF - Claude kann es nicht analysieren
   if (content_type && content_type.includes('avif')) {
      console.warn('AVIF upload detected - analysis may fail. Recommend converting to JPG/PNG first.');
      return res.status(400).json({ error: 'AVIF-Format wird nicht unterstützt. Bitte Fotos als JPG oder PNG hochladen.' });
    }
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
    // Kein ai_mode mehr — alle Artikel mit AI.analysis (Opus)
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
    const checkout = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card'], line_items: [{ price_data: { currency: 'eur', product_data: { name: 'Verkaufsreport – ' + enriched.length + ' Artikel', description: enriched.map(function(a){ return a.title || 'Artikel'; }).join(', ') }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }], metadata: { vk_token: token, vk_session_id: session.id }, success_url: 'https://converdino.com/bericht.html?s=' + token + '&paid=1', cancel_url: 'https://converdino.com/bericht.html?s=' + token });
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
          const comp = analysis.compliance || {};
const auth = analysis.authenticity || {};
const authScore = (auth && auth.score !== null && auth.score !== undefined) ? auth.score : null;
const AUTH_CATS = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
const needsAuthReview = authScore !== null && authScore < 60 && AUTH_CATS.includes(analysis.article_category || '');
const articleUpdate = {
  analysis,
  status: 'analyzed',
  article_category: analysis.article_category || 'standard',
  compliance_status: comp.blocked ? 'blocked'
    : (comp.category <= 2 || needsAuthReview) ? 'needs_review' : 'approved',
  compliance_category: comp.category || 3,
  compliance_flags: comp.flags || [],
  compliance_blocked_reason: comp.reason || null,
  authenticity_score: authScore,
  authenticity_verdict: auth.verdict || null,
  authenticity_flags: auth.flags || [],
  authenticity_warning: auth.warning || null
};
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
  // Kein Browser-Cache - immer frische Daten
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  try {
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (!['done', 'analyzing'].includes(session.status)) return res.status(400).json({ error: 'Analyse noch nicht abgeschlossen', status: session.status });
    const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id).order('sort_order', { ascending: true });
    if (!session.result_viewed_at) await supabase.from('vk_sessions').update({ result_viewed_at: new Date().toISOString() }).eq('id', session.id);
    res.json({ ...session, articles: articles || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/admin/sessions', async (req, res) => { try { const { data, error } = await supabase.from('vk_sessions').select('*, vk_articles(id, title, status, extended, compliance_status, compliance_category, compliance_flags, compliance_blocked_reason, authenticity_score, authenticity_verdict, admin_verified, article_category)').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });

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

// ── VERIFIZIERTE FAKTEN ALS TEXT ─────────────────────────────────────────
function buildVerifiedFactsText(artData) {
  if (!artData) return '';
  const answers = artData.answers || {};
  const questions = artData.questions || [];
  const lines = [];
  questions.filter(q => answers[q.id] && answers[q.id] !== '' && q.id !== 'q_sonstige')
    .forEach(q => lines.push((q.label || q.id) + ': ' + answers[q.id]));
  const extra = answers['q_extra'] || '';
  if (extra) {
    extra.replace(/\|\|\|/g,',').split(',').forEach(pair => {
      const trimmed = pair.trim();
      if (trimmed.length > 3 && trimmed.includes(':')) lines.push(trimmed);
    });
  }
  if (answers['q_sonstige']) lines.push('Korrektur: ' + answers['q_sonstige']);
  return lines.join('\n');
}

// ── LP BOT: Konversations-Speicher (In-Memory) ──────────

// ── BOT GOAL: Ziel-spezifische Prompt-Blöcke ────────────────────────────
function vkBotGoalPrompt(lp, anrede) {
  const s = anrede === 'du';
  const minPreis = (lp && lp.min_price) || 0;
  const preis = (lp && lp.sale_price) || 0;
  const vkName = (lp && lp._escalation_title) || 'unseren Verkaufsexperten';
  const standort = (lp && lp.bot_config && lp.bot_config.location) || '';

  // Prioritäts-Reihenfolge aus bot_goal (Array oder String)
  let goalRaw = (lp && lp.bot_goal) || 'direktkauf';
  let goals = [];
  try {
    if (typeof goalRaw === 'string' && goalRaw.startsWith('[')) {
      goals = JSON.parse(goalRaw);
    } else if (typeof goalRaw === 'string') {
      goals = goalRaw.split(',').map(function(g){ return g.trim(); });
    } else if (Array.isArray(goalRaw)) {
      goals = goalRaw;
    }
  } catch(e) { goals = [goalRaw]; }
  if (!goals.length) goals = ['direktkauf'];

  // Beschreibungen pro Ziel
  const goalDescriptions = {
    direktkauf: 'Direktverkauf: Zahlungslink senden. Trigger: "ZAHLUNG_LINK:' + preis + '"',
    besichtigung: 'Probefahrt/Praesentation: Termin vereinbaren. Kaeufer-Telefon bereits bekannt via WhatsApp. Trigger: "TERMIN_ANFRAGE:[name]:[phone]:[datum]" (phone = WhatsApp-Nummer)' + (standort ? ' Standort: ' + standort : ''),
    information: 'Information: Unterlagen/Details zusenden. Dossier per E-Mail: "DOSSIER_SENDEN:[email]"',
    kontakt: 'Rueckruf: Name + Telefon + Zeit sammeln. Trigger: "KONTAKT_ANFRAGE:[name]:[tel]:[zeit]"',
    angebot: 'Angebot/Inzahlungnahme: Anforderungen sammeln, dann KONTAKT_ANFRAGE',
    leasing: 'Finanzierung: ca. ' + Math.round(preis/60) + '-' + Math.round(preis/36) + ' EUR/Monat, Beratungsgespraech vereinbaren'
  };

  let priorityBlock = '\n=== DEINE ZIEL-PRIORITAETEN ===\n';
  priorityBlock += 'Arbeite in dieser Reihenfolge. Wenn Prioritaet 1 nicht klappt → zu 2, usw.\n\n';
  goals.forEach(function(g, i) {
    const desc = goalDescriptions[g] || g;
    priorityBlock += 'PRIORITAET ' + (i+1) + ': ' + desc + '\n';
  });

  priorityBlock += '\nWIE DU VORGEHST:\n';
  priorityBlock += '- Versuche immer zuerst Prioritaet 1\n';
  priorityBlock += '- Wenn Kaeufer ablehnt oder kein Interesse zeigt → biete Prioritaet 2 an\n';
  priorityBlock += '- Nie mehrere Optionen gleichzeitig anbieten - immer eine nach der anderen\n';
  priorityBlock += '- Bei Preisverhandlung: erst Prioritaet 1 (Direktkauf) voll ausschoepfen\n';
  if (goals[0] === 'direktkauf') {
    priorityBlock += '\nDIREKTKAUF-REGEL: Unter ' + Math.max(minPreis, Math.round(preis * 0.92)) + ' EUR nicht gehen. Preis vereinbart → NUR "ZAHLUNG_LINK:[BETRAG]"\n';
  }
  if (!goals.includes('direktkauf') || goals.indexOf('direktkauf') > 0) {
    priorityBlock += '\nKEIN Zahlungslink wenn Direktkauf nicht in Prioritaet 1.\n';
  }

  return priorityBlock;
}

// ── NEUE TRIGGER: Kontakt + Termin ────────────────────────────────────────
async function vkHandleBotTriggers(reply, phone, session) {
  const lp = session.lp || {};

  // Platzhalter [kaeufer-wa-nummer] durch echte Nummer ersetzen
  reply = reply.replace(/\[kaeufer-wa-nummer\]/g, phone);

  // Kontakt-Anfrage (Rueckruf)
  const km = reply.match(/KONTAKT_ANFRAGE:([^:]+):([^:]+):(.+)/);
  if (km) {
    const [, name, tel, zeit] = km;
    const an = lp.vk_articles?.analysis || {};
    try { await supabase.from('vk_escalations').insert({ lp_id: lp.id||null, article_id: lp.article_id||null, lp_slug: lp.slug||session.lpSlug||'', article_title: an.title_short||'', buyer_phone: phone, buyer_contact_type: 'Telefon', buyer_contact: tel.trim(), buyer_availability: zeit.trim(), status: 'new' }); } catch(e) {}
    await vkSendEscalationEmailV2(lp, { name: name.trim(), contact: tel.trim(), availability: zeit.trim(), type: 'Rückruf' });
    const msg = (lp.anrede==='du') ? 'Danke ' + name.trim() + '! Deine Nummer ist notiert. ' + (lp._escalation_title||'Wir') + ' melden uns ' + zeit.trim() + '.' : 'Danke ' + name.trim() + '! Ihre Nummer ist notiert. ' + (lp._escalation_title||'Wir') + ' melden sich ' + zeit.trim() + '.';
    await vkSendWhatsApp(phone, msg);
    return true;
  }

  // Termin-Anfrage (Besichtigung)
  const tm = reply.match(/TERMIN_ANFRAGE:([^:]+):([^:]+):(.+)/);
  if (tm) {
    const [, name, telRaw, datum] = tm;
    const tel = telRaw && telRaw.length > 5 ? telRaw : phone; // Fallback: WhatsApp-Nummer
    const an = lp.vk_articles?.analysis || {};
    try { await supabase.from('vk_escalations').insert({ lp_id: lp.id||null, article_id: lp.article_id||null, lp_slug: lp.slug||session.lpSlug||'', article_title: an.title_short||'', buyer_phone: phone, buyer_contact_type: 'Besichtigung', buyer_contact: tel.trim(), buyer_availability: datum.trim(), status: 'new' }); } catch(e) {}
    await vkSendEscalationEmailV2(lp, { name: name.trim(), contact: tel.trim(), availability: datum.trim(), type: 'Besichtigung' });
    const msg = (lp.anrede==='du') ? 'Super ' + name.trim() + '! Besichtigungswunsch für ' + datum.trim() + ' ist notiert. Wir bestätigen kurz.' : 'Sehr gut ' + name.trim() + '! Besichtigungswunsch für ' + datum.trim() + ' notiert. Wir bestätigen kurzfristig.';
    await vkSendWhatsApp(phone, msg);
    return true;
  }
  return false;
}

async function vkSendEscalationEmailV2(lp, contact) {
  try {
    let sellerEmail = lp._seller_email || null;
    if (!sellerEmail && lp.session_id) {
      const { data: s } = await supabase.from('vk_sessions').select('business_discount_id').eq('id', lp.session_id).maybeSingle();
      if (s?.business_discount_id) { const { data: bd } = await supabase.from('vk_business_discounts').select('seller_email').eq('id', s.business_discount_id).maybeSingle(); if (bd?.seller_email) sellerEmail = bd.seller_email; }
    }
    if (!sellerEmail) return;
    const fetch = require('node-fetch');
    const an = lp.vk_articles?.analysis || {};
    const artikel = an.title_short || lp.vk_articles?.title || 'Artikel';
    const icon = contact.type === 'Besichtigung' ? '📅' : '📞';
    const html = '<div style="font-family:Arial;max-width:520px;padding:20px;"><div style="background:#1b4332;color:#fff;padding:16px;border-radius:8px 8px 0 0;font-weight:800;">' + icon + ' ' + contact.type + ': ' + artikel + '</div><div style="border:1px solid #e5e7eb;padding:16px;border-radius:0 0 8px 8px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="padding:6px;font-weight:700;">Name</td><td style="padding:6px;">' + contact.name + '</td></tr><tr style="background:#f9fafb;"><td style="padding:6px;font-weight:700;">Kontakt</td><td style="padding:6px;font-weight:700;color:#1b4332;font-size:1.05rem;">' + contact.contact + '</td></tr><tr><td style="padding:6px;font-weight:700;">' + (contact.type==='Besichtigung'?'Wunschtermin':'Erreichbar') + '</td><td style="padding:6px;">' + contact.availability + '</td></tr></table><div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:10px;margin-top:12px;font-size:.85rem;">⏰ Bitte zeitnah melden — Interesse ist aktuell hoch.</div></div></div>';
    await fetch('https://api.resend.com/emails', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.RESEND_API_KEY}, body:JSON.stringify({ from:'Converdino <noreply@converdino.com>', to:sellerEmail, subject:icon+' '+contact.type+': '+artikel, html }) });
  } catch(e) { console.error('EscEmailV2:', e.message); }
}

const vkLPBotSessions = new Map(); // phone → { lpSlug, messages[], article, lp }
const vkLPBotRecovery = new Map(); // phone → { lpSlug, phoneId, ts } — für Wiedererweckung nach Session-Ende

async function vkCheckActiveLPBot(phone) {
  if (vkLPBotSessions.has(phone)) return true;
  // Recovery: gibt es eine kürzliche Session für diese Nummer?
  const rec = vkLPBotRecovery.get(phone);
  if (rec && (Date.now() - rec.ts) < 24 * 60 * 60 * 1000) return 'recover';
  return false;
}

async function vkHandleLPBot(phone, text, lpSlug, phoneId) {
  const fetch = require('node-fetch');

  // LP + Artikel aus DB laden
  const { data: lp } = await supabase.from('vk_landingpages')
    .select('*, vk_articles(title, analysis, vk_photos(public_url)), bot_goal, anrede, min_price, sale_price, bot_config, ai_mode')
    .eq('slug', lpSlug).maybeSingle();

  if (!lp) {
    await vkSendWhatsApp(phone, 'Dieses Angebot ist leider nicht mehr verfügbar.');
    return;
  }

  const article = lp.vk_articles || {};
  const an = article.analysis || {};
  const price = parseFloat(lp.sale_price || an.price_recommended || 0);
  const minPrice = parseFloat(lp.min_price || price * 0.8);

  // System Prompt mit Artikel-Kontext
  const aggrLevel = lp.negotiation_level || 'professional';
  const aggrMap = {
    friendly:     { label: 'freundlich', maxDiscount: 0.10, patience: 4 },
    professional: { label: 'professionell', maxDiscount: 0.06, patience: 3 },
    hard:         { label: 'hart', maxDiscount: 0.03, patience: 2 }
  };
  const aggr = aggrMap[aggrLevel] || aggrMap.professional;
  const maxDiscount = Math.round(price * aggr.maxDiscount);
  const absoluteMin = Math.max(minPrice, price - maxDiscount);
const botConfig = lp.bot_config || {};
const systemPrompt = `Du bist ${botConfig.bot_name_override || botConfig.bot_name || 'ein Verkaufsassistent'}.
${(function(){ const ctx = botConfig.context || (lp.ai_mode !== 'sachbearbeiter' ? 'haendler' : 'privat'); return ctx === 'privat' ? 'Du verkaufst dein eigenes Stueck privat - mit echter Verbindung zum Produkt. Kein Rueckgaberecht fuer Kaeufer (Privatverkauf).' : ctx === 'haendler' ? 'Du bist ein professioneller Haendler - kennst dein Sortiment und stehst fuer Qualitaet.' : ctx === 'geschaeft' ? 'Du repraesentierst ein Unternehmen - professionell und kompetent.' : ctx === 'nachlass' ? 'Du loest einen Nachlass auf - respektvoll und sachlich.' : 'Du bist ein erfahrener Verkaeufer.'; })()}
Du beherrschst professionelle Verkaufstechniken - wirkst aber wie ein echter Mensch.

ANREDE: Spreche den Kaeufer ausschliesslich mit "${lp.anrede === 'du' ? 'du/dein/dir' : 'Sie/Ihr/Ihnen'}" an.
${lp.anrede === 'du' ? 'Niemals "Sie" verwenden.' : 'Niemals "du/dein/dir" verwenden. Immer "Sie/Ihr/Ihnen".'} Diese Regel gilt absolut.

SPRACHE & TON:
Schreibe korrektes, natuerliches Deutsch. Keine Anglizismen, kein Jugendslang.
VERBOTEN: "wearable", "Evergreen", "mega", "voll [Adjektiv]", "das Teil", "cool", "nice", "okay so", "basically"
RICHTIG: "tragbar" statt "wearable" | "zeitlos" statt "Evergreen" | "sehr" statt "mega/voll" | "das Kleid/Stueck" statt "das Teil"
Ton: freundlich-professionell wie ein guter Verkaeufer - nicht wie ein Teenager, nicht wie ein Callcenter-Skript.
Saetze vollstaendig und grammatikalisch korrekt. Keine halben Saetze.

KAEUFER-KONTAKT: Der Kaeufer ist per WhatsApp erreichbar - die Nummer ist bekannt.
→ Rueckruf-Anfrage: "Soll ich ${lp.anrede === 'du' ? 'dich' : 'Sie'} auf dieser WhatsApp-Nummer zurueckrufen oder ${lp.anrede === 'du' ? 'hast du' : 'haben Sie'} eine andere?" - NIE nach Nummer fragen die schon bekannt ist.
→ Trigger mit Kaeufer-Nummer: verwende "[kaeufer-wa-nummer]" - die echte Nummer wird automatisch eingesetzt.

EINTAUSCH (wenn Kaeufer Eintausch erwaehnt):
1. "Ja, das ist moeglich - welches Fahrzeug, Baujahr und ungefaehre KM?"
2. IMMER grobe Orientierung geben: "Ein [Modell] Baujahr [X] mit [KM] liegt am Markt grob bei EUR X-Y"
3. Dann: "Den genauen Wert bestimmen wir beim Besichtigungstermin - da schaut sich mein Kollege beides an"
VERBOTEN: Eintausch ablehnen oder nur auf Termin verweisen ohne Orientierung.

WISSENSLUECKEN (wenn du eine Detail-Frage nicht beantworten kannst):
NIEMALS sofort zum Rueckruf/Eskalation springen weil du etwas nicht weisst.
RICHTIG - 3 Schritte:
1. Ehrlich: "${lp.anrede==='du'?'Ehrlich gesagt habe ich das gerade nicht zur Hand':'Ehrlich gesagt habe ich das gerade nicht zur Hand'}"
2. Lösung: "Das klaere ich fuer ${lp.anrede==='du'?'dich':'Sie'} ab - ich oder ein Kollege melden sich kurz mit der Info"
3. Weiter: "Was interessiert ${lp.anrede==='du'?'dich':'Sie'} noch am Geraet?" oder naechste Frage stellen
Eskalation nur wenn Kaeufer EXPLIZIT Rueckruf moechte oder Preisverhandlung festgefahren ist.

DEIN PRODUKT — NUR VERIFIZIERTE FAKTEN:
Verwende AUSSCHLIESSLICH Angaben die explizit unten stehen. NIEMALS raten oder aus Fotos ableiten.
Unbekannte Details: "Das schaue ich kurz nach" oder "steht auf dem Etikett" — NIEMALS erfinden.

Artikel: ${an.title_short || article.title || 'Produkt'}
${lp._docs && lp._docs.length ? 'DOKUMENTE (auf Anfrage Link senden):\n' + lp._docs.map(function(d){return '- ' + d.label + ': ' + d.public_url;}).join('\n') : ''}
Festpreis: EUR ${price}
Dein absolutes Minimum: EUR ${absoluteMin} (NIEMALS nennen, NIEMALS unterschreiten)
Zustand: ${an.condition ? an.condition.split('.')[0] : 'Gut erhalten'}
Beschreibung: ${an.short_desc || ''}
Highlights: ${(an.bullet_points || []).slice(0, 4).join(' | ')}
Marktpreis: EUR ${an.price_min || Math.round(price * 0.9)} - EUR ${an.price_max || Math.round(price * 1.15)}
Lieferung: ${lp.delivery_pickup ? 'Abholung in ' + (lp.pickup_location || 'Wien') : ''}${lp.delivery_shipping ? (lp.delivery_pickup ? ' oder ' : '') + 'Versand EUR ' + (lp.shipping_cost || 0) : ''}

=== GESPRAECHSFUEHRUNG ===

DEIN ZIEL FUER DIESES GESPRAECH:
${(function(){
  var g=(lp.bot_goal||'direktkauf').split(',')[0].trim();
  var goals={
    direktkauf:'DIREKTKAUF → Kaeufer soll kaufen. Abschluss = Zahlungslink senden.',
    besichtigung:'BESICHTIGUNG → Kaeufer soll einen Termin vereinbaren. Abschluss = Terminanfrage senden.',
    kontakt:'RUECKRUF → Kaeufer soll Kontaktdaten hinterlassen. Abschluss = Rueckrufanfrage senden.',
    angebot:'ANGEBOT → Kaeufer soll Anfrage stellen (Inzahlungnahme, Angebot). Abschluss = Kontaktdaten sammeln.',
    leasing:'FINANZIERUNG → Kaeufer soll Finanzierungsgespraech vereinbaren. Abschluss = Terminanfrage.'
  };
  return goals[g]||goals.direktkauf;
})()}

EROEFFNUNG (erste Nachricht - IMMER dieses Schema):
"Hallo! Ich bin [BotName]. Womit kann ich ${lp.anrede === 'du' ? 'dir' : 'Ihnen'} helfen?"
KURZ. OFFEN. Keine Produkterwähnung, kein Pitch, keine vorformulierte Frage.
Begruendung: Wer schreibt hat bereits Interesse (LP-Link gesehen/geoeffnet).
Die offene Frage holt mehr Information als jede vorformulierte Frage.
Dann gezielte Reaktion auf die Antwort des Kaeufers.

VERBOTEN in Eroeffnung: Produktname nennen, Optionen, Ja/Nein-Fragen, Preis.

REAKTION LESEN - nach jeder Antwort entscheiden:

VERFUEGBARKEIT ("ist es noch verfuegbar?" / "haben Sie das noch?") = KAUFSIGNAL:
→ IMMER: Ja bestaetigen + Knappheit/Dringlichkeit erzeugen
→ Beispiel: "Ja, das Stueck ist noch da - es hat aber schon ein paar Interessenten und ich koennte mir denken es ist bald weg. Was moechtest du wissen?"
→ NIEMALS nur trocken "Ja, noch verfuegbar" ohne Spannung aufzubauen.

ZUSTANDSFRAGEN ("ist es fleckenfrei?" / "wie ist der Zustand?"):
→ Ehrlich aber mit Charme: "Vintage ist gebraucht und hat Geschichte - es ist sauber und gepflegt, aber garantieren dass es wie neu ist kann ich nicht. Was ich sagen kann: wer es traegt, wird darin famos aussehen."
→ Schwaechen konstruktiv einbetten, nie defensiv auflisten.

A) KAEUFER IST KONKRET:
→ Loesung zeigen. Kein weiteres Fragen.
→ Dann sofort zum Ziel: Termin / Zahlungslink / Kontaktdaten.

B) KAEUFER IST VAGE:
→ EINE Vertiefungsfrage. Dann Loesung.
→ Nach MAX 3 Fragen immer zur Ziel-Action.

C) KAEUFER FRAGT DEN PREIS:
→ Preis nennen + Wert begruenden. Kein Ausweichen.
→ Danach eine Frage die zum Ziel fuehrt.

D) KAUFSIGNAL (fragt nach Details, Termin, Lieferung):
→ Sofort die zielspezifische Action ausloesen.

E) EINWAND:
Echt → loesen. Vorwand → "Was haelt dich noch zurueck?"
- "Zu teuer" → Marktpreis + Zustand + Wert. Nicht nachgeben.
- "Muss nachdenken" → "Was fehlt dir noch?"
- "Woanders billiger" → "Was hast du gefunden?"

LOESUNG:
- "Du hast gesagt... - genau dafuer ist das perfekt."
- NUR fuer diesen Kaeufer relevante Features.
- Konkrete Bilder: "Stell dir vor..."

ABSCHLUSS (${aggr.label}):
1. Rabatt-Versuch 1: Wert-Argument. Nicht nachgeben.
2. Rabatt-Versuch 2: EINMALIG 5-8%. Dann eisern.
3. Weiteres Draengen: "Das ist mein letztes Wort."
4. Unter EUR ${absoluteMin}: "Das geht wirklich nicht."
5. EINIGUNG: Erst kurz Bestaetigung ("Sehr gut, das freut mich!"), DANN "ZAHLUNG_LINK:[BETRAG]", DANN erklaeren was passiert ("Nach Zahlung melden wir uns zur Uebergabe"). NIEMALS nur Trigger ohne Text.
   Einigung Termin: NUR "TERMIN_ANFRAGE:[name]:[whatsapp-nummer-des-kaeufers]:[datum]" — Telefon NICHT abfragen, du hast es bereits
   Einigung Rueckruf: NUR "KONTAKT_ANFRAGE:[name]:[tel]:[zeit]" 

=== EXIT-STRATEGIE (wenn Kaeufer unter absolutem Minimum bleibt) ===
Wenn Kaeufer unter EUR ${absoluteMin} bleibt UND du bereits "letztes Wort" gesagt hast:

SCHRITT 1 - Letzte Argumente (1 pro Nachricht, in dieser Reihenfolge):
${(botConfig.exit_strategy_args||[]).filter(function(a){return a.argument;}).map(function(a,i){return (i+1)+'. '+a.argument;}).join('\n')}

SCHRITT 2 - Falls Kaeufer immer noch nicht kauft:
Sage: "Ich darf leider nicht weiter runtergehen. Mein Vorschlag: Ich leite dich an unseren Verkaufsexperten weiter - der hat manchmal noch Moeglichkeiten. Waere das ok?"
Bei JA: "Super. Deine WhatsApp-Nummer habe ich bereits. Kannst du mir noch kurz deine E-Mail geben und wann du am besten erreichbar bist?"
Sobald du E-Mail und Zeitpunkt hast: sende NUR "VERKAUFSLEITER_ANFRAGE:[email]:[zeitpunkt]"

${vkBotGoalPrompt(lp, lp.anrede||'Sie')}

=== SPRACHE & STIL - ABSOLUT WICHTIG ===
- Du bist eine echte Person, kein Bot, kein Verkaeufer
- WhatsApp-Stil: locker, direkt, menschlich
- MAXIMAL 2-3 kurze Saetze. Immer. Keine Listen, keine Aufzaehlungen.
- Schreib wie ein normaler Mensch - nicht wie eine Broschüre
- Kurze Saetze. Ein Gedanke pro Satz. Woerter die jeder kennt.
- VERBOTEN: "gerne", "natuerlich", "selbstverstaendlich", "absolut", "im Rahmen", "hinsichtlich"
- VERBOTEN: "Ich moechte Sie darauf hinweisen", "Es sei erwaehnt dass", kuenstliche Begeisterung
- NICHT: "Im Rahmen einer umfassenden Pruefung..." → SONDERN: "Haben alles gecheckt -"
- NICHT: "Ich darf Ihnen mitteilen..." → SONDERN: einfach direkt sagen
- Richtige Anrede ${lp.anrede === 'du' ? '(DU): immer du/dein/dir - nie Sie' : '(SIE): immer Sie/Ihr/Ihnen - nie du'} - konsequent durchhalten
- VERBOTEN: "Top-Deal", "authentifiziert", "Habe ich alle Infos parat", "Wie kann ich helfen", "Gerne", jede Marketingsprache
${lp._docs && lp._docs.length ? `DOKUMENTE AKTIV ANBIETEN:\n${lp._docs.map(d => '- ' + d.label + ': ' + d.public_url).join('\n')}\n\nBei Anfrage nach Unterlagen/Dossier/Fotos/Protokollen:\n1. Frage nach E-Mail des Kaeufers\n2. Wenn E-Mail erhalten → antworte NUR: DOSSIER_SENDEN:[email]\nProaktiv anbieten erlaubt: "Ich habe Unterlagen verfuegbar - soll ich die zusenden?"` : '- VERBOTEN: Fotos, Bilder oder Dokumente anbieten - du hast keine Unterlagen'}
- Hoechstens 1 Emoji - keins ist auch ok
- Natuerliche Sprache - du textest einem Bekannten, nicht einem Kunden

=== REGELN ===
- SPRACHE: Erkenne die Sprache des Kaeufers und antworte IMMER in seiner Sprache. Unterstuetzte Sprachen: ${(botConfig.languages || ['Deutsch','English','Español']).join(', ')}. Unbekannte Sprache: antworte auf Englisch.
- Preis NIEMALS selbst ansprechen bis Kaeufer fragt
- Mindestpreis NIEMALS erwaehnen
- Bei Einigung: Erst Bestaetigung + Freude, dann "ZAHLUNG_LINK:[BETRAG]", dann Naechste Schritte. KEIN nackter Trigger.
- Bei Festpreisabschluss: "ZAHLUNG_LINK:${price}"
${botConfig.location ? '\nSTANDORT & ZUGANG:\n' + botConfig.location + (botConfig.parking ? '\nParken: ' + botConfig.parking : '') : ''}
${botConfig.availability ? '\nVERFÜGBARKEIT: ' + botConfig.availability : ''}
${botConfig.product_story ? '\nPRODUKT-GESCHICHTE: ' + botConfig.product_story : ''}
${botConfig.logistics ? '\nTRANSPORT/LOGISTIK: ' + botConfig.logistics : ''}
${botConfig.notes ? '\nHINWEISE VOM VERKÄUFER:\n' + botConfig.notes : ''}
${(botConfig.qa_pairs||[]).filter(qa=>qa.q&&qa.a).map(qa=>'WENN gefragt: "'+qa.q+'" → antworte: "'+qa.a+'"').join('\n')}
${botConfig.min_price&&parseFloat(botConfig.min_price)>absoluteMin?'\nAKTUALISIERTE UNTERGRENZE: EUR '+botConfig.min_price+' (NIEMALS nennen)':''}
${botConfig.emotion?'\n\nEMOTIONALER KONTEXT - WICHTIG:\n'+botConfig.emotion+'\nNur 1x einsetzen wenn Käufer zögert - natürlich, nicht als Script.':''}
${botConfig.persona?'\nZIELGRUPPE: '+botConfig.persona+' - Stil entsprechend anpassen.':''}
${(botConfig.feature_benefits||[]).filter(f=>f.feature&&f.benefit).length?'\n\nFEATURE → NUTZEN (NIEMALS Features nennen, NUR den Nutzen):\n'+(botConfig.feature_benefits||[]).filter(f=>f.feature&&f.benefit).map(f=>'- '+f.feature+' → '+f.benefit).join('\n'):''}
${(botConfig.product_values||[]).filter(v=>v.label&&v.meaning).length?'\n\nPRODUKTWERTE - erkenne welchen Wert der Kaeufer sucht und sprich ihn gezielt an:\n'+(botConfig.product_values||[]).filter(v=>v.label&&v.meaning).map(v=>'- '+v.label+': '+v.meaning).join('\n'):''}
${(botConfig.fomo_list||[]).filter(f=>f.argument).length?'\n\nFOMO ARGUMENTE - situativ einsetzen, nie mehrere auf einmal:\n'+(botConfig.fomo_list||[]).filter(f=>f.argument).map(f=>'- '+(f.situation?f.situation+': ':'')+f.argument).join('\n'):''}`;
  // Konversation initialisieren
  const session = {
    lpSlug,
    phoneId,
    lp,
    article,
    systemPrompt,
    minPrice,
    price,
    messages: [{ role: 'user', content: text }]
  };
  // Dokumente laden
  try {
    const { data: _docs } = await supabase.from('vk_article_docs')
      .select('label, public_url, type').eq('article_id', lp.article_id || '');
    if (_docs && _docs.length) lp._docs = _docs;

      // Verifizierte Fakten für Bot laden
      const { data: _artFull } = await supabase.from('vk_articles')
        .select('answers, questions').eq('id', article.id || '').maybeSingle();
      lp._verifiedFacts = buildVerifiedFactsText(_artFull);
  } catch(e) {}

  // Antworten aus Fragebogen laden für Bot
  try {
    const { data: _artFull } = await supabase.from('vk_articles')
      .select('bot_share_hidden, id, answers, questions').eq('id', lp.article_id || '').maybeSingle();
    if (_artFull && _artFull.answers && _artFull.questions) {
      const _ans = [];
      (_artFull.questions||[]).forEach(function(q){
        if (_artFull.answers[q.id] && q.id !== 'q_sonstige' && q.id !== 'q_extra') {
          _ans.push({ label: q.label||q.id, value: _artFull.answers[q.id] });
        }
      });
      if (_artFull.answers['q_extra']) {
        _artFull.answers['q_extra'].replace(/\|\|\|/g,',').split(',').forEach(function(kv){
          var p = kv.split(':');
          if (p.length >= 2) _ans.push({ label: p[0].trim(), value: p.slice(1).join(':').trim() });
        });
      }
      if (_ans.length) lp._answers = _ans;
    }
  } catch(e) {}

  // Versteckte Fotos laden wenn freigegeben
  try {
    const { data: _art } = await supabase.from('vk_articles')
      .select('bot_share_hidden, id').eq('id', lp.article_id || '').maybeSingle();
    if (_art && _art.bot_share_hidden) {
      const { data: _hidden } = await supabase.from('vk_photos')
        .select('public_url, sort_order').eq('article_id', _art.id).eq('is_hidden', true);
      if (_hidden && _hidden.length) lp._hidden_photos = _hidden.map(function(p){ return p.public_url; });
    }
  } catch(e) {}

  // Eskalations-Titel aus Business nachladen
  if (lp.session_id) {
    try {
      const { data: _s } = await supabase.from('vk_sessions').select('business_discount_id').eq('id', lp.session_id).maybeSingle();
      if (_s && _s.business_discount_id) {
        const { data: _bd } = await supabase.from('vk_business_discounts').select('escalation_title,escalation_availability,seller_email').eq('id', _s.business_discount_id).maybeSingle();
        if (_bd) {
          lp._escalation_title = _bd.escalation_title || 'unseren Verkaufsexperten';
          lp._escalation_availability = _bd.escalation_availability || '';
          lp._seller_email = _bd.seller_email || null;
        }
      }
    } catch(etErr) { console.error('escalation title:', etErr.message); }
  }

  vkLPBotSessions.set(phone, session);

  // Claude antworten lassen
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: { sachbearbeiter: 'claude-sonnet-4-6', abteilungsleiter: 'claude-sonnet-4-6', experte: 'claude-opus-4-6' }[lp.ai_mode] || 'claude-sonnet-4-6', // Sonnet min für Bot-Dialog
      max_tokens: 300,
      system: systemPrompt,
      messages: session.messages
    })
  });
  const data = await response.json();
  if (data.error || !data.content) {
    console.error('LP Bot API error:', JSON.stringify(data.error || data).substring(0, 200));
    await vkSendWhatsApp(phone, 'Einen Moment bitte, ich bin gleich wieder da.');
    return;
  }
  const reply = data.content?.[0]?.text || 'Einen Moment bitte.';

  // Prüfen ob Payment Link generiert werden soll
  const paymentMatch = reply.match(/ZAHLUNG_LINK:(\d+(?:\.\d+)?)/);
  if (paymentMatch) {
    const agreedPrice = parseFloat(paymentMatch[1]);
    await vkSendLPPaymentLink(phone, lp, agreedPrice, phoneId);
    vkLPBotSessions.delete(phone);
    return;
  }

  // Antwort speichern und senden
  session.messages.push({ role: 'assistant', content: reply });
  await vkSendWhatsApp(phone, reply);
}

async function vkHandleLPBotReply(phone, text, phoneId) {
  const fetch = require('node-fetch');
  const session = vkLPBotSessions.get(phone);
  if (!session) return;

  // Konversation abbrechen wenn Käufer abbricht
  const cancelWords = ['stop', 'nein', 'danke', 'tschüss', 'bye', 'kein interesse'];
  if (cancelWords.some(w => text.toLowerCase().includes(w))) {
    vkLPBotSessions.delete(phone);
    await vkSendWhatsApp(phone, 'Kein Problem! Falls Sie doch Interesse haben, schreiben Sie einfach nochmal. 😊');
    return;
  }

  session.messages.push({ role: 'user', content: text });

  // Modell = LP ai_mode – durchgehend konsistent, kein isNegotiating-Split
  const waAiModeMap = { sachbearbeiter: 'claude-sonnet-4-6', abteilungsleiter: 'claude-sonnet-4-6', experte: 'claude-opus-4-6' };
  const model = waAiModeMap[session.lp?.ai_mode] || 'claude-sonnet-4-6';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system: session.systemPrompt,
      messages: session.messages
    })
  });
  const data = await response.json();
  if (data.error || !data.content) {
    console.error('LP BotReply API error:', JSON.stringify(data.error || data).substring(0, 200));
    await vkSendWhatsApp(phone, 'Einen Moment bitte, ich bin gleich wieder da.');
    return;
  }
  const reply = data.content?.[0]?.text || 'Einen Moment bitte.';

  // Payment Link check
  const paymentMatch = reply.match(/ZAHLUNG_LINK:(\d+(?:\.\d+)?)/);
  if (paymentMatch) {
    const agreedPrice = parseFloat(paymentMatch[1]);
    await vkSendLPPaymentLink(phone, session.lp, agreedPrice, phoneId);
    vkLPBotSessions.delete(phone);
    return;
  }

  // Neue Ziel-Trigger (Kontakt/Termin)
  const handled = await vkHandleBotTriggers(reply, phone, session);
  if (handled) { vkLPBotSessions.delete(phone); return; }

  // Dossier direkt per WhatsApp senden (Standard), nur bei Email-Wunsch per Mail
  const dossierWaMatch = reply.match(/DOSSIER_WA/);
  const dossierMailMatch = reply.match(/DOSSIER_SENDEN:([^\s,]+)/);

  if (dossierWaMatch || dossierMailMatch) {
    const docs = (session.lp && session.lp._docs) ? session.lp._docs : [];
    const an = (session.lp && session.lp.vk_articles && session.lp.vk_articles.analysis) ? session.lp.vk_articles.analysis : {};
    const artikel = an.title_short || (session.lp && session.lp.vk_articles && session.lp.vk_articles.title) || 'Artikel';
    const anrede = (session.lp && session.lp.anrede) || 'Sie';

    if (docs.length) {
      if (dossierWaMatch) {
        // Links direkt per WhatsApp senden
        const docLines = docs.map(function(d){ return '📎 ' + d.label + ':\n' + d.public_url; }).join('\n\n');
        const waMsg = 'Hier sind die Unterlagen direkt:\n\n' + docLines;
        await vkSendWhatsApp(phone, waMsg);
        console.log('Dossier per WA gesendet:', docs.length, 'Dokumente');
      } else if (dossierMailMatch) {
        // Per E-Mail senden wenn Kunde das explizit möchte
        const buyerEmail = dossierMailMatch[1].trim();
        if (buyerEmail.includes('@')) {
          try {
            const fetch = require('node-fetch');
            const docsHtml = docs.map(function(d){
              return '<tr><td style="padding:8px;font-weight:600;">' + d.label + '</td>'
                + '<td style="padding:8px;"><a href="' + d.public_url + '">' + d.public_url + '</a></td></tr>';
            }).join('');
            const emailHtml = '<div style="font-family:Arial,sans-serif;max-width:520px;">'
              + '<div style="background:#1b4332;color:#fff;padding:20px;">'
              + '<div style="font-weight:800;">Unterlagen: ' + artikel + '</div></div>'
              + '<div style="padding:20px;border:1px solid #e5e7eb;">'
              + '<table style="width:100%;border-collapse:collapse;">' + docsHtml + '</table></div></div>';
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
              body: JSON.stringify({
                from: 'Converdino <noreply@converdino.com>',
                to: buyerEmail,
                subject: 'Unterlagen: ' + artikel,
                html: emailHtml
              })
            });
            const msg = anrede === 'du'
              ? 'Habe dir die Unterlagen an ' + buyerEmail + ' geschickt.'
              : 'Ich habe Ihnen die Unterlagen an ' + buyerEmail + ' geschickt.';
            await vkSendWhatsApp(phone, msg);
          } catch(e) { console.error('Dossier Mail:', e.message); }
        }
      }
    }
    return;
  }

  // Verkaufsleiter-Weiterleitung
  const vkLeiterMatch = reply.match(/VERKAUFSLEITER_ANFRAGE:([^:]+):(.+)/);
  if (vkLeiterMatch) {
    const buyerContact = vkLeiterMatch[1].trim();
    const contactType = buyerContact.includes('@') ? 'E-Mail' : 'Telefon';
    const callTime = vkLeiterMatch[2].trim();
    const an = (session.article?.analysis || session.lp?.vk_articles?.analysis || {});
    const artikel = an.title_short || session.lp?.vk_articles?.title || 'Produkt';
    const lpSlug = session.lpSlug || session.lp?.slug || '';

    // Eskalation in DB speichern
    try {
      const escData = {
        lp_slug: lpSlug,
        buyer_phone: phone,
        buyer_contact_type: contactType,
        buyer_contact: buyerContact,
        buyer_availability: callTime,
        article_title: artikel,
        status: 'new'
      };
      if (session.lp?.id) escData.lp_id = session.lp.id;
      if (session.lp?.article_id) escData.article_id = session.lp.article_id;
      await supabase.from('vk_escalations').insert(escData);
      console.log('Eskalation gespeichert:', JSON.stringify(escData));
    } catch(escErr) { console.error('Eskalation DB error:', escErr.message); }

    // E-Mail an Verkäufer via Resend
    try {
      let sellerEmail = null;
      // seller_email aus business_discount laden
      if (session.lp?.session_id) {
        const { data: sess } = await supabase.from('vk_sessions')
          .select('business_discount_id').eq('id', session.lp.session_id).maybeSingle();
        if (sess?.business_discount_id) {
          const { data: bd } = await supabase.from('vk_business_discounts')
            .select('seller_email, company_name').eq('id', sess.business_discount_id).maybeSingle();
          if (bd?.seller_email) sellerEmail = bd.seller_email;
        }
      }
      if (sellerEmail) {
        const fetch = require('node-fetch');
        const emailHtml = '<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;">'
          + '<div style="background:#1b4332;color:#fff;padding:20px;border-radius:10px 10px 0 0;">'
          + '<div style="font-size:1.1rem;font-weight:800;">📞 Kaufinteressent wartet auf Kontakt</div>'
          + '</div>'
          + '<div style="background:#fff;border:1px solid #e5e7eb;border-radius:0 0 10px 10px;padding:20px;">'
          + '<p style="margin-bottom:16px;">Ein Interessent für Ihren Artikel möchte kontaktiert werden:</p>'
          + '<table style="width:100%;border-collapse:collapse;margin-bottom:16px;">'
          + '<tr><td style="padding:8px;background:#f9fafb;font-weight:700;width:40%;">Artikel</td><td style="padding:8px;background:#f9fafb;">' + artikel + '</td></tr>'
          + '<tr><td style="padding:8px;font-weight:700;">Kontaktweg</td><td style="padding:8px;">' + contactType + '</td></tr>'
          + '<tr><td style="padding:8px;background:#f9fafb;font-weight:700;">Kontakt</td><td style="padding:8px;background:#f9fafb;font-weight:700;color:#1b4332;font-size:1.1rem;">' + buyerContact + '</td></tr>'
          + '<tr><td style="padding:8px;font-weight:700;">Erreichbar</td><td style="padding:8px;">' + callTime + '</td></tr>'
          + '</table>'
          + '<div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px;margin-bottom:16px;font-size:.88rem;">'
          + '⏰ Bitte melden Sie sich zeitnah beim Interessenten. Je schneller die Reaktion, desto höher die Abschlusswahrscheinlichkeit.'
          + '</div>'
          + '<p style="font-size:.82rem;color:#6b7280;">Diese Anfrage wurde automatisch von Ihrem Converdino Verkaufsberater weitergeleitet.</p>'
          + '<p style="font-size:.82rem;color:#6b7280;">Artikel-Link: <a href="https://p.converdino.com/p/' + lpSlug + '">https://p.converdino.com/p/' + lpSlug + '</a></p>'
          + '</div></div>';

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY },
          body: JSON.stringify({
            from: 'Converdino Berater <noreply@converdino.com>',
            to: sellerEmail,
            subject: '📞 Kaufinteressent wartet auf Kontakt – ' + artikel,
            html: emailHtml
          })
        });
        console.log('Eskalation E-Mail gesendet an:', sellerEmail);
      } else {
        console.warn('Keine seller_email fuer Eskalation, LP:', lpSlug);
      }
    } catch(emailErr) { console.error('Eskalation E-Mail error:', emailErr.message); }

    // Bestätigung an Käufer
    const anrede = session.lp?.anrede || 'Sie';
    const bestaetigung = anrede === 'du'
      ? 'Super, ich habe deine Kontaktdaten weitergeleitet. Unser Verkaufsexperte meldet sich ' + callTime + ' bei dir. Danke fuer dein Interesse!'
      : 'Sehr gut, ich habe Ihre Kontaktdaten weitergeleitet. Unser Verkaufsexperte meldet sich ' + callTime + ' bei Ihnen. Vielen Dank fuer Ihr Interesse!';
    await vkSendWhatsApp(phone, bestaetigung);
    vkLPBotSessions.delete(phone);
    return;
  }

  session.messages.push({ role: 'assistant', content: reply });

  // Max 10 Nachrichten dann Session beenden
  await vkSendWhatsApp(phone, reply);
  // Nach 30 Nachrichten Session leise beenden (kein Text anhängen)
  if (session.messages.length > 60) {
    // Recovery-Info speichern damit Bot auf nächste Nachricht reagieren kann
    vkLPBotRecovery.set(phone, { lpSlug: session.lpSlug, phoneId: session.phoneId, ts: Date.now() });
    vkLPBotSessions.delete(phone);
  }
}

async function vkSendLPPaymentLink(phone, lp, agreedPrice, phoneId) {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const article = lp.vk_articles || {};
    const an = article.analysis || {};

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_creation: 'always',
      billing_address_collection: 'required',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: an.title_short || article.title || 'Produkt' },
          unit_amount: Math.round(agreedPrice * 100)
        },
        quantity: 1
      }],
      metadata: {
        lp_id: lp.id,
        lp_slug: lp.slug,
        delivery_type: lp.delivery_pickup ? 'pickup' : 'shipping',
        negotiated: 'true'
      },
      success_url: 'https://p.converdino.com/p/' + lp.slug + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://p.converdino.com/p/' + lp.slug
    });

    const msg = 'Super! Hier ist Ihr persönlicher Zahlungslink:\n\n' + session.url + '\n\nBetrag: EUR ' + agreedPrice.toFixed(2) + '\n\nDer Link ist 24 Stunden gültig.';
    await vkSendWhatsApp(phone, msg);
  } catch(e) {
    console.error('LP Payment Link error:', e.message);
    await vkSendWhatsApp(phone, 'Entschuldigung, der Zahlungslink konnte nicht erstellt werden. Bitte kaufen Sie direkt auf der Webseite: https://p.converdino.com/p/' + lp.slug);
  }
}



// ── MASSENUPLOAD: Fotos gruppieren und Artikel erstellen ──
async function vkGroupAndCreateArticles(sessionId, tempArticleId, phone) {
  const fetch = require('node-fetch');
  let compliant = 0, blocked = 0;

  try {
    // Alle Fotos des Temp-Artikels laden
    const { data: photos } = await supabase.from('vk_photos')
      .select('id, public_url, sort_order')
      .eq('article_id', tempArticleId)
      .order('sort_order');

    if (!photos || photos.length === 0) return { compliant: 0, blocked: 0 };

    if (photos.length === 1) {
      // Nur ein Foto - direkt Artikel erstellen mit Compliance
      await supabase.from('vk_articles')
        .update({ title: 'Artikel', sort_order: 1 })
        .eq('id', tempArticleId);
      return { compliant: 1, blocked: 0 };
    }

    // Claude gruppiert Fotos
    const photoList = photos.map((p, i) => (i + 1) + '. ' + p.public_url).join('\n');

    // Upload mode aus Business Discount laden
    let groupingModel = 'claude-haiku-4-5-20251001';
    try {
      const { data: sess } = await supabase.from('vk_sessions')
        .select('business_discount_id').eq('id', sessionId).maybeSingle();
      if (sess && sess.business_discount_id) {
        const { data: bd } = await supabase.from('vk_business_discounts')
          .select('upload_mode').eq('id', sess.business_discount_id).maybeSingle();
        if (bd && bd.upload_mode === 'expert') {
          groupingModel = 'claude-haiku-4-5-20251001';
          console.log('Expert mode: using Opus for grouping');
        }
      }
    } catch(e) { console.error('upload_mode lookup:', e.message); }

    // Bilder als base64 laden für Claude API
    const photoContents = [];
    for (let i = 0; i < Math.min(photos.length, 15); i++) {
      const p = photos[i];
      try {
        const imgRes = await fetch(p.public_url);
        const imgArrayBuf = await imgRes.arrayBuffer();
        const imgBuf = Buffer.from(imgArrayBuf);
        const imgB64 = imgBuf.toString('base64');
        const contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
        photoContents.push({ type: 'text', text: 'Foto ' + (i+1) + ':' });
        photoContents.push({ type: 'image', source: { type: 'base64', media_type: contentType, data: imgB64 } });
      } catch(imgErr) {
        console.error('Image download error:', imgErr.message);
        photoContents.push({ type: 'text', text: 'Foto ' + (i+1) + ': (nicht ladbar)' });
      }
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: groupingModel,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            ...photoContents,
            { type: 'text', text: 'AUFGABE: Gruppiere diese ' + photos.length + ' Fotos nach physischen Objekten.\n\nREGEL: Jeder einzigartige Gegenstand = eigene Gruppe. Gleicher Gegenstand aus verschiedenen Winkeln = eine Gruppe.\n\nAntworte NUR mit JSON:\n[{"title":"Kurztitel max 50 Zeichen","photo_indices":[1,2],"article_category":"standard","compliance_category":3,"compliance_blocked":false,"compliance_reason":null}]\n\narticle_category: luxury_watch/luxury_bag/jewelry/electronics/vehicle/medical/industrial/art/standard\ncompliance_category: 1=VERBOTEN(Nazi/Waffen/Drogen/Pornografie/Tiere), 2=PRUEFEN(Militaria/Messer), 3=OK\nphoto_indices 1-basiert.' }
          ]
        }]
      })
    });

    const d = await r.json();
    const text = d.content?.[0]?.text || '[]';
    console.log('Claude grouping raw response:', text.substring(0, 500));
    console.log('Photos sent:', photos.length, 'Photo download errors:', photoContents.filter(p => p.type === 'text' && p.text.includes('nicht ladbar')).length);
    const clean = text.replace(/```json|```/g, '').trim();
    let groups;
    try { groups = JSON.parse(clean); } catch(parseErr) {
      console.error('JSON parse error:', parseErr.message, 'Raw:', clean.substring(0, 200));
      groups = null;
    }

    if (!groups || !groups.length) {
      // Fallback: alles als ein Artikel
      await supabase.from('vk_articles').update({ title: 'Artikel', sort_order: 1 }).eq('id', tempArticleId);
      return { compliant: 1, blocked: 0 };
    }

    // Erste Gruppe: Temp-Artikel updaten
    const firstGroup = groups[0];
    const firstPhotoIds = (firstGroup.photo_indices || []).map(i => photos[i-1]?.id).filter(Boolean);
    const catMap = { luxury_watch: 15, luxury_bag: 15, jewelry: 12, electronics: 8, vehicle: 20, medical: 30, industrial: 30, art: 15, standard: 10 };
    const maxPhotos = catMap[firstGroup.article_category] || 10;

    const firstStatus = firstGroup.compliance_blocked ? 'blocked' : (firstGroup.compliance_category <= 2 ? 'needs_review' : 'approved');

    await supabase.from('vk_articles').update({
      title: firstGroup.title || 'Artikel',
      sort_order: 1,
      article_category: firstGroup.article_category || 'standard',
      max_photos: maxPhotos,
      compliance_status: firstStatus,
      compliance_category: firstGroup.compliance_category || 3,
      compliance_blocked_reason: firstGroup.compliance_reason || null
    }).eq('id', tempArticleId);

    if (firstStatus === 'blocked') blocked++; else compliant++;

    // Weitere Fotos für erste Gruppe zuweisen
    if (firstPhotoIds.length > 0) {
      const otherPhotos = photos.filter(p => !firstPhotoIds.includes(p.id));
      // Fotos die nicht zur ersten Gruppe gehören werden später zugewiesen
    }

    // Weitere Gruppen: neue Artikel erstellen
    for (let i = 1; i < groups.length; i++) {
      const group = groups[i];
      const groupPhotos = (group.photo_indices || []).map(idx => photos[idx-1]).filter(Boolean);
      const gStatus = group.compliance_blocked ? 'blocked' : (group.compliance_category <= 2 ? 'needs_review' : 'approved');
      const gMaxPhotos = catMap[group.article_category] || 10;

      const { data: newArt } = await supabase.from('vk_articles').insert({
        session_id: sessionId,
        title: group.title || ('Artikel ' + (i + 1)),
        sort_order: i + 1,
        extended: false,
        article_category: group.article_category || 'standard',
        max_photos: gMaxPhotos,
        compliance_status: gStatus,
        compliance_category: group.compliance_category || 3,
        compliance_blocked_reason: group.compliance_reason || null
      }).select().single();

      if (newArt && groupPhotos.length > 0) {
        // Fotos zum neuen Artikel verschieben
        await supabase.from('vk_photos').update({ article_id: newArt.id })
          .in('id', groupPhotos.map(p => p.id));
      }

      if (gStatus === 'blocked') blocked++; else compliant++;

      // Compliance Log für problematische Artikel
      if (gStatus !== 'approved' && newArt) {
        await supabase.from('vk_compliance_log').insert({
          article_id: newArt.id,
          action: gStatus === 'blocked' ? 'auto_blocked' : 'needs_review',
          reason: group.compliance_reason || null
        });
      }
    }

    // Compliance Log für ersten Artikel wenn nötig
    if (firstStatus !== 'approved') {
      await supabase.from('vk_compliance_log').insert({
        article_id: tempArticleId,
        action: firstStatus === 'blocked' ? 'auto_blocked' : 'needs_review',
        reason: firstGroup.compliance_reason || null
      });
    }

    console.log('Grouping complete:', groups.length, 'articles,', compliant, 'compliant,', blocked, 'blocked');
    return { compliant, blocked };

  } catch(e) {
    console.error('vkGroupAndCreateArticles error:', e.message);
    // Fallback
    await supabase.from('vk_articles').update({ title: 'Artikel', sort_order: 1 }).eq('id', tempArticleId);
    return { compliant: 1, blocked: 0 };
  }
}

// ── COMPLIANCE & KATEGORIE CHECK ─────────────────────────
const VK_CATEGORY_MAP = {
  luxury_watch:  { maxPhotos: 15, label: 'Luxusuhr' },
  luxury_bag:    { maxPhotos: 15, label: 'Luxustasche' },
  jewelry:       { maxPhotos: 12, label: 'Schmuck' },
  electronics:   { maxPhotos: 8,  label: 'Elektronik' },
  vehicle:       { maxPhotos: 20, label: 'Fahrzeug' },
  medical:       { maxPhotos: 30, label: 'Medizintechnik' },
  industrial:    { maxPhotos: 30, label: 'Industrie' },
  art:           { maxPhotos: 15, label: 'Kunst/Antiquität' },
  standard:      { maxPhotos: 10, label: 'Standard' }
};

async function vkComplianceCheckPhoto(imageBase64, mediaType) {
  const fetch = require('node-fetch');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: `Analysiere dieses Bild fuer einen Online-Marktplatz. Antworte NUR mit JSON:
{
  "compliance_category": 1,
  "blocked": false,
  "block_reason": null,
  "article_category": "standard",
  "needs_review": false,
  "review_reason": null
}

compliance_category:
1 = Absolut verboten (Nazi/SS Symbole, Waffen, Drogen, Pornografie, lebende Tiere, gefaelschte Dokumente, Wildtierprodukte)
2 = Pruefung erforderlich (Militaria ohne NS, Repliken, Alkohol, Medizinprodukte, Messer)
3 = Erlaubt

article_category: luxury_watch / luxury_bag / jewelry / electronics / vehicle / medical / industrial / art / standard

blocked: true nur bei category 1
needs_review: true bei category 2` }
          ]
        }]
      })
    });
    const d = await r.json();
    const text = d.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('Compliance check error:', e.message);
    return { compliance_category: 3, blocked: false, article_category: 'standard', needs_review: false };
  }
}



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

      // Massenupload: Fotos sammeln, KEIN neuer Artikel pro Foto
      pending.batchCount++;
      pending.photoIds = pending.photoIds || [];
      session = { id: pending.sessionId, token: pending.sessionToken };

      // Temp-Artikel für Foto-Speicherung (wird nach Gruppierung ersetzt)
      if (!pending.tempArticleId) {
        const { data: tempArt } = await supabase.from('vk_articles')
          .insert({ session_id: session.id, title: '_temp_' + phone, sort_order: 0, extended: false, compliance_status: 'pending_review' })
          .select().single();
        if (tempArt) pending.tempArticleId = tempArt.id;
      }
      article = { id: pending.tempArticleId };
      console.log('VK massenupload: photo', pending.batchCount, 'for session', session.token);

    } else {
      // ── Erstes Foto – SOFORT Platzhalter setzen ──
      pending = { sessionId: null, sessionToken: null, batchCount: 1, sessionArticleBase: 0, merchantId, timer: null, photoIds: [], tempArticleId: null };
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
      // Massenupload: Fotos gruppieren
      const sessionId = final ? final.sessionId : pending.sessionId;
      const tempArticleId = final ? final.tempArticleId : pending.tempArticleId;
      let compliantCount = 0, blockedCount = 0;

      if (batchCount > 1 && tempArticleId) {
        // Fotos gruppieren via Claude
        try {
          const groupResult = await vkGroupAndCreateArticles(sessionId, tempArticleId, phone);
          compliantCount = groupResult.compliant;
          blockedCount = groupResult.blocked;
        } catch(groupErr) {
          console.error('Grouping error:', groupErr.message);
          compliantCount = batchCount;
        }
      } else {
        // Einzelnes Foto - direkt Artikel umbenennen
        if (tempArticleId) {
          await supabase.from('vk_articles')
            .update({ title: 'Artikel', sort_order: 1 })
            .eq('id', tempArticleId);
          compliantCount = 1;
        }
      }

      let msg = 'Wir haben ' + batchCount + ' Foto' + (batchCount > 1 ? 's' : '') + ' von dir erhalten.\n\n';
      if (batchCount > 1) {
        msg += 'Erkannte Artikel:\n';
        if (compliantCount > 0) msg += compliantCount + (compliantCount === 1 ? ' Artikel bereit' : ' Artikel bereit') + '\n';
        if (blockedCount > 0) msg += blockedCount + (blockedCount === 1 ? ' Artikel wird geprueft' : ' Artikel werden geprueft') + '\n';
      }
      msg += '\nKlicke auf den Link um deinen Auftrag zu verwalten:\n' + link;
      msg += '\n\nDort kannst du:\n- Verkaufsberichte bestellen\n- Landingpages einrichten\n- Deinen Converdino Berater aktivieren';
      if (blockedCount > 0) msg += '\n\nBitte pruefe deine Auftragspositionen auf moegliche Compliance-Verstoesse.';
      await sendWhatsApp(pending.merchantId, '+' + phone.replace(/[^0-9]/g,''), msg);
      console.log('VK debounce: WA sent for', phone, 'batch:', batchCount);
    }, 5000);

    pending.timer = timer;

  } catch(e) { console.error('VK WhatsApp handler error:', e.message); }
}
// ══════════════════════════════════════════════════════════════════════
// NEUE ENDPOINTS – In server.js EINFÜGEN direkt VOR der Zeile:
//   module.exports = { vkHandleWhatsAppImage };
// (ganz am Ende der Datei, kurz vor dem letzten module.exports)
// ══════════════════════════════════════════════════════════════════════


// ── WIDGET.JS – Einbettbarer WhatsApp-Button für Kundenseiten ─────────
app.get('/widget.js', (req, res) => {
  const slug = (req.query.slug || '').replace(/[^a-z0-9-]/g, '');
  const waNum = '4367764118066';
  const baseUrl = 'https://p.converdino.com/p/';

  const js = `(function(){
  var slug='${slug}';
  var waNum='${waNum}';
  if(!slug){console.warn('Converdino Widget: kein slug angegeben');return;}
  var style=document.createElement('style');
  style.textContent='.cvd-btn{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;align-items:center;gap:10px;background:#25D366;color:#fff;padding:13px 22px;border-radius:30px;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-weight:800;font-size:14px;box-shadow:0 4px 16px rgba(37,211,102,.45);transition:all .2s;cursor:pointer;border:none;white-space:nowrap;}.cvd-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(37,211,102,.55);}@media(max-width:480px){.cvd-btn{bottom:14px;right:14px;padding:11px 16px;font-size:13px;}}';
  document.head.appendChild(style);
  var btn=document.createElement('a');
  btn.className='cvd-btn';
  var lpUrl='https://p.converdino.com/p/'+slug;
  var msg=encodeURIComponent('Hallo! Ich interessiere mich für dieses Angebot: '+lpUrl);
  btn.href='https://wa.me/'+waNum+'?text='+msg;
  btn.target='_blank';
  btn.rel='noopener';
  btn.setAttribute('aria-label','Jetzt per WhatsApp anfragen');
  btn.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="white" style="flex-shrink:0;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>Jetzt anfragen';
  document.body.appendChild(btn);
  console.log('Converdino Widget geladen fuer: '+slug);
})();`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(js);
});


// ── FOTO + PDF GEMEINSAM ANALYSIEREN → DNA + Fragebogen befüllen ──────
app.post('/api/vk/article/:id/analyze-with-doc', async (req, res) => {
  try {
    const { pdf_base64, pdf_content_type, label } = req.body;
    if (!pdf_base64) return res.status(400).json({ error: 'pdf_base64 fehlt' });

    const { data: article } = await supabase.from('vk_articles')
      .select('*, vk_photos(*), analysis, answers, questions')
      .eq('id', req.params.id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    const { data: sess } = await supabase.from('vk_sessions')
      .select('phone, ai_mode').eq('id', article.session_id).maybeSingle();
    const aiMode = sess?.ai_mode || 'abteilungsleiter';

    const fetch = require('node-fetch');
    const SUPPORTED = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];

    // Fotos laden (max 5)
    const contentBlocks = [];
    for (const p of (article.vk_photos || []).slice(0, 5)) {
      try {
        const imgRes = await fetch(p.public_url);
        const ct = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].toLowerCase();
        if (!SUPPORTED.includes(ct)) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const header = buf.slice(0, 4).toString('hex');
        if (header.startsWith('0000')) continue;
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: ct, data: buf.toString('base64') } });
      } catch(e) { console.error('Doc+foto img load:', e.message); }
    }

    // PDF/Dokument hinzufügen
    contentBlocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: pdf_content_type || 'application/pdf',
        data: pdf_base64
      }
    });

    // Analysefrage
    contentBlocks.push({
      type: 'text',
      text: `Analysiere die Fotos UND das beigefügte Dokument/Dossier gemeinsam.
Extrahiere JEDEN einzelnen technischen Wert, jede Spezifikation, jede Ausstattung aus dem Dokument.
Lies ALLES aus: Maße, Gewichte, Leistungen, Seriennummern, Ausstattung, Zertifikate, Zustand, Preise.

Antworte NUR mit validem JSON:
{
  "extracted_facts": {
    "q_model": "exakter Modellname/Typ aus Dokument (null wenn fehlt)",
    "q_year": "Baujahr (null wenn fehlt)",
    "q_hours": "Betriebsstunden (null wenn fehlt)",
    "q_km": "Kilometerstand (null wenn fehlt)",
    "q_condition": "Zustand laut Dokument (null wenn fehlt)",
    "q_serial": "Seriennummer (null wenn fehlt)"
  },
  "extra_facts": [
    {"key": "Tragkraft", "value": "1500 kg"},
    {"key": "Hubhöhe", "value": "4800 mm"}
  ],
  "document_summary": "Zusammenfassung 2-3 Sätze.",
  "title_update": "Verbesserter Titel mit exaktem Modell oder null"
}

PFLICHT: Jeden Wert aus dem Dokument als eigenen extra_facts Eintrag erfassen.`
    });

    const modelMap = { sachbearbeiter: 'claude-haiku-4-5-20251001', abteilungsleiter: 'claude-sonnet-4-6', experte: 'claude-opus-4-6' };
    const model = modelMap[aiMode] || 'claude-sonnet-4-6';

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: contentBlocks }] })
    });

    const data = await r.json();
    if (data.error) throw new Error(data.error.message);

    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    } catch(e) {
      throw new Error('JSON Parse Fehler bei KI-Antwort: ' + e.message);
    }

    // Antworten zusammenführen (bestehende + neue)
    const existingAnswers = article.answers || {};
    const newAnswers = { ...existingAnswers };
    const facts = parsed.extracted_facts || {};
    Object.entries(facts).forEach(([k, v]) => {
      if (v && v !== 'null' && String(v).length > 0 && v !== 'nicht gefunden' && v !== 'unbekannt') {
        newAnswers[k] = String(v);
      }
    });

    // Extra-Fakten als q_extra speichern
    const extras = (parsed.extra_facts || []).filter(e => e.key && e.value);
    if (extras.length > 0) {
      const existingExtra = newAnswers['q_extra'] ? newAnswers['q_extra'].split('|||') : [];
      const newExtras = extras.map(e => `${e.key}: ${e.value}`);
      newAnswers['q_extra'] = [...existingExtra, ...newExtras].filter(Boolean).join('|||');
    }

    // In DB speichern
    const updateData = { answers: newAnswers };
    if (parsed.title_update) updateData.title = parsed.title_update;

    // Dokument in vk_article_docs speichern
    if (label) {
      await supabase.from('vk_article_docs').insert({
        article_id: req.params.id,
        session_id: article.session_id || null,
        type: pdf_content_type?.includes('pdf') ? 'pdf' : 'doc',
        label: label || 'Dossier',
        public_url: null,
        storage_path: null,
        file_name: label
      });
    }

    await supabase.from('vk_articles').update(updateData).eq('id', req.params.id);

    // DNA automatisch neu generieren mit den neuen Fakten
    if (article.analysis && article.analysis.title_short) {
      vkAutoGenerateDNA(req.params.id, article.analysis, aiMode)
        .catch(e => console.error('DNA after doc-analyze:', e.message));
    }

    const factCount = Object.values(facts).filter(v => v && v !== 'null' && String(v).length > 0).length;
    console.log('analyze-with-doc: ' + factCount + ' Fakten extrahiert für Artikel', req.params.id);

    res.json({
      success: true,
      facts_count: factCount,
      extracted_facts: facts,
      extra_facts: extras,
      document_summary: parsed.document_summary || '',
      title_update: parsed.title_update || null,
      answers: newAnswers
    });

  } catch(e) {
    console.error('analyze-with-doc error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
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

// ── ESKALATIONEN ──────────────────────────────────────────────────────────
app.get('/api/vk/admin/escalations', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_escalations')
      .select('*').order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/escalations/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const { error } = await supabase.from('vk_escalations')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vk/admin/coupons', async (req, res) => { try { const { data, error } = await supabase.from('vk_coupons').select('*').order('created_at', { ascending: false }); if (error) return res.status(500).json({ error: error.message }); res.json(data || []); } catch(e) { res.status(500).json({ error: e.message }); } });
app.post('/api/vk/admin/coupons', async (req, res) => { try { const { code, type, value, max_uses, expires_at, description } = req.body; const finalCode = (code || Math.random().toString(36).substring(2,8)).toUpperCase(); const { data, error } = await supabase.from('vk_coupons').insert({ code: finalCode, type: type || 'free', value: value || 100, max_uses: max_uses || null, expires_at: expires_at || null, description: description || null, active: true, used_count: 0 }).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, coupon: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.put('/api/vk/admin/coupons/:id', async (req, res) => { try { const { data, error } = await supabase.from('vk_coupons').update(req.body).eq('id', req.params.id).select().single(); if (error) return res.status(400).json({ error: error.message }); res.json({ success: true, coupon: data }); } catch(e) { res.status(500).json({ error: e.message }); } });
app.delete('/api/vk/admin/coupons/:id', async (req, res) => { try { await supabase.from('vk_coupons').delete().eq('id', req.params.id); res.json({ success: true }); } catch(e) { res.status(500).json({ error: e.message }); } });
// ── KI CONFIG ENDPOINTS ──────────────────────────────────────
app.get('/api/vk/admin/ai-config', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_ai_config').select('*').order('task_key');
    if (error) return res.status(500).json({ error: error.message, code: error.code });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/ai-config/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_ai_config').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    _aiModelCache = null; // Cache invalidieren
    res.json({ success: true, config: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/ai-config/key/:key', async (req, res) => {
  try {
    const { data, error } = await supabase.from('vk_ai_config').update(req.body).eq('task_key', req.params.key).select().single();
    if (error) return res.status(400).json({ error: error.message });
    _aiModelCache = null;
    res.json({ success: true, config: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO-GRUPPIERUNG ──────────────────────────────────────────
app.post('/api/vk/auto-group', async (req, res) => {
  try {
    const { token, ai_mode } = req.body;
    const { data: session } = await supabase.from('vk_sessions').select('*').eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const { data: articles } = await supabase.from('vk_articles').select('*, vk_photos(*)').eq('session_id', session.id);
    if (!articles || !articles.length) return res.json({ success: true, groups: 0 });
    const allPhotos = [];
    articles.forEach(function(a) { (a.vk_photos || []).forEach(function(p) { allPhotos.push({ ...p, article_id: a.id }); }); });
    if (allPhotos.length < 2) return res.json({ success: true, groups: articles.length });
    const fetch = require('node-fetch');
    const model = AI.analysis;
    const photoSample = allPhotos.slice(0, 20);
    const imageBlocks = [];
    for (const photo of photoSample) {
      try {
        const imgRes = await fetch(photo.public_url);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } });
        imageBlocks.push({ type: 'text', text: '[Foto ID: ' + photo.id + ']' });
      } catch(e) { console.error('Photo fetch error:', e.message); }
    }
    const groupPrompt = 'Du siehst ' + photoSample.length + ' Produktfotos mit IDs. Gruppiere sie: welche Fotos zeigen dasselbe Objekt? Antworte NUR mit JSON: { "groups": [["id1","id2"],["id3"]] }';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1000, messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: groupPrompt }] }] })
    });
    const d = await r.json();
    const text = d.content?.[0]?.text || '{}';
    let groups;
    try { groups = JSON.parse(text.replace(/```json|```/g, '').trim()).groups || []; } catch(e) { return res.json({ success: true, groups: articles.length, note: 'Gruppierung nicht möglich' }); }
    let groupCount = 0;
    for (let i = 0; i < groups.length; i++) {
      const photoIds = groups[i];
      if (!photoIds || !photoIds.length) continue;
      let targetId;
      if (i < articles.length) { targetId = articles[i].id; }
      else {
        const { data: newA } = await supabase.from('vk_articles').insert({ session_id: session.id, title: 'Artikel ' + (i + 1), status: 'pending' }).select().single();
        targetId = newA?.id;
      }
      if (targetId) { await supabase.from('vk_photos').update({ article_id: targetId }).in('id', photoIds); groupCount++; }
    }
    for (const article of articles) {
      const { count } = await supabase.from('vk_photos').select('id', { count: 'exact', head: true }).eq('article_id', article.id);
      if (!count) await supabase.from('vk_articles').delete().eq('id', article.id);
    }
    res.json({ success: true, groups: groupCount });
  } catch(e) { console.error('Auto-group error:', e.message); res.status(500).json({ error: e.message }); }
});
// Foto Reihenfolge speichern
app.put('/api/vk/photo/:id/order', async (req, res) => {
  try {
    const { sort_order } = req.body;
    const { error } = await supabase.from('vk_photos').update({ sort_order }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Foto LP-Sichtbarkeit
app.put('/api/vk/photo/:id/lp', async (req, res) => {
  try {
    const { show_on_lp } = req.body;
    const { error } = await supabase.from('vk_photos').update({ show_on_lp }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── FOTO REIHENFOLGE ─────────────────────────────────────────
app.put('/api/vk/photo/:id/order', async (req, res) => {
  try {
    const { sort_order } = req.body;
    const { error } = await supabase.from('vk_photos').update({ sort_order }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── FOTO LP-SICHTBARKEIT ─────────────────────────────────────
app.put('/api/vk/photo/:id/lp', async (req, res) => {
  try {
    const { show_on_lp } = req.body;
    const { error } = await supabase.from('vk_photos').update({ show_on_lp }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── BOT CONFIG ────────────────────────────────────────────────
app.get('/api/vk/admin/bot-config/:slug', async (req, res) => {
  try {
    const { data } = await supabase.from('vk_landingpages')
      .select('bot_config').eq('slug', req.params.slug).single();
    res.json(data?.bot_config || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vk/admin/bot-config/:slug', async (req, res) => {
  try {
    const { error } = await supabase.from('vk_landingpages')
      .update({ bot_config: req.body })
      .eq('slug', req.params.slug);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── BOT TEMPLATES ─────────────────────────────────────────────
app.get('/api/vk/admin/bot-templates', async (req, res) => {
  try {
    const { data } = await supabase.from('vk_bot_templates')
      .select('*').order('created_at', { ascending: false });
    res.json(data || []);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vk/admin/bot-templates', async (req, res) => {
  try {
    const { name, bot_config } = req.body;
    const { data, error } = await supabase.from('vk_bot_templates')
      .insert({ name, bot_config }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vk/admin/bot-templates/:id', async (req, res) => {
  try {
    await supabase.from('vk_bot_templates')
      .delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ── BOT KI ANALYSE ────────────────────────────────────────────
app.post('/api/vk/admin/bot-ai-analyze/:slug', async (req, res) => {
  try {
    const fetch = require('node-fetch');

    // LP + Artikelanalyse laden
    const { data: lp } = await supabase
      .from('vk_landingpages')
      .select('*, vk_articles(title, analysis)')
      .eq('slug', req.params.slug)
      .maybeSingle();

    if (!lp) return res.status(404).json({ error: 'LP nicht gefunden' });

    const article = lp.vk_articles || {};
    const an = article.analysis || {};

    const productInfo = [
      an.title_short && `Produkt: ${an.title_short}`,
      an.short_desc && `Beschreibung: ${an.short_desc}`,
      an.condition && `Zustand: ${an.condition}`,
      (an.bullet_points||[]).length && `Highlights: ${(an.bullet_points||[]).join(' | ')}`,
      lp.sale_price && `Verkaufspreis: EUR ${lp.sale_price}`,
      an.price_min && `Marktpreis: EUR ${an.price_min} - EUR ${an.price_max || ''}`,
    ].filter(Boolean).join('\n');

    // Prüfen ob Artikelanalyse vorhanden
    if (!productInfo || productInfo.length < 20) {
      console.warn('bot-ai-analyze: productInfo zu kurz:', productInfo);
      return res.status(400).json({ error: 'Artikelanalyse fehlt oder unvollständig. Bitte erst Analyse starten.' });
    }

    const prompt = `Du bist Experte fuer Verkaufspsychologie. Erstelle vollstaendige Bot-Training-Daten fuer dieses Produkt.

${productInfo}

Antworte NUR mit einem JSON-Objekt, kein Markdown, kein erklaerenden Text davor oder danach:
{
  "bot_name": "Max",
  "product_story": "Geschichte und Zustand in 2-3 authentischen Saetzen",
  "emotion": "Was steht dieses Produkt emotional? Was erlebt man als Besitzer? (2-3 Saetze)",
  "fomo": "Ein konkretes Knappheits- oder Dringlichkeitsargument",
  "persona": "Wer kauft das? Alter, Lifestyle, Motivation - konkret",
  "feature_benefits": [
    {"feature": "Technisches Merkmal", "benefit": "Konkreter Alltagsnutzen fuer den Kaeufer"}
  ],
  "product_values": [
    {"label": "Wertbegriff", "meaning": "Was dieser Wert fuer dieses Produkt konkret bedeutet"}
  ],
  "fomo_list": [
    {"situation": "Wann einsetzen", "argument": "Konkretes Argument (1-2 Saetze natuerlich)"}
  ],
  "qa_pairs": [
    {"q": "Typische Kaeufer-Frage", "a": "Praezise Bot-Antwort (1-2 Saetze)"}
  ],
  "exit_strategy_args": [
    {"label": "Bezeichnung", "argument": "Argument warum Kaeufer trotzdem kaufen sollte auch wenn kein weiterer Rabatt moeglich"}
  ],
  "notes": "Wichtige Hinweise max 2 Saetze"
}

Min: 4 feature_benefits, 3 product_values, 3 fomo_list, 4 qa_pairs, 3 exit_strategy_args. Auf Deutsch.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (data.error) {
      console.error('bot-ai-analyze API error:', JSON.stringify(data.error));
      return res.status(500).json({ error: 'API Fehler: ' + data.error.message });
    }

    const text = data.content?.[0]?.text || '';
    if (!text) return res.status(500).json({ error: 'Leere KI-Antwort.' });

    let result;
    try {
      let clean = text.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      let jsonEnd = clean.lastIndexOf('}');
      if (jsonStart === -1) throw new Error('Kein JSON gefunden');

      // JSON abgeschnitten? → reparieren
      if (jsonEnd === -1 || jsonEnd < jsonStart) {
        // Offene Arrays/Objekte schließen
        let partial = clean.substring(jsonStart);
        let openBraces = (partial.match(/{/g)||[]).length - (partial.match(/}/g)||[]).length;
        let openBrackets = (partial.match(/\[/g)||[]).length - (partial.match(/\]/g)||[]).length;
        // Letztes unvollständiges Element entfernen
        const lastComma = partial.lastIndexOf(',');
        const lastComplete = partial.lastIndexOf('"}');
        if (lastComplete > lastComma) {
          partial = partial.substring(0, lastComplete + 2);
        } else if (lastComma > 0) {
          partial = partial.substring(0, lastComma);
        }
        for (let i = 0; i < openBrackets; i++) partial += ']';
        for (let i = 0; i < openBraces; i++) partial += '}';
        clean = partial;
      } else {
        clean = clean.substring(jsonStart, jsonEnd + 1);
      }
      result = JSON.parse(clean);
    } catch(e) {
      console.error('bot-ai-analyze JSON parse error:', e.message, 'Raw:', text.substring(0, 300));
      return res.status(500).json({ error: 'JSON Parse Fehler: ' + e.message });
    }

    // Fehlende Felder mit Defaults befüllen
    result.feature_benefits = result.feature_benefits || [];
    result.product_values = result.product_values || [];
    result.fomo_list = result.fomo_list || [];
    result.qa_pairs = result.qa_pairs || [];
    result.exit_strategy_args = result.exit_strategy_args || [];

    res.json(result);
  } catch(e) {
    console.error('bot-ai-analyze error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// ── BOT AI REFINE ─────────────────────────────────────────────
app.post('/api/vk/admin/bot-ai-refine', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const { field, current_value, instruction, product_context } = req.body;

    const fieldLabels = {
      emotion:       'Emotionaler Verkaufspitch (wofür steht das Produkt)',
      fomo:          'FOMO / Dringlichkeitsargument (warum jetzt kaufen)',
      persona:       'Zielgruppe (wer kauft das typischerweise)',
      product_story: 'Produktgeschichte und Zustand',
      notes:         'Hinweise für den Verkaufsbot'
    };

    const label = fieldLabels[field] || field;

    const prompt = `Du bist Experte für Verkaufspsychologie.
Verbessere diesen Text für ein Bot-Training-Feld: "${label}"

AKTUELLER TEXT:
"${current_value || '(leer)'}"

ANWEISUNG:
${instruction}

Schreibe NUR den verbesserten Text, ohne Anführungszeichen, ohne Erklärung, ohne Präambel.
Sprache: Deutsch. Max 3 Sätze. Natürlich, nicht marketingmäßig.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const result = data.content?.[0]?.text?.trim() || '';
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
// ── BOT KI LIST GENERATOR ─────────────────────────────────────
app.post('/api/vk/admin/bot-ai-list', async (req, res) => {
  try {
    const fetch = require('node-fetch');
    const { type, hint, slug } = req.body;

    // Load product info if slug provided
    let productInfo = '';
    if (slug) {
      const { data: lp } = await supabase
        .from('vk_landingpages')
        .select('*, vk_articles(title, analysis)')
        .eq('slug', slug).maybeSingle();
      if (lp?.vk_articles?.analysis) {
        const an = lp.vk_articles.analysis;
        productInfo = [
          an.title_short && `Produkt: ${an.title_short}`,
          an.short_desc && `Beschreibung: ${an.short_desc}`,
          (an.bullet_points||[]).length && `Highlights: ${(an.bullet_points||[]).join(', ')}`,
        ].filter(Boolean).join('\n');
      }
    }

    let prompt;
    if (type === 'values') {
  prompt = `Analysiere dieses Produkt und erstelle eine Liste der Kernwerte die es verkörpert.
${productInfo}
${hint ? `Hinweis: ${hint}` : ''}

Antworte NUR mit JSON:
{"items":[{"label":"Wert/Begriff","meaning":"Was das für dieses Produkt konkret bedeutet (1 Satz)"}]}

Erstelle 6-8 Werte. Beispiele: Pioniergeist, Exklusivität, Kompetenz, Status, Zeitlosigkeit, Handwerkskunst, Verlässlichkeit.`;
} else if (type === 'fomo_list') {
  prompt = `Erstelle situative Dringlichkeitsargumente für einen Verkaufsbot.
${productInfo}
${hint ? `Hinweis: ${hint}` : ''}

Antworte NUR mit JSON:
{"items":[{"situation":"Wann einsetzen","argument":"Konkretes Argument (1-2 Sätze, natürlich)"}]}

Erstelle 5-6 verschiedene FOMO Argumente für verschiedene Situationen (zögert, will Rabatt, hat andere gesehen, wartet ab).`;
} else
    if (type === 'fn') {
      prompt = `Du bist Verkaufsexperte. Erstelle Feature→Nutzen Paare für einen WhatsApp-Verkaufsbot.
${productInfo ? `\nProduktinfo:\n${productInfo}` : ''}
${hint ? `\nHinweis: ${hint}` : ''}

Erstelle 5-7 Paare. Nutzen = konkreter Alltagsvorteil, keine Marketing-Sprache.

Antworte NUR mit JSON, kein Markdown:
{"items":[{"feature":"Technisches Merkmal","benefit":"Konkreter Nutzen in Alltagssprache"}]}`;
    } else {
      prompt = `Du bist Verkaufsexperte. Erstelle typische Käufer-FAQ für einen WhatsApp-Verkaufsbot.
${productInfo ? `\nProduktinfo:\n${productInfo}` : ''}
${hint ? `\nHinweis: ${hint}` : ''}

Erstelle 5-7 realistische Fragen die Käufer stellen + präzise kurze Antworten.

Antworte NUR mit JSON, kein Markdown:
{"items":[{"q":"Frage des Käufers","a":"Antwort des Bots (1-2 Sätze, natürlich)"}]}`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '{"items":[]}';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});
