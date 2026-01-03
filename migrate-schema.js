// Script per aggiornare lo schema del database esistente
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_PATH 
  ? path.join(process.env.DATABASE_PATH, 'ordini.db')
  : path.join(__dirname, 'ordini.db');

console.log(`🔄 Migrazione schema database: ${DB_PATH}`);

const db = new Database(DB_PATH);

// Funzione per verificare se una colonna esiste
function columnExists(tableName, columnName) {
  const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return result.some(col => col.name === columnName);
}

// Aggiungi colonne mancanti
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

let modified = false;

columnsToAdd.forEach(col => {
  if (!columnExists('orders', col.name)) {
    try {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`);
      console.log(`✅ Aggiunta colonna: ${col.name}`);
      modified = true;
    } catch (error) {
      console.error(`❌ Errore aggiungendo ${col.name}:`, error.message);
    }
  } else {
    console.log(`⏭️  Colonna ${col.name} già esistente`);
  }
});

if (modified) {
  console.log('✅ Schema database aggiornato con successo!');
} else {
  console.log('✅ Schema database già aggiornato');
}

db.close();



