#!/usr/bin/env node
/**
 * Importa l'anagrafica articoli dal file Excel/CSV nel database (tabella articoli_master).
 *
 * Uso:
 *   node import-anagrafica.js <path-al-file>
 *   node import-anagrafica.js "/Users/apple/Downloads/expTab (3).xlsx"
 *
 * Il file deve avere come prime due colonne:
 *   - colonna 1: nome articolo (es. "ROSE FREEDOM")
 *   - colonna 2: qualità / lunghezza (es. "70 CM" o "EXTRA"), opzionale
 *
 * Lo script:
 *  - deduplica per coppia (nome, qualità) normalizzata
 *  - chiama upsertArticoliMaster (idempotente: si può rieseguire all'infinito)
 *  - non cancella nulla di esistente, solo aggiunge ciò che manca
 *
 * Se vuoi pulire e re-importare da zero: aggiungi --reset
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const db = require('./database');

db.initDb();

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const filePath = args.find(a => !a.startsWith('--'));

if (!filePath) {
  console.error('❌ Manca il path al file. Uso: node import-anagrafica.js <file.xlsx|file.csv> [--reset]');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error('❌ File non trovato:', filePath);
  process.exit(1);
}

console.log('📂 Lettura file:', filePath);

const ext = path.extname(filePath).toLowerCase();
const wb = xlsx.readFile(filePath, { raw: true });
const sheetName = wb.SheetNames[0];
const sheet = wb.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

console.log(`📊 Foglio: ${sheetName} | Righe totali: ${rows.length}`);

if (rows.length < 2) {
  console.error('❌ File vuoto o senza dati');
  process.exit(1);
}

const header = rows[0];
console.log(`📋 Header: ${JSON.stringify(header)}`);

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

console.log(`✓ Coppie uniche da importare: ${items.length}`);

if (reset) {
  const before = db.countArticoliMaster();
  db.clearArticoliMaster();
  console.log(`🗑️  Reset: cancellate ${before} righe esistenti`);
}

const before = db.countArticoliMaster();
const result = db.upsertArticoliMaster(items);
const after = db.countArticoliMaster();

console.log('');
console.log('═══════════════════════════════════════');
console.log(`✅ Import completato`);
console.log(`   Inserite:  ${result.inserted}`);
console.log(`   Saltate:   ${result.skipped} (già presenti o vuote)`);
console.log(`   Totale articoli in anagrafica: ${after} (era ${before})`);
console.log('═══════════════════════════════════════');
