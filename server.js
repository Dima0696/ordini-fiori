const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const webpush = require('web-push');
const cron = require('node-cron');
const nodeCrypto = require('crypto');

// Polyfill: SimpleWebAuthn v13 usa globalThis.crypto (Web Crypto API)
// che è disponibile come globale solo da Node 20. Su Node 18 e versioni
// precedenti dobbiamo esporlo manualmente da crypto.webcrypto.
if (typeof globalThis.crypto === 'undefined' && nodeCrypto.webcrypto) {
  globalThis.crypto = nodeCrypto.webcrypto;
}

const db = require('./database');
const pushConfig = require('./push-config');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const app = express();
const PORT = process.env.PORT || 3000;

// Crea cartella uploads se non esiste
// Su Railway usa il volume, altrimenti locale
const uploadsDir = process.env.DATABASE_PATH 
  ? path.join(process.env.DATABASE_PATH, 'uploads')
  : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configurazione multer per upload foto
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max (le foto vengono comunque compresse lato client)
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|heic|heif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /^image\//.test(file.mimetype) || allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Solo immagini sono permesse (jpeg, jpg, png, gif, webp, heic)'));
    }
  }
});

// Configurazione multer per upload PDF (listini)
const uploadPdf = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      return cb(null, true);
    } else {
      cb(new Error('Solo file PDF sono permessi'));
    }
  }
});

// Configurazione multer per upload anagrafica (Excel/CSV) - in memoria
const uploadAnagrafica = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Opzioni cache per /uploads: i file hanno nome unico (timestamp+random),
// quindi sono immutable. Il browser li cacha 1 anno → secondo caricamento = istantaneo.
const uploadsStaticOptions = {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
};

// Locale (sviluppo): uploads sotto public/, serviti da express.static('public') senza headers.
// Railway (produzione): volume separato, qui monto la route dedicata.
if (process.env.DATABASE_PATH) {
  app.use('/uploads', express.static(uploadsDir, uploadsStaticOptions));
  console.log(`📸 Serving uploads from volume: ${uploadsDir} (cache 1y)`);
} else {
  // In locale aggiungo comunque headers sugli uploads
  app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), uploadsStaticOptions));
}

// Semplice autenticazione con token in memoria
const activeSessions = new Map(); // username -> token
const tokenToUsername = new Map(); // token -> username

// Genera token casuale
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Middleware per verificare autenticazione
const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  
  const username = tokenToUsername.get(token);
  if (!username) {
    return res.status(401).json({ error: 'Sessione non valida' });
  }
  
  req.user = { username };
  next();
};

// Inizializza database
db.initDb();

// Configura Web Push
webpush.setVapidDetails(
  'mailto:notifications@localhost',
  pushConfig.vapidKeys.publicKey,
  pushConfig.vapidKeys.privateKey
);

// API Routes - Autenticazione

// POST /api/login - Login utente
app.post('/api/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username e password richiesti' });
    }
    
    const user = db.verifyUser(username, password);
    
    if (!user) {
      return res.status(401).json({ error: 'Credenziali non valide' });
    }
    
    // Rimuovi vecchia sessione se esiste
    const oldToken = activeSessions.get(username);
    if (oldToken) {
      tokenToUsername.delete(oldToken);
    }
    
    // Crea nuovo token
    const token = generateToken();
    activeSessions.set(username, token);
    tokenToUsername.set(token, username);
    
    res.json({ 
      success: true, 
      token, 
      username: user.username 
    });
  } catch (error) {
    console.error('Errore login:', error);
    res.status(500).json({ error: 'Errore durante il login' });
  }
});

// POST /api/logout - Logout utente
app.post('/api/logout', authenticate, (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    const username = tokenToUsername.get(token);
    if (username) {
      activeSessions.delete(username);
      tokenToUsername.delete(token);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Errore logout:', error);
    res.status(500).json({ error: 'Errore durante il logout' });
  }
});

// GET /api/me - Verifica sessione corrente
app.get('/api/me', authenticate, (req, res) => {
  res.json({ username: req.user.username });
});

// ============================================================
// WEBAUTHN / PASSKEYS — Sblocco con Face ID / Touch ID / Windows Hello
// ============================================================
//
// Architettura:
// - L'utente fa prima login normale (username+password) e poi può
//   registrare una passkey per il device corrente.
// - Per i login successivi, il pulsante "Sblocca con biometria"
//   chiede al sistema operativo di confermare l'identità (Face ID,
//   Touch ID, impronta Android, Windows Hello), senza più digitare
//   nulla. Funziona cross-platform (iOS, Android, macOS, Windows).
// - Le passkey sono salvate per device (più passkey per utente,
//   una per device fisico).

// L'RP_ID è il dominio. In locale è 'localhost', in produzione
// va impostato via env (es. ordini-fiori.up.railway.app). Su Railway
// l'header 'host' arriva tramite proxy; usiamo anche x-forwarded-host.
function rpIdFromReq(req) {
  if (process.env.WEBAUTHN_RP_ID) return process.env.WEBAUTHN_RP_ID;
  const rawHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
  const host = String(rawHost).split(',')[0].trim().split(':')[0];
  return host || 'localhost';
}
function originFromReq(req) {
  if (process.env.WEBAUTHN_ORIGIN) return process.env.WEBAUTHN_ORIGIN;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0].trim();
  const rawHost = req.headers['x-forwarded-host'] || req.headers['host'] || '';
  const host = String(rawHost).split(',')[0].trim();
  return `${proto}://${host}`;
}

// Map in memoria: chiave = username (registrazione) o sessionId (login),
// valore = { challenge, expiresAt }. Le challenge scadono dopo 5 minuti
// per evitare replay (lo standard WebAuthn richiede challenge fresca).
const pendingChallenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function setChallenge(key, challenge) {
  pendingChallenges.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function takeChallenge(key) {
  const entry = pendingChallenges.get(key);
  if (!entry) return null;
  pendingChallenges.delete(key);
  if (entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}
// Pulizia periodica
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingChallenges) {
    if (v.expiresAt < now) pendingChallenges.delete(k);
  }
}, 60_000).unref();

// Converte una stringa base64url in Uint8Array (per la libreria)
function b64urlToUint8(b64url) {
  return new Uint8Array(Buffer.from(b64url, 'base64url'));
}

// ---------- REGISTRAZIONE PASSKEY (utente già autenticato) ----------

// GET /api/webauthn/register/options
//   Genera le opzioni che il client passerà a navigator.credentials.create().
//   Esclude le passkey già registrate per questo utente sullo stesso device
//   (per evitare duplicati).
app.get('/api/webauthn/register/options', authenticate, async (req, res) => {
  try {
    const username = req.user.username;
    const existing = db.getPasskeysByUsername(username);
    const rpID = rpIdFromReq(req);
    
    const options = await generateRegistrationOptions({
      rpName: 'Ordini Fiori',
      rpID,
      userName: username,
      // userID deve essere stabile per utente (max 64 byte).
      userID: new TextEncoder().encode(username),
      attestationType: 'none',
      excludeCredentials: existing.map(pk => ({
        id: pk.credentialID,
        transports: pk.transports,
      })),
      authenticatorSelection: {
        // 'preferred' = preferisce passkey su device (Touch/Face ID),
        // ma accetta anche security key esterne.
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });
    
    setChallenge(`reg:${username}`, options.challenge);
    res.json(options);
  } catch (error) {
    console.error('Errore generazione opzioni registrazione passkey:', {
      message: error.message,
      stack: error.stack,
      rpID: rpIdFromReq(req),
      origin: originFromReq(req),
      host: req.headers['host'],
      xfh: req.headers['x-forwarded-host'],
    });
    res.status(500).json({ error: 'Errore generazione opzioni: ' + (error.message || 'sconosciuto') });
  }
});

// POST /api/webauthn/register/verify
//   Verifica la risposta di navigator.credentials.create() e salva
//   la passkey nel DB.
app.post('/api/webauthn/register/verify', authenticate, async (req, res) => {
  try {
    const username = req.user.username;
    const { response, deviceName } = req.body || {};
    if (!response) return res.status(400).json({ error: 'Risposta mancante' });
    
    const expectedChallenge = takeChallenge(`reg:${username}`);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge scaduta o mancante. Riprova.' });
    }
    
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: originFromReq(req),
      expectedRPID: rpIdFromReq(req),
    });
    
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Verifica non riuscita' });
    }
    
    const { credential } = verification.registrationInfo;
    
    db.savePasskey({
      username,
      credentialID: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports || response.response?.transports || [],
      deviceName: deviceName || guessDeviceName(req),
    });
    
    res.json({ verified: true });
  } catch (error) {
    console.error('Errore verifica registrazione passkey:', error);
    res.status(500).json({ error: 'Errore verifica registrazione: ' + error.message });
  }
});

