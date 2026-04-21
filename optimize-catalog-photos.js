/**
 * Script one-shot: ottimizza (ridimensiona + comprime) tutte le foto del catalogo
 * già caricate in precedenza. Mantiene gli stessi URL, sovrascrive il file sul disco.
 *
 * Uso:
 *   node optimize-catalog-photos.js [--dry-run] [--threshold=500]
 *
 * --dry-run       Non modifica i file, stampa solo cosa farebbe.
 * --threshold=KB  Ottimizza solo le foto più grandi di KB (default 500).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('./database');

const DRY_RUN = process.argv.includes('--dry-run');
const thresholdArg = process.argv.find(a => a.startsWith('--threshold='));
const THRESHOLD_KB = thresholdArg ? parseInt(thresholdArg.split('=')[1]) : 500;

const uploadsDir = process.env.DATABASE_PATH
  ? path.join(process.env.DATABASE_PATH, 'uploads')
  : path.join(__dirname, 'public', 'uploads');

async function optimizePhoto(photoUrl) {
  if (!photoUrl || !photoUrl.startsWith('/uploads/')) return null;
  
  const filename = path.basename(photoUrl);
  const filePath = path.join(uploadsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    return { status: 'missing', filename };
  }
  
  const stat = fs.statSync(filePath);
  const sizeKB = stat.size / 1024;
  
  if (sizeKB <= THRESHOLD_KB) {
    return { status: 'skip', filename, sizeKB };
  }
  
  if (DRY_RUN) {
    return { status: 'would-optimize', filename, sizeKB };
  }
  
  const tmpPath = filePath + '.tmp';
  
  try {
    await sharp(filePath)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toFile(tmpPath);
    
    const newSize = fs.statSync(tmpPath).size / 1024;
    
    // Sostituisce il file originale (atomico)
    fs.renameSync(tmpPath, filePath);
    
    return {
      status: 'optimized',
      filename,
      beforeKB: sizeKB,
      afterKB: newSize,
      savedPct: Math.round((1 - newSize / sizeKB) * 100)
    };
  } catch (error) {
    // Pulizia tmp in caso di errore
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    return { status: 'error', filename, error: error.message };
  }
}

async function main() {
  console.log('🔎 Script ottimizzazione foto catalogo');
  console.log(`   Directory uploads: ${uploadsDir}`);
  console.log(`   Soglia minima per ottimizzazione: ${THRESHOLD_KB} KB`);
  if (DRY_RUN) console.log('   Modalità: DRY-RUN (nessuna modifica)');
  console.log('');
  
  // Prendo tutte le foto dai catalog_items
  const catalogDates = db.getCatalogDates();
  let allItems = [];
  for (const row of catalogDates) {
    const items = db.getCatalogByDate(row.catalog_date);
    allItems = allItems.concat(items);
  }
  
  const withPhoto = allItems.filter(i => i.photo_url);
  console.log(`📦 Articoli totali: ${allItems.length}`);
  console.log(`📸 Articoli con foto: ${withPhoto.length}`);
  console.log('');
  
  let totalSaved = 0;
  let optimizedCount = 0;
  let skippedCount = 0;
  let missingCount = 0;
  let errorCount = 0;
  
  for (const item of withPhoto) {
    const result = await optimizePhoto(item.photo_url);
    if (!result) continue;
    
    if (result.status === 'optimized') {
      optimizedCount++;
      totalSaved += (result.beforeKB - result.afterKB);
      console.log(`✅ ${result.filename}: ${result.beforeKB.toFixed(0)}KB → ${result.afterKB.toFixed(0)}KB (-${result.savedPct}%)`);
    } else if (result.status === 'would-optimize') {
      optimizedCount++;
      console.log(`🔹 ${result.filename}: ${result.sizeKB.toFixed(0)}KB (sarebbe ottimizzato)`);
    } else if (result.status === 'skip') {
      skippedCount++;
    } else if (result.status === 'missing') {
      missingCount++;
      console.log(`⚠️  ${result.filename}: file mancante su disco`);
    } else if (result.status === 'error') {
      errorCount++;
      console.log(`❌ ${result.filename}: ${result.error}`);
    }
  }
  
  console.log('');
  console.log('═══ Riepilogo ═══');
  console.log(`   Ottimizzate: ${optimizedCount}`);
  console.log(`   Già leggere (saltate): ${skippedCount}`);
  console.log(`   File mancanti: ${missingCount}`);
  console.log(`   Errori: ${errorCount}`);
  if (totalSaved > 0 && !DRY_RUN) {
    console.log(`   Risparmio totale: ${(totalSaved/1024).toFixed(1)} MB`);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Errore:', err);
  process.exit(1);
});
