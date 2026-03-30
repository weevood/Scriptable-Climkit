// ============================================================
//  ☀️  Climkit Solar Widget — Scriptable
//  Affiche : production solaire, consommation appart, % solaire
//  Refresh : toutes les 15 minutes (cadence des données Climkit)
// ============================================================
//
//  CONFIGURATION — à remplir une seule fois
//  -----------------------------------------------------------
//  1. Lance ce script une première fois : il te demandera ton
//     username et password Climkit API, puis les stockera dans
//     le Keychain iOS de façon sécurisée.
//  2. Remplace SITE_ID, METER_APPART, METER_SOLAR et DAILY_KWH 
//     ci-dessous.
// ============================================================

const SITE_ID       = "SITE_ID";
const METER_APPART  = "METER_APPART";   // compteur appart
const METER_SOLAR   = "METER_SOLAR";   // production PV

// Tarifs en CHF/kWh (consommation réseau uniquement, hors solaire)
const DAILY_KWH = 4.5;    // Estimated daily average
const TARIF_HT  = 0.2921; // Électricité du réseau - Tarif standard
const TARIF_BT  = 0.1834; // Électricité du réseau - Tarif réduit 
const TARIF_SOL = 0.17;   // Energie solaire - Heures Creuses (HC)

// Retry
const MAX_RETRIES     = 3;
const RETRY_DELAY_MS  = 2000; // attente entre chaque tentative
const API_BASE        = "https://api.climkit.io/api/v1";

// Keychain keys (ne pas modifier)
const KC_USER  = "climkit_username";
const KC_PASS  = "climkit_password";
const KC_TOKEN = "climkit_token";
const KC_EXP   = "climkit_token_expiry";

// ============================================================
//  POINT D'ENTRÉE
// ============================================================

await run();