// Genera un nome device "decente" a partire dallo User-Agent
function guessDeviceName(req) {
  const ua = req.headers['user-agent'] || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac OS X/i.test(ua) && /Safari/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Dispositivo';
}

// ---------- LOGIN CON PASSKEY (utente NON autenticato) ----------

// POST /api/webauthn/login/options
//   Body: { username?: string }
//   Restituisce options per navigator.credentials.get().
//   Se username è fornito limita ai suoi credentialID (più affidabile su
//   iOS/Safari). Altrimenti permette discoverable credentials.
app.post('/api/webauthn/login/options', async (req, res) => {
  try {
    const { username } = req.body || {};
    let allowCredentials;
    if (username) {
      const pks = db.getPasskeysByUsername(username);
      if (pks.length === 0) {
        return res.status(404).json({ error: 'Nessuna passkey registrata per questo utente' });
      }
      allowCredentials = pks.map(pk => ({
        id: pk.credentialID,
        transports: pk.transports,
      }));
    }
    
    const options = await generateAuthenticationOptions({
      rpID: rpIdFromReq(req),
      userVerification: 'preferred',
      allowCredentials,
    });
    
    // Chiave per la challenge: se ho un username uso quello, altrimenti
    // uso la challenge stessa (per discoverable credentials)
    const challengeKey = username ? `login:${username}` : `login:_disc:${options.challenge}`;
    setChallenge(challengeKey, options.challenge);
    res.json({ ...options, _challengeKey: challengeKey });
  } catch (error) {
    console.error('Errore generazione opzioni login passkey:', {
      message: error.message,
      stack: error.stack,
      rpID: rpIdFromReq(req),
      host: req.headers['host'],
      xfh: req.headers['x-forwarded-host'],
    });
    res.status(500).json({ error: 'Errore generazione opzioni: ' + (error.message || 'sconosciuto') });
  }
});

// POST /api/webauthn/login/verify
//   Body: { response, challengeKey }
//   Verifica l'assertion. Se ok, crea una sessione e restituisce token.
app.post('/api/webauthn/login/verify', async (req, res) => {
  try {
    const { response, challengeKey } = req.body || {};
    if (!response || !challengeKey) {
      return res.status(400).json({ error: 'Dati mancanti' });
    }
    
    const expectedChallenge = takeChallenge(challengeKey);
    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Challenge scaduta o mancante. Riprova.' });
    }
    
    const credentialID = response.id;
    const passkey = db.getPasskeyByCredentialId(credentialID);
    if (!passkey) {
      return res.status(404).json({ error: 'Passkey non riconosciuta su questo server' });
    }
    
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: originFromReq(req),
      expectedRPID: rpIdFromReq(req),
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    
    if (!verification.verified) {
      return res.status(401).json({ error: 'Verifica non riuscita' });
    }
    
    db.updatePasskeyCounter(passkey.credentialID, verification.authenticationInfo.newCounter);
    
    // Stessa logica della login normale: rimuove sessione vecchia, crea nuovo token
    const username = passkey.username;
    const oldToken = activeSessions.get(username);
    if (oldToken) tokenToUsername.delete(oldToken);
    
    const token = generateToken();
    activeSessions.set(username, token);
    tokenToUsername.set(token, username);
    
    res.json({ success: true, token, username });
  } catch (error) {
    console.error('Errore verifica login passkey:', error);
    res.status(500).json({ error: 'Errore verifica: ' + error.message });
  }
});

// ---------- GESTIONE PASSKEY UTENTE ----------

// GET /api/webauthn/credentials — Lista passkey registrate
app.get('/api/webauthn/credentials', authenticate, (req, res) => {
  try {
    const pks = db.getPasskeysByUsername(req.user.username);
    res.json(pks.map(pk => ({
      id: pk.id,
      deviceName: pk.deviceName,
      createdAt: pk.createdAt,
      lastUsedAt: pk.lastUsedAt,
    })));
  } catch (error) {
    console.error('Errore lista passkey:', error);
    res.status(500).json({ error: 'Errore lista passkey' });
  }
});

// DELETE /api/webauthn/credentials/:id — Rimuove una passkey
app.delete('/api/webauthn/credentials/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    db.deletePasskey(id, req.user.username);
    res.json({ success: true });
  } catch (error) {
    console.error('Errore eliminazione passkey:', error);
    res.status(500).json({ error: 'Errore eliminazione' });
  }
});

// API Routes - Ordini (protette)

// GET /api/orders - Ottieni tutti gli ordini
app.get('/api/orders', authenticate, (req, res) => {
  try {
    const orders = db.getAllOrders();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: 'Errore nel recupero degli ordini' });
  }
});

// GET /api/orders/date/:date - Ottieni ordini per data
app.get('/api/orders/date/:date', authenticate, (req, res) => {
  try {
    const orders = db.getOrdersByDate(req.params.date);
    res.json(orders);
  } catch (error) {
    console.error('❌ Errore GET orders/date:', error);
    res.status(500).json({ error: 'Errore nel recupero degli ordini' });
  }
});

// GET /api/orders/date-range - Ordini per range di date
app.get('/api/orders/date-range', authenticate, (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'Parametri from e to richiesti' });
    }
    const orders = db.getOrdersByDateRange(from, to);
    res.json(orders);
  } catch (error) {
    console.error('Errore range date:', error);
    res.status(500).json({ error: 'Errore nel recupero degli ordini' });
  }
});

// GET /api/orders/search - Ricerca ordini (PRIMA di :id per evitare conflitti!)
app.get('/api/orders/search', authenticate, (req, res) => {
  console.log('[API] /api/orders/search chiamato');
  console.log('[API] Query params:', req.query);
  console.log('[API] User:', req.user?.username);
  
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length === 0) {
      console.log('[API] Query vuota, ritorno array vuoto');
      return res.json([]);
    }
    
    const searchTerm = q.trim();
    console.log('[API] searchTerm:', searchTerm);
    
    // Calcola date limite: -7 giorni, +21 giorni da oggi
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 7);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 21);
    
    // Formatta date manualmente per evitare problemi
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    console.log(`[API] Ricerca: "${searchTerm}" dal ${startDateStr} al ${endDateStr}`);
    
    console.log('[API] Chiamata db.searchOrders...');
    const orders = db.searchOrders(searchTerm, startDateStr, endDateStr);
    
    console.log(`[API] Trovati ${orders.length} ordini`);
    console.log('[API] Invio risposta...');
    
    res.json(orders);
  } catch (error) {
    console.error('[API] ERRORE ricerca ordini:', error);
    console.error('[API] Stack:', error.stack);
    res.status(500).json({ 
      error: 'Errore nella ricerca degli ordini', 
      details: error.message,
      stack: error.stack 
    });
  }
});

// GET /api/orders/:id - Ottieni singolo ordine
app.get('/api/orders/:id', authenticate, (req, res) => {
  try {
    const order = db.getOrderById(req.params.id);
    if (order) {
      res.json(order);
    } else {
      res.status(404).json({ error: 'Ordine non trovato' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Errore nel recupero dell\'ordine' });
  }
});

// POST /api/orders - Crea nuovo ordine
app.post('/api/orders', authenticate, async (req, res) => {
  try {
    const {
      date,
      customer,
      description,
      status,
      goods_type,
      photos,
      lineStates
    } = req.body;
    
    if (!date || !customer || !description) {
      return res.status(400).json({ error: 'Dati mancanti: date, customer, description sono obbligatori' });
    }
    
    const orderData = {
      date,
      customer,
      description,
      status: status || 'da_preparare', // Default: da preparare
      goods_type: goods_type || 'in_cella',
      photos: photos || []
    };
    
    const order = db.createOrder(orderData, req.user.username);
    
    // Match automatico anagrafica (conservativo, solo righe ancora non collegate).
    // Non blocca la creazione se fallisce: è un layer opzionale.
    try {
      db.autoMatchOrderLines(order.id, order.description);
    } catch (e) {
      console.error('⚠️ autoMatch creazione ordine fallito:', e.message);
    }
    
    // Applica le scelte manuali dell'utente (chip articolo + provenienza)
    // fatte nella modal Nuovo ordine. Vengono dopo l'auto-match così le
    // scelte dell'utente vincono. Atomico col POST per evitare race con
    // chiamate separate.
    if (lineStates && typeof lineStates === 'object') {
      try {
        applyLineStatesToFabbisogno(order.id, lineStates);
      } catch (e) {
        console.error('⚠️ applyLineStates POST ordine fallito:', e.message);
      }
    }
    
    // Notifica agli altri operatori (l'autore è escluso): "Dimitri ·
    // Hotel Bristol — mar 13/05 · 8 articoli". Non blocca la risposta.
    notifyOrderEvent('created', order, req.user.username);
    
    res.status(201).json(order);
  } catch (error) {
    console.error('Errore creazione ordine:', error);
    res.status(500).json({ error: 'Errore nella creazione dell\'ordine' });
  }
});

// POST /api/upload - Upload foto
app.post('/api/upload', authenticate, upload.array('photos', 10), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nessuna foto caricata' });
    }
    
    const photoUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.json({ photos: photoUrls });
  } catch (error) {
    console.error('Errore upload foto:', error);
    res.status(500).json({ error: 'Errore nel caricamento delle foto' });
  }
});

