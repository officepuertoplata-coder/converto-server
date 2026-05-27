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
  // HELFER: Login-Identifier aus Body/Header lesen
  // ============================================================
  function getUserLogin(req) {
    return (
      req.body?.user_login ||
      req.query?.user_login ||
      req.headers['x-user-login'] ||
      'admin'
    );
  }


  // ============================================================
  // 1. GET /api/cv/me
  //    Liefert Subscription + alle Slots für den eingeloggten User
  // ============================================================
  app.get('/api/cv/me', async (req, res) => {
    try {
      const userLogin = req.query.user || 'admin';

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

      const enrichedSlots = (slots || []).map(s => ({
        ...s,
        article: articlesBySlot[s.id] || null
      }));

      res.json({
        active: true,
        subscription: {
          id: sub.id,
          slots_total: sub.slots_total,
          slots_used: enrichedSlots.filter(s => s.status !== 'empty').length,
          status: sub.status,
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
      const { title, sale_price, min_price, location, anrede, notes } = req.body;

      if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Artikelbezeichnung fehlt' });
      }

      // Slot prüfen
      const { data: slot, error: slotErr } = await supabase
        .from('cv_slots')
        .select('*')
        .eq('id', slotId)
        .maybeSingle();
      if (slotErr) return res.status(500).json({ error: 'Slot-Lesefehler: ' + slotErr.message });
      if (!slot)   return res.status(404).json({ error: 'Slot nicht gefunden' });

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
          .update({
            title: title.trim(),
            sale_price: sale_price || null,
            min_price: min_price || null,
            location: location || null,
            anrede: anrede || 'Sie',
            notes: notes || null,
            status: 'draft',
            updated_at: new Date().toISOString()
          })
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
            notes: notes || null,
            status: 'draft'
          })
          .select()
          .single();
        if (insErr) return res.status(500).json({ error: 'Insert: ' + insErr.message });
        article = inserted;
      }

      // Slot Status updaten
      await supabase
        .from('cv_slots')
        .update({ status: 'configured', updated_at: new Date().toISOString() })
        .eq('id', slotId);

      res.json({ success: true, article });
    } catch(e) {
      console.error('[CV /slot/:id/article]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
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
      const { kind, file_name, file_base64, content_type, content } = req.body;

      if (!['photo', 'pdf', 'note'].includes(kind)) {
        return res.status(400).json({ error: 'Ungültiger kind. Erwartet: photo/pdf/note' });
      }

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
  // KI-ANALYSE: Opus analysiert Fotos + Notizen + Stammdaten
  // ============================================================
  async function cvAnalyzeArticle(article, uploads) {
    const photos = uploads.filter(u => u.kind === 'photo' && u.public_url);
    const pdfs   = uploads.filter(u => u.kind === 'pdf');
    const notes  = uploads.filter(u => u.kind === 'note').map(u => u.content).join('\n\n');

    const anrede = article.anrede || 'Sie';

    const prompt = `Du analysierst ein Produkt für einen WhatsApp-Verkaufsbot, der direkt mit Käufern verhandelt.

PRODUKT-STAMMDATEN
Titel: ${article.title}
Verkaufspreis: €${article.sale_price || 'n/a'}
Mindestpreis: €${article.min_price || 'n/a'}
Standort: ${article.location || 'nicht angegeben'}
Anrede im Bot: ${anrede}

NOTIZEN VOM VERKÄUFER
${notes || '(keine Notizen)'}

${pdfs.length > 0 ? `ZUSATZ: ${pdfs.length} PDF-Dokument(e) wurden hochgeladen (z.B. Dossier, Rechnung, Zertifikate).` : ''}
${photos.length > 0 ? `Die angehängten Bilder zeigen das Produkt. Analysiere sie genau.` : ''}

AUFGABE
Erstelle eine vollständige Verkaufs-Wissensdatenbank als JSON. Der Bot wird damit später Käufer überzeugen und den Preis verhandeln.

REGELN
- Antworte NUR mit reinem JSON. Keine Markdown-Codeblöcke, keine Einleitung.
- Halte dich EXAKT an die untenstehende Struktur.
- Schreibe alle Bot-Texte in der Anrede "${anrede}".
- Nutze konkrete Details aus Bildern und Notizen. Keine Floskeln.
- Der Bot verhandelt zwischen Verkaufspreis (€${article.sale_price}) und Mindestpreis (€${article.min_price}). Niemals darunter.

JSON-FORMAT
{
  "category": "Produkttyp (z.B. KFZ, Maschine, Möbel, Elektronik)",
  "summary": "1-2 Sätze Produktbeschreibung",
  "key_facts": ["konkrete Fakten aus Bildern und Notizen, je 1 Satz"],
  "selling_points": ["stärkste Verkaufsargumente, je 1 Satz"],
  "condition": "Beschreibung des Zustands",
  "likely_buyer": "Wer kauft das typischerweise — 1 Satz",
  "likely_objections": [{ "objection": "möglicher Einwand", "response": "Antwort des Bots" }],
  "bot_strategy": {
    "opening_message": "Erste Bot-Nachricht: Begrüßung + Produktvorstellung mit stärksten Argumenten, 2-3 Sätze",
    "value_argument": "Hauptargument das den Preis rechtfertigt",
    "negotiation_steps": [
      "1. Verhandlung: Verkaufspreis halten, Wert betonen",
      "2. Verhandlung: kleines Zugeständnis (etwa -2-3%)",
      "3. Verhandlung: bis nahe Mindestpreis"
    ],
    "walkaway_line": "Höfliche Absage wenn Käufer unter Mindestpreis bleibt"
  }
}`;

    // Content mit Bildern
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
        max_tokens: 2500,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Opus API ${response.status}: ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch(e) {
      console.error('[CV Analyse] JSON parse failed. Raw:', text.substring(0, 500));
      return { error: 'Analyse-Output ungültig', raw_text: text.substring(0, 1000) };
    }
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
        const botCode = 'BOT-' + Math.random().toString(36).substring(2, 6).toUpperCase();
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

  // ── BOT-KONVERSATION STARTEN ─────────────────────────────
  async function cvHandleBotStart(phone, botCode, phoneId) {
    console.log(`[CV Bot] Start: phone=${phone}, code=${botCode}`);

    const { data: slot } = await supabase
      .from('cv_slots')
      .select('*')
      .eq('bot_code', botCode)
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

    // DB-Session anlegen (für Logging + Persistenz)
    const { data: dbSession } = await supabase
      .from('cv_bot_sessions')
      .insert({ slot_id: slot.id, buyer_phone: phone, messages: [], status: 'active' })
      .select()
      .single();

    // In-Memory-Cache
    cvBotSessions.set(phone, {
      dbSessionId: dbSession?.id,
      slot, article,
      history: [],
      phoneId,
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

  // ── EIN BOT-TURN (intern) ────────────────────────────────
  async function cvRunBotTurn(phone, userMessage) {
    const session = cvBotSessions.get(phone);
    if (!session) return;

    const { article, slot, phoneId } = session;
    const analysis = article.analysis || {};
    const strategy = analysis.bot_strategy || {};
    const anrede = article.anrede || 'Sie';

    // Erste Nachricht: vorgefertigte Begrüßung verwenden, falls vorhanden
    if (userMessage === null && strategy.opening_message) {
      const opening = strategy.opening_message;
      await sendWAMessage(phoneId, phone, opening);
      session.history = [{ role: 'assistant', content: opening }];
      await persistSession(session);
      return;
    }

    const systemPrompt = `Du bist ein professioneller WhatsApp-Verkaufsberater. Verhandle aktiv und führe zum Abschluss.

PRODUKT: ${article.title}
VERKAUFSPREIS: €${article.sale_price}
MINDESTPREIS: €${article.min_price} (NIE darunter gehen!)
STANDORT: ${article.location || 'auf Anfrage'}
ANREDE: ${anrede}

PRODUKTBESCHREIBUNG:
${analysis.summary || 'Kein Detail verfügbar.'}

VERKAUFSARGUMENTE:
${(analysis.selling_points || []).map((p, i) => `${i+1}. ${p}`).join('\n') || '(keine spezifischen Argumente)'}

HAUPTARGUMENT FÜR DEN PREIS:
${strategy.value_argument || 'Faires Preis-Leistungs-Verhältnis.'}

UMGANG MIT EINWÄNDEN:
${(analysis.likely_objections || []).map(o => `Einwand "${o.objection}": "${o.response}"`).join('\n') || '(keine Einwände vordefiniert)'}

VERHANDLUNGS-STRATEGIE:
${(strategy.negotiation_steps || ['Halte Verkaufspreis', 'Kleines Zugeständnis', 'Bis Mindestpreis']).join('\n')}
- Maximal 2-3 Zugeständnisse, jedes kleiner als das vorherige
- Bei Erreichen des Mindestpreises: "${strategy.walkaway_line || 'Das ist mein letztes Angebot.'}"

REGELN
- WhatsApp-Stil: kurz, natürlich, max. 3-4 Sätze
- ${anrede}-Anrede konsequent
- Aktiv verkaufen, nicht nur antworten
- Bei Einigung: Frage Käufer nach Name und Telefonnummer für Rückruf
- Bei Sackgasse: biete Rückruf an
- Keine Fakten erfinden — nur was oben steht`;

    const messages = userMessage === null
      ? [{ role: 'user', content: 'START: Begrüße den Käufer, präsentiere das Produkt überzeugend in 2-3 Sätzen und frage was ihn besonders interessiert.' }]
      : session.history.map(m => ({ role: m.role, content: m.content }));

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          system: systemPrompt,
          messages
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[CV Bot] API error:', response.status, errText.substring(0, 200));
        await sendWAMessage(phoneId, phone, 'Entschuldigung, ich bin gerade kurz nicht verfügbar. Bitte versuche es in einer Minute nochmal.');
        return;
      }

      const data = await response.json();
      const botReply = data.content?.[0]?.text || 'Entschuldigung, einen Moment bitte.';

      await sendWAMessage(phoneId, phone, botReply);

      if (userMessage !== null) {
        session.history.push({ role: 'assistant', content: botReply });
      } else {
        session.history = [{ role: 'assistant', content: botReply }];
      }
      await persistSession(session);

      // Deal/Exit Erkennung
      const lr = botReply.toLowerCase();
      const lu = (userMessage || '').toLowerCase();
      const dealWords = ['einverstanden', 'deal', 'abgemacht', 'ok passt', 'ich nehm es', 'ich nehme es', 'gekauft'];
      const exitWords = ['tschüss', 'auf wiedersehen', 'kein interesse', 'nicht interessiert', 'bye', 'ciao'];

      if (dealWords.some(w => lr.includes(w) || lu.includes(w))) {
        await cvNotifySeller(session, phone, 'deal', botReply);
        cvBotSessions.delete(phone);
      } else if (exitWords.some(w => lr.includes(w) || lu.includes(w)) || session.history.length > 30) {
        await cvNotifySeller(session, phone, 'lost', botReply);
        cvBotSessions.delete(phone);
      }
    } catch(e) {
      console.error('[CV Bot turn]', e);
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
  async function cvNotifySeller(session, buyerPhone, outcome, lastMessage) {
    try {
      // Subscription laden um Verkäufer-Telefonnummer zu bekommen
      const { data: sub } = await supabase
        .from('cv_subscriptions').select('user_login')
        .eq('id', session.slot.subscription_id).maybeSingle();

      const sellerLogin = sub?.user_login;

      // DB-Session updaten
      if (session.dbSessionId) {
        await supabase.from('cv_bot_sessions').update({
          status: outcome === 'deal' ? 'deal' : 'lost',
          outcome: lastMessage.substring(0, 500),
          last_message_at: new Date().toISOString()
        }).eq('id', session.dbSessionId);
      }

      // Wenn Verkäufer eine echte Telefonnummer ist → WA-Nachricht
      if (sellerLogin && /^\+?\d{8,}$/.test(sellerLogin.replace(/[^0-9+]/g, ''))) {
        const emoji = outcome === 'deal' ? '🎉' : '📋';
        const title = outcome === 'deal' ? 'Einigung erzielt!' : 'Gespräch beendet';
        const msg = `${emoji} *Converdino Bot-Report*\n\n*${title}*\nArtikel: ${session.article.title}\nKäufer: +${buyerPhone}\n\nLetzte Nachricht:\n${lastMessage.substring(0, 300)}`;
        const cleanPhone = sellerLogin.replace(/[^0-9]/g, '');
        await sendWAMessage(session.phoneId, cleanPhone, msg);
      } else {
        console.log(`[CV] Verkäufer-Benachrichtigung übersprungen (user_login: ${sellerLogin})`);
      }
    } catch(e) { console.error('[CV notify]', e); }
  }


  console.log('✅ Converdino API geladen — /api/cv/* aktiv + WhatsApp-Handler');

  // Rückgabe: Handler für server.js
  return {
    handleBotStart: cvHandleBotStart,
    getActiveBotSession: cvGetActiveBotSession,
    handleBotReply: cvHandleBotReply
  };
};
