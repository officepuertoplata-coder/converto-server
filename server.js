require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://officepuertoplata-coder.github.io/converdino';

// ── SUPABASE ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── STRIPE ────────────────────────────────────────────────
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use('/webhook/stripe', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', platform: 'Converdino API', version: '3.0.0' });
});
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', platform: 'Converdino API', version: '3.0.0' });
});

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

async function sendWhatsApp(to, message) {
  try {
    const fetch = require('node-fetch');
    let cleanTo = to.replace('whatsapp:', '').replace(/\s/g, '');
    if (cleanTo.startsWith('+')) cleanTo = cleanTo.substring(1);

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${process.env.META_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}`,
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
    console.log('WhatsApp API response:', data.messages ? 'messaging_product: whatsapp' : JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('sendWhatsApp error:', e.message);
  }
}

// ── VK Preis berechnen ────────────────────────────────────
function vkCalcPrice(articles) {
  let total = 0;
  for (const article of articles) {
    const photoCount = article.photo_count ?? (article.vk_photos ? article.vk_photos.length : 0);
    const basePrice = 1.50;
    const photoExtra = Math.max(0, photoCount - 1) * 0.50;
    const extendedExtra = article.extended ? 1.00 : 0;
    total += basePrice + photoExtra + extendedExtra;
  }
  return Math.round(total * 100) / 100;
}

// ── VK Rabatt berechnen ───────────────────────────────────
function vkCalcDiscount(coupon, price) {
  let discount = 0;
  let isFree = false;
  if (coupon.type === 'percent') {
    discount = Math.round(price * coupon.value / 100 * 100) / 100;
  } else if (coupon.type === 'fixed') {
    discount = Math.min(coupon.value, price);
  } else if (coupon.type === 'free') {
    discount = price;
    isFree = true;
  }
  return { discount, isFree };
}

// ── VK Foto in Supabase Storage hochladen ─────────────────
async function vkUploadPhoto(imageUrl, sessionId, articleId) {
  const fetch = require('node-fetch');
  const imgRes = await fetch(imageUrl);
  const arrayBuffer = await imgRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const path = `${sessionId}/${articleId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error('Storage upload: ' + error.message);
  const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
  return { path, url: urlData.publicUrl };
}

// ── VK Marktvergleich (Web Search) ────────────────────────
async function vkMarketSearch(productTitle, phone) {
  try {
    const fetch = require('node-fetch');
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    const isDE = cleanPhone.startsWith('49');
    const region = isDE ? 'Deutschland' : 'Österreich';
    const platforms = isDE
      ? 'eBay Kleinanzeigen (kleinanzeigen.de), Shpock Deutschland'
      : 'Willhaben (willhaben.at), eBay.at, Shpock Österreich';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `Du bist ein Marktanalyse-Experte fuer Online-Kleinanzeigen in ${region}. Suche aktiv und grosszuegig nach Vergleichspreisen. Antworte IMMER nur mit validem JSON, kein Markdown, keine Erklaerungen.`,
        messages: [{
          role: 'user',
          content: `Suche nach aktuellen Vergleichsangeboten fuer "${productTitle}" auf ${platforms} (nur ${region}, keine internationalen Ergebnisse). Erstelle folgendes JSON:\n{\n  "found": true/false,\n  "platform": "Plattform wo gefunden z.B. Willhaben",\n  "listings_count": 0,\n  "price_range_min": 0,\n  "price_range_max": 0,\n  "price_avg": 0,\n  "assessment": "Kurze Einschaetzung (1 Satz)",\n  "note": ""\n}\n\nWenn nichts gefunden: found:false, note:"Derzeit keine vergleichbaren Angebote in ${region} gefunden."`
        }]
      })
    });
    const data = await response.json();
    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock || !textBlock.text) return { found: false, note: `Derzeit keine vergleichbaren Angebote in ${region} gefunden.` };
    try {
      const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim());
      console.log('Market search result for "' + productTitle + '":', JSON.stringify(parsed));
      return parsed;
    } catch (e) {
      return { found: false, note: `Derzeit keine vergleichbaren Angebote in ${region} gefunden.` };
    }
  } catch (e) {
    console.error('vkMarketSearch error:', e.message);
    return { found: false, note: 'Marktvergleich temporaer nicht verfuegbar.' };
  }
}

