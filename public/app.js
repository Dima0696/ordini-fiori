// Configurazione API
const API_URL = window.location.origin + '/api';

// Stato globale
let currentDate = null;
let currentMonth = new Date(); // Parte dal mese corrente
let currentOrderId = null;
let currentDetailOrder = null;
let orderStats = {};
let uploadedPhotos = []; // Array di URL foto caricate
let authToken = null;
let currentUser = null;
let autoRefreshInterval = null;
let lastUpdateTime = new Date();
let currentFabbisognoDate = null; // Data del fabbisogno aperto

// Festività italiane (formato MM-DD)
const holidays = [
  '01-01', // Capodanno
  '01-06', // Epifania
  '04-25', // Liberazione
  '05-01', // Festa del Lavoro
  '06-02', // Festa della Repubblica
  '08-15', // Ferragosto
  '11-01', // Ognissanti
  '12-08', // Immacolata
  '12-25', // Natale
  '12-26', // Santo Stefano
];

// Elementi DOM
const pageCalendar = document.getElementById('page-calendar');
const pageOrders = document.getElementById('page-orders');
const modalOrder = document.getElementById('modal-order');
const modalConfirm = document.getElementById('modal-confirm');
const daysList = document.getElementById('days-list');
const ordersList = document.getElementById('orders-list');
const emptyMessage = document.getElementById('empty-message');

// Inizializzazione app
document.addEventListener('DOMContentLoaded', () => {
  setupLoginListeners();
  checkAuth();
});

async function initializeApp() {
  // Registra service worker per PWA
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/service-worker.js');
      console.log('✓ Service Worker registrato');
    } catch (error) {
      console.log('Service Worker non registrato:', error);
    }
  }
  
  setupEventListeners();
  // Pull-to-refresh disabilitato (dava problemi)
  // setupPullToRefresh();
  
  // Richiedi permessi notifiche
  await requestNotificationPermission();
  
  // Mostra calendario
  await loadCalendar();
  
  // Avvia auto-refresh ogni 2 minuti
  startAutoRefresh();
}

// Auto-refresh ogni 3 minuti
function startAutoRefresh() {
  // Pulisci intervallo esistente
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  // Auto-refresh ogni 3 minuti (180000 ms) - ottimizzato per performance
  autoRefreshInterval = setInterval(() => {
    const currentPage = document.querySelector('.page.active');
    if (currentPage.id === 'page-calendar') {
      autoRefreshCalendar();
    } else if (currentPage.id === 'page-orders') {
      autoRefreshOrders();
    }
  }, 180000); // 3 minuti
  
  console.log('⏰ Auto-refresh attivo: ogni 3 minuti');
}

// Refresh manuale
async function manualRefresh(page) {
  const btn = page === 'calendar' 
    ? document.getElementById('btn-refresh-calendar')
    : document.getElementById('btn-refresh-orders');
  
  btn.classList.add('refreshing');
  
  try {
    if (page === 'calendar') {
      await loadCalendar();
      updateRefreshIndicator('calendar');
    } else {
      await loadOrders(currentDate);
      updateRefreshIndicator('orders');
    }
  } finally {
    btn.classList.remove('refreshing');
  }
}

// Auto-refresh silenzioso
async function autoRefreshCalendar() {
  try {
    await loadCalendar();
  } catch (error) {
    console.error('Errore refresh calendario:', error);
  }
}

async function autoRefreshOrders() {
  try {
    await loadOrders(currentDate);
  } catch (error) {
    console.error('Errore refresh ordini:', error);
  }
}

// Vecchie funzioni di indicatore rimosse - ora usiamo pull-to-refresh

// Login listeners
function setupLoginListeners() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    
    errorEl.style.display = 'none';
    
    try {
      await login(username, password);
    } catch (error) {
      errorEl.textContent = error.message || 'Errore durante il login';
      errorEl.style.display = 'block';
    }
  });
}

// Helper per richieste autenticate
async function authenticatedFetch(url, options = {}) {
  if (!authToken) {
    logout();
    throw new Error('Non autenticato');
  }
  
  const headers = {
    'Authorization': `Bearer ${authToken}`,
    ...(options.headers || {})
  };
  
  // Se non c'è Content-Type e c'è un body non-FormData, aggiungi JSON
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    // Sessione scaduta
    logout();
    throw new Error('Sessione scaduta');
  }
  
  return response;
}

// Login
async function login(username, password) {
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Login fallito');
    }
    
    authToken = data.token;
    currentUser = data.username;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', currentUser);
    
    showApp();
    await initializeApp();
  } catch (error) {
    throw error;
  }
}

