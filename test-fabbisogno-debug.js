// Script di debug per verificare il filtro fabbisogno
const db = require('./database');

console.log('\n🔍 TEST FILTRO FABBISOGNO\n');

const dateFrom = '2026-01-16';
const dateTo = '2026-01-17';

console.log(`📅 Range date: ${dateFrom} - ${dateTo}\n`);

const allOrders = db.getOrdersByDateRange(dateFrom, dateTo);

console.log(`📦 Totale ordini nel range: ${allOrders.length}\n`);

allOrders.forEach((order, i) => {
  console.log(`${i+1}. Ordine #${order.id} - ${order.customer}`);
  console.log(`   goods_type: "${order.goods_type}"`);
  console.log(`   status: "${order.status}"`);
  console.log(`   photos: ${order.photos ? order.photos.length : 0} foto`);
  console.log(`   description: ${order.description.substring(0, 50)}...`);
  console.log('');
});

const ordersToOrder = allOrders.filter(order => order.goods_type === 'da_ordinare');

console.log(`\n✅ Ordini DA ORDINARE: ${ordersToOrder.length}\n`);

ordersToOrder.forEach((order, i) => {
  console.log(`${i+1}. #${order.id} - ${order.customer} - ${order.photos ? order.photos.length : 0} foto`);
});

console.log('\n✅ Test completato');
