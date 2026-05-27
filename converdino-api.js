// ============================================================
// CONVERDINO API — Eigenständiges Modul
// Wird in server.js geladen mit: require('./converdino-api')(app, supabase);
// Berührt nichts vom alten Code.
// ============================================================

module.exports = function(app, supabase) {

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
  // 6. POST /api/cv/slot/:id/activate
  //    Bot aktivieren — generiert BOT-Code, WA-Link, QR, Widget
  //    (Analyse-Stub kommt in Schritt 5)
  // ============================================================
  app.post('/api/cv/slot/:id/activate', async (req, res) => {
    try {
      const slotId = req.params.id;

      const { data: slot } = await supabase
        .from('cv_slots').select('*').eq('id', slotId).maybeSingle();
      if (!slot) return res.status(404).json({ error: 'Slot nicht gefunden' });

      const { data: article } = await supabase
        .from('cv_articles').select('id').eq('slot_id', slotId).maybeSingle();
      if (!article) return res.status(400).json({ error: 'Kein Artikel im Slot' });

      // BOT-Code generieren (4 Zeichen, eindeutig)
      const botCode = 'BOT-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const waNumber = (process.env.WA_BOT_NUMBER || '436776411806').replace(/[^0-9]/g, '');
      const waLink   = `https://wa.me/${waNumber}?text=${encodeURIComponent(botCode)}`;
      const qrUrl    = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(waLink)}`;
      const widgetCode = `<script>(function(){var b=document.createElement('div');b.style='position:fixed;bottom:24px;right:24px;z-index:9999';b.innerHTML='<a href="${waLink}" target="_blank" style="display:flex;align-items:center;gap:8px;background:#25D366;color:#fff;padding:14px 20px;border-radius:30px;font-family:sans-serif;font-weight:700;text-decoration:none;box-shadow:0 4px 16px rgba(37,211,102,.4)">💬 Jetzt anfragen</a>';document.body.appendChild(b);})();</script>`;

      const { error: updErr } = await supabase.from('cv_slots').update({
        status: 'active',
        bot_code: botCode,
        wa_deeplink: waLink,
        qr_code_url: qrUrl,
        widget_code: widgetCode,
        activated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq('id', slotId);
      if (updErr) return res.status(500).json({ error: 'Aktivierung: ' + updErr.message });

      await supabase.from('cv_articles')
        .update({ status: 'analyzed' })
        .eq('id', article.id);

      res.json({
        success: true,
        bot_code: botCode,
        wa_deeplink: waLink,
        qr_code_url: qrUrl,
        widget_code: widgetCode
      });
    } catch(e) {
      console.error('[CV /activate]', e);
      res.status(500).json({ error: 'Unerwartet: ' + e.message });
    }
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


  console.log('✅ Converdino API geladen — /api/cv/* aktiv');
};
