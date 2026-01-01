// Script per inviare notifica immediata
const webpush = require('web-push');
const db = require('./database');
const pushConfig = require('./push-config');

// Configura Web Push
webpush.setVapidDetails(
  'mailto:info@lombardaflor.it',
  pushConfig.vapidKeys.publicKey,
  pushConfig.vapidKeys.privateKey
);

async function sendImmediateNotification() {
  try {
    console.log('📱 Invio notifica immediata...\n');
    
    // Inizializza database
    db.initDb();
    
    // Ottieni tutte le subscriptions
    const allSubs = db.getAllSubscriptions();
    
    if (allSubs.length === 0) {
      console.log('⚠️  Nessun dispositivo registrato!');
      console.log('\n📋 COSA FARE:');
      console.log('1. Apri http://192.168.178.67:3000 sul cellulare');
      console.log('2. Fai login');
      console.log('3. Accetta i permessi notifiche');
      console.log('4. Poi rilancia questo script!');
      return;
    }
    
    console.log(`✓ Trovati ${allSubs.length} dispositivi registrati\n`);
    
    // Prepara il payload
    const payload = JSON.stringify({
      title: '🌸 Test Notifica LombardaFlor',
      body: 'Ciao! Questa è una notifica di test immediata! 🎉',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'test-immediate',
      requireInteraction: true,
      vibrate: [300, 200, 300, 200, 300]
    });
    
    let sent = 0;
    let failed = 0;
    
    // Invia a tutti i dispositivi
    for (const sub of allSubs) {
      try {
        console.log(`📤 Invio a ${sub.username}...`);
        await webpush.sendNotification(sub.subscription, payload);
        console.log(`✅ Inviata a ${sub.username}!`);
        sent++;
      } catch (error) {
        console.error(`❌ Errore per ${sub.username}:`, error.message);
        failed++;
        
        // Rimuovi subscription non valide
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(`🗑️  Rimuovo subscription non valida di ${sub.username}`);
          db.deleteSubscription(sub.subscription.endpoint);
        }
      }
    }
    
    console.log('\n═══════════════════════════════════════');
    console.log('📊 RISULTATO:');
    console.log(`   ✅ Inviate: ${sent}`);
    console.log(`   ❌ Fallite: ${failed}`);
    console.log('═══════════════════════════════════════\n');
    
    if (sent > 0) {
      console.log('🎉 Controlla il tuo cellulare!');
      console.log('📱 Dovresti vedere una notifica con vibrazione!');
    }
    
  } catch (error) {
    console.error('❌ Errore:', error);
  }
}

// Esegui
sendImmediateNotification();

