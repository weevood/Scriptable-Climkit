// ============================================================
//  ☀️  Climkit Solar Widget — Medium (24h Chart)
//  Affiche : production solaire (line), conso bâtiment (bars),
//            disponibilité solaire temps réel, fenêtre 24h
//  Refresh : toutes les 15 minutes
// ============================================================
//
//  CONFIGURATION — à remplir une seule fois
//  -----------------------------------------------------------
//  Mêmes identifiants que le widget small. Les credentials
//  Keychain sont partagés entre les deux scripts.
// ============================================================

const SITE_ID = "SITE_ID";

// Palette
const COLOR_BG_TOP    = "#0d1117";
const COLOR_BG_BOT    = "#161b22";
const COLOR_SOLAR     = "#f5c518"; // ambre solaire
const COLOR_CONSO     = "#4a9eff"; // bleu conso
const COLOR_SELF      = "#4caf50"; // vert autoconso
const COLOR_GRID      = "#ffffff15";
const COLOR_TEXT      = "#e6edf3";
const COLOR_MUTED     = "#8b949e";
const COLOR_SOLAR_BG  = "#f5c51820";
const COLOR_CONSO_BG  = "#4a9eff20";

// Keychain keys (partagés avec le widget small)
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

  // Fenêtre 24h glissantes
  const now    = new Date();
  const t24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const tStart = toUTCIso(t24ago);
  const tEnd   = toUTCIso(now);

  log(`🕐 Fenêtre 24h : ${tStart} → ${tEnd}`);

  // Requête site_data/electricity (prod_total, from_ext, self)
  log("📡 Requête site_data electricity…");
  const data = await fetchWithRetry(token, SITE_ID, tStart, tEnd);

  if (!data || data.length === 0) {
    log("❌ Données indisponibles");
    await showErrorWidget("Données indisponibles (site_data).");
    return;
  }

  log(`✅ ${data.length} tranches reçues`);

  // Dernière tranche = état actuel
  const last = data[data.length - 1];
  const solarNow = last?.prod_total ?? 0;   // kWh sur 15 min
  const consoNow = (last?.from_ext ?? 0) + (last?.self ?? 0);
  const selfNow  = last?.self ?? 0;

  // Conversion en watts instantanés (×4 pour 15min→h, ×1000 pour kW→W)
  const solarW = Math.round(solarNow * 4 * 1000);
  const consoW = Math.round(consoNow * 4 * 1000);
  const selfW  = Math.round(selfNow  * 4 * 1000);

  // Disponibilité solaire : production > seuil minimal (20W)
  const solarAvailable = solarW >= 20;
  const solarPct = consoNow > 0
    ? Math.min(100, Math.round((selfNow / consoNow) * 100))
    : (solarW > 0 ? 100 : 0);

  const ts = last?.timestamp
    ? new Date(last.timestamp).toLocaleTimeString("fr-CH", {
        timeZone: "Europe/Zurich",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "--:--";

  log(`🧮 solarW=${solarW} consoW=${consoW} selfPct=${solarPct}% available=${solarAvailable}`);

  await buildWidget({ data, solarW, consoW, selfW, solarPct, solarAvailable, ts });
}

// ============================================================
//  WIDGET MEDIUM
// ============================================================

async function buildWidget({ data, solarW, consoW, selfW, solarPct, solarAvailable, ts }) {
  const w = new ListWidget();

  // Fond dégradé sombre
  const grad = new LinearGradient();
  grad.colors    = [new Color(COLOR_BG_TOP), new Color(COLOR_BG_BOT)];
  grad.locations = [0.0, 1.0];
  grad.startPoint = new Point(0, 0);
  grad.endPoint   = new Point(1, 1);
  w.backgroundGradient = grad;
  w.setPadding(14, 14, 10, 14);

  // ── Ligne du haut : titre + badge solaire
  const topRow = w.addStack();
  topRow.layoutHorizontally();
  topRow.centerAlignContent();

  const titleTxt = topRow.addText("⚡ Énergie · 24h");
  titleTxt.font = Font.boldSystemFont(11);
  titleTxt.textColor = new Color(COLOR_TEXT);

  topRow.addSpacer(null);

  // Badge "Solaire dispo / indispo"
  const badgeColor = solarAvailable ? "#4caf5030" : "#f4433630";
  const badgeTxtColor = solarAvailable ? "#4caf50" : "#f44336";
  const badgeTxt = solarAvailable ? "☀️ Disponible" : "🌑 Indisponible";
  const badge = topRow.addText(badgeTxt);
  badge.font = Font.boldSystemFont(9);
  badge.textColor = new Color(badgeTxtColor);

  w.addSpacer(6);

  // ── Ligne métriques : Solaire | Conso | % Auto
  const metRow = w.addStack();
  metRow.layoutHorizontally();
  metRow.centerAlignContent();

  addStatBlock(metRow, "☀️ Solaire", formatW(solarW), new Color(COLOR_SOLAR));
  metRow.addSpacer(null);
  const sep1 = metRow.addText("·");
  sep1.font = Font.systemFont(16);
  sep1.textColor = new Color("#ffffff25");
  metRow.addSpacer(null);
  addStatBlock(metRow, "🏠 Conso", formatW(consoW), new Color(COLOR_CONSO));
  metRow.addSpacer(null);
  const sep2 = metRow.addText("·");
  sep2.font = Font.systemFont(16);
  sep2.textColor = new Color("#ffffff25");
  metRow.addSpacer(null);
  addStatBlock(metRow, "♻️ Auto", `${solarPct}%`, new Color(COLOR_SELF));

  w.addSpacer(8);

  // ── Graphique 24h
  const chartImg = await renderChart(data);
  if (chartImg) {
    const chartStack = w.addStack();
    chartStack.layoutHorizontally();
    chartStack.addSpacer(null);
    const img = chartStack.addImage(chartImg);
    img.imageSize = new Size(310, 80);
    chartStack.addSpacer(null);
  }

  w.addSpacer(4);

  // ── Footer
  const footer = w.addText(`Mise à jour : ${ts} · climkit.io`);
  footer.font = Font.systemFont(7);
  footer.textColor = new Color("#ffffff40");
  footer.centerAlignText();

  if (config.runsInWidget) Script.setWidget(w);
  else w.presentMedium();
  Script.complete();
}

// ============================================================
//  RENDU DU GRAPHIQUE (DrawContext)
//  Barres empilées : self (vert bas) + from_ext (rouge dessus)
//  Courbe pointillée : prod_total (jaune ambre, points ronds)
// ============================================================

async function renderChart(data) {
  const W = 310, H = 80;
  const PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 14;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const dc = new DrawContext();
  dc.size  = new Size(W, H);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const n = data.length;
  if (n < 2) return null;

  // ── Valeurs brutes en kWh (on garde kWh, pas de conversion watts)
  //    pour rester cohérent avec le graphique de référence
  const solarVals  = data.map(d => d.prod_total ?? 0);
  const selfVals   = data.map(d => d.self        ?? 0);
  const extVals    = data.map(d => d.from_ext    ?? 0);
  const consoVals  = data.map((_, i) => selfVals[i] + extVals[i]);

  // ── Échelle commune (max entre prod et conso)
  const maxVal = Math.max(
    ...solarVals, ...consoVals, 0.01
  );

  const spacing = chartW / n;
  // Barres légèrement espacées comme dans le graphique de référence
  const barW = Math.max(1.5, spacing - 0.8);

  // ── Fond sombre du chart (optionnel, renforce le contraste)
  const bgPath = new Path();
  bgPath.addRect(new Rect(PAD_L, PAD_T, chartW, chartH));
  dc.addPath(bgPath);
  dc.setFillColor(new Color("#00000030"));
  dc.fillPath();

  // ── Lignes de grille horizontales (2 niveaux)
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

  // ── Ligne de base (axe X)
  const basePath = new Path();
  basePath.move(new Point(PAD_L, PAD_T + chartH));
  basePath.addLine(new Point(W - PAD_R, PAD_T + chartH));
  dc.addPath(basePath);
  dc.setStrokeColor(new Color("#ffffff30"));
  dc.setLineWidth(0.5);
  dc.strokePath();

  // ── Barres empilées : self (vert) en bas, from_ext (rouge) au dessus
  for (let i = 0; i < n; i++) {
    const x = PAD_L + i * spacing;
    const baseY = PAD_T + chartH;

    const selfH = (selfVals[i] / maxVal) * chartH;
    const extH  = (extVals[i]  / maxVal) * chartH;

    // Barre self (verte, en bas)
    if (selfH > 0.5) {
      const rSelf = new Rect(x, baseY - selfH, barW, selfH);
      const pSelf = new Path();
      pSelf.addRect(rSelf);
      dc.addPath(pSelf);
      dc.setFillColor(new Color("#5cb85c"));
      dc.fillPath();
    }

    // Barre from_ext (rouge, empilée au dessus de self)
    if (extH > 0.5) {
      const rExt = new Rect(x, baseY - selfH - extH, barW, extH);
      const pExt = new Path();
      pExt.addRect(rExt);
      dc.addPath(pExt);
      dc.setFillColor(new Color("#c0392b"));
      dc.fillPath();
    }
  }

  // ── Courbe prod_total : points ronds jaunes reliés par un trait fin
  //    (style identique au graphique de référence : dots + ligne)
  const solarPts = solarVals.map((v, i) => {
    const cx = PAD_L + i * spacing + barW / 2;
    const cy = PAD_T + chartH - (v / maxVal) * chartH;
    return new Point(cx, cy);
  });

  // Trait fin reliant les points
  if (solarPts.length > 1) {
    const lp = new Path();
    lp.move(solarPts[0]);
    for (let i = 1; i < solarPts.length; i++) {
      lp.addLine(solarPts[i]);
    }
    dc.addPath(lp);
    dc.setStrokeColor(new Color("#f5c518cc"));
    dc.setLineWidth(1.2);
    dc.strokePath();
  }

  // Points ronds jaunes (rayon adapté à la densité)
  const dotR = spacing > 5 ? 2.2 : 1.5;
  for (const pt of solarPts) {
    // Contour sombre pour contraster sur les barres
    const outer = new Path();
    outer.addEllipse(new Rect(pt.x - dotR - 0.8, pt.y - dotR - 0.8, (dotR + 0.8) * 2, (dotR + 0.8) * 2));
    dc.addPath(outer);
    dc.setFillColor(new Color("#1a1a1a"));
    dc.fillPath();

    // Disque jaune
    const inner = new Path();
    inner.addEllipse(new Rect(pt.x - dotR, pt.y - dotR, dotR * 2, dotR * 2));
    dc.addPath(inner);
    dc.setFillColor(new Color("#f5c518"));
    dc.fillPath();
  }

  // ── Labels axe X : toutes les 6h
  for (let i = 0; i < n; i++) {
    if (!data[i]?.timestamp) continue;
    const d = new Date(data[i].timestamp);
    const hour = parseInt(
      d.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false }),
      10
    );
    const min = d.getMinutes();
    if (hour % 6 === 0 && min === 0) {
      const lx = PAD_L + i * spacing + barW / 2;
      dc.setFont(Font.systemFont(7));
      dc.setTextColor(new Color("#ffffff50"));
      dc.drawTextInRect(
        hour === 0 ? "0h" : `${hour}h`,
        new Rect(lx - 8, H - PAD_B + 1, 16, 10)
      );
    }
  }

  return dc.getImage();
}

// ============================================================
//  HELPER : bloc stat
// ============================================================

function addStatBlock(stack, label, value, color) {
  const col = stack.addStack();
  col.layoutVertically();
  col.spacing = 1;

  const lbl = col.addText(label);
  lbl.font = Font.systemFont(8);
  lbl.textColor = new Color(COLOR_MUTED);

  const val = col.addText(value);
  val.font = Font.boldSystemFont(13);
  val.textColor = color;
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
  req.body = JSON.stringify({
    t_s: tStart,
    t_e: tEnd,
    sampling_frequency: "15T",
  });

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
//  AUTHENTIFICATION & TOKEN (identique au widget small)
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

function formatW(watts) {
  if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${watts} W`;
}