// DELETE /api/photos/:filename - Elimina foto
app.delete('/api/photos/:filename', authenticate, (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ message: 'Foto eliminata' });
    } else {
      res.status(404).json({ error: 'Foto non trovata' });
    }
  } catch (error) {
    console.error('Errore eliminazione foto:', error);
    res.status(500).json({ error: 'Errore nell\'eliminazione della foto' });
  }
});

// PUT /api/orders/:id - Aggiorna ordine completo
app.put('/api/orders/:id', authenticate, async (req, res) => {
  try {
    const {
      date,
      customer,
      description,
      status,
      goods_type,
      photos,
      lineStates
    } = req.body;
    
    if (!customer || !description || !status) {
      return res.status(400).json({ error: 'Dati mancanti: customer, description, status sono obbligatori' });
    }
    
    const validStatuses = ['da_preparare', 'pronto', 'ritirato'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }
    
    const orderData = {
      date: date || null,
      customer,
      description,
      status,
      goods_type: goods_type || 'in_cella',
      photos: photos || []
    };
    
    // Se goods_type cambia a "da_ordinare", cancella i flag del fabbisogno
    const oldOrder = db.getOrderById(req.params.id);
    if (oldOrder && goods_type === 'da_ordinare' && oldOrder.goods_type !== 'da_ordinare') {
      db.clearFabbisognoChecks(req.params.id);
    }
    
    const order = db.updateOrder(req.params.id, orderData, req.user.username);
    if (order) {
      // Match automatico sulle righe nuove (preserva quelle già agganciate manualmente).
      try {
        db.autoMatchOrderLines(order.id, order.description);
      } catch (e) {
        console.error('⚠️ autoMatch update ordine fallito:', e.message);
      }
      
      // Applica scelte manuali dell'utente (chip + provenienza) fatte nella
      // modal Modifica ordine. Vengono dopo l'auto-match così vincono.
      if (lineStates && typeof lineStates === 'object') {
        try {
          applyLineStatesToFabbisogno(order.id, lineStates);
        } catch (e) {
          console.error('⚠️ applyLineStates PUT ordine fallito:', e.message);
        }
      }
      
      // Notifica modifica agli altri operatori
      notifyOrderEvent('updated', order, req.user.username);
      
      res.json(order);
    } else {
      res.status(404).json({ error: 'Ordine non trovato' });
    }
  } catch (error) {
    console.error('Errore aggiornamento ordine:', error);
    res.status(500).json({ error: 'Errore nell\'aggiornamento dell\'ordine' });
  }
});

// PATCH /api/orders/:id/status - Aggiorna solo lo stato
app.patch('/api/orders/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Stato mancante' });
    }
    
    const validStatuses = ['da_preparare', 'pronto', 'ritirato'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Stato non valido' });
    }
    
    const order = db.updateOrderStatus(req.params.id, status, req.user.username);
    if (order) {
      // Notifica cambio stato agli altri operatori
      notifyOrderEvent('status-changed', order, req.user.username, { newStatus: status });
      
      res.json(order);
    } else {
      res.status(404).json({ error: 'Ordine non trovato' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Errore nell\'aggiornamento dello stato' });
  }
});

// PATCH /api/orders/:id/goods-type - Aggiorna solo il tipo di merce (Carlo/Dimitri)
app.patch('/api/orders/:id/goods-type', authenticate, (req, res) => {
  try {
    const { goods_type } = req.body;
    const username = req.user.username;
    
    // Solo Carlo e Dimitri possono usare questo endpoint
    if (username !== 'Carlo' && username !== 'Dimitri') {
      return res.status(403).json({ error: 'Permesso negato' });
    }
    
    if (!goods_type || !['in_cella', 'da_ordinare', 'ordinata'].includes(goods_type)) {
      return res.status(400).json({ error: 'Tipo merce non valido' });
    }
    
    // Ottieni l'ordine corrente
    const order = db.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    
    // Aggiorna solo goods_type mantenendo tutto il resto
    const updatedOrderData = {
      customer: order.customer,
      description: order.description,
      status: order.status,
      order_type: order.order_type,
      delivery_type: order.delivery_type,
      delivery_time: order.delivery_time,
      delivery_address: order.delivery_address,
      goods_type: goods_type,
      photos: order.photos || []
    };
    
    const updatedOrder = db.updateOrder(req.params.id, updatedOrderData, username);
    res.json({ message: 'Tipo merce aggiornato', order: updatedOrder });
  } catch (error) {
    console.error('Errore aggiornamento tipo merce:', error);
    res.status(500).json({ error: 'Errore aggiornamento tipo merce' });
  }
});

// DELETE /api/orders/:id - Elimina ordine
app.delete('/api/orders/:id', authenticate, (req, res) => {
  try {
    // Prima ottieni l'ordine per eliminare le foto e per la notifica
    const order = db.getOrderById(req.params.id);

    if (order && order.photos && order.photos.length > 0) {
      // Elimina le foto associate
      order.photos.forEach(photoUrl => {
        const filename = path.basename(photoUrl);
        const filePath = path.join(uploadsDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }

    const deleted = db.deleteOrder(req.params.id);
    if (deleted) {
      // Notifica eliminazione agli altri operatori (usa snapshot pre-delete)
      if (order) notifyOrderEvent('deleted', order, req.user.username);
      res.json({ message: 'Ordine eliminato con successo' });
    } else {
      res.status(404).json({ error: 'Ordine non trovato' });
    }
  } catch (error) {
    console.error('Errore eliminazione ordine:', error);
    res.status(500).json({ error: 'Errore nell\'eliminazione dell\'ordine' });
  }
});

// API Routes - Fabbisogno Checks

// GET /api/fabbisogno-checks/batch/:orderIds - Ottieni checks di più ordini in una chiamata
app.get('/api/fabbisogno-checks/batch/:orderIds', authenticate, (req, res) => {
  try {
    const ids = req.params.orderIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    const result = {};
    for (const id of ids) {
      result[id] = db.getFabbisognoChecks(id);
    }
    res.json(result);
  } catch (error) {
    console.error('❌ Errore lettura batch checks:', error);
    res.status(500).json({ error: 'Errore lettura batch checks' });
  }
});

// POST /api/fabbisogno-checks/check-all/:orderId - Segna tutte le righe come checked/prepared
app.post('/api/fabbisogno-checks/check-all/:orderId', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { totalLines, type, value } = req.body;
    // value è opzionale: default true (per retrocompatibilità)
    const val = value === false ? false : true;
    
    if (!totalLines || totalLines < 1) {
      return res.status(400).json({ error: 'totalLines richiesto' });
    }
    
    for (let i = 0; i < totalLines; i++) {
      if (type === 'prepared') {
        db.setFabbisognoPrepared(orderId, i, val);
      } else {
        db.setFabbisognoCheck(orderId, i, val);
      }
    }
    
    res.json({ success: true, checked: totalLines, type: type || 'checked', value: val });
  } catch (error) {
    console.error('❌ Errore check-all:', error);
    res.status(500).json({ error: 'Errore check-all' });
  }
});

// POST /api/fabbisogno-checks/set-all/:orderId - Set contemporaneamente checked e prepared
// body: { totalLines, checked: bool|null, prepared: bool|null }
// se checked/prepared è null o undefined, quella proprietà non viene toccata
app.post('/api/fabbisogno-checks/set-all/:orderId', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const { totalLines, checked, prepared } = req.body;
    
    if (!totalLines || totalLines < 1) {
      return res.status(400).json({ error: 'totalLines richiesto' });
    }
    
    for (let i = 0; i < totalLines; i++) {
      if (typeof checked === 'boolean') {
        db.setFabbisognoCheck(orderId, i, checked);
      }
      if (typeof prepared === 'boolean') {
        db.setFabbisognoPrepared(orderId, i, prepared);
      }
    }
    
    res.json({ success: true, totalLines, checked, prepared });
  } catch (error) {
    console.error('❌ Errore set-all:', error);
    res.status(500).json({ error: 'Errore set-all' });
  }
});

