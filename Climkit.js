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
//  2. Remplace YOUR_SITE_ID, METER_APPART, METER_SOLAR ci-dessous par ton vrai site_id
//     (visible dans l'URL de app.climkit.io quand tu es sur ton site).
// ============================================================

const SITE_ID       = "SITE_ID";
const METER_APPART  = "METER_APPART"; // compteur appart

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
  const tStart = toUTCIso(new Date(now.getTime() - 2 * 3600 * 1000));
  log(`🕐 Fenêtre de requête : ${tStart} → ${tEnd} (UTC)`);

  // Requêtes séquentielles avec retry (évite les timeouts en parallèle)
  log("📡 Requête meter appart…");
  // const appart = await fetchWithRetry(token, METER_APPART, tStart, null, "appart");
  const appart = [{"ext":0.028,"timestamp":"2026-03-22 05:30:00+01:00","self":0.001,"total":0.029},{"ext":0.02,"timestamp":"2026-03-22 05:45:00+01:00","self":0,"total":0.02},{"ext":0.022,"timestamp":"2026-03-22 06:00:00+01:00","self":0,"total":0.022},{"ext":0.028,"timestamp":"2026-03-22 06:15:00+01:00","self":0,"total":0.028},{"ext":0.029,"timestamp":"2026-03-22 06:30:00+01:00","self":0,"total":0.029},{"ext":0.027,"timestamp":"2026-03-22 06:45:00+01:00","self":0,"total":0.027},{"ext":0.022,"timestamp":"2026-03-22 07:00:00+01:00","self":0,"total":0.022},{"ext":0.037,"timestamp":"2026-03-22 07:15:00+01:00","self":0,"total":0.037},{"ext":0.054,"timestamp":"2026-03-22 07:30:00+01:00","self":0,"total":0.054},{"ext":0.065,"timestamp":"2026-03-22 07:45:00+01:00","self":0,"total":0.065},{"ext":0.045,"timestamp":"2026-03-22 08:00:00+01:00","self":0,"total":0.045}]
  await sleep(1000);

  log("📡 Requête meter solaire…");
  // const solar  = await fetchWithRetry(token, METER_SOLAR,  tStart, null, "solaire");
  const solar = [{"total":0,"timestamp":"2026-03-22 05:30:00+01:00"},{"total":0,"timestamp":"2026-03-22 05:45:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:00:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:15:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:30:00+01:00"},{"total":0,"timestamp":"2026-03-22 06:45:00+01:00"},{"total":0,"timestamp":"2026-03-22 07:00:00+01:00"},{"total":0,"timestamp":"2026-03-22 07:15:00+01:00"},{"total":0.004,"timestamp":"2026-03-22 07:30:00+01:00"},{"total":0.008,"timestamp":"2026-03-22 07:45:00+01:00"},{"total":0.024,"timestamp":"2026-03-22 08:00:00+01:00"}]
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
  log(`📦 Dernière tranche appart : ${JSON.stringify(lastAppart)}`);
  log(`📦 Dernière tranche solaire : ${JSON.stringify(lastSolar)}`);

  const consoKwh = lastAppart?.total ?? 0;
  const solarKwh = lastSolar?.total  ?? 0;
  const selfKwh  = lastAppart?.self  ?? 0;

  const solarPct = consoKwh > 0
    ? Math.min(100, Math.round((selfKwh / consoKwh) * 100))
    : 0;

  const consoW = Math.round(consoKwh * 4 * 1000);
  const solarW = Math.round(solarKwh * 4 * 1000);

  log(`🧮 consoKwh=${consoKwh} solarKwh=${solarKwh} selfKwh=${selfKwh}`);
  log(`🧮 consoW=${consoW}W solarW=${solarW}W solarPct=${solarPct}%`);

  const ts = lastAppart?.timestamp
    ? new Date(lastAppart.timestamp).toLocaleTimeString("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" })
    : "--:--";

  log(`✅ Rendu widget — ts=${ts}`);
  await buildWidget({ consoW, solarW, solarPct, ts });
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

async function buildWidget({ consoW, solarW, solarPct, ts }) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const grad = new LinearGradient();
  if (solarPct >= 80) {
    grad.colors = [new Color("#398233"), new Color("#22aa22")];
  } else if (solarPct >= 60) {
    grad.colors = [new Color("#1a3a1a"), new Color("#0f2d0f")];
  } else if (solarPct >= 40) {
    grad.colors = [new Color("#2a3a10"), new Color("#1a2a08")];
  } else {
    grad.colors = [new Color("#1a1a2e"), new Color("#0f0f1a")];
  }
  grad.locations  = [0.0, 1.0];
  grad.startPoint = new Point(0, 0);
  grad.endPoint   = new Point(0, 1);
  w.backgroundGradient = grad;
  w.setPadding(32, 12, 24, 12);

  // ── Titre
  const titleRow = w.addStack();
  titleRow.layoutHorizontally();
  titleRow.centerAlignContent();
  const titleLabel = titleRow.addText("⚡ Énergie");
  titleLabel.font = Font.boldSystemFont(12);
  titleLabel.textColor = Color.white();
  titleLabel.lineLimit = 1;
  titleLabel.centerAlignText();
  w.addSpacer(8);

  // ── Metrics row
  const metricsRow = w.addStack();
  metricsRow.layoutHorizontally();
  metricsRow.centerAlignContent();
  addMetric(metricsRow, "☀️", "Solaire", formatW(solarW), new Color("#f5c518"));
  metricsRow.addSpacer(null);
  const sep = metricsRow.addText("|");
  sep.font = Font.systemFont(20);
  sep.textColor = new Color("#ffffff30");
  metricsRow.addSpacer(null);
  addMetric(metricsRow, "🏠", "Conso", formatW(consoW), new Color("#7ec8e3"));
  w.addSpacer(8);

  // ── Pourcentage solaire
  const pctStack = w.addStack();
  pctStack.layoutHorizontally();
  pctStack.centerAlignContent();
  pctStack.addSpacer(null);
  const pctText = pctStack.addText(`${solarPct}%`);
  pctText.font = Font.boldSystemFont(22);
  pctText.textColor = solarColor(solarPct);
  pctStack.addSpacer(null);
  const pctLabel = w.addText("d'énergie solaire");
  pctLabel.font = Font.systemFont(10);
  pctLabel.textColor = new Color("#ffffff80");
  pctLabel.centerAlignText();
  w.addSpacer(8);

  // ── Footer
  const footer = w.addText(`Dernière mesure : ${ts}`);
  footer.font = Font.systemFont(8);
  footer.textColor = new Color("#ffffff50");
  footer.centerAlignText();

  if (config.runsInWidget) {
    Script.setWidget(w);
  } else {
    w.presentSmall();
  }
  Script.complete();
}

function addMetric(stack, icon, label, value, color) {
  const col = stack.addStack();
  col.layoutVertically();
  col.spacing = 2;
  const iconLabel = col.addText(`${icon} ${label}`);
  iconLabel.font = Font.systemFont(9);
  iconLabel.textColor = new Color("#ffffff80");
  const valLabel = col.addText(value);
  valLabel.font = Font.boldSystemFont(14);
  valLabel.textColor = color;
}

function solarColor(pct) {
  if (pct >= 80) return new Color("#4caf50");
  if (pct >= 60) return new Color("#f5c518");
  if (pct >= 40) return new Color("#ff9800");
  return new Color("#f44336");
}

function formatW(watts) {
  if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
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
