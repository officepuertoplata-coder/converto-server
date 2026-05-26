<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verkaufsauftrag – Converdino</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0f0f0f;
  --surface: #1a1a1a;
  --surface2: #232323;
  --border: #2e2e2e;
  --green: #22c55e;
  --green-dim: #16a34a22;
  --amber: #f59e0b;
  --red: #ef4444;
  --text: #f0f0f0;
  --muted: #707070;
  --radius: 14px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;min-height:100vh;padding-bottom:80px}
h1,h2,h3,.label{font-family:'Syne',sans-serif}

/* HEADER */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
.header .logo{font-family:'Syne',sans-serif;font-weight:800;font-size:1.1rem;letter-spacing:-0.02em}
.header .logo span{color:var(--green)}
.step-indicator{margin-left:auto;display:flex;gap:6px}
.step-dot{width:8px;height:8px;border-radius:50%;background:var(--border);transition:.3s}
.step-dot.active{background:var(--green);box-shadow:0 0 8px var(--green)}
.step-dot.done{background:var(--green);opacity:.4}

/* STEPS */
.step{display:none;padding:20px;max-width:560px;margin:0 auto}
.step.active{display:block}

.step-title{font-size:1.5rem;font-weight:800;margin-bottom:4px}
.step-sub{color:var(--muted);font-size:.875rem;margin-bottom:24px}

