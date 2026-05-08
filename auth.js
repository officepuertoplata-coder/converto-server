/**
 * auth.js – Converdino Auth Helper
 * Auf jeder geschützten Seite einbinden: <script src="auth.js"></script>
 * 
 * Verwendung:
 *   const auth = ConvAuth.require(['superadmin','staff','merchant']); 
 *   // → gibt {role, userId, name, slug, merchantId, merchants} zurück
 *   // → leitet zu login.html weiter falls nicht eingeloggt
 */

const ConvAuth = (function() {
  const KEY = 'converto_auth_v2';
  const API = 'https://converto-server-production.up.railway.app';

  function get() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e) { return null; }
  }

  function set(data) {
    localStorage.setItem(KEY, JSON.stringify({ ...data, loggedInAt: new Date().toISOString() }));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function isValid(auth) {
    if (!auth) return false;
    if (!auth.role) return false;
    // Session timeout: 12 Stunden
    if (auth.loggedInAt) {
      const age = Date.now() - new Date(auth.loggedInAt).getTime();
      if (age > 12 * 60 * 60 * 1000) return false;
    }
    return true;
  }

  /**
   * Prüft Auth und leitet weiter falls nicht eingeloggt.
   * @param {string[]} allowedRoles - z.B. ['superadmin','staff','merchant']
   * @returns {object} auth object
   */
  function require(allowedRoles) {
    const auth = get();
    if (!isValid(auth)) {
      const current = encodeURIComponent(window.location.href);
      window.location.href = 'login.html?redirect=' + current;
      return null;
    }
    if (allowedRoles && allowedRoles.length > 0) {
      if (!allowedRoles.includes(auth.role)) {
        window.location.href = 'hub.html';
        return null;
      }
    }
    return auth;
  }

  function logout() {
    clear();
    window.location.href = 'login.html';
  }

  /**
   * Gibt die aktuelle merchantId zurück
   * (aus auth oder aus URL parameter ?m=slug)
   */
  function getMerchantId() {
    const auth = get();
    return auth?.merchantId || null;
  }

  function getMerchantSlug() {
    const auth = get();
    if (auth?.slug) return auth.slug;
    // Fallback: URL parameter
    const params = new URLSearchParams(window.location.search);
    return params.get('m') || null;
  }

  /**
   * Rendert einen Standard-Header/Nav für alle Seiten
   */
  function renderNav(pageName) {
    const auth = get();
    if (!auth) return;
    const navEl = document.getElementById('conv-nav');
    if (!navEl) return;

    const merchantName = auth.merchantName || auth.slug || '';
    navEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <a href="hub.html" style="color:rgba(255,255,255,.7);text-decoration:none;font-size:.85rem;">← Hub</a>
        <span style="color:rgba(255,255,255,.3)">|</span>
        <strong style="font-size:.9rem;">${pageName}</strong>
        ${merchantName ? `<span style="background:#f4a100;color:#000;font-size:.65rem;font-weight:800;padding:2px 8px;border-radius:4px">${merchantName}</span>` : ''}
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:12px;">
        <span style="font-size:.78rem;color:rgba(255,255,255,.6)">${auth.name || auth.username || ''}</span>
        <button onclick="ConvAuth.logout()" style="background:none;border:1px solid rgba(255,255,255,.3);color:rgba(255,255,255,.7);padding:4px 12px;border-radius:6px;cursor:pointer;font-size:.78rem;">Ausloggen</button>
      </div>
    `;
  }

  return { get, set, clear, require, logout, getMerchantId, getMerchantSlug, renderNav, API };
})();
