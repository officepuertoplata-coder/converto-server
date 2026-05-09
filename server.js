// nav.js – Converdino Navigation Helper
// Generiert die Top-Navigation basierend auf Auth + Slug

(function() {
  const KEY = 'converto_auth_v2';
  const API = 'https://converto-server-production.up.railway.app';

  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) {}

  // Slug aus Auth oder URL
  const slug = (stored && stored.slug)
    ? stored.slug
    : (new URLSearchParams(window.location.search).get('m') || '');

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  const pages = [
    { file: 'comm.html',            icon: '💬', label: 'Kommunikation' },
    { file: 'verfuegbarkeit.html',  icon: '📋', label: 'Verfügbarkeit' },
    { file: 'bestellungen.html',    icon: '📦', label: 'Bestellungen'  },
    { file: 'admin.html',           icon: '⚙️', label: 'Admin'         },
  ];

  // Nur rendern wenn es einen bestehenden nav-Platzhalter gibt
  // oder als sticky nav am Seitenanfang einfügen
  const existing = document.querySelector('nav.conv-nav');
  if (!existing) return; // Nur wenn explizit <nav class="conv-nav"></nav> vorhanden

  const isSuperAdmin = stored && stored.role === 'superadmin';

  let html = `<div style="display:flex;align-items:center;gap:4px;">`;
  html += `<a href="hub.html" style="font-weight:900;font-size:.9rem;color:#25D366;margin-right:8px;text-decoration:none;">Converdino</a>`;

  pages.forEach(p => {
    const href = slug ? p.file + '?m=' + slug : p.file;
    const active = currentPage === p.file;
    html += `<a href="${href}" style="padding:5px 10px;border-radius:6px;font-size:.82rem;font-weight:700;text-decoration:none;color:${active?'#fff':'rgba(255,255,255,.7)'};background:${active?'rgba(37,211,102,0.2)':'none'};">${p.icon} ${p.label}</a>`;
  });

  if (isSuperAdmin) {
    html += `<a href="superadmin.html" style="padding:5px 10px;border-radius:6px;font-size:.82rem;font-weight:700;text-decoration:none;color:rgba(196,181,253,.8);">👑 Super</a>`;
  }

  html += `</div>`;
  html += `<div style="margin-left:auto;display:flex;align-items:center;gap:10px;">`;
  if (slug) html += `<span style="background:#f4a100;color:#000;font-size:.6rem;font-weight:800;padding:2px 6px;border-radius:4px;">${slug}</span>`;
  html += `<a href="hub.html" style="font-size:.75rem;color:rgba(255,255,255,.6);text-decoration:none;">← Hub</a>`;
  html += `</div>`;

  existing.innerHTML = html;
  existing.style.cssText = 'background:#1b4332;display:flex;align-items:center;padding:0 16px;height:48px;position:sticky;top:0;z-index:100;border-bottom:1px solid rgba(37,211,102,0.2);';
})();
