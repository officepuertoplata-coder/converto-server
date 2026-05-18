// ── In server.js hinzufügen ──────────────────────────────────
// Nach den bestehenden /api/vk/article/:id/notes Endpoint einfügen:

// Foto zu anderem Artikel verschieben
app.put('/api/vk/photo/:photoId/move', async (req, res) => {
  try {
    const { photoId } = req.params;
    const { article_id } = req.body;
    if (!article_id) return res.status(400).json({ error: 'article_id fehlt' });

    await pool.query(
      'UPDATE vk_photos SET article_id = $1 WHERE id = $2',
      [article_id, photoId]
    );
    res.json({ success: true });
  } catch (e) {
    console.error('Photo move error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Leeren Artikel löschen (nach Foto-Verschiebung)
app.delete('/api/vk/article/:articleId', async (req, res) => {
  try {
    const { articleId } = req.params;

    // Sicherheitscheck: nur löschen wenn wirklich keine Fotos mehr
    const check = await pool.query(
      'SELECT COUNT(*) as cnt FROM vk_photos WHERE article_id = $1',
      [articleId]
    );
    const cnt = parseInt(check.rows[0].cnt || 0);
    if (cnt > 0) {
      return res.status(400).json({ error: 'Artikel hat noch ' + cnt + ' Fotos' });
    }

    await pool.query('DELETE FROM vk_articles WHERE id = $1', [articleId]);
    res.json({ success: true });
  } catch (e) {
    console.error('Article delete error:', e);
    res.status(500).json({ error: e.message });
  }
});
