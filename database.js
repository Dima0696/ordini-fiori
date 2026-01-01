const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Percorso database: usa variabile d'ambiente per Railway, altrimenti locale
const DB_PATH = process.env.DATABASE_PATH 
  ? path.join(process.env.DATABASE_PATH, 'ordini.db')
  : path.join(__dirname, 'ordini.db');

// Assicurati che la directory esista (per Railway volume)
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`📊 Database path: ${DB_PATH}`);

// Inizializza il database
const db = new Database(DB_PATH);

// Crea le tabelle se non esistono
const initDb = () => {
  const createOrdersTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      customer TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'da_preparare',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createUsersTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createSubscriptionsTableQuery = `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      keys TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, endpoint)
    )
  `;
  
  db.exec(createOrdersTableQuery);
  db.exec(createUsersTableQuery);
  db.exec(createSubscriptionsTableQuery);
  
  // Aggiungi utenti predefiniti se la tabella è vuota
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM users');
  const { count } = countStmt.get();
  
  if (count === 0) {
    const users = [
      { username: 'Massimo', password: '1234' },
      { username: 'Gianluca', password: '1234' },
      { username: 'Gigi', password: '1234' },
      { username: 'Carlo', password: '1234' },
      { username: 'Dimitri', password: '1234' },
      { username: 'Federica', password: '1234' }
    ];
    
    const insertStmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    users.forEach(user => {
      insertStmt.run(user.username, user.password);
    });
    
    console.log('✓ Utenti predefiniti creati');
  }
  
  console.log('✓ Database inizializzato');
};

// Ottieni tutti gli ordini
const getAllOrders = () => {
  const stmt = db.prepare('SELECT * FROM orders ORDER BY date DESC, created_at DESC');
  const orders = stmt.all();
  return orders.map(order => {
    if (order.photos) {
      try {
        order.photos = JSON.parse(order.photos);
      } catch (e) {
        order.photos = [];
      }
    }
    return order;
  });
};

// Ottieni ordini per data
const getOrdersByDate = (date) => {
  const stmt = db.prepare('SELECT * FROM orders WHERE date = ? ORDER BY created_at DESC');
  const orders = stmt.all(date);
  return orders.map(order => {
    if (order.photos) {
      try {
        order.photos = JSON.parse(order.photos);
      } catch (e) {
        order.photos = [];
      }
    }
    return order;
  });
};

// Ottieni singolo ordine
const getOrderById = (id) => {
  const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
  const order = stmt.get(id);
  if (order && order.photos) {
    try {
      order.photos = JSON.parse(order.photos);
    } catch (e) {
      order.photos = [];
    }
  }
  return order;
};

// Crea nuovo ordine
const createOrder = (orderData, username) => {
  const {
    date,
    customer,
    description,
    order_type = 'cliente',
    delivery_type = 'ritiro',
    delivery_time = null,
    delivery_address = null,
    goods_type = 'in_cella',
    photos = null
  } = orderData;
  
  const stmt = db.prepare(`
    INSERT INTO orders (
      date, customer, description, status,
      order_type, delivery_type, delivery_time, delivery_address, goods_type, photos,
      created_by, updated_by,
      created_at, updated_at
    )
    VALUES (?, ?, ?, 'da_preparare', ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  
  const photosJson = photos ? JSON.stringify(photos) : null;
  const info = stmt.run(
    date, customer, description,
    order_type, delivery_type, delivery_time, delivery_address, goods_type, photosJson,
    username, username
  );
  return getOrderById(info.lastInsertRowid);
};

// Aggiorna ordine
const updateOrder = (id, orderData, username) => {
  const {
    customer,
    description,
    status,
    order_type,
    delivery_type,
    delivery_time,
    delivery_address,
    goods_type,
    photos
  } = orderData;
  
  const stmt = db.prepare(`
    UPDATE orders 
    SET customer = ?, description = ?, status = ?,
        order_type = ?, delivery_type = ?, delivery_time = ?,
        delivery_address = ?, goods_type = ?, photos = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  
  const photosJson = photos ? JSON.stringify(photos) : null;
  stmt.run(
    customer, description, status,
    order_type, delivery_type, delivery_time, delivery_address, goods_type, photosJson,
    username,
    id
  );
  return getOrderById(id);
};

// Aggiorna solo lo stato
const updateOrderStatus = (id, status, username) => {
  const stmt = db.prepare(`
    UPDATE orders 
    SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(status, username, id);
  return getOrderById(id);
};

// Elimina ordine
const deleteOrder = (id) => {
  const stmt = db.prepare('DELETE FROM orders WHERE id = ?');
  const info = stmt.run(id);
  return info.changes > 0;
};

// Ottieni statistiche per giorno (conteggio ordini per stato)
const getOrdersCountByDate = () => {
  const stmt = db.prepare(`
    SELECT 
      date,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'da_preparare' THEN 1 ELSE 0 END) as da_preparare,
      SUM(CASE WHEN status = 'pronto' THEN 1 ELSE 0 END) as pronto,
      SUM(CASE WHEN status = 'ritirato' THEN 1 ELSE 0 END) as ritirato
    FROM orders
    GROUP BY date
    ORDER BY date DESC
  `);
  return stmt.all();
};

// Funzioni per autenticazione
const getUserByUsername = (username) => {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
};

const verifyUser = (username, password) => {
  const user = getUserByUsername(username);
  if (!user) return null;
  
  // Confronto diretto (password in chiaro per semplicità)
  if (user.password === password) {
    return { id: user.id, username: user.username };
  }
  
  return null;
};

// Push subscriptions
const saveSubscription = (username, subscription) => {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (username, endpoint, keys)
    VALUES (?, ?, ?)
  `);
  
  stmt.run(
    username,
    subscription.endpoint,
    JSON.stringify(subscription.keys)
  );
};

const getAllSubscriptions = () => {
  const subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
  return subscriptions.map(sub => ({
    username: sub.username,
    subscription: {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys)
    }
  }));
};

const deleteSubscription = (endpoint) => {
  const stmt = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  stmt.run(endpoint);
};

module.exports = {
  initDb,
  getAllOrders,
  getOrdersByDate,
  getOrderById,
  createOrder,
  updateOrder,
  updateOrderStatus,
  deleteOrder,
  getOrdersCountByDate,
  getUserByUsername,
  verifyUser,
  saveSubscription,
  getAllSubscriptions,
  deleteSubscription
};

