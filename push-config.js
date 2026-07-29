// Configurazione Web Push
//
// SICUREZZA: le chiavi VAPID vanno impostate come variabili d'ambiente
// (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY su Railway). I valori qui sotto
// sono il fallback storico: essendo finiti nella history del repository
// vanno considerati compromessi — appena possibile generare una nuova
// coppia (npx web-push generate-vapid-keys), impostarla via env e
// rimuovere il fallback. Nota: ruotare le chiavi invalida le iscrizioni
// push esistenti (gli utenti dovranno riattivare le notifiche).
module.exports = {
  vapidKeys: {
    publicKey: process.env.VAPID_PUBLIC_KEY
      || 'BAtejR4hcMk0BzH6NAR9G4-2I1LgSm8W9IyZrg39UVueqGnHul2mZbfg5DS6RkdoBVst7wAUrHHball2OD0bKD0',
    privateKey: process.env.VAPID_PRIVATE_KEY
      || 'tLNJpixYHnc0K51BCa1Z7zqRoqgRrCLC-8YLVakbNag'
  },
  // Orario notifica giornaliera (formato 24h)
  notificationTime: {
    hour: 6,
    minute: 30
  }
};
