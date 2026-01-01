// Script per popolare il database con dati di test
const db = require('./database');

console.log('🌸 Popolamento database con dati di test...\n');

// Inizializza database
db.initDb();

// Date di esempio (oggi e prossimi giorni)
const today = new Date();
const dates = [];
for (let i = 0; i < 7; i++) {
  const date = new Date(today);
  date.setDate(today.getDate() + i);
  dates.push(date.toISOString().split('T')[0]);
}

// Dati di esempio
const sampleOrders = [
  { date: dates[0], customer: 'Fioreria Rossi', description: '3 casse rose rosse, 5 mazzi garofani bianchi' },
  { date: dates[0], customer: 'Fiori & Co', description: '10 mazzi tulipani misti, 2 casse gigli' },
  { date: dates[1], customer: 'Garden Center', description: '15 piante orchidee, 20 mazzi eucalyptus' },
  { date: dates[1], customer: 'Fioreria Bianchi', description: '5 casse rose bianche per matrimonio' },
  { date: dates[2], customer: 'Fioreria Verde', description: '8 mazzi peonie, 10 mazzi ranuncoli' },
  { date: dates[3], customer: 'Fiori Express', description: '3 casse margherite, 7 mazzi gerbere colorate' },
  { date: dates[3], customer: 'Bouquet Shop', description: '12 mazzi rose rosa, 5 mazzi fresie' },
  { date: dates[3], customer: 'La Rosa Blu', description: '4 casse ortensie blu, verde decorativo' },
  { date: dates[4], customer: 'Fioreria Centro', description: '6 mazzi calle bianche, 3 mazzi protee' },
  { date: dates[5], customer: 'Giardino Fiorito', description: '10 piante azalee, 8 mazzi lavanda' },
];

// Inserisci ordini
let count = 0;
sampleOrders.forEach(order => {
  try {
    db.createOrder(order.date, order.customer, order.description);
    count++;
    console.log(`✓ Ordine ${count}: ${order.customer} - ${order.date}`);
  } catch (error) {
    console.error(`✗ Errore inserimento ordine:`, error.message);
  }
});

console.log(`\n✅ Inseriti ${count} ordini di test!`);
console.log('📊 Puoi ora avviare il server con: npm start\n');