// POST /api/fabbisogno-checks/:orderId/:lineNumber/supplier - Set supplier (NL, ITA, IMPORT, '')
app.post('/api/fabbisogno-checks/:orderId/:lineNumber/supplier', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const lineNumber = parseInt(req.params.lineNumber);
    const supplier = (req.body && typeof req.body.supplier === 'string') ? req.body.supplier : '';
    
    const result = db.setFabbisognoSupplier(orderId, lineNumber, supplier);
    res.json({ supplier: result });
  } catch (error) {
    console.error('❌ Errore salvataggio supplier:', error);
    res.status(500).json({ error: 'Errore salvataggio: ' + error.message });
  }
});

// Helper riusabile: applica una mappa { idx -> { supplier?, matchKey? } }
// a fabbisogno_checks. Solo i campi presenti vengono toccati. Usato sia
// dal batch endpoint sia da POST/PUT /api/orders quando il client invia
// `lineStates` insieme all'ordine (modal Nuovo/Modifica).
function applyLineStatesToFabbisogno(orderId, lineStates) {
  if (!lineStates || typeof lineStates !== 'object') {
    return { supplierUpdates: 0, matchUpdates: 0, errors: [] };
  }
  let supplierUpdates = 0;
  let matchUpdates = 0;
  const errors = [];
  
  Object.keys(lineStates).forEach(rawIdx => {
    const idx = parseInt(rawIdx);
    if (Number.isNaN(idx) || idx < 0) return;
    const s = lineStates[rawIdx] || {};
    
    if (typeof s.supplier === 'string') {
      try {
        db.setFabbisognoSupplier(orderId, idx, s.supplier);
        supplierUpdates++;
      } catch (e) {
        errors.push({ index: idx, field: 'supplier', error: e.message });
      }
    }
    
    if (typeof s.matchKey === 'string') {
      try {
        db.setFabbisognoMatchKey(orderId, idx, s.matchKey);
        matchUpdates++;
      } catch (e) {
        console.error('⚠️ applyLineStates: matchKey fallita idx=' + idx + ' key="' + s.matchKey + '" err=' + e.message);
        errors.push({ index: idx, field: 'matchKey', error: e.message });
      }
    }
  });
  
  return { supplierUpdates, matchUpdates, errors };
}

// POST /api/fabbisogno-checks/batch-state/:orderId - Set in batch supplier e/o match_key
// per più righe in una sola chiamata. Endpoint di fallback / retro-compatibilità,
// usato anche dalla modal quando il flush avviene dopo POST/PUT ordine.
//
// Body: { lines: [{ index, supplier?, matchKey? }, ...] }
//   oppure { lineStates: { "0": { supplier?, matchKey? }, ... } }
app.post('/api/fabbisogno-checks/batch-state/:orderId', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    let lineStates = (req.body && req.body.lineStates) || null;
    
    if (!lineStates && req.body && Array.isArray(req.body.lines)) {
      lineStates = {};
      for (const l of req.body.lines) {
        const idx = parseInt(l.index);
        if (Number.isNaN(idx) || idx < 0) continue;
        lineStates[idx] = {};
        if (typeof l.supplier === 'string') lineStates[idx].supplier = l.supplier;
        if (typeof l.matchKey === 'string') lineStates[idx].matchKey = l.matchKey;
      }
    }
    
    const result = applyLineStatesToFabbisogno(orderId, lineStates || {});
    res.json(result);
  } catch (error) {
    console.error('❌ Errore batch-state:', error);
    res.status(500).json({ error: 'Errore: ' + error.message });
  }
});

// POST /api/fabbisogno-checks/:orderId/:lineNumber/match - Set match_key (aggancio anagrafica)
// body: { matchKey: "NOME|QUALITA" oppure "" per scollegare }
app.post('/api/fabbisogno-checks/:orderId/:lineNumber/match', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const lineNumber = parseInt(req.params.lineNumber);
    const matchKey = (req.body && typeof req.body.matchKey === 'string') ? req.body.matchKey : '';
    
    const result = db.setFabbisognoMatchKey(orderId, lineNumber, matchKey);
    res.json({ matchKey: result });
  } catch (error) {
    console.error('❌ Errore salvataggio match_key:', error);
    res.status(400).json({ error: 'Errore salvataggio: ' + error.message });
  }
});

// POST /api/fabbisogno-checks/:orderId/:lineNumber/prepared - Set prepared
app.post('/api/fabbisogno-checks/:orderId/:lineNumber/prepared', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const lineNumber = parseInt(req.params.lineNumber);
    const prepared = req.body && typeof req.body.prepared === 'boolean' ? req.body.prepared : false;
    
    const result = db.setFabbisognoPrepared(orderId, lineNumber, prepared);
    res.json({ prepared: result });
  } catch (error) {
    console.error('❌ Errore salvataggio prepared:', error);
    res.status(500).json({ error: 'Errore salvataggio: ' + error.message });
  }
});

// GET /api/fabbisogno-checks/:orderId - Ottieni checkbox di un ordine
app.get('/api/fabbisogno-checks/:orderId', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    console.log('🔵 GET /fabbisogno-checks/' + orderId);
    const checks = db.getFabbisognoChecks(orderId);
    console.log('🟢 CHECKS DB:', JSON.stringify(checks));
    res.json(checks);
  } catch (error) {
    console.error('❌ Errore lettura checks:', error);
    res.status(500).json({ error: 'Errore lettura checks' });
  }
});

// POST /api/fabbisogno-checks/:orderId/:lineNumber - Set checkbox (non toggle!)
app.post('/api/fabbisogno-checks/:orderId/:lineNumber', authenticate, (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const lineNumber = parseInt(req.params.lineNumber);
    const checked = req.body && typeof req.body.checked === 'boolean' ? req.body.checked : null;
    
    console.log('🔵 POST /fabbisogno-checks/' + orderId + '/' + lineNumber, 'checked:', checked);
    
    let result;
    if (checked === null) {
      // Retrocompatibilità: se non c'è body, fa toggle
      result = db.toggleFabbisognoCheck(orderId, lineNumber);
    } else {
      // Nuovo: imposta valore specifico
      result = db.setFabbisognoCheck(orderId, lineNumber, checked);
    }
    
    console.log('🟢 SALVATO checked=' + result);
    res.json({ checked: result });
  } catch (error) {
    console.error('❌ Errore salvataggio check:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({ error: 'Errore salvataggio: ' + error.message });
  }
});

// GET /api/articoli/search?q=... - Ricerca articoli nell'anagrafica master.
// Ritorna fino a 100 candidati ordinati per rilevanza.
app.get('/api/articoli/search', authenticate, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json([]);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const results = db.searchArticoli(q, limit);
    res.json(results);
  } catch (error) {
    console.error('❌ Errore ricerca articoli:', error);
    res.status(500).json({ error: 'Errore ricerca' });
  }
});

// GET /api/articoli/count - Numero totale articoli in anagrafica.
app.get('/api/articoli/count', authenticate, (req, res) => {
  try {
    res.json({ count: db.countArticoliMaster() });
  } catch (error) {
    res.status(500).json({ error: 'Errore count' });
  }
});

// POST /api/articoli/upload - Carica e importa anagrafica articoli da file Excel/CSV.
// Body: multipart/form-data con campo "file".
// Query opzionale: ?reset=1 per cancellare l'anagrafica esistente prima dell'import.
app.post('/api/articoli/upload', authenticate, uploadAnagrafica.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file ricevuto' });
    }
    const xlsx = require('xlsx');
    const wb = xlsx.read(req.file.buffer, { type: 'buffer', raw: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    
    if (rows.length < 2) {
      return res.status(400).json({ error: 'File vuoto o senza dati' });
    }
    
    // Salta la prima riga (header)
    const items = [];
    const seen = new Set();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const nome = String(r[0] || '').trim();
      const qualita = String(r[1] || '').trim();
      if (!nome) continue;
      const key = `${nome}|${qualita}`.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ nome, qualita });
    }
    
    if (req.query.reset === '1') {
      db.clearArticoliMaster();
    }
    
    const before = db.countArticoliMaster();
    const result = db.upsertArticoliMaster(items);
    const after = db.countArticoliMaster();
    
    res.json({
      filename: req.file.originalname,
      rowsRead: rows.length - 1,
      uniqueItems: items.length,
      inserted: result.inserted,
      skipped: result.skipped,
      totalBefore: before,
      totalAfter: after,
    });
  } catch (error) {
    console.error('❌ Errore upload anagrafica:', error);
    res.status(500).json({ error: 'Errore: ' + error.message });
  }
});

