<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Landingpage Builder – Converdino</title>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--wa:#25D366;--wa-d:#128C7E;--bg:#0a1f12;--card:#111f15;--card2:#162a1a;--border:rgba(37,211,102,0.15);--txt:#e8f5ec;--muted:#5d8a6a;--red:#ef4444;--gold:#f4a100;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Nunito',sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;}
nav{background:rgba(10,31,18,0.95);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:0 24px;height:56px;display:flex;align-items:center;position:sticky;top:0;z-index:100;}
.nav-brand{font-weight:900;font-size:1.1rem;color:var(--wa);text-decoration:none;margin-right:24px;}
.nav-brand span{color:var(--txt);}
.nav-link{color:var(--muted);text-decoration:none;font-size:.82rem;padding:0 12px;height:56px;display:flex;align-items:center;border-bottom:2px solid transparent;transition:all .2s;font-weight:600;}
.nav-link:hover{color:var(--txt);}
.nav-link.active{color:var(--wa);border-bottom-color:var(--wa);}
.nav-right{margin-left:auto;display:flex;align-items:center;gap:8px;}
.layout{display:grid;grid-template-columns:440px 1fr;height:calc(100vh - 56px);}
.panel{background:var(--card);border-right:1px solid var(--border);overflow-y:auto;display:flex;flex-direction:column;}
.panel-header{padding:16px 20px 0;border-bottom:1px solid var(--border);}
.panel-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.panel-tabs{display:flex;gap:0;overflow-x:auto;}
.tab{flex-shrink:0;padding:9px 10px;border:none;background:none;color:var(--muted);font-size:.72rem;font-weight:700;font-family:'Nunito',sans-serif;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap;}
.tab.active{color:var(--wa);border-bottom-color:var(--wa);}
.panel-body{padding:18px;flex:1;}
.fgrp{margin-bottom:12px;}
.fgrp label{display:block;font-size:.65rem;font-weight:800;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.8px;}
.fgrp input,.fgrp select,.fgrp textarea{width:100%;padding:8px 11px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);border-radius:8px;color:var(--txt);font-size:.83rem;font-family:'Nunito',sans-serif;outline:none;transition:border-color .2s;}
.fgrp input:focus,.fgrp select:focus,.fgrp textarea:focus{border-color:var(--wa);}
.fgrp textarea{resize:vertical;min-height:70px;line-height:1.5;}
.colors-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
.color-item label{font-size:.63rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:4px;}
.color-row{display:flex;align-items:center;gap:6px;}
.color-row input[type="color"]{width:36px;height:32px;padding:2px;border-radius:6px;cursor:pointer;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);flex-shrink:0;}
.color-row input[type="text"]{flex:1;padding:6px 8px;font-size:.78rem;}
.lang-row{display:flex;gap:8px;}
.lang-check{display:flex;align-items:center;gap:6px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);border-radius:8px;padding:7px 10px;cursor:pointer;font-size:.8rem;font-weight:700;transition:border-color .2s;flex:1;justify-content:center;}
.lang-check:hover{border-color:var(--wa);}
.lang-check.active{border-color:var(--wa);background:rgba(37,211,102,0.08);color:var(--wa);}
.lang-check input{accent-color:var(--wa);width:13px;height:13px;}
.sections-list{display:flex;flex-direction:column;gap:6px;}
.section-item{display:flex;align-items:center;gap:8px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);border-radius:8px;padding:8px 10px;transition:border-color .2s;user-select:none;}
.section-item.dragging{opacity:.4;border-style:dashed;}
.section-item.drag-over{border-color:var(--wa);background:rgba(37,211,102,0.08);}
.drag-handle{cursor:grab;color:var(--muted);font-size:14px;padding:0 2px;}
.section-name{flex:1;font-size:.8rem;font-weight:700;}
.section-toggle{position:relative;width:34px;height:18px;flex-shrink:0;}
.section-toggle input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:rgba(255,255,255,.1);border-radius:18px;cursor:pointer;transition:.3s;}
.toggle-slider:before{content:'';position:absolute;width:14px;height:14px;left:2px;top:2px;background:var(--muted);border-radius:50%;transition:.3s;}
.section-toggle input:checked+.toggle-slider{background:var(--wa);}
.section-toggle input:checked+.toggle-slider:before{transform:translateX(16px);background:#fff;}
/* IMAGE UPLOAD STYLES */
.img-upload-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}
.img-upload-box{background:var(--card2);border:2px dashed rgba(37,211,102,0.2);border-radius:10px;padding:12px;text-align:center;cursor:pointer;transition:all .2s;position:relative;min-height:90px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;}
.img-upload-box:hover{border-color:var(--wa);background:rgba(37,211,102,0.05);}
.img-upload-box.has-img{border-style:solid;border-color:rgba(37,211,102,0.4);}
.img-upload-box input{display:none;}
.img-preview{width:100%;height:60px;object-fit:cover;border-radius:6px;margin-bottom:4px;}
.img-label{font-size:.7rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;}
.img-remove{position:absolute;top:4px;right:4px;background:var(--red);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;display:none;align-items:center;justify-content:center;}
.img-upload-box.has-img .img-remove{display:flex;}
.img-extra-list{display:flex;flex-direction:column;gap:8px;}
.img-extra-item{display:flex;align-items:center;gap:8px;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px;}
.img-extra-thumb{width:48px;height:36px;object-fit:cover;border-radius:5px;flex-shrink:0;}
.img-extra-info{flex:1;min-width:0;}
.img-extra-name{font-size:.75rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.img-extra-label{width:100%;margin-top:4px;padding:3px 6px;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--txt);font-size:.72rem;font-family:'Nunito',sans-serif;}
/* SOURCES TAB */
.upload-area{border:2px dashed rgba(37,211,102,0.2);border-radius:10px;padding:14px;text-align:center;cursor:pointer;transition:all .2s;background:var(--card2);}
.upload-area:hover{border-color:var(--wa);background:rgba(37,211,102,0.05);}
.upload-area input{display:none;}
.url-row{display:flex;gap:8px;margin-top:10px;}
.url-input{flex:1;padding:8px 11px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);border-radius:8px;color:var(--txt);font-size:.83rem;font-family:'Nunito',sans-serif;outline:none;transition:border-color .2s;}
.url-input:focus{border-color:var(--wa);}
.url-btn{padding:8px 14px;background:var(--wa);color:#fff;border:none;border-radius:8px;font-size:.8rem;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;}
.url-btn:hover{background:var(--wa-d);}
.url-btn:disabled{opacity:.5;cursor:not-allowed;}
.doc-list{margin-top:10px;display:flex;flex-direction:column;gap:6px;}
.doc-item{display:flex;align-items:center;gap:8px;background:rgba(37,211,102,0.05);border:1px solid var(--border);border-radius:8px;padding:7px 10px;font-size:.76rem;}
.doc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.doc-remove{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;}
.doc-remove:hover{color:var(--red);}
.doc-status{font-size:.65rem;padding:2px 6px;border-radius:4px;white-space:nowrap;}
.doc-status.done{background:rgba(37,211,102,.15);color:var(--wa);}
.doc-status.extracting{background:rgba(244,161,0,.15);color:var(--gold);}
.doc-status.error{background:rgba(239,68,68,.15);color:var(--red);}
.extracted-box{margin-top:10px;font-size:.75rem;color:var(--muted);background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:160px;overflow-y:auto;line-height:1.6;white-space:pre-wrap;}
/* CHAT */
.chat-area{display:flex;flex-direction:column;height:100%;}
.chat-messages{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;max-height:260px;background:var(--card2);border-radius:10px;margin-bottom:10px;border:1px solid rgba(37,211,102,0.08);}
.chat-msg{max-width:88%;padding:8px 11px;border-radius:12px;font-size:.8rem;line-height:1.5;}
.chat-msg.user{align-self:flex-end;background:var(--wa);color:#fff;border-bottom-right-radius:3px;}
.chat-msg.ai{align-self:flex-start;background:var(--card);border:1px solid var(--border);border-bottom-left-radius:3px;}
.chat-msg.system{align-self:center;background:rgba(37,211,102,0.08);color:var(--muted);font-size:.7rem;border-radius:20px;padding:4px 12px;}
.chat-input-row{display:flex;gap:8px;}
.chat-input{flex:1;padding:8px 11px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.1);border-radius:8px;color:var(--txt);font-size:.83rem;font-family:'Nunito',sans-serif;outline:none;transition:border-color .2s;}
.chat-input:focus{border-color:var(--wa);}
.chat-send{padding:8px 13px;background:var(--wa);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:15px;}
.chat-send:hover{background:var(--wa-d);}
.chat-send:disabled{opacity:.5;cursor:not-allowed;}
/* BUTTONS */
.btn{padding:9px 18px;border-radius:10px;border:none;font-size:.85rem;font-weight:800;cursor:pointer;font-family:'Nunito',sans-serif;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:7px;}
.btn-primary{background:var(--wa);color:#fff;box-shadow:0 4px 12px rgba(37,211,102,.3);}
.btn-primary:hover{background:var(--wa-d);}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;}
.btn-ghost{background:var(--card2);color:var(--muted);border:1px solid var(--border);}
.btn-ghost:hover{color:var(--txt);border-color:var(--wa);}
.btn-sm{padding:6px 11px;font-size:.76rem;}
.action-bar{padding:14px 18px;border-top:1px solid var(--border);display:flex;gap:8px;background:var(--card);}
.preview-panel{display:flex;flex-direction:column;background:#1a1a2e;}
.preview-header{padding:10px 18px;background:var(--card);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;}
.preview-url{flex:1;padding:5px 11px;background:var(--card2);border:1px solid var(--border);border-radius:8px;font-size:.75rem;font-family:'DM Mono',monospace;color:var(--muted);}
.preview-frame{flex:1;border:none;background:#fff;}
.preview-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--muted);}
.preview-empty-icon{font-size:56px;opacity:.3;}
.status-bar{padding:7px 18px;background:var(--card);border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:.72rem;color:var(--muted);font-family:'DM Mono',monospace;}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--muted);}
.status-dot.green{background:var(--wa);box-shadow:0 0 6px var(--wa);}
.status-dot.loading{background:var(--gold);animation:blink .8s infinite;}
.status-dot.error{background:var(--red);}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}
.publish-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:.7rem;font-weight:700;}
.publish-badge.draft{background:rgba(244,161,0,.15);color:var(--gold);}
.publish-badge.live{background:rgba(37,211,102,.15);color:var(--wa);}
.divider{font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 8px;display:flex;align-items:center;gap:8px;}
.divider::after{content:'';flex:1;height:1px;background:var(--border);}
#toast{position:fixed;bottom:24px;right:24px;background:var(--wa);color:#fff;padding:11px 18px;border-radius:10px;font-size:.83rem;font-weight:700;transform:translateY(80px);opacity:0;transition:all .3s;z-index:999;}
#toast.show{transform:translateY(0);opacity:1;}
#toast.error{background:var(--red);}
@media(max-width:900px){.layout{grid-template-columns:1fr;grid-template-rows:auto 1fr;}.panel{max-height:55vh;}.preview-panel{height:45vh;}}
</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="hub.html">Con<span>verdino</span></a>
  <a class="nav-link" href="haendler-session.html">📋 Verfügbarkeit</a>
  <a class="nav-link active" href="#">🌐 Landingpage</a>
  <div class="nav-right">
    <span id="navSlug" style="font-size:.78rem;color:var(--muted);"></span>
    <a class="nav-link" href="hub.html">← Hub</a>
  </div>