// Logout
async function logout() {
  if (authToken) {
    try {
      await fetch(`${API_URL}/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (error) {
      console.error('Errore logout:', error);
    }
  }
  
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  showLogin();
}

// Verifica sessione
async function checkAuth() {
  const savedToken = localStorage.getItem('authToken');
  const savedUser = localStorage.getItem('currentUser');
  
  if (!savedToken || !savedUser) {
    showLogin();
    return false;
  }
  
  try {
    const response = await fetch(`${API_URL}/me`, {
      headers: { 'Authorization': `Bearer ${savedToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      authToken = savedToken;
      currentUser = data.username;
      showApp();
      await initializeApp();
      return true;
    } else {
      showLogin();
      return false;
    }
  } catch (error) {
    showLogin();
    return false;
  }
}

// Mostra login
function showLogin() {
  document.getElementById('page-login').classList.add('active');
  document.getElementById('page-calendar').classList.remove('active');
  document.getElementById('page-orders').classList.remove('active');
}

// Mostra app
function showApp() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-calendar').classList.add('active');
  
  // Aggiorna nome utente negli header
  document.getElementById('username-display').textContent = currentUser;
}

// Setup Pull to Refresh
function setupPullToRefresh() {
  if (!window.PullToRefresh) return;
  
  // Calendar page
  const calendarPage = document.getElementById('page-calendar');
  new PullToRefresh(calendarPage, async () => {
    await autoRefreshCalendar();
  });
  
  // Orders page
  const ordersPage = document.getElementById('page-orders');
  new PullToRefresh(ordersPage, async () => {
    await autoRefreshOrders();
  });
}

// Setup event listeners
function setupEventListeners() {
  // Notifiche
  document.getElementById('btn-notifications').addEventListener('click', async () => {
    await requestNotificationPermission(true); // true = mostra sempre prompt
  });
  document.getElementById('btn-notifications-orders').addEventListener('click', async () => {
    await requestNotificationPermission(true);
  });
  
  // Logout
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-orders').addEventListener('click', logout);
  
  // Navigazione calendario
  document.getElementById('prev-month').addEventListener('click', () => {
    // Crea una nuova data per evitare problemi con setMonth
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    loadCalendar();
  });
  
  document.getElementById('next-month').addEventListener('click', () => {
    // Crea una nuova data per evitare problemi con setMonth
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    loadCalendar();
  });
  
  // Navigazione pagine
  document.getElementById('btn-back').addEventListener('click', () => {
    showPage('calendar');
  });
  
  document.getElementById('btn-new-order').addEventListener('click', () => {
    openNewOrderModal();
  });
  
  // Pulsante fabbisogno (solo Carlo e Dimitri)
  const btnFabbisogno = document.getElementById('btn-fabbisogno');
  
  if (currentUser && (currentUser === 'Carlo' || currentUser === 'Dimitri')) {
    btnFabbisogno.style.display = 'flex';
    btnFabbisogno.addEventListener('click', () => {
      openFabbisognoModal(currentDate);
    });
  } else {
    btnFabbisogno.style.display = 'none';
  }
  
  document.getElementById('btn-close-fabbisogno').addEventListener('click', () => {
    document.getElementById('modal-fabbisogno').classList.remove('active');
  });
  
  // Pulsante "Ordini di OGGI"
  document.getElementById('btn-today-orders').addEventListener('click', () => {
    const today = new Date();
    const todayStr = formatDate(today);
    openDayOrders(todayStr);
  });
  
  // Aggiorna conteggio ordini OGGI nel pulsante
  updateTodayButton();
  
  // Modal ordine
  document.getElementById('btn-close-modal').addEventListener('click', closeOrderModal);
  document.getElementById('order-form').addEventListener('submit', handleOrderSubmit);
  
  // Gestione bottoni delivery (FIX: mancava!)
  document.querySelectorAll('.btn-delivery').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const deliveryType = e.currentTarget.getAttribute('data-delivery');
      
      // Aggiorna valore hidden
      document.getElementById('delivery-type').value = deliveryType;
      
      // Aggiorna bottoni attivi
      document.querySelectorAll('.btn-delivery').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      // Mostra/nascondi campo indirizzo
      const addressGroup = document.getElementById('address-group');
      const addressInput = document.getElementById('delivery-address');
      
      if (deliveryType === 'consegna') {
        addressGroup.style.display = 'block';
        addressInput.required = true;
      } else {
        addressGroup.style.display = 'none';
        addressInput.required = false;
        addressInput.value = ''; // Pulisci indirizzo se passa a ritiro
      }
    });
  });
  
  // Gestione bottoni stato (FIX: mancava!)
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const status = e.currentTarget.getAttribute('data-status');
      
      // Aggiorna valore hidden
      document.getElementById('order-status').value = status;
      
      // Aggiorna bottoni attivi
      document.querySelectorAll('.btn-status').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
    });
  });
  
  // Modal dettaglio ordine
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    document.getElementById('modal-detail').classList.remove('active');
  });
  
  document.getElementById('btn-print-order').addEventListener('click', () => {
    window.print();
  });
  
  document.getElementById('btn-whatsapp-order').addEventListener('click', () => {
    shareOrderWhatsApp(currentDetailOrder);
  });
  
  document.getElementById('btn-edit-from-detail').addEventListener('click', () => {
    document.getElementById('modal-detail').classList.remove('active');
    // currentOrderId è già impostato, apri modal modifica
    const order = currentDetailOrder;
    if (order) {
      openEditOrderModal(order);
    }
  });
  
  // Modal visualizzatore foto
  document.getElementById('btn-close-photo').addEventListener('click', () => {
    document.getElementById('modal-photo').classList.remove('active');
  });
  
  // Click sullo sfondo chiude foto
  document.getElementById('modal-photo').addEventListener('click', (e) => {
    if (e.target.id === 'modal-photo' || e.target.classList.contains('photo-viewer')) {
      document.getElementById('modal-photo').classList.remove('active');
    }
  });
  
  // Pulsanti stato nel form
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-status').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      document.getElementById('order-status').value = e.target.dataset.status;
    });
  });
  
  // Pulsanti delivery type
  document.querySelectorAll('.btn-delivery').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.btn-delivery').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const deliveryType = e.target.dataset.delivery;
      document.getElementById('delivery-type').value = deliveryType;
      
      // Mostra/nascondi campo indirizzo
      const addressGroup = document.getElementById('address-group');
      if (deliveryType === 'consegna') {
        addressGroup.style.display = 'block';
        document.getElementById('delivery-address').required = true;
      } else {
        addressGroup.style.display = 'none';
        document.getElementById('delivery-address').required = false;
      }
    });
  });
  
  // Upload foto
  document.getElementById('btn-add-photo').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
  
  document.getElementById('photo-input').addEventListener('change', handlePhotoUpload);
  
  // Modal conferma eliminazione
  document.getElementById('btn-delete-order').addEventListener('click', () => {
    closeOrderModal();
    modalConfirm.classList.add('active');
  });
  
  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    modalConfirm.classList.remove('active');
  });
  
  document.getElementById('btn-confirm-delete').addEventListener('click', handleOrderDelete);
  
  // Chiudi modal cliccando fuori
  modalOrder.addEventListener('click', (e) => {
    if (e.target === modalOrder) closeOrderModal();
  });
  
  modalConfirm.addEventListener('click', (e) => {
    if (e.target === modalConfirm) modalConfirm.classList.remove('active');
  });
}

// Carica calendario
async function loadCalendar() {
  try {
    // Carica statistiche ordini
    const response = await authenticatedFetch(`${API_URL}/stats/dates`);
    const stats = await response.json();
    
    // Crea mappa per accesso veloce
    orderStats = {};
    stats.forEach(stat => {
      orderStats[stat.date] = stat;
    });
    
    // Genera giorni del mese
    renderCalendar();
    
    // Aggiorna pulsante OGGI
    updateTodayButton();
  } catch (error) {
    console.error('Errore caricamento calendario:', error);
    alert('Errore nel caricamento del calendario');
  }
}

// Aggiorna pulsante ordini di oggi con conteggio
function updateTodayButton() {
  const today = new Date();
  const todayStr = formatDate(today);
  const stat = orderStats[todayStr];
  const btnToday = document.getElementById('btn-today-orders');
  
  if (stat && stat.total > 0) {
    const text = stat.total === 1 ? 'ordine' : 'ordini';
    btnToday.innerHTML = `📅 ${stat.total} ${text} di OGGI`;
  } else {
    btnToday.innerHTML = `📅 Ordini di OGGI`;
  }
}

