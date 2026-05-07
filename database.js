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
  
  const createListiniTableQuery = `
    CREATE TABLE IF NOT EXISTS listini (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createCatalogItemsTableQuery = `
    CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_date TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      price REAL DEFAULT 0,
      min_quantity INTEGER DEFAULT 1,
      availability TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_by TEXT,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createOrderItemsTableQuery = `
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      catalog_item_id INTEGER,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `;
  
  const createCustomersTableQuery = `
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      login_token TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `;
  
  const createCustomerAddressesTableQuery = `
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      label TEXT DEFAULT '',
      street TEXT DEFAULT '',
      city TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      is_default INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `;
  
  const createPreventiviTableQuery = `
    CREATE TABLE IF NOT EXISTS preventivi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT,
      cliente TEXT NOT NULL,
      ragione_sociale TEXT DEFAULT '',
      luogo_consegna TEXT DEFAULT '',
      indirizzo_consegna TEXT DEFAULT '',
      data_preventivo TEXT NOT NULL,
      data_consegna TEXT DEFAULT '',
      oggetto TEXT DEFAULT 'Preventivo offerta',
      items TEXT NOT NULL DEFAULT '[]',
      totale REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_by TEXT,
      updated_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  // Anagrafica master degli articoli (importata dal gestionale).
  // match_key è la chiave canonica (UPPERCASE, senza accenti) usata per:
  //  - garantire unicità
  //  - confronto veloce dal frontend (i checks la salvano come stringa)
  const createArticoliMasterTableQuery = `
    CREATE TABLE IF NOT EXISTS articoli_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      qualita TEXT DEFAULT '',
      nome_norm TEXT NOT NULL,
      qualita_norm TEXT DEFAULT '',
      match_key TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  db.exec(createOrdersTableQuery);
  db.exec(createUsersTableQuery);
  db.exec(createSubscriptionsTableQuery);
  db.exec(createFabbisognoChecksTableQuery);
  db.exec(createListiniTableQuery);
  db.exec(createPreventiviTableQuery);
  db.exec(createCustomersTableQuery);
  db.exec(createCustomerAddressesTableQuery);
  db.exec(createCatalogItemsTableQuery);
  db.exec(createOrderItemsTableQuery);
  db.exec(createArticoliMasterTableQuery);
  
  // Crea indici per performance
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_date_status ON orders(date, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_goods_type ON orders(goods_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fabbisogno_order ON fabbisogno_checks(order_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_preventivi_data ON preventivi(data_preventivo DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_preventivi_cliente ON preventivi(cliente)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_token ON customers(login_token)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(active)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_customer_addresses_cust ON customer_addresses(customer_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer_status ON orders(customer_order_status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_items_date ON catalog_items(catalog_date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_catalog_items_active ON catalog_items(active)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_articoli_master_nome_norm ON articoli_master(nome_norm)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_articoli_master_match_key ON articoli_master(match_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_fabbisogno_match_key ON fabbisogno_checks(match_key)');
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

  // Migrazione: aggiunge colonna 'prepared' a fabbisogno_checks
  if (!columnExists('fabbisogno_checks', 'prepared')) {
    try {
      db.exec('ALTER TABLE fabbisogno_checks ADD COLUMN prepared INTEGER DEFAULT 0');
      console.log('✅ Aggiunta colonna: prepared (fabbisogno_checks)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo prepared:', error.message);
    }
  }

  // Migrazione: aggiunge colonna 'supplier' a fabbisogno_checks (NL, ITA, IMPORT)
  if (!columnExists('fabbisogno_checks', 'supplier')) {
    try {
      db.exec("ALTER TABLE fabbisogno_checks ADD COLUMN supplier TEXT DEFAULT ''");
      console.log('✅ Aggiunta colonna: supplier (fabbisogno_checks)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo supplier:', error.message);
    }
  }

  // Migrazione: aggiunge colonna 'match_key' a fabbisogno_checks
  // (riferimento all'articolo dell'anagrafica master, formato "NOME|QUALITA" già normalizzato)
  if (!columnExists('fabbisogno_checks', 'match_key')) {
    try {
      db.exec("ALTER TABLE fabbisogno_checks ADD COLUMN match_key TEXT DEFAULT ''");
      console.log('✅ Aggiunta colonna: match_key (fabbisogno_checks)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo match_key:', error.message);
    }
  }
  
  // Migrazione: aggiunge colonna 'oggetto' a preventivi (testo editabile)
  if (!columnExists('preventivi', 'oggetto')) {
    try {
      db.exec("ALTER TABLE preventivi ADD COLUMN oggetto TEXT DEFAULT 'Preventivo offerta'");
      console.log('✅ Aggiunta colonna: oggetto (preventivi)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo oggetto:', error.message);
    }
  }
  
  // Migrazione: aggiunge customer_id e customer_order_status a orders
  if (!columnExists('orders', 'customer_id')) {
    try {
      db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER');
      console.log('✅ Aggiunta colonna: customer_id (orders)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo customer_id:', error.message);
    }
  }
  if (!columnExists('orders', 'customer_order_status')) {
    try {
      db.exec("ALTER TABLE orders ADD COLUMN customer_order_status TEXT");
      console.log('✅ Aggiunta colonna: customer_order_status (orders)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo customer_order_status:', error.message);
    }
  }
  if (!columnExists('orders', 'customer_reject_reason')) {
    try {
      db.exec("ALTER TABLE orders ADD COLUMN customer_reject_reason TEXT DEFAULT ''");
      console.log('✅ Aggiunta colonna: customer_reject_reason (orders)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo customer_reject_reason:', error.message);
    }
  }
  if (!columnExists('orders', 'total_price')) {
    try {
      db.exec('ALTER TABLE orders ADD COLUMN total_price REAL DEFAULT 0');
      console.log('✅ Aggiunta colonna: total_price (orders)');
    } catch (error) {
      console.error('⚠️ Errore aggiungendo total_price:', error.message);
    }
  }
  
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

// Ottieni ordini per range di date
const getOrdersByDateRange = (dateFrom, dateTo) => {
  const stmt = db.prepare('SELECT * FROM orders WHERE date >= ? AND date <= ? ORDER BY date ASC, created_at DESC');
  const orders = stmt.all(dateFrom, dateTo);
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
    photos = null,
    customer_id = null,
    customer_order_status = null
  } = orderData;
  
  const stmt = db.prepare(`
    INSERT INTO orders (
      date, customer, description, status,
      order_type, delivery_type, delivery_time, delivery_address, goods_type, photos,
      customer_id, customer_order_status,
      created_by, updated_by,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  
  const photosJson = photos ? JSON.stringify(photos) : null;
  const info = stmt.run(
    date, customer, description, status,
    order_type, delivery_type, delivery_time, delivery_address, goods_type, photosJson,
    customer_id, customer_order_status,
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
  const stmt = db.prepare('SELECT line_number, checked, prepared, supplier, match_key FROM fabbisogno_checks WHERE order_id = ?');
  const checks = stmt.all(orderId);
  const result = {};
  checks.forEach(c => {
    result[c.line_number] = {
      checked: c.checked === 1,
      prepared: (c.prepared || 0) === 1,
      supplier: c.supplier || '',
      matchKey: c.match_key || ''
    };
  });
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
        const info = stmt.run(checkedInt, orderId, lineNumber);
        console.log('🟢 DB UPDATED to', checkedInt, 'changes:', info.changes);
      } else {
        // Non esiste: insert
        const stmt = db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked) VALUES (?, ?, ?)');
        const info = stmt.run(orderId, lineNumber, checkedInt);
        console.log('🟢 DB INSERTED with', checkedInt, 'lastInsertRowid:', info.lastInsertRowid);
      }
    });
    
    upsert();
    
    // VERIFICA: Rileggi dal DB per confermare
    const verification = db.prepare('SELECT checked FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);
    console.log('✅ DB VERIFICA DOPO SAVE:', verification);
    
    if (!verification || verification.checked !== checkedInt) {
      console.error('❌ VERIFICA FALLITA! Atteso:', checkedInt, 'Trovato:', verification);
      throw new Error('Salvataggio non verificato');
    }
    
    return checked;
  } catch (error) {
    console.error('❌ DB setFabbisognoCheck ERROR:', error);
    throw error;
  }
};

// Set campo prepared (preparato) a valore specifico
const setFabbisognoPrepared = (orderId, lineNumber, prepared) => {
  const preparedInt = prepared ? 1 : 0;

  try {
    const upsert = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);

      if (existing) {
        db.prepare('UPDATE fabbisogno_checks SET prepared = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?')
          .run(preparedInt, orderId, lineNumber);
      } else {
        db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked, prepared) VALUES (?, ?, 0, ?)')
          .run(orderId, lineNumber, preparedInt);
      }
    });

    upsert();
    return prepared;
  } catch (error) {
    console.error('❌ DB setFabbisognoPrepared ERROR:', error);
    throw error;
  }
};

// Set fornitore (NL, ITA, IMPORT, '')
const setFabbisognoSupplier = (orderId, lineNumber, supplier) => {
  const validSupplier = ['NL', 'ITA', 'IMPORT', ''].includes(supplier) ? supplier : '';
  
  try {
    const upsert = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);

      if (existing) {
        db.prepare('UPDATE fabbisogno_checks SET supplier = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?')
          .run(validSupplier, orderId, lineNumber);
      } else {
        db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked, prepared, supplier) VALUES (?, ?, 0, 0, ?)')
          .run(orderId, lineNumber, validSupplier);
      }
    });

    upsert();
    return validSupplier;
  } catch (error) {
    console.error('❌ DB setFabbisognoSupplier ERROR:', error);
    throw error;
  }
};

// ============================================
// Anagrafica articoli (master) + matching
// ============================================

// Normalizza una stringa per ricerca/confronto:
//  - upper case
//  - rimuove accenti
//  - collassa spazi multipli
//  - rimuove caratteri non alfanumerici tranne spazi, /, +
const normalizeText = (s) => {
  if (!s) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s/+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Costruisce la match_key canonica da nome + qualità.
// Formato: "NOME|QUALITA" (qualità può essere vuota → "NOME|")
const buildMatchKey = (nome, qualita) => {
  const n = normalizeText(nome);
  const q = normalizeText(qualita);
  return `${n}|${q}`;
};

// Spezza il testo normalizzato in token (parole) significativi.
// Filtra parole troppo corte (lunghe < 2) o stop-word italiane comuni.
// Include unità di misura/confezione (mazzi, pacchetti, ecc.) che non
// portano informazione utile al matching del nome dell'articolo.
// Stop-words italiane comuni + unità di confezione/quantità + descrittori
// non discriminanti. NON includere parole che sono qualità reali in anagrafica
// (es. EXTRA, PRIMA, SUPER, SECONDA): vanno conservate come token significativi.
const STOP_WORDS = new Set([
  'DI', 'DA', 'DE', 'IL', 'LA', 'LO', 'LE', 'GLI', 'A', 'AL', 'CON', 'PER', 'IN', 'E', 'O',
  'CM', 'GR', 'MM', 'KG', 'PZ',
  'MAZZO', 'MAZZI', 'STELO', 'STELI', 'PEZZO', 'PEZZI', 'PACCHETTO', 'PACCHETTI', 'PACCHI', 'PACCO',
  'BUNCH', 'BUNCHES', 'CASSE', 'CASSA', 'SCATOLA', 'SCATOLE', 'SCATOLONE',
  // Descrittori sfumati dei clienti (raramente in anagrafica come parte del nome)
  'GRANDI', 'GRANDE', 'PICCOLO', 'PICCOLA', 'PICCOLI', 'PICCOLE',
  'CORTO', 'CORTA', 'CORTI', 'CORTE', 'LUNGO', 'LUNGA', 'LUNGHI', 'LUNGHE',
  'INTENSO', 'INTENSA', 'TENUE', 'PASTELLO', 'CHIARO', 'CHIARA', 'SCURO', 'SCURA',
  'GAMBO', 'FOGLIA', 'FOGLIE', 'FIORE', 'FIORI',
]);
const tokenize = (s) => {
  return normalizeText(s)
    .split(' ')
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
};

// Tokenizza una RIGA D'ORDINE (con quantità all'inizio).
// Differenza con tokenize: rimuove il primo token se è un numero (= quantità)
// ma conserva eventuali numeri successivi (= qualità tipo "70" in "70 CM").
const tokenizeOrderLine = (line) => {
  const tokens = tokenize(line);
  if (tokens.length === 0) return [];
  if (/^\d+$/.test(tokens[0])) return tokens.slice(1);
  return tokens;
};

// Inserisce/aggiorna in batch un set di articoli master.
// items: [{ nome, qualita }]
// Idempotente: la chiave è match_key.
// Ritorna { inserted, skipped } per logging.
const upsertArticoliMaster = (items) => {
  let inserted = 0;
  let skipped = 0;
  const stmt = db.prepare(`
    INSERT INTO articoli_master (nome, qualita, nome_norm, qualita_norm, match_key)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(match_key) DO NOTHING
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const nome = (r.nome || '').trim();
      if (!nome) { skipped++; continue; }
      const qualita = (r.qualita || '').trim();
      const matchKey = buildMatchKey(nome, qualita);
      const info = stmt.run(nome, qualita, normalizeText(nome), normalizeText(qualita), matchKey);
      if (info.changes > 0) inserted++; else skipped++;
    }
  });
  tx(items);
  return { inserted, skipped };
};

const countArticoliMaster = () => {
  return db.prepare('SELECT COUNT(*) as c FROM articoli_master').get().c;
};

const clearArticoliMaster = () => {
  db.prepare('DELETE FROM articoli_master').run();
};

// Cerca articoli per nome (e opzionalmente qualità).
// q può essere il testo che digita l'utente o una riga di ordine intera.
// Ritorna fino a `limit` candidati ordinati per "rilevanza".
//
// Logica:
//  1. Filtro AND in SQL: ogni token della query deve essere SOSTRINGA del
//     testo "nome + qualità" dell'articolo. Così cerca prefissi parziali
//     (es. "schne" matcha "SCHNEEBALL"), accenti già rimossi nei _norm.
//  2. Scoring per ranking:
//     +1.0 per ogni token presente come parola intera
//     +0.6 per ogni token presente come prefisso di una parola
//     +0.3 per ogni token presente solo come substring nel testo
//     +1.0 bonus se TUTTI i token sono parole intere
//     -0.005*len bonus negativo per nomi molto lunghi (preferenza nomi corti)
//  3. Fallback: se l'AND non trova nulla, prova OR sul token più lungo
//     così la ricerca non resta vuota se l'utente sbaglia leggermente
//     (e l'utente può cancellare e riscrivere altri termini).
const searchArticoli = (q, limit = 50) => {
  let tokens = tokenize(q);
  // Fallback per query molto corte (es. 1 carattere, o solo stop-word):
  // usa direttamente il testo normalizzato come singolo token.
  if (tokens.length === 0) {
    const raw = normalizeText(q);
    if (raw.length >= 1) tokens = [raw];
  }
  if (tokens.length === 0) return [];
  
  const allTextExpr = `(nome_norm || ' ' || qualita_norm)`;
  const runQuery = (mode) => {
    let where, params;
    if (mode === 'AND') {
      where = tokens.map(() => `${allTextExpr} LIKE ?`).join(' AND ');
      params = tokens.map(t => `%${t}%`);
    } else {
      // OR sul token più lungo (fallback)
      const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
      where = `${allTextExpr} LIKE ?`;
      params = [`%${longest}%`];
    }
    return db.prepare(`
      SELECT id, nome, qualita, nome_norm, qualita_norm, match_key
      FROM articoli_master
      WHERE ${where}
      LIMIT 800
    `).all(...params);
  };
  
  let rows = runQuery('AND');
  if (rows.length === 0) rows = runQuery('OR');
  if (rows.length === 0) return [];
  
  const scored = [];
  for (const r of rows) {
    const allText = `${r.nome_norm} ${r.qualita_norm}`;
    const articleTokens = tokenize(allText);
    const articleTokenSet = new Set(articleTokens);
    
    let exactCount = 0;
    let score = 0;
    for (const t of tokens) {
      if (articleTokenSet.has(t)) {
        score += 1.0;
        exactCount++;
      } else if (articleTokens.some(at => at.startsWith(t))) {
        score += 0.6;
      } else if (allText.includes(t)) {
        score += 0.3;
      } else {
        // Token assente del tutto: penalizza ma non escludere
        score -= 0.4;
      }
    }
    if (exactCount === tokens.length && tokens.length > 0) score += 1.0;
    score -= Math.min(0.3, (r.nome_norm.length / 200));
    scored.push({ ...r, score, exactCount });
  }
  
  // Filtra solo i candidati con almeno qualche match (score positivo)
  const positives = scored.filter(s => s.score > 0);
  const ranked = positives.length > 0 ? positives : scored;
  
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: nome più corto prima (più specifico)
    return a.nome_norm.length - b.nome_norm.length;
  });
  
  return ranked.slice(0, limit).map(r => ({
    id: r.id,
    nome: r.nome,
    qualita: r.qualita,
    matchKey: r.match_key,
    score: r.score
  }));
};

// Verifica che una matchKey sia valida.
// Sono valide:
//  - matchKey esatta presente in articoli_master
//  - matchKey "famiglia" del tipo "NOME|" dove NOME esiste come nome_norm
//    (significa "qualsiasi qualità di NOME")
const articoloExistsByMatchKey = (matchKey) => {
  if (!matchKey) return false;
  const exact = db.prepare('SELECT 1 FROM articoli_master WHERE match_key = ?').get(matchKey);
  if (exact) return true;
  // Family key: "NOME|" o "NOME"
  const idx = matchKey.indexOf('|');
  const nameNorm = idx >= 0 ? matchKey.slice(0, idx) : matchKey;
  const qual = idx >= 0 ? matchKey.slice(idx + 1) : '';
  if (qual === '' && nameNorm) {
    const family = db.prepare('SELECT 1 FROM articoli_master WHERE nome_norm = ? LIMIT 1').get(nameNorm);
    return !!family;
  }
  return false;
};

// Estrae la "parte nome" da una matchKey (utile per raggruppare).
const matchKeyName = (matchKey) => {
  if (!matchKey) return '';
  const idx = matchKey.indexOf('|');
  return idx >= 0 ? matchKey.slice(0, idx) : matchKey;
};

// Match automatico CONSERVATIVO per una singola riga di ordine.
// Ritorna la matchKey solo se UNA SOLA coppia anagrafica copre TUTTI i token
// significativi del nome dell'articolo (qualsiasi qualità). Altrimenti ''.
//
// Logica conservativa:
//  1) Estrae i token dalla riga (escludendo numeri puri = quantità)
//  2) Trova tutti i nomi master i cui token sono SOTTOINSIEME dei token riga
//     (quindi la riga "100 rose free spirit 70" copre "ROSE FREE SPIRIT")
//  3) Tra questi, prende il nome con più token (più specifico)
//  4) Se più articoli condividono lo stesso nome (qualità diverse), prova a
//     vedere se c'è una qualità che matcha la riga; altrimenti torna match
//     solo se esiste una sola variante di qualità o se una è "vuota"
const autoMatchLine = (line) => {
  if (!line) return '';
  // Token della riga: rimuove la quantità iniziale ma conserva eventuali numeri
  // successivi (es. "70" in "ROSE FREEDOM 70 CM" è la qualità).
  const lineTokens = tokenizeOrderLine(line);
  if (lineTokens.length === 0) return '';
  const lineTokenSet = new Set(lineTokens);
  
  // Carica tutti i nomi distinti dell'anagrafica e i loro token.
  // 4141 nomi distinti, basta una query (cached idealmente, ma 4k righe è ok).
  const allArticles = db.prepare('SELECT id, nome, qualita, nome_norm, qualita_norm, match_key FROM articoli_master').all();
  
  // Raggruppa per nome → tutte le qualità
  const byName = new Map();
  for (const a of allArticles) {
    if (!byName.has(a.nome_norm)) byName.set(a.nome_norm, []);
    byName.get(a.nome_norm).push(a);
  }
  
  // Trova nomi i cui token sono interamente contenuti nella riga
  const candidates = [];
  for (const [nameNorm, arts] of byName.entries()) {
    const nameTokens = tokenize(nameNorm);
    if (nameTokens.length === 0) continue;
    const allIn = nameTokens.every(t => lineTokenSet.has(t));
    if (allIn) {
      candidates.push({ nameNorm, nameTokens, articles: arts });
    }
  }
  
  if (candidates.length === 0) return '';
  
  // Specificità: prima conta i token alfabetici (non numerici), poi il totale.
  // Così "ROSE FREEDOM" (2 alpha) batte "ROSE 70 CM" (1 alpha + 1 numerico).
  const alphaCount = (toks) => toks.filter(t => !/^\d+$/.test(t)).length;
  candidates.forEach(c => { c._alpha = alphaCount(c.nameTokens); });
  candidates.sort((a, b) => {
    if (b._alpha !== a._alpha) return b._alpha - a._alpha;
    return b.nameTokens.length - a.nameTokens.length;
  });
  
  const topAlpha = candidates[0]._alpha;
  const topLen = candidates[0].nameTokens.length;
  const topMatches = candidates.filter(c => c._alpha === topAlpha && c.nameTokens.length === topLen);
  
  // Conservativo: se ci sono più nomi con la stessa specificità → ambiguo, NO match
  if (topMatches.length > 1) return '';
  
  // Il nome più specifico deve avere almeno 2 token alfabetici, OPPURE
  // 1 token alfabetico se quel singolo token è "univoco" (es. nessun nome
  // master più lungo lo contiene → garantisce che "ROSE" non matcha mai
  // da solo, perché esistono "ROSE FREEDOM" ecc.).
  if (topAlpha < 2) {
    // Un solo token alfabetico: accettiamo solo se la riga non ha altri token
    // alfabetici (cioè la riga è davvero "5 eucalipto" senza altre parole).
    const lineAlpha = lineTokens.filter(t => !/^\d+$/.test(t));
    if (lineAlpha.length !== 1) return '';
    // E quel token deve essere il solo nome unico nell'anagrafica (improbabile
    // che capiti, ma resta conservativo: skip).
    return '';
  }
  
  const chosen = topMatches[0];
  const arts = chosen.articles;
  const remainingTokens = lineTokens.filter(t => !chosen.nameTokens.includes(t));
  
  // 1) Tenta match con una qualità specifica (se la riga ne contiene token corrispondenti)
  for (const a of arts) {
    if (!a.qualita_norm) continue;
    const qTokens = tokenize(a.qualita_norm);
    if (qTokens.length === 0) continue;
    const allQIn = qTokens.every(t => remainingTokens.includes(t));
    if (allQIn && qTokens.length > 0) {
      return a.match_key;
    }
  }
  
  // 2) Variante "senza qualità" esiste in anagrafica → matcha quella
  const blankQuality = arts.find(a => !a.qualita_norm);
  if (blankQuality) return blankQuality.match_key;
  
  // 3) Una sola qualità in anagrafica per quel nome → matcha quella
  if (arts.length === 1) return arts[0].match_key;
  
  // 4) Più qualità diverse e la riga non specifica → matcha la "famiglia" del nome
  //    (matchKey con qualità vuota: "NOME|"). Il raggruppamento poi unirà questa
  //    riga con quelle che hanno la qualità.
  //    Conservativo: lo facciamo SOLO se non ci sono token rimanenti dopo il nome,
  //    perché se la riga dice "rose freedom XXL" e XXL non è una qualità in
  //    anagrafica, quel "XXL" potrebbe essere una specifica importante → ambiguo.
  if (remainingTokens.length === 0) {
    return `${chosen.nameNorm}|`;
  }
  
  return '';
};

// Match automatico per TUTTE le righe di un ordine.
// Compila solo le righe che NON hanno già una match_key impostata
// (preserva le scelte manuali dell'utente).
// Ritorna oggetto { lineIndex: matchKey } con i nuovi match applicati.
const autoMatchOrderLines = (orderId, description) => {
  if (!description) return {};
  const lines = description.split('\n').filter(l => l.trim() !== '');
  if (lines.length === 0) return {};
  
  // Esiste l'anagrafica? Se vuota, salta.
  if (countArticoliMaster() === 0) return {};
  
  const existing = db.prepare('SELECT line_number, match_key FROM fabbisogno_checks WHERE order_id = ?').all(orderId);
  const existingMap = new Map();
  for (const e of existing) existingMap.set(e.line_number, e.match_key || '');
  
  const applied = {};
  const tx = db.transaction(() => {
    for (let i = 0; i < lines.length; i++) {
      // Salta se l'utente ha già scelto manualmente
      if (existingMap.has(i) && existingMap.get(i)) continue;
      
      const matchKey = autoMatchLine(lines[i]);
      if (!matchKey) continue;
      
      // Upsert
      const existsRow = db.prepare('SELECT id FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, i);
      if (existsRow) {
        db.prepare('UPDATE fabbisogno_checks SET match_key = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?')
          .run(matchKey, orderId, i);
      } else {
        db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked, prepared, supplier, match_key) VALUES (?, ?, 0, 0, \'\', ?)')
          .run(orderId, i, matchKey);
      }
      applied[i] = matchKey;
    }
  });
  tx();
  return applied;
};

// Set match_key manuale su una riga.
// Verifica che la matchKey esista in anagrafica (o sia vuota = scollega).
const setFabbisognoMatchKey = (orderId, lineNumber, matchKey) => {
  const key = (matchKey || '').trim();
  if (key && !articoloExistsByMatchKey(key)) {
    throw new Error('match_key inesistente: ' + key);
  }
  
  try {
    const upsert = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM fabbisogno_checks WHERE order_id = ? AND line_number = ?').get(orderId, lineNumber);
      if (existing) {
        db.prepare('UPDATE fabbisogno_checks SET match_key = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND line_number = ?')
          .run(key, orderId, lineNumber);
      } else {
        db.prepare('INSERT INTO fabbisogno_checks (order_id, line_number, checked, prepared, supplier, match_key) VALUES (?, ?, 0, 0, \'\', ?)')
          .run(orderId, lineNumber, key);
      }
    });
    upsert();
    return key;
  } catch (error) {
    console.error('❌ DB setFabbisognoMatchKey ERROR:', error);
    throw error;
  }
};

const clearFabbisognoChecks = (orderId) => {
  const stmt = db.prepare('DELETE FROM fabbisogno_checks WHERE order_id = ?');
  stmt.run(orderId);
};

// ============================================
// CRUD Listini
// ============================================

const getAllListini = () => {
  const stmt = db.prepare('SELECT * FROM listini ORDER BY uploaded_at DESC');
  return stmt.all();
};

const getListinoById = (id) => {
  const stmt = db.prepare('SELECT * FROM listini WHERE id = ?');
  return stmt.get(id);
};

const addListino = (listino) => {
  const stmt = db.prepare(`
    INSERT INTO listini (name, filename, uploaded_by)
    VALUES (?, ?, ?)
  `);
  const info = stmt.run(listino.name, listino.filename, listino.uploaded_by);
  return getListinoById(info.lastInsertRowid);
};

const deleteListino = (id) => {
  const stmt = db.prepare('DELETE FROM listini WHERE id = ?');
  return stmt.run(id);
};

// ============================================
// PREVENTIVI
// ============================================

function mapPreventivoRow(row) {
  if (!row) return null;
  let items = [];
  try {
    items = row.items ? JSON.parse(row.items) : [];
  } catch (e) {
    items = [];
  }
  return {
    id: row.id,
    numero: row.numero || '',
    cliente: row.cliente || '',
    ragione_sociale: row.ragione_sociale || '',
    luogo_consegna: row.luogo_consegna || '',
    indirizzo_consegna: row.indirizzo_consegna || '',
    data_preventivo: row.data_preventivo || '',
    data_consegna: row.data_consegna || '',
    oggetto: row.oggetto || 'Preventivo offerta',
    items,
    totale: Number(row.totale) || 0,
    note: row.note || '',
    created_by: row.created_by || '',
    updated_by: row.updated_by || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

const getAllPreventivi = () => {
  const rows = db.prepare(`
    SELECT id, numero, cliente, ragione_sociale, luogo_consegna, data_preventivo,
           data_consegna, totale, created_by, updated_by, created_at, updated_at
    FROM preventivi
    ORDER BY datetime(updated_at) DESC, id DESC
  `).all();
  return rows.map(r => ({ ...r, totale: Number(r.totale) || 0 }));
};

const getPreventivoById = (id) => {
  const row = db.prepare('SELECT * FROM preventivi WHERE id = ?').get(id);
  return mapPreventivoRow(row);
};

function computeNumeroPreventivo(data) {
  // Formato: YYYY-NNN (sequenza progressiva per anno)
  const year = (data && data.length >= 4) ? data.slice(0, 4) : String(new Date().getFullYear());
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM preventivi WHERE numero LIKE ?
  `).get(`${year}-%`);
  const next = (row && row.cnt ? row.cnt : 0) + 1;
  return `${year}-${String(next).padStart(3, '0')}`;
}

const createPreventivo = (p, username) => {
  const data = p.data_preventivo || new Date().toISOString().slice(0, 10);
  const numero = p.numero || computeNumeroPreventivo(data);
  const items = JSON.stringify(Array.isArray(p.items) ? p.items : []);
  const stmt = db.prepare(`
    INSERT INTO preventivi
      (numero, cliente, ragione_sociale, luogo_consegna, indirizzo_consegna,
       data_preventivo, data_consegna, oggetto, items, totale, note, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    numero,
    p.cliente || '',
    p.ragione_sociale || '',
    p.luogo_consegna || '',
    p.indirizzo_consegna || '',
    data,
    p.data_consegna || '',
    (p.oggetto && p.oggetto.trim()) ? p.oggetto.trim() : 'Preventivo offerta',
    items,
    Number(p.totale) || 0,
    p.note || '',
    username || '',
    username || ''
  );
  return getPreventivoById(info.lastInsertRowid);
};

const updatePreventivo = (id, p, username) => {
  const existing = getPreventivoById(id);
  if (!existing) return null;
  const items = JSON.stringify(Array.isArray(p.items) ? p.items : existing.items);
  const stmt = db.prepare(`
    UPDATE preventivi SET
      numero = ?,
      cliente = ?,
      ragione_sociale = ?,
      luogo_consegna = ?,
      indirizzo_consegna = ?,
      data_preventivo = ?,
      data_consegna = ?,
      oggetto = ?,
      items = ?,
      totale = ?,
      note = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const oggetto = (p.oggetto !== undefined)
    ? ((p.oggetto && p.oggetto.trim()) ? p.oggetto.trim() : 'Preventivo offerta')
    : (existing.oggetto || 'Preventivo offerta');
  stmt.run(
    p.numero !== undefined ? p.numero : existing.numero,
    p.cliente !== undefined ? p.cliente : existing.cliente,
    p.ragione_sociale !== undefined ? p.ragione_sociale : existing.ragione_sociale,
    p.luogo_consegna !== undefined ? p.luogo_consegna : existing.luogo_consegna,
    p.indirizzo_consegna !== undefined ? p.indirizzo_consegna : existing.indirizzo_consegna,
    p.data_preventivo !== undefined ? p.data_preventivo : existing.data_preventivo,
    p.data_consegna !== undefined ? p.data_consegna : existing.data_consegna,
    oggetto,
    items,
    p.totale !== undefined ? Number(p.totale) || 0 : existing.totale,
    p.note !== undefined ? p.note : existing.note,
    username || existing.updated_by,
    id
  );
  return getPreventivoById(id);
};

const deletePreventivo = (id) => {
  const stmt = db.prepare('DELETE FROM preventivi WHERE id = ?');
  return stmt.run(id);
};

// ============================================
// CUSTOMERS (portale clienti)
// ============================================

const crypto = require('crypto');

function generateCustomerToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 caratteri hex
}

function mapCustomerRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    contact_name: row.contact_name || '',
    email: row.email || '',
    phone: row.phone || '',
    login_token: row.login_token || '',
    active: !!row.active,
    notes: row.notes || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    last_login: row.last_login || null
  };
}

const getAllCustomers = () => {
  const rows = db.prepare(`
    SELECT id, name, contact_name, email, phone, login_token, active, notes,
           created_at, updated_at, last_login
    FROM customers
    ORDER BY name COLLATE NOCASE
  `).all();
  return rows.map(mapCustomerRow);
};

const getCustomerById = (id) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  return mapCustomerRow(row);
};

const getCustomerByToken = (token) => {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM customers WHERE login_token = ? AND active = 1').get(token);
  return mapCustomerRow(row);
};

const createCustomer = (c) => {
  const name = (c.name || '').trim();
  if (!name) throw new Error('Nome cliente obbligatorio');
  const token = c.login_token || generateCustomerToken();
  const stmt = db.prepare(`
    INSERT INTO customers (name, contact_name, email, phone, login_token, active, notes)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `);
  const info = stmt.run(
    name,
    (c.contact_name || '').trim(),
    (c.email || '').trim(),
    (c.phone || '').trim(),
    token,
    (c.notes || '').trim()
  );
  return getCustomerById(info.lastInsertRowid);
};

const updateCustomer = (id, c) => {
  const existing = getCustomerById(id);
  if (!existing) return null;
  const stmt = db.prepare(`
    UPDATE customers SET
      name = ?,
      contact_name = ?,
      email = ?,
      phone = ?,
      active = ?,
      notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    c.name !== undefined ? (c.name || '').trim() : existing.name,
    c.contact_name !== undefined ? (c.contact_name || '').trim() : existing.contact_name,
    c.email !== undefined ? (c.email || '').trim() : existing.email,
    c.phone !== undefined ? (c.phone || '').trim() : existing.phone,
    c.active !== undefined ? (c.active ? 1 : 0) : (existing.active ? 1 : 0),
    c.notes !== undefined ? (c.notes || '').trim() : existing.notes,
    id
  );
  return getCustomerById(id);
};

const regenerateCustomerToken = (id) => {
  const token = generateCustomerToken();
  const stmt = db.prepare('UPDATE customers SET login_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  stmt.run(token, id);
  return getCustomerById(id);
};

const touchCustomerLogin = (id) => {
  try {
    db.prepare('UPDATE customers SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  } catch (e) { /* no-op */ }
};

const deleteCustomer = (id) => {
  // SET NULL su ordini collegati per preservare storico
  try {
    db.prepare('UPDATE orders SET customer_id = NULL WHERE customer_id = ?').run(id);
  } catch (e) { /* no-op */ }
  const stmt = db.prepare('DELETE FROM customers WHERE id = ?');
  return stmt.run(id);
};

// Indirizzi

const getCustomerAddresses = (customerId) => {
  return db.prepare(`
    SELECT id, customer_id, label, street, city, notes, is_default, created_at
    FROM customer_addresses
    WHERE customer_id = ?
    ORDER BY is_default DESC, id ASC
  `).all(customerId).map(a => ({ ...a, is_default: !!a.is_default }));
};

const addCustomerAddress = (customerId, a) => {
  if (a.is_default) {
    db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(customerId);
  }
  const stmt = db.prepare(`
    INSERT INTO customer_addresses (customer_id, label, street, city, notes, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    customerId,
    (a.label || '').trim(),
    (a.street || '').trim(),
    (a.city || '').trim(),
    (a.notes || '').trim(),
    a.is_default ? 1 : 0
  );
  const row = db.prepare('SELECT * FROM customer_addresses WHERE id = ?').get(info.lastInsertRowid);
  return row ? { ...row, is_default: !!row.is_default } : null;
};

const updateCustomerAddress = (customerId, addressId, a) => {
  const existing = db.prepare('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?').get(addressId, customerId);
  if (!existing) return null;
  if (a.is_default) {
    db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(customerId);
  }
  const stmt = db.prepare(`
    UPDATE customer_addresses SET
      label = ?, street = ?, city = ?, notes = ?, is_default = ?
    WHERE id = ? AND customer_id = ?
  `);
  stmt.run(
    a.label !== undefined ? (a.label || '').trim() : existing.label,
    a.street !== undefined ? (a.street || '').trim() : existing.street,
    a.city !== undefined ? (a.city || '').trim() : existing.city,
    a.notes !== undefined ? (a.notes || '').trim() : existing.notes,
    a.is_default !== undefined ? (a.is_default ? 1 : 0) : existing.is_default,
    addressId,
    customerId
  );
  const row = db.prepare('SELECT * FROM customer_addresses WHERE id = ?').get(addressId);
  return row ? { ...row, is_default: !!row.is_default } : null;
};

const deleteCustomerAddress = (customerId, addressId) => {
  const stmt = db.prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?');
  return stmt.run(addressId, customerId);
};

// Ordini del cliente

const getOrdersByCustomerId = (customerId) => {
  return db.prepare(`
    SELECT * FROM orders WHERE customer_id = ?
    ORDER BY date DESC, id DESC
  `).all(customerId).map(r => ({
    ...r,
    photos: r.photos ? (() => { try { return JSON.parse(r.photos); } catch { return []; } })() : []
  }));
};

const getPendingCustomerOrders = () => {
  return db.prepare(`
    SELECT o.*, c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.customer_order_status = 'pending'
    ORDER BY o.created_at DESC
  `).all();
};

const approveCustomerOrder = (id, username) => {
  const stmt = db.prepare(`
    UPDATE orders SET
      customer_order_status = 'approved',
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND customer_order_status = 'pending'
  `);
  return stmt.run(username || '', id);
};

const rejectCustomerOrder = (id, reason, username) => {
  const stmt = db.prepare(`
    UPDATE orders SET
      customer_order_status = 'rejected',
      customer_reject_reason = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run((reason || '').trim(), username || '', id);
};

// ============================================
// CATALOGO GIORNALIERO (articoli + foto)
// ============================================

function mapCatalogRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    catalog_date: row.catalog_date,
    name: row.name || '',
    description: row.description || '',
    category: row.category || '',
    photo_url: row.photo_url || '',
    price: row.price != null ? Number(row.price) : 0,
    min_quantity: row.min_quantity != null ? Number(row.min_quantity) : 1,
    availability: row.availability || '',
    sort_order: row.sort_order || 0,
    active: !!row.active,
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  };
}

const getCatalogByDate = (date) => {
  const rows = db.prepare(`
    SELECT * FROM catalog_items
    WHERE catalog_date = ?
    ORDER BY sort_order ASC, id ASC
  `).all(date);
  return rows.map(mapCatalogRow);
};

// Restituisce la data del catalogo più recente (oggi o giorni passati)
const getLatestCatalogDate = () => {
  const row = db.prepare(`
    SELECT catalog_date FROM catalog_items
    WHERE active = 1
    GROUP BY catalog_date
    ORDER BY catalog_date DESC
    LIMIT 1
  `).get();
  return row ? row.catalog_date : null;
};

// Articoli attivi del catalogo per una data (per il cliente)
const getActiveCatalogByDate = (date) => {
  const rows = db.prepare(`
    SELECT * FROM catalog_items
    WHERE catalog_date = ? AND active = 1
    ORDER BY sort_order ASC, id ASC
  `).all(date);
  return rows.map(mapCatalogRow);
};

const getCatalogItemById = (id) => {
  const row = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
  return mapCatalogRow(row);
};

const createCatalogItem = (data, username) => {
  const date = data.catalog_date || new Date().toISOString().slice(0, 10);
  const name = (data.name || '').trim();
  if (!name) throw new Error('Nome articolo obbligatorio');
  const stmt = db.prepare(`
    INSERT INTO catalog_items
      (catalog_date, name, description, category, photo_url, price, min_quantity, availability, sort_order, active, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    date,
    name,
    (data.description || '').trim(),
    (data.category || '').trim(),
    (data.photo_url || '').trim(),
    Number(data.price) || 0,
    Math.max(1, parseInt(data.min_quantity) || 1),
    (data.availability || '').trim(),
    Number(data.sort_order) || 0,
    data.active === false ? 0 : 1,
    username || '',
    username || ''
  );
  return getCatalogItemById(info.lastInsertRowid);
};

const updateCatalogItem = (id, data, username) => {
  const existing = getCatalogItemById(id);
  if (!existing) return null;
  const stmt = db.prepare(`
    UPDATE catalog_items SET
      name = ?,
      description = ?,
      category = ?,
      photo_url = ?,
      price = ?,
      min_quantity = ?,
      availability = ?,
      sort_order = ?,
      active = ?,
      updated_by = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    data.name !== undefined ? String(data.name).trim() : existing.name,
    data.description !== undefined ? String(data.description).trim() : existing.description,
    data.category !== undefined ? String(data.category).trim() : existing.category,
    data.photo_url !== undefined ? String(data.photo_url).trim() : existing.photo_url,
    data.price !== undefined ? (Number(data.price) || 0) : existing.price,
    data.min_quantity !== undefined ? Math.max(1, parseInt(data.min_quantity) || 1) : existing.min_quantity,
    data.availability !== undefined ? String(data.availability).trim() : existing.availability,
    data.sort_order !== undefined ? (Number(data.sort_order) || 0) : existing.sort_order,
    data.active !== undefined ? (data.active ? 1 : 0) : (existing.active ? 1 : 0),
    username || '',
    id
  );
  return getCatalogItemById(id);
};

const deleteCatalogItem = (id) => {
  return db.prepare('DELETE FROM catalog_items WHERE id = ?').run(id);
};

// Duplica un catalogo intero da una data ad un'altra
const duplicateCatalog = (fromDate, toDate, username) => {
  const sourceItems = getCatalogByDate(fromDate);
  if (sourceItems.length === 0) return 0;
  // Se la data di destinazione ha già articoli, non duplicare (idempotenza)
  const existingAtDest = getCatalogByDate(toDate);
  if (existingAtDest.length > 0) return 0;
  
  const insert = db.prepare(`
    INSERT INTO catalog_items
      (catalog_date, name, description, category, photo_url, price, min_quantity, availability, sort_order, active, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => {
    for (const it of items) {
      insert.run(
        toDate, it.name, it.description, it.category, it.photo_url,
        it.price, it.min_quantity, it.availability, it.sort_order, it.active ? 1 : 0,
        username || '', username || ''
      );
    }
  });
  tx(sourceItems);
  return sourceItems.length;
};

// Lista tutte le date di catalogo esistenti (per selezione)
const getCatalogDates = () => {
  return db.prepare(`
    SELECT catalog_date, COUNT(*) AS items, SUM(active) AS active_items
    FROM catalog_items
    GROUP BY catalog_date
    ORDER BY catalog_date DESC
    LIMIT 90
  `).all();
};

// ============================================
// ORDER ITEMS (righe strutturate degli ordini)
// ============================================

function mapOrderItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    catalog_item_id: row.catalog_item_id || null,
    name: row.name || '',
    category: row.category || '',
    photo_url: row.photo_url || '',
    quantity: row.quantity || 0,
    unit_price: row.unit_price != null ? Number(row.unit_price) : 0,
    total_price: row.total_price != null ? Number(row.total_price) : 0
  };
}

const addOrderItems = (orderId, items) => {
  if (!Array.isArray(items) || items.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO order_items
      (order_id, catalog_item_id, name, category, photo_url, quantity, unit_price, total_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const qty = parseInt(r.quantity) || 0;
      const unit = Number(r.unit_price) || 0;
      insert.run(
        orderId,
        r.catalog_item_id || null,
        (r.name || '').trim(),
        (r.category || '').trim(),
        (r.photo_url || '').trim(),
        qty,
        unit,
        qty * unit
      );
    }
  });
  tx(items);
};

const getOrderItems = (orderId) => {
  const rows = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC').all(orderId);
  return rows.map(mapOrderItemRow);
};

const setOrderTotal = (orderId, total) => {
  try {
    db.prepare('UPDATE orders SET total_price = ? WHERE id = ?').run(Number(total) || 0, orderId);
  } catch (e) { /* no-op */ }
};

module.exports = {
  initDb,
  getAllOrders,
  getOrdersByDate,
  getOrdersByDateRange,
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
  setFabbisognoPrepared,
  setFabbisognoSupplier,
  setFabbisognoMatchKey,
  clearFabbisognoChecks,
  // Anagrafica articoli master
  upsertArticoliMaster,
  countArticoliMaster,
  clearArticoliMaster,
  searchArticoli,
  articoloExistsByMatchKey,
  matchKeyName,
  autoMatchLine,
  autoMatchOrderLines,
  buildMatchKey,
  normalizeText,
  tokenize,
  getAllListini,
  getListinoById,
  addListino,
  deleteListino,
  getAllPreventivi,
  getPreventivoById,
  createPreventivo,
  updatePreventivo,
  deletePreventivo,
  // Customers & portale clienti
  getAllCustomers,
  getCustomerById,
  getCustomerByToken,
  createCustomer,
  updateCustomer,
  regenerateCustomerToken,
  touchCustomerLogin,
  deleteCustomer,
  getCustomerAddresses,
  addCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress,
  getOrdersByCustomerId,
  getPendingCustomerOrders,
  approveCustomerOrder,
  rejectCustomerOrder,
  // Catalogo giornaliero
  getCatalogByDate,
  getLatestCatalogDate,
  getActiveCatalogByDate,
  getCatalogItemById,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  duplicateCatalog,
  getCatalogDates,
  // Righe ordine strutturate
  addOrderItems,
  getOrderItems,
  setOrderTotal
};