</nav>

<div class="layout">
  <div class="panel">
    <div class="panel-header">
      <div class="panel-top">
        <div>
          <div style="font-size:.95rem;font-weight:900;">🌐 Landingpage Builder</div>
          <div style="font-size:.72rem;color:var(--muted);margin-top:1px;">AI-gestützte Seitenerstellung</div>
        </div>
        <div id="publishBadge" class="publish-badge draft">● Draft</div>
      </div>
      <div class="panel-tabs">
        <button class="tab active" onclick="switchTab('settings')">⚙️ Einstellungen</button>
        <button class="tab" onclick="switchTab('sections')">☰ Sections</button>
        <button class="tab" onclick="switchTab('images')">🖼️ Bilder</button>
        <button class="tab" onclick="switchTab('docs')">📄 Quellen</button>
        <button class="tab" onclick="switchTab('chat')">💬 AI Chat</button>
      </div>
    </div>

    <!-- SETTINGS TAB -->
    <div class="panel-body" id="tab-settings">
      <div class="fgrp"><label>Firmenname</label><input type="text" id="companyName" placeholder="z.B. Ynhald Risikomanagement" oninput="saveSettings()"></div>
      <div class="fgrp"><label>Branche</label>
        <select id="industry" onchange="saveSettings()">
          <option value="b2b_consultant">B2B Beratung / Consulting</option>
          <option value="risk_management">Risikomanagement</option>
          <option value="fish_market">Fischmarkt / Lebensmittel</option>
          <option value="restaurant">Restaurant / Gastronomie</option>
          <option value="retail">Einzelhandel</option>
          <option value="service_local">Lokaler Dienstleister</option>
          <option value="tech">Tech / Software</option>
          <option value="other">Sonstiges</option>
        </select>
      </div>
      <div class="fgrp"><label>Kurzbeschreibung</label><textarea id="description" placeholder="Was macht dein Unternehmen?" oninput="saveSettings()"></textarea></div>
      <div class="fgrp"><label>Zielgruppe</label><input type="text" id="targetAudience" placeholder="z.B. KMU, Einkaufsleiter, CFOs" oninput="saveSettings()"></div>
      <div class="fgrp"><label>USP</label><input type="text" id="usp" placeholder="Was macht dich einzigartig?" oninput="saveSettings()"></div>
      <div class="fgrp"><label>Leistungen (kommagetrennt)</label><textarea id="services" placeholder="z.B. Lieferantenbewertung, OSINT Analyse" style="min-height:55px;" oninput="saveSettings()"></textarea></div>
      <div class="fgrp"><label>Call-to-Action</label>
        <select id="cta" onchange="saveSettings()">
          <option value="Beratungsgespräch buchen">Beratungsgespräch buchen</option>
          <option value="Jetzt anfragen">Jetzt anfragen</option>
          <option value="Kostenlos testen">Kostenlos testen</option>
          <option value="Demo anfordern">Demo anfordern</option>
          <option value="Jetzt bestellen">Jetzt bestellen</option>
          <option value="Kontakt aufnehmen">Kontakt aufnehmen</option>
        </select>
      </div>
      <div class="fgrp"><label>WhatsApp</label><input type="text" id="whatsapp" placeholder="+43..." oninput="saveSettings()"></div>
      <div class="fgrp"><label>E-Mail</label><input type="email" id="email" placeholder="office@firma.com" oninput="saveSettings()"></div>
      <div class="fgrp"><label>Buchungslink</label><input type="text" id="bookingLink" placeholder="Calendly, Cal.com..." oninput="saveSettings()"></div>

      <div class="divider">Farben</div>
      <div class="colors-grid">
        <div class="color-item"><label>Primärfarbe</label><div class="color-row"><input type="color" id="color1" value="#1b4332" oninput="syncColor('color1','color1hex');saveSettings()"><input type="text" id="color1hex" value="#1b4332" oninput="syncColorPicker('color1hex','color1');saveSettings()"></div></div>
        <div class="color-item"><label>Sekundärfarbe</label><div class="color-row"><input type="color" id="color2" value="#25D366" oninput="syncColor('color2','color2hex');saveSettings()"><input type="text" id="color2hex" value="#25D366" oninput="syncColorPicker('color2hex','color2');saveSettings()"></div></div>
        <div class="color-item"><label>Akzent 1</label><div class="color-row"><input type="color" id="color3" value="#f4a100" oninput="syncColor('color3','color3hex');saveSettings()"><input type="text" id="color3hex" value="#f4a100" oninput="syncColorPicker('color3hex','color3');saveSettings()"></div></div>
        <div class="color-item"><label>Akzent 2</label><div class="color-row"><input type="color" id="color4" value="#ffffff" oninput="syncColor('color4','color4hex');saveSettings()"><input type="text" id="color4hex" value="#ffffff" oninput="syncColorPicker('color4hex','color4');saveSettings()"></div></div>
      </div>

      <div class="divider">Stil & Sprache</div>
      <div class="fgrp"><label>Stil</label>
        <select id="style" onchange="saveSettings()">
          <option value="modern, professionell, vertrauenswürdig">Modern & Professionell</option>
          <option value="minimalistisch, clean, elegant">Minimalistisch & Elegant</option>
          <option value="bold, dynamisch, modern">Bold & Dynamisch</option>
          <option value="freundlich, warm, einladend">Freundlich & Warm</option>
          <option value="corporate, seriös, formal">Corporate & Seriös</option>
          <option value="luxuriös, premium, exklusiv">Luxuriös & Premium</option>
        </select>
      </div>
      <div class="fgrp"><label>Sprachen (mehrere möglich)</label>
        <div class="lang-row">
          <label class="lang-check active" id="lang-de"><input type="checkbox" value="de" checked onchange="toggleLang(this);saveSettings()"> 🇩🇪 DE</label>
          <label class="lang-check" id="lang-en"><input type="checkbox" value="en" onchange="toggleLang(this);saveSettings()"> 🇬🇧 EN</label>
          <label class="lang-check" id="lang-es"><input type="checkbox" value="es" onchange="toggleLang(this);saveSettings()"> 🇪🇸 ES</label>
        </div>
      </div>
    </div>

    <!-- SECTIONS TAB -->
    <div class="panel-body" id="tab-sections" style="display:none;">
      <p style="font-size:.78rem;color:var(--muted);margin-bottom:12px;line-height:1.5;">Verschiebe Sektionen per Drag & Drop. Toggle zum Aktivieren/Deaktivieren.</p>
      <div class="sections-list" id="sectionsList"></div>
    </div>

    <!-- IMAGES TAB -->
    <div class="panel-body" id="tab-images" style="display:none;">
      <p style="font-size:.78rem;color:var(--muted);margin-bottom:14px;line-height:1.5;">Lade Bilder hoch – die AI platziert sie automatisch an der richtigen Stelle.</p>

      <div class="divider">Logo & Hero</div>
      <div class="img-upload-grid">
        <!-- LOGO -->
        <div class="img-upload-box" id="logoBox" onclick="document.getElementById('logoInput').click()">
          <input type="file" id="logoInput" accept="image/*" onchange="handleImageUpload(event,'logo')">
          <div style="font-size:22px;">🏢</div>
          <div class="img-label">Logo</div>
          <div style="font-size:.68rem;color:var(--muted);">Nav + Footer</div>
          <button class="img-remove" id="logoRemove" onclick="event.stopPropagation();removeImage('logo')">✕</button>
        </div>
        <!-- HERO IMAGE -->
        <div class="img-upload-box" id="heroBox" onclick="document.getElementById('heroInput').click()">
          <input type="file" id="heroInput" accept="image/*" onchange="handleImageUpload(event,'hero')">
          <div style="font-size:22px;">🖼️</div>
          <div class="img-label">Hero Bild</div>
          <div style="font-size:.68rem;color:var(--muted);">Hauptbild / BG</div>
          <button class="img-remove" id="heroRemove" onclick="event.stopPropagation();removeImage('hero')">✕</button>
        </div>
      </div>

      <div class="divider">Weitere Bilder</div>
      <div class="upload-area" onclick="document.getElementById('extraImgInput').click()" style="margin-bottom:10px;">
        <input type="file" id="extraImgInput" accept="image/*" multiple onchange="handleExtraImages(event)">
        <div style="font-size:20px;margin-bottom:4px;">📸</div>
        <div style="font-size:.82rem;font-weight:700;">Team, Produkte, Referenzen</div>
        <div style="font-size:.73rem;color:var(--muted);">Mehrere Bilder gleichzeitig möglich</div>
      </div>
      <div class="img-extra-list" id="extraImgList"></div>

      <div id="imgSummary" style="margin-top:12px;font-size:.75rem;color:var(--muted);background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:10px;display:none;">
        <strong style="color:var(--wa);">✅ Bilder bereit:</strong> <span id="imgCount"></span>
      </div>
    </div>

    <!-- DOCS TAB -->
    <div class="panel-body" id="tab-docs" style="display:none;">
      <p style="font-size:.78rem;color:var(--muted);margin-bottom:12px;line-height:1.5;">Lade Dokumente hoch <strong>oder</strong> gib eine Website-URL ein.</p>
      <div class="fgrp">
        <label>🔗 Website URL analysieren</label>
        <div class="url-row">
          <input type="url" class="url-input" id="urlInput" placeholder="https://www.firma.com" onkeydown="if(event.key==='Enter')extractUrl()">
          <button class="url-btn" id="urlBtn" onclick="extractUrl()">Analysieren</button>
        </div>
      </div>
      <div class="divider">Dokumente</div>
      <div class="upload-area" onclick="document.getElementById('docInput').click()">
        <input type="file" id="docInput" accept=".pdf,.doc,.docx,.txt" multiple onchange="handleDocUpload(event)">
        <div style="font-size:22px;margin-bottom:4px;">📄</div>
        <div style="font-size:.85rem;font-weight:700;margin-bottom:3px;">Dokumente hochladen</div>
        <div style="font-size:.75rem;color:var(--muted);">PDF, Word, TXT</div>
      </div>
      <div class="doc-list" id="docList"></div>
      <div id="extractedPreview" style="display:none;margin-top:12px;">
        <div style="font-size:.65rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px;">Extrahierte Informationen</div>
        <div class="extracted-box" id="extractedText"></div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;" onclick="applyExtracted()">✨ Felder automatisch ausfüllen</button>
      </div>
    </div>

    <!-- CHAT TAB -->
    <div class="panel-body" id="tab-chat" style="display:none;">
      <p style="font-size:.78rem;color:var(--muted);margin-bottom:10px;line-height:1.5;">Beschreibe Änderungen – die AI passt gezielt an.</p>
      <div class="chat-messages" id="chatMessages" style="height:320px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;background:var(--card2);border-radius:10px;border:1px solid rgba(37,211,102,0.08);">
        <div class="chat-msg system">💬 AI Assistent bereit</div>
        <div class="chat-msg ai">Sag mir was du ändern möchtest – z.B. "Mach den Hero Text kürzer", "Ändere Buttons auf Blau" oder "Füge eine FAQ hinzu".</div>
      </div>
    </div>

    <!-- ACTION BAR -->
    <div class="action-bar" id="actionBar">
      <button class="btn btn-primary" style="flex:1" id="generateBtn" onclick="generatePage()">✨ Generieren</button>
      <button class="btn btn-ghost btn-sm" onclick="savePage()" id="saveBtn">💾</button>
      <button class="btn btn-ghost btn-sm" onclick="togglePublish()" id="publishBtn">🌐 Live</button>
    </div>
    <!-- CHAT ACTION BAR (shown when chat tab active) -->
    <div id="chatActionBar" style="display:none;padding:10px 14px;border-top:1px solid var(--border);background:var(--card);gap:8px;align-items:center;">
      <input class="chat-input" id="chatInput" style="flex:1;padding:10px 14px;background:var(--card2);border:1.5px solid rgba(37,211,102,0.2);border-radius:10px;color:var(--txt);font-size:.88rem;font-family:Nunito,sans-serif;outline:none;" placeholder="z.B. Ändere die Buttons auf Blau...">
      <button class="chat-send" id="chatSendBtn" onclick="sendChat()" style="padding:10px 16px;background:var(--wa);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:16px;flex-shrink:0;">➤</button>
    </div>
  </div>

  <!-- PREVIEW PANEL -->
  <div class="preview-panel">
    <div class="preview-header">
      <div style="font-size:.75rem;color:var(--muted);font-family:'DM Mono',monospace;">Vorschau</div>
      <div class="preview-url" id="previewUrl">converdino.com/[slug]</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" onclick="openFullscreen()">⛶ Vollbild</button>
        <button class="btn btn-ghost btn-sm" onclick="copyHtml()">📋 HTML</button>
      </div>
    </div>
    <div id="previewEmpty" class="preview-empty">
      <div class="preview-empty-icon">🌐</div>
      <h3 style="font-size:1rem;font-weight:700;">Noch keine Seite generiert</h3>
      <p style="font-size:.8rem;text-align:center;max-width:260px;line-height:1.6;">Fülle die Einstellungen aus – dann klicke auf Generieren.</p>
      <button class="btn btn-primary" onclick="generatePage()">✨ Jetzt generieren</button>
    </div>
    <iframe id="previewFrame" class="preview-frame" style="display:none;" sandbox="allow-scripts allow-same-origin"></iframe>
    <div class="status-bar">
      <div class="status-dot" id="statusDot"></div>
      <span id="statusText">Bereit</span>
      <span style="margin-left:auto;font-size:.67rem;" id="lastSaved"></span>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