async function run() {
  log("▶️  Démarrage du widget Climkit");

  await ensureCredentials();

  const token = await getValidToken();
  if (!token) {
    log("❌ Échec de l'authentification — token null");
    await showErrorWidget("Impossible d'obtenir un token Climkit.");
    return;
  }
  log("✅ Token obtenu");

  const now    = new Date();
  const tEnd   = toUTCIso(now);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const tStart   = toUTCIso(midnight);
  log(`🕐 Fenêtre de requête : ${tStart} → ${tEnd} (UTC)`);

  // Requêtes séquentielles avec retry (évite les timeouts en parallèle)
  log("📡 Requête meter appart…");
  const appart = await fetchWithRetry(token, METER_APPART, tStart, null, "appart");
  // const appart = [{"ext":0.028,"timestamp":"2026-03-22 05:30:00+01:00","self":0.001,"total":0.029},{"ext":0.02,"timestamp":"2026-03-22 05:45:00+01:00","self":0,"total":0.02},{"ext":0.022,"timestamp":"2026-03-22 06:00:00+01:00","self":0,"total":0.022},{"ext":0.028,"timestamp":"2026-03-22 06:15:00+01:00","self":0,"total":0.028},{"ext":0.029,"timestamp":"2026-03-22 06:30:00+01:00","self":0,"total":0.029},{"ext":0.027,"timestamp":"2026-03-22 06:45:00+01:00","self":0,"total":0.027},{"ext":0.022,"timestamp":"2026-03-22 07:00:00+01:00","self":0,"total":0.022},{"ext":0.037,"timestamp":"2026-03-22 07:15:00+01:00","self":0,"total":0.037},{"ext":0.054,"timestamp":"2026-03-22 07:30:00+01:00","self":0,"total":0.054},{"ext":0.065,"timestamp":"2026-03-22 07:45:00+01:00","self":0,"total":0.065},{"ext":0.045,"timestamp":"2026-03-22 08:00:00+01:00","self":0,"total":0.045}]
  await sleep(1000);

  log("📡 Requête meter solaire…");
  const solar  = await fetchWithRetry(token, METER_SOLAR,  tStart, null, "solaire");
  // const solar = [{"total":0,"timestamp":"2026-03-22 05:30:00+01:00"},{"total":0,"timestamp":"2026-03-22 05:45:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:00:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:15:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:30:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:45:00+01:00"},{"total":0,"timestamp":"2026-03-22 07:00:00+01:00"},{"total":0,"timestamp":"2026-03-22 07:15:00+01:00"},{"total":0.004,"timestamp":"2026-03-22 07:30:00+01:00"},{"total":0.008,"timestamp":"2026-03-22 07:45:00+01:00"},{"total":0.024,"timestamp":"2026-03-22 08:00:00+01:00"}]
  await sleep(1000);

  if (!appart) {
    log("❌ Données appart indisponibles après retries");
    await showErrorWidget("Données appart indisponibles.");
    return;
  }
  if (!solar) {
    log("❌ Données solaire indisponibles après retries");
    await showErrorWidget("Données solaire indisponibles.");
    return;
  }

  const lastAppart = appart[appart.length - 1];
  const lastSolar  = solar[solar.length - 1];
  const prevAppart = appart[appart.length - 2];
  const prevSolar  = solar[solar.length - 2];

  log(`📦 Dernière tranche appart : ${JSON.stringify(lastAppart)}`);
  log(`📦 Dernière tranche solaire : ${JSON.stringify(lastSolar)}`);

  const consoKwh = lastAppart?.total ?? 0;
  const solarKwh = lastSolar?.total  ?? 0;
  const selfKwh  = lastAppart?.self  ?? 0;

  const prevConsoKwh = prevAppart?.total ?? 0;
  const prevSolarKwh = prevSolar?.total  ?? 0;

  // Tendance solaire : ↑ vert si production monte, ↓ rouge si baisse
  const solarTrend = solarKwh > prevSolarKwh ? "up"
                   : solarKwh < prevSolarKwh ? "down"
                   : "flat";

  // Tendance conso : ↑ rouge si on consomme plus, ↓ vert si on consomme moins
  const consoTrend = consoKwh > prevConsoKwh ? "up"
                   : consoKwh < prevConsoKwh ? "down"
                   : "flat";

  log(`🧮 solarTrend=${solarTrend} (prev=${prevSolarKwh} → cur=${solarKwh})`);
  log(`🧮 consoTrend=${consoTrend} (prev=${prevConsoKwh} → cur=${consoKwh})`);

  const solarPct = consoKwh > 0
    ? Math.min(100, Math.round((selfKwh / consoKwh) * 100))
    : 0;

  const consoW = Math.round(consoKwh * 4 * 1000);
  const solarW = Math.round(solarKwh * 4 * 1000);

  log(`🧮 consoKwh=${consoKwh} solarKwh=${solarKwh} selfKwh=${selfKwh}`);
  log(`🧮 consoW=${consoW}W solarW=${solarW}W solarPct=${solarPct}%`);

  // Somme de toutes les tranches du jour pour la progression journalière
  const consoTodayKwh = Math.round(
    appart.reduce((sum, d) => sum + (d.total ?? 0), 0) * 100
  ) / 100;
  log(`🧮 consoTodayKwh=${consoTodayKwh} kWh`);

  // ── Calcul du coût journalier (réseau uniquement, hors solaire)
  const costResult = computeDailyCost(appart);
  const { totalCost, htKwh, btKwh, solKwh, htCost, btCost, solCost } = costResult;

  log(`💰 Conso réseau HT : ${htKwh.toFixed(3)} kWh × ${TARIF_HT} CHF = ${htCost.toFixed(4)} CHF`);
  log(`💰 Conso réseau BT : ${btKwh.toFixed(3)} kWh × ${TARIF_BT} CHF = ${btCost.toFixed(4)} CHF`);
  log(`💰 Conso solaire   : ${solKwh.toFixed(3)} kWh × ${TARIF_SOL} CHF = ${solCost.toFixed(4)} CHF`);
  log(`💰 Coût total      : ${totalCost.toFixed(4)} CHF`);

    await showErrorWidget("Données indisponibles (site_data).");
    return;
  }

  log(`✅ ${data.length} tranches reçues`);

  // Dernière tranche = état actuel
  const last = data[data.length - 1];
  const solarNow = (last?.prod_total * 1000) ?? 0; // watts
  const consoNow = (last?.conso_total * 1000) ?? 0; // kw
  const wattsDispo = Math.max(0, solarNow - consoNow);
  log(`📦 Dernière tranche : ${JSON.stringify(last)}`);
  log(`🏭 Production totale instantanée : ${formatW(solarNow)}`);
  log(`♨️ Consomation totale instantanée : ${formatW(consoNow)}`);

  const ts = lastAppart?.timestamp
    ? new Date(lastAppart.timestamp).toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })
    : "--:--";

  log(`✅ Rendu widget — ts=${ts}`);
  await buildWidget({ consoW, solarW, solarPct, ts, consoTodayKwh, solarTrend, consoTrend, totalCost, wattsDispo });
}

