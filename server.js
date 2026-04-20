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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Solo immagini sono permesse (jpeg, jpg, png, gif, webp)'));
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
    const { totalLines, type } = req.body;
    
    if (!totalLines || totalLines < 1) {
      return res.status(400).json({ error: 'totalLines richiesto' });
    }
    
    for (let i = 0; i < totalLines; i++) {
      if (type === 'prepared') {
        db.setFabbisognoPrepared(orderId, i, true);
      } else {
        db.setFabbisognoCheck(orderId, i, true);
      }
    }
    
    res.json({ success: true, checked: totalLines, type: type || 'checked' });
  } catch (error) {
    console.error('❌ Errore check-all:', error);
    res.status(500).json({ error: 'Errore check-all' });
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

