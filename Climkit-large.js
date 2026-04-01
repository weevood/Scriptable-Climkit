// ============================================================
//  ☀️  Climkit Solar Widget — Medium (24h Chart)
//  Affiche : production solaire (line), conso bâtiment (bars),
//            disponibilité solaire temps réel, fenêtre 24h
//  Refresh : toutes les 15 minutes
// ============================================================

const SITE_ID = "SITE_ID";

// Palette
const COLOR_BG_TOP    = "#0d1117";
const COLOR_BG_BOT    = "#161b22";
const COLOR_SOLAR     = "#f5c518";
const COLOR_CONSO     = "#4a9eff";
const COLOR_SELF      = "#4caf50";
const COLOR_GRID      = "#9b59b6";
const COLOR_TEXT      = "#e6edf3";
const COLOR_MUTED     = "#8b949e";

// Keychain keys
const KC_USER  = "climkit_username";
const KC_PASS  = "climkit_password";
const KC_TOKEN = "climkit_token";
const KC_EXP   = "climkit_token_expiry";

const API_BASE     = "https://api.climkit.io/api/v1";
const MAX_RETRIES  = 3;
const RETRY_DELAY  = 2000;

// ============================================================
//  POINT D'ENTRÉE
// ============================================================

await run();

async function run() {
  log("▶️  Démarrage widget Climkit Medium 24h");

  await ensureCredentials();

  const token = await getValidToken();
  if (!token) {
    await showErrorWidget("Impossible d'obtenir un token Climkit.");
    return;
  }

  const now    = new Date();
  const t24ago = new Date(now.getTime() - 22 * 60 * 60 * 1000);
  const tStart = toUTCIso(t24ago);
  const tEnd   = toUTCIso(now);

  log(`🕐 Fenêtre 24h : ${tStart} → ${tEnd}`);

  log("📡 Requête site_data electricity…");
  const data = await fetchWithRetry(token, SITE_ID, tStart, tEnd);

  if (!data || data.length === 0) {
    log("❌ Données indisponibles");
    await showErrorWidget("Données indisponibles (site_data).");
    return;
  }

  log(`✅ ${data.length} tranches reçues`);

  // ── Totaux 24h : somme directe des kWh de chaque tranche 15 min
  //    L'API retourne déjà des kWh par tranche, pas des kW.
  //    → on additionne simplement, pas besoin de ×4.
  let solarTotal = 0;
  let consoTotal = 0;
  let selfTotal  = 0;
  let toExtTotal = 0;

  // Clamp à 0 dès l'ingestion : valeurs négatives = artefacts API
  const clamp = v => Math.max(0, v ?? 0);

  for (const d of data) {
    const prod    = clamp(d.prod_total);
    const self    = clamp(d.self);
    const fromExt = clamp(d.from_ext);
    const toExt   = clamp(d.to_ext);

    solarTotal += prod;
    selfTotal  += self;
    toExtTotal += toExt;
    consoTotal += self + fromExt;   // consommation = autoconsommé + soutirage réseau
  }

  // Autoconsommation globale sur 24h (%)
  const solarPct = consoTotal > 0
    ? Math.min(100, Math.round((selfTotal / consoTotal) * 100))
    : (solarTotal > 0 ? 100 : 0);

  // Timestamp de la dernière tranche pour le footer
  const last = data[data.length - 1];
  const ts = last?.timestamp
    ? new Date(last.timestamp).toLocaleTimeString("fr-CH", {
        timeZone: "Europe/Zurich",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "--:--";

  log(`🧮 solarTotal=${solarTotal.toFixed(3)} kWh | consoTotal=${consoTotal.toFixed(3)} kWh | toExt=${toExtTotal.toFixed(3)} kWh | selfPct=${solarPct}%`);

  await buildWidget({ data, solarTotal, consoTotal, selfTotal, toExtTotal, solarPct, ts });
}

// ============================================================
//  WIDGET MEDIUM
// ============================================================

async function buildWidget({ data, solarTotal, consoTotal, selfTotal, toExtTotal, solarPct, ts }) {
  const w = new ListWidget();

  const grad = new LinearGradient();
  grad.colors    = [new Color(COLOR_BG_TOP), new Color(COLOR_BG_BOT)];
  grad.locations = [0.0, 1.0];
  grad.startPoint = new Point(0, 0);
  grad.endPoint   = new Point(1, 1);
  w.backgroundGradient = grad;
  w.setPadding(12, 12, 6, 12);

  // ── Ligne métriques centrée : 4 blocs dans un stack horizontal
  //    Chaque bloc est centré verticalement ; on utilise addSpacer(null)
  //    aux deux extrémités pour centrer l'ensemble dans la largeur.
  const metRow = w.addStack();
  metRow.layoutHorizontally();
  metRow.centerAlignContent();
  metRow.spacing = 0;

  // Spacer gauche pour centrage global
  metRow.addSpacer(null);

  addStatBlock(metRow, "☀️ Production", formatKWh(solarTotal), new Color(COLOR_SOLAR));
  addSeparator(metRow);
  addStatBlock(metRow, "🏢 Consomation", formatKWh(consoTotal), new Color(COLOR_CONSO));
  addSeparator(metRow);
  addStatBlock(metRow, "🏭 Injection", formatKWh(toExtTotal), new Color(COLOR_GRID));
  addSeparator(metRow);
  addStatBlock(metRow, "♻️ Auto.", `${solarPct}%`, solarColor(solarPct));

  // Spacer droit pour centrage global
  metRow.addSpacer(null);

  w.addSpacer(6);

  // ── Graphique 24h
  const CHART_HEIGHT = 115;
  const chartImg = await renderChart(data, CHART_HEIGHT);
  if (chartImg) {
    const chartStack = w.addStack();
    chartStack.layoutHorizontally();
    chartStack.centerAlignContent();
    chartStack.addSpacer(null);
    const img = chartStack.addImage(chartImg);
    img.imageSize = new Size(310, CHART_HEIGHT);
    chartStack.addSpacer(null);
  }

  // w.addSpacer(2);

  // // ── Footer
  // const footer = w.addText(`Mise à jour : ${ts}`);
  // footer.font = Font.systemFont(6);
  // footer.textColor = new Color("#ffffff40");
  // footer.centerAlignText();

  if (config.runsInWidget) Script.setWidget(w);
  else w.presentMedium();
  Script.complete();
}

// ============================================================
//  HELPERS MÉTRIQUES
// ============================================================

function addStatBlock(stack, label, value, color) {
  const col = stack.addStack();
  col.layoutVertically();
  col.centerAlignContent();   // centre le texte dans la colonne
  col.spacing = 2;

  const lbl = col.addText(label);
  lbl.font = Font.systemFont(8);
  lbl.textColor = new Color(COLOR_MUTED);
  lbl.centerAlignText();

  const val = col.addText(value);
  val.font = Font.boldSystemFont(10);
  val.textColor = color;
  val.centerAlignText();
}

function addSeparator(stack) {
  stack.addSpacer(8);
  const sep = stack.addText(" ");
  sep.font = Font.systemFont(12);
  sep.textColor = new Color("#ffffff25");
  stack.addSpacer(8);
}

// ============================================================
//  RENDU DU GRAPHIQUE (DrawContext)
// ============================================================

async function renderChart(data, height) {
  const W = 310, H = height;
  const PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 14;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const dc = new DrawContext();
  dc.size  = new Size(W, H);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const n = data.length;
  if (n < 2) return null;

  // Clamp à 0 : les valeurs négatives sont des artefacts API, elles
  // faussent maxVal et décalent visuellement toutes les barres.
  const clamp = v => Math.max(0, v ?? 0);

  const solarVals = data.map(d => clamp(d.prod_total));
  const selfVals  = data.map(d => clamp(d.self));
  const extVals   = data.map(d => clamp(d.from_ext));
  const consoVals = data.map((_, i) => selfVals[i] + extVals[i]);

  const maxVal = Math.max(...solarVals, ...consoVals, 0.01);

  const spacing = chartW / n;
  const barW = Math.max(1.5, spacing - 0.8);

  // Fond
  const bgPath = new Path();
  bgPath.addRect(new Rect(PAD_L, PAD_T, chartW, chartH));
  dc.addPath(bgPath);
  dc.setFillColor(Color.clear());
  dc.fillPath();

  // Grille
  for (let i = 1; i <= 2; i++) {
    const gy = PAD_T + chartH * (1 - i / 2);
    const gp = new Path();
    gp.move(new Point(PAD_L, gy));
    gp.addLine(new Point(W - PAD_R, gy));
    dc.addPath(gp);
    dc.setStrokeColor(new Color("#ffffff15"));
    dc.setLineWidth(0.5);
    dc.strokePath();
  }

  // Axe X
  const basePath = new Path();
  basePath.move(new Point(PAD_L, PAD_T + chartH));
  basePath.addLine(new Point(W - PAD_R, PAD_T + chartH));
  dc.addPath(basePath);
  dc.setStrokeColor(new Color("#ffffff30"));
  dc.setLineWidth(0.5);
  dc.strokePath();

  // Barres empilées : self (vert) + from_ext (rouge HP / orange HC)
  // Heures creuses : 23h-7h et 12h-17h (heure Europe/Zurich)
  for (let i = 0; i < n; i++) {
    const x = PAD_L + i * spacing;
    const baseY = PAD_T + chartH;
    const selfH = (selfVals[i] / maxVal) * chartH;
    const extH  = (extVals[i]  / maxVal) * chartH;

    if (selfH > 0.5) {
      const p = new Path();
      p.addRect(new Rect(x, baseY - selfH, barW, selfH));
      dc.addPath(p);
      dc.setFillColor(new Color("#5cb85c"));
      dc.fillPath();
    }
    if (extH > 0.5) {
      // Déterminer si la tranche est en heure creuse
      const ts = data[i]?.timestamp ? new Date(data[i].timestamp) : null;
      let isOffPeak = false;
      if (ts) {
        const h = parseInt(
          ts.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false }), 10
        );
        // HC : 23h-7h (inclus) et 12h-17h (inclus)
        isOffPeak = (h >= 23 || h < 7) || (h >= 12 && h < 17);
      }
      const p = new Path();
      p.addRect(new Rect(x, baseY - selfH - extH, barW, extH));
      dc.addPath(p);
      dc.setFillColor(new Color(isOffPeak ? "#e67e22" : "#c0392b")); // orange HC, rouge HP
      dc.fillPath();
    }
  }

  // Courbe prod_total : trait continu + points ronds jaunes
  const SOLAR_DOT_THRESHOLD_KWH = 0.04;

  const solarPts = solarVals.map((v, i) => {
    const cx = PAD_L + i * spacing + barW / 2;
    const cy = PAD_T + chartH - (v / maxVal) * chartH;
    return { pt: new Point(cx, cy), active: v >= SOLAR_DOT_THRESHOLD_KWH };
  });

  // Trait : on trace segment par segment, uniquement entre points actifs consécutifs
  if (solarPts.length > 1) {
    let inLine = false;
    const lp = new Path();
    for (let i = 0; i < solarPts.length; i++) {
      const { pt, active } = solarPts[i];
      if (active) {
        if (!inLine) { lp.move(pt); inLine = true; }
        else          { lp.addLine(pt); }
      } else {
        inLine = false;
      }
    }
    dc.addPath(lp);
    dc.setStrokeColor(new Color("#f5c518cc"));
    dc.setLineWidth(2);
    dc.strokePath();
  }

  // Points ronds jaunes uniquement sur les tranches actives
  const dotR = spacing > 5 ? 2.2 : 1.5;
  for (const { pt, active } of solarPts) {
    if (!active) continue;
    const outer = new Path();
    outer.addEllipse(new Rect(pt.x - dotR - 0.8, pt.y - dotR - 0.8, (dotR + 0.8) * 2, (dotR + 0.8) * 2));
    dc.addPath(outer);
    dc.setFillColor(new Color(COLOR_SOLAR));
    dc.fillPath();

    const inner = new Path();
    inner.addEllipse(new Rect(pt.x - dotR, pt.y - dotR, dotR, dotR));
    dc.addPath(inner);
    dc.setFillColor(new Color(COLOR_SOLAR));
    dc.fillPath();
  }

  // Labels axe X toutes les 3h
  for (let i = 0; i < n; i++) {
    if (!data[i]?.timestamp) continue;
    const d = new Date(data[i].timestamp);
    const hour = parseInt(
      d.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false }), 10
    );
    const min = d.getMinutes();
    if (hour % 3 === 0 && min === 0) {
      const lx = PAD_L + i * spacing + barW / 2;
      dc.setFont(Font.systemFont(7));
      dc.setTextColor(new Color("#ffffff50"));
      dc.drawTextInRect(hour === 0 ? "0h" : `${hour}h`, new Rect(lx - 8, H - PAD_B + 1, 16, 10));
    }
  }

  return dc.getImage();
}