// ============================================================
//  CALCUL DU COÛT JOURNALIER
//  Pour chaque tranche 15min : on déduit la part solaire (self)
//  puis on applique le tarif HT ou BT selon l'heure du timestamp.
// ============================================================

function computeDailyCost(appartData) {
  let htKwh = 0;
  let btKwh = 0;
  let solKwh = 0;

  for (const d of appartData) {
    const selfKwh = d.self ?? 0;                              // part solaire autoconsommée
    const netKwh  = Math.max(0, (d.total ?? 0) - selfKwh);    // part réseau uniquement
    
    solKwh += selfKwh;

    if (netKwh === 0) continue;

    const hour = getHourZurich(d.timestamp);
    const isBT = hour >= 23 || hour < 7 || (hour >= 12 && hour < 17);

    if (isBT) {
      btKwh += netKwh;
    } else {
      htKwh += netKwh;
    }
  }

  const htCost  = htKwh  * TARIF_HT;
  const btCost  = btKwh  * TARIF_BT;
  const solCost = solKwh * TARIF_SOL;
  const totalCost = htCost + btCost + solCost;

  return { totalCost, htKwh, btKwh, solKwh, htCost, btCost, solCost };
}

// Retourne l'heure locale Zurich (0–23) depuis un timestamp Climkit
// Format attendu : "2026-03-22 07:30:00+01:00" ou ISO
function getHourZurich(timestamp) {
  if (!timestamp) return 0;
  const d = new Date(timestamp);
  return parseInt(
    d.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false }),
    10
  );
}

// ============================================================
//  FETCH AVEC RETRY
// ============================================================

