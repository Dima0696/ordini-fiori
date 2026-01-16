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

// Funzione per verificare se una colonna esiste
function columnExists(tableName, columnName) {
  try {
    const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return result.some(col => col.name === columnName);
  } catch (error) {
    return false;
  }
}

// Crea le tabelle se non esistono
const initDb = () => {
  const createOrdersTableQuery = `
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      customer TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'da_preparare',
      order_type TEXT DEFAULT 'cliente',
      delivery_type TEXT DEFAULT 'ritiro',
      delivery_time TEXT,
      delivery_address TEXT,
      goods_type TEXT DEFAULT 'in_cella',
      photos TEXT,
      created_by TEXT,
      updated_by TEXT,
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
  
  const createFabbisognoChecksTableQuery = `
    CREATE TABLE IF NOT EXISTS fabbisogno_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      line_number INTEGER NOT NULL,
      checked INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(order_id, line_number),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `;
  
  db.exec(createOrdersTableQuery);
  db.exec(createUsersTableQuery);
  db.exec(createSubscriptionsTableQuery);
  db.exec(createFabbisognoChecksTableQuery);
  
  // Crea indici per performance
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_date_status ON orders(date, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_goods_type ON orders(goods_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fabbisogno_order ON fabbisogno_checks(order_id)');
    console.log('✓ Indici database creati per performance');
  } catch (error) {
    console.log('⚠️ Indici già esistenti');
  }
  
  // Migrazione schema: aggiungi colonne mancanti alla tabella orders esistente
  const columnsToAdd = [
    { name: 'order_type', type: 'TEXT DEFAULT "cliente"' },
    { name: 'delivery_type', type: 'TEXT DEFAULT "ritiro"' },
    { name: 'delivery_time', type: 'TEXT' },
    { name: 'delivery_address', type: 'TEXT' },
    { name: 'goods_type', type: 'TEXT DEFAULT "in_cella"' },
    { name: 'photos', type: 'TEXT' },
    { name: 'created_by', type: 'TEXT' },
    { name: 'updated_by', type: 'TEXT' }
  ];
  
  columnsToAdd.forEach(col => {
    if (!columnExists('orders', col.name)) {
      try {
        db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`);
        console.log(`✅ Aggiunta colonna: ${col.name}`);
      } catch (error) {
        console.error(`⚠️  Errore aggiungendo ${col.name}:`, error.message);
      }
    }
  });
  
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
    status = 'da_preparare',
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  
  const photosJson = photos ? JSON.stringify(photos) : null;
  const info = stmt.run(
    date, customer, description, status,
    order_type, delivery_type, delivery_time, delivery_address, goods_type, photosJson,
    username, username
  );
  return getOrderById(info.lastInsertRowid);
};

// Aggiorna ordine
const updateOrder = (id, orderData, username) => {
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
  } = orderData;
  
  // Se la data è presente, aggiornala; altrimenti mantieni la vecchia
  let updateQuery = `
    UPDATE orders 
    SET customer = ?, description = ?, status = ?,
        order_type = ?, delivery_type = ?, delivery_time = ?,
        delivery_address = ?, goods_type = ?, photos = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
  `;
  
  const params = [
    customer, description, status,
    order_type, delivery_type, delivery_time, delivery_address, goods_type, 
    photos ? JSON.stringify(photos) : null,
    username
  ];
  
  // Aggiungi date se presente
  if (date) {
    updateQuery = `
      UPDATE orders 
      SET date = ?, customer = ?, description = ?, status = ?,
          order_type = ?, delivery_type = ?, delivery_time = ?,
          delivery_address = ?, goods_type = ?, photos = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
    `;
    params.unshift(date); // Aggiungi date all'inizio
  }
  
  updateQuery += ` WHERE id = ?`;
  params.push(id);
  
  const stmt = db.prepare(updateQuery);
  stmt.run(...params);
  
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

// Ottieni statistiche per giorno (conteggio ordini per stato + nomi clienti)
const getOrdersCountByDate = () => {
  const stmt = db.prepare(`
    SELECT 
      date,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'da_preparare' THEN 1 ELSE 0 END) as da_preparare,
      SUM(CASE WHEN status = 'pronto' THEN 1 ELSE 0 END) as pronto,
      SUM(CASE WHEN status = 'ritirato' THEN 1 ELSE 0 END) as ritirato,
      GROUP_CONCAT(customer, '|') as customers
    FROM orders
    GROUP BY date
    ORDER BY date DESC
  `);
  
  const results = stmt.all();
  
  // Converti stringa customers in array
  return results.map(row => ({
    ...row,
    customers: row.customers ? row.customers.split('|') : []
  }));
};