// Renderizza calendario
function renderCalendar() {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  // Aggiorna titolo mese
  const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;
  
  // Genera giorni del mese
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);
  
  daysList.innerHTML = '';
  let todayCard = null;
  
  // Trova il giorno corrente
  const todayDay = (today.getMonth() === month && today.getFullYear() === year) 
    ? today.getDate() 
    : 1;
  
  // Crea array di giorni partendo da oggi
  const days = [];
  
  // Prima: giorni da oggi alla fine del mese
  for (let day = todayDay; day <= lastDay.getDate(); day++) {
    days.push(day);
  }
  
  // Poi: giorni dall'inizio del mese a ieri
  for (let day = 1; day < todayDay; day++) {
    days.push(day);
  }
  
  // Renderizza giorni nell'ordine corretto
  for (let day of days) {
    const date = new Date(year, month, day);
    const dateStr = formatDate(date);
    const stat = orderStats[dateStr];
    const dayOfWeek = date.getDay(); // 0 = Domenica
    
    const dayCard = document.createElement('div');
    dayCard.className = 'day-card';
    dayCard.dataset.date = dateStr;
    
    // Classe per ordini
    if (stat && stat.total > 0) {
      dayCard.classList.add('has-orders');
    }
    
    // Classe OGGI
    const isToday = dateStr === todayStr;
    if (isToday) {
      dayCard.classList.add('today');
      todayCard = dayCard;
    }
    
    // Classe DOMENICA e FESTIVITÀ
    const monthDay = String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isHoliday = holidays.includes(monthDay);
    
    if (dayOfWeek === 0) {
      dayCard.classList.add('sunday');
    }
    if (isHoliday) {
      dayCard.classList.add('holiday');
    }
    
    // Formatta data italiana
    const dayName = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][dayOfWeek];
    let dateFormatted = `${dayName} ${day} ${monthNames[month]}`;
    
    let content = `<div class="day-date">${dateFormatted}`;
    
    // Badge OGGI
    if (isToday) {
      content += ` <span class="today-badge">⭐ OGGI</span>`;
    }
    
    // Badge DOMENICA/CHIUSO/FESTIVITÀ
    if (dayOfWeek === 0) {
      content += ` <span class="closed-badge">🔒 Domenica</span>`;
    } else if (isHoliday) {
      content += ` <span class="closed-badge">🎉 Festività</span>`;
    }
    
    content += `</div><div class="day-info">`;
    
    if (stat && stat.total > 0) {
      content += `
        <div class="day-count">📦 ${stat.total} ordin${stat.total === 1 ? 'e' : 'i'}</div>
        <div class="status-indicators">
      `;
      
      if (stat.da_preparare > 0) {
        content += `<span class="status-dot da-preparare" title="Da preparare"></span>`;
      }
      if (stat.pronto > 0) {
        content += `<span class="status-dot pronto" title="Pronto"></span>`;
      }
      
      content += `</div>`;
    } else {
      content += `<span style="color: #bbb;">Nessun ordine</span>`;
    }
    
    content += `</div>`;
    dayCard.innerHTML = content;
    
    dayCard.addEventListener('click', () => {
      openDayOrders(dateStr);
    });
    
    daysList.appendChild(dayCard);
  }
  
  // Scroll automatico al giorno corrente
  if (todayCard) {
    setTimeout(() => {
      todayCard.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center'
      });
    }, 300);
  }
}

// Apri ordini del giorno
async function openDayOrders(date) {
  currentDate = date;
  
  // Aggiorna titolo
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = dateObj.getDay();
  const dayName = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'][dayOfWeek];
  const day = dateObj.getDate();
  const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const month = monthNames[dateObj.getMonth()];
  
  // Controlla se è oggi
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = formatDate(dateObj) === formatDate(today);
  
  let titleText = `${dayName} ${day} ${month}`;
  if (isToday) {
    titleText = `⭐ OGGI - ${dayName} ${day} ${month}`;
  }
  
  // Controlla se è domenica o festività
  const monthDay = String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const isHoliday = holidays.includes(monthDay);
  const isSunday = dayOfWeek === 0;
  
  if (isSunday) {
    titleText += ' 🔒 Domenica';
  } else if (isHoliday) {
    titleText += ' 🎉 Festività';
  }
  
  document.getElementById('orders-date-title').textContent = titleText;
  
  // Carica ordini
  await loadOrders(date);
  
  // Mostra pagina ordini
  showPage('orders');
}

// Carica ordini di un giorno
async function loadOrders(date) {
  try {
    const response = await authenticatedFetch(`${API_URL}/orders/date/${date}`);
    const orders = await response.json();
    
    renderOrders(orders);
  } catch (error) {
    console.error('Errore caricamento ordini:', error);
    alert('Errore nel caricamento degli ordini');
  }
}