const API = 'https://converto-server-production.up.railway.app';
const params = new URLSearchParams(location.search);
let merchantId   = params.get('mid') || sessionStorage.getItem('merchantId');
let merchantSlug = params.get('m')   || sessionStorage.getItem('merchantSlug') || 'ynhald';
const LS_KEY     = 'lp_settings_' + merchantSlug;

let currentHtml  = '';
let isPublished  = false;
let extractedDocs = [];

// Image storage
const uploadedImages = { logo: null, hero: null, extra: [] };

// ── SECTIONS ──────────────────────────────────────────────
const SECTIONS_DEFAULT = [
  {id:'hero',        icon:'🏠',name:'Hero',         active:true},
  {id:'leistungen',  icon:'⭐',name:'Leistungen',   active:true},
  {id:'ueber-uns',   icon:'👥',name:'Über uns',     active:true},
  {id:'prozess',     icon:'🔄',name:'Prozess',      active:false},
  {id:'statistiken', icon:'📊',name:'Statistiken',  active:false},
  {id:'referenzen',  icon:'🏆',name:'Referenzen',   active:false},
  {id:'pricing',     icon:'💰',name:'Pricing',      active:false},
  {id:'faq',         icon:'❓',name:'FAQ',          active:false},
  {id:'tagesangebot',icon:'🛒',name:'Tagesangebot', active:false},
  {id:'team',        icon:'👤',name:'Team',         active:false},
  {id:'kontakt',     icon:'📞',name:'Kontakt',      active:true},
];
let sections = [...SECTIONS_DEFAULT];

