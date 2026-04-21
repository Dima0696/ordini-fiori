const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const webpush = require('web-push');
const cron = require('node-cron');
const db = require('./database');
const pushConfig = require('./push-config');

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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Se su Railway, servi anche le foto dal volume
if (process.env.DATABASE_PATH) {
  app.use('/uploads', express.static(uploadsDir));
  console.log(`📸 Serving uploads from volume: ${uploadsDir}`);
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
      photos
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
    
    // Invia notifica a tutti (non-bloccante) - TEMPORANEAMENTE DISATTIVATO
    // const deliveryInfo = delivery_type === 'consegna' && delivery_time 
    //   ? ` - Consegna ore ${delivery_time}`
    //   : '';
    // setImmediate(() => {
    //   sendNotificationToAll(
    //     '📦 Nuovo Ordine',
    //     `${customer} - ${date}${deliveryInfo}`,
    //     'new-order'
    //   );
    // });
    
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
      photos
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
      // Invia notifica modifica (non-bloccante) - TEMPORANEAMENTE DISATTIVATO
      // setImmediate(() => {
      //   sendNotificationToAll(
      //     '✏️ Ordine Modificato',
      //     `${customer} - aggiornato`,
      //     'order-update'
      //   );
      // });
      
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
      // Invia notifica in base allo stato (non-bloccante) - TEMPORANEAMENTE DISATTIVATO
      // if (status === 'pronto') {
      //   setImmediate(() => {
      //     sendNotificationToAll(
      //       '✅ Ordine Pronto',
      //       `${order.customer} - pronto per il ritiro`,
      //       'order-ready'
      //     );
      //   });
      // } else if (status === 'ritirato') {
      //   setImmediate(() => {
      //     sendNotificationToAll(
      //       '🎉 Ordine Ritirato',
      //       `${order.customer} - ritirato`,
      //       'order-completed'
      //     );
      //   });
      // }
      
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
    // Prima ottieni l'ordine per eliminare le foto
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

// Funzione generica per inviare notifiche a tutti
async function sendNotificationToAll(title, body, tag = 'order-update') {
  try {
    const payload = JSON.stringify({
      title,
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag,
      requireInteraction: false
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
    
    console.log(`📬 Notifica "${title}" inviata a ${sent} utenti`);
  } catch (error) {
    console.error('Errore invio notifica:', error);
  }
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

// POST /api/catalog/upload-photo → upload foto singola, ritorna URL
app.post('/api/catalog/upload-photo', authenticate, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nessuna foto caricata' });
    res.json({ photo_url: `/uploads/${req.file.filename}` });
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
});