// Renderizza lista ordini
function renderOrders(orders) {
  ordersList.innerHTML = '';
  
  if (orders.length === 0) {
    emptyMessage.style.display = 'block';
    return;
  }
  
  emptyMessage.style.display = 'none';
  
  orders.forEach(order => {
    const orderCard = document.createElement('div');
    orderCard.className = `order-card status-${order.status}`;
    
    const statusLabels = {
      'da_preparare': 'Da preparare',
      'pronto': 'Pronto',
      'ritirato': 'Ritirato'
    };
    
    const orderTypeLabels = {
      'cliente': '👤 Cliente',
      'whatsapp': '💬 WhatsApp',
      'mail': '📧 Email',
      'telefono': '📞 Telefono'
    };
    
    const deliveryTypeLabels = {
      'ritiro': '📦 Ritiro',
      'consegna': '🚚 Consegna'
    };
    
    const goodsTypeLabels = {
      'in_cella': '❄️ In giacenza',
      'da_ordinare': '📝 Da ordinare',
      'ordinata': '📦 Ordinata'
    };
    
    // Costruisci info badges
    let infoBadges = '';
    if (order.order_type) {
      const badgeClass = order.order_type === 'cliente' ? '' : order.order_type;
      infoBadges += `<span class="info-badge ${badgeClass}">${orderTypeLabels[order.order_type] || order.order_type}</span>`;
    }
    if (order.goods_type) {
      const goodsClass = order.goods_type === 'da_ordinare' ? 'da_ordinare' : '';
      infoBadges += `<span class="info-badge ${goodsClass}">${goodsTypeLabels[order.goods_type] || order.goods_type}</span>`;
    }
    if (order.delivery_type) {
      const deliveryClass = order.delivery_type === 'consegna' ? 'consegna' : '';
      infoBadges += `<span class="info-badge ${deliveryClass}">${deliveryTypeLabels[order.delivery_type] || order.delivery_type}</span>`;
    }
    if (order.delivery_time) {
      infoBadges += `<span class="info-badge">🕐 ${order.delivery_time}</span>`;
    }
    if (order.delivery_type === 'consegna' && order.delivery_address) {
      infoBadges += `<span class="info-badge">📍 ${escapeHtml(order.delivery_address)}</span>`;
    }
    
    // Costruisci foto
    let photosHtml = '';
    if (order.photos && order.photos.length > 0) {
      photosHtml = '<div class="order-photos">';
      order.photos.forEach(photo => {
        photosHtml += `<img src="${photo}" class="order-photo-thumb" alt="Foto ordine">`;
      });
      photosHtml += '</div>';
    }
    
    // Info utente
    let userInfoHtml = '<div class="order-user-info">';
    if (order.created_by) {
      userInfoHtml += `<span class="user-info-item">✏️ Creato da <strong>${escapeHtml(order.created_by)}</strong></span>`;
    }
    if (order.updated_by && order.updated_at) {
      const updatedDate = new Date(order.updated_at);
      const timeStr = updatedDate.toLocaleString('it-IT', { 
        day: '2-digit', 
        month: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      userInfoHtml += `<span class="user-info-item">🔄 Modificato da <strong>${escapeHtml(order.updated_by)}</strong> il ${timeStr}</span>`;
    }
    userInfoHtml += '</div>';
    
    orderCard.innerHTML = `
      <div class="order-content">
        <div class="order-header">
          <div class="order-customer">${escapeHtml(order.customer)}</div>
          <span class="order-status-badge ${order.status}">${statusLabels[order.status]}</span>
        </div>
        ${infoBadges ? `<div class="order-info">${infoBadges}</div>` : ''}
        <div class="order-description">${escapeHtml(order.description)}</div>
        ${photosHtml}
        ${userInfoHtml}
      </div>
      <div class="order-actions">
        <button class="btn-small btn-detail" data-id="${order.id}">👁️ Dettaglio</button>
        <button class="btn-small btn-edit" data-id="${order.id}">✏️ Modifica</button>
        ${order.status !== 'pronto' && order.status !== 'ritirato' ? 
          `<button class="btn-small btn-ready" data-id="${order.id}">✓ Pronto</button>` : ''}
        ${order.status === 'pronto' ? 
          `<button class="btn-small btn-collected" data-id="${order.id}">✓ Ritirato</button>` : ''}
      </div>
    `;
    
    // Click sulla card (esclusi i pulsanti) apre dettaglio
    const orderContent = orderCard.querySelector('.order-content');
    orderContent.addEventListener('click', () => {
      openOrderDetail(order);
    });
    
    // Event listeners pulsanti
    orderCard.querySelector('.btn-detail').addEventListener('click', (e) => {
      e.stopPropagation();
      openOrderDetail(order);
    });
    
    orderCard.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditOrderModal(order);
    });
    
    const btnReady = orderCard.querySelector('.btn-ready');
    if (btnReady) {
      btnReady.addEventListener('click', (e) => {
        e.stopPropagation();
        updateOrderStatus(order.id, 'pronto');
      });
    }
    
    const btnCollected = orderCard.querySelector('.btn-collected');
    if (btnCollected) {
      btnCollected.addEventListener('click', (e) => {
        e.stopPropagation();
        updateOrderStatus(order.id, 'ritirato');
      });
    }
    
    ordersList.appendChild(orderCard);
  });
}

// Apri modal nuovo ordine
function openNewOrderModal() {
  // Controlla se è domenica o festività
  const dateObj = new Date(currentDate + 'T00:00:00');
  const dayOfWeek = dateObj.getDay();
  const day = dateObj.getDate();
  const month = dateObj.getMonth() + 1;
  const monthDay = String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const isHoliday = holidays.includes(monthDay);
  
  if (dayOfWeek === 0) {
    if (!confirm('⚠️ ATTENZIONE!\n\nStai creando un ordine per DOMENICA.\nSiamo normalmente chiusi.\n\nVuoi continuare?')) {
      return;
    }
  } else if (isHoliday) {
    if (!confirm('⚠️ ATTENZIONE!\n\nStai creando un ordine per una FESTIVITÀ.\nSiamo normalmente chiusi.\n\nVuoi continuare?')) {
      return;
    }
  }
  
  currentOrderId = null;
  uploadedPhotos = [];
  
  document.getElementById('modal-title').textContent = 'Nuovo ordine';
  document.getElementById('order-form').reset();
  document.getElementById('order-id').value = '';
  document.getElementById('order-date').value = currentDate;
  document.getElementById('order-status').value = 'da_preparare';
  document.getElementById('order-type').value = 'cliente';
  document.getElementById('delivery-type').value = 'ritiro';
  
  // Mostra/nascondi opzione "ordinata" in base all'utente (NUOVO ordine, NON modifica)
  updateGoodsTypeOptions(false);
  
  // Imposta goods_type DOPO aver aggiornato le opzioni
  document.getElementById('goods-type').value = 'in_cella';
  
  // Reset delivery buttons
  document.querySelectorAll('.btn-delivery').forEach(b => b.classList.remove('active'));
  document.querySelector('.btn-delivery[data-delivery="ritiro"]').classList.add('active');
  
  document.getElementById('address-group').style.display = 'none';
  document.getElementById('status-group').style.display = 'none';
  document.getElementById('btn-delete-order').style.display = 'none';
  
  renderPhotoPreview();
  modalOrder.classList.add('active');
}

// Apri modal modifica ordine
function openEditOrderModal(order) {
  currentOrderId = order.id;
  uploadedPhotos = order.photos || [];
  
  document.getElementById('modal-title').textContent = 'Modifica ordine';
  document.getElementById('order-id').value = order.id;
  document.getElementById('order-date').value = order.date;
  document.getElementById('order-customer').value = order.customer;
  document.getElementById('order-description').value = order.description;
  document.getElementById('order-status').value = order.status;
  
  // Nuovi campi
  document.getElementById('order-type').value = order.order_type || 'cliente';
  document.getElementById('delivery-type').value = order.delivery_type || 'ritiro';
  document.getElementById('delivery-time').value = order.delivery_time || '';
  document.getElementById('delivery-address').value = order.delivery_address || '';
  
  // Mostra/nascondi opzione "ordinata" in base all'utente (MODIFICA ordine)
  updateGoodsTypeOptions(true);
  
  // Imposta goods_type DOPO aver aggiornato le opzioni
  document.getElementById('goods-type').value = order.goods_type || 'in_cella';
  
  // Delivery buttons
  document.querySelectorAll('.btn-delivery').forEach(b => b.classList.remove('active'));
  const deliveryType = order.delivery_type || 'ritiro';
  document.querySelector(`.btn-delivery[data-delivery="${deliveryType}"]`)?.classList.add('active');
  
  // Mostra/nascondi indirizzo
  const addressGroup = document.getElementById('address-group');
  if (deliveryType === 'consegna') {
    addressGroup.style.display = 'block';
    document.getElementById('delivery-address').required = true;
  } else {
    addressGroup.style.display = 'none';
    document.getElementById('delivery-address').required = false;
  }
  
  // Mostra gruppo stato
  document.getElementById('status-group').style.display = 'block';
  
  // Seleziona stato attuale
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.status === order.status) {
      btn.classList.add('active');
    }
  });
  
  document.getElementById('btn-delete-order').style.display = 'block';
  
  renderPhotoPreview();
  modalOrder.classList.add('active');
}