// ── INIT ──────────────────────────────────────────────────
window.onload = async function() {
  document.getElementById('navSlug').textContent = merchantSlug;
  document.getElementById('previewUrl').textContent = 'converdino.com/' + merchantSlug;
  loadSettingsFromLS();
  renderSections();

  try {
    const r = await fetch(API + '/api/merchants/' + merchantSlug);
    const m = await r.json();
    if (m.id) {
      merchantId = m.id;
      sessionStorage.setItem('merchantId', m.id);
      if (!document.getElementById('companyName').value) document.getElementById('companyName').value = m.name || '';
      if (!document.getElementById('whatsapp').value)    document.getElementById('whatsapp').value    = m.wa_number || '';
      saveSettings();
    }
  } catch(e) {}

  if (merchantId) {
    try {
      const r = await fetch(API + '/api/pages/' + merchantId);
      if (r.ok) {
        const p = await r.json();
        if (p && p.html_content) {
          currentHtml = p.html_content;
          isPublished  = p.published;
          if (p.settings_json) loadSettingsObj(p.settings_json);
          if (p.settings_json?.sections_order) loadSectionsFromSaved(p.settings_json.sections_order);
          showPreview(currentHtml);
          updatePublishBadge();
          setStatus('Gespeicherte Seite geladen','green');
          document.getElementById('lastSaved').textContent = 'Letzte Version';
        }
      }
    } catch(e) {}
  }
};

