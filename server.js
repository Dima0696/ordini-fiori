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
  'mailto:info@lombardaflor.it',
  pushConfig.vapidKeys.publicKey,
  pushConfig.vapidKeys.privateKey
);

// Configura Web Push
webpush.setVapidDetails(
  'mailto:info@lombardaflor.it',
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
    res.status(500).json({ error: 'Errore nel recupero degli ordini' });
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
      order_type,
      delivery_type,
      delivery_time,
      delivery_address,
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
      order_type: order_type || 'cliente',
      delivery_type: delivery_type || 'ritiro',
      delivery_time: delivery_time || null,
      delivery_address: delivery_address || null,
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
      order_type,
      delivery_type,
      delivery_time,
      delivery_address,
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
      date: date || null, // AGGIUNGI: permetti modifica data
      customer,
      description,
      status,
      order_type: order_type || 'cliente',
      delivery_type: delivery_type || 'ritiro',
      delivery_time: delivery_time || null,
      delivery_address: delivery_address || null,
      goods_type: goods_type || 'in_cella',
      photos: photos || []
    };
    
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

// GET /api/stats/dates - Ottieni statistiche per date (per il calendario)
app.get('/api/stats/dates', (req, res) => {
  try {
    const stats = db.getOrdersCountByDate();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Errore nel recupero delle statistiche' });
  }
});

// GET /api/orders/search - Ricerca ordini per cliente o descrizione
app.get('/api/orders/search', authenticate, (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.json([]);
    }
    
    const searchTerm = q.trim();
    
    // Calcola date limite: -7 giorni, +21 giorni da oggi
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 7);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 21);
    
    // Formatta date manualmente per evitare problemi
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    console.log(`Ricerca: "${searchTerm}" dal ${startDateStr} al ${endDateStr}`);
    
    const orders = db.searchOrders(searchTerm, startDateStr, endDateStr);
    
    console.log(`Trovati ${orders.length} ordini`);
    
    res.json(orders);
  } catch (error) {
    console.error('Errore ricerca ordini:', error);
    res.status(500).json({ error: 'Errore nella ricerca degli ordini', details: error.message });
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

// Scheduler: ogni giorno alle 6:30 - TEMPORANEAMENTE DISATTIVATO
// cron.schedule(`${pushConfig.notificationTime.minute} ${pushConfig.notificationTime.hour} * * *`, () => {
//   console.log('⏰ Invio notifiche giornaliere...');
//   sendDailyNotifications();
// }, {
//   timezone: "Europe/Rome"
// });

console.log(`⏰ Notifiche TEMPORANEAMENTE DISATTIVATE per testing`);

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
});