// Chiudi modal ordine
function closeOrderModal() {
  modalOrder.classList.remove('active');
}

// Gestisci submit form ordine
async function handleOrderSubmit(e) {
  e.preventDefault();
  
  const orderId = document.getElementById('order-id').value;
  const date = document.getElementById('order-date').value;
  const customer = document.getElementById('order-customer').value.trim();
  const description = document.getElementById('order-description').value.trim();
  const status = document.getElementById('order-status').value;
  const orderType = document.getElementById('order-type').value;
  const goodsType = document.getElementById('goods-type').value;
  const deliveryType = document.getElementById('delivery-type').value;
  const deliveryTime = document.getElementById('delivery-time').value;
  const deliveryAddress = document.getElementById('delivery-address').value.trim();
  
  if (!customer || !description) {
    alert('Compila tutti i campi obbligatori');
    return;
  }
  
  if (deliveryType === 'consegna' && !deliveryAddress) {
    alert('Inserisci l\'indirizzo di consegna');
    return;
  }
  
  const orderData = {
    customer,
    description,
    status,
    order_type: orderType,
    goods_type: goodsType,
    delivery_type: deliveryType,
    delivery_time: deliveryTime || null,
    delivery_address: deliveryAddress || null,
    photos: uploadedPhotos
  };
  
  try {
    if (orderId) {
      // Aggiorna ordine esistente
      await authenticatedFetch(`${API_URL}/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
    } else {
      // Crea nuovo ordine
      await authenticatedFetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, date })
      });
    }
    
    closeOrderModal();
    uploadedPhotos = [];
    await loadOrders(currentDate);
    await loadCalendar();
  } catch (error) {
    console.error('Errore salvataggio ordine:', error);
    alert('Errore nel salvataggio dell\'ordine');
  }
}

// Aggiorna solo stato ordine
async function updateOrderStatus(orderId, status) {
  try {
    await authenticatedFetch(`${API_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    
    await loadOrders(currentDate);
    await loadCalendar();
  } catch (error) {
    console.error('Errore aggiornamento stato:', error);
    alert('Errore nell\'aggiornamento dello stato');
  }
}

// Elimina ordine
async function handleOrderDelete() {
  if (!currentOrderId) return;
  
  try {
    await authenticatedFetch(`${API_URL}/orders/${currentOrderId}`, {
      method: 'DELETE'
    });
    
    modalConfirm.classList.remove('active');
    await loadOrders(currentDate);
    await loadCalendar();
  } catch (error) {
    console.error('Errore eliminazione ordine:', error);
    alert('Errore nell\'eliminazione dell\'ordine');
  }
}

// Cambia pagina
function showPage(page) {
  pageCalendar.classList.remove('active');
  pageOrders.classList.remove('active');
  
  if (page === 'calendar') {
    pageCalendar.classList.add('active');
  } else if (page === 'orders') {
    pageOrders.classList.add('active');
  }
  
  // Scroll in alto
  window.scrollTo(0, 0);
}

// Utility: formatta data YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Utility: escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==========================================
// NOTIFICHE PUSH
// ==========================================

async function requestNotificationPermission(manualRequest = false) {
  const notifBtn = document.getElementById('btn-notifications');
  
  // Verifica supporto notifiche
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('Notifiche push non supportate');
    if (manualRequest) {
      alert('⚠️ Il tuo browser non supporta le notifiche push.\n\nProva con Chrome o Firefox!');
    }
    return;
  }
  
  try {
    // Se già autorizzato, registra e aggiorna UI
    if (Notification.permission === 'granted') {
      await registerPushSubscription();
      if (notifBtn) {
        notifBtn.classList.add('active');
        notifBtn.title = 'Notifiche attive ✓';
      }
      if (manualRequest) {
        alert('✅ Notifiche già attive!\n\nRiceverai un avviso ogni mattina alle 7:00.');
      }
      return;
    }
    
    // Se rifiutato
    if (Notification.permission === 'denied') {
      if (manualRequest) {
        alert('⚠️ Permessi notifiche negati!\n\nPer attivarle:\n1. Clicca sul lucchetto nella barra indirizzi\n2. Vai a Impostazioni sito\n3. Notifiche → Consenti');
      }
      return;
    }
    
    // Richiedi permesso
    if (manualRequest) {
      // Richiesta immediata se manuale
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await registerPushSubscription();
        if (notifBtn) {
          notifBtn.classList.add('active');
          notifBtn.title = 'Notifiche attive ✓';
        }
        // Mostra notifica di conferma
        new Notification('🔔 Notifiche Attivate', {
          body: 'Riceverai un avviso ogni mattina alle 7:00 per gli ordini del giorno!',
          icon: '/icon-192.png',
          vibrate: [200, 100, 200]
        });
      }
    } else {
      // Richiesta automatica dopo 5 secondi
      setTimeout(async () => {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          await registerPushSubscription();
          if (notifBtn) {
            notifBtn.classList.add('active');
            notifBtn.title = 'Notifiche attive ✓';
          }
          new Notification('🔔 Notifiche Attivate', {
            body: 'Riceverai un avviso ogni mattina alle 7:00 per gli ordini del giorno!',
            icon: '/icon-192.png',
            vibrate: [200, 100, 200]
          });
        }
      }, 5000);
    }
  } catch (error) {
    console.error('Errore permessi notifiche:', error);
    if (manualRequest) {
      alert('❌ Errore attivazione notifiche:\n' + error.message);
    }
  }
}

