const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'ordini.db');

// Crea backup
const backupPath = path.join(__dirname, `ordini-backup-${Date.now()}.db`);
fs.copyFileSync(dbPath, backupPath);
console.log(`✓ Backup creato: ${backupPath}`);

const db = new Database(dbPath);

try {
  // Aggiungi colonne per tracciamento utenti
  const columns = [
    { name: 'created_by', type: 'TEXT', default: null },
    { name: 'updated_by', type: 'TEXT', default: null }
  ];
  
  columns.forEach(column => {
    try {
      db.exec(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}`);
      console.log(`✓ Colonna ${column.name} aggiunta`);
    } catch (error) {
      if (error.message.includes('duplicate column name')) {
        console.log(`⚠ Colonna ${column.name} già esistente`);
      } else {
        throw error;
      }
    }
  });
  
  console.log('✓ Migrazione completata con successo!');
} catch (error) {
  console.error('✗ Errore durante la migrazione:', error.message);
  process.exit(1);
} finally {
  db.close();
}