// ── TABS ──────────────────────────────────────────────────
function switchTab(tab) {
  ['settings','sections','images','docs','chat'].forEach(t => {
    document.getElementById('tab-'+t).style.display = t===tab ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach((el,i) => {
    el.classList.toggle('active', ['settings','sections','images','docs','chat'][i]===tab);
  });
  // Show/hide correct action bars
  const isChat = tab === 'chat';
  document.getElementById('actionBar').style.display      = isChat ? 'none' : 'flex';
  const chatBar = document.getElementById('chatActionBar');
  chatBar.style.display = isChat ? 'flex' : 'none';
  if (isChat) {
    setTimeout(() => document.getElementById('chatInput').focus(), 100);
  }
}

// ── LOCALSTORAGE ──────────────────────────────────────────
function saveSettings() {
  localStorage.setItem(LS_KEY, JSON.stringify(getSettingsObj()));
}
function loadSettingsFromLS() {
  try { const r=localStorage.getItem(LS_KEY); if(r) loadSettingsObj(JSON.parse(r)); } catch(e) {}
}
function getSettingsObj() {
  const langs = Array.from(document.querySelectorAll('.lang-check input:checked')).map(c=>c.value);
  return {
    company_name:    document.getElementById('companyName').value,
    industry:        document.getElementById('industry').value,
    description:     document.getElementById('description').value,
    target_audience: document.getElementById('targetAudience').value,
    usp:             document.getElementById('usp').value,
    services:        document.getElementById('services').value,
    cta:             document.getElementById('cta').value,
    whatsapp:        document.getElementById('whatsapp').value,
    email:           document.getElementById('email').value,
    booking_link:    document.getElementById('bookingLink').value,
    color1:          document.getElementById('color1hex').value,
    color2:          document.getElementById('color2hex').value,
    color3:          document.getElementById('color3hex').value,
    color4:          document.getElementById('color4hex').value,
    style:           document.getElementById('style').value,
    languages:       langs,
    sections_order:  sections.map(s=>({id:s.id,active:s.active})),
    sections:        sections.filter(s=>s.active).map(s=>s.name).join(', ')
  };
}
function loadSettingsObj(s) {
  if(!s) return;
  const set=(id,v)=>{if(v!==undefined&&v!==null) document.getElementById(id).value=v;};
  set('companyName',s.company_name); set('industry',s.industry);
  set('description',s.description); set('targetAudience',s.target_audience);
  set('usp',s.usp); set('services',s.services); set('cta',s.cta);
  set('whatsapp',s.whatsapp); set('email',s.email); set('bookingLink',s.booking_link);
  if(s.color1){set('color1hex',s.color1);document.getElementById('color1').value=s.color1;}
  if(s.color2){set('color2hex',s.color2);document.getElementById('color2').value=s.color2;}
  if(s.color3){set('color3hex',s.color3);document.getElementById('color3').value=s.color3;}
  if(s.color4){set('color4hex',s.color4);document.getElementById('color4').value=s.color4;}
  if(s.style) set('style',s.style);
  if(s.languages) {
    document.querySelectorAll('.lang-check input').forEach(cb=>{
      cb.checked=s.languages.includes(cb.value);
      cb.closest('.lang-check').classList.toggle('active',cb.checked);
    });
  }
}
function loadSectionsFromSaved(order) {
  if(!order) return;
  const newSecs=[];
  order.forEach(o=>{const f=SECTIONS_DEFAULT.find(s=>s.id===o.id);if(f) newSecs.push({...f,active:o.active});});
  SECTIONS_DEFAULT.forEach(s=>{if(!newSecs.find(n=>n.id===s.id)) newSecs.push(s);});
  sections=newSecs; renderSections();
}

// ── COLORS ────────────────────────────────────────────────
function syncColor(p,h){document.getElementById(h).value=document.getElementById(p).value;}
function syncColorPicker(h,p){const v=document.getElementById(h).value;if(/^#[0-9A-Fa-f]{6}$/.test(v))document.getElementById(p).value=v;}
function toggleLang(cb){cb.closest('.lang-check').classList.toggle('active',cb.checked);}

// ── SECTIONS DRAG & DROP ──────────────────────────────────
let dragSrc=null;
function renderSections() {
  const list=document.getElementById('sectionsList');
  list.innerHTML='';
  sections.forEach((sec,idx)=>{
    const item=document.createElement('div');
    item.className='section-item'+(sec.active?' active-sec':'');
    item.draggable=true; item.dataset.idx=idx;
    item.innerHTML=`<span class="drag-handle" title="Verschieben">⠿</span><span>${sec.icon}</span><span class="section-name">${sec.name}</span><label class="section-toggle"><input type="checkbox" ${sec.active?'checked':''} onchange="toggleSection(${idx},this.checked)"><span class="toggle-slider"></span></label>`;
    item.addEventListener('dragstart',e=>{dragSrc=idx;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    item.addEventListener('dragend',()=>{item.classList.remove('dragging');document.querySelectorAll('.section-item').forEach(el=>el.classList.remove('drag-over'));});
    item.addEventListener('dragover',e=>{e.preventDefault();item.classList.add('drag-over');});
    item.addEventListener('dragleave',()=>item.classList.remove('drag-over'));
    item.addEventListener('drop',e=>{e.preventDefault();if(dragSrc===null||dragSrc===idx)return;const m=sections.splice(dragSrc,1)[0];sections.splice(idx,0,m);dragSrc=null;renderSections();saveSettings();});
    list.appendChild(item);
  });
}
function toggleSection(idx,checked){sections[idx].active=checked;renderSections();saveSettings();}

// ── IMAGE UPLOAD ──────────────────────────────────────────
function handleImageUpload(event, role) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result.split(',')[1];
    const media_type = file.type || 'image/jpeg';
    uploadedImages[role] = { base64, media_type, role, name: file.name };

    const box = document.getElementById(role+'Box');
    box.classList.add('has-img');

    // Show preview
    let preview = box.querySelector('.img-preview');
    if (!preview) { preview = document.createElement('img'); preview.className='img-preview'; box.insertBefore(preview,box.firstChild); }
    preview.src = e.target.result;

    updateImgSummary();
    showToast('✅ ' + (role==='logo'?'Logo':'Hero Bild') + ' hochgeladen');
  };
  reader.readAsDataURL(file);
  event.target.value='';
}

function removeImage(role) {
  uploadedImages[role] = null;
  const box = document.getElementById(role+'Box');
  box.classList.remove('has-img');
  const preview = box.querySelector('.img-preview');
  if (preview) preview.remove();
  document.getElementById(role+'Input').value='';
  updateImgSummary();
}

function handleExtraImages(event) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64 = e.target.result.split(',')[1];
      const imgObj = { base64, media_type: file.type||'image/jpeg', role:'extra', name:file.name, label:'', id: Date.now()+Math.random() };
      uploadedImages.extra.push(imgObj);
      renderExtraImages();
      updateImgSummary();
    };
    reader.readAsDataURL(file);
  });
  event.target.value='';
}