async function registerPushSubscription() {
  try {
    const registration = await navigator.serviceWorker.ready;
    
    // Ottieni la public key VAPID
    const response = await authenticatedFetch(`${API_URL}/push/vapid-public-key`);
    const { publicKey } = await response.json();
    
    // Converti la chiave pubblica
    const convertedVapidKey = urlBase64ToUint8Array(publicKey);
    
    // Ottieni o crea subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      });
    }
    
    // Invia al server
    await authenticatedFetch(`${API_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription })
    });
    
    console.log('✓ Notifiche push registrate');
  } catch (error) {
    console.error('Errore registrazione push:', error);
  }
}

// Helper per convertire VAPID key
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Test notifica (per debug)
async function testNotification() {
  try {
    await authenticatedFetch(`${API_URL}/push/test`, {
      method: 'POST'
    });
    alert('Notifica di test inviata!');
  } catch (error) {
    console.error('Errore test notifica:', error);
    alert('Errore invio notifica di test');
  }
}

// Esponi la funzione test per debug da console
window.testNotification = testNotification;

// Gestione upload foto
async function handlePhotoUpload(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  const formData = new FormData();
  for (let file of files) {
    formData.append('photos', file);
  }
  
  try {
    const response = await authenticatedFetch(`${API_URL}/upload`, {
      method: 'POST',
      body: formData,
      headers: {} // FormData gestisce Content-Type automaticamente
    });
    
    if (!response.ok) throw new Error('Errore upload');
    
    const data = await response.json();
    uploadedPhotos = [...uploadedPhotos, ...data.photos];
    renderPhotoPreview();
    
    // Reset input
    e.target.value = '';
  } catch (error) {
    console.error('Errore upload foto:', error);
    alert('Errore nel caricamento delle foto');
  }
}

// Renderizza anteprima foto
function renderPhotoPreview() {
  const preview = document.getElementById('photo-preview');
  preview.innerHTML = '';
  
  uploadedPhotos.forEach((photoUrl, index) => {
    const item = document.createElement('div');
    item.className = 'photo-item';
    item.innerHTML = `
      <img src="${photoUrl}" alt="Foto ${index + 1}">
      <button type="button" class="btn-remove-photo" data-index="${index}">×</button>
    `;
    
    // Rimuovi foto
    item.querySelector('.btn-remove-photo').addEventListener('click', () => {
      removePhoto(index);
    });
    
    preview.appendChild(item);
  });
}

// Rimuovi foto
function removePhoto(index) {
  uploadedPhotos.splice(index, 1);
  renderPhotoPreview();
}

// Apri modal fabbisogno
async function openFabbisognoModal(date) {
  try {
    // Usa la data passata o quella corrente
    const dateToUse = date || currentDate;
    if (!dateToUse) {
      alert('Seleziona prima un giorno dal calendario');
      return;
    }
    
    // Salva la data per i reload
    currentFabbisognoDate = dateToUse;
    
    const response = await authenticatedFetch(`${API_URL}/orders/date/${dateToUse}`);
    const allOrders = await response.json();
    
    // Filtra solo ordini da preparare e pronti (escludi ritirati)
    const activeOrders = allOrders.filter(order => 
      order.status === 'da_preparare' || order.status === 'pronto'
    );
    
    renderFabbisogno(activeOrders, allOrders.length);
    document.getElementById('modal-fabbisogno').classList.add('active');
  } catch (error) {
    console.error('Errore caricamento fabbisogno:', error);
    alert('Errore nel caricamento del fabbisogno');
  }
}

// Renderizza fabbisogno
function renderFabbisogno(orders, totalOrders = 0) {
  const fabbisognoList = document.getElementById('fabbisogno-list');
  const fabbisognoEmpty = document.getElementById('fabbisogno-empty');
  
  fabbisognoList.innerHTML = '';
  
  // Se non ci sono ordini attivi (da preparare o pronti)
  if (orders.length === 0) {
    fabbisognoEmpty.style.display = 'block';
    fabbisognoList.style.display = 'none';
    
    // Aggiorna messaggio in base al contesto
    const emptyP = fabbisognoEmpty.querySelector('p:first-child');
    const emptySubtitle = fabbisognoEmpty.querySelector('.empty-subtitle');
    
    if (totalOrders === 0) {
      emptyP.textContent = '📭 Nessun ordine per questo giorno';
      emptySubtitle.textContent = '';
    } else {
      emptyP.textContent = '✅ Tutti gli ordini completati';
      emptySubtitle.textContent = 'Tutti gli ordini sono stati ritirati';
    }
    return;
  }
  
  fabbisognoEmpty.style.display = 'none';
  fabbisognoList.style.display = 'flex';
  
  // Aggiorna titolo con conteggio
  const daPreparare = orders.filter(o => o.status === 'da_preparare').length;
  const pronti = orders.filter(o => o.status === 'pronto').length;
  const title = document.getElementById('fabbisogno-title');
  title.innerHTML = `Fabbisogno del giorno <span style="color: var(--color-primary); font-weight: 700;">(${daPreparare} da prep. • ${pronti} pronti)</span>`;
  
  // Ordina per: 
  // 1. Stato (da_preparare prima, poi pronto, poi ritirato)
  // 2. Tipo merce (da_ordinare > ordinata > in_cella)
  const sortedOrders = [...orders].sort((a, b) => {
    // Prima per stato
    const statusOrder = { 'da_preparare': 0, 'pronto': 1, 'ritirato': 2 };
    const statusDiff = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
    if (statusDiff !== 0) return statusDiff;
    
    // Poi per tipo merce (priorità: da_ordinare > ordinata > in_cella)
    const goodsOrder = { 'da_ordinare': 0, 'ordinata': 1, 'in_cella': 2 };
    const goodsDiff = (goodsOrder[a.goods_type] || 2) - (goodsOrder[b.goods_type] || 2);
    return goodsDiff;
  });
  
  sortedOrders.forEach(order => {
    const item = document.createElement('div');
    const goodsType = order.goods_type || 'in_cella';
    const status = order.status || 'da_preparare';
    
    // Converti underscore in trattini per CSS
    const goodsTypeClass = goodsType.replace(/_/g, '-');
    
    // Classe per tipo merce E stato
    item.className = `fabbisogno-item ${goodsTypeClass} status-${status}`;
    
    const badgeLabels = {
      'in_cella': 'In giacenza',
      'da_ordinare': 'Da ordinare',
      'ordinata': 'Ordinata'
    };
    
    const statusLabels = {
      'da_preparare': 'Da preparare',
      'pronto': 'Pronto',
      'ritirato': 'Ritirato'
    };
    
    const orderTypeLabels = {
      'cliente': '👤',
      'whatsapp': '💬',
      'mail': '📧',
      'telefono': '📞'
    };
    
    const deliveryLabel = order.delivery_type === 'consegna' ? '🚚' : '📦';
    
    let metaInfo = `<span class="info-badge">${orderTypeLabels[order.order_type] || '👤'}</span>`;
    metaInfo += `<span class="info-badge">${deliveryLabel}</span>`;
    if (order.delivery_time) {
      metaInfo += `<span class="info-badge">🕐 ${order.delivery_time}</span>`;
    }
    // Aggiungi badge stato
    metaInfo += `<span class="info-badge status-${status}">${statusLabels[status]}</span>`;
    
    // Pulsanti gestione merce (solo per Carlo e Dimitri)
    let goodsButtons = '';
    if (currentUser && (currentUser === 'Carlo' || currentUser === 'Dimitri')) {
      if (goodsType === 'da_ordinare') {
        goodsButtons = `<button class="btn-goods-action btn-mark-ordered" onclick="markAsOrdered(${order.id})">📦 Segna come ordinata</button>`;
      } else if (goodsType === 'ordinata') {
        goodsButtons = `<button class="btn-goods-action btn-mark-available" onclick="markAsAvailable(${order.id})">✅ Segna in giacenza</button>`;
      }
    }
    
    item.innerHTML = `
      <div class="fabbisogno-header">
        <div class="fabbisogno-customer">
          <span class="fabbisogno-dot ${goodsTypeClass}"></span>
          ${escapeHtml(order.customer)}
        </div>
        <span class="fabbisogno-badge ${goodsTypeClass}">${badgeLabels[goodsType]}</span>
      </div>
      <div class="fabbisogno-description">${escapeHtml(order.description)}</div>
      <div class="fabbisogno-meta">${metaInfo}</div>
      ${goodsButtons ? `<div class="fabbisogno-actions">${goodsButtons}</div>` : ''}
    `;
    
    fabbisognoList.appendChild(item);
  });
}

// Funzione per mostrare/nascondere opzione "ordinata" nel form
function updateGoodsTypeOptions(isEditMode = false) {
  const goodsTypeSelect = document.getElementById('goods-type');
  if (!goodsTypeSelect) return;
  
  // Trova l'opzione "ordinata"
  let ordinataOption = goodsTypeSelect.querySelector('option[value="ordinata"]');
  
  const infoSpan = document.getElementById('goods-type-info');
  
  // VENDITORI: In modifica, il campo è DISABILITATO (solo visualizzazione)
  if (currentUser && currentUser !== 'Carlo' && currentUser !== 'Dimitri') {
    if (isEditMode) {
      // Disabilita il campo per i venditori in modifica
      goodsTypeSelect.disabled = true;
      goodsTypeSelect.style.opacity = '0.6';
      goodsTypeSelect.style.cursor = 'not-allowed';
      if (infoSpan) infoSpan.style.display = 'inline';
    } else {
      // In creazione nuovo ordine, rimuovi "ordinata" e abilita
      goodsTypeSelect.disabled = false;
      goodsTypeSelect.style.opacity = '1';
      goodsTypeSelect.style.cursor = 'pointer';
      if (infoSpan) infoSpan.style.display = 'none';
      if (ordinataOption) {
        ordinataOption.remove();
      }
    }
  } else if (currentUser && (currentUser === 'Carlo' || currentUser === 'Dimitri')) {
    // MAGAZZINIERI: possono sempre modificare
    goodsTypeSelect.disabled = false;
    goodsTypeSelect.style.opacity = '1';
    goodsTypeSelect.style.cursor = 'pointer';
    if (infoSpan) infoSpan.style.display = 'none';
    
    // Aggiungi opzione "ordinata" se non c'è
    if (!ordinataOption) {
      ordinataOption = document.createElement('option');
      ordinataOption.value = 'ordinata';
      ordinataOption.textContent = 'Merce ordinata';
      goodsTypeSelect.appendChild(ordinataOption);
    }
  }
}

// Funzione per segnare merce come ordinata (Carlo/Dimitri)
async function markAsOrdered(orderId) {
  if (!confirm('Segnare questa merce come ordinata?')) return;
  
  try {
    // Feedback visivo
    const button = event.target.closest('.btn-goods-action');
    if (button) {
      button.disabled = true;
      button.innerHTML = '⏳ Aggiornamento...';
    }
    
    const response = await authenticatedFetch(`${API_URL}/orders/${orderId}/goods-type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goods_type: 'ordinata' })
    });
    
    if (!response.ok) throw new Error('Errore aggiornamento');
    
    // Ricarica il fabbisogno con la data salvata
    await openFabbisognoModal(currentFabbisognoDate);
  } catch (error) {
    console.error('Errore:', error);
    alert('Errore nell\'aggiornamento dello stato della merce');
    // Ricarica comunque per ripristinare lo stato
    if (currentFabbisognoDate) {
      await openFabbisognoModal(currentFabbisognoDate);
    }
  }
}