// ============================================================
//  FETCH site_data/electricity
// ============================================================

async function fetchWithRetry(token, siteId, tStart, tEnd) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`  [site_data] tentative ${attempt}/${MAX_RETRIES}…`);
    try {
      const data = await fetchSiteData(token, siteId, tStart, tEnd);
      if (data) {
        log(`  [site_data] ✅ ${data.length} tranche(s)`);
        return data;
      }
    } catch (e) {
      log(`  [site_data] ❌ ${e}`);
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY * attempt);
  }
  return null;
}

async function fetchSiteData(token, siteId, tStart, tEnd) {
  const url = `${API_BASE}/site_data/${siteId}/electricity`;
  log(`  → POST ${url}`);

  const req = new Request(url);
  req.method = "POST";
  req.headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
  req.body = JSON.stringify({ t_s: tStart });

  const data = await req.loadJSON();
  log(`  → ${Array.isArray(data) ? data.length + " entrées" : "réponse non-tableau : " + typeof data}`);

  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
}

// ============================================================
//  WIDGET D'ERREUR
// ============================================================

async function showErrorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#0d1117");
  w.setPadding(14, 14, 14, 14);
  const t = w.addText("⚠️ Climkit 24h");
  t.font = Font.boldSystemFont(12);
  t.textColor = Color.white();
  w.addSpacer(6);
  const e = w.addText(msg);
  e.font = Font.systemFont(10);
  e.textColor = new Color("#ff6b6b");
  e.lineLimit = 3;
  if (config.runsInWidget) Script.setWidget(w);
  else w.presentMedium();
  Script.complete();
}