function renderExtraImages() {
  const list = document.getElementById('extraImgList');
  list.innerHTML = uploadedImages.extra.map((img,i) => `
    <div class="img-extra-item">
      <img class="img-extra-thumb" src="data:${img.media_type};base64,${img.base64}" alt="">
      <div class="img-extra-info">
        <div class="img-extra-name">${img.name}</div>
        <input class="img-extra-label" placeholder="Beschreibung (z.B. Team, Produkt...)" value="${img.label||''}" oninput="uploadedImages.extra[${i}].label=this.value">
      </div>
      <button class="doc-remove" onclick="uploadedImages.extra.splice(${i},1);renderExtraImages();updateImgSummary()">✕</button>
    </div>`).join('');
}

function updateImgSummary() {
  const total = (uploadedImages.logo?1:0) + (uploadedImages.hero?1:0) + uploadedImages.extra.length;
  const summary = document.getElementById('imgSummary');
  if (total > 0) {
    summary.style.display='block';
    const parts=[];
    if(uploadedImages.logo) parts.push('Logo');
    if(uploadedImages.hero) parts.push('Hero');
    if(uploadedImages.extra.length) parts.push(uploadedImages.extra.length+' Weitere');
    document.getElementById('imgCount').textContent = parts.join(', ');
  } else {
    summary.style.display='none';
  }
}

