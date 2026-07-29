// ============================================================
// BACKUP AUTOMATICO DEL DATABASE
// ============================================================
//
// Cosa fa:
//  1. Crea uno snapshot coerente di ordini.db (API di backup SQLite).
//  2. Lo salva in una cartella "backups" sul volume, tenendo gli ultimi
//     KEEP_LOCAL file (rotazione: i più vecchi vengono cancellati).
//  3. Se configurato, invia lo snapshot su Telegram come documento, così
//     esiste una copia FUORI da Railway (protegge anche dalla perdita del
//     volume).
//
// Configurazione (variabili d'ambiente su Railway):
//   TELEGRAM_BOT_TOKEN  → token del bot creato con @BotFather
//   TELEGRAM_CHAT_ID    → id della chat dove ricevere i backup
// Se mancano, il backup locale viene comunque fatto (solo l'invio è saltato).

const fs = require('fs');
const path = require('path');
const db = require('./database');

// Cartella backup: accanto al database (sul volume in produzione).
const BACKUP_DIR = path.join(path.dirname(db.DB_PATH), 'backups');
const KEEP_LOCAL = 7; // quanti snapshot locali conservare

// Timestamp compatto per il nome file: 2026-07-29_03-00-12
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Rimuove gli snapshot più vecchi tenendone al massimo KEEP_LOCAL.
function rotateOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('ordini-') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time); // più recenti prima
    for (const f of files.slice(KEEP_LOCAL)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch { /* no-op */ }
    }
  } catch (e) {
    console.warn('⚠️ Rotazione backup: ', e.message);
  }
}

// Invia un file su Telegram come documento. Usa fetch/FormData nativi (Node 20).
async function sendToTelegram(filePath, caption) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { sent: false, reason: 'Telegram non configurato (mancano TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)' };
  }

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption || 'Backup database');
  form.append('document', new Blob([buffer], { type: 'application/octet-stream' }), path.basename(filePath));

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    throw new Error(`Telegram ha risposto: ${resp.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { sent: true };
}

// Esegue un backup completo: snapshot locale + (se configurato) invio Telegram.
// Ritorna un oggetto riepilogo. Non lancia eccezioni verso l'esterno: logga e
// riporta l'esito, così lo scheduler non muore mai.
async function runBackup(reason = 'scheduled') {
  const summary = { ok: false, file: null, sizeKB: 0, telegram: null, error: null };
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const fileName = `ordini-${stamp()}.db`;
    const destPath = path.join(BACKUP_DIR, fileName);

    await db.backupDatabase(destPath);

    const sizeKB = Math.round(fs.statSync(destPath).size / 1024);
    summary.file = fileName;
    summary.sizeKB = sizeKB;
    console.log(`💾 Backup creato: ${fileName} (${sizeKB} KB) [${reason}]`);

    rotateOldBackups();

    try {
      const caption = `🌸 Backup ordini — ${stamp()} (${sizeKB} KB)`;
      summary.telegram = await sendToTelegram(destPath, caption);
      if (summary.telegram.sent) {
        console.log('📤 Backup inviato su Telegram');
      } else {
        console.log(`ℹ️ ${summary.telegram.reason}`);
      }
    } catch (tgErr) {
      summary.telegram = { sent: false, reason: tgErr.message };
      console.error('⚠️ Invio Telegram fallito (lo snapshot locale è comunque salvo):', tgErr.message);
    }

    summary.ok = true;
  } catch (e) {
    summary.error = e.message;
    console.error('❌ Backup fallito:', e.message);
  }
  return summary;
}

module.exports = { runBackup, BACKUP_DIR };