async function fetchWithRetry(token, meterId, tStart, tEnd, label) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`  [${label}] tentative ${attempt}/${MAX_RETRIES}…`);
    try {
      const data = await fetchMeterData(token, meterId, tStart, tEnd);
      if (data) {
        log(`  [${label}] ✅ ${data.length} tranche(s) reçue(s)`);
        return data;
      }
      log(`  [${label}] ⚠️ Réponse vide ou invalide`);
    } catch(e) {
      log(`  [${label}] ❌ Exception : ${e}`);
    }

    if (attempt < MAX_RETRIES) {
      log(`  [${label}] ⏳ Attente ${RETRY_DELAY_MS * attempt}ms avant retry…`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  log(`  [${label}] 💀 Tous les retries épuisés`);
  return null;
}

// ============================================================
//  CONSTRUCTION DU WIDGET
// ============================================================

async function buildWidget({ consoW, solarW, solarPct, ts, consoTodayKwh, solarTrend, consoTrend, totalCost, wattsDispo }) {
  const w = new ListWidget();
  // w.refreshAfterDate = nextRefreshDate();

  const grad = new LinearGradient();
  grad.colors = [new Color("#1a1a2e"), new Color("#0f0f1a")];
  grad.locations  = [0.0, 1.0];
  grad.startPoint = new Point(0, 0);
  grad.endPoint   = new Point(0, 1);
  w.backgroundGradient = grad;
  w.setPadding(32, 12, 24, 12);

  // ── Titre + Tarif
  const titleRow = w.addStack();
  titleRow.layoutHorizontally();
  titleRow.centerAlignContent();
  const titleLabel = titleRow.addText("⚡ Énergie");
  titleLabel.font = Font.boldSystemFont(12);
  titleLabel.textColor = Color.white();
  titleLabel.lineLimit = 1;
  titleRow.addSpacer(null);
  const isLowTariff = checkLowTariff();
  // const tariffLabel = titleRow.addText(isLowTariff ? "🟢 BT" : "⭕ HT");
  const tariffLabel = titleRow.addText(isLowTariff ? "🟢" : "⭕");
  tariffLabel.font = Font.boldSystemFont(10);
  tariffLabel.textColor = isLowTariff ? new Color("#4caf50") : new Color("#f44336");
  w.addSpacer(10);

  // ── Metrics row
  const metricsRow = w.addStack();
  metricsRow.layoutHorizontally();
  metricsRow.centerAlignContent();
  // Solaire : ↑ vert (production monte = bien), ↓ rouge (production baisse = moins bien)
  const solarTrendIcon  = solarTrend === "up" ? "↑ " : solarTrend === "down" ? "↓ " : "";
  const solarTrendColor = solarTrend === "up" ? new Color("#4caf50") : new Color("#f44336");
  // Conso : ↑ rouge (consomme plus = moins bien), ↓ vert (consomme moins = bien)
  const consoTrendIcon  = consoTrend === "up" ? "↑ " : consoTrend === "down" ? "↓ " : "";
  const consoTrendColor = consoTrend === "up" ? new Color("#f44336") : new Color("#4caf50");
  const badgeTxt = solarW >= 20 ? "☀️" : "🌑";
  addMetric(metricsRow, badgeTxt, "Solaire", solarTrendIcon, solarTrendColor, formatW(solarW), new Color("#f5c518"));
  metricsRow.addSpacer(null);
  const sep = metricsRow.addText("|");
  sep.font = Font.systemFont(20);
  sep.textColor = new Color("#ffffff30");
  metricsRow.addSpacer(null);
  addMetric(metricsRow, "🏠", "Conso", consoTrendIcon, consoTrendColor, formatW(consoW), new Color("#7ec8e3"));
  w.addSpacer(8);

  // ── Pourcentages solaire
  const pctStack = w.addStack();
  pctStack.layoutHorizontally();
  pctStack.addSpacer();
  consoColor = wattsDispo > 0 ? new Color("#4caf50") : new Color("#ffffff80");
  addMetricSimple(pctStack, `${formatW(wattsDispo)}`, "à disposition", consoColor);
  pctStack.addSpacer();
  const sepa = pctStack.addText("");
  sepa.font = Font.systemFont(20);
  sepa.textColor = new Color("#ffffff30");
  pctStack.addSpacer(null);
  addMetricSimple(pctStack, `${solarPct}%`, "de solaire", solarColor(solarPct));
  w.addSpacer(8);

  // ── Consommation moyenne
  const progress  = (consoTodayKwh / DAILY_KWH);
  const pctDay    = Math.round(progress * 100);
  const costStr = totalCost < 0.01 ? "< 0.01 CHF" : `${totalCost.toFixed(2)} CHF`;
  const barLabel = w.addText(`${consoTodayKwh.toFixed(2)}/${DAILY_KWH}kWh [${pctDay}%]`);
  barLabel.font      = Font.systemFont(8);
  barLabel.textColor = new Color("#ffffff80");
  barLabel.centerAlignText();
  w.addSpacer(4);
  // Barre de progression journalière
  const barW = 120, barH = 4;
  const dc   = new DrawContext();
  dc.size    = new Size(barW, barH);
  dc.opaque  = false;
  const fillColor = progress >= 1    ? new Color("#f44336")
                  : progress >= 0.75 ? new Color("#ff9800")
                  :                    new Color("#4caf50");
  const bgPath = new Path();
  bgPath.addRoundedRect(new Rect(0, 0, barW, barH), barH / 2, barH / 2);
  dc.addPath(bgPath);
  dc.setFillColor(new Color("#ffffff80"));
  dc.fillPath();
  const fillW    = Math.max(barH, Math.round(barW * progress));
  const fillPath = new Path();
  fillPath.addRoundedRect(new Rect(0, 0, fillW, barH), barH / 2, barH / 2);
  dc.addPath(fillPath);
  dc.setFillColor(fillColor);
  dc.fillPath();
  const barRow = w.addStack();
  barRow.layoutHorizontally();
  barRow.addSpacer(null);
  const barImg     = barRow.addImage(dc.getImage());
  barImg.imageSize = new Size(barW, barH);
  barRow.addSpacer(null);
  w.addSpacer(4);
  // Coût réseau
  const costLabel = w.addText(`${costStr}`);
  costLabel.font      = Font.systemFont(8);
  costLabel.textColor = new Color("#ffffff80");
  costLabel.centerAlignText();
  w.addSpacer(6);

  // ── Footer
  const footer = w.addText(`Dernière mesure : ${ts}`);
  footer.font = Font.systemFont(6);
  footer.textColor = new Color("#ffffff50");
  footer.centerAlignText();

  if (config.runsInWidget) {
    Script.setWidget(w);
  } else {
    w.presentSmall();
  }
  Script.complete();
}

function addMetric(stack, icon, label, value, color, trendIcon = "", trendColor = null) {
  const col = stack.addStack();
  col.layoutVertically();
  col.spacing = 2;
  const iconLabel = col.addText(`${icon} ${label}`);
  iconLabel.font = Font.systemFont(10);
  iconLabel.textColor = new Color("#ffffff80");

  if (trendIcon) {
    const valRow = col.addStack();
    valRow.layoutHorizontally();
    valRow.centerAlignContent();
    const valLabel = valRow.addText(value);
    valLabel.font = Font.systemFont(10);
    valLabel.textColor = color;
    const trendLabel = valRow.addText(trendIcon);
    trendLabel.font = Font.boldSystemFont(12);
    trendLabel.textColor = trendColor ?? color;
  } else {
    const valLabel = col.addText(value);
    valLabel.font = Font.boldSystemFont(14);
    valLabel.textColor = color;
  }
}

function addMetricSimple(row, value, text, color) {
  const col = row.addStack();
  col.layoutVertically();
  col.centerAlignContent();
  const valRow = col.addStack();
  valRow.addSpacer();
  const valLabel = valRow.addText(value);
  valLabel.font = Font.boldSystemFont(10);
  valLabel.textColor = color;
  valRow.addSpacer();
  col.spacing = 1;
  const labelRow = col.addStack();
  const label = labelRow.addText(text);
  label.font = Font.systemFont(8);
  label.textColor = new Color("#ffffff80");
}

function solarColor(pct) {
  if (pct >= 80) return new Color("#4caf50");
  if (pct >= 60) return new Color("#f5c518");
  if (pct >= 40) return new Color("#ff9800");
  return new Color("#f44336");
}

function formatW(watts) {
  if (watts >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
  return `${watts} W`;
}

// ============================================================
//  WIDGET D'ERREUR
// ============================================================

async function showErrorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1a2e");
  w.setPadding(12, 14, 12, 14);
  const t = w.addText("⚠️ Climkit");
  t.font = Font.boldSystemFont(13);
  t.textColor = Color.white();
  w.addSpacer(6);
  const e = w.addText(msg);
  e.font = Font.systemFont(11);
  e.textColor = new Color("#ff6b6b");
  e.lineLimit = 3;
  if (config.runsInWidget) Script.setWidget(w);
  else w.presentSmall();
  Script.complete();
}

// ============================================================
//  AUTHENTIFICATION & TOKEN
// ============================================================

async function ensureCredentials() {
  if (!Keychain.contains(KC_USER)) {
    const alert = new Alert();
    alert.title = "Climkit — Configuration";
    alert.message = "Saisis ton username API Climkit :";
    alert.addTextField("username@exemple.com");
    alert.addAction("Suivant");
    await alert.presentAlert();
    Keychain.set(KC_USER, alert.textFieldValue(0));

    const alert2 = new Alert();
    alert2.title = "Climkit — Mot de passe API";
    alert2.message = "Saisis ton mot de passe API Climkit :";
    alert2.addSecureTextField("mot de passe");
    alert2.addAction("Enregistrer");
    await alert2.presentAlert();
    Keychain.set(KC_PASS, alert2.textFieldValue(0));
  }
}

async function getValidToken() {
  if (Keychain.contains(KC_TOKEN) && Keychain.contains(KC_EXP)) {
    const expiry = parseInt(Keychain.get(KC_EXP), 10);
    if (Date.now() < expiry - 60_000) {
      log("🔑 Token en cache encore valide");
      return Keychain.get(KC_TOKEN);
    }
    log("🔑 Token expiré, re-authentification…");
  } else {
    log("🔑 Aucun token en cache, authentification…");
  }

  const username = Keychain.get(KC_USER);
  const password = Keychain.get(KC_PASS);
  log(`🔑 Auth avec username: ${username}`);

  const req = new Request(`${API_BASE}/auth`);
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ username, password });

  try {
    const resp = await req.loadJSON();
    log(`🔑 Réponse auth : ${JSON.stringify(resp)}`);
    if (!resp.access_token) {
      log("❌ Pas d'access_token dans la réponse auth");
      return null;
    }
    Keychain.set(KC_TOKEN, resp.access_token);
    const exp = resp.valid_until?.$date ?? (Date.now() + 14 * 60 * 1000);
    Keychain.set(KC_EXP, String(exp));
    log(`🔑 Token valide jusqu'à : ${new Date(exp).toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich" })}`);
    return resp.access_token;
  } catch (e) {
    log(`❌ Exception auth : ${e}`);
    return null;
  }
}