// POST /api/articoli/auto-match-existing - Applica match automatico a tutti gli ordini
// dei giorni recenti (utility da chiamare una volta dopo l'import dell'anagrafica).
// Body opzionale: { fromDate, toDate } in formato YYYY-MM-DD; default ultimi 30 giorni.
app.post('/api/articoli/auto-match-existing', authenticate, (req, res) => {
  try {
    const today = new Date();
    const past = new Date(today);
    past.setDate(today.getDate() - 30);
    const future = new Date(today);
    future.setDate(today.getDate() + 30);
    const toIso = (d) => d.toISOString().slice(0, 10);
    const fromDate = (req.body && req.body.fromDate) || toIso(past);
    const toDate = (req.body && req.body.toDate) || toIso(future);
    
    const orders = db.getOrdersByDateRange(fromDate, toDate);
    let processed = 0;
    let totalApplied = 0;
    for (const o of orders) {
      const applied = db.autoMatchOrderLines(o.id, o.description);
      const n = Object.keys(applied).length;
      if (n > 0) totalApplied += n;
      processed++;
    }
    res.json({ processed, totalApplied, fromDate, toDate });
  } catch (error) {
    console.error('❌ Errore auto-match-existing:', error);
    res.status(500).json({ error: 'Errore: ' + error.message });
  }
});

// DEBUG: Verifica schema database
app.get('/api/debug/schema', authenticate, (req, res) => {
  try {
    const sqlite = require('better-sqlite3');
    const dbPath = process.env.DATABASE_PATH || './ordini.db';
    const database = sqlite(dbPath);
    
    // Lista tutte le tabelle
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    
    // Schema fabbisogno_checks se esiste
    let fabbisognoSchema = null;
    try {
      fabbisognoSchema = database.prepare("PRAGMA table_info(fabbisogno_checks)").all();
    } catch (e) {
      fabbisognoSchema = { error: e.message };
    }
    
    // Conta record in fabbisogno_checks
    let count = 0;
    try {
      const result = database.prepare("SELECT COUNT(*) as count FROM fabbisogno_checks").get();
      count = result.count;
    } catch (e) {
      count = { error: e.message };
    }
    
    res.json({
      dbPath,
      tables,
      fabbisognoSchema,
      fabbisognoCount: count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Routes - Stats - Ottieni statistiche per date (per il calendario)
app.get('/api/stats/dates', (req, res) => {
  try {
    const stats = db.getOrdersCountByDate();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Errore nel recupero delle statistiche' });
  }
});

// ==========================================
// NOTIFICHE PUSH
// ==========================================

// ==========================================
// SYNC SOFT — Banner "ci sono aggiornamenti"
// ==========================================

// GET /api/sync/ping?dates=YYYY-MM-DD,YYYY-MM-DD
// Restituisce, per ogni data, count ordini e ultimo updated_at (compresi
// gli aggiornamenti su fabbisogno_checks). Il client confronta questo
// snapshot con il suo memorizzato per capire se ci sono novità e mostrare
// un banner discreto "Aggiornamenti disponibili — ricarica".
//
// Endpoint volutamente leggero (2 query GROUP BY) per essere chiamato
// in polling ogni ~20s. Non restituisce gli ordini, solo i marker.
app.get('/api/sync/ping', authenticate, (req, res) => {
  try {
    const datesParam = (req.query.dates || '').trim();
    if (!datesParam) {
      return res.json({});
    }
    // Validazione minima: solo date YYYY-MM-DD, evita iniezioni
    const dates = datesParam.split(',')
      .map(s => s.trim())
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (dates.length === 0) return res.json({});
    
    const snapshot = db.getOrdersSyncSnapshot(dates);
    res.json(snapshot);
  } catch (error) {
    console.error('Errore sync ping:', error);
    res.status(500).json({ error: 'Errore sync ping' });
  }
});

// GET /api/push/vapid-public-key
app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: pushConfig.vapidKeys.publicKey });
});

// POST /api/push/subscribe
app.post('/api/push/subscribe', authenticate, (req, res) => {
  try {
    const { subscription } = req.body;
    const username = req.user.username;
    
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Subscription non valida' });
    }
    
    db.saveSubscription(username, subscription);
    res.json({ message: 'Subscription salvata con successo' });
  } catch (error) {
    console.error('Errore salvataggio subscription:', error);
    res.status(500).json({ error: 'Errore salvataggio subscription' });
  }
});

// POST /api/push/test - Test notifica
app.post('/api/push/test', authenticate, async (req, res) => {
  try {
    const username = req.user.username;
    await sendTestNotification(username);
    res.json({ message: 'Notifica di test inviata' });
  } catch (error) {
    console.error('Errore invio notifica test:', error);
    res.status(500).json({ error: 'Errore invio notifica' });
  }
});

// Funzione per inviare notifica di test
async function sendTestNotification(username) {
  const allSubs = db.getAllSubscriptions();
  const userSubs = allSubs.filter(sub => sub.username === username);
  
  const payload = JSON.stringify({
    title: '🔔 Test Notifiche',
    body: 'Le notifiche funzionano correttamente!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'test'
  });
  
  for (const sub of userSubs) {
    try {
      await webpush.sendNotification(sub.subscription, payload);
    } catch (error) {
      console.error('Errore invio notifica:', error);
      if (error.statusCode === 410) {
        db.deleteSubscription(sub.subscription.endpoint);
      }
    }
  }
}

// Funzione generica per inviare notifiche a tutti.
// opts:
//  - excludeUsername: non inviare a questo utente (es. chi ha fatto l'azione)
//  - data: payload custom (es. { orderId, url } per deeplink al click)
//  - tag: identificatore per raggruppare/sostituire notifiche
//  - requireInteraction: notifica persistente finché l'utente non interagisce
async function sendNotificationToAll(title, body, tag = 'order-update', opts = {}) {
  try {
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      requireInteraction: opts.requireInteraction === true,
      data: opts.data || {}
    });
    
    const allSubs = db.getAllSubscriptions();
    const exclude = (opts.excludeUsername || '').toLowerCase();
    let sent = 0;
    let skipped = 0;
    
    for (const sub of allSubs) {
      // Salta l'attore (chi ha fatto l'azione non si auto-notifica)
      if (exclude && (sub.username || '').toLowerCase() === exclude) {
        skipped++;
        continue;
      }
      try {
        await webpush.sendNotification(sub.subscription, payload);
        sent++;
      } catch (error) {
        if (error.statusCode === 410 || error.statusCode === 404) {
          db.deleteSubscription(sub.subscription.endpoint);
        }
      }
    }
    
    console.log(`📬 "${title}" → ${sent} utenti (${skipped} attore escluso)`);
  } catch (error) {
    console.error('Errore invio notifica:', error);
  }
}