// ── VK Artikel analysieren (Claude Vision) ────────────────
async function vkAnalyzeArticle(article, photos, phone) {
  const fetch = require('node-fetch');
  const imageBlocks = photos.map(p => ({
    type: 'image',
    source: { type: 'url', url: p.public_url }
  }));
  const notesText = article.notes ? `\nZusatzinfos vom Verkaeufer (hoechste Prioritaet): ${article.notes}` : '';

  // Faelschungsrelevante Kategorien → Authentizitaetspruefung
  const AUTH_CATS = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
  const needsAuth = AUTH_CATS.includes(article.article_category || '');

  const authBlock = needsAuth
    ? `  "authenticity": {
    "score": 0-100,
    "verdict": "authentic" ODER "suspicious" ODER "cannot_determine",
    "positive_indicators": ["sichtbares positives Merkmal 1"],
    "flags": ["sichtbare Auffaelligkeit 1"],
    "warning": "Kurze Warnung auf Deutsch wenn verdaechtig, sonst null",
    "checked_features": ["Seriennummer", "Logo", "Material", "Naehte", "Verpackung"]
  }`
    : '  "authenticity": null';

  const authInstructions = needsAuth
    ? `\n\nWICHTIG fuer authenticity score (Kategorie: ${article.article_category}):\n- Pruefe ALLE sichtbaren Echtheitsindikatoren auf den Fotos\n- Score 80-100: Merkmale sprechen klar fuer Echtheit\n- Score 60-79: Grossteils OK, leichte Auffaelligkeiten\n- Score 40-59: Deutliche Auffaelligkeiten sichtbar\n- Score 0-39: Starker Faelschungsverdacht\n- Sei ehrlich und streng – lieber niedrigerer Score als falsches Vertrauen`
    : '';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `Du bist ein Experte fuer Online-Verkauf (eBay, Willhaben, Kleinanzeigen, Facebook Marketplace). Analysiere die Produktfotos und erstelle einen professionellen Verkaufsbericht.

ZUSTAND & PREISREGELN (PFLICHT):
1. Bestimme ZUERST den genauen Zustand aus Fotos und Verkaeufernotizen
2. Berechne den Preis nach diesen Regeln:
   - NEU, aktuelles Modell (OVP, ungetragen, frisch gekauft): 90-100% vom Neupreis – wir verkaufen auch neue Artikel!
   - NEU/OVP aber alt oder auslaufendes Modell: 60-85% je nach Alter und Marktverfuegbarkeit
   - Neuwertig (kaum getragen, keine sichtbaren Spuren): 75-85% vom Neupreis
   - Sehr gut (wenig Gebrauchsspuren): 60-75% vom Neupreis
   - Gut (normale Gebrauchsspuren): 45-60% vom Neupreis
   - Gebraucht (sichtbare Maengel): 30-45% vom Neupreis
3. Lies Marke und Modell EXAKT von Fotos und Notizen ab
4. Realistische AT/DE Marktpreise (Willhaben, Chrono24, Kleinanzeigen)
5. Zusatzinfos vom Verkaeufer haben HOECHSTE Prioritaet fuer Modell, Neupreis und Zustand

Antworte NUR mit validem JSON, kein Markdown, keine Erklaerungen.`,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          {
            type: 'text',
            text: `Analysiere dieses Produkt und erstelle folgendes JSON:${notesText}\n{\n  "title_short": "Kurztitel (max 60 Zeichen, SEO-optimiert)",\n  "title_long": "Ausfuehrlicher Titel mit Keywords",\n  "title_quick": "Quick-Sale Titel",\n  "short_desc": "2-3 Saetze Kurzbeschreibung",\n  "long_desc": "Ausfuehrliche Beschreibung",\n  "bullet_points": ["Highlight 1", "Highlight 2", "Highlight 3"],\n  "price_min": 0,\n  "price_max": 0,\n  "price_recommended": 0,\n  "price_reasoning": "Begruendung mit Zustand und Neupreis",\n  "condition": "Zustandsbeschreibung",\n  "keywords": ["keyword1", "keyword2"],\n  "tips": ["Verkaufstipp 1", "Verkaufstipp 2"],\n  "article_category": "luxury_watch ODER luxury_bag ODER jewelry ODER electronics ODER vehicle ODER art ODER standard",\n${authBlock}\n}${authInstructions}`
          }
        ]
      }]
    })
  });

  const data = await response.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    // Marktvergleich async hinzufügen
    try {
      const market = await vkMarketSearch(analysis.title_short || article.title || 'Produkt', phone);
      analysis.market = market;
    } catch (e) {
      console.log('Market search skipped:', e.message);
      analysis.market = { found: false, note: 'Marktvergleich nicht verfuegbar.' };
    }
    return analysis;
  } catch (e) {
    console.error('vkAnalyzeArticle parse error:', e.message, 'raw:', text.substring(0, 200));
    return { error: 'Analyse konnte nicht geparst werden', raw: text.substring(0, 200) };
  }
}

// ── VK WhatsApp Analyse-Ergebnis senden ───────────────────
async function vkSendResult(session, articles) {
  const baseUrl = BASE_URL.replace('github.io/converdino', 'converdino.com');
  const resultUrl = `https://converdino.com/ergebnis.html?token=${session.token}`;
  const count = articles.length;
  const priceStr = session.total_price > 0 ? `${session.total_price}€` : 'kostenlos';
  const msg =
    `✅ *Ihr Verkaufsreport ist fertig!*\n\n` +
    `Wir haben ${count} Artikel analysiert.\n\n` +
    `📊 Ihr persönlicher Report:\n${resultUrl}\n\n` +
    `_Ihr Report ist 48 Stunden verfügbar._`;
  await sendWhatsApp(session.phone, msg);
}

