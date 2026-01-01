const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  console.log('🎨 Generazione icone PWA dal logo LombardaFlor...\n');
  
  const logoPath = path.join(__dirname, 'public', 'logo.png');
  
  if (!fs.existsSync(logoPath)) {
    console.error('❌ Logo non trovato:', logoPath);
    return;
  }
  
  const sizes = [192, 512];
  
  for (const size of sizes) {
    try {
      const outputPath = path.join(__dirname, 'public', `icon-${size}.png`);
      
      // Leggi il logo e crea icona con sfondo bianco
      await sharp(logoPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Icona ${size}x${size} creata: public/icon-${size}.png`);
    } catch (error) {
      console.error(`✗ Errore creazione icona ${size}x${size}:`, error.message);
    }
  }
  
  console.log('\n✅ Icone PWA LombardaFlor generate con successo!');
}

generateIcons();