/* CARDS */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:12px}
.card-title{font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.card-title .badge{background:var(--green);color:#000;font-size:.65rem;padding:2px 8px;border-radius:99px;font-weight:700}

/* POSITION */
.position-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden}
.position-header{padding:16px 20px;display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none}
.position-num{width:28px;height:28px;border-radius:50%;background:var(--green);color:#000;font-family:'Syne',sans-serif;font-weight:800;font-size:.8rem;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.position-title{font-family:'Syne',sans-serif;font-weight:700;font-size:.95rem;flex:1}
.position-title small{display:block;color:var(--muted);font-size:.75rem;font-weight:400;font-family:'DM Sans',sans-serif}
.position-body{padding:0 20px 20px;display:none}
.position-body.open{display:block}
.position-delete{color:var(--red);font-size:.8rem;cursor:pointer;padding:4px 8px;border-radius:6px;border:1px solid transparent;transition:.2s}
.position-delete:hover{border-color:var(--red);background:#ef444415}

/* FOTO GRID */
.foto-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.foto-thumb{aspect-ratio:1;border-radius:8px;overflow:hidden;position:relative;background:var(--surface2)}
.foto-thumb img{width:100%;height:100%;object-fit:cover}
.foto-thumb .remove-foto{position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:#0009;border:none;color:#fff;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.upload-btn{border:2px dashed var(--border);border-radius:8px;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:6px;transition:.2s;background:transparent;color:var(--muted);font-size:.75rem;font-family:'DM Sans',sans-serif}
.upload-btn:hover{border-color:var(--green);color:var(--green)}
.upload-btn svg{width:20px;height:20px}

/* DOC LIST */
.doc-list{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.doc-item{background:var(--surface2);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;font-size:.8rem}
.doc-icon{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.8rem;flex-shrink:0}
.doc-icon.pdf{background:#ef444420;color:var(--red)}
.doc-icon.txt{background:#3b82f620;color:#60a5fa}
.doc-label{flex:1;color:var(--text)}
.doc-remove{color:var(--muted);cursor:pointer;font-size:.85rem}
.doc-remove:hover{color:var(--red)}

/* NOTIZ */
.notiz-area{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:12px;font-family:'DM Sans',sans-serif;font-size:.875rem;resize:vertical;min-height:80px;outline:none;transition:.2s}
.notiz-area:focus{border-color:var(--green)}

/* PRODUKT WAHL */
.produkt-grid{display:grid;gap:10px}
.produkt-option{background:var(--surface2);border:2px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:.2s;position:relative}
.produkt-option.selected{border-color:var(--green);background:var(--green-dim)}
.produkt-option .produkt-name{font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.produkt-option .produkt-desc{color:var(--muted);font-size:.78rem}
.produkt-option .produkt-preis{position:absolute;top:14px;right:14px;font-family:'Syne',sans-serif;font-weight:800;font-size:.95rem;color:var(--green)}
.duration-select{margin-top:10px;display:none}
.duration-select.visible{display:block}
.duration-tabs{display:flex;gap:6px;flex-wrap:wrap}
.dur-tab{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--muted);font-size:.78rem;cursor:pointer;font-family:'Syne',sans-serif;font-weight:600;transition:.2s}
.dur-tab.active{background:var(--green);border-color:var(--green);color:#000}

/* INPUTS */
.field{margin-bottom:14px}
.field label{display:block;font-size:.78rem;font-weight:600;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.field input,.field textarea,.field select{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:11px 14px;font-family:'DM Sans',sans-serif;font-size:.9rem;outline:none;transition:.2s}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--green)}
.field select option{background:var(--surface2)}

/* BUTTONS */
.btn{display:block;width:100%;padding:16px;border-radius:12px;border:none;font-family:'Syne',sans-serif;font-weight:700;font-size:1rem;cursor:pointer;transition:.2s;text-align:center}
.btn-primary{background:var(--green);color:#000}
.btn-primary:hover{background:#16a34a;transform:translateY(-1px)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed;transform:none}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--green);color:var(--green)}
.btn-add{background:var(--surface2);border:2px dashed var(--border);color:var(--muted);padding:12px;border-radius:10px;font-size:.875rem;font-family:'Syne',sans-serif;font-weight:600;margin-top:8px}
.btn-add:hover{border-color:var(--green);color:var(--green)}

/* PREISBOX */
.preis-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-top:20px}
.preis-row{display:flex;justify-content:space-between;padding:6px 0;font-size:.875rem;color:var(--muted)}
.preis-row.bold{color:var(--text);font-weight:600;font-family:'Syne',sans-serif}
.preis-row.total{color:var(--green);font-size:1.1rem;font-weight:800;font-family:'Syne',sans-serif;padding-top:10px;border-top:1px solid var(--border)}
.preis-divider{border:none;border-top:1px solid var(--border);margin:6px 0}

/* PAYMENT OPTIONS */
.pay-tabs{display:flex;gap:8px;margin-bottom:16px}
.pay-tab{flex:1;padding:10px;border-radius:8px;border:2px solid var(--border);background:var(--surface2);color:var(--muted);font-family:'Syne',sans-serif;font-weight:700;font-size:.8rem;cursor:pointer;transition:.2s;text-align:center}
.pay-tab.active{border-color:var(--green);color:var(--green);background:var(--green-dim)}
.pay-section{display:none}
.pay-section.active{display:block}

/* CODE INPUT */
.code-input{text-align:center;font-family:'Syne',sans-serif;font-weight:800;font-size:1.4rem;letter-spacing:.2em;text-transform:uppercase;background:var(--surface2);border:2px solid var(--border);border-radius:10px;padding:16px;width:100%;color:var(--text);outline:none}
.code-input:focus{border-color:var(--green)}

/* STATUS */
.status-msg{padding:12px 16px;border-radius:8px;font-size:.875rem;margin-bottom:12px;display:none}
.status-msg.success{background:#22c55e20;border:1px solid #22c55e40;color:var(--green);display:block}
.status-msg.error{background:#ef444420;border:1px solid #ef444440;color:var(--red);display:block}
.status-msg.info{background:#3b82f620;border:1px solid #3b82f640;color:#60a5fa;display:block}

/* SPINNER */
.spinner{width:18px;height:18px;border:2px solid #0003;border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}

/* LOADING STATE */
.loading-overlay{position:fixed;inset:0;background:#0f0f0fcc;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:999;gap:12px;backdrop-filter:blur(4px)}
.loading-overlay h2{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--green)}
.loading-overlay p{color:var(--muted);font-size:.875rem}

/* STEP 1 SESSION */
.session-loading{text-align:center;padding:60px 20px}
.session-loading h2{font-family:'Syne',sans-serif;font-size:1.3rem;margin-bottom:8px}
.session-loading p{color:var(--muted);font-size:.875rem}
.phone-display{background:var(--surface2);border-radius:8px;padding:10px 14px;font-size:.875rem;color:var(--muted);margin-bottom:16px}
.phone-display strong{color:var(--text)}
</style>
</head>
<body>

<div class="header">
  <div class="logo">Converter<span>dino</span></div>
  <div class="step-indicator">
    <div class="step-dot active" id="dot-1"></div>
    <div class="step-dot" id="dot-2"></div>
    <div class="step-dot" id="dot-3"></div>
    <div class="step-dot" id="dot-4"></div>
  </div>
</div>

<!-- LOADING -->
<div class="loading-overlay" id="loadingOverlay">
  <div class="spinner" style="width:32px;height:32px;border-width:3px;color:var(--green)"></div>
  <h2>Lade Auftrag…</h2>
  <p>Bitte warten</p>
</div>

<!-- STEP 1: Auftrag laden -->
<div class="step active" id="step1">
  <div class="session-loading" id="sessionLoading">
    <div class="spinner" style="color:var(--green);width:32px;height:32px;border-width:3px"></div>
    <h2 style="margin-top:20px">Lade Auftrag…</h2>
  </div>
  <div id="sessionInfo" style="display:none">
    <div class="step-title">Dein Auftrag</div>
    <div class="step-sub">Füge Fotos, Dokumente und Notizen hinzu</div>
    <div class="phone-display">Auftraggeber: <strong id="phoneDisplay">–</strong></div>
    <button class="btn btn-primary" onclick="goStep(2)">Auftrag befüllen →</button>
  </div>
</div>

<!-- STEP 2: Positionen befüllen -->
<div class="step" id="step2">
  <div class="step-title">Positionen</div>
  <div class="step-sub">Jeder Artikel ist eine eigene Position</div>

  <div id="positionList"></div>

  <button class="btn btn-add" onclick="addPosition()">+ Neue Position</button>

  <div style="margin-top:20px">
    <button class="btn btn-primary" onclick="goStep(3)">Weiter zu Produktwahl →</button>
  </div>
</div>

<!-- STEP 3: Produkte & Dauer wählen -->
<div class="step" id="step3">
  <div class="step-title">Produkte wählen</div>
  <div class="step-sub">Pro Position wählst du welche Leistungen du buchst</div>

  <div id="produktPositionList"></div>

  <div class="preis-box" id="preisBox">
    <div class="preis-row bold" style="margin-bottom:8px">Preisübersicht</div>
    <div id="preisDetails"></div>
    <div class="preis-row total"><span>Gesamt (inkl. 20% MwSt)</span><span id="preisTotal">€ 0,00</span></div>
  </div>

  <div style="margin-top:20px">
    <button class="btn btn-primary" onclick="goStep(4)">Weiter zur Zahlung →</button>
  </div>
</div>

<!-- STEP 4: Zahlung -->
<div class="step" id="step4">
  <div class="step-title">Zahlung</div>
  <div class="step-sub">Wähle eine Zahlungsmethode</div>

  <div class="pay-tabs">
    <div class="pay-tab active" onclick="setPayTab('freicode')">🔓 Freicode</div>
    <div class="pay-tab" onclick="setPayTab('gutschein')">🎫 Gutschein</div>
    <div class="pay-tab" onclick="setPayTab('karte')">💳 Karte</div>
  </div>

  <!-- Freicode -->
  <div class="pay-section active" id="pay-freicode">
    <div class="card">
      <div class="card-title">Freicode eingeben</div>
      <input class="code-input" id="freicodeInput" placeholder="XXXXXXXX" maxlength="10">
      <div id="freicodeMsg" class="status-msg"></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="redeemFreicode()">Freicode einlösen</button>
    </div>
  </div>

  <!-- Gutschein -->
  <div class="pay-section" id="pay-gutschein">
    <div class="card">
      <div class="card-title">Gutscheincode eingeben</div>
      <input class="code-input" id="gutscheinInput" placeholder="GUTSCHEIN" maxlength="20">
      <div id="gutscheinMsg" class="status-msg"></div>
      <button class="btn btn-primary" style="margin-top:14px" onclick="applyGutschein()">Code prüfen & zahlen</button>
    </div>
  </div>

  <!-- Karte -->
  <div class="pay-section" id="pay-karte">
    <div class="card">
      <div class="preis-box" style="background:var(--surface2);margin-bottom:16px">
        <div id="payPreisDetails"></div>
        <div class="preis-row total"><span>Gesamt</span><span id="payTotal">€ 0,00</span></div>
      </div>
      <button class="btn btn-primary" onclick="stripeCheckout()">Jetzt bezahlen →</button>
    </div>
  </div>
</div>

<input type="file" id="fileInput" accept="image/*" multiple style="display:none" onchange="handleFileInput(event)">
<input type="file" id="docFileInput" accept=".pdf,.txt" style="display:none" onchange="handleDocFileInput(event)">

<script>
const API = 'https://converto-server-production.up.railway.app';
let sessionToken = null;
let sessionData = null;
let positions = [];  // [{id, fotos[], docs[], notiz, produkte:{report_days, lp_days, bot_days}}]
let currentPositionIdx = null;  // for file input routing

// ── INIT ──────────────────────────────────────────────
async function init() {
  const params = new URLSearchParams(location.search);
  sessionToken = params.get('s');
  const paid = params.get('paid');

  if (!sessionToken) {
    document.getElementById('sessionLoading').innerHTML = '<p style="color:var(--red)">Kein Auftragslink gefunden. Bitte sende zuerst ein Foto per WhatsApp.</p>';
    return;
  }

  try {
    const r = await fetch(`${API}/api/vk/session/${sessionToken}`);
    const data = await r.json();
    if (!data || data.error) throw new Error(data?.error || 'Session nicht gefunden');
    sessionData = data;

    document.getElementById('phoneDisplay').textContent = data.phone || '–';
    document.getElementById('sessionLoading').style.display = 'none';
    document.getElementById('sessionInfo').style.display = 'block';
    document.getElementById('loadingOverlay').style.display = 'none';

    // Bestehende Artikel laden
    if (data.vk_articles && data.vk_articles.length > 0) {
      for (const art of data.vk_articles) {
        const pos = createPosition();
        pos.articleId = art.id;
        pos.title = art.title || 'Artikel';
        const fotos = (art.vk_photos || []).map(p => ({ id: p.id, url: p.public_url, uploaded: true }));
        pos.fotos = fotos;
        positions[positions.length - 1] = pos;
      }
    } else {
      addPosition();
    }

    if (paid === '1') {
      // Nach Zahlung: direkt zu ergebnis.html
      window.location.href = `ergebnis.html?s=${sessionToken}`;
      return;
    }

  } catch(e) {
    document.getElementById('sessionLoading').innerHTML = `<p style="color:var(--red)">${e.message}</p>`;
    document.getElementById('loadingOverlay').style.display = 'none';
  }
}

// ── POSITIONS ──────────────────────────────────────────
function createPosition() {
  const pos = {
    id: Date.now() + Math.random(),
    articleId: null,
    title: '',
    fotos: [],
    docs: [],
    notiz: '',
    produkte: { report_days: 7, lp_days: 0, bot_days: 0 }
  };
  positions.push(pos);
  renderPositions();
  return pos;
}

function addPosition() {
  createPosition();
}

function renderPositions() {
  const list = document.getElementById('positionList');
  list.innerHTML = '';
  positions.forEach((pos, idx) => {
    const div = document.createElement('div');
    div.className = 'position-card';
    div.innerHTML = `
      <div class="position-header" onclick="togglePosition(${idx})">
        <div class="position-num">${idx + 1}</div>
        <div class="position-title">
          ${pos.title || 'Position ' + (idx + 1)}
          <small>${pos.fotos.length} Foto(s) · ${pos.docs.length} Dok. ${pos.notiz ? '· Notiz' : ''}</small>
        </div>
        ${positions.length > 1 ? `<span class="position-delete" onclick="event.stopPropagation();deletePosition(${idx})">✕</span>` : ''}
      </div>
      <div class="position-body" id="pos-body-${idx}">
        <!-- FOTOS -->
        <div class="card-title" style="margin-bottom:10px">📷 Fotos</div>
        <div class="foto-grid" id="foto-grid-${idx}">
          ${pos.fotos.map((f, fi) => `
            <div class="foto-thumb">
              <img src="${f.url}" loading="lazy">
              <button class="remove-foto" onclick="removeFoto(${idx},${fi})">✕</button>
            </div>
          `).join('')}
          <label class="upload-btn" onclick="openFotoUpload(${idx})">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            Foto
          </label>
        </div>
        <!-- DOKUMENTE -->
        <div class="card-title" style="margin-bottom:10px;margin-top:16px">📎 Dokumente & Notizen</div>
        <div class="doc-list" id="doc-list-${idx}">
          ${pos.docs.map((d, di) => `
            <div class="doc-item">
              <div class="doc-icon ${d.type}">${d.type === 'pdf' ? '📄' : '📝'}</div>
              <div class="doc-label">${d.label}</div>
              <span class="doc-remove" onclick="removeDoc(${idx},${di})">✕</span>
            </div>
          `).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-ghost" style="flex:1;font-size:.8rem;padding:10px" onclick="openDocUpload(${idx})">+ PDF</button>
          <button class="btn btn-ghost" style="flex:1;font-size:.8rem;padding:10px" onclick="openTxtUpload(${idx})">+ TXT</button>
        </div>
        <!-- NOTIZ -->
        <div style="margin-top:14px">
          <div class="card-title" style="margin-bottom:8px">📝 Notiz</div>
          <textarea class="notiz-area" placeholder="Zusätzliche Infos zum Artikel…" onchange="positions[${idx}].notiz=this.value">${pos.notiz}</textarea>
        </div>
      </div>
    `;
    list.appendChild(div);
  });
}

function togglePosition(idx) {
  const body = document.getElementById(`pos-body-${idx}`);
  body.classList.toggle('open');
}

function deletePosition(idx) {
  if (!confirm('Position löschen?')) return;
  positions.splice(idx, 1);
  renderPositions();
}

// ── FOTO UPLOAD ──────────────────────────────────────
function openFotoUpload(idx) {
  currentPositionIdx = idx;
  document.getElementById('fileInput').value = '';
  document.getElementById('fileInput').click();
}

async function handleFileInput(event) {
  const idx = currentPositionIdx;
  const files = Array.from(event.target.files);
  for (const file of files) {
    const base64 = await toBase64(file);
    const ct = file.type || 'image/jpeg';
    try {
      const r = await fetch(`${API}/api/vk/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_token: sessionToken,
          article_id: positions[idx].articleId,
          image_base64: base64.split(',')[1],
          content_type: ct
        })
      });
      const d = await r.json();
      if (d.photo || d.url) {
        positions[idx].fotos.push({ id: d.photo?.id, url: d.photo?.public_url || d.url, uploaded: true });
        if (d.article_id && !positions[idx].articleId) positions[idx].articleId = d.article_id;
        renderPositions();
        // Re-open the toggled body
        setTimeout(() => { const b = document.getElementById(`pos-body-${idx}`); if(b) b.classList.add('open'); }, 50);
      }
    } catch(e) { alert('Foto-Upload fehlgeschlagen: ' + e.message); }
  }
}

function removeFoto(idx, fi) {
  positions[idx].fotos.splice(fi, 1);
  renderPositions();
}

// ── DOC UPLOAD ──────────────────────────────────────
function openDocUpload(idx) {
  currentPositionIdx = idx;
  document.getElementById('docFileInput').setAttribute('accept', '.pdf');
  document.getElementById('docFileInput').value = '';
  document.getElementById('docFileInput').click();
}
function openTxtUpload(idx) {
  currentPositionIdx = idx;
  document.getElementById('docFileInput').setAttribute('accept', '.txt');
  document.getElementById('docFileInput').value = '';
  document.getElementById('docFileInput').click();
}

async function handleDocFileInput(event) {
  const idx = currentPositionIdx;
  const file = event.target.files[0];
  if (!file) return;
  const base64 = await toBase64(file);
  const isPdf = file.name.endsWith('.pdf');
  const artId = positions[idx].articleId;
  if (!artId) { alert('Bitte zuerst Fotos hochladen'); return; }
  try {
    const r = await fetch(`${API}/api/vk/article/${artId}/doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: isPdf ? 'pdf' : 'note',
        label: file.name,
        file_base64: base64.split(',')[1],
        file_name: file.name,
        content_type: file.type,
        session_id: sessionData?.id
      })
    });
    const d = await r.json();
    if (d.success) {
      positions[idx].docs.push({ id: d.doc?.id, type: isPdf ? 'pdf' : 'txt', label: file.name });
      renderPositions();
      setTimeout(() => { const b = document.getElementById(`pos-body-${idx}`); if(b) b.classList.add('open'); }, 50);
    }
  } catch(e) { alert('Dokument-Upload fehlgeschlagen'); }
}

function removeDoc(idx, di) {
  positions[idx].docs.splice(di, 1);
  renderPositions();
}

// ── STEPS ──────────────────────────────────────────
function goStep(n) {
  if (n === 3) renderProduktStep();
  if (n === 4) renderPayStep();
  document.querySelectorAll('.step').forEach((s,i) => s.classList.toggle('active', i === n-1));
  document.querySelectorAll('.step-dot').forEach((d,i) => {
    d.classList.toggle('active', i === n-1);
    d.classList.toggle('done', i < n-1);
  });
  window.scrollTo(0,0);
}

// ── STEP 3: PRODUKTE ──────────────────────────────
function renderProduktStep() {
  const list = document.getElementById('produktPositionList');
  list.innerHTML = '';
  positions.forEach((pos, idx) => {
    const p = pos.produkte;
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <div class="card-title">Position ${idx+1} <span class="badge">${pos.fotos.length} Foto(s)</span></div>
      
      <!-- REPORT (immer dabei) -->
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem">📊 Analyse-Report</div>
            <div style="color:var(--muted);font-size:.78rem">KI-Bewertung deiner Fotos</div>
          </div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;color:var(--green)">€ 1 / 7 Tage</div>
        </div>
        <div class="duration-tabs">
          ${[7,14,21,28].map(d=>`<div class="dur-tab ${p.report_days===d?'active':''}" onclick="setDuration(${idx},'report_days',${d})">${d} Tage</div>`).join('')}
        </div>
      </div>

      <hr style="border-color:var(--border);margin:12px 0">

      <!-- LP -->
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem">🌐 Landingpage</div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" ${p.lp_days>0?'checked':''} onchange="toggleProdukt(${idx},'lp',this.checked)" style="accent-color:var(--green)">
              </label>
            </div>
            <div style="color:var(--muted);font-size:.78rem">Individuelle Verkaufsseite</div>
          </div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;color:${p.lp_days>0?'var(--green)':'var(--muted)'}">€ 1 / 7 Tage</div>
        </div>
        <div class="duration-tabs" id="lp-tabs-${idx}" style="${p.lp_days>0?'':'display:none'}">
          ${[7,14,21,28].map(d=>`<div class="dur-tab ${p.lp_days===d?'active':''}" onclick="setDuration(${idx},'lp_days',${d})">${d} Tage</div>`).join('')}
        </div>
      </div>

      <hr style="border-color:var(--border);margin:12px 0">

      <!-- BOT -->
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:.9rem">🤖 WhatsApp-Bot</div>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="checkbox" ${p.bot_days>0?'checked':''} onchange="toggleProdukt(${idx},'bot',this.checked)" style="accent-color:var(--green)">
              </label>
            </div>
            <div style="color:var(--muted);font-size:.78rem">Digitaler Verkaufsberater</div>
          </div>
          <div style="font-family:'Syne',sans-serif;font-weight:800;color:${p.bot_days>0?'var(--green)':'var(--muted)'}">€ 2 / 7 Tage</div>
        </div>
        <div class="duration-tabs" id="bot-tabs-${idx}" style="${p.bot_days>0?'':'display:none'}">
          ${[7,14,21,28].map(d=>`<div class="dur-tab ${p.bot_days===d?'active':''}" onclick="setDuration(${idx},'bot_days',${d})">${d} Tage</div>`).join('')}
        </div>
      </div>
    `;
    list.appendChild(div);
  });
  updatePreis();
}

function setDuration(idx, field, days) {
  positions[idx].produkte[field] = days;
  renderProduktStep();
}

function toggleProdukt(idx, type, checked) {
  positions[idx].produkte[type + '_days'] = checked ? 7 : 0;
  renderProduktStep();
}

// ── PREISBERECHNUNG ──────────────────────────────
function calcPreis() {
  let net = 0;
  const rows = [];
  positions.forEach((pos, idx) => {
    const p = pos.produkte;
    const rWeeks = Math.max(1, Math.round(p.report_days / 7));
    const rNet = rWeeks * 1.00;
    net += rNet;
    rows.push({ label: `Report Pos. ${idx+1} (${p.report_days} Tage)`, net: rNet });
    if (p.lp_days > 0) {
      const lWeeks = Math.max(1, Math.round(p.lp_days / 7));
      const lNet = lWeeks * 1.00;
      net += lNet;
      rows.push({ label: `Landingpage Pos. ${idx+1} (${p.lp_days} Tage)`, net: lNet });
    }
    if (p.bot_days > 0) {
      const bWeeks = Math.max(1, Math.round(p.bot_days / 7));
      const bNet = bWeeks * 2.00;
      net += bNet;
      rows.push({ label: `Bot Pos. ${idx+1} (${p.bot_days} Tage)`, net: bNet });
    }
  });
  const mwst = Math.round(net * 0.20 * 100) / 100;
  const gross = Math.round((net + mwst) * 100) / 100;
  return { rows, net, mwst, gross };
}

function fmt(v) { return '€ ' + v.toFixed(2).replace('.', ','); }

function updatePreis() {
  const { rows, net, mwst, gross } = calcPreis();
  const html = rows.map(r => `<div class="preis-row"><span>${r.label}</span><span>${fmt(r.net)}</span></div>`).join('') +
    `<div class="preis-row"><span>Netto</span><span>${fmt(net)}</span></div>` +
    `<div class="preis-row"><span>MwSt (20%)</span><span>${fmt(mwst)}</span></div>`;
  document.getElementById('preisDetails').innerHTML = html;
  document.getElementById('preisTotal').textContent = fmt(gross);
}

// ── STEP 4: ZAHLUNG ──────────────────────────────
function renderPayStep() {
  const { rows, net, mwst, gross } = calcPreis();
  const html = `<div class="preis-row"><span>Netto</span><span>${fmt(net)}</span></div>` +
    `<div class="preis-row"><span>MwSt (20%)</span><span>${fmt(mwst)}</span></div>`;
  document.getElementById('payPreisDetails').innerHTML = html;
  document.getElementById('payTotal').textContent = fmt(gross);
}

function setPayTab(tab) {
  document.querySelectorAll('.pay-tab').forEach((t,i) => t.classList.toggle('active', ['freicode','gutschein','karte'][i] === tab));
  document.querySelectorAll('.pay-section').forEach(s => s.classList.remove('active'));
  document.getElementById('pay-' + tab).classList.add('active');
}

// ── FREICODE ──────────────────────────────────────
async function redeemFreicode() {
  const code = document.getElementById('freicodeInput').value.trim().toUpperCase();
  const msg = document.getElementById('freicodeMsg');
  if (!code) { showMsg(msg, 'Bitte Code eingeben', 'error'); return; }
  try {
    const r = await fetch(`${API}/api/vk/freicodes/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, session_id: sessionData?.id })
    });
    const d = await r.json();
    if (d.success) {
      showMsg(msg, '✅ Code eingelöst — Analyse wird gestartet!', 'success');
      setTimeout(() => { window.location.href = `ergebnis.html?s=${sessionToken}`; }, 1500);
    } else {
      showMsg(msg, d.error || 'Code ungültig', 'error');
    }
  } catch(e) { showMsg(msg, 'Fehler: ' + e.message, 'error'); }
}

// ── GUTSCHEIN ──────────────────────────────────────
async function applyGutschein() {
  const code = document.getElementById('gutscheinInput').value.trim().toUpperCase();
  const msg = document.getElementById('gutscheinMsg');
  if (!code) { showMsg(msg, 'Bitte Code eingeben', 'error'); return; }
  const { gross } = calcPreis();
  try {
    const r = await fetch(`${API}/api/vk/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken, coupon_code: code, article_modes: {} })
    });
    const d = await r.json();
    if (d.url) {
      window.location.href = d.url;
    } else if (d.free) {
      window.location.href = `ergebnis.html?s=${sessionToken}`;
    } else {
      showMsg(msg, d.error || 'Code nicht gültig', 'error');
    }
  } catch(e) { showMsg(msg, 'Fehler: ' + e.message, 'error'); }
}

// ── STRIPE ──────────────────────────────────────
async function stripeCheckout() {
  try {
    const produktData = {};
    positions.forEach((pos, idx) => {
      if (pos.articleId) produktData[pos.articleId] = pos.produkte;
    });
    const r = await fetch(`${API}/api/vk/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken, artikel_produkte: produktData })
    });
    const d = await r.json();
    if (d.url) window.location.href = d.url;
    else alert(d.error || 'Fehler beim Checkout');
  } catch(e) { alert('Fehler: ' + e.message); }
}

// ── HELPERS ──────────────────────────────────────
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function showMsg(el, text, type) {
  el.className = 'status-msg ' + type;
  el.textContent = text;
}

// ── START ──────────────────────────────────────
init();
</script>
</body>
</html>