// ═══════════════════════════════════════════════════════════
// WHATSAPP WEBHOOK
// ═══════════════════════════════════════════════════════════

app.get('/webhook/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('WhatsApp Webhook verifiziert');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    if (!messages?.length) return;

    const msg = messages[0];
    const from = msg.from;
    const msgType = msg.type;

    console.log(`WhatsApp message from ${from}, type: ${msgType}`);

    // Foto empfangen → VK Session anlegen oder Foto hinzufügen
    if (msgType === 'image') {
      await vkHandleIncomingPhoto(from, msg.image);
      return;
    }

    // Text-Nachricht verarbeiten
    if (msgType === 'text') {
      const text = (msg.text?.body || '').trim().toUpperCase();

      // Opt-in Flow
      if (text === 'INFO' || text === 'START') {
        await sendWhatsApp(from,
          `Willkommen bei Converdino Verkaufsreport! 📦\n\n` +
          `Schicken Sie uns einfach Fotos Ihrer Artikel – wir erstellen einen professionellen Verkaufsbericht mit:\n\n` +
          `• Optimierter Titel & Beschreibung\n` +
          `• Preisempfehlung\n` +
          `• Verkaufstipps\n\n` +
          `Einfach Foto schicken und loslegen! 📸`
        );
        return;
      }
    }
  } catch (e) {
    console.error('WhatsApp webhook error:', e);
  }
});

// ── VK: Eingehendes Foto von WhatsApp verarbeiten ─────────
async function vkHandleIncomingPhoto(phone, imageData) {
  try {
    const fetch = require('node-fetch');

    // Meta Bild-URL abrufen
    const mediaRes = await fetch(
      `https://graph.facebook.com/v18.0/${imageData.id}`,
      { headers: { 'Authorization': `Bearer ${process.env.META_ACCESS_TOKEN}` } }
    );
    const mediaData = await mediaRes.json();
    const imageUrl = mediaData.url;

    // Existierende offene Session suchen
    let { data: session } = await supabase.from('vk_sessions')
      .select('*, vk_articles(id, vk_photos(id))')
      .eq('phone', phone)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Neue Session anlegen wenn keine offen
    if (!session) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const { data: newSession } = await supabase.from('vk_sessions').insert({
        token, phone, status: 'open', expires_at: expiresAt
      }).select().single();
      session = newSession;
      session.vk_articles = [];
    }

    // Artikel zählen und letzten finden
    const articles = session.vk_articles || [];
    let targetArticle = null;

    // Letzter Artikel mit < 4 Fotos
    for (const art of articles.slice().reverse()) {
      const photoCount = (art.vk_photos || []).length;
      if (photoCount < 4) { targetArticle = art; break; }
    }

    // Neuen Artikel anlegen wenn kein Platz
    if (!targetArticle) {
      const { data: newArt } = await supabase.from('vk_articles').insert({
        session_id: session.id,
        title: `Artikel ${articles.length + 1}`,
        sort_order: articles.length + 1
      }).select().single();
      targetArticle = newArt;
      targetArticle.vk_photos = [];
    }

    // Foto hochladen
    const { path, url } = await vkUploadPhoto(imageUrl, session.id, targetArticle.id);
    const photoCount = (targetArticle.vk_photos || []).length;
    await supabase.from('vk_photos').insert({
      article_id: targetArticle.id,
      session_id: session.id,
      storage_path: path,
      public_url: url,
      source: 'whatsapp',
      sort_order: photoCount + 1
    });

    console.log(`VK massenupload: photo ${photoCount + 1} for session ${session.token}`);

    // Nachricht zurücksenden
    const sessionUrl = `https://converdino.com/bericht.html?token=${session.token}`;
    const totalPhotos = articles.reduce((s, a) => s + (a.vk_photos || []).length, 0) + 1;

    await sendWhatsApp(phone,
      `📸 Foto ${totalPhotos} empfangen!\n\n` +
      `Weitere Fotos senden oder hier zur Übersicht:\n${sessionUrl}\n\n` +
      `_Artikel werden automatisch gruppiert._`
    );
  } catch (e) {
    console.error('vkHandleIncomingPhoto error:', e);
  }
}