// ============================================================
//  AUTHENTIFICATION & TOKEN
// ============================================================

async function ensureCredentials() {
  if (!Keychain.contains(KC_USER)) {
    const a1 = new Alert();
    a1.title = "Climkit — Username";
    a1.message = "Saisis ton username API Climkit :";
    a1.addTextField("username@exemple.com");
    a1.addAction("Suivant");
    await a1.presentAlert();
    Keychain.set(KC_USER, a1.textFieldValue(0));

    const a2 = new Alert();
    a2.title = "Climkit — Mot de passe";
    a2.message = "Saisis ton mot de passe API Climkit :";
    a2.addSecureTextField("mot de passe");
    a2.addAction("Enregistrer");
    await a2.presentAlert();
    Keychain.set(KC_PASS, a2.textFieldValue(0));
  }
}

async function getValidToken() {
  if (Keychain.contains(KC_TOKEN) && Keychain.contains(KC_EXP)) {
    const expiry = parseInt(Keychain.get(KC_EXP), 10);
    if (Date.now() < expiry - 60_000) {
      log("🔑 Token cache valide");
      return Keychain.get(KC_TOKEN);
    }
    log("🔑 Token expiré, re-auth…");
  }

  const username = Keychain.get(KC_USER);
  const password = Keychain.get(KC_PASS);

  const req = new Request(`${API_BASE}/auth`);
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ username, password });

  try {
    const resp = await req.loadJSON();
    if (!resp.access_token) return null;
    Keychain.set(KC_TOKEN, resp.access_token);
    const exp = resp.valid_until?.$date ?? (Date.now() + 14 * 60 * 1000);
    Keychain.set(KC_EXP, String(exp));
    return resp.access_token;
  } catch (e) {
    log(`❌ Auth exception : ${e}`);
    return null;
  }
}

// ============================================================
//  UTILITAIRES
// ============================================================

function toUTCIso(date) {
  return date.toISOString().replace("Z", "").split(".")[0];
}

function sleep(ms) {
  return new Promise(resolve => Timer.schedule(ms, false, resolve));
}

function log(msg) {
  const time = new Date().toLocaleTimeString("fr-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  console.log(`[${time}] ${msg}`);
}

function formatKWh(kwh) {
  if (kwh >= 1000) return `${(kwh).toFixed(0)} kWh`;
  if (kwh >= 100)  return `${(kwh).toFixed(1)} kWh`;
  if (kwh >= 10)   return `${(kwh).toFixed(2)} kWh`;
  if (kwh >= 1)    return `${(kwh).toFixed(3)} kWh`;
  return `${Math.round(kwh * 1000)} Wh`;
}

function solarColor(pct) {
  if (pct >= 80) return new Color("#4caf50");
  if (pct >= 60) return new Color("#f5c518");
  if (pct >= 40) return new Color("#ff9800");
  return new Color("#f44336");
}