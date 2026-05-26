CONVERDINO — Projektbeschreibung
Was ist Converdino
WhatsApp-basierte Verkaufsplattform. Verkäufer schickt Foto per WhatsApp → erhält Link → befüllt Auftrag → zahlt → KI analysiert → bekommt Verkaufsreport, Landingpage und WhatsApp-Verkaufsberater.
Stack

Backend: Node.js/Express auf Railway (converto-server-production.up.railway.app)
Frontend: HTML-Dateien in officepuertoplata-coder/converto-server GitHub Repo, Railway liefert aus
DB: Supabase
Zahlung: Stripe Live
WhatsApp: Meta Cloud API, +43 677 64118066
KI: Claude Opus (Analyse/DNA), Sonnet (Bot), Haiku (Gruppierung/Markt)
Domain: converdino.com → Railway, p.converdino.com → Railway (Landingpages)

Kern-Flow

Verkäufer schickt Foto per WA → Session wird erstellt → Link zu bericht.html
bericht.html: weitere Fotos, PDFs, TXT-Dateien pro Auftragsposition
Produkte wählen: Report €1, LP €1, Bot €2 — je 7/14/21/28 Tage — für den ganzen Auftrag per Stripe
Nach Zahlung: Opus analysiert → Verkaufsreport mit Titel, Preis min/max, Marktvergleich, Kurz-/Langbeschreibung, Feature-Liste, Wissensbasis
ergebnis.html: Präsentation des Reports, Optimierungsmöglichkeiten (neue Bezeichnungen/Werte eingeben)
Nach Bestätigung: DNA-Erhebung für LP und Bot
LP auf p.converdino.com/p/[slug], Bot per WhatsApp (gleiche Nummer)
Bot-Eskalation: Exit wenn kein Deal oder Ziel "Rückruf Verkaufsleiter" erreicht

Preismodell

Report: €1/7 Tage (Basis)
Landingpage: €1/7 Tage (optional)
Bot: €2/7 Tage (optional, nur mit LP)
Buchbar: 7/14/21/28 Tage
Zahlung: Stripe, gesamter Auftrag auf einmal
Business-Rabatt: 100% = kostenlos (Freicodes oder Business-Account)
ACHTUNG: Preismodell ist im Code noch NICHT umgesetzt — bericht.html und server.js verwenden noch das alte foto-basierte Modell

Fragekatalog

Wenn Verkäufer keine Infos liefert: automatisch kategoriespezifische Standardfragen
Ziel: Wissensbasis für Bot-DNA vervollständigen

Business-Kunden

Alexanders Kunden denen er das Service verkauft
Haben eigene Nummer, Firmenrabatt, LP/Bot aktiviert
Verwaltet in vk_business_discounts
Freicodes (vk_freicodes) für kostenlose Einzelaufträge

Admin (vk-admin.html)

Nur Alexander
Aufträge, Gutscheine, Business-Kunden, Freicodes, Bot-Training, Sandbox

QR-Codes

Zum Quittieren von Lieferungen (noch nicht fertig implementiert)

GitHub Repos

converto-server: Backend + Frontend (alles)
sosuapesce: altes Projekt, wird nicht mehr gebraucht

Offene Baustellen

Preismodell in bericht.html + server.js umstellen
ergebnis.html entrümpeln
vk-admin.html neu aufbauen
Fragekatalog kategoriespezifisch machen
QR-Code Lieferquittierung fertigstellen


Passt das so? Dann legst du in Claude ein Projekt an, kopierst das rein — und ich habe beim nächsten Chat sofort den vollen Kontext.