// ═══════════════════════════════════════════════════════════
// VK SESSION ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Session laden
app.get('/api/vk/session/:token', async (req, res) => {
  try {
    const { data: session, error } = await supabase.from('vk_sessions')
      .select(`
        *,
        vk_articles (
          id, title, extended, notes, status, sort_order, analysis,
          vk_photos ( id, public_url, storage_path, sort_order, article_id )
        )
      `)
      .eq('token', req.params.token)
      .single();
    if (error || !session) return res.status(404).json({ error: 'Session nicht gefunden' });

    // Artikel sortieren
    if (session.vk_articles) {
      session.vk_articles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      for (const art of session.vk_articles) {
        if (art.vk_photos) art.vk_photos.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      }
    }

    const articles = (session.vk_articles || []).map(a => ({
      ...a,
      photo_count: (a.vk_photos || []).length
    }));
    const price = vkCalcPrice(articles);
    res.json({ ...session, vk_articles: articles, articles: articles, calculated_price: price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Artikel hinzufügen
app.post('/api/vk/session/:token/article', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select('id, vk_articles(id)')
      .eq('token', req.params.token)
      .single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const count = (session.vk_articles || []).length;
    const { data: article } = await supabase.from('vk_articles').insert({
      session_id: session.id,
      title: `Artikel ${count + 1}`,
      sort_order: count + 1
    }).select().single();
    res.json(article);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Artikel extended umschalten
app.put('/api/vk/article/:id/extended', async (req, res) => {
  try {
    const { extended } = req.body;
    const { error } = await supabase.from('vk_articles')
      .update({ extended })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Artikel Notiz / Titel speichern
app.put('/api/vk/article/:id/notes', async (req, res) => {
  try {
    const { notes, title } = req.body;
    const update = {};
    if (notes !== undefined) update.notes = notes;
    if (title !== undefined) update.title = title;
    const { error } = await supabase.from('vk_articles').update(update).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Foto zu anderem Artikel verschieben
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

// Artikel löschen
app.delete('/api/vk/article/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('vk_articles').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Foto hochladen (Upload aus Browser)
app.post('/api/vk/article/:id/photo', async (req, res) => {
  try {
    const { image_url, image_base64, content_type } = req.body;
    const article = await supabase.from('vk_articles')
      .select('id, session_id, vk_photos(id)')
      .eq('id', req.params.id)
      .single();
    if (!article.data) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    if ((article.data.vk_photos || []).length >= 4)
      return res.status(400).json({ error: 'Maximal 4 Fotos pro Artikel' });

    let photoUrl, storagePath;
    if (image_base64) {
      const buffer = Buffer.from(image_base64, 'base64');
      const ct = content_type || 'image/jpeg';
      const ext = ct.includes('png') ? 'png' : 'jpg';
      const path = `${article.data.session_id}/${article.data.id}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType: ct, upsert: false });
      if (error) return res.status(500).json({ error: error.message });
      const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
      photoUrl = urlData.publicUrl;
      storagePath = path;
    } else if (image_url) {
      const result = await vkUploadPhoto(image_url, article.data.session_id, article.data.id);
      photoUrl = result.url;
      storagePath = result.path;
    } else {
      return res.status(400).json({ error: 'Kein Bild übermittelt' });
    }

    const sortOrder = (article.data.vk_photos || []).length + 1;
    const { data: photo } = await supabase.from('vk_photos').insert({
      article_id: article.data.id,
      session_id: article.data.session_id,
      storage_path: storagePath,
      public_url: photoUrl,
      source: 'upload',
      sort_order: sortOrder
    }).select().single();
    res.json(photo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Foto löschen
app.delete('/api/vk/photo/:id', async (req, res) => {
  try {
    const { data: photo } = await supabase.from('vk_photos')
      .select('storage_path').eq('id', req.params.id).single();
    if (photo?.storage_path) {
      await supabase.storage.from('vk-photos').remove([photo.storage_path]);
    }
    await supabase.from('vk_photos').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// VK CHECKOUT & ZAHLUNG
// ═══════════════════════════════════════════════════════════

app.post('/api/vk/checkout', async (req, res) => {
  try {
    const { token } = req.body;
    const { data: session } = await supabase.from('vk_sessions')
      .select('*, vk_articles(id, extended, vk_photos(id))')
      .eq('token', token)
      .single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    const articles = (session.vk_articles || []).map(a => ({
      ...a,
      photo_count: (a.vk_photos || []).length
    }));
    const price = vkCalcPrice(articles);
    if (price <= 0) return res.status(400).json({ error: 'Preis ungültig' });

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Converdino Verkaufsreport (${articles.length} Artikel)`,
            description: 'Professionelle KI-Analyse Ihrer Verkaufsartikel'
          },
          unit_amount: Math.round(price * 100)
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `https://converdino.com/bericht.html?token=${token}&paid=1`,
      cancel_url: `https://converdino.com/bericht.html?token=${token}`,
      metadata: { vk_token: token, vk_session_id: session.id }
    });

    await supabase.from('vk_sessions').update({
      stripe_session_id: checkoutSession.id,
      total_price: price
    }).eq('id', session.id);

    res.json({ url: checkoutSession.url });
  } catch (e) {
    console.error('Checkout error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// GUTSCHEIN SYSTEM
// ═══════════════════════════════════════════════════════════

app.post('/api/vk/coupon/validate', async (req, res) => {
  try {
    const { code, token } = req.body;
    if (!code) return res.status(400).json({ error: 'Code fehlt' });

    const { data: coupon, error } = await supabase.from('vk_coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .single();
    if (error || !coupon) return res.status(404).json({ error: 'Ungültiger Code' });
    if (!coupon.active) return res.status(400).json({ error: 'Code ist nicht mehr aktiv' });
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
      return res.status(400).json({ error: 'Code ist abgelaufen' });
    if (coupon.max_uses && coupon.used_count >= coupon.max_uses)
      return res.status(400).json({ error: 'Code wurde bereits zu oft verwendet' });

    let discount = 0;
    let isFree = false;
    if (token) {
      const { data: session } = await supabase.from('vk_sessions')
        .select('*, vk_articles(id, extended, vk_photos(id))')
        .eq('token', token).single();
      if (session) {
        const articles = (session.vk_articles || []).map(a => ({
          ...a, photo_count: (a.vk_photos || []).length
        }));
        const price = vkCalcPrice(articles);
        const result = vkCalcDiscount(coupon, price);
        discount = result.discount;
        isFree = result.isFree;
      }
    }

    res.json({
      success: true,
      coupon: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount,
        is_free: isFree,
        description: coupon.description
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vk/coupon/redeem', async (req, res) => {
  try {
    const { code, token } = req.body;
    const { data: coupon } = await supabase.from('vk_coupons')
      .select('*').eq('code', code.toUpperCase().trim()).single();
    if (!coupon) return res.status(404).json({ error: 'Ungültiger Code' });

    const { data: session } = await supabase.from('vk_sessions')
      .select('*, vk_articles(id, extended, vk_photos(id))')
      .eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    const articles = (session.vk_articles || []).map(a => ({
      ...a, photo_count: (a.vk_photos || []).length
    }));
    const price = vkCalcPrice(articles);
    const { discount, isFree } = vkCalcDiscount(coupon, price);
    const finalPrice = Math.max(0, price - discount);

    await supabase.from('vk_coupons')
      .update({ used_count: (coupon.used_count || 0) + 1 }).eq('id', coupon.id);
    try {
      await supabase.from('vk_coupon_uses').insert({
        coupon_id: coupon.id, session_id: session.id, discount
      });
    } catch (e) { console.log('coupon_uses insert skipped:', e.message); }

    if (finalPrice === 0 || isFree) {
      await supabase.from('vk_sessions').update({
        status: 'analyzing',
        paid_at: new Date().toISOString(),
        total_price: 0,
        coupon_code: code.toUpperCase()
      }).eq('id', session.id);

      // Analyse async starten
      (async () => {
        try {
          const { data: arts } = await supabase.from('vk_articles')
            .select('*, vk_photos(*)').eq('session_id', session.id);
          for (const article of (arts || [])) {
            if (!(article.vk_photos || []).length) continue;
            const analysis = await vkAnalyzeArticle(article, article.vk_photos, session.phone);
            const AUTH_CATS_U = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
            const authU = analysis.authenticity || {};
            const authScoreU = (authU && authU.score != null) ? authU.score : null;
            const compU = analysis.compliance || {};
            const needsAuthReviewU = authScoreU !== null && authScoreU < 60 && AUTH_CATS_U.includes(analysis.article_category || '');
            await supabase.from('vk_articles').update({
              analysis, status: 'analyzed',
              article_category: analysis.article_category || 'standard',
              compliance_status: compU.blocked ? 'blocked' : (needsAuthReviewU ? 'needs_review' : 'approved'),
              authenticity_score: authScoreU,
              authenticity_verdict: authU.verdict || null,
              authenticity_flags: authU.flags || [],
              authenticity_warning: authU.warning || null
            }).eq('id', article.id);
          }
          const anyExtended = (arts || []).some(a => a.extended);
          const days = anyExtended ? 14 : 7;
          const deleteAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
          await supabase.from('vk_sessions').update({
            status: 'done',
            analyzed_at: new Date().toISOString(),
            delete_at: deleteAt
          }).eq('id', session.id);
          await vkSendResult(session, arts || []);
        } catch (e) {
          console.error('Async analysis error:', e);
          await supabase.from('vk_sessions')
            .update({ status: 'error' }).eq('id', session.id);
        }
      })();

      return res.json({
        success: true,
        free: true,
        message: 'Gutschein eingelöst! Analyse wird gestartet.'
      });
    }

    res.json({ success: true, free: false, final_price: finalPrice, discount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// VK ERGEBNIS
// ═══════════════════════════════════════════════════════════

app.get('/api/vk/result/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select(`
        *,
        vk_articles (
          id, title, extended, notes, status, sort_order, analysis,
          vk_photos ( id, public_url, sort_order, article_id )
        )
      `)
      .eq('token', req.params.token)
      .single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'done' && session.status !== 'analyzing')
      return res.status(400).json({ error: 'Analyse noch nicht abgeschlossen', status: session.status });

    if (session.vk_articles) {
      session.vk_articles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      for (const art of session.vk_articles) {
        if (art.vk_photos) art.vk_photos.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      }
    }

    if (!session.result_viewed_at) {
      await supabase.from('vk_sessions')
        .update({ result_viewed_at: new Date().toISOString() }).eq('id', session.id);
    }

    res.json(session);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════

// Auth (einfach)
app.post('/api/vk/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD && password !== process.env.SUPERADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  res.json({ success: true });
});

// Alle Sessions
app.get('/api/vk/admin/sessions', async (req, res) => {
  try {
    const { data: sessions } = await supabase.from('vk_sessions')
      .select(`
        *,
        vk_articles (
          id, title, extended, status, sort_order, analysis,
          vk_photos ( id, public_url, sort_order )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);
    res.json(sessions || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Statistiken
app.get('/api/vk/admin/stats', async (req, res) => {
  try {
    const { data: sessions } = await supabase.from('vk_sessions').select('*');
    const all = sessions || [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    res.json({
      total: all.length,
      today: all.filter(s => new Date(s.created_at) >= today).length,
      this_month: all.filter(s => new Date(s.created_at) >= thisMonth).length,
      revenue_total: all.filter(s => s.paid_at).reduce((t, s) => t + (parseFloat(s.total_price) || 0), 0),
      revenue_month: all.filter(s => s.paid_at && new Date(s.paid_at) >= thisMonth)
        .reduce((t, s) => t + (parseFloat(s.total_price) || 0), 0),
      by_status: {
        open: all.filter(s => s.status === 'open').length,
        paid: all.filter(s => s.status === 'paid').length,
        analyzing: all.filter(s => s.status === 'analyzing').length,
        done: all.filter(s => s.status === 'done').length,
        expired: all.filter(s => s.status === 'expired').length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analyse manuell starten
app.post('/api/vk/admin/analyze/:sessionId', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select('*').eq('id', req.params.sessionId).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });

    await supabase.from('vk_sessions')
      .update({ status: 'analyzing' }).eq('id', session.id);
    res.json({ success: true, message: 'Analyse gestartet' });

    (async () => {
      try {
        const { data: articles } = await supabase.from('vk_articles')
          .select('*, vk_photos(*)').eq('session_id', session.id);
        for (const article of (articles || [])) {
          const photos = article.vk_photos || [];
          if (!photos.length) continue;
          const analysis = await vkAnalyzeArticle(article, photos, session.phone);
          const AUTH_CATS_A = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
          const authA = analysis.authenticity || {};
          const authScoreA = (authA && authA.score != null) ? authA.score : null;
          await supabase.from('vk_articles').update({
            analysis, status: 'analyzed',
            article_category: analysis.article_category || 'standard',
            authenticity_score: authScoreA,
            authenticity_verdict: authA.verdict || null,
            authenticity_flags: authA.flags || [],
            authenticity_warning: authA.warning || null
          }).eq('id', article.id);
        }
        const anyExtended = (articles || []).some(a => a.extended);
        const days = anyExtended ? 14 : 7;
        const deleteAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from('vk_sessions').update({
          status: 'done',
          analyzed_at: new Date().toISOString(),
          delete_at: deleteAt
        }).eq('id', session.id);
        await vkSendResult(session, articles || []);
      } catch (e) {
        console.error('Admin analyze error:', e);
        await supabase.from('vk_sessions')
          .update({ status: 'error' }).eq('id', session.id);
      }
    })();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: Gutscheine ─────────────────────────────────────

app.get('/api/vk/admin/coupons', async (req, res) => {
  try {
    const { data } = await supabase.from('vk_coupons')
      .select('*').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vk/admin/coupons', async (req, res) => {
  try {
    const { code, type, value, description, max_uses, expires_at, active } = req.body;
    if (!code || !type || value === undefined)
      return res.status(400).json({ error: 'code, type, value sind Pflichtfelder' });
    const { data, error } = await supabase.from('vk_coupons').insert({
      code: code.toUpperCase().trim(),
      type, value,
      description: description || null,
      max_uses: max_uses || null,
      expires_at: expires_at || null,
      active: active !== false,
      used_count: 0
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/vk/admin/coupons/:id', async (req, res) => {
  try {
    const { active, description, max_uses, expires_at, value } = req.body;
    const update = {};
    if (active !== undefined) update.active = active;
    if (description !== undefined) update.description = description;
    if (max_uses !== undefined) update.max_uses = max_uses;
    if (expires_at !== undefined) update.expires_at = expires_at;
    if (value !== undefined) update.value = value;
    const { data, error } = await supabase.from('vk_coupons')
      .update(update).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/vk/admin/coupons/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('vk_coupons').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════
// STRIPE WEBHOOK
// ═══════════════════════════════════════════════════════════

app.post('/webhook/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.json({ received: true });

  if (event.type === 'checkout.session.completed') {
    const stripeSession = event.data.object;
    try {
      const vkToken = stripeSession.metadata?.vk_token;
      const vkSessionId = stripeSession.metadata?.vk_session_id;

      if (vkToken && vkSessionId) {
        // Verkaufsreport bezahlt
        await supabase.from('vk_sessions').update({
          status: 'analyzing',
          paid_at: new Date().toISOString(),
          total_price: (stripeSession.amount_total || 0) / 100
        }).eq('id', vkSessionId);

        const { data: session } = await supabase.from('vk_sessions')
          .select('*').eq('id', vkSessionId).single();

        // Analyse async starten
        (async () => {
          try {
            const { data: articles } = await supabase.from('vk_articles')
              .select('*, vk_photos(*)').eq('session_id', vkSessionId);
            for (const article of (articles || [])) {
              const photos = article.vk_photos || [];
              if (!photos.length) continue;
              const analysis = await vkAnalyzeArticle(article, photos, session?.phone);
              const AUTH_CATS_S = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
              const authS = analysis.authenticity || {};
              const authScoreS = (authS && authS.score != null) ? authS.score : null;
              await supabase.from('vk_articles').update({
                analysis, status: 'analyzed',
                article_category: analysis.article_category || 'standard',
                authenticity_score: authScoreS,
                authenticity_verdict: authS.verdict || null,
                authenticity_flags: authS.flags || [],
                authenticity_warning: authS.warning || null
              }).eq('id', article.id);
            }
            const anyExtended = (articles || []).some(a => a.extended);
            const days = anyExtended ? 14 : 7;
            const deleteAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
            await supabase.from('vk_sessions').update({
              status: 'done',
              analyzed_at: new Date().toISOString(),
              delete_at: deleteAt
            }).eq('id', vkSessionId);
            if (session) await vkSendResult(session, articles || []);
          } catch (e) {
            console.error('Post-payment analysis error:', e);
            await supabase.from('vk_sessions')
              .update({ status: 'error' }).eq('id', vkSessionId);
          }
        })();
      }
    } catch (e) {
      console.error('Stripe webhook processing error:', e);
    }
  }
});

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════


// ── Artikel neu analysieren ────────────────────────────────────────────
app.post('/api/vk/article/:id/reanalyze', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: article } = await supabase.from('vk_articles')
      .select('*, vk_photos(*), vk_sessions(phone)')
      .eq('id', id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    await supabase.from('vk_articles').update({ status: 'pending' }).eq('id', id);
    res.json({ success: true, message: 'Neuanalyse gestartet' });
    (async () => {
      try {
        const phone = article.vk_sessions?.phone || null;
        const analysis = await vkAnalyzeArticle(article, article.vk_photos || [], phone);
        const AUTH_CATS_R = ['luxury_watch', 'luxury_bag', 'jewelry', 'art', 'electronics'];
        const authR = analysis.authenticity || {};
        const authScoreR = (authR && authR.score != null) ? authR.score : null;
        await supabase.from('vk_articles').update({
          analysis, status: 'analyzed',
          article_category: analysis.article_category || 'standard',
          authenticity_score: authScoreR,
          authenticity_verdict: authR.verdict || null,
          authenticity_flags: authR.flags || [],
          authenticity_warning: authR.warning || null
        }).eq('id', id);
        // Marktvergleich im Hintergrund
        try {
          const market = await vkMarketSearch(analysis.title_short || article.title || 'Produkt', phone);
          const currentAnalysis = await supabase.from('vk_articles').select('analysis').eq('id', id).single();
          if (currentAnalysis.data) {
            const updated = { ...currentAnalysis.data.analysis, market };
            await supabase.from('vk_articles').update({ analysis: updated }).eq('id', id);
          }
        } catch(e) { console.log('Reanalyze market search skipped:', e.message); }
      } catch(e) {
        console.error('Reanalyze error:', e);
        await supabase.from('vk_articles').update({ status: 'error' }).eq('id', id);
      }
    })();
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Landingpage erstellen ─────────────────────────────────────────────
app.post('/api/vk/landingpage', async (req, res) => {
  try {
    const {
      article_id, session_id, days, has_bot,
      delivery_pickup, delivery_shipping, shipping_cost, pickup_location,
      sale_price, min_price, show_score_badge, stock_quantity
    } = req.body;
    if (!article_id || !session_id || !days) return res.status(400).json({ error: 'article_id, session_id und days erforderlich' });

    const { data: article } = await supabase.from('vk_articles')
      .select('*, vk_photos(*)').eq('id', article_id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });

    // Slug generieren
    const baseTitle = article.title || (article.analysis?.title_short) || 'produkt';
    const slug = baseTitle.toLowerCase()
      .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/[ß]/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 60)
      + '-' + Math.random().toString(36).substring(2, 7);

    const activeUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    // Score-Badge nur wenn Score ≥ 60
    const authScore = article.analysis?.authenticity?.score ?? null;
    const showBadge = !!show_score_badge && authScore !== null && authScore >= 60;

    const { data: lp, error } = await supabase.from('vk_landingpages').insert({
      article_id, session_id, slug,
      active_until: activeUntil,
      has_bot: !!has_bot,
      delivery_pickup: delivery_pickup !== false,
      delivery_shipping: !!delivery_shipping,
      shipping_cost: parseFloat(shipping_cost) || 0,
      pickup_location: pickup_location || null,
      sale_price: parseFloat(sale_price) || null,
      min_price: parseFloat(min_price) || null,
      show_score_badge: showBadge,
      stock_quantity: stock_quantity ? parseInt(stock_quantity) : null,
      stock_sold: 0,
      status: 'active', views: 0
    }).select().single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, landingpage: lp, url: 'https://p.converdino.com/p/' + slug });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Landingpage laden ─────────────────────────────────────────────────
app.get('/api/vk/landingpage/article/:articleId', async (req, res) => {
  try {
    const { data } = await supabase.from('vk_landingpages')
      .select('*').eq('article_id', req.params.articleId).eq('status', 'active').single();
    res.json(data || null);
  } catch(e) { res.json(null); }
});

app.delete('/api/vk/landingpage/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('vk_landingpages').update({ status: 'inactive' }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Admin: Neue Test-Session anlegen (ohne WhatsApp) ─────────────────
app.post('/api/vk/admin/new-session', async (req, res) => {
  try {
    const { password, phone } = req.body;
    if (password !== process.env.ADMIN_PASSWORD && password !== process.env.SUPERADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Falsches Passwort' });
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const testPhone = phone || ('test' + Date.now());
    const { data: session, error } = await supabase.from('vk_sessions').insert({
      token, phone: testPhone, status: 'open', expires_at: expiresAt
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, token, url: 'https://officepuertoplata-coder.github.io/converdino/bericht.html?s=' + token });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Artikel anlegen (bericht.html ruft diesen Endpoint auf) ──────────
app.post('/api/vk/article', async (req, res) => {
  try {
    const { token, title } = req.body;
    const { data: session } = await supabase.from('vk_sessions')
      .select('id, vk_articles(id)')
      .eq('token', token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    const count = (session.vk_articles || []).length;
    const { data: article, error } = await supabase.from('vk_articles').insert({
      session_id: session.id,
      title: title || `Artikel ${count + 1}`,
      sort_order: count + 1
    }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, article });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Foto hochladen (bericht.html ruft /api/vk/photo auf) ─────────────
app.post('/api/vk/photo', async (req, res) => {
  try {
    const { article_id, session_id, image_base64, content_type } = req.body;
    if (!article_id || !image_base64) return res.status(400).json({ error: 'article_id und image_base64 erforderlich' });
    const { data: article } = await supabase.from('vk_articles')
      .select('id, session_id, vk_photos(id)')
      .eq('id', article_id).single();
    if (!article) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    if ((article.vk_photos || []).length >= 4)
      return res.status(400).json({ error: 'Maximal 4 Fotos pro Artikel' });
    const buffer = Buffer.from(image_base64, 'base64');
    const ct = content_type || 'image/jpeg';
    const ext = ct.includes('png') ? 'png' : 'jpg';
    const sid = session_id || article.session_id;
    const path = `${sid}/${article.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('vk-photos').upload(path, buffer, { contentType: ct, upsert: false });
    if (upErr) return res.status(500).json({ error: upErr.message });
    const { data: urlData } = supabase.storage.from('vk-photos').getPublicUrl(path);
    const sortOrder = (article.vk_photos || []).length + 1;
    const { data: photo } = await supabase.from('vk_photos').insert({
      article_id: article.id,
      session_id: sid,
      storage_path: path,
      public_url: urlData.publicUrl,
      source: 'upload',
      sort_order: sortOrder
    }).select().single();
    res.json(photo);
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── Alias /results/ → /result/ (ergebnis.html verwendet Plural) ──────
app.get('/api/vk/results/:token', async (req, res) => {
  try {
    const { data: session } = await supabase.from('vk_sessions')
      .select(`*, vk_articles (id, title, extended, notes, status, sort_order, analysis, vk_photos ( id, public_url, sort_order, article_id ))`)
      .eq('token', req.params.token).single();
    if (!session) return res.status(404).json({ error: 'Session nicht gefunden' });
    if (session.status !== 'done' && session.status !== 'analyzing')
      return res.status(400).json({ error: 'Analyse noch nicht abgeschlossen', status: session.status });
    if (session.vk_articles) {
      session.vk_articles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      for (const art of session.vk_articles) {
        if (art.vk_photos) art.vk_photos.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      }
    }
    if (!session.result_viewed_at) {
      await supabase.from('vk_sessions').update({ result_viewed_at: new Date().toISOString() }).eq('id', session.id);
    }
    // Map vk_articles → articles for frontend compatibility
    const articles = session.vk_articles || [];
    res.json({ ...session, articles, vk_articles: articles });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`✅ Converdino API v3.0 läuft auf Port ${PORT}`);
});