function getAllImages() {
  const imgs = [];
  if (uploadedImages.logo) imgs.push(uploadedImages.logo);
  if (uploadedImages.hero) imgs.push(uploadedImages.hero);
  uploadedImages.extra.forEach(img => imgs.push(img));
  return imgs;
}

// ── URL EXTRACT ───────────────────────────────────────────
async function extractUrl() {
  const urlVal = document.getElementById('urlInput').value.trim();
  if (!urlVal || !urlVal.startsWith('http')) { showToast('⚠️ Gültige URL eingeben', true); return; }
  const btn = document.getElementById('urlBtn');
  btn.disabled=true; btn.textContent='⏳...';
  setStatus('Website wird analysiert...','loading');
  try {
    const res = await fetch(API+'/api/pages/extract-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:urlVal})});
    const data = await res.json();
    if(!data.success) throw new Error(data.error);
    extractedDocs.push({id:'url-'+Date.now(),name:'🔗 '+urlVal.replace('https://','').split('/')[0],extracted:data.extracted,status:'done'});
    renderDocList(); showExtractedPreview();
    document.getElementById('urlInput').value='';
    showToast('✅ Website analysiert!'); setStatus('Website analysiert ✅','green');
    addChatMsg('system','🔗 Website analysiert');
  } catch(e) { setStatus('Fehler: '+e.message,'error'); showToast('⚠️ '+e.message,true); }
  finally { btn.disabled=false; btn.textContent='Analysieren'; }
}

// ── DOC UPLOAD ────────────────────────────────────────────
async function handleDocUpload(event) {
  const files = Array.from(event.target.files);
  for(const file of files) {
    const docId = Date.now()+'-'+file.name;
    extractedDocs.push({id:docId,name:file.name,extracted:null,status:'extracting'});
    renderDocList();
    const reader = new FileReader();
    reader.onload = async function(e) {
      const base64 = e.target.result.split(',')[1];
      try {
        const res = await fetch(API+'/api/pages/extract-doc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base64,media_type:file.type||'application/pdf',filename:file.name})});
        const data = await res.json();
        const doc = extractedDocs.find(d=>d.id===docId);
        if(doc&&data.success){doc.extracted=data.extracted;doc.status='done';}
        else if(doc) doc.status='error';
        renderDocList(); showExtractedPreview();
        if(data.success) showToast('✅ '+file.name+' analysiert');
      } catch(err) {
        const doc=extractedDocs.find(d=>d.id===docId);
        if(doc) doc.status='error';
        renderDocList();
      }
    };
    reader.readAsDataURL(file);
  }
  event.target.value='';
}
function renderDocList() {
  document.getElementById('docList').innerHTML=extractedDocs.map(d=>`
    <div class="doc-item">
      <span>${d.status==='done'?'✅':d.status==='error'?'❌':'⏳'}</span>
      <span class="doc-name">${d.name}</span>
      <span class="doc-status ${d.status}">${d.status==='done'?'Fertig':d.status==='error'?'Fehler':'Lädt...'}</span>
      <button class="doc-remove" onclick="removeDoc('${d.id}')">✕</button>
    </div>`).join('');
}
function removeDoc(id){extractedDocs=extractedDocs.filter(d=>d.id!==id);renderDocList();showExtractedPreview();}
function showExtractedPreview() {
  const all=extractedDocs.filter(d=>d.extracted).map(d=>`[${d.name}]\n${d.extracted}`).join('\n\n---\n\n');
  const box=document.getElementById('extractedPreview');
  if(all){box.style.display='block';document.getElementById('extractedText').textContent=all;}
  else box.style.display='none';
}
function applyExtracted() {
  const all=extractedDocs.filter(d=>d.extracted).map(d=>d.extracted).join('\n\n');
  if(!all) return;
  const line=key=>{const m=all.match(new RegExp(key+'[:\\-]?\\s*(.+)','i'));return m?m[1].trim():'';};
  const fn=line('Firmenname');if(fn&&!document.getElementById('companyName').value)document.getElementById('companyName').value=fn;
  const desc=line('Beschreibung');if(desc)document.getElementById('description').value=desc;
  const tg=line('Zielgruppe');if(tg)document.getElementById('targetAudience').value=tg;
  const usp=line('USP');if(usp)document.getElementById('usp').value=usp;
  const leist=line('Leistungen');if(leist)document.getElementById('services').value=leist;
  const email=line('Email|E-Mail');if(email&&email.includes('@'))document.getElementById('email').value=email;
  saveSettings(); showToast('✅ Felder ausgefüllt!'); switchTab('settings');
}

// ── GENERATE ──────────────────────────────────────────────
async function generatePage() {
  const btn=document.getElementById('generateBtn');
  btn.disabled=true; btn.innerHTML='<div class="spinner"></div> Generiere...';
  setStatus('AI generiert Landingpage...','loading');
  try {
    const settings=getSettingsObj();
    const allExtracted=extractedDocs.filter(d=>d.extracted).map(d=>d.extracted).join('\n\n---\n\n');
    const images=getAllImages();

    const res=await fetch(API+'/api/pages/generate',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({merchant_id:merchantId,settings,extracted_text:allExtracted||null,images:images.length?images:undefined})
    });
    const data=await res.json();
    if(!data.success) throw new Error(data.error||'Generierung fehlgeschlagen');

    currentHtml=data.html;
    showPreview(currentHtml);
    setStatus('Landingpage generiert ✅','green');
    showToast('✨ Landingpage generiert!');
    addChatMsg('system','✨ Neue Landingpage generiert');
    await autoSave();
  } catch(e) {
    setStatus('Fehler: '+e.message,'error');
    showToast('⚠️ '+e.message,true);
  } finally {
    btn.disabled=false; btn.innerHTML='✨ Generieren';
  }
}

// ── PREVIEW ───────────────────────────────────────────────
function showPreview(html) {
  document.getElementById('previewEmpty').style.display='none';
  const frame=document.getElementById('previewFrame');
  frame.style.display='block'; frame.srcdoc=html;
}
function openFullscreen() {
  if(!currentHtml){showToast('⚠️ Erst generieren',true);return;}
  const w=window.open('','_blank'); w.document.write(currentHtml); w.document.close();
}
function copyHtml() {
  if(!currentHtml){showToast('⚠️ Erst generieren',true);return;}
  navigator.clipboard.writeText(currentHtml); showToast('📋 HTML kopiert!');
}

// ── SAVE ──────────────────────────────────────────────────
async function autoSave(){await savePage(true);}
async function savePage(silent) {
  if(!currentHtml){if(!silent)showToast('⚠️ Erst generieren',true);return;}
  if(!merchantId){if(!silent)showToast('⚠️ Merchant ID fehlt',true);return;}
  if(!silent) setStatus('Speichern...','loading');
  try {
    const res=await fetch(API+'/api/pages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({merchant_id:merchantId,slug:merchantSlug,html_content:currentHtml,settings_json:getSettingsObj(),published:isPublished})});
    const data=await res.json();
    if(!data.success) throw new Error(data.error);
    const t=new Date().toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'});
    document.getElementById('lastSaved').textContent='Gespeichert '+t;
    if(!silent){setStatus('Gespeichert ✅','green');showToast('💾 Gespeichert!');}
    else setStatus('Auto-gespeichert ✅','green');
  } catch(e) {
    setStatus('Speichern fehlgeschlagen','error');
    if(!silent) showToast('⚠️ '+e.message,true);
    console.error('Save error:',e.message);
  }
}

// ── PUBLISH ───────────────────────────────────────────────
async function togglePublish() {
  if(!currentHtml){showToast('⚠️ Erst generieren',true);return;}
  isPublished=!isPublished; updatePublishBadge();
  await savePage(true);
  showToast(isPublished?'🌐 Seite ist jetzt LIVE!':'📝 Zurück auf Draft');
}
function updatePublishBadge() {
  const b=document.getElementById('publishBadge');
  b.className='publish-badge '+(isPublished?'live':'draft');
  b.textContent=isPublished?'● Live':'● Draft';
  document.getElementById('publishBtn').textContent=isPublished?'📝 Draft':'🌐 Live';
}

// ── CHAT ──────────────────────────────────────────────────
async function sendChat() {
  const input=document.getElementById('chatInput');
  const msg=input.value.trim();
  if(!msg) return;
  if(!currentHtml){showToast('⚠️ Erst generieren',true);return;}
  input.value=''; addChatMsg('user',msg);
  document.getElementById('chatSendBtn').disabled=true;
  const loadingDiv=document.createElement('div');
  loadingDiv.className='chat-msg ai'; loadingDiv.textContent='⏳ Passe Seite an...';
  document.getElementById('chatMessages').appendChild(loadingDiv);
  document.getElementById('chatMessages').scrollTop=99999;
  setStatus('AI aktualisiert...','loading');
  try {
    const res=await fetch(API+'/api/pages/generate',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({merchant_id:merchantId,settings:getSettingsObj(),prompt:msg,extracted_text:currentHtml})});
    const data=await res.json();
    if(!data.success) throw new Error(data.error);

    // Chat returns JS patch - inject into iframe without replacing full HTML
    const jsCode = data.html;
    const frame = document.getElementById('previewFrame');
    try {
      frame.contentWindow.eval(jsCode);
      loadingDiv.textContent='✅ Änderung angewendet!';
      setStatus('Aktualisiert ✅','green');
      addChatMsg('system','💡 Tipp: Klicke "✨ Generieren" um die Änderungen dauerhaft zu speichern');
    } catch(evalErr) {
      // Fallback: if JS injection fails, try as full HTML
      if (jsCode.includes('<!DOCTYPE') || jsCode.includes('<html')) {
        currentHtml = jsCode; showPreview(currentHtml); await autoSave();
      }
      loadingDiv.textContent='✅ Angewendet!';
      setStatus('Aktualisiert ✅','green');
    }
  } catch(e) {
    loadingDiv.textContent='❌ Fehler: '+e.message;
    setStatus('Fehler','error');
  } finally {
    document.getElementById('chatSendBtn').disabled=false;
    document.getElementById('chatMessages').scrollTop=99999;
  }
}
// Enter key for chat
document.addEventListener('DOMContentLoaded', function() {
  const ci = document.getElementById('chatInput');
  if (ci) ci.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

function addChatMsg(type,text) {
  const msgs=document.getElementById('chatMessages');
  const div=document.createElement('div'); div.className='chat-msg '+type; div.textContent=text;
  msgs.appendChild(div); msgs.scrollTop=msgs.scrollHeight;
}

// ── STATUS & TOAST ────────────────────────────────────────
function setStatus(text,state) {
  document.getElementById('statusText').textContent=text;
  const d=document.getElementById('statusDot');
  d.className='status-dot'+(state==='green'?' green':state==='loading'?' loading':state==='error'?' error':'');
}
function showToast(msg,isError) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=isError?'error':''; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}
</script>
</body>
</html>
