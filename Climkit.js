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
//  2. Remplace YOUR_SITE_ID ci-dessous par ton vrai site_id
//     (visible dans l'URL de app.climkit.io quand tu es sur ton site).
// ============================================================

const SITE_ID       = "SITE_ID"; // ← À remplacer
const METER_APPART  = "METER_APPART"; // compteur appart
const METER_SOLAR   = "METER_SOLAR"; // production PV
const API_BASE      = "https://api.climkit.io/api/v1";

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
  // S'assurer que les credentials sont stockés
  await ensureCredentials();

  // Récupérer un token valide
  const token = await getValidToken();
  if (!token) {
    await showErrorWidget("Impossible d'obtenir un token Climkit.");
    return;
  }

  // Fenêtre de temps : les 2 dernières heures (pour avoir la dernière tranche de 15')
  const now  = new Date();
  const tEnd = toUTCIso(now);
  const tStart = toUTCIso(new Date(now.getTime() - 2 * 3600 * 1000));

  // Requêtes parallèles
  const [appart, solar] = await Promise.all([
    fetchMeterData(token, METER_APPART, tStart, tEnd),
    fetchMeterData(token, METER_SOLAR,  tStart, tEnd),
  ]);

  if (!appart || !solar) {
    await showErrorWidget("Erreur de récupération des données.");
    return;
  }

  // Dernière tranche disponible
  const lastAppart = appart[appart.length - 1];
  const lastSolar  = solar[solar.length - 1];

  // Valeurs en kWh sur la tranche de 15'
  const consoKwh   = lastAppart?.total ?? 0;   // total appart
  const solarKwh   = lastSolar?.total  ?? 0;   // prod PV
  const selfKwh    = lastAppart?.self   ?? 0;   // part solaire consommée par l'appart

  // Pourcentage solaire de la consommation de l'appart
  const solarPct = consoKwh > 0 ? Math.min(100, Math.round((selfKwh / consoKwh) * 100)) : 0;

  // Conversion kWh → W (puissance moyenne sur 15' = kWh * 4 * 1000)
  const consoW  = Math.round(consoKwh * 4 * 1000);
  const solarW  = Math.round(solarKwh * 4 * 1000);

  // Timestamp de la dernière mesure
  const ts = lastAppart?.timestamp
    ? new Date(lastAppart.timestamp).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  await buildWidget({ consoW, solarW, solarPct, ts });
}

// ============================================================
//  CONSTRUCTION DU WIDGET
// ============================================================

