/* ============================================================
   CONVERDINO — Web-Chat-Widget (Weg A)
   Einbetten mit:
   <script src="https://converto-server-production.up.railway.app/converdino-widget.js"
           data-bot="Anfrage-45SW"></script>
   data-bot = der Bot-Code des Slots (wie beim QR-Code).
   ============================================================ */
(function () {
  'use strict';

  // --- Konfiguration aus dem eigenen <script>-Tag lesen ---
  var thisScript = document.currentScript ||
    (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var BOT_CODE = (thisScript && thisScript.getAttribute('data-bot')) || '';
  var API = (thisScript && thisScript.getAttribute('data-api')) ||
            'https://converto-server-production.up.railway.app';
  // WhatsApp-Nummer (zentrale Converdino-Bot-Nummer; per data-wa überschreibbar)
  var WA_NUMBER = (thisScript && thisScript.getAttribute('data-wa')) || '4367764118066';
  // Modus: 'web' = nur Web-Chat im Auswahl-Fenster (keine WhatsApp-Option). Standard: beide.
  var MODE = ((thisScript && thisScript.getAttribute('data-mode')) || '').toLowerCase();
  var WEB_ONLY = (MODE === 'web');

  if (!BOT_CODE) { console.error('[Converdino] data-bot fehlt im Script-Tag.'); return; }

  // --- Farben (Converdino) ---
  var C = {
    green: '#25d366', greenDark: '#0f6b34', greenMid: '#1faa52',
    ink: '#0d1b12', inkSoft: '#33473b', paper: '#f6f9f5',
    card: '#eef9f1', line: '#d3ebda', white: '#ffffff'
  };

  var sessionToken = null;
  var busy = false;
  var contactShown = false;
  var idleTimer = null;          // Timer für Inaktivitäts-Nachfrage
  var idleAsked = false;         // Nachfrage nur einmal pro Gespräch
  var IDLE_MS = 150000;          // ca. 2,5 Min Stille → einmalige sanfte Nachfrage

  // --- Styles injizieren ---
  var css = '' +
  '.cvw-btn{position:fixed;bottom:24px;right:24px;z-index:2147483000;background:' + C.green + ';box-shadow:0 8px 26px -8px rgba(37,211,102,.6);cursor:pointer;display:inline-flex;align-items:center;gap:11px;border:none;padding:12px 22px;border-radius:22px;transition:transform .15s,box-shadow .2s;text-align:left;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;max-width:calc(100vw - 32px)}' +
  '.cvw-btn:hover{transform:translateY(-3px);box-shadow:0 16px 40px -10px rgba(37,211,102,.7)}' +
  '.cvw-btn svg{width:24px;height:24px;flex-shrink:0}' +
  '.cvw-btn .cvw-btn-txt{display:flex;flex-direction:column;line-height:1.15}' +
  '.cvw-btn .cvw-btn-main{font-weight:700;font-size:15px;color:' + C.ink + '}' +
  '.cvw-btn .cvw-btn-sub{font-weight:500;font-size:11.5px;color:' + C.ink + ';opacity:.82;letter-spacing:.01em;white-space:nowrap}' +
  '.cvw-panel{position:fixed;bottom:96px;right:24px;z-index:2147483000;width:370px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 130px);background:' + C.white + ';border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
  '.cvw-panel.cvw-open{display:flex}' +
  '.cvw-head{background:' + C.greenDark + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}' +
  '.cvw-head-t{font-weight:800;font-size:15px;line-height:1.2}' +
  '.cvw-head-s{font-size:11px;opacity:.85;margin-top:2px}' +
  '.cvw-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:0 4px}' +
  '.cvw-body{flex:1;overflow-y:auto;padding:16px;background:' + C.paper + ';display:flex;flex-direction:column;gap:10px}' +
  '.cvw-msg{max-width:82%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
  '.cvw-list{margin:6px 0 2px;padding-left:18px;white-space:normal}' +
  '.cvw-list li{margin:3px 0;line-height:1.4}' +
  '.cvw-bot{align-self:flex-start;background:' + C.white + ';border:1px solid ' + C.line + ';color:' + C.ink + ';border-bottom-left-radius:4px}' +
  '.cvw-user{align-self:flex-end;background:' + C.green + ';color:' + C.ink + ';border-bottom-right-radius:4px;font-weight:500}' +
  '.cvw-typing{align-self:flex-start;color:' + C.inkSoft + ';font-size:13px;font-style:italic;padding:4px 6px}' +
  '.cvw-foot{flex-shrink:0;border-top:1px solid ' + C.line + ';background:' + C.white + ';padding:10px;display:flex;gap:8px}' +
  '.cvw-input{flex:1;border:1px solid ' + C.line + ';border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;outline:none;resize:none}' +
  '.cvw-input:focus{border-color:' + C.greenMid + '}' +
  '.cvw-send{background:' + C.green + ';border:none;border-radius:10px;width:42px;flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
  '.cvw-send svg{width:20px;height:20px}' +
  '.cvw-send:disabled{opacity:.5;cursor:default}' +
  '.cvw-form{align-self:stretch;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}' +
  '.cvw-form-t{font-weight:700;font-size:13px;color:' + C.greenDark + '}' +
  '.cvw-form input{border:1px solid ' + C.line + ';border-radius:8px;padding:9px 11px;font-size:14px;font-family:inherit;outline:none}' +
  '.cvw-form input:focus{border-color:' + C.greenMid + '}' +
  '.cvw-form button{background:' + C.greenDark + ';color:#fff;border:none;border-radius:8px;padding:11px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit}' +
  '.cvw-form button:disabled{opacity:.5;cursor:default}' +
  '.cvw-form-ok{font-size:13px;color:' + C.greenDark + ';font-weight:600;text-align:center;padding:6px}' +
  '.cvw-credit{font-size:10px;color:' + C.inkSoft + ';text-align:center;padding:4px 0;opacity:.7}' +
  /* Auswahl-Fenster (WhatsApp oder Web) */
  '.cvw-choose{position:fixed;bottom:96px;right:24px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px);background:' + C.white + ';border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
  '.cvw-choose.cvw-open{display:flex}' +
  '.cvw-choose .cvw-head{background:' + C.greenDark + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}' +
  '.cvw-choose-body{padding:20px 18px;background:' + C.paper + '}' +
  '.cvw-choose-t{font-weight:800;font-size:15px;color:' + C.ink + ';text-align:center;margin-bottom:8px;line-height:1.3}' +
  '.cvw-benefits{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:7px;margin-bottom:18px;font-weight:600;font-size:12.5px;color:' + C.greenDark + '}' +
  '.cvw-benefits .cvw-dot{color:#9ec9ad;font-weight:700}' +
  '.cvw-opts{display:flex;flex-direction:column;gap:11px}' +
  '.cvw-opt{display:flex;align-items:center;gap:12px;text-decoration:none;border-radius:13px;padding:14px 15px;cursor:pointer;border:1.5px solid ' + C.line + ';background:' + C.white + ';width:100%;text-align:left;font-family:inherit;transition:transform .15s,box-shadow .2s}' +
  '.cvw-opt:hover{transform:translateY(-2px);box-shadow:0 12px 28px -14px rgba(15,107,52,.45)}' +
  '.cvw-opt-ic{width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px}' +
  '.cvw-opt-wa .cvw-opt-ic{background:#25d366}' +
  '.cvw-opt-web .cvw-opt-ic{background:' + C.card + ';border:1px solid ' + C.line + '}' +
  '.cvw-opt-tx{display:flex;flex-direction:column;line-height:1.25}' +
  '.cvw-opt-l{font-weight:700;font-size:14.5px;color:' + C.ink + '}' +
  '.cvw-opt-d{font-size:12px;color:' + C.inkSoft + '}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --- DOM aufbauen ---
  var btn = document.createElement('button');
  btn.className = 'cvw-btn';
  btn.setAttribute('aria-label', 'Chat öffnen');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#0d1b12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
    '<span class="cvw-btn-txt"><span class="cvw-btn-main">Mit Berater chatten</span><span class="cvw-btn-sub">Information · Beratung · Livetest</span></span>';

  var panel = document.createElement('div');
  panel.className = 'cvw-panel';
  panel.innerHTML =
    '<div class="cvw-head">' +
      '<div><div class="cvw-head-t" id="cvw-title">Verkaufsberater</div><div class="cvw-head-s" id="cvw-sub">Antwortet in Sekunden</div></div>' +
      '<button class="cvw-close" aria-label="Schließen">&times;</button>' +
    '</div>' +
    '<div class="cvw-body" id="cvw-body"></div>' +
    '<div class="cvw-foot">' +
      '<textarea class="cvw-input" id="cvw-input" rows="1" placeholder="Nachricht schreiben …"></textarea>' +
      '<button class="cvw-send" id="cvw-send" aria-label="Senden"><svg viewBox="0 0 24 24" fill="none" stroke="#0d1b12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
    '</div>' +
    '<div class="cvw-credit">powered by Converdino</div>';

  // Auswahl-Fenster: WhatsApp oder Web
  var waLink = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(BOT_CODE);
  var choose = document.createElement('div');
  choose.className = 'cvw-choose';
  // WhatsApp-Option nur im Normalmodus; bei data-mode="web" entfällt sie.
  var waOptionHtml = WEB_ONLY ? '' : (
        '<a class="cvw-opt cvw-opt-wa" id="cvw-go-wa" href="' + waLink + '" target="_blank" rel="noopener">' +
          '<span class="cvw-opt-ic"><svg viewBox="0 0 32 32" fill="#fff" width="22" height="22" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.1 1.6 5.9L4 29l8.3-1.6c1.7.9 3.6 1.4 5.7 1.4 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.8 0-3.5-.5-5-1.4l-.4-.2-4.9.9.9-4.8-.2-.4c-1-1.6-1.5-3.4-1.5-5.3 0-5.6 4.6-10.1 10.2-10.1S26.2 9.4 26.2 15 21.6 24.8 16 24.8zm5.6-7.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7.1-.1.3-.4.5-.6.2-.2.2-.3.3-.5.1-.2 0-.4 0-.6-.1-.2-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.2 3.3 5.3 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.2-.6-.4z"/></svg></span>' +
          '<span class="cvw-opt-tx"><span class="cvw-opt-l">Per WhatsApp</span><span class="cvw-opt-d">Im gewohnten Chat, Verlauf bleibt erhalten</span></span>' +
        '</a>'
  );
  // Überschrift im Web-Only-Modus etwas anpassen
  var chooseTitle = WEB_ONLY ? 'Chatten Sie mit unserem Berater' : 'Wie möchten Sie sprechen?';
  choose.innerHTML =
    '<div class="cvw-head">' +
      '<div><div class="cvw-head-t">Mit unserem Berater sprechen</div><div class="cvw-head-s">Antwortet in Sekunden</div></div>' +
      '<button class="cvw-close" id="cvw-choose-x" aria-label="Schließen">&times;</button>' +
    '</div>' +
    '<div class="cvw-choose-body">' +
      '<div class="cvw-choose-t">' + chooseTitle + '</div>' +
      '<div class="cvw-benefits"><span>Information</span><span class="cvw-dot">·</span><span>Beratung</span><span class="cvw-dot">·</span><span>Livetest</span></div>' +
      '<div class="cvw-opts">' +
        waOptionHtml +
        '<button type="button" class="cvw-opt cvw-opt-web" id="cvw-go-web">' +
          '<span class="cvw-opt-ic">🌐</span>' +
          '<span class="cvw-opt-tx"><span class="cvw-opt-l">Hier im Browser</span><span class="cvw-opt-d">Sofort chatten, ohne App zu öffnen</span></span>' +
        '</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(btn);
  document.body.appendChild(choose);
  document.body.appendChild(panel);

  var body   = panel.querySelector('#cvw-body');
  var input  = panel.querySelector('#cvw-input');
  var sendBtn= panel.querySelector('#cvw-send');
  var titleEl= panel.querySelector('#cvw-title');
  var closeBtn = panel.querySelector('.cvw-close');

  // --- Hilfsfunktionen ---
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  }

  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'cvw-msg ' + (who === 'user' ? 'cvw-user' : 'cvw-bot');
    var raw = text == null ? '' : String(text);
    // Markdown-Sternchen aus Bot-Nachrichten entfernen (**fett** / *kursiv* → reiner Text)
    if (who !== 'user') {
      raw = raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
    }
    // Text sicher escapen, dann erkannte URLs in klickbare Links umwandeln
    var safe = escapeHtml(raw);
    safe = safe.replace(/(https?:\/\/[^\s<]+)/g, function(url) {
      return '<a href="' + url + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;word-break:break-all;">' + url + '</a>';
    });
    // Aufzählungszeilen (-, •, *) in echte Bulletpoints umwandeln; Rest bleibt normaler Text
    if (who !== 'user') {
      var lines = safe.split('\n');
      var html = '';
      var inList = false;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var m = ln.match(/^\s*[-•*]\s+(.*)$/);
        if (m) {
          if (!inList) { html += '<ul class="cvw-list">'; inList = true; }
          html += '<li>' + m[1] + '</li>';
        } else {
          if (inList) { html += '</ul>'; inList = false; }
          html += (i > 0 ? '<br>' : '') + ln;
        }
      }
      if (inList) html += '</ul>';
      d.innerHTML = html;
    } else {
      d.innerHTML = safe.replace(/\n/g, '<br>');
    }
    body.appendChild(d);
    scrollDown();
    return d;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'cvw-typing';
    t.textContent = 'schreibt …';
    t.id = 'cvw-typing';
    body.appendChild(t);
    scrollDown();
  }
  function hideTyping() {
    var t = document.getElementById('cvw-typing');
    if (t) t.remove();
  }

  // Realistische Tipp-Dauer je nach Antwortlänge: ca. 2 Sek Grundzeit + Zeit pro Zeichen,
  // gedeckelt bei 7 Sek. So wirkt der Bot, als würde er die Antwort tippen.
  function typingDelay(text) {
    var len = (text || '').length;
    var ms = 1800 + len * 28;          // ~28 ms pro Zeichen
    if (ms < 2000) ms = 2000;          // mindestens 2 Sek
    if (ms > 7000) ms = 7000;          // höchstens 7 Sek
    return ms;
  }
  // Zeigt den Tippindikator für die berechnete Dauer, dann erst die Bot-Nachricht
  function botReplyDelayed(text, cb) {
    var wait = typingDelay(text);
    setTimeout(function () {
      hideTyping();
      addMsg(text, 'bot');
      if (typeof cb === 'function') cb();
    }, wait);
  }

  // --- Inaktivitäts-Nachfrage (einmalig, dezent) ---
  function clearIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
  function startIdleTimer() {
    clearIdle();
    if (idleAsked || !sessionToken) return;   // nur einmal, nur bei aktivem Chat
    idleTimer = setTimeout(function () {
      if (idleAsked || busy) return;
      idleAsked = true;
      // Anrede aus bisheriger Tonalität ableiten wäre Overkill — neutrale, höfliche Zeile
      var msg = 'Falls Sie noch Fragen haben, bin ich gerne da — ansonsten wünsche ich Ihnen einen schönen Tag.';
      showTyping();
      botReplyDelayed(msg);
    }, IDLE_MS);
  }

  function showContactForm() {
    if (contactShown) return;
    contactShown = true;
    var f = document.createElement('div');
    f.className = 'cvw-form';
    f.innerHTML =
      '<div class="cvw-form-t">Ihre Kontaktdaten</div>' +
      '<input id="cvw-name"  placeholder="Name *" autocomplete="name">' +
      '<input id="cvw-email" placeholder="E-Mail" autocomplete="email" type="email">' +
      '<input id="cvw-phone" placeholder="Telefon" autocomplete="tel">' +
      '<input id="cvw-company" placeholder="Unternehmen" autocomplete="organization">' +
      '<input id="cvw-website" placeholder="Webseite" autocomplete="url">' +
      '<button id="cvw-leadbtn">Absenden</button>';
    body.appendChild(f);
    scrollDown();
    f.querySelector('#cvw-leadbtn').addEventListener('click', function () {
      submitLead(f);
    });
  }

  function submitLead(formEl) {
    var name  = formEl.querySelector('#cvw-name').value.trim();
    var email = formEl.querySelector('#cvw-email').value.trim();
    var phone = formEl.querySelector('#cvw-phone').value.trim();
    var company = formEl.querySelector('#cvw-company').value.trim();
    var website = formEl.querySelector('#cvw-website').value.trim();
    if (!name) { formEl.querySelector('#cvw-name').focus(); return; }
    if (!email && !phone) { formEl.querySelector('#cvw-email').focus(); return; }
    var leadBtn = formEl.querySelector('#cvw-leadbtn');
    leadBtn.disabled = true; leadBtn.textContent = 'Sende …';
    fetch(API + '/api/cv/web/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: sessionToken, name: name, email: email, phone: phone, company: company, website: website })
    }).then(function (r) { return r.json(); }).then(function (d) {
      formEl.innerHTML = '<div class="cvw-form-ok">✓ Vielen Dank! Unser Verkäufer meldet sich in Kürze bei Ihnen.</div>';
      scrollDown();
    }).catch(function () {
      leadBtn.disabled = false; leadBtn.textContent = 'Absenden';
      addMsg('Das hat leider nicht geklappt — bitte versuchen Sie es gleich nochmal.', 'bot');
    });
  }

  // --- Chat starten (beim ersten Öffnen) ---
  function startChat() {
    showTyping();
    fetch(API + '/api/cv/web/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_code: BOT_CODE })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { hideTyping(); addMsg('Dieser Chat ist derzeit nicht verfügbar.', 'bot'); return; }
      sessionToken = d.session_token;
      if (d.product) titleEl.textContent = d.product;
      botReplyDelayed(d.reply, function () {
        if (d.show_contact_form) showContactForm();
        startIdleTimer();
      });
    }).catch(function () {
      hideTyping();
      addMsg('Verbindung fehlgeschlagen. Bitte später erneut versuchen.', 'bot');
    });
  }

  // --- Nachricht senden ---
  function sendMessage() {
    var text = input.value.trim();
    if (!text || busy || !sessionToken) return;
    clearIdle();                 // Nutzer ist aktiv → Inaktivitäts-Timer stoppen
    busy = true; sendBtn.disabled = true;
    addMsg(text, 'user');
    input.value = '';
    input.style.height = 'auto';
    showTyping();
    fetch(API + '/api/cv/web/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: sessionToken, message: text })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) {
        hideTyping();
        busy = false; sendBtn.disabled = false;
        addMsg('Entschuldigung, da ist etwas schiefgelaufen.', 'bot');
        return;
      }
      // Tippindikator noch kurz stehen lassen, dann erst die Antwort zeigen
      botReplyDelayed(d.reply, function () {
        busy = false; sendBtn.disabled = false;
        if (d.show_contact_form) showContactForm();
        startIdleTimer();        // Stille beginnt von vorn
      });
    }).catch(function () {
      hideTyping(); busy = false; sendBtn.disabled = false;
      addMsg('Verbindung unterbrochen. Bitte nochmal versuchen.', 'bot');
    });
  }

  // --- Events ---
  var started = false;

  function showLauncher() {
    btn.style.display = 'inline-flex';
  }
  function hideLauncher() {
    btn.style.display = 'none';
  }

  // Button → Auswahl-Fenster öffnen
  btn.addEventListener('click', function () {
    choose.classList.add('cvw-open');
    hideLauncher();
  });

  // Auswahl: „Hier im Browser" → Web-Chat öffnen
  choose.querySelector('#cvw-go-web').addEventListener('click', function () {
    choose.classList.remove('cvw-open');
    panel.classList.add('cvw-open');
    if (!started) { started = true; startChat(); }
    input.focus();
  });

  // Auswahl: „Per WhatsApp“ → öffnet WhatsApp (normaler Link). Danach Launcher zurück.
  // Im Web-Only-Modus existiert dieser Button nicht → nur binden, wenn vorhanden.
  var goWaBtn = choose.querySelector('#cvw-go-wa');
  if (goWaBtn) {
    goWaBtn.addEventListener('click', function () {
      choose.classList.remove('cvw-open');
      showLauncher();
      // der Link selbst öffnet WhatsApp (target="_blank") — kein preventDefault nötig
    });
  }

  // Auswahl-Fenster schließen → Launcher zurück
  choose.querySelector('#cvw-choose-x').addEventListener('click', function () {
    choose.classList.remove('cvw-open');
    showLauncher();
  });

  // Web-Chat schließen → Launcher zurück
  closeBtn.addEventListener('click', function () {
    panel.classList.remove('cvw-open');
    showLauncher();
  });
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });
})();
