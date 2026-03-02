const webpush = require('web-push');
const db = require('./database');
const pushConfig = require('./push-config');

// Configura Web Push
webpush.setVapidDetails(
  'mailto:notifications@localhost',
  pushConfig.vapidKeys.publicKey,
  pushConfig.vapidKeys.privateKey
);

async function sendUpdateNotification() {
  try {
    const payload = JSON.stringify({
      title: '✨ Aggiornamento App Completato',
      body: '📅 Calendario corretto: navigazione fluida, mese completo visibile, no più blocchi o salti a fine mese!',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'app-update',
      requireInteraction: true
    });

    const allSubs = db.getAllSubscriptions();
    
    if (allSubs.length === 0) {
      console.log('⚠️ Nessuna subscription registrata');
      return;
    }

    console.log(`📤 Invio notifica aggiornamento a ${allSubs.length} utenti...`);

    const results = await Promise.allSettled(
      allSubs.map(async (sub) => {
        try {
          // La funzione getAllSubscriptions ritorna già il formato corretto
          await webpush.sendNotification(sub.subscription, payload);
          console.log(`✅ Inviata a ${sub.username}`);
          return { success: true, username: sub.username };
        } catch (error) {
          if (error.statusCode === 410 || error.statusCode === 404) {
            console.log(`🗑️ Subscription scaduta per ${sub.username}, rimuovo...`);
            db.deleteSubscription(sub.subscription.endpoint);
          } else {
            console.error(`❌ Errore per ${sub.username}:`, error.message);
          }
          return { success: false, username: sub.username };
        }
      })
    );

    const successful = results.filter(r => r.value?.success).length;
    console.log(`\n🎉 Notifiche inviate con successo: ${successful}/${allSubs.length}`);

  } catch (error) {
    console.error('❌ Errore invio notifiche:', error);
  }
  
  process.exit(0);
}

// Inizializza database
db.initDb();

// Invia notifica
sendUpdateNotification();