async function buildWidget({ consoW, solarW, solarPct, ts }) {
  const w = new ListWidget();
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000); // refresh dans 15'

  // Dégradé de fond selon taux solaire
  const grad = new LinearGradient();
  if (solarPct >= 80) {
    grad.colors    = [new Color("#1a3a1a"), new Color("#0f2d0f")];
  } else if (solarPct >= 40) {
    grad.colors    = [new Color("#2a3a10"), new Color("#1a2a08")];
  } else {
    grad.colors    = [new Color("#1a1a2e"), new Color("#0f0f1a")];
  }
  grad.locations   = [0.0, 1.0];
  grad.startPoint  = new Point(0, 0);
  grad.endPoint    = new Point(0, 1);
  w.backgroundGradient = grad;
  w.setPadding(14, 16, 12, 16);

  // ── Titre
  const titleRow = w.addStack();
  titleRow.layoutHorizontally();
  titleRow.centerAlignContent();

  const titleIcon = titleRow.addText("⚡");
  titleIcon.font = Font.systemFont(12);

  titleRow.addSpacer(6);

  const titleLabel = titleRow.addText("Énergie");
  titleLabel.font = Font.boldSystemFont(12);
  titleLabel.textColor = Color.white();
  titleLabel.lineLimit = 1;

  w.addSpacer(8);

  // ── Metrics row
  const metricsRow = w.addStack();
  metricsRow.layoutHorizontally();
  metricsRow.centerAlignContent();

  // Solaire
  addMetric(metricsRow, "☀️", "Solaire", formatW(solarW), new Color("#f5c518"));
  metricsRow.addSpacer(null);

  // Séparateur vertical
  const sep = metricsRow.addText("|");
  sep.font = Font.systemFont(20);
  sep.textColor = new Color("#ffffff30");
  metricsRow.addSpacer(null);

  // Conso appart
  addMetric(metricsRow, "🏠", "Conso", formatW(consoW), new Color("#7ec8e3"));

  w.addSpacer(8);

  // ── Pourcentage solaire (grand chiffre centré)
  const pctStack = w.addStack();
  pctStack.layoutHorizontally();
  pctStack.centerAlignContent();
  pctStack.addSpacer(null);

  const pctText = pctStack.addText(`${solarPct}%`);
  pctText.font = Font.boldSystemFont(28);
  pctText.textColor = solarColor(solarPct);

  pctStack.addSpacer(null);

  const pctLabel = w.addText("d'énergie solaire");
  pctLabel.font = Font.systemFont(10);
  pctLabel.textColor = new Color("#ffffff80");
  pctLabel.centerAlignText();

  w.addSpacer(8);

  // ── Barre de progression solaire
  const barStack = w.addStack();
  barStack.layoutHorizontally();
  barStack.size = new Size(0, 8);
  barStack.cornerRadius = 4;
  barStack.backgroundColor = new Color("#ffffff20");

  const filledWidth = solarPct; // 0-100 (sera interprété comme % dans la taille)
  const filled = barStack.addStack();
  filled.size = new Size(0, 8);
  filled.layoutHorizontally();
  filled.backgroundColor = new Color("#f5c518");
  filled.cornerRadius = 4;
  // Scriptable ne supporte pas les flex widths, on utilise spacers
  filled.addSpacer(null);
  barStack.addSpacer(null);

  // Fallback : on affiche la barre en texte ASCII si la stack ne rend pas bien
  // w.addSpacer(2);
  // const barText = w.addText(buildBar(solarPct));
  // barText.font = Font.monospacedDigitSystemFont(9);
  // barText.textColor = new Color("#f5c518");

  w.addSpacer(8);

  // ── Footer : horodatage
  const footer = w.addText(`Dernière mesure : ${ts}`);
  footer.font = Font.systemFont(9);
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

function buildBar(pct) {
  const total = 20;
  const filled = Math.round((pct / 100) * total);
  return "▓".repeat(filled) + "░".repeat(total - filled) + ` ${pct}%`;
}

function solarColor(pct) {
  if (pct >= 80) return new Color("#4caf50");
  if (pct >= 50) return new Color("#f5c518");
  if (pct >= 20) return new Color("#ff9800");
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
    alert.message = "Saisis ton username API Climkit (reçu par email de Climkit SA) :";
    alert.addTextField("username@exemple.com");
    alert.addAction("Suivant");
    await alert.presentAlert();
    const username = alert.textFieldValue(0);
    Keychain.set(KC_USER, username);

    const alert2 = new Alert();
    alert2.title = "Climkit — Mot de passe API";
    alert2.message = "Saisis ton mot de passe API Climkit :";
    alert2.addSecureTextField("mot de passe");
    alert2.addAction("Enregistrer");
    await alert2.presentAlert();
    const password = alert2.textFieldValue(0);
    Keychain.set(KC_PASS, password);
  }
}

async function getValidToken() {
  // Vérifier si le token en cache est encore valide (avec 1' de marge)
  if (Keychain.contains(KC_TOKEN) && Keychain.contains(KC_EXP)) {
    const expiry = parseInt(Keychain.get(KC_EXP), 10);
    if (Date.now() < expiry - 60_000) {
      return Keychain.get(KC_TOKEN);
    }
  }

  // Sinon, re-authentifier
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
    // valid_until est en millisecondes epoch
    const exp = resp.valid_until?.$date ?? (Date.now() + 14 * 60 * 1000);
    Keychain.set(KC_EXP, String(exp));
    return resp.access_token;
  } catch (e) {
    console.error("Auth error:", e);
    return null;
  }
}

// ============================================================
//  APPEL API meter_data
// ============================================================

async function fetchMeterData(token, meterId, tStart, tEnd) {
  const url = `${API_BASE}/meter_data/${SITE_ID}/${meterId}`;
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

  try {
    const data = await req.loadJSON();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data;
  } catch (e) {
    console.error(`fetchMeterData(${meterId}) error:`, e);
    return null;
  }
}

// ============================================================
//  UTILITAIRES
// ============================================================

function toUTCIso(date) {
  // Format ISO sans timezone (UTC naïf, comme l'API l'attend)
  return date.toISOString().replace("Z", "").split(".")[0];
}