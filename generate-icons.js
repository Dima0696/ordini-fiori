const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// SVG dell'icona (fiore emoji su sfondo verde)
const svgIcon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#4CAF50" rx="80"/>
  <text x="256" y="340" font-family="Arial, sans-serif" font-size="280" text-anchor="middle">🌸</text>
</svg>
`;

async function generateIcons() {
  console.log('🎨 Generazione icone PWA...\n');
  
  const sizes = [192, 512];
  
  for (const size of sizes) {
    try {
      const outputPath = path.join(__dirname, 'public', `icon-${size}.png`);
      
      await sharp(Buffer.from(svgIcon))
        .resize(size, size)
        .png()
        .toFile(outputPath);
      
      console.log(`✓ Icona ${size}x${size} creata: public/icon-${size}.png`);
    } catch (error) {
      console.error(`✗ Errore creazione icona ${size}x${size}:`, error.message);
    }
  }
  
  console.log('\n✅ Icone generate con successo!');
}

generateIcons();