// Ricerca ordini per cliente o descrizione (con limite temporale, esclusi ritirati)
const searchOrders = (searchTerm, startDate, endDate) => {
  try {
    console.log('[DB] searchOrders chiamato:', { searchTerm, startDate, endDate });
    
    if (!db) {
      throw new Error('Database non inizializzato');
    }
    
    const stmt = db.prepare(`
      SELECT 
        id, date, customer, description, status,
        order_type, delivery_type, delivery_time, delivery_address,
        goods_type, photos, created_by, updated_by, updated_at
      FROM orders
      WHERE (
        customer LIKE ? OR description LIKE ?
      )
      AND status != 'ritirato'
      AND date >= ? AND date <= ?
      ORDER BY date ASC, customer ASC
    `);
    
    const searchPattern = `%${searchTerm}%`;
    console.log('[DB] searchPattern:', searchPattern);
    
    const results = stmt.all(searchPattern, searchPattern, startDate, endDate);
    console.log('[DB] Risultati trovati:', results.length);
    
    // Deserializza photos
    const mappedResults = results.map(row => ({
      ...row,
      photos: row.photos ? JSON.parse(row.photos) : []
    }));
    
    return mappedResults;
  } catch (error) {
    console.error('[DB] Errore in searchOrders:', error);
    throw error;
  }
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

// Funzioni per gestire i checkbox del fabbisogno
const getFabbisognoChecks = (orderId) => {
  console.log('🔵 DB getFabbisognoChecks: orderId=', orderId);
  const stmt = db.prepare('SELECT line_number, checked FROM fabbisogno_checks WHERE order_id = ?');
  const checks = stmt.all(orderId);
  console.log('🔵 DB RAW checks:', checks);
  // Restituisci un oggetto { lineNumber: checked }
  const result = {};
  checks.forEach(c => {
    result[c.line_number] = c.checked === 1;
  });
  console.log('🟢 DB RESULT:', result);
  return result;
};

const toggleFabbisognoCheck = (orderId, lineNumber) => {
  console.log('🔵 DB toggleFabbisognoCheck: orderId=', orderId, 'lineNumber=', lineNumber);
  
  try {
    // Usa una transaction per garantire atomicità
    const toggle = db.transaction(() => {
      try {
        // Prima verifica se esiste già
        const checkStmt = db.prepare('SELECT checked FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?');
        const existing = checkStmt.get(orderId, lineNumber);
        console.log('🔵 DB existing:', existing);
        
        if (existing) {
          // Esiste: toggle
          const newChecked = existing.checked === 1 ? 0 : 1;
          console.log('🟡 DB TOGGLE:', existing.checked, '→', newChecked);
          const updateStmt = db.prepare('UPDATE fabbisogno_checks SET checked = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?');
          const info = updateStmt.run(newChecked, orderId, lineNumber);
          console.log('🟢 DB UPDATED in transaction, changes:', info.changes);
          return newChecked === 1;
        } else {
          // Non esiste: crea con checked = 1
          console.log('🟡 DB INSERT nuovo record checked=1');
          const insertStmt = db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked) VALUES (?, ?, 1)');
          const info = insertStmt.run(orderId, lineNumber);
          console.log('🟢 DB INSERTED in transaction, lastInsertRowid:', info.lastInsertRowid);
          return true;
        }
      } catch (innerError) {
        console.error('❌ DB ERROR in transaction:', innerError);
        throw innerError;
      }
    });
    
    // Esegui transaction e restituisci risultato
    const result = toggle();
    console.log('🟢 DB TRANSACTION COMMITTED, result:', result);
    
    // Verifica immediatamente che il salvataggio sia andato a buon fine
    const verify = db.prepare('SELECT checked FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);
    console.log('🔍 DB VERIFY dopo commit:', verify);
    
    return result;
  } catch (error) {
    console.error('❌ DB toggleFabbisognoCheck ERROR:', error);
    console.error('Stack:', error.stack);
    throw error;
  }
};

// Set checkbox a valore specifico (non toggle)
const setFabbisognoCheck = (orderId, lineNumber, checked) => {
  console.log('🔵 DB setFabbisognoCheck: orderId=', orderId, 'lineNumber=', lineNumber, 'checked=', checked);
  
  const checkedInt = checked ? 1 : 0;
  
  try {
    const upsert = db.transaction(() => {
      const existing = db.prepare('SELECT checked FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);
      
      if (existing) {
        // Esiste: update
        const stmt = db.prepare('UPDATE fabbisogno_checks SET checked = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?');
        stmt.run(checkedInt, orderId, lineNumber);
        console.log('🟢 DB UPDATED to', checkedInt);
      } else {
        // Non esiste: insert
        const stmt = db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked) VALUES (?, ?, ?)');
        stmt.run(orderId, lineNumber, checkedInt);
        console.log('🟢 DB INSERTED with', checkedInt);
      }
    });
    
    upsert();
    return checked;
  } catch (error) {
    console.error('❌ DB setFabbisognoCheck ERROR:', error);
    throw error;
  }
};

const clearFabbisognoChecks = (orderId) => {
  const stmt = db.prepare('DELETE FROM fabbisogno_checks WHERE order_id = ?');
  stmt.run(orderId);
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
  searchOrders,
  getUserByUsername,
  verifyUser,
  saveSubscription,
  getAllSubscriptions,
  deleteSubscription,
  getFabbisognoChecks,
  toggleFabbisognoCheck,
  setFabbisognoCheck,
  clearFabbisognoChecks
};

