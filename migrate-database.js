// Script di migrazione database - Aggiunge nuovi campi
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'ordini.db');

console.log('🔄 Migrazione database in corso...\n');

// Backup del database originale
const backupPath = path.join(__dirname, `ordini-backup-${Date.now()}.db`);
if (fs.existsSync(dbPath)) {
  fs.copyFileSync(dbPath, backupPath);
  console.log(`✓ Backup creato: ${path.basename(backupPath)}`);
}

const db = new Database(dbPath);

try {
  // Verifica se le colonne esistono già
  const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
  const existingColumns = tableInfo.map(col => col.name);
  
  console.log('✓ Colonne esistenti:', existingColumns.join(', '));
  console.log('');
  
  // Aggiungi nuove colonne se non esistono
  const newColumns = [
    { name: 'order_type', definition: "TEXT DEFAULT 'cliente'" },
    { name: 'delivery_type', definition: "TEXT DEFAULT 'ritiro'" },
    { name: 'delivery_time', definition: 'TEXT' },
    { name: 'delivery_address', definition: 'TEXT' },
    { name: 'goods_type', definition: "TEXT DEFAULT 'in_cella'" },
    { name: 'photos', definition: 'TEXT' } // JSON array di path foto
  ];
  
  let added = 0;
  for (const col of newColumns) {
    if (!existingColumns.includes(col.name)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.definition}`);
      console.log(`✓ Aggiunta colonna: ${col.name}`);
      added++;
    } else {
      console.log(`→ Colonna già esistente: ${col.name}`);
    }
  }
  
  console.log('');
  if (added > 0) {
    console.log(`✅ Migrazione completata! Aggiunte ${added} nuove colonne.`);
  } else {
    console.log('✅ Database già aggiornato, nessuna modifica necessaria.');
  }
  
  console.log('');
  console.log('📊 Schema aggiornato:');
  const updatedInfo = db.prepare("PRAGMA table_info(orders)").all();
  updatedInfo.forEach(col => {
    console.log(`   - ${col.name} (${col.type})`);
  });
  
} catch (error) {
  console.error('❌ Errore durante la migrazione:', error.message);
  console.log('');
  console.log('Per ripristinare il backup:');
  console.log(`   cp ${path.basename(backupPath)} ordini.db`);
  process.exit(1);
} finally {
  db.close();
}

console.log('');
console.log('🎉 Database pronto per le nuove funzionalità!');