// Formatta una data ISO (YYYY-MM-DD) in italiano breve: "mar 13/05".
function formatDateItalian(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return dateStr;
    const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
    const dayName = days[d.getDay()];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dayName} ${dd}/${mm}`;
  } catch (e) {
    return dateStr;
  }
}

// Conta articoli (righe non vuote) in una descrizione ordine
function countOrderLines(description) {
  if (!description) return 0;
  return description.split('\n').filter(l => l.trim() !== '').length;
}

// Capitalizza la prima lettera (per username "dimitri" → "Dimitri")
function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Helper centralizzato per le notifiche di eventi su un ordine.
// Costruisce title + body emoji-rich coerenti e include orderId + date
// nei `data` per il deeplink al click.
//
// type: 'created' | 'updated' | 'status-changed' | 'deleted'
// extras: { newStatus?: 'pronto'|'ritirato'|'da_preparare' }
function notifyOrderEvent(type, order, actor, extras = {}) {
  if (!order) return;
  const actorLabel = capitalize(actor || 'qualcuno');
  const customer = order.customer || 'cliente sconosciuto';
  const dateLabel = formatDateItalian(order.date);
  const lineCount = countOrderLines(order.description);
  const lineLabel = lineCount > 0
    ? `${lineCount} ${lineCount === 1 ? 'articolo' : 'articoli'}`
    : '';
  
  let title, body, tag;
  switch (type) {
    case 'created':
      title = '📦 Nuovo ordine';
      body = `${actorLabel} · ${customer}${dateLabel ? ' — ' + dateLabel : ''}${lineLabel ? ' · ' + lineLabel : ''}`;
      tag = `order-new-${order.id}`;
      break;
    case 'updated':
      title = '✏️ Ordine modificato';
      body = `${actorLabel} · ${customer}${dateLabel ? ' — ' + dateLabel : ''}`;
      tag = `order-update-${order.id}`;
      break;
    case 'status-changed': {
      const s = extras.newStatus;
      if (s === 'pronto') {
        title = '✅ Ordine pronto';
      } else if (s === 'ritirato') {
        title = '🎉 Ordine ritirato';
      } else {
        title = '↩️ Ordine riportato a "da preparare"';
      }
      body = `${actorLabel} · ${customer}${dateLabel ? ' — ' + dateLabel : ''}`;
      tag = `order-status-${order.id}`;
      break;
    }
    case 'deleted':
      title = '🗑️ Ordine eliminato';
      body = `${actorLabel} · ${customer}${dateLabel ? ' — ' + dateLabel : ''}`;
      tag = `order-deleted-${order.id}`;
      break;
    default:
      return;
  }
  
  setImmediate(() => {
    sendNotificationToAll(title, body, tag, {
      excludeUsername: actor,
      data: {
        orderId: order.id,
        date: order.date,
        type
      }
    });
  });
}

// Funzione per inviare notifiche giornaliere
async function sendDailyNotifications() {
  try {
    const today = new Date();
    const dateStr = formatDateForDB(today);
    
    const orders = db.getOrdersByDate(dateStr);
    
    if (orders.length === 0) {
      console.log('📅 Nessun ordine per oggi, notifiche non inviate');
      return;
    }
    
    const stats = {
      total: orders.length,
      da_preparare: orders.filter(o => o.status === 'da_preparare').length
    };
    
    const text = stats.da_preparare > 0
      ? `${stats.da_preparare} ${stats.da_preparare === 1 ? 'ordine da preparare' : 'ordini da preparare'}`
      : `${stats.total} ${stats.total === 1 ? 'ordine' : 'ordini'} per oggi`;
    
    const payload = JSON.stringify({
      title: '🌸 Ordini di Oggi',
      body: text,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'daily-orders',
      requireInteraction: true
    });
    
    const allSubs = db.getAllSubscriptions();
    let sent = 0;
    
    for (const sub of allSubs) {
      try {
        await webpush.sendNotification(sub.subscription, payload);
        sent++;
      } catch (error) {
        if (error.statusCode === 410 || error.statusCode === 404) {
          db.deleteSubscription(sub.subscription.endpoint);
        }
      }
    }
    
    console.log(`📬 Notifiche giornaliere inviate a ${sent} utenti`);
  } catch (error) {
    console.error('Errore notifiche:', error);
  }
}

function formatDateForDB(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Scheduler: ogni giorno alle 6:30 - ATTIVATO
cron.schedule(`${pushConfig.notificationTime.minute} ${pushConfig.notificationTime.hour} * * *`, () => {
  console.log('⏰ Invio notifiche giornaliere...');
  sendDailyNotifications();
}, {
  timezone: "Europe/Rome"
});

console.log(`⏰ Notifiche push ATTIVE: ogni giorno alle ${pushConfig.notificationTime.hour}:${String(pushConfig.notificationTime.minute).padStart(2, '0')}`);

// ============================================
// API LISTINI
// ============================================

// GET /api/push/status - Verifica stato notifiche
app.get('/api/push/status', authenticate, (req, res) => {
  try {
    const allSubs = db.getAllSubscriptions();
    const userSub = allSubs.find(s => s.username === req.user.username);
    
    res.json({
      enabled: !!userSub,
      totalSubscriptions: allSubs.length,
      scheduledTime: `${pushConfig.notificationTime.hour}:${String(pushConfig.notificationTime.minute).padStart(2, '0')}`,
      timezone: 'Europe/Rome'
    });
  } catch (error) {
    console.error('Errore verifica stato notifiche:', error);
    res.status(500).json({ error: 'Errore verifica stato' });
  }
});

// GET /api/listini - Ottieni tutti i listini
app.get('/api/listini', authenticate, (req, res) => {
  try {
    const listini = db.getAllListini();
    res.json(listini);
  } catch (error) {
    console.error('Errore recupero listini:', error);
    res.status(500).json({ error: 'Errore nel recupero dei listini' });
  }
});

// POST /api/listini/upload - Carica nuovo listino PDF
app.post('/api/listini/upload', uploadPdf.single('pdf'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nessun file caricato' });
    }
    
    const uploadedBy = req.headers['x-user'] || 'Anonimo';
    const originalName = req.file.originalname;
    const filename = req.file.filename;
    
    const listino = db.addListino({
      name: originalName,
      filename: filename,
      uploaded_by: uploadedBy
    });
    
    res.json(listino);
  } catch (error) {
    console.error('Errore upload listino:', error);
    res.status(500).json({ error: 'Errore nel caricamento del listino' });
  }
});

// GET /api/listini/view/:filename - Visualizza PDF
app.get('/api/listini/view/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File non trovato' });
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Errore visualizzazione listino:', error);
    res.status(500).json({ error: 'Errore nella visualizzazione del listino' });
  }
});

// DELETE /api/listini/:id - Elimina listino
app.delete('/api/listini/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const listino = db.getListinoById(id);
    
    if (!listino) {
      return res.status(404).json({ error: 'Listino non trovato' });
    }
    
    // Elimina file fisico
    const filePath = path.join(uploadsDir, listino.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Elimina dal database
    db.deleteListino(id);
    
    res.json({ message: 'Listino eliminato' });
  } catch (error) {
    console.error('Errore eliminazione listino:', error);
    res.status(500).json({ error: 'Errore nell\'eliminazione del listino' });
  }
});

// ============================================
// PREVENTIVI
// ============================================

// GET /api/preventivi - Lista preventivi (snapshot leggero, senza items)
app.get('/api/preventivi', authenticate, (req, res) => {
  try {
    const list = db.getAllPreventivi();
    res.json(list);
  } catch (error) {
    console.error('Errore lista preventivi:', error);
    res.status(500).json({ error: 'Errore nel recupero preventivi' });
  }
});

// GET /api/preventivi/:id - Ottieni singolo preventivo completo
app.get('/api/preventivi/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const prev = db.getPreventivoById(id);
    if (!prev) return res.status(404).json({ error: 'Preventivo non trovato' });
    res.json(prev);
  } catch (error) {
    console.error('Errore get preventivo:', error);
    res.status(500).json({ error: 'Errore nel recupero preventivo' });
  }
});

// POST /api/preventivi - Crea nuovo preventivo
app.post('/api/preventivi', authenticate, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.cliente || String(body.cliente).trim() === '') {
      return res.status(400).json({ error: 'Cliente obbligatorio' });
    }
    const prev = db.createPreventivo(body, req.user.username);
    res.status(201).json(prev);
  } catch (error) {
    console.error('Errore create preventivo:', error);
    res.status(500).json({ error: 'Errore nella creazione del preventivo' });
  }
});

// PUT /api/preventivi/:id - Aggiorna preventivo
app.put('/api/preventivi/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updated = db.updatePreventivo(id, req.body || {}, req.user.username);
    if (!updated) return res.status(404).json({ error: 'Preventivo non trovato' });
    res.json(updated);
  } catch (error) {
    console.error('Errore update preventivo:', error);
    res.status(500).json({ error: 'Errore nell\'aggiornamento del preventivo' });
  }
});

// DELETE /api/preventivi/:id
app.delete('/api/preventivi/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const existing = db.getPreventivoById(id);
    if (!existing) return res.status(404).json({ error: 'Preventivo non trovato' });
    db.deletePreventivo(id);
    res.json({ message: 'Preventivo eliminato' });
  } catch (error) {
    console.error('Errore delete preventivo:', error);
    res.status(500).json({ error: 'Errore nell\'eliminazione del preventivo' });
  }
});

// ============================================
// PORTALE CLIENTI (magic link + ordini self-service)
// ============================================

// Parsing minimale dei cookie (niente dipendenze extra)
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  if (!header) return out;
  header.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx < 0) return;
    const k = c.slice(0, idx).trim();
    const v = c.slice(idx + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  });
  return out;
}

function setCustomerCookie(res, token) {
  // 90 giorni, HttpOnly, SameSite=Lax. Secure in produzione (dietro HTTPS).
  const isProd = !!process.env.DATABASE_PATH || process.env.NODE_ENV === 'production';
  const parts = [
    `c_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24 * 90}`
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCustomerCookie(res) {
  res.setHeader('Set-Cookie', 'c_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

// Middleware autenticazione cliente (cookie c_token)
const customerAuth = (req, res, next) => {
  const cookies = parseCookies(req);
  const token = cookies.c_token;
  if (!token) return res.status(401).json({ error: 'Non autenticato' });
  const customer = db.getCustomerByToken(token);
  if (!customer) {
    clearCustomerCookie(res);
    return res.status(401).json({ error: 'Sessione scaduta' });
  }
  req.customer = customer;
  next();
};

// Magic link: imposta cookie e redirect al portale
app.get('/c/:token', (req, res) => {
  const token = req.params.token || '';
  const customer = db.getCustomerByToken(token);
  if (!customer) {
    return res.redirect('/cliente?err=invalid');
  }
  db.touchCustomerLogin(customer.id);
  setCustomerCookie(res, token);
  res.redirect('/cliente');
});

// Serve la SPA del portale cliente
app.get('/cliente', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cliente.html'));
});

// Logout cliente
app.post('/api/c/logout', (req, res) => {
  clearCustomerCookie(res);
  res.json({ success: true });
});

// GET profilo cliente (+ dati base)
app.get('/api/c/me', customerAuth, (req, res) => {
  const { id, name, contact_name, email, phone, notes } = req.customer;
  res.json({ id, name, contact_name, email, phone, notes });
});

// PUT aggiorna profilo cliente
app.put('/api/c/me', customerAuth, (req, res) => {
  try {
    const { contact_name, email, phone } = req.body || {};
    const updated = db.updateCustomer(req.customer.id, {
      contact_name, email, phone
    });
    res.json({
      id: updated.id,
      name: updated.name,
      contact_name: updated.contact_name,
      email: updated.email,
      phone: updated.phone
    });
  } catch (error) {
    console.error('Errore update profilo cliente:', error);
    res.status(500).json({ error: 'Errore aggiornamento profilo' });
  }
});

// Indirizzi: list / create / update / delete
app.get('/api/c/addresses', customerAuth, (req, res) => {
  try {
    res.json(db.getCustomerAddresses(req.customer.id));
  } catch (error) {
    console.error('Errore GET addresses:', error);
    res.status(500).json({ error: 'Errore recupero indirizzi' });
  }
});

app.post('/api/c/addresses', customerAuth, (req, res) => {
  try {
    const a = db.addCustomerAddress(req.customer.id, req.body || {});
    res.status(201).json(a);
  } catch (error) {
    console.error('Errore POST address:', error);
    res.status(500).json({ error: 'Errore creazione indirizzo' });
  }
});

app.put('/api/c/addresses/:id', customerAuth, (req, res) => {
  try {
    const addrId = parseInt(req.params.id);
    const a = db.updateCustomerAddress(req.customer.id, addrId, req.body || {});
    if (!a) return res.status(404).json({ error: 'Indirizzo non trovato' });
    res.json(a);
  } catch (error) {
    console.error('Errore PUT address:', error);
    res.status(500).json({ error: 'Errore aggiornamento indirizzo' });
  }
});

app.delete('/api/c/addresses/:id', customerAuth, (req, res) => {
  try {
    const addrId = parseInt(req.params.id);
    db.deleteCustomerAddress(req.customer.id, addrId);
    res.json({ success: true });
  } catch (error) {
    console.error('Errore DELETE address:', error);
    res.status(500).json({ error: 'Errore eliminazione indirizzo' });
  }
});

// Lista ordini del cliente (solo i suoi)
app.get('/api/c/orders', customerAuth, (req, res) => {
  try {
    res.json(db.getOrdersByCustomerId(req.customer.id));
  } catch (error) {
    console.error('Errore GET orders cliente:', error);
    res.status(500).json({ error: 'Errore recupero ordini' });
  }
});

// Dettaglio di un suo ordine
app.get('/api/c/orders/:id', customerAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const o = db.getOrderById(id);
    if (!o || o.customer_id !== req.customer.id) {
      return res.status(404).json({ error: 'Ordine non trovato' });
    }
    res.json(o);
  } catch (error) {
    console.error('Errore GET order:', error);
    res.status(500).json({ error: 'Errore recupero ordine' });
  }
});

// Crea nuovo ordine (sempre in stato customer_order_status = 'pending')
// Accetta due formati:
//  1) { items: [{ catalog_item_id, name, quantity, unit_price, ... }] }  (formato catalogo)
//  2) { description: "...testo libero..." }                              (fallback)
app.post('/api/c/orders', customerAuth, (req, res) => {
  try {
    const { date, delivery_type, delivery_time, delivery_address, items, description } = req.body || {};
    if (!date) {
      return res.status(400).json({ error: 'Data ordine obbligatoria' });
    }
    
    // Validazione input: devo avere items valido oppure description testuale
    const hasItems = Array.isArray(items) && items.length > 0;
    const hasDesc = description && String(description).trim() !== '';
    if (!hasItems && !hasDesc) {
      return res.status(400).json({ error: 'Aggiungi almeno un articolo al tuo ordine' });
    }
    
    // Costruzione description testuale leggibile + totale + righe strutturate
    let descText = '';
    let total = 0;
    let orderItems = [];
    
    if (hasItems) {
      const lines = [];
      items.forEach(it => {
        const qty = parseInt(it.quantity) || 0;
        if (qty <= 0) return;
        const unit = Number(it.unit_price) || 0;
        const name = String(it.name || '').trim();
        if (!name) return;
        const rowTotal = qty * unit;
        total += rowTotal;
        orderItems.push({
          catalog_item_id: it.catalog_item_id || null,
          name,
          category: String(it.category || '').trim(),
          photo_url: String(it.photo_url || '').trim(),
          quantity: qty,
          unit_price: unit
        });
        if (unit > 0) {
          lines.push(`${qty} × ${name} — € ${unit.toFixed(2)}/cad = € ${rowTotal.toFixed(2)}`);
        } else {
          lines.push(`${qty} × ${name}`);
        }
      });
      if (orderItems.length === 0) {
        return res.status(400).json({ error: 'Aggiungi almeno un articolo con quantità > 0' });
      }
      descText = lines.join('\n');
      if (total > 0) descText += `\n\nTotale indicativo: € ${total.toFixed(2)}`;
    } else {
      descText = String(description).trim();
    }
    
    const orderData = {
      date,
      customer: req.customer.name,
      description: descText,
      status: 'da_preparare',
      order_type: 'cliente',
      delivery_type: delivery_type === 'consegna' ? 'consegna' : 'ritiro',
      delivery_time: delivery_time || null,
      delivery_address: delivery_address || null,
      goods_type: 'da_ordinare',
      photos: [],
      customer_id: req.customer.id,
      customer_order_status: 'pending'
    };
    
    const order = db.createOrder(orderData, `cliente:${req.customer.name}`);
    
    // Salva righe strutturate + totale (best effort)
    if (orderItems.length > 0) {
      try {
        db.addOrderItems(order.id, orderItems);
        db.setOrderTotal(order.id, total);
      } catch (e) {
        console.error('Errore salvataggio order_items:', e);
      }
    }
    
    // Notifica push allo staff (non-bloccante)
    setImmediate(() => {
      const countLabel = orderItems.length > 0
        ? `${orderItems.length} ${orderItems.length === 1 ? 'articolo' : 'articoli'}`
        : 'ordine';
      sendNotificationToAll(
        '🆕 Nuovo ordine cliente',
        `${req.customer.name} · ${countLabel} · consegna ${date}`,
        'customer-order-new'
      );
    });
    
    res.status(201).json({ ...order, total_price: total });
  } catch (error) {
    console.error('Errore POST ordine cliente:', error);
    res.status(500).json({ error: 'Errore creazione ordine' });
  }
});

// ============================================
// ADMIN: gestione clienti (staff)
// ============================================

app.get('/api/customers', authenticate, (req, res) => {
  try {
    res.json(db.getAllCustomers());
  } catch (error) {
    console.error('Errore GET customers:', error);
    res.status(500).json({ error: 'Errore recupero clienti' });
  }
});

app.post('/api/customers', authenticate, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || String(body.name).trim() === '') {
      return res.status(400).json({ error: 'Nome cliente obbligatorio' });
    }
    const c = db.createCustomer(body);
    res.status(201).json(c);
  } catch (error) {
    console.error('Errore POST customer:', error);
    res.status(500).json({ error: 'Errore creazione cliente' });
  }
});

app.put('/api/customers/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = db.updateCustomer(id, req.body || {});
    if (!c) return res.status(404).json({ error: 'Cliente non trovato' });
    res.json(c);
  } catch (error) {
    console.error('Errore PUT customer:', error);
    res.status(500).json({ error: 'Errore aggiornamento cliente' });
  }
});

app.post('/api/customers/:id/regenerate-token', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const c = db.regenerateCustomerToken(id);
    if (!c) return res.status(404).json({ error: 'Cliente non trovato' });
    res.json(c);
  } catch (error) {
    console.error('Errore regen token:', error);
    res.status(500).json({ error: 'Errore rigenerazione token' });
  }
});

app.delete('/api/customers/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.deleteCustomer(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Errore DELETE customer:', error);
    res.status(500).json({ error: 'Errore eliminazione cliente' });
  }
});

// Ordini in attesa + approva / rifiuta
// (path evita conflitti con /api/orders/:id)
app.get('/api/admin/pending-orders', authenticate, (req, res) => {
  try {
    res.json(db.getPendingCustomerOrders());
  } catch (error) {
    console.error('Errore GET pending orders:', error);
    res.status(500).json({ error: 'Errore recupero ordini in attesa' });
  }
});

app.post('/api/orders/:id/approve', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    db.approveCustomerOrder(id, req.user.username);
    const o = db.getOrderById(id);
    res.json(o);
  } catch (error) {
    console.error('Errore approve order:', error);
    res.status(500).json({ error: 'Errore approvazione ordine' });
  }
});

app.post('/api/orders/:id/reject', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { reason } = req.body || {};
    db.rejectCustomerOrder(id, reason || '', req.user.username);
    const o = db.getOrderById(id);
    res.json(o);
  } catch (error) {
    console.error('Errore reject order:', error);
    res.status(500).json({ error: 'Errore rifiuto ordine' });
  }
});

// ============================================
// CATALOGO GIORNALIERO (staff)
// ============================================

// Helper: data di oggi YYYY-MM-DD
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/catalog?date=YYYY-MM-DD → articoli per quella data (vuoto se nessuno)
app.get('/api/catalog', authenticate, (req, res) => {
  try {
    const date = req.query.date || todayIso();
    res.json({ date, items: db.getCatalogByDate(date) });
  } catch (error) {
    console.error('Errore GET catalog:', error);
    res.status(500).json({ error: 'Errore recupero catalogo' });
  }
});

// GET /api/catalog/dates → storico date catalogo
app.get('/api/catalog/dates', authenticate, (req, res) => {
  try {
    res.json(db.getCatalogDates());
  } catch (error) {
    console.error('Errore GET catalog dates:', error);
    res.status(500).json({ error: 'Errore recupero date' });
  }
});

// POST /api/catalog/items → crea nuovo articolo
app.post('/api/catalog/items', authenticate, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name || String(body.name).trim() === '') {
      return res.status(400).json({ error: 'Nome articolo obbligatorio' });
    }
    if (!body.catalog_date) body.catalog_date = todayIso();
    const item = db.createCatalogItem(body, req.user.username);
    res.status(201).json(item);
  } catch (error) {
    console.error('Errore POST catalog item:', error);
    res.status(500).json({ error: 'Errore creazione articolo' });
  }
});

// PUT /api/catalog/items/:id → aggiorna articolo
app.put('/api/catalog/items/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = db.updateCatalogItem(id, req.body || {}, req.user.username);
    if (!item) return res.status(404).json({ error: 'Articolo non trovato' });
    res.json(item);
  } catch (error) {
    console.error('Errore PUT catalog item:', error);
    res.status(500).json({ error: 'Errore aggiornamento' });
  }
});

// DELETE /api/catalog/items/:id → elimina articolo (e foto se locale)
app.delete('/api/catalog/items/:id', authenticate, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const item = db.getCatalogItemById(id);
    if (!item) return res.status(404).json({ error: 'Articolo non trovato' });
    // Elimina foto fisica se è un /uploads locale
    if (item.photo_url && item.photo_url.startsWith('/uploads/')) {
      const filename = path.basename(item.photo_url);
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch { /* no-op */ }
      }
    }
    db.deleteCatalogItem(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Errore DELETE catalog item:', error);
    res.status(500).json({ error: 'Errore eliminazione' });
  }
});

// POST /api/catalog/duplicate → duplica catalogo da una data ad un'altra
// body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
app.post('/api/catalog/duplicate', authenticate, (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'Parametri from e to richiesti' });
    const copied = db.duplicateCatalog(from, to, req.user.username);
    if (copied === 0) {
      return res.status(400).json({ error: 'Nessun articolo duplicato (sorgente vuota o destinazione già popolata)' });
    }
    res.json({ success: true, copied });
  } catch (error) {
    console.error('Errore duplica catalogo:', error);
    res.status(500).json({ error: 'Errore duplicazione' });
  }
});

// POST /api/catalog/upload-photo → upload foto singola, riscrive a JPEG ottimizzato, ritorna URL
app.post('/api/catalog/upload-photo', authenticate, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessuna foto caricata' });
    
    const originalPath = req.file.path;
    const originalSize = req.file.size;
    
    // Post-processing server-side: max 1400px / JPEG 82% (gestisce anche HEIC e file non compressi client)
    try {
      const sharp = require('sharp');
      const baseName = path.basename(req.file.filename, path.extname(req.file.filename));
      const finalName = baseName + '.jpg';
      const finalPath = path.join(uploadsDir, finalName);
      
      await sharp(originalPath)
        .rotate() // rispetta orientamento EXIF
        .resize({
          width: 1400,
          height: 1400,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(finalPath);
      
      // Se il nome del file cambia (estensione era .png/.heic/.webp), rimuovo l'originale
      if (finalName !== req.file.filename) {
        try { fs.unlinkSync(originalPath); } catch {}
      }
      
      const newSize = fs.statSync(finalPath).size;
      const saved = originalSize > 0 ? Math.round((1 - newSize / originalSize) * 100) : 0;
      console.log(`📸 Foto catalogo ottimizzata: ${req.file.filename} → ${finalName} (${(originalSize/1024).toFixed(0)}KB → ${(newSize/1024).toFixed(0)}KB, -${saved}%)`);
      
      return res.json({ photo_url: `/uploads/${finalName}` });
    } catch (sharpError) {
      // Fallback: se sharp fallisce (formato non supportato, corruzione), ritorno l'originale
      console.warn('Sharp ha fallito, ritorno foto originale:', sharpError.message);
      return res.json({ photo_url: `/uploads/${req.file.filename}` });
    }
  } catch (error) {
    console.error('Errore upload foto catalogo:', error);
    res.status(500).json({ error: 'Errore upload' });
  }
});

// ============================================
// CATALOGO PUBBLICO (cliente, nessuna auth staff)
// ============================================

// GET /api/c/catalog → catalogo corrente (data più recente pubblicata)
app.get('/api/c/catalog', customerAuth, (req, res) => {
  try {
    const requestedDate = req.query.date;
    const date = requestedDate || db.getLatestCatalogDate() || todayIso();
    const items = db.getActiveCatalogByDate(date);
    res.json({ date, items });
  } catch (error) {
    console.error('Errore GET catalog cliente:', error);
    res.status(500).json({ error: 'Errore recupero catalogo' });
  }
});

// Serve l'app per tutte le altre route (deve essere l'ultima route)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Avvia server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Database inizializzato`);
  console.log(`\n🌸 Server ordini fiori avviato!`);
  console.log(`📱 Apri dal telefono: http://[IP-del-tuo-computer]:${PORT}`);
  console.log(`💻 Apri dal computer: http://localhost:${PORT}\n`);
  
  // Test volume persistente - Railway deploy
  console.log('🧪 Volume test: Database path =', process.env.DATABASE_PATH || './ordini.db');
  
  // Ottimizzazione automatica foto catalogo esistenti (non-bloccante, idempotente).
  // Gira una volta dopo l'avvio: foto già leggere vengono saltate grazie alla soglia.
  setTimeout(() => {
    autoOptimizeCatalogPhotos().catch(err => {
      console.warn('Auto-optimize foto: errore non critico:', err.message);
    });
  }, 5000);
});