// ============================================================
//  APPEL API meter_data
// ============================================================

async function fetchMeterData(token, meterId, tStart, tEnd) {
  const url = `${API_BASE}/meter_data/${SITE_ID}/${meterId}`;
  log(`  → POST ${url}`);
  log(`  → body: t_s=${tStart} t_e=${tEnd} freq=15T`);

  const req = new Request(url);
  req.method = "POST";
  req.headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };
  req.body = JSON.stringify({ t_s: tStart, t_e: tEnd, sampling_frequency: "15T" });

  const data = await req.loadJSON();
  log(`  → réponse brute : ${JSON.stringify(data)}`);

  if (!Array.isArray(data)) {
    log(`  → ⚠️ La réponse n'est pas un tableau : ${typeof data}`);
    return null;
  }
  if (data.length === 0) {
    log("  → ⚠️ Tableau vide — pas de données sur cette fenêtre");
    return null;
  }
  return data;
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
    t_s: tStart
    //t_e: tEnd,
    //sampling_frequency: "15T",
  });

  const data = await req.loadJSON();
  log(`  → ${Array.isArray(data) ? data.length + " entrées" : "réponse non-tableau : " + typeof data}`);

  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
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
  const time = new Date().toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  console.log(`[${time}] ${msg}`);
}

function checkLowTariff() {
  const now = new Date();
  const hour = parseInt(
    now.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false }),
    10
  );
  // BT : 23h–7h et 12h–17h
  return hour >= 23 || hour < 7 || (hour >= 12 && hour < 17);
}

function nextRefreshDate() {
  const now = new Date();
  const minutes = now.getMinutes();
  const targets = [1, 16, 31, 46];
  // Trouver la prochaine cible
  let nextMin = targets.find(t => t > minutes);
  if (nextMin === undefined) nextMin = targets[0] + 60; // tour suivant
  const diff = nextMin - minutes;
  return new Date(now.getTime() + diff * 60 * 1000);
}