// Funzione per segnare merce come in giacenza (Carlo/Dimitri)
async function markAsAvailable(orderId) {
  if (!confirm('Segnare questa merce come in giacenza?')) return;
  
  try {
    // Feedback visivo
    const button = event.target.closest('.btn-goods-action');
    if (button) {
      button.disabled = true;
      button.innerHTML = '⏳ Aggiornamento...';
    }
    
    const response = await authenticatedFetch(`${API_URL}/orders/${orderId}/goods-type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goods_type: 'in_cella' })
    });
    
    if (!response.ok) throw new Error('Errore aggiornamento');
    
    // Ricarica il fabbisogno con la data salvata
    await openFabbisognoModal(currentFabbisognoDate);
  } catch (error) {
    console.error('Errore:', error);
    alert('Errore nell\'aggiornamento dello stato della merce');
    // Ricarica comunque per ripristinare lo stato
    if (currentFabbisognoDate) {
      await openFabbisognoModal(currentFabbisognoDate);
    }
  }
}

// Apri dettaglio ordine
function openOrderDetail(order) {
  currentDetailOrder = order;
  currentOrderId = order.id;
  
  const modal = document.getElementById('modal-detail');
  renderOrderDetail(order);
  modal.classList.add('active');
}

// Renderizza dettaglio ordine
function renderOrderDetail(order) {
  const statusLabels = {
    'da_preparare': 'Da preparare',
    'pronto': 'Pronto',
    'ritirato': 'Ritirato'
  };
  
  const orderTypeLabels = {
    'cliente': '👤 Cliente',
    'whatsapp': '💬 WhatsApp',
    'mail': '📧 Email',
    'telefono': '📞 Telefono'
  };
  
  const deliveryTypeLabels = {
    'ritiro': '📦 Ritiro',
    'consegna': '🚚 Consegna'
  };
  
  const goodsTypeLabels = {
    'in_cella': '❄️ In giacenza',
    'da_ordinare': '📝 Da ordinare',
    'ordinata': '📦 Ordinata'
  };
  
  // Formatta data in italiano (versione lunga)
  const dateObj = new Date(order.date + 'T00:00:00');
  const dateFormatted = dateObj.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  // Formatta data breve per stampa
  const dateShort = dateObj.toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }).toUpperCase();
  
  // Aggiorna titolo per stampa (cliente + data)
  document.getElementById('detail-header-title').textContent = `${order.customer} - ${dateShort}`;
  
  // Intestazione stampa per impilamento ordini
  const deliveryIcon = order.delivery_type === 'consegna' ? '🚚' : '📦';
  const deliveryText = order.delivery_type === 'consegna' ? 'CONSEGNA' : 'RITIRO';
  const deliveryTime = order.delivery_time ? ` - Ore ${order.delivery_time}` : '';
  
  // Layout ottimizzato per stampa su una pagina
  let html = `
    <div class="print-header-stack">
      <div class="print-stack-content">
        <div class="print-stack-customer">
          ${escapeHtml(order.customer)}
        </div>
        <div class="print-stack-date">
          ${dateFormatted}
        </div>
        <div class="print-stack-delivery ${order.delivery_type}">
          ${deliveryIcon} ${deliveryText}${deliveryTime}
        </div>
      </div>
      <img src="logo.png" alt="LombardaFlor" class="print-stack-logo">
    </div>
    
    <div class="detail-section no-print">
      <h3>Stato Attuale</h3>
      <span class="detail-status order-status-badge ${order.status}">${statusLabels[order.status]}</span>
    </div>
    
    <!-- Versione schermo: testo normale -->
    <div class="detail-section no-print">
      <h3>Merce da Preparare</h3>
      <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(order.description)}</p>
    </div>
    
    <!-- Versione stampa: con checkbox per ogni riga -->
    <div class="detail-section print-show">
      <h3>Merce da Preparare</h3>
      <div class="print-checklist">
        ${order.description.split('\n').map(line => {
          const trimmed = line.trim();
          if (trimmed === '') return '<div class="print-checklist-spacer"></div>';
          return `
            <div class="print-checklist-item">
              <span class="print-checkbox-square"></span>
              <span class="print-checklist-text">${escapeHtml(trimmed)}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    
    <div class="print-checkbox-area">
      <div class="print-checkbox">
        <span class="checkbox-square"></span>
        <span class="checkbox-label">Merce preparata</span>
      </div>
      <div class="print-checkbox">
        <span class="checkbox-square"></span>
        <span class="checkbox-label">Merce controllata</span>
      </div>
      <div class="print-checkbox">
        <span class="checkbox-square"></span>
        <span class="checkbox-label">Pronta per ${order.delivery_type === 'consegna' ? 'consegna' : 'ritiro'}</span>
      </div>
    </div>
  `;
  
  // Info aggiuntive (solo a schermo, non in stampa)
  if (order.order_type || order.goods_type || order.delivery_type) {
    html += `<div class="detail-section no-print"><h3>Dettagli</h3>`;
    
    if (order.order_type) {
      html += `<p><strong>Tipo ordine:</strong> ${orderTypeLabels[order.order_type] || order.order_type}</p>`;
    }
    
    if (order.goods_type) {
      html += `<p><strong>Tipo merce:</strong> ${goodsTypeLabels[order.goods_type] || order.goods_type}</p>`;
    }
    
    if (order.delivery_type) {
      html += `<p><strong>Modalità:</strong> ${deliveryTypeLabels[order.delivery_type] || order.delivery_type}</p>`;
    }
    
    if (order.delivery_time) {
      html += `<p><strong>Orario:</strong> ${order.delivery_time}</p>`;
    }
    
    if (order.delivery_type === 'consegna' && order.delivery_address) {
      html += `<p><strong>Indirizzo:</strong> ${escapeHtml(order.delivery_address)}</p>`;
    }
    
    html += `</div>`;
  }
  
  // Foto (solo a schermo)
  if (order.photos && order.photos.length > 0) {
    html += `
      <div class="detail-section no-print">
        <h3>Foto (${order.photos.length})</h3>
        <div class="detail-photos">
    `;
    
    order.photos.forEach(photo => {
      html += `<img src="${photo}" class="detail-photo" alt="Foto ordine" onclick="openPhotoViewer('${photo}')">`;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  // Timestamp e info utente (solo a schermo)
  if (order.created_at || order.created_by) {
    html += `
      <div class="detail-section no-print">
        <h3>Info Ordine</h3>
    `;
    
    if (order.created_by) {
      const createdDate = order.created_at ? new Date(order.created_at).toLocaleString('it-IT') : '';
      html += `<p><strong>✏️ Creato da:</strong> ${escapeHtml(order.created_by)}${createdDate ? ` il ${createdDate}` : ''}</p>`;
    }
    
    if (order.updated_by && order.updated_at && order.updated_at !== order.created_at) {
      const updatedDate = new Date(order.updated_at);
      html += `<p><strong>🔄 Ultima modifica da:</strong> ${escapeHtml(order.updated_by)} il ${updatedDate.toLocaleString('it-IT')}</p>`;
    }
    
    html += `</div>`;
  }
  
  document.getElementById('detail-content').innerHTML = html;
  
  // Configura pulsanti cambio stato
  const statusButtons = document.querySelectorAll('.btn-status-change');
  statusButtons.forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.status === order.status) {
      btn.classList.add('active');
    }
    
    // Rimuovi vecchi listeners e aggiungi nuovi
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.addEventListener('click', async () => {
      const newStatus = newBtn.dataset.status;
      if (newStatus !== order.status) {
        await updateOrderStatus(order.id, newStatus);
        // Ricarica l'ordine aggiornato
        const response = await authenticatedFetch(`${API_URL}/orders/${order.id}`);
        const updatedOrder = await response.json();
        currentDetailOrder = updatedOrder;
        renderOrderDetail(updatedOrder);
      }
    });
  });
}

// Apri visualizzatore foto
function openPhotoViewer(photoUrl) {
  document.getElementById('photo-viewer-img').src = photoUrl;
  document.getElementById('modal-photo').classList.add('active');
}

// Condividi ordine su WhatsApp
function shareOrderWhatsApp(order) {
  if (!order) return;
  
  // Formatta data
  const dateObj = new Date(order.date + 'T00:00:00');
  const dateFormatted = dateObj.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  
  // Costruisci messaggio
  let message = `📋 *ORDINE LOMBARDAFLOR*\n\n`;
  message += `👤 *Cliente:* ${order.customer}\n`;
  message += `📅 *Data:* ${dateFormatted}\n\n`;
  message += `🌸 *Merce:*\n${order.description}\n\n`;
  
  // Info aggiuntive se presenti
  if (order.delivery_type === 'consegna') {
    message += `🚚 *Consegna*\n`;
    if (order.delivery_time) {
      message += `⏰ Orario: ${order.delivery_time}\n`;
    }
    if (order.delivery_address) {
      message += `📍 Indirizzo: ${order.delivery_address}\n`;
    }
    message += `\n`;
  } else if (order.delivery_time) {
    message += `📦 *Ritiro* alle ${order.delivery_time}\n\n`;
  }
  
  // Tipo merce
  if (order.goods_type === 'da_ordinare') {
    message += `⚠️ *Merce da ordinare*\n\n`;
  } else {
    message += `✅ *Merce in cella*\n\n`;
  }
  
  message += `───────────────\n`;
  message += `_Ordine creato da ${order.created_by || 'Sistema'}_`;
  
  // Encode per URL
  const encodedMessage = encodeURIComponent(message);
  
  // Apri WhatsApp
  // Su mobile usa whatsapp://, su desktop usa https://wa.me/
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const whatsappUrl = isMobile 
    ? `whatsapp://send?text=${encodedMessage}`
    : `https://wa.me/?text=${encodedMessage}`;
  
  window.open(whatsappUrl, '_blank');
}