// Auto-optimize: stessa logica di optimize-catalog-photos.js ma inline non-bloccante
async function autoOptimizeCatalogPhotos() {
  let sharp;
  try { sharp = require('sharp'); } catch { return; }
  
  const THRESHOLD_BYTES = 500 * 1024; // 500 KB
  const catalogDates = db.getCatalogDates();
  if (!catalogDates || catalogDates.length === 0) return;
  
  let allItems = [];
  for (const row of catalogDates) {
    const items = db.getCatalogByDate(row.catalog_date);
    allItems = allItems.concat(items);
  }
  const withPhoto = allItems.filter(i => i.photo_url && i.photo_url.startsWith('/uploads/'));
  if (withPhoto.length === 0) return;
  
  let optimized = 0;
  let totalSaved = 0;
  
  for (const item of withPhoto) {
    const filename = path.basename(item.photo_url);
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) continue;
    
    const stat = fs.statSync(filePath);
    if (stat.size <= THRESHOLD_BYTES) continue;
    
    const tmpPath = filePath + '.tmp';
    try {
      await sharp(filePath)
        .rotate()
        .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toFile(tmpPath);
      const newSize = fs.statSync(tmpPath).size;
      fs.renameSync(tmpPath, filePath);
      optimized++;
      totalSaved += (stat.size - newSize);
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
  }
  
  if (optimized > 0) {
    console.log(`📸 Auto-optimize foto: ${optimized} foto ottimizzate, risparmio ${(totalSaved/1024/1024).toFixed(1)} MB`);
  }
}

