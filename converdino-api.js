// ============================================================
// CONVERDINO API — Eigenständiges Modul
// Wird in server.js geladen mit: require('./converdino-api')(app, supabase);
// Berührt nichts vom alten Code.
// ============================================================

module.exports = function(app, supabase, deps) {

  // ============================================================
  // EXTERNE ABHÄNGIGKEITEN (aus server.js übergeben)
  // ============================================================
  deps = deps || {};
  const sendWAMessage = deps.sendWAMessage || function() {
    console.warn('[CV] sendWAMessage nicht verfügbar — WhatsApp-Bot deaktiviert');
  };

  // ============================================================
  // STRIPE (Treuhand-Anzahlung)
  // Modus über CV_STRIPE_MODE steuerbar: 'test' oder 'live'.
  //   test → STRIPE_SECRET_KEY_TEST + STRIPE_CV_WEBHOOK_SECRET_TEST
  //   live → STRIPE_SECRET_KEY_EU   + STRIPE_CV_WEBHOOK_SECRET
  // Geld geht auf den Converdino-Account; Auszahlung an Verkäufer
  // erfolgt manuell nach Ablauf der Widerrufsfrist.
  // ============================================================
  const CV_STRIPE_MODE = (process.env.CV_STRIPE_MODE || 'live').toLowerCase();
  const CV_IS_TEST = CV_STRIPE_MODE === 'test';

  const cvStripeKey = CV_IS_TEST
    ? (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY_EU)
    : (process.env.STRIPE_SECRET_KEY_EU || process.env.STRIPE_SECRET_KEY);

  const cvWebhookSecret = CV_IS_TEST
    ? (process.env.STRIPE_CV_WEBHOOK_SECRET_TEST || process.env.STRIPE_CV_WEBHOOK_SECRET)
    : process.env.STRIPE_CV_WEBHOOK_SECRET;

  let cvStripe = null;
  try {
    if (cvStripeKey) {
      cvStripe = require('stripe')(cvStripeKey);
      console.log(`[CV] Stripe initialisiert (Modus: ${CV_IS_TEST ? 'TEST' : 'LIVE'})`);
    } else {
      console.warn('[CV] Kein Stripe-Key gefunden — Zahlungslinks deaktiviert');
    }
  } catch(e) {
    console.error('[CV] Stripe-Init fehlgeschlagen:', e.message);
  }

  // Basis-URL für Redirect nach Zahlung
  const CV_BASE_URL = process.env.CV_BASE_URL || 'https://converdino.com';

  // ============================================================
  // RESEND (E-Mail-Benachrichtigung an Verkäufer)
  // ============================================================
  let cvResend = null;
  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      cvResend = require('resend');
      // resend package exportiert { Resend }
      cvResend = new cvResend.Resend(resendKey);
      console.log('[CV] Resend initialisiert');
    } else {
      console.warn('[CV] Kein Resend-API-Key gefunden — Email-Benachrichtigungen deaktiviert');
    }
  } catch(e) {
    console.error('[CV] Resend-Init fehlgeschlagen:', e.message);
  }

  const CV_MAIL_FROM     = process.env.CV_MAIL_FROM     || 'Converdino <noreply@ynhald.com>';
  const CV_MAIL_REPLY_TO = process.env.CV_MAIL_REPLY_TO || 'office@ynhald.com';

  // ============================================================
  // HELFER: Login-Identifier aus Body/Header lesen
  // ============================================================
  function getUserLogin(req) {
    const raw = (
      req.body?.user_login ||
      req.query?.user_login ||
      req.headers['x-user-login'] ||
      'admin'
    );
    return String(raw).toLowerCase().trim();
  }


  // ============================================================
  // 1. GET /api/cv/me
  //    Liefert Subscription + alle Slots für den eingeloggten User
  // ============================================================
  app.get('/api/cv/me', async (req, res) => {
    try {
      const userLogin = String(req.query.user || 'admin').toLowerCase().trim();

      // Subscription laden
      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions')
        .select('*')
        .eq('user_login', userLogin)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subErr) return res.status(500).json({ error: 'Subscription: ' + subErr.message });
      if (!sub)   return res.json({ active: false, slots: [] });

      // Slots laden
      const { data: slots, error: slotsErr } = await supabase
        .from('cv_slots')
        .select('*')
        .eq('subscription_id', sub.id)
        .order('slot_number', { ascending: true });

      if (slotsErr) return res.status(500).json({ error: 'Slots: ' + slotsErr.message });

      // Artikel pro Slot mitliefern
      const slotIds = (slots || []).map(s => s.id);
      let articlesBySlot = {};
      if (slotIds.length > 0) {
        const { data: articles } = await supabase
          .from('cv_articles')
          .select('id, slot_id, title, status, sale_price, min_price')
          .in('slot_id', slotIds);
        for (const a of (articles || [])) articlesBySlot[a.slot_id] = a;
      }

      // ── Erfolgs-Trichter pro Slot (Gespräche → Leads → Abschlüsse) ──
      // Daten kommen aus cv_bot_sessions (Gespräche) + cv_events (Stufen).
      let statsBySlot = {};
      if (slotIds.length > 0) {
        // Gespräche zählen (jede Session = ein Gespräch), mit Datum für Monatszählung
        const { data: sess } = await supabase
          .from('cv_bot_sessions')
          .select('slot_id, buyer_phone, created_at, last_message_at')
          .in('slot_id', slotIds);
        // Events laden
        const { data: evs } = await supabase
          .from('cv_events')
          .select('slot_id, buyer_phone, type')
          .in('slot_id', slotIds);

        // Monatsbeginn (für "Gespräche diesen Monat")
        const jetzt = new Date();
        const monatsStart = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1).getTime();

        // Pro Slot + Käufer die höchste erreichte Stufe bestimmen
        // Stufe: 0 = nur Gespräch, 1 = Lead, 2 = Abschluss
        const stufeProKäufer = {}; // key: slotId|phone → stufe
        const gespraecheProSlot = {}; // slotId → Set(phone)  — eindeutige Käufer gesamt
        const monatProSlot = {};      // slotId → Anzahl Gespräche (Sessions) diesen Monat
        for (const s of (sess || [])) {
          const slot = s.slot_id;
          if (!gespraecheProSlot[slot]) gespraecheProSlot[slot] = new Set();
          gespraecheProSlot[slot].add(s.buyer_phone || '?');
          // Monatszählung: jede Session dieses Monats zählt einzeln.
          // Datum: created_at, ersatzweise last_message_at (falls created_at fehlt).
          const dateStr = s.created_at || s.last_message_at;
          const ts = dateStr ? new Date(dateStr).getTime() : 0;
          if (ts >= monatsStart) monatProSlot[slot] = (monatProSlot[slot] || 0) + 1;
        }
        const setStufe = function(slot, phone, stufe) {
          const k = slot + '|' + (phone || '?');
          if (stufeProKäufer[k] === undefined || stufe > stufeProKäufer[k]) stufeProKäufer[k] = stufe;
        };
        for (const ev of (evs || [])) {
          const t = ev.type;
          if (t === 'paid' || t === 'deal' || t === 'agreed') setStufe(ev.slot_id, ev.buyer_phone, 2);
          else if (t === 'hot_lead' || t === 'contact_added') setStufe(ev.slot_id, ev.buyer_phone, 1);
        }
        // Initialisieren
        for (const id of slotIds) statsBySlot[id] = { gespraeche: 0, leads: 0, abschluesse: 0, monat: 0 };
        // Gespräche (eindeutige Käufer gesamt) + Monatszählung
        for (const id of slotIds) {
          statsBySlot[id].gespraeche = gespraecheProSlot[id] ? gespraecheProSlot[id].size : 0;
          statsBySlot[id].monat = monatProSlot[id] || 0;
        }
        // Leads (Stufe ≥ 1) und Abschlüsse (Stufe = 2) kumulativ zählen
        for (const k in stufeProKäufer) {
          const slot = k.split('|')[0];
          if (!statsBySlot[slot]) continue;
          const stufe = stufeProKäufer[k];
          if (stufe >= 1) statsBySlot[slot].leads++;
          if (stufe >= 2) statsBySlot[slot].abschluesse++;
        }
      }

      const enrichedSlots = (slots || []).map(s => ({
        ...s,
        article: articlesBySlot[s.id] || null,
        stats: statsBySlot[s.id] || { gespraeche: 0, leads: 0, abschluesse: 0, monat: 0 }
      }));

      res.json({
        active: true,
        subscription: {
          id: sub.id,
          slots_total: sub.slots_total,
          slots_used: enrichedSlots.filter(s => s.status !== 'empty').length,
          status: sub.status,
          beratung_enabled: sub.beratung_enabled === true,
          current_period_end: sub.current_period_end
        },
        slots: enrichedSlots
      });
    } catch(e) {
      console.error('[CV /me]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 2. POST /api/cv/slot/:id/article
  //    Artikel im Slot anlegen (oder ersetzen)
  //    Body: { title, sale_price, min_price, location, anrede, notes }
  // ============================================================
  app.post('/api/cv/slot/:id/article', async (req, res) => {
    try {
      const slotId = req.params.id;
      const { title, sale_price, min_price, location, anrede, notes, deposit_percent, mode, bot_name, berater_name, strategie } = req.body;

      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Artikelbezeichnung fehlt' });
      }

      // Gewünschter Modus (Standard verkauf). Beratung nur bei freigeschaltetem Kunden.
      const wantBeratung = (mode === 'beratung');

      // Slot prüfen
      const { data: slot, error: slotErr } = await supabase
        .from('cv_slots')
        .select('*')
        .eq('id', slotId)
        .maybeSingle();
      if (slotErr) return res.status(500).json({ error: 'Slot-Lesefehler: ' + slotErr.message });
      if (!slot)   return res.status(404).json({ error: 'Slot nicht gefunden' });

      // Beratungs-Modus erfordert eine freigeschaltete Subscription
      if (wantBeratung && slot.subscription_id) {
        const { data: sub } = await supabase
          .from('cv_subscriptions').select('beratung_enabled').eq('id', slot.subscription_id).maybeSingle();
        if (!sub || sub.beratung_enabled !== true) {
          return res.status(403).json({ error: 'Beratungs-Modus ist für dieses Konto nicht freigeschaltet.' });
        }
      }

      // Falls bereits Artikel im Slot → ersetzen
      const { data: existing } = await supabase
        .from('cv_articles')
        .select('id')
        .eq('slot_id', slotId)
        .maybeSingle();

      let article;
      if (existing) {
        const { data: updated, error: updErr } = await supabase
          .from('cv_articles')
          .update(Object.assign({
            title: title.trim(),
            sale_price: sale_price || null,
            min_price: min_price || null,
            location: location || null,
            anrede: anrede || 'Sie',
            bot_name: (bot_name && bot_name.trim()) || null,
            berater_name: (berater_name && berater_name.trim()) || null,
            notes: notes || null,
            status: 'draft',
            updated_at: new Date().toISOString()
          }, (strategie !== undefined ? { strategie: (strategie && strategie.trim()) || null } : {})))
          .eq('id', existing.id)
          .select()
          .single();
        if (updErr) return res.status(500).json({ error: 'Update: ' + updErr.message });
        article = updated;
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('cv_articles')
          .insert({
            slot_id: slotId,
            title: title.trim(),
            sale_price: sale_price || null,
            min_price: min_price || null,
            location: location || null,
            anrede: anrede || 'Sie',
            bot_name: (bot_name && bot_name.trim()) || null,
            berater_name: (berater_name && berater_name.trim()) || null,
            strategie: (strategie && strategie.trim()) || null,
            notes: notes || null,
            status: 'draft'
          })
          .select()
          .single();
        if (insErr) return res.status(500).json({ error: 'Insert: ' + insErr.message });
        article = inserted;
      }

      // Slot Status + Anzahlungssatz + Modus updaten
      const slotUpdate = { status: 'configured', updated_at: new Date().toISOString() };
      slotUpdate.mode = wantBeratung ? 'beratung' : 'verkauf';
      if (deposit_percent != null && deposit_percent >= 1 && deposit_percent <= 100) {
        slotUpdate.deposit_percent = deposit_percent;
      }
      await supabase
        .from('cv_slots')
        .update(slotUpdate)
        .eq('id', slotId);

      res.json({ success: true, article });
    } catch(e) {
      console.error('[CV /slot/:id/article]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 2b. PATCH /api/cv/slot/:id/quicksettings
  //    Schnell-Einstellungen am AKTIVEN Bot ändern, ohne Neu-Analyse.
  //    Body (alle optional): wa_starttext, cta_text, pull_text, availability
  //    Schreibt in cv_articles (Artikel des Slots). Nur gesendete Felder werden geändert.
  // ============================================================
  app.patch('/api/cv/slot/:id/quicksettings', async (req, res) => {
    try {
      const slotId = req.params.id;
      const { wa_starttext, cta_text, pull_text, availability } = req.body || {};

      // Artikel des Slots holen
      const { data: article, error: artErr } = await supabase
        .from('cv_articles')
        .select('*')
        .eq('slot_id', slotId)
        .maybeSingle();
      if (artErr) return res.status(500).json({ success: false, error: 'Artikel-Lesefehler: ' + artErr.message });
      if (!article) return res.status(404).json({ success: false, error: 'Kein Artikel für diesen Slot gefunden' });

      // Nur tatsächlich gesendete Felder aktualisieren (undefined = nicht anfassen)
      const upd = {};
      if (wa_starttext !== undefined) upd.wa_starttext = (wa_starttext || '').trim();
      if (cta_text    !== undefined) upd.cta_text    = (cta_text    || '').trim();
      if (pull_text   !== undefined) upd.pull_text   = (pull_text   || '').trim();
      if (availability !== undefined) {
        const allowed = ['available', 'reserved', 'sold'];
        if (!allowed.includes(availability)) {
          return res.status(400).json({ success: false, error: 'Ungültiger Verfügbarkeits-Wert' });
        }
        upd.availability = availability;
      }

      if (Object.keys(upd).length === 0) {
        return res.status(400).json({ success: false, error: 'Keine Felder zum Speichern übergeben' });
      }

      const { data: updated, error: updErr } = await supabase
        .from('cv_articles')
        .update(upd)
        .eq('id', article.id)
        .select('*')
        .maybeSingle();
      if (updErr) {
        console.error('[CV quicksettings] UPDATE-Fehler:', updErr.message);
        return res.status(500).json({ success: false, error: 'Speicherfehler: ' + updErr.message });
      }

      res.json({ success: true, article: updated || { ...article, ...upd } });
    } catch(e) {
      console.error('[CV /slot/:id/quicksettings]', e);
      res.status(500).json({ success: false, error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 3. POST /api/cv/slot/:id/upload
  //    Datei in Slot hochladen (Foto, PDF, Notiz)
  //    Body: { kind: 'photo'|'pdf'|'note', file_name, file_base64, content_type, content }
  // ============================================================
  app.post('/api/cv/slot/:id/upload', async (req, res) => {
    try {
      const slotId = req.params.id;
      const { kind, file_name, file_base64, content_type, content, purpose } = req.body;

      if (!['photo', 'pdf', 'note'].includes(kind)) {
        return res.status(400).json({ error: 'Ungültiger kind. Erwartet: photo/pdf/note' });
      }

      // PDF-Zweck: 'analysis' (KI liest) oder 'dossier' (Bot versendet)
      // Default für PDFs: 'analysis'
      const pdfPurpose = (kind === 'pdf')
        ? (purpose === 'dossier' ? 'dossier' : 'analysis')
        : null;

      // Artikel zum Slot finden
      const { data: article, error: artErr } = await supabase
        .from('cv_articles')
        .select('id')
        .eq('slot_id', slotId)
        .maybeSingle();
      if (artErr)  return res.status(500).json({ error: 'Artikel: ' + artErr.message });
      if (!article) return res.status(400).json({ error: 'Erst Artikel anlegen (cv/slot/:id/article)' });

      let storagePath = null;
      let publicUrl = null;
      let textContent = null;

      // --- NOTIZ ---
      if (kind === 'note') {
        if (!content || !content.trim()) {
          return res.status(400).json({ error: 'Notiz-Text fehlt' });
        }
        textContent = content.trim().substring(0, 10000);
      }

      // --- FOTO / PDF ---
      if (kind === 'photo' || kind === 'pdf') {
        if (!file_base64) return res.status(400).json({ error: 'file_base64 fehlt' });
        if (kind === 'photo' && content_type && content_type.includes('avif')) {
          return res.status(400).json({ error: 'AVIF nicht unterstützt — bitte JPG oder PNG' });
        }

        const bucket = (kind === 'photo') ? 'vk-photos' : 'vk-docs';
        const ext = (file_name || '').split('.').pop()?.toLowerCase() ||
                    (kind === 'photo' ? 'jpg' : 'pdf');
        const path = `cv/${article.id}/${Date.now()}.${ext}`;
        const buffer = Buffer.from(file_base64, 'base64');

        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(path, buffer, {
            contentType: content_type || (kind === 'photo' ? 'image/jpeg' : 'application/pdf'),
            upsert: false
          });
        if (upErr) return res.status(500).json({ error: 'Storage: ' + upErr.message });

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        storagePath = path;
        publicUrl = urlData.publicUrl;
      }

      // Sort-Order: nächste freie Nummer
      const { data: existingUploads } = await supabase
        .from('cv_uploads')
        .select('sort_order')
        .eq('article_id', article.id)
        .order('sort_order', { ascending: false })
        .limit(1);
      const nextOrder = (existingUploads?.[0]?.sort_order || 0) + 1;

      const { data: upload, error: insErr } = await supabase
        .from('cv_uploads')
        .insert({
          article_id: article.id,
          kind,
          file_name: file_name || (kind === 'note' ? 'Notiz' : null),
          storage_path: storagePath,
          public_url: publicUrl,
          content: textContent,
          purpose: pdfPurpose,
          shareable: (pdfPurpose === 'dossier'),
          sort_order: nextOrder
        })
        .select()
        .single();
      if (insErr) return res.status(500).json({ error: 'Upload-Insert: ' + insErr.message });

      res.json({ success: true, upload });
    } catch(e) {
      console.error('[CV /upload]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 4. GET /api/cv/slot/:id
  //    Slot-Details inkl. Artikel + Uploads
  // ============================================================
  app.get('/api/cv/slot/:id', async (req, res) => {
    try {
      const slotId = req.params.id;

      const { data: slot, error: slotErr } = await supabase
        .from('cv_slots').select('*').eq('id', slotId).maybeSingle();
      if (slotErr) return res.status(500).json({ error: 'Slot: ' + slotErr.message });
      if (!slot)   return res.status(404).json({ error: 'Slot nicht gefunden' });

      const { data: article } = await supabase
        .from('cv_articles').select('*').eq('slot_id', slotId).maybeSingle();

      let uploads = [];
      if (article) {
        const { data: ups } = await supabase
          .from('cv_uploads').select('*')
          .eq('article_id', article.id)
          .order('sort_order', { ascending: true });
        uploads = ups || [];
      }

      res.json({ slot, article, uploads });
    } catch(e) {
      console.error('[CV /slot/:id]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // GET /api/cv/public/:botcode
  //    ÖFFENTLICHE Produktseite (Landingpage) — KEIN Login.
  //    Gibt NUR unbedenkliche Felder heraus: Titel, Standort, Fotos,
  //    sichere Kurzbeschreibung, Bot-Code, WA-Link, ggf. Preis.
  //    NIEMALS: Mindestpreis, Strategie, Verhandlungslogik, interne Felder.
  //    Nur für AKTIVE Bots.
  // ============================================================
  app.get('/api/cv/public/:botcode', async (req, res) => {
    try {
      const code = (req.params.botcode || '').trim();
      if (!code) return res.status(400).json({ error: 'Kein Code' });

      // Slot per Bot-Code finden (case-insensitive), nur aktiv
      const { data: slot } = await supabase
        .from('cv_slots').select('*')
        .ilike('bot_code', code)
        .maybeSingle();
      if (!slot || slot.status !== 'active') {
        return res.status(404).json({ error: 'Nicht gefunden oder nicht aktiv' });
      }

      const { data: article } = await supabase
        .from('cv_articles').select('*').eq('slot_id', slot.id).maybeSingle();
      if (!article) return res.status(404).json({ error: 'Kein Artikel' });

      // Fotos (nur öffentlich abrufbare)
      const { data: ups } = await supabase
        .from('cv_uploads').select('kind, public_url, sort_order')
        .eq('article_id', article.id)
        .order('sort_order', { ascending: true });
      const photos = (ups || []).filter(u => u.kind === 'photo' && u.public_url).map(u => u.public_url);

      // Sichere Beschreibung NUR aus unbedenklichen Wissens-Feldern
      const analysis = article.analysis || {};
      const safe = {
        summary: analysis.summary || '',
        condition: analysis.condition || '',
        key_facts: Array.isArray(analysis.key_facts) ? analysis.key_facts.slice(0, 8) : [],
        selling_points: Array.isArray(analysis.selling_points) ? analysis.selling_points.slice(0, 6) : []
      };

      // Preis nur, wenn Einstellung 'public' (sonst auf Anfrage)
      const istBeratung = (slot.mode === 'beratung');
      const showPrice = !istBeratung && (article.price_visibility || 'public') !== 'on_request';
      const price = showPrice ? (Number(article.sale_price) || null) : null;

      res.json({
        ok: true,
        mode: istBeratung ? 'beratung' : 'verkauf',
        title: article.title || '',
        location: article.location || '',
        anrede: article.anrede || 'Sie',
        bot_code: slot.bot_code,
        cta_text: (article.cta_text && article.cta_text.trim()) ? article.cta_text.trim() : '',
        price,
        price_on_request: !showPrice,
        photos,
        description: safe
      });
    } catch(e) {
      console.error('[CV /public/:botcode]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // GET /api/cv/slot/:id/conversations
  //    Alle Bot-Gespräche eines Slots (für die Gesprächsansicht)
  //    Liefert pro Gespräch: Käufer, Verlauf, Status, Zeit + Events
  // ============================================================
  app.get('/api/cv/slot/:id/conversations', async (req, res) => {
    try {
      const slotId = req.params.id;

      // Gespräche dieses Slots (neueste zuerst)
      const { data: sessions, error: sErr } = await supabase
        .from('cv_bot_sessions')
        .select('id, buyer_phone, messages, status, phase, created_at, last_message_at')
        .eq('slot_id', slotId)
        .order('last_message_at', { ascending: false, nullsFirst: false });
      if (sErr) return res.status(500).json({ error: 'Sessions: ' + sErr.message });

      // Events dieses Slots (für Ergebnis-Anzeige pro Käufer)
      const { data: events } = await supabase
        .from('cv_events')
        .select('type, buyer_phone, created_at')
        .eq('slot_id', slotId)
        .order('created_at', { ascending: true });

      // Events nach Käufer gruppieren
      const eventsByBuyer = {};
      for (const ev of (events || [])) {
        const key = ev.buyer_phone || '';
        if (!eventsByBuyer[key]) eventsByBuyer[key] = [];
        eventsByBuyer[key].push(ev.type);
      }

      // Nachrichten normalisieren (content kann String oder Array sein)
      const normContent = function(c) {
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
          return c.map(function(part) {
            if (typeof part === 'string') return part;
            if (part && typeof part.text === 'string') return part.text;
            return '';
          }).join(' ').trim();
        }
        return '';
      };

      const conversations = (sessions || []).map(function(s) {
        const msgs = Array.isArray(s.messages) ? s.messages : [];
        const cleanMsgs = msgs
          .map(function(m) {
            return { role: m.role === 'user' ? 'buyer' : 'bot', text: normContent(m.content) };
          })
          .filter(function(m) { return m.text && m.text.length > 0; });
        return {
          id: s.id,
          buyer_phone: s.buyer_phone,
          status: s.status,
          phase: s.phase,
          created_at: s.created_at,
          last_message_at: s.last_message_at,
          message_count: cleanMsgs.length,
          messages: cleanMsgs,
          events: eventsByBuyer[s.buyer_phone] || []
        };
      });

      res.json({ conversations });
    } catch(e) {
      console.error('[CV /slot/:id/conversations]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 5. DELETE /api/cv/upload/:id
  //    Einzelnes Upload (Foto/PDF/Notiz) löschen
  // ============================================================
  app.delete('/api/cv/upload/:id', async (req, res) => {
    try {
      const { data: up } = await supabase
        .from('cv_uploads').select('*').eq('id', req.params.id).maybeSingle();
      if (up?.storage_path) {
        const bucket = (up.kind === 'photo') ? 'vk-photos' : 'vk-docs';
        await supabase.storage.from(bucket).remove([up.storage_path]).catch(() => {});
      }
      await supabase.from('cv_uploads').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // ============================================================
  // 5b. PUT /api/cv/article/:id/knowledge
  //     Wissensdatenbank manuell editieren (analysis + pdf_facts)
  // ============================================================
  app.put('/api/cv/article/:id/knowledge', async (req, res) => {
    try {
      const { analysis, pdf_facts } = req.body;
      if (!analysis || typeof analysis !== 'object') {
        return res.status(400).json({ error: 'analysis (JSON-Objekt) erforderlich' });
      }

      const update = {
        analysis,
        dna: analysis.bot_strategy || null,  // bot_strategy in dna spiegeln
        status: 'analyzed',
        updated_at: new Date().toISOString()
      };

      // pdf_facts optional mitupdaten
      if (Array.isArray(pdf_facts)) {
        update.pdf_facts = pdf_facts.filter(f =>
          f && typeof f === 'object' && f.k && f.v
        );
      }

      const { data, error } = await supabase
        .from('cv_articles')
        .update(update)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, article: data });
    } catch(e) {
      console.error('[CV knowledge PUT]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // 5c. POST /api/cv/article/:id/persona
  //     Ändert NUR bot_name + berater_name — Status/Analyse bleiben unberührt.
  //     Sicher auch bei laufenden (aktiven) Bots nutzbar.
  // ============================================================
  app.post('/api/cv/article/:id/persona', async (req, res) => {
    try {
      const { bot_name, berater_name, strategie } = req.body;
      const update = { updated_at: new Date().toISOString() };
      if (bot_name !== undefined) update.bot_name = (bot_name && String(bot_name).trim()) || null;
      if (berater_name !== undefined) update.berater_name = (berater_name && String(berater_name).trim()) || null;
      if (strategie !== undefined) update.strategie = (strategie && String(strategie).trim()) || null;

      const { data, error } = await supabase
        .from('cv_articles')
        .update(update)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, article: data });
    } catch(e) {
      console.error('[CV persona]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // 5d. Kundennotizen: als Fakt mit src:'kunde' in pdf_facts — sofort wirksam, KEINE Analyse
  //     POST   /api/cv/article/:id/customer-note  { note }   → hinzufügen
  //     DELETE /api/cv/article/:id/customer-note  { note }   → entfernen
  // ============================================================
  app.post('/api/cv/article/:id/customer-note', async (req, res) => {
    try {
      const note = (req.body.note || '').trim();
      if (!note) return res.status(400).json({ error: 'Leere Notiz' });

      const { data: art } = await supabase
        .from('cv_articles').select('pdf_facts').eq('id', req.params.id).maybeSingle();
      if (!art) return res.status(404).json({ error: 'Artikel nicht gefunden' });

      const facts = Array.isArray(art.pdf_facts) ? art.pdf_facts : [];
      facts.push({ k: 'Ergänzung', v: note, src: 'kunde' });

      const { error } = await supabase
        .from('cv_articles').update({ pdf_facts: facts, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, pdf_facts: facts });
    } catch(e) {
      console.error('[CV customer-note POST]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/cv/article/:id/customer-note', async (req, res) => {
    try {
      const note = (req.body.note || '').trim();
      const { data: art } = await supabase
        .from('cv_articles').select('pdf_facts').eq('id', req.params.id).maybeSingle();
      if (!art) return res.status(404).json({ error: 'Artikel nicht gefunden' });

      const facts = Array.isArray(art.pdf_facts) ? art.pdf_facts : [];
      // nur die erste passende Kundennotiz entfernen
      let removed = false;
      const neu = facts.filter(f => {
        if (!removed && f && f.src === 'kunde' && (f.v || '') === note) { removed = true; return false; }
        return true;
      });

      const { error } = await supabase
        .from('cv_articles').update({ pdf_facts: neu, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
      if (error) return res.status(500).json({ error: error.message });
      res.json({ success: true, pdf_facts: neu });
    } catch(e) {
      console.error('[CV customer-note DELETE]', e);
      res.status(500).json({ error: e.message });
    }
  });


  // ============================================================
  // ============================================================
  // KI-ANALYSE — ZWEI STUFEN
  //   Stufe A: Haiku liest jedes Analyse-PDF und extrahiert
  //            strukturierte Fakten [{k, v, source}]
  //   Stufe B: Opus baut Verkaufs-DNA aus Fotos + Notizen +
  //            extrahierten PDF-Fakten + Stammdaten
  // ============================================================

  // ── STUFE A ────────────────────────────────────────────────
  async function cvExtractPdfFacts(pdfUrl, pdfFileName) {
    try {
      console.log('[CV Haiku] Lese PDF:', pdfFileName);
      const dr = await fetch(pdfUrl);
      if (!dr.ok) throw new Error('PDF Download HTTP ' + dr.status);
      const db = Buffer.from(await dr.arrayBuffer());

      const er = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3500,
          system: 'Du extrahierst Fakten aus Verkaufsunterlagen. Antworte ausschließlich mit einem reinen JSON-Array. Kein Markdown, keine Erklärung.',
          messages: [{ role: 'user', content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: db.toString('base64')
              }
            },
            { type: 'text', text:
`Extrahiere ALLE konkreten Fakten aus diesem Dokument als JSON-Array.
Format: [{"k": "Bezeichnung", "v": "Wert"}, ...]

Sammle alles Konkrete: Baujahr, KM-Stand, Hubraum, Leistung (kW/PS), Kraftstoff,
Getriebe, Antrieb, Eigengewicht, zulässiges Gesamtgewicht, Nutzlast,
Sitzplätze, Türen, Farbe (außen/innen), Polsterung, alle Ausstattungs-
merkmale einzeln, Maße (Länge/Breite/Höhe), Tank, Verbrauch, CO2,
Erstzulassung, Pickerl/TÜV-Datum, Preis (falls genannt), Serienummern,
Garantie-Infos, Inkludierte Dienstleistungen, alle technischen Daten.

REGELN
- Jedes Detail einzeln, nicht zusammenfassen
- Werte sind Zahlen + Einheit oder kurze Begriffe ("1820 kg", "Dunkelblau-Metallic")
- Keine ganzen Sätze als Wert
- Nichts erfinden — nur was wirklich im Dokument steht
- Keine Duplikate

Antworte NUR mit dem JSON-Array. Nichts davor, nichts danach.`}
          ]}]
        })
      });

      if (!er.ok) {
        const errText = await er.text();
        console.error('[CV Haiku] API', er.status, errText.substring(0, 200));
        return [];
      }

      const ed = await er.json();
      const text = (ed.content?.[0]?.text || '[]').replace(/```json|```/g, '').trim();
      const sIdx = text.indexOf('[');
      const eIdx = text.lastIndexOf(']');
      if (sIdx < 0 || eIdx <= sIdx) {
        console.warn('[CV Haiku] Kein JSON-Array gefunden');
        return [];
      }

      const arr = JSON.parse(text.substring(sIdx, eIdx + 1));
      const facts = arr.filter(p => p && p.k && p.v).map(p => ({
        k: String(p.k).trim(),
        v: String(p.v).trim(),
        source: pdfFileName || 'Dokument'
      }));
      console.log('[CV Haiku] ' + facts.length + ' Fakten aus ' + pdfFileName);
      return facts;
    } catch(e) {
      console.error('[CV Haiku] Fehler bei', pdfFileName, ':', e.message);
      return [];
    }
  }

  // ── STUFE B (mit Stufe A integriert) ───────────────────────
  async function cvAnalyzeArticle(article, uploads) {
    const photos = uploads.filter(u => u.kind === 'photo' && u.public_url);
    // NUR Analyse-PDFs an die KI — Dossier-PDFs werden später vom Bot verschickt
    const analysisPdfs = uploads.filter(u =>
      u.kind === 'pdf' && (u.purpose === 'analysis' || u.purpose == null)
    );
    const notes = uploads.filter(u => u.kind === 'note').map(u => u.content).filter(Boolean).join('\n\n');

    const anrede = article.anrede || 'Sie';

    // ─── STUFE A: alle Analyse-PDFs durch Haiku ─────────
    let pdfFacts = [];
    for (const pdf of analysisPdfs) {
      if (!pdf.public_url) continue;
      const facts = await cvExtractPdfFacts(pdf.public_url, pdf.file_name);
      pdfFacts = pdfFacts.concat(facts);
    }
    // Sofort speichern damit Verkäufer sie schon sieht falls Stufe B failt
    if (pdfFacts.length > 0) {
      await supabase.from('cv_articles')
        .update({ pdf_facts: pdfFacts })
        .eq('id', article.id);
      console.log('[CV] ' + pdfFacts.length + ' PDF-Fakten gespeichert für Artikel ' + article.id);
    } else {
      // Auch leer speichern (überschreibt alten Stand)
      await supabase.from('cv_articles')
        .update({ pdf_facts: [] })
        .eq('id', article.id);
    }

    // ─── STUFE B: Opus baut Verkaufs-DNA ───────────────
    const factsBlock = pdfFacts.length > 0
      ? pdfFacts.map(f => `• ${f.k}: ${f.v}`).join('\n')
      : '(keine PDF-Fakten — Bot kennt nur was auf Bildern sichtbar und in Notizen steht)';

    const prompt = `Du analysierst ein Produkt für einen WhatsApp-Verkaufsbot, der direkt mit Käufern verhandelt.

PRODUKT-STAMMDATEN
Titel: ${article.title}
Verkaufspreis: €${article.sale_price || 'n/a'}
Mindestpreis: €${article.min_price || 'n/a'}
Standort: ${article.location || 'nicht angegeben'}
Anrede im Bot: ${anrede}

═══════════════════════════════════════════════════════════
VERIFIZIERTE FAKTEN AUS DEN HOCHGELADENEN DOKUMENTEN
═══════════════════════════════════════════════════════════
${factsBlock}

NOTIZEN VOM VERKÄUFER
${notes || '(keine Notizen)'}

${photos.length > 0 ? `BILDER: ${photos.length} Foto(s) zeigen das Produkt — analysiere sie genau, aber konzentriere dich auf den ZUSTAND und visuelle Eindrücke. Technische Daten haben Vorrang aus den Dokumenten oben.` : ''}

AUFGABE
Die technischen Fakten sind oben bereits verifiziert und werden dem Bot separat zur Verfügung gestellt — du musst sie NICHT wiederholen. Deine Aufgabe ist die VERKAUFS-EBENE: Wie verkauft und verhandelt der Bot dieses Produkt überzeugend?

REGELN — STRENG EINHALTEN
- Antworte NUR mit reinem JSON. Keine Markdown-Codeblöcke, keine Einleitung.
- Halte dich EXAKT an die untenstehende Struktur.
- Schreibe alle Bot-Texte in der Anrede "${anrede}".
- key_facts: NUR die 5-8 verkaufsrelevantesten Highlights (NICHT alle Fakten wiederholen — die kennt der Bot bereits). Kurze Verkaufs-Sätze.
- Erfinde NIEMALS Daten — nutze nur was oben in Fakten/Notizen/Bildern steht.
- Bot verhandelt zwischen €${article.sale_price} und €${article.min_price}. NIEMALS darunter.

JSON-FORMAT (exakt diese Felder, halte die Texte KOMPAKT):
{
  "category": "Produkttyp (KFZ, Maschine, Möbel, Elektronik, etc.)",
  "summary": "1-2 Sätze Produktbeschreibung",
  "key_facts": ["5-8 stärkste Verkaufs-Highlights, je 1 kurzer Satz"],
  "selling_points": ["3-5 stärkste Verkaufsargumente, je 1 Satz"],
  "condition": "Zustands-Beschreibung aus Bildern + Notizen, 1-2 Sätze",
  "likely_buyer": "Typischer Käufer — 1 Satz",
  "likely_objections": [{ "objection": "Einwand", "response": "Bot-Antwort in ${anrede}-Form" }],
  "bot_strategy": {
    "opening_message": "Erste Bot-Nachricht in ${anrede}-Form: KURZ (1 Satz) — knappe Begrüßung + nennen worum es geht, dann Frage wie man helfen kann. KEINE Produktbeschreibung.",
    "value_argument": "Hauptargument das den Preis €${article.sale_price} rechtfertigt, 1-2 Sätze",
    "negotiation_steps": [
      "Schritt 1: bei €${article.sale_price} halten",
      "Schritt 2: kleines Zugeständnis (~30% Spielraum)",
      "Schritt 3: weiteres Zugeständnis (~65% Spielraum)",
      "Schritt 4: bis nahe €${article.min_price}"
    ],
    "walkaway_line": "Höfliche Absage wenn Käufer unter €${article.min_price} bleibt"
  }
}

Maximal 3-4 Einträge bei likely_objections. Halte alle Texte kompakt.

WICHTIG: Beginne deine Antwort direkt mit { und ende mit }. Gib AUSSCHLIESSLICH das JSON-Objekt aus, keinen Text davor oder danach.`;

    const content = [];
    for (const photo of photos.slice(0, 8)) {
      content.push({
        type: 'image',
        source: { type: 'url', url: photo.public_url }
      });
    }
    content.push({ type: 'text', text: prompt });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 5000,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Opus API ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();

    // stop_reason prüfen: bei max_tokens ist JSON abgeschnitten
    const stopReason = data.stop_reason;
    const text = data.content?.[0]?.text || '';

    if (stopReason === 'max_tokens') {
      console.error('[CV Analyse] Opus wurde durch max_tokens abgeschnitten. Output unvollständig.');
    }

    // Robustes JSON-Parsing: mehrere Strategien
    const parsed = cvParseJson(text);
    if (parsed) return parsed;

    console.error('[CV Analyse] JSON parse failed. stop_reason:', stopReason, 'Raw:', text.substring(0, 800));
    return {
      error: stopReason === 'max_tokens'
        ? 'Analyse zu lang (abgeschnitten) — bitte erneut versuchen'
        : 'Analyse-Output ungültig',
      raw_text: text.substring(0, 1500)
    };
  }

  // JSON aus KI-Text extrahieren — mehrere Fallback-Strategien
  function cvParseJson(text) {
    if (!text) return null;

    // Strategie 1: Markdown-Fences entfernen, direkt parsen
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try { return JSON.parse(cleaned); } catch(e) {}

    // Strategie 2: Erstes { bis letztes } herausschneiden
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = cleaned.substring(start, end + 1);
      try { return JSON.parse(slice); } catch(e) {}

      // Strategie 3: häufige Fehler reparieren (trailing commas)
      try {
        const repaired = slice
          .replace(/,\s*}/g, '}')
          .replace(/,\s*]/g, ']');
        return JSON.parse(repaired);
      } catch(e) {}
    }

    return null;
  }


  // ============================================================
  // 6. POST /api/cv/slot/:id/activate
  //    Sofort: Status 'analyzing' setzen, im Hintergrund analysieren + aktivieren
  // ============================================================
  app.post('/api/cv/slot/:id/activate', async (req, res) => {
    try {
      const slotId = req.params.id;

      const { data: slot } = await supabase
        .from('cv_slots').select('*').eq('id', slotId).maybeSingle();
      if (!slot) return res.status(404).json({ error: 'Slot nicht gefunden' });

      const { data: article } = await supabase
        .from('cv_articles').select('*').eq('slot_id', slotId).maybeSingle();
      if (!article) return res.status(400).json({ error: 'Kein Artikel im Slot' });

      const { data: uploads } = await supabase
        .from('cv_uploads').select('*').eq('article_id', article.id);

      // Status sofort auf "analyzing"
      await supabase.from('cv_slots').update({
        status: 'analyzing', updated_at: new Date().toISOString()
      }).eq('id', slotId);
      await supabase.from('cv_articles').update({
        status: 'analyzing', updated_at: new Date().toISOString()
      }).eq('id', article.id);

      // Antwort sofort zurück — Analyse läuft im Hintergrund
      res.json({ success: true, status: 'analyzing' });

      // ── HINTERGRUND: Analyse + Bot-Aktivierung ──
      (async () => {
        let analysis = null;
        let analysisOk = false;

        if (process.env.ANTHROPIC_API_KEY) {
          try {
            console.log(`[CV] Analyse startet für Slot ${slotId}, ${(uploads||[]).length} Uploads`);
            analysis = await cvAnalyzeArticle(article, uploads || []);
            analysisOk = !analysis?.error;
            console.log(`[CV] Analyse fertig. OK: ${analysisOk}`);
          } catch(e) {
            console.error('[CV] Analyse Exception:', e.message);
            analysis = { error: 'Analyse fehlgeschlagen: ' + e.message };
          }
        } else {
          console.warn('[CV] ANTHROPIC_API_KEY fehlt — Bot wird ohne Analyse aktiviert');
          analysis = { error: 'API-Key nicht konfiguriert' };
        }

        await supabase.from('cv_articles').update({
          analysis,
          dna: analysisOk ? (analysis.bot_strategy || null) : null,
          status: analysisOk ? 'analyzed' : 'failed',
          updated_at: new Date().toISOString()
        }).eq('id', article.id);

        // Bot-Assets generieren
        const botCode = 'Anfrage-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        const waNumber = (process.env.WA_BOT_NUMBER || '4367764118066').replace(/[^0-9]/g, '');
        const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(botCode)}`;
        const qrUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(waLink)}`;
        const widgetCode = `<script>(function(){var b=document.createElement('div');b.style='position:fixed;bottom:24px;right:24px;z-index:9999';b.innerHTML='<a href="${waLink}" target="_blank" style="display:flex;align-items:center;gap:8px;background:#25D366;color:#fff;padding:14px 20px;border-radius:30px;font-family:sans-serif;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(37,211,102,.4)">💬 Jetzt anfragen</a>';document.body.appendChild(b);})();</script>`;

        await supabase.from('cv_slots').update({
          status: 'active',
          bot_code: botCode,
          wa_deeplink: waLink,
          qr_code_url: qrUrl,
          widget_code: widgetCode,
          activated_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq('id', slotId);

        console.log(`[CV] Slot ${slotId} aktiv. BOT-Code: ${botCode}`);
      })().catch(e => console.error('[CV] Hintergrund-Fehler:', e));
    } catch(e) {
      console.error('[CV /activate]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });


  // ============================================================
  // 6b. POST /api/cv/slot/:id/reanalyze
  //     Manuelle Re-Analyse (z.B. nach Änderungen)
  // ============================================================
  app.post('/api/cv/slot/:id/reanalyze', async (req, res) => {
    try {
      const slotId = req.params.id;
      const { data: article } = await supabase
        .from('cv_articles').select('*').eq('slot_id', slotId).maybeSingle();
      if (!article) return res.status(400).json({ error: 'Kein Artikel' });

      const { data: uploads } = await supabase
        .from('cv_uploads').select('*').eq('article_id', article.id);

      await supabase.from('cv_articles').update({ status: 'analyzing' }).eq('id', article.id);
      res.json({ success: true, status: 'analyzing' });

      (async () => {
        try {
          const analysis = await cvAnalyzeArticle(article, uploads || []);
          const ok = !analysis?.error;
          await supabase.from('cv_articles').update({
            analysis,
            dna: ok ? (analysis.bot_strategy || null) : null,
            status: ok ? 'analyzed' : 'failed',
            updated_at: new Date().toISOString()
          }).eq('id', article.id);
        } catch(e) {
          console.error('[CV reanalyze]', e);
          await supabase.from('cv_articles').update({ status: 'failed' }).eq('id', article.id);
        }
      })();
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // ============================================================
  // 7. POST /api/cv/slot/:id/clear
  //    Slot komplett leeren (Artikel + Uploads weg, Bot deaktiviert)
  // ============================================================
  app.post('/api/cv/slot/:id/clear', async (req, res) => {
    try {
      const slotId = req.params.id;

      // Cascade löscht Artikel + Uploads automatisch
      await supabase.from('cv_articles').delete().eq('slot_id', slotId);

      await supabase.from('cv_slots').update({
        status: 'empty',
        bot_code: null,
        wa_deeplink: null,
        qr_code_url: null,
        widget_code: null,
        activated_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', slotId);

      res.json({ success: true });
    } catch(e) {
      console.error('[CV /clear]', e);
      res.status(500).json({ error: e.message });
    }
  });


  // ============================================================
  // WHATSAPP-BOT HANDLER (Schritt 6)
  // ============================================================

  // In-Memory Cache für aktive Bot-Konversationen
  const cvBotSessions = new Map();
  const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 Stunden

  // ── BOT-CODE IN TEXT FINDEN (robust) ─────────────────────
  // Findet einen aktiven bot_code irgendwo im Text — egal ob die Nachricht
  // nur aus dem Code besteht oder ob er in einem Satz steht, und egal welches
  // Präfix der Code hat (BOT-…, Anfrage-…, …). Prüft gegen die echten,
  // aktiven Codes in der Datenbank → keine Fehlauslösung durch normale Wörter.
  async function cvFindBotCodeInText(rawText) {
    try {
      const text = (rawText || '').trim();
      if (!text) return null;
      // 1) Kandidaten aus dem Text ziehen: Wörter mit Bindestrich + Ziffern/Buchstaben,
      //    z.B. "BOT-A3F7", "Anfrage-45SW". Satzzeichen am Rand entfernen.
      const kandidaten = (text.match(/[A-Za-zÄÖÜäöü]+-[A-Za-z0-9]{3,10}/g) || [])
        .map(s => s.replace(/[.,!?;:]+$/, ''));
      if (kandidaten.length === 0) return null;
      // 2) Gegen aktive Slots prüfen (case-insensitive)
      const { data: slots } = await supabase
        .from('cv_slots')
        .select('bot_code')
        .eq('status', 'active')
        .not('bot_code', 'is', null);
      const aktive = (slots || []).map(s => (s.bot_code || '').toLowerCase());
      for (const k of kandidaten) {
        if (aktive.indexOf(k.toLowerCase()) !== -1) return k; // exakter Treffer
      }
      return null;
    } catch(e) {
      console.error('[CV findBotCode]', e.message);
      return null;
    }
  }

  // ── BOT-KONVERSATION STARTEN ─────────────────────────────
  async function cvHandleBotStart(phone, botCode, phoneId) {
    console.log(`[CV Bot] Start: phone=${phone}, code=${botCode}`);

    const { data: slot } = await supabase
      .from('cv_slots')
      .select('*')
      .ilike('bot_code', botCode)
      .eq('status', 'active')
      .maybeSingle();

    if (!slot) {
      await sendWAMessage(phoneId, phone, '❌ Dieser Bot-Code ist nicht aktiv oder ungültig.');
      return false;
    }

    const { data: article } = await supabase
      .from('cv_articles')
      .select('*')
      .eq('slot_id', slot.id)
      .maybeSingle();

    if (!article) {
      await sendWAMessage(phoneId, phone, '❌ Artikel nicht gefunden.');
      return false;
    }

    // Teilbare Dokumente laden (shareable=true) — der Bot darf sie auf Anfrage als Link geben
    const { data: shareDocs } = await supabase
      .from('cv_uploads')
      .select('file_name, public_url, kind')
      .eq('article_id', article.id)
      .eq('shareable', true);
    const shareableDocs = (shareDocs || []).filter(d => d.public_url);

    // DB-Session anlegen (für Logging + Persistenz)
    const { data: dbSession } = await supabase
      .from('cv_bot_sessions')
      .insert({ slot_id: slot.id, buyer_phone: phone, messages: [], status: 'active', created_at: new Date().toISOString() })
      .select()
      .single();

    // In-Memory-Cache
    cvBotSessions.set(phone, {
      dbSessionId: dbSession?.id,
      slot, article,
      shareableDocs,
      history: [],
      phoneId,
      phone,
      startedAt: Date.now()
    });

    await cvRunBotTurn(phone, null);
    return true;
  }

  // ── AKTIVE SESSION FINDEN ────────────────────────────────
  async function cvGetActiveBotSession(phone) {
    const s = cvBotSessions.get(phone);
    if (!s) return null;
    if (Date.now() - s.startedAt > SESSION_TIMEOUT_MS) {
      cvBotSessions.delete(phone);
      return null;
    }
    return s;
  }

  // ── ANTWORT AUF KÄUFER-NACHRICHT ─────────────────────────
  async function cvHandleBotReply(phone, text, session, phoneId) {
    session.history.push({ role: 'user', content: text });
    await cvRunBotTurn(phone, text);
  }

  // ── EIN BOT-TURN (intern, mit Tool-Use) ──────────────────
  async function cvRunBotTurn(phone, userMessage) {
    const session = cvBotSessions.get(phone);
    if (!session) return;

    const { article, slot } = session;
    const phoneId = session.phoneId;
    const shareableDocs = Array.isArray(session.shareableDocs) ? session.shareableDocs : [];
    const sharedLinks = Array.isArray(session.sharedLinks) ? session.sharedLinks : [];
    const sharedLinksHinweis = sharedLinks.length > 0
      ? '\n\nBereits geteilte Dokument-Links (diese am Ende mit aufführen, falls du zusammenfasst):\n' + sharedLinks.map(l => '• ' + l.name + ': ' + l.url).join('\n')
      : '';
    const analysis = article.analysis || {};
    const strategy = analysis.bot_strategy || {};
    const anrede = article.anrede || 'Sie';
    const botName = (article.bot_name && article.bot_name.trim()) ? article.bot_name.trim() : '';
    const ansprechperson = (article.berater_name && article.berater_name.trim()) ? article.berater_name.trim() : '';
    const strategieText = (article.strategie && article.strategie.trim()) ? article.strategie.trim() : '';

    // Session-State initialisieren falls neu
    if (!session.phase) session.phase = 'interest';
    if (session.currentOffer == null) session.currentOffer = Number(article.sale_price) || null;

    const pdfFacts = Array.isArray(article.pdf_facts) ? article.pdf_facts : [];
    const factsBlock = pdfFacts.length > 0
      ? pdfFacts.map(f => `• ${f.k}: ${f.v}`).join('\n')
      : '(keine extrahierten Dokument-Fakten)';

    // Erste Nachricht: NICHT mehr die vorgespeicherte opening_message als Text senden,
    // weil die in der falschen Anrede sein kann. Stattdessen lassen wir Sonnet die
    // Begrüßung live in der korrekten Slot-Anrede formulieren — Inhalt aus der DNA,
    // Anrede aus dem Slot. Das löst den Du/Sie-Wechsel zuverlässig.
    // (Der weitere Code unten erstellt den Systemprompt und ruft Sonnet — auch für die
    //  erste Nachricht. opening_message dient nur noch als inhaltliche Vorlage im Prompt.)

    const salePrice = Number(article.sale_price) || 0;
    const minPrice  = Number(article.min_price) || 0;

    const systemPrompt = `Du bist ein professioneller WhatsApp-Verkaufsberater für einen echten Verkäufer. Dein Ziel: aktiv verkaufen UND qualifizierte Leads an den Verkäufer weiterreichen. Je mehr ernsthafte Interessenten du an den Verkäufer übergibst, desto besser.

═══════════════════════════════════════════════════════
TON & STIL — sachlich und selbstbewusst, NICHT schwülstig
═══════════════════════════════════════════════════════
Schreibe wie ein kompetenter, ruhiger Fachverkäufer, der sein Produkt kennt — nicht wie eine Werbebroschüre.
- KEINE Werbe-Superlative und Floskeln: vermeide Wörter wie "luxuriös", "traumhaft", "einzigartig", "lässt keine Wünsche offen", "ein wahres Schmuckstück", "ausgezeichnete Wahl", "Wunderbar!", "Fantastisch!".
- Nenne Fakten statt Schwärmerei. Statt "ein luxuriöser 8-Sitzer der keine Wünsche offenlässt" → "ein 8-Sitzer mit Vollleder, Panoramadach und 177-PS-Diesel-Automatik".
- Kurz und konkret. Lieber 2-3 klare Sätze als ein langer Schwall. WhatsApp ist ein Chat, kein Prospekt.
- Emojis sehr sparsam: höchstens eines pro Nachricht, oft gar keines. Niemals 🎉 oder Konfetti-Jubel.
- Bestätige Kaufinteresse ruhig und sachlich ("Gern, dann machen wir das so."), nicht euphorisch ("Wunderbar, das freut mich riesig! 🎉").
- Sei freundlich und zugewandt, aber erwachsen und seriös — gerade bei hochpreisigen Gütern wirkt Zurückhaltung vertrauenswürdiger als Begeisterung.

WER DU BIST — Vorstellung & Echtheit:
${botName
  ? `WICHTIG: Stelle dich mit "${botName}" NUR in deiner allerersten Nachricht vor (z.B. "Hallo, hier ist ${botName}."). Wenn im Gesprächsverlauf bereits Nachrichten ausgetauscht wurden, stelle dich NICHT erneut vor und begrüße nicht noch einmal — antworte direkt auf das Anliegen.`
  : `Du brauchst keinen Eigennamen — stelle dich freundlich als digitaler Verkaufsberater des Teams vor, aber NUR in deiner allerersten Nachricht. Im laufenden Gespräch nicht erneut vorstellen oder begrüßen.`}
Du gibst dich NIE als Mensch aus. Auf die Frage, ob du echt/ein Mensch/eine KI bist, antworte ehrlich: "Ich bin ein digitalisierter Verkaufsberater, der in enger Zusammenarbeit mit dem Kundenbetreuungsteam entstanden ist. Mein Ziel ist es, Ihre Fragen und Wünsche so vorzubereiten, dass das Verkaufsteam Sie schnell, kompetent und effektiv beraten kann." (in der passenden Anrede)
${ansprechperson ? `ANSPRECHPARTNER: Wenn du einen Lead übergibst, einen Rückruf ankündigst oder an den Verkaufsleiter eskalierst, nenne als Ansprechpartner "${ansprechperson}" (z.B. "${ansprechperson} meldet sich bei Ihnen") statt unpersönlich "der Verkäufer".\n` : ''}
PRODUKT: ${article.title}
VERKAUFSPREIS: €${salePrice}
MINDESTPREIS: €${minPrice} (NIEMALS ein Angebot darunter machen!)
STANDORT: ${article.location || 'auf Anfrage'}
ANREDE: ${anrede} (konsequent verwenden)

═══════════════════════════════════════════════════════
KÄUFER-KONTAKT — WICHTIG!
═══════════════════════════════════════════════════════
Du schreibst dem Käufer über WhatsApp. Du HAST seine Telefonnummer bereits: +${phone}
Das heißt:
- Du fragst NIEMALS aktiv nach der Telefonnummer ("wie ist Ihre Nummer?"). Das wäre peinlich — du chattest ja gerade auf dieser Nummer.
- Wenn du Kontaktdaten brauchst (vor dem Zahlungslink), frage NUR nach dem Namen, und bestätige aktiv dass du die WhatsApp-Nummer verwenden darfst.
- Formuliere etwa so: "Ich sehe Ihre WhatsApp-Nummer — darf ich die für die Reservierung verwenden? Dann brauche ich nur noch Ihren Namen." (bzw. mit "du" wenn Anrede=Du)
- Wenn der Käufer zustimmt → seine WhatsApp-Nummer ist die Kontaktnummer. Nicht nochmal explizit erfragen.
- Wenn der Käufer eine andere Nummer angibt: die nehmen.
- Bei collect_contact: trage die WhatsApp-Nummer (+${phone}) als buyer_phone ein, außer der Käufer hat eine andere genannt.

═══════════════════════════════════════════════════════
VERIFIZIERTE FAKTEN ZU DIESEM PRODUKT (aus den Dokumenten)
═══════════════════════════════════════════════════════
${factsBlock}

═══════════════════════════════════════════════════════
WISSEN & FAKTEN — zwei klar getrennte Ebenen
═══════════════════════════════════════════════════════
Du darfst dein allgemeines Fachwissen über die Produktkategorie/Branche nutzen, um kompetent zu beraten. Aber halte ZWEI Ebenen strikt auseinander:

1. ALLGEMEINES FACHWISSEN (darfst du frei nutzen):
   Erkläre Konzepte, Funktionsweisen, branchenübliche Standards, Vergleiche, worauf man beim Kauf achtet. Beispiel: "Elektrostapler werden üblicherweise alle 500-1000 Betriebsstunden oder jährlich gewartet, das ist Branchenstandard." Sei hier souverän wie ein erfahrener Fachverkäufer.

2. PRODUKTSPEZIFISCHE FAKTEN (nur aus den verifizierten Daten oben):
   Konkrete Werte zu DIESEM Produkt (Wartungshistorie, exakte Ausstattung, Zustand, Preis) kommen AUSSCHLIESSLICH aus den verifizierten Dokument-Fakten. Erfinde sie NIEMALS.

DIE TRENNUNG IMMER KENNTLICH MACHEN:
Wenn du allgemeines Wissen nutzt und der konkrete Produktwert nicht in den Fakten steht, trenne klar. Beispiel:
"Allgemein werden solche Stapler etwa jährlich oder alle 1000 Betriebsstunden gewartet. Wie genau der Wartungsplan für diese konkrete Maschine aussieht, kläre ich aber kurz mit dem Verkäufer und melde mich — dann haben Sie eine verlässliche Auskunft."

So wirkst du kompetent UND ehrlich. Niemals so tun als wüsstest du einen konkreten Produktwert wenn er nicht in den Fakten steht.

PRODUKTBESCHREIBUNG: ${analysis.summary || '(keine)'}
ZUSTAND: ${analysis.condition || '(nicht beschrieben)'}
WEITERE HIGHLIGHTS:
${(analysis.key_facts || []).map(f => `• ${f}`).join('\n') || '(keine)'}

VERKAUFSARGUMENTE:
${(analysis.selling_points || []).map((p, i) => `${i+1}. ${p}`).join('\n') || '(keine)'}

HAUPTARGUMENT FÜR DEN PREIS: ${strategy.value_argument || 'Faires Preis-Leistungs-Verhältnis.'}

UMGANG MIT EINWÄNDEN:
${(analysis.likely_objections || []).map(o => `Einwand "${o.objection}" → "${o.response}"`).join('\n') || '(keine vordefiniert)'}

═══════════════════════════════════════════════════════
ANREDE (sehr wichtig — konsistent durchhalten!)
═══════════════════════════════════════════════════════
- Du nutzt die Anrede "${anrede}" — KONSEQUENT in JEDER Nachricht, auch in der allerersten Begrüßung.
- ${anrede === 'Du' ? 'Du-Form: "du / dich / dir / dein". KEIN Wechsel zu "Sie/Ihnen/Ihr" — auch nicht in der Begrüßung.' : 'Sie-Form: "Sie / Ihnen / Ihr". KEIN Wechsel zu "du/dich/dir" — auch nicht in der Begrüßung.'}
- Wenn du selbst auf der Begrüßungsvorlage aus der Wissensbasis basierst und die in der falschen Anrede ist: formuliere sie um in "${anrede}". Die Slot-Anrede gewinnt IMMER.

═══════════════════════════════════════════════════════
VERHANDLUNGS-REGELN
═══════════════════════════════════════════════════════
- Starte bei €${salePrice}. Biete NUR dann einen niedrigeren Preis an wenn der Käufer AKTIV nach einem besseren Preis fragt. Nie proaktiv Rabatt anbieten.
- Maximal 2-3 Zugeständnisse, jedes kleiner als das vorherige, niemals unter €${minPrice}.
- Verhandlungs-Schritte als Orientierung:
${(strategy.negotiation_steps || ['Halte Verkaufspreis', 'Kleines Zugeständnis', 'Bis Mindestpreis']).map(s => '  ' + s).join('\n')}
- Verknappung sparsam & ehrlich einsetzen (Einzelstück, mehrere Interessenten) — nie erfinden.

WICHTIG — Schwelle für Abschluss vs. Eskalation (NIEMALS verwechseln):
- €${minPrice} ist der Mindestpreis. Du darfst zu jedem Preis ≥ €${minPrice} OHNE Rücksprache verkaufen.
- Klare Regel:
  • Käufer-Angebot ≥ €${minPrice}  →  ABSCHLUSS. Direkt akzeptieren, Kontakt sammeln, Zahlungslink schicken. KEINE Eskalation, KEIN "an Verkaufsleiter weiterleiten".
  • Käufer-Angebot < €${minPrice}  →  Versuche ihn auf €${minPrice} hochzubringen. Wenn er nicht hochgeht: dann Eskalation (escalate_to_sales).
- Auch wenn das Käufer-Angebot nur knapp über dem Mindestpreis liegt (z.B. €${minPrice + 10} bei Mindestpreis €${minPrice}): das ist immer noch ABSCHLUSS, nicht Eskalation. Jeder Euro über dem Mindestpreis ist Gewinn.
- Eskaliere NIEMALS aus "Sicherheitsgefühl" oder "lass den Verkaufsleiter bestätigen" — du bist autorisiert bis €${minPrice} runter. Eskaliere nur wenn du WIRKLICH nicht weiterkommst (Käufer unter Mindestpreis und nicht bewegbar).

═══════════════════════════════════════════════════════
ABWICKLUNG & SICHERHEIT (so läuft der Kauf ab)
═══════════════════════════════════════════════════════
- Die Kaufabwicklung läuft IMMER sicher und treuhänderisch über die Plattform ab. Es gibt KEINEN Privatverkauf, keine private Übergabe von Bargeld, kein direkter Geldtausch zwischen Käufer und Verkäufer.
- PFLICHT-ABLAUF BEI RESERVIERUNG/KAUF (genau diese Reihenfolge, KEINEN Schritt auslassen):
  1. Käufer will kaufen/reservieren → erkläre kurz die Anzahlung + Treuhand-Sicherheit.
  2. Frage nach dem NAMEN. Bestätige zugleich dass du die WhatsApp-Nummer verwenden darfst (du brauchst sie NICHT separat zu erfragen, sie liegt bereits vor: +${phone}).
  3. SOBALD du den Namen hast (und die WA-Nummer als Kontakt akzeptiert wurde) → rufe SOFORT create_payment_link auf. Das ist zwingend. Sage NICHT nur "danke" und höre auf — der Käufer wartet auf den Zahlungslink!
  4. Das Tool create_payment_link verschickt den Link automatisch. Danach kannst du dich verabschieden (confirm_commitment).
- NIEMALS bei "Perfekt, danke" stehenbleiben wenn noch kein Zahlungslink verschickt wurde. Wenn der Name da ist und der Käufer reservieren will, ist create_payment_link IMMER dein nächster Schritt.
- Erkläre dem Käufer: "Mit der Anzahlung reservieren Sie verbindlich, das Geld ist sicher über unsere Treuhand geschützt. Der Restbetrag wird bei Übergabe fällig." Das ist ein echtes Sicherheits-Argument.
- Erkläre bei Kaufinteresse sinngemäß: "Die Zahlung läuft sicher ab — Ihr Geld ist geschützt, und der Verkäufer versendet Artikel und Rechnung erst danach an Sie." Das ist ein echtes Vertrauens- und Sicherheits-Argument, nutze es aktiv besonders bei höherpreisigen Artikeln.
- NENNE NIEMALS eine Provision, Gebühr oder einen Vermittlungsanteil. Der Käufer zahlt den verhandelten Preis — Punkt. Über interne Abläufe sprichst du nicht.
- Stelle dich nicht als Verkäufer dar ("ich verkaufe Ihnen..."). Du bist der Verkaufsberater der die sichere Abwicklung vermittelt. Der eigentliche Verkäufer stellt Rechnung und versendet die Ware.
- Erfinde keine Abwicklungs-Details die du nicht kennst (keine konkreten Versandzeiten/Zahlungsmethoden zusagen, die nicht in den Fakten stehen). Im Zweifel: "die genauen Details der Abwicklung bekommen Sie verbindlich von uns, sobald wir Ihre Daten haben."

═══════════════════════════════════════════════════════
DEINE WERKZEUGE — wann du sie einsetzt
═══════════════════════════════════════════════════════
GRUNDREGEL: Wenn du ein Werkzeug nutzt, schreibe IMMER auch einen kurzen begleitenden Satz dazu — rufe NIE wortlos ein Werkzeug auf. Beende das Gespräch nicht abrupt: nach einer Aktion (z.B. Link/Unterlagen geteilt) sag freundlich, was als Nächstes passiert, und halte das Gespräch offen ("…bei Fragen bin ich da", "…sonst noch etwas?").
- flag_hot_lead: Sobald der Käufer ernsthaftes Kaufinteresse zeigt (will kaufen, fragt nach Übergabe/Probefahrt/Verfügbarkeit, oder will mit dem Verkäufer sprechen). Reiche den Lead SOFORT weiter — lieber zu früh als zu spät.
- collect_contact: Wenn konkretes Interesse da ist, frage natürlich nach dem NAMEN und bestätige die WhatsApp-Nummer als Kontakt. Bei Email optional. Erst bei echtem Interesse, nicht am Anfang.
- agree_deal: Wenn sich Käufer und du auf einen Preis einigen. Vorher Kontaktdaten sichern.
- create_payment_link: NACH der Einigung UND wenn du Name + Kontaktdaten hast — erstellt den sicheren Anzahlungs-Zahlungslink und schickt ihn dem Käufer. Nutze dies wenn der Käufer bereit ist zu reservieren/zu zahlen.
- escalate_to_sales: Wenn der Käufer hartnäckig UNTER €${minPrice} will und nicht nachgibt. Sage sinngemäß: "Meine Möglichkeiten sind hier erschöpft, aber ich habe einen Vorschlag — unser Verkaufsleiter meldet sich bei Ihnen, der hat oft noch die eine oder andere Idee."
- request_callback: Wenn ein Rückruf/Termin vereinbart wird — mit konkretem Zeitfenster.
- confirm_commitment: Der allerletzte Schritt, der das Gespräch beendet — siehe Commitment-Phase unten.

═══════════════════════════════════════════════════════
PFLICHT-ABLAUF BEI LEAD / EINIGUNG / ESKALATION (sehr wichtig!)
═══════════════════════════════════════════════════════
Sobald du an den Verkäufer/Verkaufsleiter übergibst, führe IMMER diese 3 Schritte in dieser Reihenfolge durch — niemals einfach nur "Danke" sagen:
1. KONTAKT: Frage nach Name und Telefonnummer (falls noch nicht bekannt).
2. ZEITFENSTER: Frage AKTIV nach einem konkreten Rückruf-Zeitfenster. Z.B. "Wann erreichen wir Sie am besten — heute Nachmittag, morgen Vormittag, oder haben Sie eine bestimmte Uhrzeit?"
3. VERBINDLICHE BESTÄTIGUNG: Wiederhole das Vereinbarte konkret zurück und gib Sicherheit. Z.B. "Perfekt — ich gebe Ihre Daten direkt an unseren Verkaufsleiter weiter. Er ruft Sie [Zeitfenster] unter [Nummer] an. Er hat oft Spielraum den ich nicht habe."

═══════════════════════════════════════════════════════
COMMITMENT-PHASE — JEDES Gespräch endet mit gegenseitiger Zusage
═══════════════════════════════════════════════════════
Verabschiede dich NIEMALS ohne ein gemeinsames Commitment. Egal ob Erfolg oder nicht — beende wie ein guter realer Verkäufer:

A) BEI ERFOLG (Lead/Deal/Eskalation/Rückruf):
   - Fasse die Vereinbarung konkret zusammen (Name, Nummer, Zeitfenster, ggf. Preis).
   - Hole ein AKTIVES JA des Käufers: "Passt das so für Sie?"
   - Verabschiede dich erst NACH dem Ja verbindlich und herzlich, mit Vorfreude auf den nächsten Schritt.
   - Erst dann das passende Werkzeug (agree_deal / escalate_to_sales / request_callback) und dann confirm_commitment mit committed=true aufrufen.

B) BEI MISSERFOLG (keine Preiseinigung, kein Interesse):
   - Wenn der Käufer zögert oder abspringt: Versuche EINMAL nachzufassen und den Einwand zu überwinden ("Was hält Sie noch zurück?").
   - Bleibt es dabei: Fasse fair zusammen, z.B. "Unser Gespräch hat ergeben, dass wir uns momentan nicht auf einen gemeinsamen Preis einigen können. Vielleicht schaffen wir es beim nächsten Mal. Danke für Ihr Interesse — schönen Abend!"
   - Lass die Tür ausdrücklich offen für die Zukunft.
   - Dann confirm_commitment mit committed=false aufrufen.

WICHTIG: confirm_commitment ist IMMER der allerletzte Schritt der ein Gespräch beendet. Rufe es erst auf nachdem du dich verabschiedet hast und (bei Erfolg) der Käufer zugestimmt hat.

WICHTIG zu Werkzeugen:
- Du kannst in einem Zug Text schreiben UND ein Werkzeug aufrufen.
- Erfinde NIEMALS Kontaktdaten oder Zeitfenster. Nutze nur was der Käufer wirklich genannt hat.
- IMMER wenn der Käufer einen Namen (oder eine abweichende Telefonnummer) nennt → rufe collect_contact mit den Daten auf. Antworte NIE nur mit Text wenn ein Name genannt wurde — das Werkzeug ist Pflicht, sonst gehen die Daten verloren.
- Bei Reservierungs-/Kaufabsicht gilt der Pflicht-Ablauf: collect_contact (Name + bestätigte WA-Nummer) → dann create_payment_link. Niemals mit "danke" enden bevor der Zahlungslink verschickt ist.

STIL: WhatsApp — kurz, natürlich, max. 3-4 Sätze. Aktiv verkaufen, nicht nur antworten. Niemals Fakten erfinden.${strategieText ? `

═══ GESPRÄCHSSTRATEGIE (vom Betreiber vorgegeben — wichtig!) ═══
Folge dieser Strategie im Gespräch. Es ist eine Reihenfolge von Angeboten: Biete zuerst das Erste an; wenn der Interessent ablehnt oder zögert, gehe zum Nächsten über — Schritt für Schritt, natürlich und nicht aufdringlich. Dränge nie, biete an. Links/Angebote genau so weitergeben wie angegeben:
${strategieText}` : ''}${shareableDocs.length > 0 ? `

═══ TEILBARE DOKUMENTE ═══
Diese Unterlagen darfst du dem Interessenten auf Wunsch (oder wenn es im Gespräch passt) als Download-Link geben. Nutze dafür das Werkzeug share_document mit dem exakten Dateinamen. Sage kurz, was das Dokument enthält, und teile dann den Link. Gib NUR diese Dokumente heraus:
${shareableDocs.map(d => '• ' + d.file_name).join('\n')}` : ''}

═══ LINKS AM GESPRÄCHSENDE BÜNDELN ═══
Wenn das Gespräch zum Ende kommt (Verabschiedung, "danke das war hilfreich", oder der Interessent will erstmal nichts weiter), und du im Verlauf einen oder mehrere Links/Dokumente geteilt hast: Fasse zum Abschluss alle besprochenen Links kurz und übersichtlich in EINER Nachricht zusammen, damit der Interessent alles auf einen Blick hat. Kurz beschriften, was jeder Link ist. Nur Links nennen, die du im Gespräch tatsächlich geteilt/angeboten hast — nichts erfinden. Wenn keine Links geteilt wurden, lass die Zusammenfassung weg.${sharedLinksHinweis}`;

    // BERATUNGS-MODUS: anderen Prompt verwenden (kein Verkauf/keine Preise/Lead an Berater übergeben)
    const istBeratung = (slot && slot.mode === 'beratung');
    // Hat der Bot in dieser Session schon geantwortet? Dann nicht erneut vorstellen.
    const schonGeantwortet = Array.isArray(session.history) && session.history.some(m => m && m.role === 'assistant');
    const erstHinweisWA = schonGeantwortet
      ? '\n\n⚠️ WICHTIG: Dies ist NICHT der Gesprächsbeginn — ihr habt euch bereits unterhalten. Stelle dich NICHT vor, begrüße NICHT erneut, sage nicht nochmal "Hallo, hier ist …". Antworte direkt und natürlich auf die letzte Nachricht, als Fortsetzung des laufenden Gesprächs.'
      : '';
    // In die Unterhaltung "hineinwachsen": früh sehr knapp, später etwas mehr Prosa.
    const botAntworten = Array.isArray(session.history) ? session.history.filter(m => m && m.role === 'assistant').length : 0;
    const laengenHinweisWA = cvLaengenHinweis(botAntworten);
    const effectiveSystemPrompt = (istBeratung
      ? cvBuildBeratungPrompt(article, 'whatsapp', shareableDocs, sharedLinks) + '\n\nSTIL: WhatsApp — kurz und natürlich, max. 3-4 Sätze pro Nachricht.'
      : systemPrompt) + erstHinweisWA + laengenHinweisWA;

    // ── Tools definieren ──
    const tools = [
      {
        name: 'flag_hot_lead',
        description: 'Markiere diesen Käufer als heißen Lead und reiche ihn an den Verkäufer weiter. Nutze dies SOFORT sobald ernsthaftes Kaufinteresse erkennbar ist oder der Käufer mit dem Verkäufer sprechen will.',
        input_schema: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Kurz: warum ist das ein heißer Lead' },
            buyer_name: { type: 'string', description: 'Name des Käufers falls bekannt, sonst leer' },
            buyer_phone: { type: 'string', description: 'Rückrufnummer falls genannt, sonst leer' }
          },
          required: ['reason']
        }
      },
      {
        name: 'share_document',
        description: 'Teile ein freigegebenes Dokument (z.B. Datenblatt, Broschüre, Dossier) mit dem Interessenten, indem du ihm den Download-Link gibst. Nutze dies, wenn der Interessent Unterlagen möchte oder die Strategie es vorsieht. Du erhältst den Link zurück und teilst ihn dann mit einer kurzen Beschreibung, was drin ist. Gib NUR Dokumente aus der Liste der freigegebenen Dokumente heraus.',
        input_schema: {
          type: 'object',
          properties: {
            document_name: { type: 'string', description: 'Der exakte Dateiname des Dokuments aus der Liste der freigegebenen Dokumente' }
          },
          required: ['document_name']
        }
      },
      {
        name: 'collect_contact',
        description: 'Speichere die Kontaktdaten des Käufers nachdem er sie genannt hat. Wenn der Käufer auch ein Rückruf-Zeitfenster genannt hat, gib es in preferred_time an.',
        input_schema: {
          type: 'object',
          properties: {
            buyer_name: { type: 'string' },
            buyer_phone: { type: 'string' },
            buyer_email: { type: 'string' },
            preferred_time: { type: 'string', description: 'Vereinbartes Rückruf-Zeitfenster falls genannt' }
          },
          required: ['buyer_name']
        }
      },
      {
        name: 'agree_deal',
        description: 'Eine Einigung wurde erzielt. Erfasse den vereinbarten Preis und übergib an den Verkäufer.',
        input_schema: {
          type: 'object',
          properties: {
            agreed_price: { type: 'number', description: 'Vereinbarter Preis in Euro' },
            buyer_name: { type: 'string' },
            buyer_phone: { type: 'string' },
            preferred_time: { type: 'string', description: 'Vereinbartes Übergabe-/Kontakt-Zeitfenster falls genannt' }
          },
          required: ['agreed_price']
        }
      },
      {
        name: 'create_payment_link',
        description: 'Erstellt einen sicheren Stripe-Zahlungslink für die Reservierungs-Anzahlung. NUR aufrufen NACHDEM eine Preiseinigung erzielt wurde UND du Name + Kontaktdaten des Käufers hast. Der Käufer zahlt die Anzahlung, der Rest wird bei Übergabe fällig. Sage dem Käufer dass die Zahlung sicher über die Plattform-Treuhand läuft.',
        input_schema: {
          type: 'object',
          properties: {
            agreed_price: { type: 'number', description: 'Der final vereinbarte Gesamtpreis in Euro' }
          },
          required: ['agreed_price']
        }
      },
      {
        name: 'escalate_to_sales',
        description: `Eskalation an den Verkaufsleiter NUR wenn der Käufer einen Preis UNTER dem Mindestpreis (€${minPrice}) fordert und nicht hochgeht. NICHT bei einem Angebot AUF dem Mindestpreis — das ist Abschluss. Gib das vereinbarte Rückruf-Zeitfenster in preferred_time an.`,
        input_schema: {
          type: 'object',
          properties: {
            buyer_wants_price: { type: 'number', description: 'Welchen Preis der Käufer will' },
            buyer_name: { type: 'string' },
            buyer_phone: { type: 'string' },
            preferred_time: { type: 'string', description: 'Vereinbartes Rückruf-Zeitfenster falls genannt' }
          },
          required: []
        }
      },
      {
        name: 'request_callback',
        description: 'Ein Rückruf wurde mit konkretem Zeitfenster vereinbart. IMMER mit preferred_time aufrufen.',
        input_schema: {
          type: 'object',
          properties: {
            preferred_time: { type: 'string', description: 'Vereinbartes Rückruf-Zeitfenster, z.B. "heute Nachmittag", "morgen 14 Uhr"' },
            buyer_name: { type: 'string' },
            buyer_phone: { type: 'string' }
          },
          required: ['preferred_time']
        }
      },
      {
        name: 'confirm_commitment',
        description: 'ALLERLETZTER Schritt der das Gespräch beendet. Rufe dies erst auf nachdem du dich verabschiedet hast. Bei Erfolg (committed=true) erst nachdem der Käufer aktiv zugestimmt hat. Bei Misserfolg (committed=false) nachdem du fair abgeschlossen und die Tür offen gelassen hast.',
        input_schema: {
          type: 'object',
          properties: {
            committed: { type: 'boolean', description: 'true = Käufer hat zugestimmt / Übergabe vereinbart. false = keine Einigung, aber fair verabschiedet.' },
            summary: { type: 'string', description: 'Kurze Zusammenfassung was vereinbart wurde (oder warum nicht)' }
          },
          required: ['committed']
        }
      }
    ];

    // History normalisieren: Rollen MÜSSEN alternieren (API-Anforderung).
    // Aufeinanderfolgende gleiche Rollen zusammenfassen (passiert wenn
    // Käufer mehrere Nachrichten schnell hintereinander schickt).
    function normalizeHistory(hist) {
      const out = [];
      for (const m of hist) {
        // Nur gültige Einträge mit nicht-leerem String-Content
        if (!m || !m.role) continue;
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        let c = m.content;
        if (typeof c !== 'string') c = String(c || '');
        c = c.trim();
        if (!c) continue;  // leere Nachrichten raus
        const last = out[out.length - 1];
        if (last && last.role === m.role) {
          last.content += '\n' + c;  // zusammenfassen
        } else {
          out.push({ role: m.role, content: c });
        }
      }
      // Muss mit user-Rolle beginnen (sonst lehnt API ab)
      while (out.length && out[0].role !== 'user') out.shift();
      return out;
    }

    const messages = userMessage === null
      ? [{ role: 'user', content: 'START: Begrüße den Käufer KURZ und natürlich (1-2 Sätze, wie ein echter Mensch im Chat). Stelle dich knapp vor, nenne kurz das Produkt, das ihn interessiert, und frage, wie du helfen kannst. KEINE lange Produktbeschreibung, KEINE Aufzählung von Ausstattung — das kommt erst, wenn er fragt. Beispiel-Ton: "Hallo, ich bin [Name] vom Verkaufsteam. Sie interessieren sich für den [Produkt] — wie kann ich Ihnen helfen?"' }]
      : normalizeHistory(session.history);

    // Sicherheitsnetz: leere oder ungültige messages
    if (messages.length === 0) {
      messages.push({ role: 'user', content: userMessage || 'Hallo' });
    }

    // API-Call mit automatischem Retry (gegen transiente Fehler)
    let response, lastErr;
    // Bei Beratung: nur Lead-/Kontakt-Tools zulassen (keine Preis-/Deal-/Zahlungs-Tools)
    const beratungToolNamen = ['flag_hot_lead', 'collect_contact', 'request_callback', 'share_document'];
    const effectiveTools = istBeratung
      ? tools.filter(t => beratungToolNamen.indexOf(t.name) !== -1)
      : tools;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 800,
            system: effectiveSystemPrompt,
            tools: effectiveTools,
            messages
          })
        });
        if (response.ok) break;  // Erfolg → raus aus Retry

        // Fehler-Detail loggen
        const errText = await response.text();
        lastErr = `${response.status}: ${errText.substring(0, 400)}`;
        console.error(`[CV Bot] Versuch ${attempt}/3 fehlgeschlagen:`, lastErr);
        console.error('[CV Bot] messages:', JSON.stringify(messages).substring(0, 300));

        // Bei 400 (Bad Request) macht Retry keinen Sinn — History ist kaputt
        if (response.status === 400) break;

        // Bei 429/5xx: kurz warten und nochmal
        await new Promise(r => setTimeout(r, attempt * 800));
      } catch(e) {
        lastErr = e.message;
        console.error(`[CV Bot] Versuch ${attempt}/3 Netzwerkfehler:`, e.message);
        await new Promise(r => setTimeout(r, attempt * 800));
      }
    }

    try {
      // LETZTE RETTUNG: Wenn alles fehlschlug (oft Tool-Schema/History-Problem),
      // versuche einen einfachen Call OHNE Tools — Hauptsache der Käufer
      // bekommt eine echte fachliche Antwort statt einer Sackgasse.
      if (!response || !response.ok) {
        console.error('[CV Bot] Haupt-Call fehlgeschlagen, versuche Fallback ohne Tools. lastErr:', lastErr);
        try {
          const fb = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-6',
              max_tokens: 700,
              system: effectiveSystemPrompt + '\n\nWICHTIG: Antworte in diesem Fall NUR mit normalem Text, ohne Werkzeuge.',
              messages
            })
          });
          if (fb.ok) {
            const fbData = await fb.json();
            const fbText = (fbData.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
            if (fbText) {
              await sendWAMessage(phoneId, phone, fbText);
              session.history.push({ role: 'assistant', content: fbText });
              await persistSession(session);
              return;
            }
          } else {
            const fbErr = await fb.text();
            console.error('[CV Bot] Fallback ohne Tools auch fehlgeschlagen:', fb.status, fbErr.substring(0, 300));
          }
        } catch(fbE) {
          console.error('[CV Bot] Fallback-Exception:', fbE.message);
        }

        // Wenn selbst der Fallback scheitert: ehrliche Nachricht, Bot bleibt im Spiel
        const du = anrede === 'Du';
        await sendWAMessage(phoneId, phone, du
          ? 'Sorry, da war kurz eine technische Störung. Stell deine Frage gern nochmal — ich bin gleich wieder voll da! 🙂'
          : 'Entschuldigen Sie, da war kurz eine technische Störung. Stellen Sie Ihre Frage gern nochmal — ich bin gleich wieder voll da! 🙂');
        return;
      }

      const data = await response.json();
      const blocks = data.content || [];

      // Text-Blöcke und Tool-Use-Blöcke trennen
      const textParts = blocks.filter(b => b.type === 'text').map(b => b.text);
      const toolCalls = blocks.filter(b => b.type === 'tool_use');
      let botReply = textParts.join('\n').trim();
      // Sicherheitsnetz: WhatsApp kennt kein Formular — falls das Modell doch [[KONTAKT]] setzt, entfernen
      if (botReply.indexOf('[[KONTAKT]]') !== -1) {
        botReply = botReply.replace(/\[\[KONTAKT\]\]/g, '').trim();
      }

      // Tools verarbeiten
      session._shareLink = null;
      for (const tc of toolCalls) {
        await cvHandleToolCall(session, phone, tc.name, tc.input || {});
      }

      // Falls Bot nur ein Tool aufrief ohne Text — sinnvollen Fallback-Text bauen
      if (!botReply && toolCalls.length > 0) {
        botReply = cvFallbackTextForTool(toolCalls[0].name, anrede, article, istBeratung);
      }
      if (!botReply) botReply = 'Einen Moment bitte.';

      // Wenn ein Dokument geteilt wurde: Link an die Antwort anhängen
      if (session._shareLink && session._shareLink.url) {
        botReply = botReply.replace(/\s*$/, '') + '\n\n📎 ' + session._shareLink.url;
        session._shareLink = null;
      }

      await sendWAMessage(phoneId, phone, botReply);

      // History pflegen
      if (userMessage !== null) {
        session.history.push({ role: 'assistant', content: botReply });
      } else {
        session.history = [{ role: 'assistant', content: botReply }];
      }
      await persistSession(session);

      // ── AUTO-FOLGEAKTION: Zahlungslink ──────────────────────
      // Wenn der Bot gerade Kontakt gesichert ODER sich geeinigt hat,
      // eine Reservierungs-/Kaufabsicht besteht und noch KEIN Zahlungslink
      // verschickt wurde → erzwinge eine Folgerunde, die den Link schickt.
      // Das verhindert das Steckenbleiben bei "Perfekt, danke!".
      const calledContact = toolCalls.some(t => t.name === 'collect_contact' || t.name === 'agree_deal');
      const calledLink = toolCalls.some(t => t.name === 'create_payment_link');
      const closingNow = toolCalls.some(t => t.name === 'confirm_commitment');
      if (!istBeratung && calledContact && !calledLink && !session.paymentLinkSent && !closingNow
          && cvStripe && session.buyerName && session.buyerPhone
          && !session._autoLinkTried) {
        session._autoLinkTried = true;  // nur einmal versuchen
        console.log('[CV Bot] Auto-Folgeaktion: erzwinge create_payment_link');
        // Direkt den Link erstellen und schicken — ohne erneuten Modell-Call,
        // damit garantiert kein "danke" ohne Link passiert.
        await cvHandleToolCall(session, phone, 'create_payment_link', { agreed_price: session.agreedPrice });
        await persistSession(session);
      }

      // Session NUR durch confirm_commitment schließen — das ist der
      // verbindliche gemeinsame Abschluss. Alles davor hält die Session offen,
      // damit Kontaktdaten, Zeitfenster und das aktive "Ja" eingesammelt werden.
      const closing = toolCalls.find(t => t.name === 'confirm_commitment');
      if (closing) {
        cvBotSessions.delete(phone);
      } else if (session.history.length > 40) {
        // Sicherheitsnetz gegen Endlos-Chats
        await cvLogEvent(session, phone, 'lost', { reason: 'Konversation zu lang' }, true);
        cvBotSessions.delete(phone);
      }
    } catch(e) {
      console.error('[CV Bot turn]', e);
    }
  }

  // ── Tool-Aufruf verarbeiten ──────────────────────────────
  async function cvHandleToolCall(session, phone, toolName, input) {
    try {
      // Käufer-Kontakt + Zeitfenster in Session mergen
      if (input.buyer_name)     session.buyerName    = input.buyer_name;
      if (input.buyer_phone)    session.buyerPhone   = input.buyer_phone;
      if (input.buyer_email)    session.buyerEmail   = input.buyer_email;
      if (input.preferred_time) session.callbackTime = input.preferred_time;

      // Auto-Fallback: Wenn collect_contact (oder agree_deal) aufgerufen wird und
      // noch keine buyerPhone gesetzt ist, übernehme automatisch die WhatsApp-Nummer
      // des Käufers. Der Bot soll nicht extra danach fragen — wir chatten ja darüber.
      if ((toolName === 'collect_contact' || toolName === 'agree_deal') && !session.buyerPhone && phone) {
        session.buyerPhone = phone;
      }

      const updates = {};
      if (session.buyerName)    updates.buyer_name          = session.buyerName;
      if (session.buyerPhone)   updates.buyer_contact_phone = session.buyerPhone;
      if (session.buyerEmail)   updates.buyer_email         = session.buyerEmail;
      if (session.callbackTime) updates.callback_time       = session.callbackTime;

      switch (toolName) {
        case 'flag_hot_lead':
          session.phase = 'closing';
          updates.phase = 'closing';
          updates.lead_flagged_at = new Date().toISOString();
          if (!session.notified) {
            await cvLogEvent(session, phone, 'hot_lead', {
              reason: input.reason || '',
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone, preferred_time: session.callbackTime
            });
            session.notified = true;
          } else {
            await cvLogEvent(session, phone, 'hot_lead', {
              reason: 'Update: ' + (input.reason || 'weitere Infos'),
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone, preferred_time: session.callbackTime
            }, true);  // silent: nur loggen, nicht nochmal melden
          }
          break;

        case 'share_document': {
          // Freigegebenes Dokument finden und dessen Link für die Antwort vormerken
          const docs = Array.isArray(session.shareableDocs) ? session.shareableDocs : [];
          const wanted = (input.document_name || '').trim().toLowerCase();
          let doc = docs.find(d => (d.file_name || '').toLowerCase() === wanted)
                 || docs.find(d => (d.file_name || '').toLowerCase().indexOf(wanted) !== -1 && wanted.length > 2);
          if (doc && doc.public_url) {
            session._shareLink = { name: doc.file_name, url: doc.public_url };
            if (!Array.isArray(session.sharedLinks)) session.sharedLinks = [];
            if (!session.sharedLinks.some(x => x.url === doc.public_url)) {
              session.sharedLinks.push({ name: doc.file_name, url: doc.public_url });
            }
            await cvLogEvent(session, phone, 'document_shared', { document: doc.file_name }, true);
          } else {
            session._shareLink = null;
          }
          break;
        }

        case 'collect_contact':
          session.phase = 'closing';
          updates.phase = 'closing';
          // Wenn schon eskaliert/gemeldet: Verkäufer mit Kontaktdaten-Update versorgen
          if (session.notified) {
            await cvLogEvent(session, phone, 'contact_added', {
              reason: 'Kontaktdaten zum Lead',
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone, buyer_email: session.buyerEmail, preferred_time: session.callbackTime
            });
          } else {
            await cvLogEvent(session, phone, 'hot_lead', {
              reason: 'Kontaktdaten erfasst',
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone, buyer_email: session.buyerEmail, preferred_time: session.callbackTime
            });
            session.notified = true;
          }
          break;

        case 'agree_deal':
          session.phase = 'closed';
          updates.phase = 'closed';
          updates.status = 'deal';
          if (input.agreed_price) { updates.agreed_price = input.agreed_price; session.agreedPrice = input.agreed_price; }
          await cvLogEvent(session, phone, 'agreed', {
            agreed_price: input.agreed_price,
            buyer_name: session.buyerName, buyer_phone: session.buyerPhone, buyer_email: session.buyerEmail, preferred_time: session.callbackTime
          });
          session.notified = true;
          break;

        case 'create_payment_link': {
          if (input.agreed_price) session.agreedPrice = input.agreed_price;
          const result = await cvCreateDepositLink(session);
          if (result) {
            const du = (session.article.anrede || 'Sie') === 'Du';
            const linkMsg = du
              ? `Um „${session.article.title}" verbindlich für dich zu reservieren, fällt eine Anzahlung von *€${result.deposit.toFixed(2)}* (${result.depositPct}%) an — sicher über unsere Treuhand. 🔒\n\nDen Restbetrag von €${result.restbetrag.toFixed(2)} klärst du direkt bei der Übergabe mit dem Verkäufer.\n\nHier dein sicherer Zahlungslink:\n${result.url}`
              : `Um „${session.article.title}" verbindlich für Sie zu reservieren, fällt eine Anzahlung von *€${result.deposit.toFixed(2)}* (${result.depositPct}%) an — sicher über unsere Treuhand. 🔒\n\nDen Restbetrag von €${result.restbetrag.toFixed(2)} klären Sie direkt bei der Übergabe mit dem Verkäufer.\n\nHier Ihr sicherer Zahlungslink:\n${result.url}`;
            await sendWAMessage(session.phoneId, phone, linkMsg);
            session.history.push({ role: 'assistant', content: linkMsg });
            // Event: Link verschickt
            await cvLogEvent(session, phone, 'payment_link_sent', {
              deposit: result.deposit, agreed_price: result.agreed,
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone
            }, true);
            session.paymentLinkSent = true;
          } else {
            // Fehler beim Link — ehrlich bleiben, Lead an Verkäufer
            const du = (session.article.anrede || 'Sie') === 'Du';
            await sendWAMessage(session.phoneId, phone, du
              ? 'Einen Moment — ich richte gerade die Reservierung ein und der Verkäufer meldet sich gleich bei dir mit den Zahlungsdetails.'
              : 'Einen Moment — ich richte gerade die Reservierung ein und der Verkäufer meldet sich gleich bei Ihnen mit den Zahlungsdetails.');
            await cvLogEvent(session, phone, 'hot_lead', {
              reason: 'Zahlungslink-Erstellung fehlgeschlagen — bitte manuell kontaktieren',
              buyer_name: session.buyerName, buyer_phone: session.buyerPhone
            });
          }
          break;
        }

        case 'escalate_to_sales':
          session.phase = 'escalated';
          updates.phase = 'escalated';
          updates.status = 'callback';
          await cvLogEvent(session, phone, 'escalated', {
            buyer_wants_price: input.buyer_wants_price,
            min_price: session.article.min_price,
            buyer_name: session.buyerName, buyer_phone: session.buyerPhone, preferred_time: session.callbackTime
          });
          session.notified = true;
          break;

        case 'request_callback':
          updates.status = 'callback';
          await cvLogEvent(session, phone, 'callback', {
            preferred_time: session.callbackTime || input.preferred_time || '',
            buyer_name: session.buyerName, buyer_phone: session.buyerPhone
          });
          session.notified = true;
          break;

        case 'confirm_commitment':
          if (input.committed) {
            // Erfolg ist meist schon durch agree_deal/escalate/callback geloggt.
            // Nur loggen falls noch gar nichts gemeldet wurde.
            session.phase = session.phase === 'interest' ? 'closing' : session.phase;
            updates.phase = session.phase;
            if (!session.notified) {
              await cvLogEvent(session, phone, 'hot_lead', {
                reason: 'Commitment bestätigt: ' + (input.summary || ''),
                buyer_name: session.buyerName, buyer_phone: session.buyerPhone,
                buyer_email: session.buyerEmail, preferred_time: session.callbackTime
              });
              session.notified = true;
            }
          } else {
            // Fairer Misserfolg — kein Verkäufer-Alarm nötig, nur protokollieren
            session.phase = 'lost';
            updates.phase = 'lost';
            updates.status = 'lost';
            await cvLogEvent(session, phone, 'lost', {
              reason: input.summary || 'Keine Einigung, fair verabschiedet'
            }, true);  // silent: Misserfolg nicht an Verkäufer melden
          }
          break;
      }

      // Session-Updates in DB schreiben
      if (session.dbSessionId && Object.keys(updates).length > 0) {
        updates.last_message_at = new Date().toISOString();
        await supabase.from('cv_bot_sessions').update(updates).eq('id', session.dbSessionId);
      }
    } catch(e) {
      console.error('[CV tool]', toolName, e.message);
    }
  }

  // ── Antwortlänge je nach Gesprächsphase ("hineinwachsen") ───
  // botAntworten = wie oft der Bot in dieser Session schon geantwortet hat.
  //  0 = die kommende Antwort ist die Begrüßung (separat kurz geregelt)
  //  1 = die 2. Bot-Antwort  → so knapp wie möglich, aber aussagekräftig
  //  2 = die 3. Bot-Antwort  → etwas mehr Prosa erlaubt, aber dosiert
  //  3+ = normal, generell eher knapp
  function cvLaengenHinweis(botAntworten) {
    if (botAntworten === 1) {
      return '\n\n📏 ANTWORTLÄNGE: Halte diese Antwort SO KNAPP WIE MÖGLICH — idealerweise 1, höchstens 2 Sätze. Auf den Punkt, aber aussagekräftig. Noch keine Ausschweifungen, keine Aufzählungen. Beantworte nur, wonach gefragt wurde.';
    }
    if (botAntworten === 2) {
      return '\n\n📏 ANTWORTLÄNGE: Jetzt darfst du etwas ausführlicher werden — aber dosiert, maximal 2-3 Sätze. Bring etwas mehr Substanz, ohne auszuufern.';
    }
    if (botAntworten >= 3) {
      return '\n\n📏 ANTWORTLÄNGE: Antworte natürlich und vollständig, aber bleibe insgesamt eher knapp — kein langer Fließtext, keine unnötigen Wiederholungen. Lieber ein, zwei klare Sätze mehr als ein Absatz.';
    }
    return '';
  }

  // ── Fallback-Text falls Bot nur Tool ohne Text aufrief ───
  function cvFallbackTextForTool(toolName, anrede, article, istBeratung) {
    const du = anrede === 'Du';
    const berater = (article && article.berater_name && article.berater_name.trim()) ? article.berater_name.trim() : 'unser Berater';

    // BERATUNGS-MODUS: warmer Abschluss mit Nachbetreuungs-Versprechen, kein Verkauf
    if (istBeratung) {
      switch (toolName) {
        case 'share_document':
          return du
            ? 'Klar, ich schick dir die Unterlagen — schau sie dir in Ruhe an. Wenn du Fragen hast, bin ich da.'
            : 'Sehr gerne, ich sende Ihnen die Unterlagen — schauen Sie sie sich in Ruhe an. Bei Fragen bin ich da.';
        case 'collect_contact':
        case 'flag_hot_lead':
        case 'request_callback':
          return du
            ? `Vielen Dank! Ich gebe deine Daten direkt an ${berater} weiter — er meldet sich bei dir und hat bestimmt einen guten Vorschlag für deine Situation. Schönen Tag noch!`
            : `Vielen Dank! Ich gebe Ihre Daten direkt an ${berater} weiter — er meldet sich bei Ihnen und hat bestimmt einen guten Vorschlag für Ihre Situation. Einen schönen Tag noch!`;
        case 'confirm_commitment':
          return du
            ? `Danke für das Gespräch! ${berater} meldet sich wie besprochen bei dir. Bis dahin alles Gute!`
            : `Vielen Dank für das Gespräch! ${berater} meldet sich wie besprochen bei Ihnen. Bis dahin alles Gute!`;
        default:
          return du ? 'Mach ich! Gibt es sonst noch etwas, das ich für dich tun kann?'
                    : 'Mache ich! Gibt es sonst noch etwas, das ich für Sie tun kann?';
      }
    }

    switch (toolName) {
      case 'share_document':
        return du ? 'Klar, ich schick dir die Unterlagen — schau sie dir in Ruhe an. Wenn du Fragen hast, bin ich da.'
                  : 'Sehr gerne, ich sende Ihnen die Unterlagen — schauen Sie sie sich in Ruhe an. Bei Fragen bin ich da.';
      case 'collect_contact':
        return du ? 'Super! Wie ist dein Name und unter welcher Nummer erreichen wir dich — und wann passt dir ein Rückruf am besten?'
                  : 'Sehr gerne! Wie ist Ihr Name und unter welcher Nummer erreichen wir Sie — und wann passt Ihnen ein Rückruf am besten?';
      case 'flag_hot_lead':
        return du ? 'Klingt gut! Wann erreichen wir dich am besten für einen Rückruf — heute noch oder lieber morgen?'
                  : 'Wunderbar! Wann erreichen wir Sie am besten für einen Rückruf — heute noch oder lieber morgen?';
      case 'agree_deal':
        return du ? 'Perfekt, dann haben wir einen Deal! Wann passt dir die Übergabe am besten? Der Verkäufer richtet sich nach dir.'
                  : 'Perfekt, dann haben wir eine Einigung! Wann passt Ihnen die Übergabe am besten? Der Verkäufer richtet sich nach Ihnen.';
      case 'escalate_to_sales':
        return du ? 'Meine Möglichkeiten sind hier erschöpft, aber ich hab einen Vorschlag: Unser Verkaufsleiter meldet sich bei dir, der hat oft noch eine Idee. Wann erreicht er dich am besten?'
                  : 'Meine Möglichkeiten sind hier erschöpft, aber ich habe einen Vorschlag: Unser Verkaufsleiter meldet sich bei Ihnen, der hat oft noch eine Idee. Wann erreicht er Sie am besten?';
      case 'request_callback':
        return du ? 'Alles klar, ich organisiere den Rückruf — der Verkäufer meldet sich wie vereinbart bei dir!'
                  : 'Alles klar, ich organisiere den Rückruf — der Verkäufer meldet sich wie vereinbart bei Ihnen!';
      case 'confirm_commitment':
        return du ? 'Danke für das Gespräch, melde dich jederzeit gern wieder. Schönen Tag noch!'
                  : 'Vielen Dank für das Gespräch, melden Sie sich jederzeit gern wieder. Schönen Tag noch!';
      default:
        return du ? 'Mach ich! Gibt es sonst noch etwas, das ich für dich tun kann?'
                  : 'Mache ich! Gibt es sonst noch etwas, das ich für Sie tun kann?';
    }
  }

  // ── EVENT LOGGEN (Basis für Resend in Schritt D) ─────────
  async function cvLogEvent(session, buyerPhone, type, payload, silent) {
    try {
      const { error: evtErr } = await supabase.from('cv_events').insert({
        session_id: session.dbSessionId || null,
        slot_id: session.slot.id,
        subscription_id: session.slot.subscription_id || null,
        type,
        buyer_phone: buyerPhone,
        payload: payload || {},
        notified: false
      });
      if (evtErr) {
        console.error(`[CV Event] Insert-Fehler (${type}):`, evtErr.message);
      } else {
        console.log(`[CV Event] ${type} für Slot ${session.slot.id}, Käufer +${buyerPhone}`);
      }

      // Verkäufer-Benachrichtigung — nur bei wichtigen End-Events,
      // damit pro Gespräch nicht mehrere Mails entstehen (kein Postfach-Spam).
      // Zwischenschritte (hot_lead, contact_added) werden weiter geloggt
      // (erscheinen im Trichter), lösen aber KEINE Mail aus.
      const mailEvents = ['paid', 'agreed', 'callback', 'escalated'];
      if (!silent && mailEvents.indexOf(type) !== -1) {
        await cvNotifySeller(session, buyerPhone, type, payload);
      }
    } catch(e) {
      console.error('[CV logEvent]', e.message);
    }
  }

  // ── SESSION PERSISTIEREN ─────────────────────────────────
  async function persistSession(session) {
    if (!session.dbSessionId) return;
    try {
      await supabase.from('cv_bot_sessions').update({
        messages: session.history,
        last_message_at: new Date().toISOString()
      }).eq('id', session.dbSessionId);
    } catch(e) { console.error('[CV persist]', e.message); }
  }

  // ── VERKÄUFER BENACHRICHTIGEN ────────────────────────────
  //    Aktuell WA-Fallback. Resend-Email kommt in Schritt D.
  // ============================================================
  // EMAIL-TEMPLATES für Verkäufer-Benachrichtigungen
  // ============================================================
  const CV_MAIL_STYLES = {
    hot_lead:      { icon: '🔥', label: 'Heißer Lead',         color: '#dc2626', urgent: true  },
    contact_added: { icon: '📇', label: 'Kontaktdaten erfasst', color: '#0891b2', urgent: false },
    agreed:        { icon: '🎉', label: 'Einigung erzielt',     color: '#16a34a', urgent: true  },
    escalated:     { icon: '⚠️', label: 'Eskalation an dich',   color: '#ea580c', urgent: true  },
    callback:      { icon: '📞', label: 'Rückruf gewünscht',    color: '#9333ea', urgent: true  },
    paid:          { icon: '💰', label: 'Zahlung eingegangen',  color: '#16a34a', urgent: true  },
    payment_link_sent: { icon: '🔗', label: 'Zahlungslink verschickt', color: '#64748b', urgent: false }
  };

  function cvEscapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function cvBuildEmail(type, articleTitle, buyerPhone, payload, aiSummary) {
    const style = CV_MAIL_STYLES[type] || { icon: '📋', label: 'Bot-Update', color: '#64748b', urgent: false };
    const p = payload || {};
    const subject = `${style.icon} ${style.label} — ${articleTitle}`;

    // Detail-Zeilen je nach verfügbaren Daten
    const rows = [];
    if (p.buyer_name)        rows.push(['Name',                p.buyer_name]);
    if (buyerPhone)          rows.push(['Käufer-WhatsApp',     '+' + buyerPhone]);
    if (p.buyer_phone && p.buyer_phone !== buyerPhone) rows.push(['Rückrufnummer', p.buyer_phone]);
    if (p.buyer_email)       rows.push(['E-Mail',              p.buyer_email]);
    if (p.agreed_price)      rows.push(['Vereinbarter Preis',  '€' + p.agreed_price]);
    if (p.buyer_wants_price) rows.push(['Käufer-Wunschpreis',  `€${p.buyer_wants_price} (Mindest: €${p.min_price || '?'})`]);
    if (p.deposit_amount)    rows.push(['Anzahlung',           '€' + p.deposit_amount]);
    if (p.paid_amount)       rows.push(['Eingegangener Betrag','€' + p.paid_amount]);
    if (p.preferred_time)    rows.push(['Wunsch-Zeit',         p.preferred_time]);
    if (p.reason)            rows.push(['Info',                p.reason]);

    // Hinweistext je nach Event
    let footer = '';
    if (type === 'paid') {
      footer = `<p style="margin:24px 0 0;padding:16px;background:#f0fdf4;border-radius:8px;color:#166534;font-size:14px;line-height:1.5;">
        <strong>Nächste Schritte:</strong><br>
        ⏳ 14 Tage Widerrufsfrist abwarten<br>
        📦 Artikel und Rechnung an den Käufer senden<br>
        💸 Auszahlung an dich erfolgt manuell nach Ablauf der Frist
      </p>`;
    } else if (type === 'escalated' || type === 'callback') {
      footer = `<p style="margin:24px 0 0;padding:16px;background:#fff7ed;border-radius:8px;color:#9a3412;font-size:14px;line-height:1.5;">
        <strong>Handlung erforderlich:</strong> Der Bot hat das Gespräch übergeben. Bitte zeitnah persönlich beim Käufer melden.
      </p>`;
    } else if (type === 'hot_lead' || type === 'agreed') {
      footer = `<p style="margin:24px 0 0;padding:16px;background:#eff6ff;border-radius:8px;color:#1e40af;font-size:14px;line-height:1.5;">
        Der Bot kümmert sich weiter — diese Nachricht ist zur Information.
      </p>`;
    }

    const rowsHtml = rows.map(([k, v]) => `
      <tr>
        <td style="padding:8px 12px;background:#f8fafc;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0;width:35%;">${cvEscapeHtml(k)}</td>
        <td style="padding:8px 12px;color:#0f172a;font-size:14px;font-weight:500;border-bottom:1px solid #e2e8f0;">${cvEscapeHtml(v)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <tr><td style="background:${style.color};padding:24px 28px;color:#fff;">
          <div style="font-size:13px;opacity:.85;letter-spacing:.5px;text-transform:uppercase;">Converdino · Bot-Update</div>
          <div style="font-size:22px;font-weight:700;margin-top:6px;">${style.icon} ${cvEscapeHtml(style.label)}</div>
        </td></tr>
        <tr><td style="padding:28px;">
          <div style="font-size:15px;color:#475569;margin-bottom:4px;">Artikel</div>
          <div style="font-size:18px;font-weight:600;color:#0f172a;margin-bottom:20px;">${cvEscapeHtml(articleTitle)}</div>
          ${aiSummary ? `<div style="margin:0 0 20px;padding:14px 16px;background:#f1f5f9;border-left:3px solid ${style.color};border-radius:6px;font-size:14px;line-height:1.55;color:#334155;"><strong style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#64748b;margin-bottom:6px;">📝 Gesprächs-Zusammenfassung</strong>${cvEscapeHtml(aiSummary)}</div>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
            ${rowsHtml}
          </table>
          ${footer}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:center;">
          Automatische Benachrichtigung von Converdino · <a href="https://converdino.com" style="color:#94a3b8;">converdino.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    // Plain-Text-Fallback
    const text = `${style.icon} ${style.label}\n\n` +
      `Artikel: ${articleTitle}\n` +
      (aiSummary ? `\nZusammenfassung: ${aiSummary}\n\n` : '') +
      rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
      (type === 'paid' ? '\n\nNächste Schritte: 14 Tage Widerrufsfrist abwarten, Artikel + Rechnung senden, Auszahlung folgt manuell.' : '') +
      '\n\n— Converdino';

    return { subject, html, text };
  }

  async function cvSendEmail(toEmail, subject, html, text) {
    if (!cvResend) {
      console.warn('[CV Mail] Resend nicht initialisiert — Mail nicht gesendet');
      return false;
    }
    if (!toEmail || !/.+@.+\..+/.test(toEmail)) {
      console.warn('[CV Mail] Ungültige Empfänger-Email:', toEmail);
      return false;
    }
    try {
      const result = await cvResend.emails.send({
        from: CV_MAIL_FROM,
        to: toEmail,
        replyTo: CV_MAIL_REPLY_TO,
        subject,
        html,
        text
      });
      if (result?.error) {
        console.error('[CV Mail] Resend-Fehler:', result.error.message || result.error);
        return false;
      }
      console.log(`[CV Mail] ✉️  versendet → ${toEmail} (${subject.substring(0, 60)})`);
      return true;
    } catch(e) {
      console.error('[CV Mail] Exception:', e.message);
      return false;
    }
  }

  // ============================================================
  // KI-GESPRÄCHSZUSAMMENFASSUNG (Haiku) — für die Verkäufer-Mail
  // Defensiv: bei Fehler/leerem Verlauf wird null zurückgegeben,
  // die Mail wird dann ohne Zusammenfassung gesendet.
  // ============================================================
  async function cvSummarizeConversation(session) {
    try {
      const history = (session && session.history) || [];
      if (history.length < 2) return null; // zu kurz für sinnvolle Zusammenfassung

      // Verlauf in lesbaren Text umwandeln (Käufer / Bot)
      const transcript = history.map(function(m) {
        let txt = '';
        if (typeof m.content === 'string') txt = m.content;
        else if (Array.isArray(m.content)) txt = m.content.map(c => (c && c.text) ? c.text : '').join(' ');
        const wer = (m.role === 'user') ? 'Käufer' : 'Bot';
        return wer + ': ' + txt;
      }).filter(z => z.trim().length > 0).join('\n');

      if (!transcript || transcript.length < 20) return null;

      const er = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 250,
          system: 'Du fasst WhatsApp-Verkaufsgespräche für den Verkäufer zusammen. Schreibe 2-3 kurze, sachliche Sätze auf Deutsch: Was wollte der Käufer, welcher Preis/Stand wurde erreicht, was ist der nächste Schritt. Keine Anrede, keine Floskeln, keine Aufzählung — nur Fließtext.',
          messages: [{ role: 'user', content: 'Fasse dieses Verkaufsgespräch kurz zusammen:\n\n' + transcript }]
        })
      });
      if (!er.ok) { console.warn('[CV Summary] Haiku-Fehler', er.status); return null; }
      const data = await er.json();
      const text = (data && data.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      return text || null;
    } catch(e) {
      console.warn('[CV Summary] Ausnahme:', e.message);
      return null;
    }
  }

  // ============================================================
  // VERKÄUFER-BENACHRICHTIGUNG (jetzt per Email statt WhatsApp)
  // ============================================================
  async function cvNotifySeller(session, buyerPhone, type, payload) {
    try {
      // 'lost' wird nicht gemeldet (kein Mehrwert)
      if (type === 'lost') {
        console.log(`[CV Notify] 'lost' Event übersprungen (Slot ${session.slot.id})`);
        return;
      }

      // Verkäufer-Email aus der Subscription holen
      const { data: sub } = await supabase
        .from('cv_subscriptions')
        .select('seller_email, email_notifications_enabled, user_login')
        .eq('id', session.slot.subscription_id).maybeSingle();

      if (!sub) {
        console.warn(`[CV Notify] Subscription ${session.slot.subscription_id} nicht gefunden`);
        return;
      }
      if (sub.email_notifications_enabled === false) {
        console.log(`[CV Notify] Email-Benachrichtigungen deaktiviert für ${sub.user_login}`);
        return;
      }
      if (!sub.seller_email) {
        console.warn(`[CV Notify] Keine seller_email für ${sub.user_login} hinterlegt — Event ${type} nicht gesendet`);
        return;
      }

      // KI-Zusammenfassung nur bei relevanten End-Events (spart Kosten)
      let aiSummary = null;
      const summarizeTypes = ['agreed', 'paid', 'callback', 'escalated', 'contact_added', 'hot_lead'];
      if (summarizeTypes.indexOf(type) !== -1) {
        aiSummary = await cvSummarizeConversation(session);
      }

      const { subject, html, text } = cvBuildEmail(
        type, session.article.title, buyerPhone, payload, aiSummary
      );
      await cvSendEmail(sub.seller_email, subject, html, text);
    } catch(e) {
      console.error('[CV notify]', e.message);
    }
  }


  // ============================================================
  // STRIPE: Anzahlungs-Zahlungslink erstellen
  // ============================================================
  async function cvCreateDepositLink(session) {
    if (!cvStripe) {
      console.error('[CV Stripe] Nicht initialisiert');
      return null;
    }
    try {
      const article = session.article;
      const slot = session.slot;
      const agreed = Number(session.agreedPrice) || Number(article.sale_price);
      const depositPct = Number(slot.deposit_percent) || 10;
      const deposit = Math.round(agreed * depositPct) / 100; // z.B. 10% von 23990 = 2399
      const depositCents = Math.round(deposit * 100);

      if (depositCents < 50) {
        console.error('[CV Stripe] Anzahlung zu klein:', deposit);
        return null;
      }

      // Produkt + Preis dynamisch anlegen, Payment Link erstellen
      const paymentLink = await cvStripe.paymentLinks.create({
        line_items: [{
          price_data: {
            currency: 'eur',
            unit_amount: depositCents,
            product_data: {
              name: `Reservierung: ${article.title}`,
              description: `Anzahlung ${depositPct}% — Restbetrag €${(agreed - deposit).toFixed(2)} bei Übergabe`
            }
          },
          quantity: 1
        }],
        metadata: {
          cv_slot_id: String(slot.id),
          cv_session_id: String(session.dbSessionId || ''),
          buyer_phone: String(session.phone || ''),
          buyer_name: String(session.buyerName || ''),
          agreed_price: String(agreed),
          deposit_amount: String(deposit),
          bot_code: String(slot.bot_code || '')
        },
        after_completion: {
          type: 'redirect',
          redirect: { url: `${CV_BASE_URL}/danke.html` }
        }
      });

      // In Session + DB speichern
      session.depositAmount = deposit;
      session.stripePaymentLink = paymentLink.url;
      if (session.dbSessionId) {
        await supabase.from('cv_bot_sessions').update({
          deposit_amount: deposit,
          agreed_price: agreed,
          stripe_payment_link: paymentLink.url,
          stripe_payment_link_id: paymentLink.id,
          last_message_at: new Date().toISOString()
        }).eq('id', session.dbSessionId);
      }

      console.log(`[CV Stripe] Link erstellt: €${deposit} Anzahlung für Slot ${slot.id}`);
      return { url: paymentLink.url, deposit, agreed, restbetrag: agreed - deposit, depositPct };
    } catch(e) {
      console.error('[CV Stripe] Link-Erstellung fehlgeschlagen:', e.message);
      return null;
    }
  }

  // ============================================================
  // STRIPE WEBHOOK: Zahlungseingang verarbeiten
  // Route: POST /api/cv/stripe/webhook
  // WICHTIG: braucht den rohen Body für die Signaturprüfung.
  // In server.js muss VOR express.json() für diese Route
  // express.raw({type:'application/json'}) gesetzt sein — siehe Anleitung.
  // ============================================================
  app.post('/api/cv/stripe/webhook', async (req, res) => {
    if (!cvStripe) return res.status(503).send('Stripe nicht konfiguriert');

    let event;
    const webhookSecret = cvWebhookSecret;
    try {
      if (webhookSecret && req.headers['stripe-signature']) {
        // Signaturprüfung mit rohem Body (req.body ist Buffer wenn express.raw aktiv)
        event = cvStripe.webhooks.constructEvent(
          req.body, req.headers['stripe-signature'], webhookSecret
        );
      } else {
        // Fallback ohne Secret (nur für Test) — Body ggf. schon geparst
        event = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
          ? req.body
          : JSON.parse(req.body.toString());
        console.warn('[CV Stripe] Webhook OHNE Signaturprüfung verarbeitet (Test-Modus)');
      }
    } catch(e) {
      console.error('[CV Stripe] Webhook-Signatur ungültig:', e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    // Nur abgeschlossene Checkouts interessieren uns
    if (event.type === 'checkout.session.completed') {
      const cs = event.data.object;
      const meta = cs.metadata || {};
      try {
        const paidAmount = (cs.amount_total || 0) / 100;
        // Leere Strings zu null (UUID-Spalten akzeptieren kein '')
        const sessionId = meta.cv_session_id && meta.cv_session_id.trim() ? meta.cv_session_id.trim() : null;
        const slotId = meta.cv_slot_id && meta.cv_slot_id.trim() ? meta.cv_slot_id.trim() : null;

        // Bot-Session als bezahlt markieren
        if (sessionId) {
          const { error: updErr } = await supabase.from('cv_bot_sessions').update({
            paid_at: new Date().toISOString(),
            paid_amount: paidAmount,
            stripe_session_id: cs.id,
            status: 'deal'
          }).eq('id', sessionId);
          if (updErr) console.error('[CV Stripe] Session-Update Fehler:', updErr.message);
        }

        // subscription_id über den Slot ermitteln (für cv_events)
        let subId = null;
        if (slotId) {
          const { data: slotRow } = await supabase
            .from('cv_slots').select('subscription_id').eq('id', slotId).maybeSingle();
          subId = slotRow?.subscription_id || null;
        }

        // Event protokollieren
        const { error: evtErr } = await supabase.from('cv_events').insert({
          session_id: sessionId,
          slot_id: slotId,
          subscription_id: subId,
          type: 'paid',
          buyer_phone: meta.buyer_phone || null,
          payload: {
            buyer_name: meta.buyer_name,
            agreed_price: meta.agreed_price,
            deposit_amount: meta.deposit_amount,
            paid_amount: paidAmount,
            article: meta.bot_code
          },
          notified: false
        });
        if (evtErr) console.error('[CV Stripe] cv_events Insert Fehler:', evtErr.message);
        else console.log('[CV Stripe] cv_events paid-Event gespeichert');

        console.log(`[CV Stripe] ✅ Zahlung eingegangen: €${paidAmount} für Slot ${slotId}`);

        // Verkäufer informieren (WA-Fallback; Resend folgt Schritt D)
        await cvNotifyPayment(slotId, meta, paidAmount);

        // Käufer-Bestätigung per WhatsApp
        if (meta.buyer_phone) {
          const phoneId = process.env.META_PHONE_NUMBER_ID || null;
          const confirmMsg = `✅ Zahlung erhalten — vielen Dank${meta.buyer_name ? ', ' + meta.buyer_name : ''}!\n\nIhre Reservierung für „${meta.article || 'den Artikel'}" ist bestätigt. Der Verkäufer wird sich für die Übergabe und den Restbetrag mit Ihnen in Verbindung setzen.`;
          await sendWAMessage(phoneId, meta.buyer_phone, confirmMsg).catch(() => {});
        }
      } catch(e) {
        console.error('[CV Stripe] Webhook-Verarbeitung Fehler:', e.message);
      }
    }

    res.json({ received: true });
  });

  // Verkäufer über Zahlungseingang informieren (per Email)
  async function cvNotifyPayment(slotId, meta, paidAmount) {
    try {
      const { data: slot } = await supabase
        .from('cv_slots').select('subscription_id, bot_code').eq('id', slotId).maybeSingle();
      if (!slot) return;
      const { data: sub } = await supabase
        .from('cv_subscriptions')
        .select('seller_email, email_notifications_enabled, user_login')
        .eq('id', slot.subscription_id).maybeSingle();

      if (!sub || sub.email_notifications_enabled === false) {
        console.log(`[CV Stripe] Email-Benachrichtigung übersprungen (deaktiviert oder Sub fehlt)`);
        return;
      }
      if (!sub.seller_email) {
        console.warn(`[CV Stripe] Keine seller_email für ${sub.user_login} — Zahlung nicht per Mail gemeldet`);
        return;
      }

      const articleTitle = meta.article || slot.bot_code || '(Artikel)';
      const payload = {
        buyer_name: meta.buyer_name,
        buyer_phone: meta.buyer_phone,
        agreed_price: meta.agreed_price,
        deposit_amount: meta.deposit_amount,
        paid_amount: paidAmount
      };
      const { subject, html, text } = cvBuildEmail('paid', articleTitle, meta.buyer_phone, payload);
      await cvSendEmail(sub.seller_email, subject, html, text);
    } catch(e) { console.error('[CV notifyPayment]', e.message); }
  }


  // ============================================================
  // BACKOFFICE / ADMIN — Kundenverwaltung (Schritt 1b)
  // Kunde = users-Login + cv_subscriptions (verknüpft über user_login).
  // Slots werden in einem getrennten Schritt zugewiesen.
  // ============================================================

  // bcrypt defensiv laden (Fallback Klartext, falls Paket fehlt)
  let cvBcrypt = null;
  try { cvBcrypt = require('bcryptjs'); }
  catch(e) { console.warn('[CV Admin] bcryptjs nicht verfügbar — Passwörter werden im Klartext gespeichert'); }
  async function cvHashPassword(plain) {
    if (cvBcrypt) { try { return await cvBcrypt.hash(plain, 10); } catch(e) {} }
    return plain;
  }

  // ============================================================
  // PREISSTAFFELN (Baustein F) — cv_price_tiers verwalten
  // ============================================================

  // Progressive Preisberechnung (Stufenmodell):
  // Jeder Slot bekommt den Preis der höchsten Stufe, deren Schwelle er erreicht.
  // Kundenpreis = Summe aller Einzelslots.
  function cvBerechneProgressiv(anzahlSlots, tiers) {
    const stufen = (tiers || []).slice().sort((a, b) => a.bots - b.bots);
    if (stufen.length === 0) return { total: 0, detail: [] };
    let summe = 0;
    const detail = [];
    for (let slot = 1; slot <= anzahlSlots; slot++) {
      let preis = stufen[0].price_per_bot;
      for (const st of stufen) {
        if (st.bots <= slot) preis = Number(st.price_per_bot);
      }
      summe += Number(preis);
      detail.push({ slot, preis: Number(preis) });
    }
    return { total: Math.round(summe * 100) / 100, detail };
  }

  // GET — progressiven Preis für eine Slot-Anzahl berechnen
  app.get('/api/cv/admin/price-calc', async (req, res) => {
    try {
      const slots = parseInt(req.query.slots, 10);
      if (!slots || slots < 1) return res.status(400).json({ error: 'Slot-Anzahl fehlt/ungültig.' });
      const { data: tiers, error } = await supabase
        .from('cv_price_tiers').select('bots, price_per_bot')
        .eq('active', true).order('bots', { ascending: true });
      if (error) return res.status(500).json({ error: 'Stufen laden: ' + error.message });
      const result = cvBerechneProgressiv(slots, tiers || []);
      res.json({ slots, total: result.total, detail: result.detail });
    } catch(e) {
      console.error('[CV price-calc]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // GET — alle Preisstufen (für Backoffice + später Buchung)
  app.get('/api/cv/admin/price-tiers', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('cv_price_tiers')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) return res.status(500).json({ error: 'Laden: ' + error.message });
      res.json({ tiers: data || [] });
    } catch(e) {
      console.error('[CV price-tiers GET]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // POST — neue Preisstufe anlegen
  app.post('/api/cv/admin/price-tiers', async (req, res) => {
    try {
      const b = req.body || {};
      const bots = parseInt(b.bots, 10);
      const pricePerBot = parseFloat(b.price_per_bot);
      if (!bots || bots < 1) return res.status(400).json({ error: 'Bots-Anzahl fehlt/ungültig.' });
      if (isNaN(pricePerBot) || pricePerBot < 0) return res.status(400).json({ error: 'Preis pro Bot fehlt/ungültig.' });
      const discount = parseInt(b.discount_pct, 10) || 0;
      const monthly = Math.round(bots * pricePerBot * 100) / 100;
      const { data, error } = await supabase
        .from('cv_price_tiers')
        .insert({
          bots, price_per_bot: pricePerBot, discount_pct: discount,
          monthly_total: monthly, sort_order: (b.sort_order != null ? parseInt(b.sort_order,10) : bots),
          active: true
        })
        .select().single();
      if (error) {
        console.error('[CV price-tiers POST] Insert-Fehler:', error.message);
        return res.status(500).json({ error: 'Anlegen: ' + error.message });
      }
      res.json({ success: true, tier: data });
    } catch(e) {
      console.error('[CV price-tiers POST]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // PUT — Preisstufe ändern
  app.put('/api/cv/admin/price-tiers/:id', async (req, res) => {
    try {
      const b = req.body || {};
      const upd = { updated_at: new Date().toISOString() };
      if (b.bots != null) upd.bots = parseInt(b.bots, 10);
      if (b.price_per_bot != null) upd.price_per_bot = parseFloat(b.price_per_bot);
      if (b.discount_pct != null) upd.discount_pct = parseInt(b.discount_pct, 10) || 0;
      if (b.active != null) upd.active = !!b.active;
      // Monatspreis neu berechnen, wenn bots oder Preis geändert
      const botsVal = (upd.bots != null) ? upd.bots : null;
      const priceVal = (upd.price_per_bot != null) ? upd.price_per_bot : null;
      if (botsVal != null || priceVal != null) {
        const { data: cur } = await supabase.from('cv_price_tiers').select('bots, price_per_bot').eq('id', req.params.id).maybeSingle();
        const finalBots = botsVal != null ? botsVal : (cur ? cur.bots : 0);
        const finalPrice = priceVal != null ? priceVal : (cur ? cur.price_per_bot : 0);
        upd.monthly_total = Math.round(finalBots * finalPrice * 100) / 100;
      }
      const { data, error } = await supabase
        .from('cv_price_tiers').update(upd).eq('id', req.params.id).select().single();
      if (error) return res.status(500).json({ error: 'Ändern: ' + error.message });
      res.json({ success: true, tier: data });
    } catch(e) {
      console.error('[CV price-tiers PUT]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // DELETE — Preisstufe löschen
  app.delete('/api/cv/admin/price-tiers/:id', async (req, res) => {
    try {
      const { error } = await supabase.from('cv_price_tiers').delete().eq('id', req.params.id);
      if (error) return res.status(500).json({ error: 'Löschen: ' + error.message });
      res.json({ success: true });
    } catch(e) {
      console.error('[CV price-tiers DELETE]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // ============================================================
  // WEB-CHAT (Weg A) — paralleler Kanal, WhatsApp bleibt unberührt
  // Eigene Engine cvRunWebTurn: nutzt dieselbe Wissens-/Verhandlungs-
  // basis, gibt die Antwort aber ZURÜCK (kein sendWAMessage) und
  // arbeitet mit session_token statt buyer_phone.
  // ============================================================

  // CORS NUR für die Web-Chat-Endpoints: Das Widget läuft auf fremden
  // Händler-Webseiten und muss converdino.com aufrufen dürfen.
  // Betrifft ausschließlich /api/cv/web/* — alle anderen Routen bleiben unberührt.
  app.use('/api/cv/web', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Web-tauglichen System-Prompt bauen (Kontakt wird per Formular gesichert)
  function cvBuildWebPrompt(article, shareableDocs) {
    const analysis = article.analysis || {};
    const docs = Array.isArray(shareableDocs) ? shareableDocs : [];
    const anrede = article.anrede || 'Sie';
    const botName = (article.bot_name && article.bot_name.trim()) ? article.bot_name.trim() : '';
    const ansprechperson = (article.berater_name && article.berater_name.trim()) ? article.berater_name.trim() : '';
    const strategieText = (article.strategie && article.strategie.trim()) ? article.strategie.trim() : '';
    const salePrice = Number(article.sale_price) || 0;
    const minPrice  = Number(article.min_price) || 0;
    const pdfFacts = Array.isArray(article.pdf_facts) ? article.pdf_facts : [];
    const factsBlock = pdfFacts.length > 0
      ? pdfFacts.map(f => `• ${f.k}: ${f.v}`).join('\n')
      : '(keine extrahierten Dokument-Fakten)';
    const strat = analysis.bot_strategy || {};
    const argumente = Array.isArray(strat.selling_points) ? strat.selling_points.join('; ') : '';
    const einwaende = Array.isArray(strat.objection_handling)
      ? strat.objection_handling.map(o => `${o.objection} → ${o.response}`).join(' | ') : '';

    return `Du bist ein professioneller Verkaufsberater in einem CHAT-FENSTER auf der Webseite eines Händlers. Dein Ziel: aktiv und sachlich verkaufen UND qualifizierte Leads sichern.

═══════════════════════════════════════════════════════
TON & STIL — sachlich und selbstbewusst, NICHT schwülstig
═══════════════════════════════════════════════════════
Schreibe wie ein kompetenter, ruhiger Fachverkäufer, der sein Produkt kennt — nicht wie eine Werbebroschüre.
- KEINE Werbe-Superlative ("luxuriös", "traumhaft", "einzigartig", "ausgezeichnete Wahl", "Wunderbar!", "Fantastisch!").
- Nenne Fakten statt Schwärmerei. Kurz und konkret: lieber 2-3 klare Sätze als ein langer Schwall.
- Emojis sehr sparsam: höchstens eines pro Nachricht, oft gar keines.

- Sei freundlich, aber erwachsen und seriös — gerade bei hochpreisigen Gütern wirkt Zurückhaltung vertrauenswürdiger.

WER DU BIST — Vorstellung & Echtheit:
${botName
  ? `WICHTIG: Stelle dich mit "${botName}" NUR in deiner allerersten Nachricht vor (z.B. "Hallo, hier ist ${botName}."). Wenn im Gesprächsverlauf bereits Nachrichten ausgetauscht wurden, stelle dich NICHT erneut vor und begrüße nicht noch einmal — antworte direkt auf das Anliegen.`
  : `Du brauchst keinen Eigennamen — stelle dich freundlich als digitaler Verkaufsberater des Teams vor, aber NUR in deiner allerersten Nachricht. Im laufenden Gespräch nicht erneut vorstellen oder begrüßen.`}
Du gibst dich NIE als Mensch aus. Auf die Frage, ob du echt/ein Mensch/eine KI bist, antworte ehrlich: "Ich bin ein digitalisierter Verkaufsberater, der in enger Zusammenarbeit mit dem Kundenbetreuungsteam entstanden ist. Mein Ziel ist es, Ihre Fragen und Wünsche so vorzubereiten, dass das Verkaufsteam Sie schnell, kompetent und effektiv beraten kann." (in der passenden Anrede)
${ansprechperson ? `ANSPRECHPARTNER: Wenn du einen Lead übergibst oder einen Rückruf ankündigst, nenne als Ansprechpartner "${ansprechperson}" (z.B. "${ansprechperson} meldet sich bei Ihnen") statt unpersönlich "der Verkäufer".\n` : ''}

PRODUKT: ${article.title}
VERKAUFSPREIS: €${salePrice}
MINDESTPREIS: €${minPrice} (NIEMALS ein Angebot darunter machen!)
STANDORT: ${article.location || 'auf Anfrage'}
ANREDE: ${anrede} (konsequent verwenden)

═══════════════════════════════════════════════════════
KONTAKT IM WEB-CHAT — WICHTIG (anders als WhatsApp!)
═══════════════════════════════════════════════════════
Du chattest mit einem ANONYMEN Webseiten-Besucher. Du hast KEINE Telefonnummer und KEINE E-Mail.
- Berate und verhandle zunächst ganz normal.
- Sobald ernsthaftes Kaufinteresse besteht (Preis-Einigung in Sicht, konkrete Kaufabsicht, oder der Besucher möchte einen Rückruf/ein Angebot), bitte den Besucher freundlich, seine Kontaktdaten über das Formular zu hinterlassen, damit sich der zuständige Verkäufer persönlich meldet.
- Formuliere etwa so: "Damit sich unser Verkäufer direkt bei Ihnen meldet, hinterlassen Sie bitte kurz Ihre Kontaktdaten — Sie sehen gleich ein kurzes Formular." (bzw. mit "du" wenn Anrede=Du)
- WICHTIG: Genau dann, wenn das Kontaktformular erscheinen soll, setze GANZ ANS ENDE deiner Nachricht den unsichtbaren Marker [[KONTAKT]] (in doppelten eckigen Klammern). Der Besucher sieht ihn nicht — er löst nur das Formular aus. Setze ihn NUR, wenn wirklich Kontaktdaten gesammelt werden sollen, und höchstens einmal pro Gespräch.
- Erfinde NIEMALS Kontaktdaten und tu nicht so, als hättest du welche.
- GRUNDREGEL bei Aktionen: Wenn du Unterlagen teilst oder eine Aktion auslöst, schreibe IMMER auch einen kurzen begleitenden Satz dazu — beende das Gespräch nie abrupt. Sag freundlich, was als Nächstes passiert, und halte das Gespräch offen ("…schauen Sie es sich in Ruhe an, bei Fragen bin ich da").

═══════════════════════════════════════════════════════
VERIFIZIERTE FAKTEN ZU DIESEM PRODUKT (aus den Dokumenten)
═══════════════════════════════════════════════════════
${factsBlock}

${argumente ? 'VERKAUFSARGUMENTE: ' + argumente : ''}
${einwaende ? 'EINWAND-ANTWORTEN: ' + einwaende : ''}

REGELN:
- Beantworte Produktfragen NUR aus den verifizierten Fakten. Was du nicht sicher weißt: ehrlich sagen, dass du das mit dem Verkäufer klärst — niemals erfinden.
- Branchen-Allgemeinwissen darfst du nutzen, aber trenne es klar von produktspezifischen Fakten ("allgemein üblich ist … — wie es bei DIESEM Gerät konkret ist, kläre ich mit dem Verkäufer").
- Verhandle innerhalb der Spanne (Verkaufspreis bis Mindestpreis), max. 2-3 kleiner werdende Zugeständnisse, NIE unter den Mindestpreis.
- Die Kaufabwicklung läuft sicher und treuhänderisch über die Plattform. Kein Privatverkauf, keine private Bargeldübergabe.${strategieText ? `

═══ GESPRÄCHSSTRATEGIE (vom Betreiber vorgegeben — wichtig!) ═══
Folge dieser Strategie. Es ist eine Reihenfolge von Angeboten: biete zuerst das Erste an; bei Ablehnung/Zögern gehe natürlich zum Nächsten über. Dränge nie, biete an. Links/Angebote genau wie angegeben weitergeben:
${strategieText}` : ''}${docs.length > 0 ? `

═══ TEILBARE DOKUMENTE ═══
Diese Unterlagen darfst du dem Interessenten auf Wunsch (oder wenn es passt) als Download-Link geben. Nutze dafür das Werkzeug share_document mit dem exakten Dateinamen. Sage kurz, was drin ist, dann wird der Link automatisch angehängt. Gib NUR diese Dokumente heraus:
${docs.map(d => '• ' + d.file_name).join('\n')}` : ''}`;
  }

  // BERATUNGS-MODUS: Prompt für erklärungsbedürftige Dienstleistungen (z.B. Supplier Risk Management).
  // Kein Verkauf, keine Preise, keine Verhandlung. Ziel: Problembewusstsein schaffen,
  // locker qualifizieren (Rahmenbedingungen), und zur Videokonferenz mit dem Berater führen.
  function cvBuildBeratungPrompt(article, kanal, shareableDocs, sharedLinks) {
    const istWhatsApp = (kanal === 'whatsapp');
    const docs = Array.isArray(shareableDocs) ? shareableDocs : [];
    const geteilt = Array.isArray(sharedLinks) ? sharedLinks : [];
    const geteiltHinweis = geteilt.length > 0
      ? '\n\nBereits geteilte Dokument-Links (diese am Ende mit aufführen, falls du zusammenfasst):\n' + geteilt.map(l => '• ' + l.name + ': ' + l.url).join('\n')
      : '';
    const anrede = article.anrede || 'Sie';
    const botName = (article.bot_name && article.bot_name.trim()) ? article.bot_name.trim() : '';
    const pdfFacts = Array.isArray(article.pdf_facts) ? article.pdf_facts : [];
    const factsBlock = pdfFacts.length > 0
      ? pdfFacts.map(f => `• ${f.k}: ${f.v}`).join('\n')
      : '(keine extrahierten Dokument-Fakten)';
    const berater = (article.berater_name && article.berater_name.trim()) ? article.berater_name.trim() : 'unser Berater';
    const strategieText = (article.strategie && article.strategie.trim()) ? article.strategie.trim() : '';

    return `Du bist ein kompetenter, seriöser Berater in einem CHAT-FENSTER auf einer Unternehmens-Webseite. Das Thema ist erklärungsbedürftig und ernst (z.B. Lieferanten-Risiken, Compliance, persönliche Haftung der Geschäftsführung). Dein Ziel: dem Gegenüber das Problembewusstsein schärfen, Vertrauen durch Fachkompetenz aufbauen und einen qualifizierten Lead an unseren Berater übergeben — NICHT verkaufen, NICHT verhandeln, KEINE Preise nennen.${istWhatsApp ? '' : `

WICHTIG ZUR FORMATIERUNG: Schreibe NORMALEN Fließtext ohne Markdown — KEINE Sternchen für Hervorhebungen (kein *kursiv* oder **fett**), keine #-Überschriften. Im Web-Chat werden solche Zeichen als störende Sonderzeichen angezeigt. Wenn du mehrere Punkte aufzählst (z.B. Aspekte, Schritte, Optionen), nutze KURZE Stichpunkte mit einem Bindestrich am Zeilenanfang ("- Punkt") statt eines langen Absatzes — leichter zu erfassen. Jeder Stichpunkt knapp. Fließtext nur für ein, zwei zusammenhängende Gedanken.`}

═══════════════════════════════════════════════════════
HALTUNG & TON — ruhige Kompetenz, KEINE Angstmache
═══════════════════════════════════════════════════════
- Schreibe wie ein erfahrener, besonnener Fachberater: ernst, sachlich, vertrauenswürdig.
- Schaffe Problembewusstsein, ohne Angst zu schüren. Sachlich benennen, was real auf dem Spiel steht — nicht dramatisieren, nicht übertreiben.
- KEINE Werbe-Superlative, kein Verkaufsdruck. Gerade bei diesem Thema wirkt Zurückhaltung und Seriosität am stärksten.
- Kurz und klar: 2-4 Sätze pro Nachricht. Höchstens ein Emoji, meist keines.
- ANREDE: ${anrede} (konsequent verwenden).

═══════════════════════════════════════════════════════
WER DU BIST — Vorstellung & Echtheit
═══════════════════════════════════════════════════════
${botName
  ? `WICHTIG: Stelle dich mit "${botName}" NUR in deiner allerersten Nachricht vor (z.B. "Hallo, hier ist ${botName}."). Wenn im Gesprächsverlauf bereits Nachrichten ausgetauscht wurden, stelle dich NICHT erneut vor und begrüße nicht noch einmal — antworte direkt auf das Anliegen.`
  : `Du brauchst keinen Eigennamen — stelle dich freundlich als digitaler Berater des Teams vor, aber NUR in deiner allerersten Nachricht. Im laufenden Gespräch nicht erneut vorstellen oder begrüßen.`}
WICHTIG — Echtheit: Du gibst dich NIE als Mensch aus. Wenn jemand fragt, ob du echt/ein Mensch/eine KI bist, antworte sinngemäß und ehrlich:
"Ich bin ein digitalisierter Verkaufsberater, der in enger Zusammenarbeit mit Ihrem Kundenbetreuungsteam entstanden ist. Mein Ziel ist es, alle Ihre Fragen und Wünsche so vorzubereiten, dass unser Team Sie schnell, kompetent und effektiv beraten kann." (in der passenden Anrede)

Du sensibilisierst und informierst allgemein — du gibst NIEMALS konkrete rechtliche Einschätzungen zum Einzelfall ("in Ihrem Fall haften Sie für X"). Die rechtliche Bewertung macht ausschließlich unser Berater im persönlichen Gespräch. Wenn jemand eine konkrete rechtliche Einschätzung will, sage freundlich: das bespricht ${berater} verbindlich im persönlichen Termin.
- Wenn jemand unterhalb einer gesetzlichen Schwelle liegt: sage das NEUTRAL ("Sie liegen unterhalb der direkten Schwelle"), NICHT mit Worten wie "aktuell" oder "noch", die suggerieren, es ändere sich demnächst. Betone stattdessen die INDIREKTE Betroffenheit (z.B. über die Lieferkette der Kunden), die real und gegenwärtig ist.

═══════════════════════════════════════════════════════
WAS DU TUST (in dieser Reihenfolge, aber natürlich im Gespräch — kein Verhör)
═══════════════════════════════════════════════════════
1. Begrüße und sprich das Thema kompetent an. Mache deutlich, worum es geht und warum es relevant ist.
2. Qualifiziere LOCKER im Gespräch (keine starre Fragenliste): Worum geht es konkret? Wie viele Lieferanten / welche Branche? Was ist der Anlass (Audit, Neukunde, laufende Überwachung, akute Sorge)? Wer fragt (Rolle/Verantwortung)?
3. Positioniere die Lösung sachlich: unsere Berichte plus die eigene Software, in der alles übersichtlich ausgeliefert wird — "Sie haben das Thema im Griff und können beruhigt sein; wenn sich etwas an der Risikolage ändert, werden Sie automatisch benachrichtigt."
4. Führe zum nächsten Schritt: eine Videokonferenz mit unserem Berater ${berater}, der den konkreten Bedarf bespricht. Biete das als natürlichen, hilfreichen nächsten Schritt an — nicht drängend.

═══════════════════════════════════════════════════════
KEINE PREISE
═══════════════════════════════════════════════════════
Nenne KEINE Preise und keine Preisstruktur. Wenn jemand nach dem Preis fragt: freundlich erklären, dass der passende Umfang und die Konditionen individuell von ${berater} im Gespräch abgestimmt werden, weil es stark von der Situation abhängt.

═══════════════════════════════════════════════════════
LEAD ÜBERGEBEN
═══════════════════════════════════════════════════════
Sobald ernsthaftes Interesse besteht (will mehr wissen, will einen Termin, schildert eine konkrete Situation), bitte freundlich um die Kontaktdaten, damit ${berater} sich persönlich meldet und einen Termin für die Videokonferenz abstimmt.
${istWhatsApp
? `- Du bist in WhatsApp. Es gibt KEIN Formular. Bitte den Interessenten einfach, dir Name und am besten eine E-Mail oder Telefonnummer direkt hier als Nachricht zu schreiben.
- Formuliere etwa: "Am besten bespricht das ${berater} direkt mit Ihnen in einer kurzen Videokonferenz. Schreiben Sie mir dafür einfach kurz Ihren Namen und wie ${berater} Sie am besten erreicht (E-Mail oder Telefon)." (bzw. "du", wenn Anrede=Du)
- Verwende NIEMALS den Marker [[KONTAKT]] und sprich NICHT von einem "Formular" — das gibt es in WhatsApp nicht.
- Sobald der Interessent dir Name/Kontakt genannt hat, sichere den Lead mit dem Werkzeug collect_contact (damit ${berater} informiert wird).`
: `- Formuliere etwa: "Am besten bespricht das ${berater} direkt mit Ihnen in einer kurzen Videokonferenz. Hinterlassen Sie mir dafür bitte kurz Ihre Kontaktdaten — Sie sehen gleich ein kurzes Formular." (bzw. "du", wenn Anrede=Du)
- WICHTIG: Genau dann, wenn das Kontaktformular erscheinen soll, setze GANZ ANS ENDE deiner Nachricht den unsichtbaren Marker [[KONTAKT]] (doppelte eckige Klammern). Der Besucher sieht ihn nicht. Setze ihn nur bei echtem Interesse, höchstens einmal pro Gespräch.`}
- Erfinde NIEMALS Kontaktdaten.
- GRUNDREGEL bei Aktionen: Wenn du Unterlagen teilst, einen Link gibst oder eine Aktion auslöst, schreibe IMMER auch einen kurzen begleitenden Satz dazu — rufe nie wortlos ein Werkzeug auf und beende das Gespräch nie abrupt. Sag freundlich, was als Nächstes passiert, und halte das Gespräch offen ("…schauen Sie es sich in Ruhe an, bei Fragen bin ich da").

NACH ERHALT DER KONTAKTDATEN — warm abschließen (NICHT abrupt "Danke" sagen):
Bedanke dich, bestätige die Weitergabe und gib einen Ausblick, der Vertrauen schafft. Etwa:
"Vielen Dank! Ich gebe Ihre Daten direkt an ${berater} weiter — er meldet sich bei Ihnen und hat sicher einen guten, konkreten Vorschlag für Ihre Situation. Bis dahin einen schönen Tag!" (bzw. "du/dich/dir", wenn Anrede=Du)
Wichtig: Erwähne, dass sich ${berater} meldet UND dass er einen konkreten Vorschlag/Mehrwert bringt — das ist die Nachbetreuung, die den Lead warm hält. Kein blosses "Danke".

═══════════════════════════════════════════════════════
VERIFIZIERTE FAKTEN / WISSEN (aus den hinterlegten Dokumenten)
═══════════════════════════════════════════════════════
${factsBlock}

REGELN:
- Stütze dich beim Fachlichen auf die hinterlegten Fakten. Allgemeines Branchen-/Compliance-Wissen darfst du nutzen, aber klar als allgemein kennzeichnen und Konkretes dem persönlichen Termin überlassen.
- Was du nicht sicher weißt: ehrlich sagen, dass ${berater} das im Gespräch klärt — niemals erfinden.${strategieText ? `

═══ GESPRÄCHSSTRATEGIE (vom Betreiber vorgegeben — wichtig!) ═══
Folge dieser Strategie. Es ist eine Reihenfolge von Angeboten: biete zuerst das Erste an; wenn der Interessent ablehnt oder zögert, gehe ruhig zum Nächsten über — Schritt für Schritt, seriös und nicht drängend. Links/Angebote genau wie angegeben weitergeben:
${strategieText}` : ''}${docs.length > 0 ? `

═══ TEILBARE DOKUMENTE ═══
Diese Unterlagen darfst du dem Interessenten auf Wunsch (oder wenn es im Gespräch passt) als Download-Link geben. Nutze dafür das Werkzeug share_document mit dem exakten Dateinamen. Sage kurz, was das Dokument enthält, und teile dann den Link. Gib NUR diese Dokumente heraus:
${docs.map(d => '• ' + d.file_name).join('\n')}` : ''}

═══ LINKS AM GESPRÄCHSENDE BÜNDELN ═══
Wenn das Gespräch zum Ende kommt (Verabschiedung, der Interessent will erstmal nichts weiter, oder ihr habt einen Abschluss gefunden), und du im Verlauf einen oder mehrere Links/Dokumente geteilt hast: Fasse zum Abschluss alle besprochenen Links kurz und übersichtlich in EINER Nachricht zusammen, damit der Interessent alles auf einen Blick hat. Beschrifte kurz, was jeder Link ist. Nenne nur Links, die du im Gespräch tatsächlich geteilt oder angeboten hast — nichts erfinden. Wurden keine Links geteilt, lass die Zusammenfassung weg.${geteiltHinweis}`;
  }

  // Web-Bot-Turn: ruft Sonnet, gibt die Antwort als String zurück (kein WhatsApp-Versand)
  // Wählt je nach Slot-Modus den passenden Prompt: 'beratung' oder (Standard) 'verkauf'.
  async function cvRunWebTurn(slot, article, history, userMessage, shareableDocs) {
    const docs = Array.isArray(shareableDocs) ? shareableDocs : [];
    const sharedLinks = [];
    // Ist das die allererste Bot-Nachricht? (userMessage===null = Begrüßung, sonst Historie prüfen)
    const istErsteNachricht = (userMessage === null) ||
      !(Array.isArray(history) && history.some(m => m && m.role === 'assistant'));
    const erstHinweis = istErsteNachricht
      ? ''
      : '\n\n⚠️ WICHTIG: Dies ist NICHT der Gesprächsbeginn — ihr habt euch bereits unterhalten. Stelle dich NICHT vor, begrüße NICHT erneut, sage nicht nochmal "Hallo, hier ist …". Antworte direkt und natürlich auf die letzte Nachricht, als Fortsetzung des laufenden Gesprächs.';
    const basePrompt = (slot && slot.mode === 'beratung')
      ? cvBuildBeratungPrompt(article, 'web', docs, [])
      : cvBuildWebPrompt(article, docs);
    // In die Unterhaltung "hineinwachsen": früh sehr knapp, später etwas mehr Prosa.
    const botAntwortenWeb = Array.isArray(history) ? history.filter(m => m && m.role === 'assistant').length : 0;
    const systemPrompt = basePrompt + erstHinweis + cvLaengenHinweis(botAntwortenWeb);

    // Werkzeug zum Teilen freigegebener Dokumente (nur wenn welche vorhanden sind)
    const webTools = docs.length > 0 ? [{
      name: 'share_document',
      description: 'Teile ein freigegebenes Dokument (z.B. Datenblatt, Broschüre, Dossier) mit dem Interessenten, indem du ihm den Download-Link gibst. Nutze dies, wenn der Interessent Unterlagen möchte oder die Strategie es vorsieht. Sage kurz, was drin ist. Gib NUR Dokumente aus der Liste der freigegebenen Dokumente heraus.',
      input_schema: {
        type: 'object',
        properties: {
          document_name: { type: 'string', description: 'Der exakte Dateiname aus der Liste der freigegebenen Dokumente' }
        },
        required: ['document_name']
      }
    }] : [];

    function normalizeHistory(hist) {
      const out = [];
      for (const m of (hist || [])) {
        if (!m || !m.role) continue;
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        let c = m.content; if (typeof c !== 'string') c = String(c || ''); c = c.trim();
        if (!c) continue;
        const last = out[out.length - 1];
        if (last && last.role === m.role) last.content += '\n' + c;
        else out.push({ role: m.role, content: c });
      }
      while (out.length && out[0].role !== 'user') out.shift();
      return out;
    }

    const messages = userMessage === null
      ? [{ role: 'user', content: 'START: Begrüße den Besucher KURZ und natürlich (1-2 Sätze, wie ein echter Mensch im Chat). Stelle dich knapp vor, nenne kurz das Thema/Produkt, das ihn interessiert, und frage, wie du helfen kannst. KEINE lange Produkt- oder Themenbeschreibung, KEINE Aufzählungen — das kommt erst, wenn er fragt. Beispiel-Ton: "Hallo, ich bin [Name] vom Beratungsteam. Sie interessieren sich für [Thema] — wie kann ich Ihnen helfen?"' }]
      : normalizeHistory(history);
    if (messages.length === 0) messages.push({ role: 'user', content: userMessage || 'Hallo' });

    let response, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const body = {
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          system: systemPrompt,
          messages
        };
        if (webTools.length > 0) body.tools = webTools;
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        if (response.ok) break;
        const errText = await response.text();
        lastErr = `${response.status}: ${errText.substring(0, 300)}`;
        console.error(`[CV Web] Versuch ${attempt}/3:`, lastErr);
        if (response.status === 400) break;
        await new Promise(r => setTimeout(r, attempt * 700));
      } catch(e) {
        lastErr = e.message;
        console.error(`[CV Web] Versuch ${attempt}/3 Netzfehler:`, e.message);
        await new Promise(r => setTimeout(r, attempt * 700));
      }
    }

    if (!response || !response.ok) {
      console.error('[CV Web] Call fehlgeschlagen:', lastErr);
      const du = (article.anrede || 'Sie') === 'Du';
      return { reply: du
        ? 'Sorry, da war kurz eine technische Störung. Stell deine Frage gern nochmal.'
        : 'Entschuldigen Sie, da war kurz eine technische Störung. Stellen Sie Ihre Frage gern nochmal.', showContactForm: false };
    }

    const data = await response.json();
    const blocks = data.content || [];
    let reply = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    // share_document-Aufrufe verarbeiten → passenden Link suchen
    const toolCalls = blocks.filter(b => b.type === 'tool_use');
    let shareLink = null;
    for (const tc of toolCalls) {
      if (tc.name === 'share_document') {
        const wanted = ((tc.input && tc.input.document_name) || '').trim().toLowerCase();
        let doc = docs.find(x => (x.file_name || '').toLowerCase() === wanted)
               || docs.find(x => (x.file_name || '').toLowerCase().indexOf(wanted) !== -1 && wanted.length > 2);
        if (doc && doc.public_url) {
          shareLink = { name: doc.file_name, url: doc.public_url };
          if (!sharedLinks.some(l => l.url === doc.public_url)) sharedLinks.push(shareLink);
        }
      }
    }

    if (!reply && toolCalls.length > 0) {
      const du = (article.anrede || 'Sie') === 'Du';
      reply = du
        ? 'Klar, ich schick dir die Unterlagen — schau sie dir in Ruhe an. Wenn du Fragen hast, bin ich da.'
        : 'Sehr gerne, ich sende Ihnen die Unterlagen — schauen Sie sie sich in Ruhe an. Bei Fragen bin ich da.';
    }
    if (!reply) reply = 'Einen Moment bitte.';

    // Kontaktformular-Marker erkennen und aus dem sichtbaren Text entfernen
    let showContactForm = false;
    if (reply.indexOf('[[KONTAKT]]') !== -1) {
      showContactForm = true;
      reply = reply.replace(/\[\[KONTAKT\]\]/g, '').trim();
    }
    return { reply, showContactForm, shareLink };
  }

  // Hilfsfunktion: Slot + Artikel über Bot-Code laden (für Web)
  async function cvWebLoadSlotArticle(botCode) {
    const { data: slot } = await supabase
      .from('cv_slots').select('*').ilike('bot_code', botCode).eq('status', 'active').maybeSingle();
    if (!slot) return { error: 'Dieser Bot-Code ist nicht aktiv oder ungültig.' };
    const { data: article } = await supabase
      .from('cv_articles').select('*').eq('slot_id', slot.id).maybeSingle();
    if (!article) return { error: 'Artikel nicht gefunden.' };
    // Beratungs-Modus erfordert eine freigeschaltete Subscription (190 €/Monat-Feature)
    if (slot.mode === 'beratung' && slot.subscription_id) {
      const { data: sub } = await supabase
        .from('cv_subscriptions').select('beratung_enabled').eq('id', slot.subscription_id).maybeSingle();
      if (!sub || sub.beratung_enabled !== true) {
        return { error: 'Der Beratungs-Modus ist für dieses Konto nicht freigeschaltet.' };
      }
    }
    return { slot, article };
  }

  // POST /api/cv/web/start — neue Web-Chat-Session starten (Begrüßung)
  // Body: { bot_code }
  app.post('/api/cv/web/start', async (req, res) => {
    try {
      const botCode = (req.body.bot_code || '').trim();
      if (!botCode) return res.status(400).json({ error: 'Bot-Code fehlt.' });
      const loaded = await cvWebLoadSlotArticle(botCode);
      if (loaded.error) return res.status(404).json({ error: loaded.error });

      const token = 'web_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
      const turn = await cvRunWebTurn(loaded.slot, loaded.article, [], null);
      const reply = turn.reply;
      const history = [{ role: 'assistant', content: reply }];

      const { error: insErr } = await supabase.from('cv_web_sessions').insert({
        session_token: token, slot_id: loaded.slot.id,
        messages: history, status: 'active',
        created_at: new Date().toISOString(), last_message_at: new Date().toISOString()
      });
      if (insErr) console.error('[CV Web start] INSERT-Fehler:', insErr.message);

      res.json({ session_token: token, reply, product: loaded.article.title, show_contact_form: turn.showContactForm });
    } catch(e) {
      console.error('[CV Web start]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // POST /api/cv/web/message — Folgenachricht im Web-Chat
  // Body: { session_token, message }
  app.post('/api/cv/web/message', async (req, res) => {
    try {
      const token = (req.body.session_token || '').trim();
      const msg = (req.body.message || '').trim();
      if (!token || !msg) return res.status(400).json({ error: 'session_token und message erforderlich.' });

      const { data: sess } = await supabase
        .from('cv_web_sessions').select('*').eq('session_token', token).maybeSingle();
      if (!sess) return res.status(404).json({ error: 'Session nicht gefunden.' });
      if (sess.status !== 'active') return res.status(409).json({ error: 'Session ist beendet.' });

      const { data: slot } = await supabase.from('cv_slots').select('*').eq('id', sess.slot_id).maybeSingle();
      const { data: article } = await supabase.from('cv_articles').select('*').eq('slot_id', sess.slot_id).maybeSingle();
      if (!slot || !article) return res.status(404).json({ error: 'Artikel nicht mehr verfügbar.' });

      // Teilbare Dokumente laden (shareable=true, öffentlich abrufbar)
      const { data: shareDocs } = await supabase
        .from('cv_uploads').select('file_name, public_url, kind')
        .eq('article_id', article.id).eq('shareable', true);
      const shareableDocs = (shareDocs || []).filter(d => d.public_url);

      const history = Array.isArray(sess.messages) ? sess.messages.slice() : [];
      history.push({ role: 'user', content: msg });

      const turn = await cvRunWebTurn(slot, article, history, msg, shareableDocs);
      let replyOut = turn.reply;
      if (turn.shareLink && turn.shareLink.url) {
        replyOut = replyOut.replace(/\s*$/, '') + '\n\n📎 ' + turn.shareLink.name + ': ' + turn.shareLink.url;
      }
      history.push({ role: 'assistant', content: replyOut });

      await supabase.from('cv_web_sessions')
        .update({ messages: history, last_message_at: new Date().toISOString() })
        .eq('session_token', token);

      res.json({ reply: replyOut, show_contact_form: turn.showContactForm });
    } catch(e) {
      console.error('[CV Web message]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // POST /api/cv/web/lead — Kontaktdaten aus dem Web-Formular sichern + Verkäufer alarmieren
  // Body: { session_token, name, email, phone }
  app.post('/api/cv/web/lead', async (req, res) => {
    try {
      const token = (req.body.session_token || '').trim();
      const name  = (req.body.name  || '').trim();
      const email = (req.body.email || '').trim();
      const phone = (req.body.phone || '').trim();
      if (!token) return res.status(400).json({ error: 'session_token fehlt.' });
      if (!name)  return res.status(400).json({ error: 'Name fehlt.' });
      if (!email && !phone) return res.status(400).json({ error: 'Bitte E-Mail oder Telefon angeben.' });

      // Session + Slot + Artikel laden
      const { data: sess } = await supabase
        .from('cv_web_sessions').select('*').eq('session_token', token).maybeSingle();
      if (!sess) return res.status(404).json({ error: 'Session nicht gefunden.' });

      const { data: slot }    = await supabase.from('cv_slots').select('*').eq('id', sess.slot_id).maybeSingle();
      const { data: article } = await supabase.from('cv_articles').select('title').eq('slot_id', sess.slot_id).maybeSingle();
      const productTitle = article?.title || 'Artikel';

      // Lead in Session speichern
      const { error: updErr } = await supabase.from('cv_web_sessions')
        .update({ lead_name: name, lead_email: email || null, lead_phone: phone || null, lead_captured: true })
        .eq('session_token', token);
      if (updErr) console.error('[CV Web lead] UPDATE-Fehler:', updErr.message);

      // Verkäufer-Adresse über Subscription ermitteln
      let sellerEmail = null, notifyOn = true;
      if (slot?.subscription_id) {
        const { data: sub } = await supabase
          .from('cv_subscriptions').select('seller_email, email_notifications_enabled')
          .eq('id', slot.subscription_id).maybeSingle();
        sellerEmail = sub?.seller_email || null;
        notifyOn = sub?.email_notifications_enabled !== false;
      }

      // Verkäufer per Mail alarmieren (eigene, schlanke Lead-Mail)
      let mailed = false;
      if (sellerEmail && notifyOn) {
        const subject = `🌐 Neue Web-Anfrage — ${productTitle}`;
        const html = `<!DOCTYPE html><html lang="de"><body style="margin:0;background:#f6f9f5;font-family:Arial,Helvetica,sans-serif;color:#0d1b12">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="font-size:22px;font-weight:800;margin-bottom:4px"><span style="color:#0f6b34">CONVER</span><span style="color:#25d366">DINO</span></div>
  <div style="font-size:13px;color:#33473b;margin-bottom:20px">Neuer Lead über den Web-Chat</div>
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:22px">
    <p style="font-size:14px;margin:0 0 14px">Ein Interessent hat über den Web-Chat auf Ihrer Seite zu <strong>${productTitle}</strong> Kontaktdaten hinterlassen:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #eee"><td style="padding:8px 0;color:#33473b">Name</td><td style="padding:8px 0;text-align:right;font-weight:600">${name}</td></tr>
      ${email ? `<tr style="border-bottom:1px solid #eee"><td style="padding:8px 0;color:#33473b">E-Mail</td><td style="padding:8px 0;text-align:right;font-weight:600">${email}</td></tr>` : ''}
      ${phone ? `<tr style="border-bottom:1px solid #eee"><td style="padding:8px 0;color:#33473b">Telefon</td><td style="padding:8px 0;text-align:right;font-weight:600">${phone}</td></tr>` : ''}
    </table>
    <p style="font-size:13px;color:#33473b;line-height:1.6;margin:16px 0 0">Bitte zeitnah persönlich melden — der Interessent erwartet Ihren Kontakt.</p>
  </div>
</div></body></html>`;
        const text = `Neuer Web-Lead — ${productTitle}\n\nName: ${name}\n${email ? 'E-Mail: ' + email + '\n' : ''}${phone ? 'Telefon: ' + phone + '\n' : ''}\nBitte zeitnah persönlich melden.`;
        mailed = await cvSendEmail(sellerEmail, subject, html, text);
      } else {
        console.warn('[CV Web lead] Keine seller_email/Benachrichtigung — Lead gespeichert, aber nicht gemailt.');
      }

      res.json({ success: true, mailed });
    } catch(e) {
      console.error('[CV Web lead]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // ============================================================
  // ANGEBOTS-GENERATOR (cv_offers)
  // Erzeugt Monats-Angebote, berechnet Preis über cvBerechneProgressiv
  // (dieselbe Logik wie der Preisrechner) und versendet per Resend.
  // Anbieter: Platin-Sport Marketing & Event GmbH (Generallizenznehmer),
  // Ynhald Corp als Lizenzgeber. "zzgl. gesetzlicher USt".
  // ============================================================

  // Anbieter-Stammdaten (zentral, leicht änderbar)
  const CV_OFFER_PROVIDER = {
    name:    'Platin-Sport Marketing & Event GmbH',
    address: 'Ehrenpreisgasse 18, 1220 Wien, Österreich',
    uid:     'ATU67880769',
    role:    'Generallizenznehmer',
    licensor:'Ynhald Corp (Lizenzgeber)'
  };
  const CV_OFFER_VAT      = 20;   // USt-Satz in % (Standard, nur informativ — "zzgl. gesetzlicher USt")
  const CV_OFFER_VALID_DAYS = 14; // Gültigkeit in Tagen
  const CV_OFFER_FROM     = process.env.CV_OFFER_FROM || 'Converdino <office@ynhald.com>';
  const CV_OFFER_CAL_URL  = process.env.CV_OFFER_CAL_URL || 'https://cal.com/alexander-zajic/digitaler-verkaufsberater-24-7';
  const CV_OFFER_TEST_TO  = process.env.CV_OFFER_TEST_TO || 'office@ynhald.com';

  // Hilfsfunktion: aktuelle Preisstufen laden + progressiv rechnen
  async function cvOfferBerechne(slots) {
    const { data: tiers, error } = await supabase
      .from('cv_price_tiers').select('bots, price_per_bot')
      .eq('active', true).order('bots', { ascending: true });
    if (error) throw new Error('Preisstufen laden: ' + error.message);
    const result = cvBerechneProgressiv(slots, tiers || []);
    const net   = result.total;
    const vat   = Math.round(net * CV_OFFER_VAT) / 100;     // = net * (CV_OFFER_VAT/100)
    const gross = Math.round((net + vat) * 100) / 100;
    return { net, vat, gross, vatRate: CV_OFFER_VAT, detail: result.detail };
  }

  // Euro-Formatierung (de-AT)
  function cvFmtEuro(n) {
    return Number(n).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  // POST /api/cv/admin/offers/preview — NUR rechnen, nichts speichern/senden
  app.post('/api/cv/admin/offers/preview', async (req, res) => {
    try {
      const slots = parseInt(req.body.slots, 10);
      if (!slots || slots < 1) return res.status(400).json({ error: 'Slot-Anzahl fehlt/ungültig.' });
      const p = await cvOfferBerechne(slots);
      res.json({ slots, ...p });
    } catch(e) {
      console.error('[CV offers/preview]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // Baut die HTML- und Text-Mail für ein Angebot
  function cvBuildOfferEmail(o, p) {
    const validStr = o.valid_until
      ? new Date(o.valid_until).toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' })
      : '';
    const dateStr = new Date(o.created_at || Date.now()).toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'numeric' });

    // Anrede aus Geschlecht (salutation) + Name bilden
    const sal  = (o.salutation || '').toLowerCase();
    const name = (o.contact_name || '').trim();
    let anrede;
    if (sal === 'herr' && name)      anrede = 'Sehr geehrter Herr ' + name;
    else if (sal === 'frau' && name) anrede = 'Sehr geehrte Frau ' + name;
    else if (name)                   anrede = 'Sehr geehrte/r ' + name;
    else                             anrede = 'Sehr geehrte Damen und Herren';

    // Teststellungs-Mailto (vorausgefüllt) — encodeURIComponent für Betreff/Body
    const testSubject = encodeURIComponent('Teststellung Converdino — ' + (o.company_name || ''));
    const testBody = encodeURIComponent(
      'Guten Tag,\n\nwir möchten Converdino unverbindlich testen.\n\n' +
      'Firma: ' + (o.company_name || '') + '\n' +
      'Ansprechpartner: ' + (o.contact_name || '') + '\n' +
      'Angebot: ' + (o.offer_number || '') + '\n\n' +
      'Bitte kontaktieren Sie uns zur Einrichtung der Teststellung.\n\nMit freundlichen Grüßen');
    const testMailto = 'mailto:' + CV_OFFER_TEST_TO + '?subject=' + testSubject + '&body=' + testBody;

    // Die 5 stärksten Vorteile
    const vorteile = [
      ['Sofort erreichbar, rund um die Uhr', 'Jeder Interessent bekommt in Sekunden eine Antwort über WhatsApp — auch abends, am Wochenende und an Feiertagen.'],
      ['Verhandelt aktiv wie ein Profi', 'Informiert, geht auf Einwände ein und verhandelt den Preis innerhalb Ihrer Vorgaben — bis zur Einigung oder zum Rückruf-Termin.'],
      ['Alarmiert sofort Ihren Verkäufer', 'Bei echtem Kaufinteresse wird der zuständige Verkäufer umgehend informiert und übernimmt den heißen Lead.'],
      ['Ab der ersten Minute profitabel', 'Ein einziger zusätzlich gewonnener Abschluss übersteigt die Monatsgebühr in der Regel um ein Vielfaches.'],
      ['Kein Personal, keine Installation', 'Sie laden nur Ihre Produktinfos hoch — den Rest übernehmen wir. Keine Software, kein Wartungsaufwand auf Ihrer Seite.']
    ];
    const vorteileHtml = vorteile.map(function(v){
      return '<tr><td style="padding:7px 0;vertical-align:top;width:26px;color:#1faa52;font-weight:800">✓</td>' +
        '<td style="padding:7px 0;font-size:14px;line-height:1.5"><strong style="color:#0d1b12">'+v[0]+'</strong><br>' +
        '<span style="color:#33473b">'+v[1]+'</span></td></tr>';
    }).join('');
    const vorteileText = vorteile.map(function(v){ return '• '+v[0]+'\n  '+v[1]; }).join('\n');

    const html = `<!DOCTYPE html><html lang="de"><body style="margin:0;background:#f6f9f5;font-family:Arial,Helvetica,sans-serif;color:#0d1b12">
<div style="max-width:600px;margin:0 auto;padding:24px">

  <div style="font-size:26px;font-weight:800;letter-spacing:-.5px;margin-bottom:4px">
    <span style="color:#0f6b34">CONVER</span><span style="color:#25d366">DINO</span>
  </div>
  <div style="font-size:13px;color:#33473b;margin-bottom:24px">Ihr digitaler Verkaufsberater 24/7 — neue Umsätze, Top-Leads</div>

  <!-- Einstieg -->
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:24px;margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;font-size:12px;color:#33473b;margin-bottom:18px">
      <div><strong>Angebot ${o.offer_number}</strong></div>
      <div>Datum: ${dateStr}</div>
    </div>
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px">${anrede},</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 6px">jeder Interessent, der sich heute nicht sofort gut betreut fühlt, ist morgen beim Mitbewerber. Converdino sorgt dafür, dass <strong>${o.company_name}</strong> keinen einzigen Kontakt mehr verliert — mit einem digitalen Verkaufsberater, der rund um die Uhr für Sie arbeitet.</p>
  </div>

  <!-- Was Sie bekommen -->
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:24px;margin-bottom:16px">
    <div style="font-size:16px;font-weight:800;color:#0d1b12;margin-bottom:6px">Was Sie bekommen</div>
    <p style="font-size:14px;line-height:1.6;color:#33473b;margin:0 0 16px">Pro gebuchtem Slot erhalten Sie einen vollständig eingerichteten Verkaufsberater für eines Ihrer Produkte oder Objekte:</p>
    <table style="width:100%;border-collapse:collapse">${vorteileHtml}</table>
    <div style="background:#eef9f1;border:1px solid #d3ebda;border-radius:10px;padding:14px 16px;margin-top:18px;font-size:13px;color:#33473b;line-height:1.6">
      <strong style="color:#0d1b12">Im Paket pro Slot enthalten:</strong><br>
      Automatischer Wissensaufbau aus Ihren Produktunterlagen · WhatsApp-Verkaufslink · QR-Code (für Fahrzeug, Schaufenster, Inserat) · einbettbares Web-Widget · aktive Verhandlungslogik · sichere Zahlungsabwicklung über Stripe.
    </div>
  </div>

  <!-- Was ist ein Slot -->
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:24px;margin-bottom:16px">
    <div style="font-size:16px;font-weight:800;color:#0d1b12;margin-bottom:6px">Was ein Slot bedeutet</div>
    <p style="font-size:14px;line-height:1.6;color:#33473b;margin:0">Ein Slot ist Ihr laufender Verkaufsplatz — <strong>nicht auf ein einzelnes Produkt begrenzt</strong>. Sie bewerben darin ein Produkt oder Objekt; sobald es verkauft ist, stellen Sie sofort das nächste ein. So nutzen Sie denselben Slot über das Jahr für beliebig viele Artikel nacheinander. Jeder Slot wird monatlich gebucht.</p>
  </div>

  <!-- Preis -->
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:24px;margin-bottom:16px">
    <div style="font-size:16px;font-weight:800;color:#0d1b12;margin-bottom:12px">Ihr Angebot</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 0">Converdino — digitaler Verkaufsberater</td>
        <td style="padding:8px 0;text-align:right">${o.slots} ${o.slots === 1 ? 'Slot' : 'Slots'}</td>
      </tr>
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 0">Monatspreis (netto)</td>
        <td style="padding:8px 0;text-align:right">${cvFmtEuro(p.net)}</td>
      </tr>
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 0">zzgl. ${p.vatRate}% USt</td>
        <td style="padding:8px 0;text-align:right">${cvFmtEuro(p.vat)}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-weight:800;font-size:16px">Monatspreis brutto</td>
        <td style="padding:10px 0;text-align:right;font-weight:800;font-size:16px;color:#0f6b34">${cvFmtEuro(p.gross)}</td>
      </tr>
    </table>
    <p style="font-size:12px;color:#33473b;line-height:1.5;margin:12px 0 4px">Alle Preise zzgl. gesetzlicher Umsatzsteuer. Zahlung monatlich im Voraus per wiederkehrender, automatisierter Abbuchung. Monatlich kündbar.</p>
    ${validStr ? `<p style="font-size:12px;color:#33473b;margin:0">Dieses Angebot ist gültig bis <strong>${validStr}</strong>.</p>` : ''}
  </div>

  <!-- Call to Action -->
  <div style="background:#eef9f1;border:1px solid #d3ebda;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center">
    <div style="font-size:17px;font-weight:800;color:#0f6b34;margin-bottom:6px">Überzeugen Sie sich selbst</div>
    <p style="font-size:13px;color:#33473b;line-height:1.5;margin:0 0 18px">Lernen Sie Converdino in einem kurzen Video­gespräch kennen — oder fordern Sie eine unverbindliche Teststellung an.</p>
    <a href="${CV_OFFER_CAL_URL}" style="display:inline-block;background:#fff;color:#0f6b34;border:2px solid #1faa52;font-weight:800;font-size:15px;text-decoration:none;padding:11px 26px;border-radius:9px;margin:4px 6px">📅 Videokonferenz buchen</a>
    <a href="${testMailto}" style="display:inline-block;background:#fff;color:#0f6b34;border:2px solid #1faa52;font-weight:800;font-size:15px;text-decoration:none;padding:11px 26px;border-radius:9px;margin:4px 6px">🧪 Teststellung anfordern</a>
  </div>

  <!-- Anbieter -->
  <div style="background:#fff;border:1px solid #dde7df;border-radius:12px;padding:18px 24px;margin-bottom:16px;font-size:12px;color:#33473b;line-height:1.6">
    <strong style="color:#0d1b12">Anbieter</strong><br>
    ${CV_OFFER_PROVIDER.name}<br>
    ${CV_OFFER_PROVIDER.address}<br>
    UID: ${CV_OFFER_PROVIDER.uid} · ${CV_OFFER_PROVIDER.role}<br>
    Technologie: ${CV_OFFER_PROVIDER.licensor}
  </div>

  <p style="font-size:13px;color:#33473b;line-height:1.6">Sie können auch einfach auf diese E-Mail antworten — wir melden uns umgehend.</p>
  <p style="font-size:13px;color:#33473b;line-height:1.6;margin-top:14px">Mit freundlichen Grüßen<br>Ihr Converdino-Team</p>
</div></body></html>`;

    const text =
`Angebot ${o.offer_number} — Datum: ${dateStr}

${anrede},

jeder Interessent, der sich heute nicht sofort gut betreut fühlt, ist morgen beim Mitbewerber. Converdino sorgt dafür, dass ${o.company_name} keinen einzigen Kontakt mehr verliert — mit einem digitalen Verkaufsberater, der rund um die Uhr arbeitet.

WAS SIE BEKOMMEN
${vorteileText}

Im Paket pro Slot enthalten: Automatischer Wissensaufbau aus Ihren Produktunterlagen, WhatsApp-Verkaufslink, QR-Code, einbettbares Web-Widget, aktive Verhandlungslogik, sichere Zahlungsabwicklung über Stripe.

WAS EIN SLOT BEDEUTET
Ein Slot ist Ihr laufender Verkaufsplatz — nicht auf ein einzelnes Produkt begrenzt. Sobald ein Produkt verkauft ist, stellen Sie sofort das nächste ein. So nutzen Sie denselben Slot für beliebig viele Artikel nacheinander. Jeder Slot wird monatlich gebucht.

IHR ANGEBOT
Converdino — digitaler Verkaufsberater: ${o.slots} ${o.slots === 1 ? 'Slot' : 'Slots'}
Monatspreis (netto): ${cvFmtEuro(p.net)}
zzgl. ${p.vatRate}% USt: ${cvFmtEuro(p.vat)}
Monatspreis brutto: ${cvFmtEuro(p.gross)}

Alle Preise zzgl. gesetzlicher Umsatzsteuer. Zahlung monatlich im Voraus per wiederkehrender, automatisierter Abbuchung. Monatlich kündbar.
${validStr ? `Gültig bis: ${validStr}` : ''}

ÜBERZEUGEN SIE SICH SELBST
Videokonferenz buchen: ${CV_OFFER_CAL_URL}
Teststellung anfordern: einfach auf diese E-Mail antworten oder an ${CV_OFFER_TEST_TO} schreiben.

Anbieter:
${CV_OFFER_PROVIDER.name}
${CV_OFFER_PROVIDER.address}
UID: ${CV_OFFER_PROVIDER.uid} · ${CV_OFFER_PROVIDER.role}
Technologie: ${CV_OFFER_PROVIDER.licensor}

Mit freundlichen Grüßen
Ihr Converdino-Team`;

    return { html, text };
  }

  // Eigener Mail-Versand für Angebote (Absender office@, ohne andere Mails zu ändern)
  async function cvSendOfferEmail(toEmail, subject, html, text) {
    if (!cvResend) { console.warn('[CV Offer] Resend nicht initialisiert'); return false; }
    if (!toEmail || !/.+@.+\..+/.test(toEmail)) { console.warn('[CV Offer] Ungültige Empfänger-Email:', toEmail); return false; }
    try {
      const result = await cvResend.emails.send({
        from: CV_OFFER_FROM, to: toEmail, replyTo: CV_MAIL_REPLY_TO, subject, html, text
      });
      if (result?.error) { console.error('[CV Offer] Resend-Fehler:', result.error.message || result.error); return false; }
      console.log(`[CV Offer] ✉️  Angebot versendet → ${toEmail}`);
      return true;
    } catch(e) { console.error('[CV Offer] Exception:', e.message); return false; }
  }

  // POST /api/cv/admin/offers — Angebot erzeugen, speichern, per Mail senden
  app.post('/api/cv/admin/offers', async (req, res) => {
    try {
      const { company_name, address, contact_name, contact_email, salutation } = req.body;
      const slots = parseInt(req.body.slots, 10);
      if (!company_name || !contact_email) return res.status(400).json({ error: 'Firma und E-Mail sind Pflicht.' });
      if (!slots || slots < 1) return res.status(400).json({ error: 'Slot-Anzahl fehlt/ungültig.' });
      if (!/.+@.+\..+/.test(contact_email)) return res.status(400).json({ error: 'E-Mail-Adresse ungültig.' });

      // Preis berechnen (gleiche Logik wie Preisrechner)
      const p = await cvOfferBerechne(slots);

      // Fortlaufende Angebotsnummer ANG-JAHR-XXXX
      const year = new Date().getFullYear();
      const prefix = `ANG-${year}-`;
      const { data: existing } = await supabase
        .from('cv_offers').select('offer_number')
        .like('offer_number', prefix + '%')
        .order('offer_number', { ascending: false }).limit(1);
      let next = 1;
      if (existing && existing.length > 0) {
        const lastNum = parseInt(String(existing[0].offer_number).replace(prefix, ''), 10);
        if (!isNaN(lastNum)) next = lastNum + 1;
      }
      const offerNumber = prefix + String(next).padStart(4, '0');

      // Gültig-bis
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + CV_OFFER_VALID_DAYS);
      const validUntilStr = validUntil.toISOString().slice(0, 10);

      // In cv_offers speichern
      const offerRow = {
        offer_number: offerNumber,
        company_name, address: address || null,
        contact_name: contact_name || null, contact_email,
        slots, price_net: p.net, vat_rate: p.vatRate, price_vat: p.vat, price_gross: p.gross,
        breakdown: p.detail, valid_until: validUntilStr, status: 'erstellt'
      };
      const { data: saved, error: insErr } = await supabase
        .from('cv_offers').insert(offerRow).select().single();
      if (insErr) {
        console.error('[CV offers] INSERT-Fehler:', insErr.message);
        return res.status(500).json({ error: 'Speichern fehlgeschlagen: ' + insErr.message });
      }

      // Mail bauen + senden (salutation nur für die Anrede, nicht in DB nötig)
      const { html, text } = cvBuildOfferEmail({ ...saved, salutation }, p);
      const subject = `Ihr Converdino-Angebot ${offerNumber} für ${company_name}`;
      const sent = await cvSendOfferEmail(contact_email, subject, html, text);

      // Status aktualisieren
      if (sent) {
        await supabase.from('cv_offers')
          .update({ status: 'versendet', sent_at: new Date().toISOString() })
          .eq('id', saved.id);
      }

      res.json({
        success: true, sent,
        offer_number: offerNumber,
        net: p.net, vat: p.vat, gross: p.gross, vatRate: p.vatRate,
        valid_until: validUntilStr,
        message: sent ? 'Angebot erstellt und versendet.' : 'Angebot erstellt, aber Mailversand fehlgeschlagen (siehe Log).'
      });
    } catch(e) {
      console.error('[CV offers POST]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // GET /api/cv/admin/offers — erstellte Angebote auflisten (Nachverfolgung)
  // Jedes Angebot bekommt ein berechnetes Flag "archived":
  // archiviert = Gültigkeit (valid_until) liegt mehr als 7 Tage in der Vergangenheit.
  app.get('/api/cv/admin/offers', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('cv_offers').select('*')
        .order('created_at', { ascending: false }).limit(500);
      if (error) return res.status(500).json({ error: error.message });
      const now = Date.now();
      const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage nach Ablauf
      const offers = (data || []).map(function(o) {
        let archived = false;
        if (o.valid_until) {
          const validEnd = new Date(o.valid_until).getTime();
          if (!isNaN(validEnd) && (now - validEnd) > ARCHIVE_AFTER_MS) archived = true;
        }
        return { ...o, archived };
      });
      res.json({ offers });
    } catch(e) {
      console.error('[CV offers GET]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // POST /api/cv/admin/offers/:id/convert — Angebot als Kunde übernehmen
  // Legt automatisch Login + Passwort an (users + cv_subscriptions, ohne Slots),
  // markiert das Angebot als "übernommen" und gibt die Zugangsdaten zurück.
  app.post('/api/cv/admin/offers/:id/convert', async (req, res) => {
    try {
      // 1) Angebot laden
      const { data: offer, error: offErr } = await supabase
        .from('cv_offers').select('*').eq('id', req.params.id).maybeSingle();
      if (offErr) return res.status(500).json({ error: 'Angebot laden: ' + offErr.message });
      if (!offer) return res.status(404).json({ error: 'Angebot nicht gefunden.' });
      if (offer.status === 'übernommen') {
        return res.status(409).json({ error: 'Dieses Angebot wurde bereits als Kunde übernommen.' });
      }

      // 2) Login-Namen aus Firmenname erzeugen (Slug), bei Kollision mit Zähler
      function slugify(s) {
        return String(s || 'kunde').toLowerCase()
          .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
          .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 40) || 'kunde';
      }
      let baseLogin = slugify(offer.company_name);
      let login = baseLogin;
      for (let i = 2; i <= 50; i++) {
        const { data: u } = await supabase.from('users').select('id').eq('username', login).maybeSingle();
        const { data: s } = await supabase.from('cv_subscriptions').select('id').eq('user_login', login).maybeSingle();
        if (!u && !s) break;
        login = baseLogin + '-' + i;
      }

      // 3) Lesbares Passwort generieren
      function genPassword() {
        const w = ['Sonne','Berg','Fluss','Stern','Wald','Meer','Wind','Licht','Stein','Blume'];
        const word = w[Math.floor(Math.random()*w.length)];
        const num = Math.floor(1000 + Math.random()*9000);
        const sym = '!#$%'[Math.floor(Math.random()*4)];
        return word + num + sym;
      }
      const plainPw = genPassword();
      const hashed = await cvHashPassword(plainPw);

      // 4) Login-Konto anlegen
      const { data: user, error: userErr } = await supabase
        .from('users')
        .insert({
          username: login, password: hashed, role: 'merchant',
          name: offer.company_name || offer.contact_name || login,
          email: offer.contact_email || null, active: true
        })
        .select().single();
      if (userErr) return res.status(400).json({ error: 'Login anlegen: ' + userErr.message });

      // 5) Subscription anlegen (ohne Slots — slots_total 0)
      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions')
        .insert({
          user_login: login, status: 'active', slots_total: 0,
          company_name: offer.company_name || null,
          contact_name: offer.contact_name || null,
          seller_email: offer.contact_email || null,
          email_notifications_enabled: true
        })
        .select().single();
      if (subErr) {
        await supabase.from('users').delete().eq('id', user.id); // Rollback
        return res.status(400).json({ error: 'Abo anlegen: ' + subErr.message });
      }

      // 6) Angebot als übernommen markieren
      await supabase.from('cv_offers')
        .update({ status: 'übernommen' }).eq('id', offer.id);

      res.json({
        success: true,
        login: login,
        password: plainPw,
        company_name: offer.company_name,
        sub_id: sub.id,
        message: 'Kunde angelegt. Slots können jetzt in der Kundenliste hinzugefügt werden.'
      });
    } catch(e) {
      console.error('[CV offers convert]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
  });

  // GET /api/cv/admin/customers — alle Converdino-Kunden auflisten
  app.get('/api/cv/admin/customers', async (req, res) => {
    try {
      const { data: subs, error } = await supabase
        .from('cv_subscriptions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });

      // Slot-Anzahl pro Subscription ermitteln
      const subIds = (subs || []).map(s => s.id);
      let slotCounts = {};
      if (subIds.length > 0) {
        const { data: slots } = await supabase
          .from('cv_slots')
          .select('id, subscription_id')
          .in('subscription_id', subIds);
        for (const s of (slots || [])) {
          slotCounts[s.subscription_id] = (slotCounts[s.subscription_id] || 0) + 1;
        }
      }

      const customers = (subs || []).map(s => ({
        id: s.id,
        user_login: s.user_login,
        company_name: s.company_name || null,
        contact_name: s.contact_name || null,
        contact_phone: s.contact_phone || null,
        seller_email: s.seller_email || null,
        commission_pct: s.commission_pct != null ? s.commission_pct : null,
        status: s.status,
        beratung_enabled: s.beratung_enabled === true,
        slots_total: s.slots_total || 0,
        slots_created: slotCounts[s.id] || 0,
        created_at: s.created_at
      }));
      res.json({ customers });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/admin/customers — neuen Kunden anlegen (Login + Subscription)
  app.post('/api/cv/admin/customers', async (req, res) => {
    try {
      const {
        user_login, password, company_name, contact_name,
        contact_phone, seller_email, commission_pct
      } = req.body;

      if (!user_login || !password) {
        return res.status(400).json({ error: 'Login-Name und Passwort sind erforderlich' });
      }
      const login = String(user_login).toLowerCase().trim();

      // 1) Prüfen, ob Login schon existiert (users ODER cv_subscriptions)
      const { data: existingUser } = await supabase
        .from('users').select('id').eq('username', login).maybeSingle();
      if (existingUser) {
        return res.status(409).json({ error: 'Login-Name ist bereits vergeben' });
      }
      const { data: existingSub } = await supabase
        .from('cv_subscriptions').select('id').eq('user_login', login).eq('status', 'active').maybeSingle();
      if (existingSub) {
        return res.status(409).json({ error: 'Für diesen Login gibt es bereits ein aktives Abo' });
      }

      // 2) Login-Konto in users anlegen (Rolle 'merchant', gehasht)
      const hashed = await cvHashPassword(password);
      const { data: user, error: userErr } = await supabase
        .from('users')
        .insert({
          username: login,
          password: hashed,
          role: 'merchant',
          name: company_name || contact_name || login,
          email: seller_email || null,
          active: true
        })
        .select().single();
      if (userErr) return res.status(400).json({ error: 'Login: ' + userErr.message });

      // 3) Converdino-Subscription anlegen (verknüpft über user_login)
      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions')
        .insert({
          user_login: login,
          status: 'active',
          slots_total: 0,
          company_name: company_name || null,
          contact_name: contact_name || null,
          contact_phone: contact_phone || null,
          seller_email: seller_email || null,
          commission_pct: (commission_pct != null && commission_pct !== '') ? parseFloat(commission_pct) : null,
          email_notifications_enabled: true
        })
        .select().single();
      if (subErr) {
        // Rollback des Logins, damit keine Leiche entsteht
        await supabase.from('users').delete().eq('id', user.id);
        return res.status(400).json({ error: 'Abo: ' + subErr.message });
      }

      res.json({
        success: true,
        customer: {
          id: sub.id,
          user_login: login,
          company_name: sub.company_name,
          contact_name: sub.contact_name,
          contact_phone: sub.contact_phone,
          seller_email: sub.seller_email,
          commission_pct: sub.commission_pct,
          status: sub.status,
          slots_total: 0,
          slots_created: 0
        }
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/admin/customers/:subId/slots — Slots zuweisen/nachlegen
  app.post('/api/cv/admin/customers/:subId/slots', async (req, res) => {
    try {
      const subId = req.params.subId;
      const count = parseInt(req.body.count, 10);
      if (!count || count < 1 || count > 100) {
        return res.status(400).json({ error: 'Bitte eine Anzahl zwischen 1 und 100 angeben' });
      }

      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions').select('*').eq('id', subId).maybeSingle();
      if (subErr) return res.status(500).json({ error: subErr.message });
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      // Höchste vorhandene Slot-Nummer ermitteln
      const { data: existing } = await supabase
        .from('cv_slots').select('slot_number')
        .eq('subscription_id', subId)
        .order('slot_number', { ascending: false }).limit(1);
      const startNum = (existing && existing.length > 0) ? (existing[0].slot_number + 1) : 1;

      // Neue leere Slots anlegen
      const rows = [];
      for (let i = 0; i < count; i++) {
        rows.push({ subscription_id: subId, slot_number: startNum + i, status: 'empty' });
      }
      const { error: insErr } = await supabase.from('cv_slots').insert(rows);
      if (insErr) return res.status(400).json({ error: 'Slots: ' + insErr.message });

      // slots_total in der Subscription aktualisieren
      const newTotal = (sub.slots_total || 0) + count;
      await supabase.from('cv_subscriptions').update({ slots_total: newTotal }).eq('id', subId);

      res.json({ success: true, added: count, slots_total: newTotal });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // POST /api/cv/admin/customers/:subId/slots/remove — leere Slots entfernen
  // Entfernt bis zu 'count' LEERE Slots (höchste Nummern zuerst). Belegte bleiben unangetastet.
  app.post('/api/cv/admin/customers/:subId/slots/remove', async (req, res) => {
    try {
      const subId = req.params.subId;
      const count = parseInt(req.body.count, 10);
      if (!count || count < 1) {
        return res.status(400).json({ error: 'Bitte eine Anzahl ab 1 angeben' });
      }

      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions').select('*').eq('id', subId).maybeSingle();
      if (subErr) return res.status(500).json({ error: subErr.message });
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      // Nur LEERE Slots holen, höchste Nummer zuerst
      const { data: emptySlots, error: emptyErr } = await supabase
        .from('cv_slots')
        .select('id, slot_number')
        .eq('subscription_id', subId)
        .eq('status', 'empty')
        .order('slot_number', { ascending: false });
      if (emptyErr) return res.status(500).json({ error: emptyErr.message });

      const available = emptySlots || [];
      if (available.length === 0) {
        return res.status(409).json({ error: 'Keine leeren Slots vorhanden — belegte Slots werden nicht entfernt.' });
      }

      const toRemove = available.slice(0, count);
      const removeIds = toRemove.map(s => s.id);
      const { error: delErr } = await supabase.from('cv_slots').delete().in('id', removeIds);
      if (delErr) return res.status(400).json({ error: 'Löschen: ' + delErr.message });

      // slots_total neu berechnen (tatsächliche Anzahl nach dem Löschen)
      const { data: remaining } = await supabase
        .from('cv_slots').select('id').eq('subscription_id', subId);
      const newTotal = (remaining || []).length;
      await supabase.from('cv_subscriptions').update({ slots_total: newTotal }).eq('id', subId);

      res.json({
        success: true,
        removed: removeIds.length,
        requested: count,
        slots_total: newTotal,
        note: removeIds.length < count ? 'Es konnten nur leere Slots entfernt werden.' : undefined
      });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // POST /api/cv/admin/slot/:slotId/mode — Modus eines Slots setzen (verkauf/beratung)
  // Beratung nur erlaubt, wenn die Subscription beratung_enabled = true hat.
  app.post('/api/cv/admin/slot/:slotId/mode', async (req, res) => {
    try {
      const slotId = req.params.slotId;
      const mode = (req.body.mode === 'beratung') ? 'beratung' : 'verkauf';

      const { data: slot } = await supabase
        .from('cv_slots').select('id, subscription_id').eq('id', slotId).maybeSingle();
      if (!slot) return res.status(404).json({ error: 'Slot nicht gefunden' });

      if (mode === 'beratung') {
        const { data: sub } = await supabase
          .from('cv_subscriptions').select('beratung_enabled').eq('id', slot.subscription_id).maybeSingle();
        if (!sub || sub.beratung_enabled !== true) {
          return res.status(403).json({ error: 'Beratungs-Modus ist für diesen Kunden nicht freigeschaltet.' });
        }
      }

      await supabase.from('cv_slots').update({ mode }).eq('id', slotId);
      res.json({ success: true, mode });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // PUT /api/cv/admin/customers/:subId — Stammdaten ändern
  app.put('/api/cv/admin/customers/:subId', async (req, res) => {
    try {
      const subId = req.params.subId;
      const { company_name, contact_name, contact_phone, seller_email, commission_pct } = req.body;

      const { data: sub, error: subErr } = await supabase
        .from('cv_subscriptions').select('user_login').eq('id', subId).maybeSingle();
      if (subErr) return res.status(500).json({ error: subErr.message });
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      const updates = {};
      if (company_name !== undefined)  updates.company_name  = company_name || null;
      if (contact_name !== undefined)  updates.contact_name  = contact_name || null;
      if (contact_phone !== undefined) updates.contact_phone = contact_phone || null;
      if (seller_email !== undefined)  updates.seller_email  = seller_email || null;
      if (commission_pct !== undefined) {
        updates.commission_pct = (commission_pct !== '' && commission_pct != null) ? parseFloat(commission_pct) : null;
      }

      const { error: upErr } = await supabase
        .from('cv_subscriptions').update(updates).eq('id', subId);
      if (upErr) return res.status(400).json({ error: upErr.message });

      // E-Mail/Name auch im users-Login spiegeln (für Konsistenz)
      const userUpdates = {};
      if (seller_email !== undefined) userUpdates.email = seller_email || null;
      if (company_name !== undefined || contact_name !== undefined) {
        userUpdates.name = company_name || contact_name || sub.user_login;
      }
      if (Object.keys(userUpdates).length > 0) {
        await supabase.from('users').update(userUpdates).eq('username', sub.user_login);
      }

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/admin/customers/:subId/password — Passwort zurücksetzen
  app.post('/api/cv/admin/customers/:subId/password', async (req, res) => {
    try {
      const subId = req.params.subId;
      const newPw = req.body.password;
      if (!newPw || String(newPw).length < 4) {
        return res.status(400).json({ error: 'Passwort muss mindestens 4 Zeichen haben' });
      }
      const { data: sub } = await supabase
        .from('cv_subscriptions').select('user_login').eq('id', subId).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      const hashed = await cvHashPassword(newPw);
      const { error } = await supabase
        .from('users').update({ password: hashed }).eq('username', sub.user_login);
      if (error) return res.status(400).json({ error: error.message });

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/admin/customers/:subId/active — Kunde aktivieren/deaktivieren
  app.post('/api/cv/admin/customers/:subId/active', async (req, res) => {
    try {
      const subId = req.params.subId;
      const active = req.body.active === true || req.body.active === 'true';

      const { data: sub } = await supabase
        .from('cv_subscriptions').select('user_login').eq('id', subId).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      // Login sperren/freigeben
      await supabase.from('users').update({ active }).eq('username', sub.user_login);
      // Subscription-Status mitführen (deaktiviert = paused, aktiv = active)
      await supabase.from('cv_subscriptions')
        .update({ status: active ? 'active' : 'paused' }).eq('id', subId);

      res.json({ success: true, active });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/admin/customers/:subId/beratung — Beratungs-Modus freigeben/sperren (190 €/Mon.)
  app.post('/api/cv/admin/customers/:subId/beratung', async (req, res) => {
    try {
      const subId = req.params.subId;
      const enabled = req.body.enabled === true || req.body.enabled === 'true';

      const { data: sub } = await supabase
        .from('cv_subscriptions').select('id').eq('id', subId).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      await supabase.from('cv_subscriptions')
        .update({ beratung_enabled: enabled }).eq('id', subId);

      // Beim Entzug: bestehende Beratungs-Slots zurück auf Verkauf stellen (Sicherheit)
      if (!enabled) {
        await supabase.from('cv_slots')
          .update({ mode: 'verkauf' }).eq('subscription_id', subId).eq('mode', 'beratung');
      }

      res.json({ success: true, enabled });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
  app.delete('/api/cv/admin/customers/:subId', async (req, res) => {
    try {
      const subId = req.params.subId;
      const { data: sub } = await supabase
        .from('cv_subscriptions').select('user_login').eq('id', subId).maybeSingle();
      if (!sub) return res.status(404).json({ error: 'Kunde nicht gefunden' });

      // Slots entfernen, dann Subscription, dann Login
      await supabase.from('cv_slots').delete().eq('subscription_id', subId);
      await supabase.from('cv_subscriptions').delete().eq('id', subId);
      await supabase.from('users').delete().eq('username', sub.user_login);

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  // ============================================================
  // PASSWORT — Kunde ändert selbst / "Passwort vergessen" (Schritt 1c)
  // ============================================================

  // Verify-Helfer (passend zu cvHashPassword; Klartext-Fallback)
  async function cvVerifyPassword(plain, stored) {
    if (stored == null) return false;
    const looksHashed = typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
    if (looksHashed) {
      if (!cvBcrypt) return false;
      try { return await cvBcrypt.compare(plain, stored); } catch(e) { return false; }
    }
    return plain === stored;
  }

  function cvMakeToken() {
    // 48 Hex-Zeichen, ausreichend zufällig
    try {
      const crypto = require('crypto');
      return crypto.randomBytes(24).toString('hex');
    } catch(e) {
      return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 48);
    }
  }

  // POST /api/cv/account/change-password — eingeloggter Kunde ändert sein Passwort
  app.post('/api/cv/account/change-password', async (req, res) => {
    try {
      const login = String(req.body.user_login || '').toLowerCase().trim();
      const oldPw = req.body.old_password;
      const newPw = req.body.new_password;
      if (!login || !oldPw || !newPw) {
        return res.status(400).json({ error: 'Bitte alle Felder ausfüllen' });
      }
      if (String(newPw).length < 6) {
        return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' });
      }

      const { data: user } = await supabase
        .from('users').select('id, password').eq('username', login).maybeSingle();
      if (!user) return res.status(404).json({ error: 'Konto nicht gefunden' });

      const ok = await cvVerifyPassword(oldPw, user.password);
      if (!ok) return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });

      const hashed = await cvHashPassword(newPw);
      const { error } = await supabase.from('users').update({ password: hashed }).eq('id', user.id);
      if (error) return res.status(400).json({ error: error.message });

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/cv/account/forgot-password — Reset-Link per E-Mail anfordern
  // Antwortet aus Sicherheitsgründen IMMER mit success (verrät nicht, ob ein Konto existiert)
  app.post('/api/cv/account/forgot-password', async (req, res) => {
    try {
      const ident = String(req.body.identifier || '').trim();
      if (!ident) return res.status(400).json({ error: 'Bitte Login-Name oder E-Mail eingeben' });

      const identLower = ident.toLowerCase();

      // Konto über Login ODER E-Mail finden
      let user = null;
      const byLogin = await supabase
        .from('users').select('id, username, email').eq('username', identLower).maybeSingle();
      if (byLogin.data) user = byLogin.data;
      if (!user) {
        const byEmail = await supabase
          .from('users').select('id, username, email').eq('email', ident).maybeSingle();
        if (byEmail.data) user = byEmail.data;
      }

      // E-Mail bestimmen: users.email ODER seller_email aus Subscription
      let targetEmail = user?.email || null;
      if (user && !targetEmail) {
        const { data: sub } = await supabase
          .from('cv_subscriptions').select('seller_email').eq('user_login', user.username).maybeSingle();
        targetEmail = sub?.seller_email || null;
      }

      if (user && targetEmail) {
        const token = cvMakeToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 Stunde gültig
        const { error: insErr } = await supabase.from('cv_password_resets').insert({
          user_login: user.username, token, expires_at: expires, used: false
        });
        if (insErr) {
          console.error('[CV Reset] INSERT-Fehler cv_password_resets:', insErr.message, '| Details:', JSON.stringify(insErr));
        } else {
          console.log('[CV Reset] Token gespeichert für', user.username);
        }

        const link = `${CV_BASE_URL}/cv-passwort-neu.html?token=${token}`;
        const subject = 'Converdino — Passwort zurücksetzen';
        const html = `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a2e24;">
            <h2 style="color:#128C7E;">Passwort zurücksetzen</h2>
            <p>Es wurde angefordert, das Passwort für <strong>${user.username}</strong> zurückzusetzen.</p>
            <p>Klicke auf den folgenden Link, um ein neues Passwort zu vergeben. Der Link ist 1 Stunde gültig:</p>
            <p style="margin:24px 0;">
              <a href="${link}" style="background:#25D366;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Neues Passwort setzen</a>
            </p>
            <p style="color:#6b7e74;font-size:13px;">Falls du das nicht warst, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.</p>
          </div>`;
        const text = `Passwort zurücksetzen für ${user.username}\n\nLink (1 Stunde gültig):\n${link}\n\nFalls du das nicht warst, ignoriere diese E-Mail.`;
        await cvSendEmail(targetEmail, subject, html, text);
      } else {
        console.log('[CV Reset] Kein Konto/keine E-Mail für:', ident, '— sende trotzdem neutrale Antwort');
      }

      // Immer neutral antworten
      res.json({ success: true });
    } catch(e) {
      console.error('[CV Reset] forgot-password Fehler:', e.message);
      // Auch im Fehlerfall neutral bleiben
      res.json({ success: true });
    }
  });

  // POST /api/cv/account/reset-password — neues Passwort mit Token setzen
  app.post('/api/cv/account/reset-password', async (req, res) => {
    try {
      const token = String(req.body.token || '').trim();
      const newPw = req.body.new_password;
      if (!token || !newPw) return res.status(400).json({ error: 'Token und neues Passwort erforderlich' });
      if (String(newPw).length < 6) return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen haben' });

      const { data: reset } = await supabase
        .from('cv_password_resets').select('*').eq('token', token).maybeSingle();
      if (!reset) return res.status(400).json({ error: 'Link ungültig' });
      if (reset.used) return res.status(400).json({ error: 'Dieser Link wurde bereits verwendet' });
      if (new Date(reset.expires_at) < new Date()) return res.status(400).json({ error: 'Link ist abgelaufen — bitte neu anfordern' });

      const hashed = await cvHashPassword(newPw);
      const { error: upErr } = await supabase
        .from('users').update({ password: hashed }).eq('username', reset.user_login);
      if (upErr) return res.status(400).json({ error: upErr.message });

      // Token verbrauchen
      await supabase.from('cv_password_resets').update({ used: true }).eq('id', reset.id);

      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });


  console.log(`✅ Converdino API geladen — /api/cv/* aktiv + WhatsApp-Handler + Email (${cvResend ? 'AKTIV' : 'inaktiv'})`);

  // Rückgabe: Handler für server.js
  return {
    handleBotStart: cvHandleBotStart,
    getActiveBotSession: cvGetActiveBotSession,
    handleBotReply: cvHandleBotReply,
    findBotCodeInText: cvFindBotCodeInText
  };
};
