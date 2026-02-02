// Configurazione API
const API_URL = window.location.origin + '/api';

// Stato globale
let currentDate = null;
let currentMonth = new Date(); // Parte dal mese corrente
let currentOrderId = null;
let currentDetailOrder = null;
let currentEditOrder = null;
let orderStats = {};
let uploadedPhotos = []; // Array di URL foto caricate
let authToken = null;
let currentUser = null;
let autoRefreshInterval = null;
let lastUpdateTime = new Date();
let currentFabbisognoDate = null; // Data inizio del fabbisogno aperto
let currentFabbisognoDateTo = null; // Data fine del fabbisogno aperto (null = singolo giorno)

// Cache in-memory per performance
let calendarCache = null;
let calendarCacheTime = 0;
const CALENDAR_CACHE_TTL = 5000; // 5 secondi (ridotto per aggiornamenti più rapidi)

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

let isAppInitialized = false;

async function initializeApp() {
  // Previeni inizializzazione multipla (causa listener duplicati)
  if (isAppInitialized) {
    console.log('⚠️ App già inizializzata, skip');
    return;
  }
  
  isAppInitialized = true;
  
  // Registra service worker per PWA
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/service-worker.js');
      console.log('✓ Service Worker registrato');
    } catch (error) {
      console.log('Service Worker non registrato:', error);
    }
  }
  
  console.log('🚀 Chiamo setupEventListeners()...');
  try {
    setupEventListeners();
    console.log('✅ setupEventListeners() completato');
  } catch (error) {
    console.error('❌ ERRORE in setupEventListeners():', error);
    console.error('Stack:', error.stack);
  }
  // Pull-to-refresh disabilitato (dava problemi)
  // setupPullToRefresh();
  
  // Richiedi permessi notifiche
  await requestNotificationPermission();
  
  // Mostra calendario
  await loadCalendar(); // Usa cache se disponibile
  
  // Avvia auto-refresh ogni 2 minuti
  startAutoRefresh();
}

// Auto-refresh ogni 3 minuti
function startAutoRefresh() {
  // Pulisci intervallo esistente
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
  }
  
  // Auto-refresh ogni 3 minuti SOLO se tab visibile
  autoRefreshInterval = setInterval(() => {
    // Skip se tab non visibile (performance)
    if (document.hidden) {
      return;
    }
    
    const currentPage = document.querySelector('.page.active');
    if (currentPage && currentPage.id === 'page-calendar') {
      autoRefreshCalendar();
    } else if (currentPage && currentPage.id === 'page-orders') {
      autoRefreshOrders();
    }
  }, 180000); // 3 minuti
  
  // Refresh quando tab torna visibile
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const currentPage = document.querySelector('.page.active');
      if (currentPage && currentPage.id === 'page-calendar') {
        autoRefreshCalendar();
      } else if (currentPage && currentPage.id === 'page-orders') {
        autoRefreshOrders();
      }
    }
  });
  
  console.log('⏰ Auto-refresh attivo: ogni 3 minuti (solo se tab visibile)');
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
    logout(false);
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
    // Sessione scaduta - passa flag per evitare chiamata API logout
    console.warn('[AUTH] Sessione scaduta, reindirizzamento a login');
    logout(true); // true = sessione scaduta, non chiamare API
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
async function logout(isSessionExpired = false) {
  console.log('[LOGOUT] Logout chiamato, sessionExpired:', isSessionExpired);
  
  // Ferma auto-refresh per evitare chiamate dopo logout
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
    console.log('[LOGOUT] Auto-refresh fermato');
  }
  
  // RESET flag inizializzazione per permettere re-login
  isAppInitialized = false;
  console.log('[LOGOUT] Flag isAppInitialized resettato');
  
  // Chiama API logout solo se NON è una sessione scaduta (evita 401)
  if (authToken && !isSessionExpired) {
    try {
      await fetch(`${API_URL}/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
    } catch (error) {
      console.error('[LOGOUT] Errore logout API (ignorato):', error);
    }
  }
  
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  
  // Mostra messaggio se sessione scaduta
  if (isSessionExpired) {
    showLogin('⚠️ Sessione scaduta. Effettua nuovamente il login.');
  } else {
    showLogin();
  }
}

// Verifica sessione
async function checkAuth() {
  const savedToken = localStorage.getItem('authToken');
  const savedUser = localStorage.getItem('currentUser');
  
  if (!savedToken || !savedUser) {
    showLogin();
    return false;
  }
  
  // Mostra app SUBITO con credenziali salvate (performance)
  authToken = savedToken;
  currentUser = savedUser;
  showApp();
  await initializeApp();
  
  // Verifica validità token in background (non blocca UI)
  try {
    const response = await fetch(`${API_URL}/me`, {
      headers: { 'Authorization': `Bearer ${savedToken}` }
    });
    
    if (!response.ok) {
      // Token scaduto: logout dopo 2s per permettere chiusura graziosa
      setTimeout(() => {
        logout('Sessione scaduta. Effettua il login.');
      }, 2000);
      return false;
    }
    return true;
  } catch (error) {
    // Errore rete: permetti comunque l'uso (modalità offline)
    console.log('Verifica auth in background fallita, continuo offline');
    return true;
  }
}

// Mostra login
function showLogin(message = null) {
  document.getElementById('page-login').classList.add('active');
  document.getElementById('page-calendar').classList.remove('active');
  document.getElementById('page-orders').classList.remove('active');
  
  // Mostra messaggio di errore se fornito
  const errorEl = document.getElementById('login-error');
  if (message && errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
    
    // Nascondi dopo 5 secondi
    setTimeout(() => {
      errorEl.style.display = 'none';
    }, 5000);
  } else if (errorEl) {
    errorEl.style.display = 'none';
  }
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
  console.log('🎬 setupEventListeners() INIZIATO');
  
  // Notifiche
  console.log('📍 Aggiungo listener notifiche...');
  document.getElementById('btn-notifications').addEventListener('click', async () => {
    await requestNotificationPermission(true); // true = mostra sempre prompt
  });
  document.getElementById('btn-notifications-orders').addEventListener('click', async () => {
    await requestNotificationPermission(true);
  });
  
  // Logout
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-orders').addEventListener('click', logout);
  
  // Barra di ricerca
  let searchDebounceTimer;
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Mostra/nascondi pulsante clear
    if (query.length > 0) {
      btnClearSearch.style.display = 'flex';
    } else {
      btnClearSearch.style.display = 'none';
    }
    
    // Debounce: attendi 300ms dopo l'ultimo input
    clearTimeout(searchDebounceTimer);
    
    if (query.length === 0) {
      // Torna al calendario
      clearSearchResults();
      return;
    }
    
    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 300);
  });
  
  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.style.display = 'none';
    clearSearchResults();
  });
  
  // Navigazione calendario
  document.getElementById('prev-month').addEventListener('click', () => {
    // Crea una nuova data per evitare problemi con setMonth
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    loadCalendar(true);
  });
  
  document.getElementById('next-month').addEventListener('click', () => {
    // Crea una nuova data per evitare problemi con setMonth
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    loadCalendar(true);
  });
  
  // Navigazione pagine
  document.getElementById('btn-back').addEventListener('click', () => {
    showPage('calendar');
  });
  
  document.getElementById('btn-new-order').addEventListener('click', () => {
    openNewOrderModal();
  });
  
  // ========== FAB MENU ESPANDIBILE ==========
  
  const fabContainer = document.querySelector('.fab-container');
  const fabMain = document.getElementById('btn-fab-main');
  const fabMenu = document.getElementById('fab-menu');
  
  // Toggle menu FAB
  fabMain.addEventListener('click', (e) => {
    e.stopPropagation();
    fabContainer.classList.toggle('active');
    
    // Crea/rimuovi backdrop
    if (fabContainer.classList.contains('active')) {
      const backdrop = document.createElement('div');
      backdrop.className = 'fab-backdrop active';
      backdrop.id = 'fab-backdrop';
      backdrop.addEventListener('click', closeFabMenu);
      document.body.appendChild(backdrop);
    } else {
      closeFabMenu();
    }
  });
  
  // Chiudi menu FAB
  function closeFabMenu() {
    fabContainer.classList.remove('active');
    const backdrop = document.getElementById('fab-backdrop');
    if (backdrop) {
      backdrop.classList.remove('active');
      setTimeout(() => backdrop.remove(), 300);
    }
  }
  
  // Nuovo ordine
  document.getElementById('fab-nuovo-ordine').addEventListener('click', () => {
    closeFabMenu();
    openNewOrderModal();
  });
  
  // Ordine fisso (TODO)
  document.getElementById('fab-ordine-fisso').addEventListener('click', () => {
    closeFabMenu();
    alert('🔄 Ordine fisso - In arrivo! Potrai creare ordini ricorrenti per più giorni.');
  });
  
  // Merce in arrivo (TODO)
  document.getElementById('fab-arrivi').addEventListener('click', () => {
    closeFabMenu();
    alert('📦 Merce in arrivo - In arrivo! Calendario degli arrivi di merce.');
  });
  
  // Listini (TODO)
  document.getElementById('fab-listini').addEventListener('click', () => {
    closeFabMenu();
    alert('📋 Listini - In arrivo! Carica PDF o foto dei listini per le festività.');
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
  
  // Listener per stampa fabbisogno
  document.getElementById('btn-print-fabbisogno').addEventListener('click', () => {
    window.print();
  });
  
  // Listener per caricamento range date fabbisogno
  document.getElementById('btn-load-fabbisogno-range').addEventListener('click', () => {
    const dateFrom = document.getElementById('fabbisogno-date-from').value;
    const dateTo = document.getElementById('fabbisogno-date-to').value;
    
    if (!dateFrom || !dateTo) {
      alert('Seleziona entrambe le date');
      return;
    }
    
    if (dateFrom > dateTo) {
      alert('La data di inizio deve essere precedente o uguale alla data di fine');
      return;
    }
    
    // Ricarica con il nuovo range (non serve chiudere)
    openFabbisognoModal(dateFrom, dateTo);
  });
  
  document.getElementById('btn-close-fabbisogno').addEventListener('click', async () => {
    // Se ci sono salvataggi in corso, aspetta che finiscano
    if (pendingSaves > 0) {
      const indicator = document.getElementById('save-indicator');
      if (indicator) {
        indicator.innerHTML = '⏳ Attendi salvataggio...';
        indicator.style.background = '#FF9800';
      }
      
      // Aspetta max 3 secondi per completare i salvataggi
      const maxWait = 30; // 3 secondi (30 * 100ms)
      let waited = 0;
      while (pendingSaves > 0 && waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waited++;
      }
    }
    
    document.getElementById('modal-fabbisogno').classList.remove('active');
    document.body.classList.remove('modal-open');
  });
  
  
  console.log('📍 Arrivo a sezione Modal ordine...');
  
  // Modal ordine
  document.getElementById('btn-close-modal').addEventListener('click', closeOrderModal);
  
  console.log('🔧 Cerco form ordine...');
  const orderForm = document.getElementById('order-form');
  console.log('🔍 Form ordine trovato?', orderForm);
  
  if (orderForm) {
    orderForm.addEventListener('submit', handleOrderSubmit);
    console.log('✅ Listener submit aggiunto a form!');
    console.log('🧪 Verifica: orderForm.onsubmit =', orderForm.onsubmit);
  } else {
    console.error('❌ ERRORE CRITICO: Form ordine NON TROVATO nel DOM!');
  }
  
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

  // Gestione bottoni disponibilità
  document.querySelectorAll('.btn-goods').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const goodsType = e.currentTarget.getAttribute('data-goods');
      setGoodsButtons(goodsType);
    });
  });
  
  // Modal dettaglio ordine
  const modalDetail = document.getElementById('modal-detail');
  document.getElementById('btn-close-detail').addEventListener('click', () => {
    modalDetail.classList.remove('active');
  });
  
  // Click fuori dal modal dettaglio → chiude (solo se non si sta stampando)
  modalDetail.addEventListener('click', (e) => {
    if (isPrinting) return; // Non chiudere durante la stampa
    if (e.target === modalDetail) {
      modalDetail.classList.remove('active');
    }
  });
  
  // Modal condivisione/azioni
  const modalShare = document.getElementById('modal-share');
  document.getElementById('btn-close-share').addEventListener('click', () => {
    modalShare.classList.remove('active');
  });
  
  // Click fuori dal modal condivisione → chiude (solo se non si sta stampando)
  modalShare.addEventListener('click', (e) => {
    if (isPrinting) return; // Non chiudere durante la stampa
    if (e.target === modalShare) {
      modalShare.classList.remove('active');
    }
  });
  
  // Stampa con protezione contro loop
  let isPrinting = false;
  document.getElementById('btn-print-order').addEventListener('click', () => {
    if (isPrinting) return;
    isPrinting = true;
    
    const onAfterPrint = () => {
      isPrinting = false;
      window.removeEventListener('afterprint', onAfterPrint);
      // Chiudi modal dopo stampa
      document.getElementById('modal-detail').classList.remove('active');
      document.getElementById('modal-share').classList.remove('active');
    };
    
    window.addEventListener('afterprint', onAfterPrint);
    
    setTimeout(() => {
      isPrinting = false;
    }, 2000);
    
    // Prepara la stampa: renderizza ordine e apri modal-detail
    if (currentDetailOrder) {
      // Chiudi modal condivisione
      document.getElementById('modal-share').classList.remove('active');
      
      // Renderizza ordine nel modal-detail
      renderOrderDetail(currentDetailOrder);
      
      // Apri modal-detail (necessario per vedere il contenuto)
      document.getElementById('modal-detail').classList.add('active');
      
      // Aspetta che il DOM si aggiorni, poi stampa
      setTimeout(() => {
        window.print();
      }, 200);
    }
  });
  
  document.getElementById('btn-whatsapp-order').addEventListener('click', () => {
    shareOrderWhatsApp(currentDetailOrder);
  });
  
  // Modifica da visualizzazione
  document.getElementById('btn-edit-from-detail').addEventListener('click', () => {
    document.getElementById('modal-detail').classList.remove('active');
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
  
  console.log('🏁 setupEventListeners() COMPLETATO!');
}

// Carica calendario
async function loadCalendar(forceRefresh = false) {
  try {
    const now = Date.now();
    
    // Usa cache se valida e non forceRefresh
    if (!forceRefresh && calendarCache && (now - calendarCacheTime) < CALENDAR_CACHE_TTL) {
      orderStats = calendarCache;
      renderCalendar();
      return;
    }
    
    // Carica statistiche ordini
    const response = await authenticatedFetch(`${API_URL}/stats/dates`);
    const stats = await response.json();
    
    // Crea mappa per accesso veloce e salva in cache
    orderStats = {};
    stats.forEach(stat => {
      orderStats[stat.date] = stat;
    });
    
    calendarCache = orderStats;
    calendarCacheTime = now;
    
    // Genera giorni del mese
    renderCalendar();
  } catch (error) {
    console.error('Errore caricamento calendario:', error);
    // Invalida cache in caso di errore
    calendarCache = null;
    calendarCacheTime = 0;
    
    // Usa cache vecchia se disponibile (ultima resort)
    if (orderStats && Object.keys(orderStats).length > 0) {
      console.log('📦 Usando dati calendario precedenti (modalità offline)');
      renderCalendar();
    } else {
      // Mostra calendario vuoto invece che errore
      orderStats = {};
      renderCalendar();
      // Mostra messaggio temporaneo
      const daysList = document.getElementById('days-list');
      if (daysList) {
        daysList.innerHTML = '<div style="padding: 2rem; text-align: center; color: #999;">⚠️ Errore caricamento calendario. Riprovo automaticamente...</div>';
      }
      // Riprova dopo 2 secondi
      setTimeout(() => loadCalendar(true), 2000);
    }
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
        <div class="day-count">${stat.total} ordin${stat.total === 1 ? 'e' : 'i'}</div>
        <div class="status-indicators">
      `;
      
      if (stat.da_preparare > 0) {
        content += `<span class="status-dot da-preparare" title="Da preparare"></span>`;
      }
      if (stat.pronto > 0) {
        content += `<span class="status-dot pronto" title="Pronto"></span>`;
      }
      
      content += `</div>`;
      
      // Mostra nomi clienti (cliccabili!)
      if (stat.customers && stat.customers.length > 0) {
        content += `<div class="day-customers">`;
        stat.customers.forEach(customer => {
          content += `<span class="customer-name clickable" data-customer="${escapeHtml(customer)}" data-date="${dateStr}">${escapeHtml(customer)}</span>`;
        });
        content += `</div>`;
      }
    } else {
      content += `<span style="color: #bbb;">Nessun ordine</span>`;
    }
    
    content += `</div>`;
    dayCard.innerHTML = content;
    
    // Click sul giorno intero → apre lista ordini
    dayCard.addEventListener('click', (e) => {
      // Se ho cliccato su un nome cliente, non aprire la lista
      if (e.target.classList.contains('customer-name')) {
        return;
      }
      openDayOrders(dateStr);
    });
    
    // Click sui nomi clienti → apre direttamente dettaglio ordine
    dayCard.querySelectorAll('.customer-name.clickable').forEach(nameEl => {
      nameEl.addEventListener('click', async (e) => {
        e.stopPropagation(); // Impedisce apertura lista ordini
        const customer = nameEl.dataset.customer;
        const date = nameEl.dataset.date;
        await openOrderByCustomerAndDate(customer, date);
      });
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

// ==========================================
// RICERCA ORDINI
// ==========================================

let isSearchActive = false;

async function performSearch(query) {
  try {
    console.log('[SEARCH] Inizio ricerca per:', query);
    isSearchActive = true;
    
    const url = `${API_URL}/orders/search?q=${encodeURIComponent(query)}`;
    console.log('[SEARCH] URL:', url);
    
    const response = await authenticatedFetch(url);
    console.log('[SEARCH] Response status:', response.status);
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[SEARCH] Errore dal server:', errorData);
      throw new Error(errorData.details || errorData.error || 'Errore sconosciuto');
    }
    
    const orders = await response.json();
    console.log('[SEARCH] Ordini ricevuti:', orders.length);
    
    renderSearchResults(query, orders);
  } catch (error) {
    console.error('[SEARCH] Errore ricerca:', error);
    console.error('[SEARCH] Error stack:', error.stack);
    alert(`Errore durante la ricerca: ${error.message}`);
    clearSearchResults();
  }
}

function renderSearchResults(query, orders) {
  const monthSelector = document.querySelector('.month-selector');
  const daysList = document.getElementById('days-list');
  
  // Nascondi selettore mese
  monthSelector.style.display = 'none';
  
  // Crea/aggiorna container risultati
  let searchResultsContainer = document.getElementById('search-results-container');
  
  if (!searchResultsContainer) {
    searchResultsContainer = document.createElement('div');
    searchResultsContainer.id = 'search-results-container';
    searchResultsContainer.className = 'search-results';
    daysList.parentElement.insertBefore(searchResultsContainer, daysList);
  }
  
  // Nascondi lista giorni calendario
  daysList.style.display = 'none';
  
  // Renderizza risultati
  if (orders.length === 0) {
    searchResultsContainer.innerHTML = `
      <div class="search-no-results">
        <div class="search-no-results-icon">🔍</div>
        <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">
          Nessun risultato
        </div>
        <div style="font-size: 0.875rem;">
          Nessun ordine trovato per "<strong>${escapeHtml(query)}</strong>"<br>
          (ricerca negli ordini da 1 settimana fa a 3 settimane avanti)
        </div>
      </div>
    `;
    return;
  }
  
  // Header risultati
  let html = `
    <div class="search-results-header">
      <div class="search-results-title">🔍 Risultati ricerca</div>
      <div class="search-results-count">${orders.length} ordin${orders.length === 1 ? 'e' : 'i'} trovat${orders.length === 1 ? 'o' : 'i'}</div>
    </div>
    <div class="search-results-list">
  `;
  
  // Renderizza ogni ordine (stesso stile delle order cards)
  orders.forEach(order => {
    const statusLabels = {
      'da_preparare': 'Da preparare',
      'pronto': 'Pronto',
      'ritirato': 'Ritirato'
    };
    
    const deliveryTypeLabels = {
      'ritiro': '📦 Ritiro',
      'consegna': '🚚 Consegna'
    };
    
    const goodsTypeLabels = {
      'in_cella': '✅ Pronto',
      'da_ordinare': '📝 Da ordinare',
      'ordinata': '📦 Ordinata'
    };
    
    // Formatta data
    const dateObj = new Date(order.date + 'T00:00:00');
    const dateFormatted = dateObj.toLocaleDateString('it-IT', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
    
    let infoBadges = '';
    if (order.goods_type) {
      const goodsClass = order.goods_type === 'da_ordinare' ? 'da_ordinare' : '';
      infoBadges += `<span class="info-badge ${goodsClass}">${goodsTypeLabels[order.goods_type]}</span>`;
    }
    if (order.delivery_type) {
      const deliveryClass = order.delivery_type === 'consegna' ? 'consegna' : '';
      infoBadges += `<span class="info-badge ${deliveryClass}">${deliveryTypeLabels[order.delivery_type]}</span>`;
    }
    if (order.delivery_time) {
      infoBadges += `<span class="info-badge">${order.delivery_time}</span>`;
    }
    
    html += `
      <div class="order-card" data-order-id="${order.id}">
        <div class="order-content">
          <div class="order-header">
            <div class="order-customer">${escapeHtml(order.customer)}</div>
            <span class="order-status-badge ${order.status}">${statusLabels[order.status]}</span>
          </div>
          
          <div class="order-description">${escapeHtml(order.description)}</div>
          
          <div class="order-footer">
            <div class="order-date">📅 ${dateFormatted}</div>
            ${infoBadges ? `<div class="order-info-badges">${infoBadges}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  html += `</div>`;
  searchResultsContainer.innerHTML = html;
  
  // Aggiungi click handlers
  searchResultsContainer.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => {
      const orderId = parseInt(card.dataset.orderId);
      const order = orders.find(o => o.id === orderId);
      if (order) {
        openOrderDetail(order);
      }
    });
  });
}

function clearSearchResults() {
  isSearchActive = false;
  
  const monthSelector = document.querySelector('.month-selector');
  const daysList = document.getElementById('days-list');
  const searchResultsContainer = document.getElementById('search-results-container');
  
  // Mostra calendario
  monthSelector.style.display = 'flex';
  daysList.style.display = 'flex';
  
  // Rimuovi risultati
  if (searchResultsContainer) {
    searchResultsContainer.remove();
  }
}

// Apri ordine di un cliente specifico in una data (dal calendario)
async function openOrderByCustomerAndDate(customer, date) {
  try {
    console.log(`[QUICK-OPEN] Apertura ordine: ${customer} - ${date}`);
    
    // Carica ordini del giorno
    const response = await authenticatedFetch(`${API_URL}/orders/date/${date}`);
    const orders = await response.json();
    
    // Trova ordine del cliente (case-insensitive)
    const order = orders.find(o => o.customer.toLowerCase() === customer.toLowerCase());
    
    if (order) {
      console.log(`[QUICK-OPEN] Ordine trovato:`, order.id);
      openOrderDetail(order);
    } else {
      console.warn(`[QUICK-OPEN] Ordine non trovato per ${customer}`);
      alert(`Ordine di ${customer} non trovato per questa data`);
    }
  } catch (error) {
    console.error('[QUICK-OPEN] Errore:', error);
    alert('Errore nell\'apertura dell\'ordine');
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
    console.log('📥 Carico ordini per data:', date);
    
    // DISABILITA CACHE - Forza fetch dal server!
    const response = await authenticatedFetch(`${API_URL}/orders/date/${date}`, {
      cache: 'no-store',  // ← NON usare cache!
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    console.log('🔍 Response status:', response.status);
    console.log('🔍 Response headers:', Object.fromEntries(response.headers.entries()));
    
    // Clona response per poter leggere body due volte
    const responseClone = response.clone();
    const rawText = await responseClone.text();
    console.log('🔍 RAW response body:', rawText);
    
    const orders = await response.json();
    console.log('✅ Ricevuti', orders.length, 'ordini dalla risposta server');
    console.log('✅ Array orders:', orders);
    
    // Log dettagliato di OGNI ordine
    orders.forEach((order, index) => {
      console.log(`  [${index}] ID: ${order.id}, Cliente: ${order.customer}, Data: ${order.date}, Status: ${order.status}, Goods: ${order.goods_type}`);
    });
    
    renderOrders(orders);
  } catch (error) {
    console.error('❌ Errore caricamento ordini:', error);
    alert('Errore nel caricamento degli ordini: ' + error.message);
  }
}

// Renderizza lista ordini
function renderOrders(orders) {
  console.log('🎨 renderOrders() chiamato con', orders.length, 'ordini');
  console.log('🎨 ordersList element:', ordersList);
  console.log('🎨 Prima di pulire, ordersList.children.length:', ordersList.children.length);
  
  ordersList.innerHTML = '';
  console.log('🎨 Dopo pulizia, ordersList.children.length:', ordersList.children.length);
  
  if (orders.length === 0) {
    console.log('⚠️ Nessun ordine da renderizzare, mostro empty message');
    emptyMessage.style.display = 'block';
    return;
  }
  
  console.log('✅ Rendering', orders.length, 'ordini...');
  emptyMessage.style.display = 'none';
  
  orders.forEach((order, index) => {
    console.log(`  🎨 Rendering ordine [${index}]:`, order.id, order.customer);
    const orderCard = document.createElement('div');
    orderCard.className = `order-card status-${order.status}`;
    
    const statusLabels = {
      'da_preparare': 'Da preparare',
      'pronto': 'Pronto',
      'ritirato': 'Ritirato'
    };
    
    const orderTypeLabels = {
      'cliente': 'Cliente',
      'whatsapp': 'WhatsApp',
      'mail': 'Email',
      'telefono': 'Telefono'
    };
    
    const deliveryTypeLabels = {
      'ritiro': 'Ritiro',
      'consegna': 'Consegna'
    };
    
    const goodsTypeLabels = {
      'in_cella': 'Pronto',
      'da_ordinare': 'Da ordinare',
      'ordinata': 'Ordinata'
    };
    
    // Mostra disponibilità: se ordine è pronto/ritirato, mostra solo quello
    let infoBadges = '';
    if (order.status === 'pronto' || order.status === 'ritirato') {
      // Ordine già pronto o ritirato → mostra solo questo
      infoBadges += `<span class="info-badge status-${order.status}">${statusLabels[order.status]}</span>`;
    } else if (order.goods_type) {
      // Ordine da preparare → mostra stato merce
      const goodsClass = order.goods_type === 'da_ordinare' ? 'da_ordinare' : 
                         order.goods_type === 'ordinata' ? 'ordinata' : '';
      infoBadges += `<span class="info-badge ${goodsClass}">${goodsTypeLabels[order.goods_type] || order.goods_type}</span>`;
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
    
    // Indicatori operativi compatti
    let indicators = '';
    if (order.photos && order.photos.length > 0) {
      indicators += `<span class="order-indicator" title="Ha foto">📷</span>`;
    }
    if (order.delivery_type === 'consegna' && order.delivery_address) {
      indicators += `<span class="order-indicator" title="Ha indirizzo">📍</span>`;
    }
    if (order.description && order.description.length > 50) {
      indicators += `<span class="order-indicator" title="Descrizione lunga">📝</span>`;
    }
    // Indicatore dati incompleti
    if (order.delivery_type === 'consegna' && !order.delivery_address) {
      indicators += `<span class="order-indicator warning" title="Consegna senza indirizzo!">⚠️</span>`;
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
          <div class="order-customer">
            ${escapeHtml(order.customer)}
            ${indicators ? `<span class="order-indicators">${indicators}</span>` : ''}
          </div>
          <span class="order-status-badge ${order.status}">${statusLabels[order.status]}</span>
        </div>
        ${infoBadges ? `<div class="order-info">${infoBadges}</div>` : ''}
        <div class="order-description">${escapeHtml(order.description)}</div>
        ${photosHtml}
        ${userInfoHtml}
      </div>
      <div class="order-actions">
        <button class="btn-small btn-share" data-id="${order.id}">Condividi</button>
        ${order.status === 'da_preparare' ? 
          `<button class="btn-small btn-ready" data-id="${order.id}">✓ Pronto</button>` : ''}
        ${order.status === 'pronto' ? 
          `<button class="btn-small btn-collected" data-id="${order.id}">✓ Ritirato</button>` : ''}
        ${order.status === 'ritirato' ? 
          `<button class="btn-small btn-undo-collected" data-id="${order.id}">↶ Annulla ritiro</button>` : ''}
      </div>
    `;
    
    // Click sulla card (esclusi i pulsanti) apre VISUALIZZAZIONE (solo lettura + cambio stato)
    const orderContent = orderCard.querySelector('.order-content');
    orderContent.addEventListener('click', () => {
      openOrderDetail(order);
    });
    
    // Event listeners pulsanti
    orderCard.querySelector('.btn-share').addEventListener('click', (e) => {
      e.stopPropagation();
      openShareModal(order);
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
    
    const btnUndoCollected = orderCard.querySelector('.btn-undo-collected');
    if (btnUndoCollected) {
      btnUndoCollected.addEventListener('click', (e) => {
        e.stopPropagation();
        updateOrderStatus(order.id, 'pronto');
      });
    }
    
    ordersList.appendChild(orderCard);
    console.log(`  ✅ Ordine ${order.id} aggiunto al DOM`);
  });
  
  console.log('🎨 FINE renderOrders - ordersList.children.length:', ordersList.children.length);
  console.log('🎨 ordersList visibile?', ordersList.style.display, 'offsetHeight:', ordersList.offsetHeight);
}


// Aggiorna UI disponibilità merce
function setGoodsButtons(value) {
  // MANTIENI il valore originale invece di normalizzare tutto a in_cella
  const normalized = value || 'in_cella';
  const input = document.getElementById('goods-type');
  if (input) input.value = normalized;
  
  // Attiva il pulsante corrispondente
  // Se il valore è 'ordinata' o altro, seleziona 'in_cella' come fallback visivo
  const displayValue = (normalized === 'da_ordinare' || normalized === 'ordinata') ? normalized : 'in_cella';
  
  document.querySelectorAll('.btn-goods').forEach(btn => {
    const btnValue = btn.getAttribute('data-goods');
    // Se l'ordine è "ordinata", mostra come "in_cella" (ma mantieni il valore reale)
    const isActive = btnValue === displayValue || (normalized === 'ordinata' && btnValue === 'in_cella');
    btn.classList.toggle('active', isActive);
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
  currentEditOrder = null;
  uploadedPhotos = [];
  
  document.getElementById('modal-title').textContent = 'Nuovo ordine';
  document.getElementById('order-form').reset();
  document.getElementById('order-id').value = '';
  document.getElementById('order-date').value = currentDate;
  document.getElementById('order-status').value = 'da_preparare';
  document.getElementById('order-type').value = 'cliente';
  document.getElementById('delivery-type').value = 'ritiro';
  document.getElementById('delivery-time').value = '';
  document.getElementById('delivery-address').value = '';
  
  setGoodsButtons('in_cella');
  document.getElementById('status-group').style.display = 'none';
  document.getElementById('btn-delete-order').style.display = 'none';
  
  renderPhotoPreview();
  modalOrder.classList.add('active');
}

// Apri modal modifica ordine
function openEditOrderModal(order) {
  currentOrderId = order.id;
  currentEditOrder = order;
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
  
  setGoodsButtons(order.goods_type || 'in_cella');
  // NASCONDO gruppo stato (lo stato si cambia solo dalla visualizzazione)
  document.getElementById('status-group').style.display = 'none';
  
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
  console.log('🔥 handleOrderSubmit CHIAMATO!', e);
  e.preventDefault();
  
  const orderId = document.getElementById('order-id').value;
  console.log('📝 orderId:', orderId);
  const date = document.getElementById('order-date').value;
  const customer = document.getElementById('order-customer').value.trim();
  const description = document.getElementById('order-description').value.trim();
  let status = document.getElementById('order-status').value;
  const orderType = document.getElementById('order-type').value;
  const goodsType = document.getElementById('goods-type').value;
  const deliveryType = document.getElementById('delivery-type').value;
  const deliveryTime = document.getElementById('delivery-time').value;
  const deliveryAddress = document.getElementById('delivery-address').value.trim();

  // Se la merce è pronta, lo stato ordine diventa "pronto" (tranne se già ritirato)
  if (!currentEditOrder || currentEditOrder.status !== 'ritirato') {
    status = goodsType === 'da_ordinare' ? 'da_preparare' : 'pronto';
    document.getElementById('order-status').value = status;
  }
  
  // Solo cliente, merce e giorno sono obbligatori
  if (!customer || !description) {
    alert('Compila i campi obbligatori: Cliente e Merce');
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
  
  // ✨ OPTIMISTIC UI UPDATE ✨
  // Chiudi modal IMMEDIATAMENTE (non aspettare il server!)
  closeOrderModal();
  const photosBackup = uploadedPhotos;
  uploadedPhotos = [];
  
  // Invalida cache
  calendarCache = null;
  calendarCacheTime = 0;
  
  // Salva sul server E ricarica sempre (no ottimizzazioni!)
  try {
    let savedOrder;
    
    if (orderId) {
      // Aggiorna ordine esistente
      const response = await authenticatedFetch(`${API_URL}/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, date })
      });
      savedOrder = await response.json();
    } else {
      // Crea nuovo ordine
      const response = await authenticatedFetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, date })
      });
      savedOrder = await response.json();
    }
    
    console.log('✅ Ordine salvato:', savedOrder);
    
    // IMPORTANTE: Switcha alla data dell'ordine salvato
    currentDate = date;
    
    // Ricarica SEMPRE tutto (no cache, no ottimizzazioni)
    console.log('🔄 Ricarico ordini per data:', date);
    await loadOrders(date);
    
    console.log('🔄 Ricarico calendario...');
    await loadCalendar(true);
    
    console.log('✅ Tutto ricaricato!');
  } catch (error) {
    console.error('❌ Errore salvataggio ordine:', error);
    alert('Errore nel salvataggio dell\'ordine: ' + error.message);
  }
}

// Aggiorna solo stato ordine
async function updateOrderStatus(orderId, status) {
  // Invalida cache
  calendarCache = null;
  calendarCacheTime = 0;
  
  try {
    console.log('🔄 Aggiorno stato ordine', orderId, 'a', status);
    
    // Aggiorna sul server
    await authenticatedFetch(`${API_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    
    console.log('✅ Stato aggiornato, ricarico UI...');
    
    // Ricarica UI
    await loadOrders(currentDate);
    await loadCalendar(true);
    
    console.log('✅ UI ricaricata!');
  } catch (error) {
    console.error('❌ Errore aggiornamento stato:', error);
    alert('Errore nell\'aggiornamento dello stato: ' + error.message);
  }
}

// Elimina ordine
async function handleOrderDelete() {
  if (!currentOrderId) return;
  
  // ✨ OPTIMISTIC UI UPDATE ✨
  // Chiudi modal IMMEDIATAMENTE
  modalConfirm.classList.remove('active');
  
  // Invalida cache
  calendarCache = null;
  calendarCacheTime = 0;
  
  // Elimina sul server, POI ricarica UI
  // (garantisce consistenza dati)
  try {
    console.log('🗑️ Elimino ordine', currentOrderId);
    
    await authenticatedFetch(`${API_URL}/orders/${currentOrderId}`, {
      method: 'DELETE'
    });
    
    console.log('✅ Ordine eliminato, ricarico UI...');
    
    // Ricarica UI
    await loadOrders(currentDate);
    await loadCalendar(true);
    
    console.log('✅ UI ricaricata!');
  } catch (error) {
    console.error('❌ Errore eliminazione ordine:', error);
    alert('Errore nell\'eliminazione dell\'ordine: ' + error.message);
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

// Formatta data in formato italiano (es. "Giovedì 16 Gennaio 2026")
function formatDateItalian(dateString) {
  const [year, month, day] = dateString.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const formatted = date.toLocaleDateString('it-IT', options);
  // Capitalize first letter
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Utility: escape HTML
function escapeHtml(text) {
  if (!text) return '';
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
    
    if (!response.ok) {
      let message = '';
      try {
        const err = await response.json();
        message = err.error || JSON.stringify(err);
      } catch {
        try {
          message = await response.text();
        } catch {
          message = '';
        }
      }
      throw new Error(`Errore upload (${response.status})${message ? `: ${message}` : ''}`);
    }
    
    const data = await response.json();
    if (!data.photos || !Array.isArray(data.photos)) {
      throw new Error('Risposta upload non valida');
    }
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

// DEBUG: Test visibilità in stampa
window.testPrintVisibility = function() {
  console.log('\n🖨️ TEST VISIBILITÀ IN STAMPA:');
  document.querySelectorAll('.fabbisogno-item').forEach(el => {
    const style = getComputedStyle(el);
    console.log(`Ordine #${el.dataset.orderId} - ${el.dataset.customer}`);
    console.log(`  Display: ${style.display}`);
    console.log(`  Visibility: ${style.visibility}`);
    console.log(`  Opacity: ${style.opacity}`);
    console.log(`  Width: ${style.width}`);
    console.log(`  Height: ${style.height}`);
    console.log(`  Position: ${style.position}`);
    console.log('');
  });
};

// Apri modal fabbisogno
async function openFabbisognoModal(date, dateTo = null) {
  try {
    // Usa la data passata o quella corrente
    const dateFrom = date || currentDate;
    if (!dateFrom) {
      alert('Seleziona prima un giorno dal calendario');
      return;
    }
    
    // Se dateTo non è specificato, usa dateFrom (singolo giorno)
    const dateToUse = dateTo || dateFrom;
    
    // Popola gli input del selettore date
    document.getElementById('fabbisogno-date-from').value = dateFrom;
    document.getElementById('fabbisogno-date-to').value = dateToUse;
    
    // Salva le date per i reload
    currentFabbisognoDate = dateFrom;
    currentFabbisognoDateTo = dateToUse;
    
    let allOrders;
    if (dateFrom === dateToUse) {
      // Singolo giorno
      const response = await authenticatedFetch(`${API_URL}/orders/date/${dateFrom}`);
      allOrders = await response.json();
    } else {
      // Range di date
      const response = await authenticatedFetch(`${API_URL}/orders/date-range?from=${dateFrom}&to=${dateToUse}`);
      allOrders = await response.json();
    }
    
    // Filtra solo ordini con merce DA ORDINARE (NON 'ordinata' o 'in_cella')
    const ordersToOrder = allOrders.filter(order => 
      order.goods_type === 'da_ordinare'
    );
    
    console.log('🔍 DEBUG FABBISOGNO:');
    console.log(`📦 Totale ordini: ${allOrders.length}`);
    console.log(`✅ Ordini DA ORDINARE: ${ordersToOrder.length} (goods_type === 'da_ordinare')`);
    
    // Debug: mostra TUTTI gli ordini con i loro goods_type
    console.log('\n📊 TUTTI gli ordini per goods_type:');
    allOrders.forEach(order => {
      const icon = order.goods_type === 'da_ordinare' ? '✅' : '❌';
      console.log(`  ${icon} #${order.id} ${order.customer} - goods_type: "${order.goods_type}" - ${order.photos ? order.photos.length : 0} foto`);
    });
    
    console.log('\n🟢 Ordini NEL fabbisogno:');
    ordersToOrder.forEach(order => {
      console.log(`  - #${order.id} ${order.customer} - ${order.photos ? order.photos.length : 0} foto`);
    });
    
    renderFabbisogno(ordersToOrder, allOrders.length, dateFrom, dateToUse);
    document.getElementById('modal-fabbisogno').classList.add('active');
    
    // Blocca scroll body
    document.body.classList.add('modal-open');
  } catch (error) {
    console.error('Errore caricamento fabbisogno:', error);
    alert('Errore nel caricamento del fabbisogno');
  }
}

// Renderizza fabbisogno (con raggruppamento per giorno)
function renderFabbisogno(orders, totalOrders = 0, dateFrom, dateTo) {
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
      emptyP.textContent = '📭 Nessun ordine per questo periodo';
      emptySubtitle.textContent = '';
    } else {
      emptyP.textContent = '✅ Nessuna merce da ordinare';
      emptySubtitle.textContent = 'Tutta la merce è già disponibile o ordinata';
    }
    return;
  }
  
  fabbisognoEmpty.style.display = 'none';
  fabbisognoList.style.display = 'flex';
  
  // Aggiorna titolo con conteggio
  const title = document.getElementById('fabbisogno-title');
  const isMultiDay = dateFrom !== dateTo;
  if (isMultiDay) {
    const fromFormatted = formatDateItalian(dateFrom);
    const toFormatted = formatDateItalian(dateTo);
    title.innerHTML = `Fabbisogno ${fromFormatted} - ${toFormatted} <span style="color: var(--color-primary); font-weight: 700;">(${orders.length} ${orders.length === 1 ? 'ordine' : 'ordini'})</span>`;
  } else {
    title.innerHTML = `Merce da ordinare <span style="color: var(--color-primary); font-weight: 700;">(${orders.length} ${orders.length === 1 ? 'ordine' : 'ordini'})</span>`;
  }
  
  // Raggruppa ordini per data
  const ordersByDate = {};
  orders.forEach(order => {
    if (!ordersByDate[order.date]) {
      ordersByDate[order.date] = [];
    }
    ordersByDate[order.date].push(order);
  });
  
  // Ordina le date
  const sortedDates = Object.keys(ordersByDate).sort();
  
  // Per ogni giorno
  sortedDates.forEach(date => {
    const dayOrders = ordersByDate[date];
    
    // Crea header del giorno (solo se multi-day)
    if (isMultiDay) {
      const dayHeader = document.createElement('div');
      dayHeader.className = 'fabbisogno-day-header';
      dayHeader.innerHTML = `
        <span class="day-icon">📅</span>
        <span>${formatDateItalian(date)}</span>
        <span class="day-count">${dayOrders.length} ${dayOrders.length === 1 ? 'ordine' : 'ordini'}</span>
      `;
      fabbisognoList.appendChild(dayHeader);
    }
    
    // Ordina ordini per cliente (alfabetico)
    const sortedOrders = [...dayOrders].sort((a, b) => 
      a.customer.localeCompare(b.customer)
    );
    
    sortedOrders.forEach(order => {
    console.log(`📦 Rendering ordine #${order.id} - ${order.customer} - ${order.photos ? order.photos.length : 0} foto`);
    
    // DEBUG SPECIALE PER ORDINE CON FOTO
    if (order.photos && order.photos.length > 0) {
      console.log(`🖼️ ORDINE CON FOTO TROVATO:`);
      console.log(`  ID: ${order.id}`);
      console.log(`  Cliente: ${order.customer}`);
      console.log(`  goods_type: ${order.goods_type}`);
      console.log(`  status: ${order.status}`);
      console.log(`  delivery_type: ${order.delivery_type}`);
      console.log(`  order_type: ${order.order_type}`);
      console.log(`  Foto: ${order.photos.length}`);
      console.log(`  Tutte le proprietà:`, Object.keys(order));
    }
    
    const item = document.createElement('div');
    const goodsType = order.goods_type || 'in_cella';
    const status = order.status || 'da_preparare';
    
    // Converti underscore in trattini per CSS
    const goodsTypeClass = goodsType.replace(/_/g, '-');
    
    // Classe per tipo merce E stato
    item.className = `fabbisogno-item ${goodsTypeClass} status-${status}`;
    
    // Debug: aggiungi attributo data per identificare ordine
    item.setAttribute('data-order-id', order.id);
    item.setAttribute('data-customer', order.customer);
    item.setAttribute('data-has-photos', order.photos && order.photos.length > 0 ? 'true' : 'false');
    
    // DEBUG: Log classe completa per ordini con foto
    if (order.photos && order.photos.length > 0) {
      console.log(`  ✅ Classe CSS assegnata: "${item.className}"`);
      console.log(`  ✅ Attributi data:`, item.dataset);
    }
    
    // Info essenziali
    let metaInfo = `<span class="info-badge">${order.customer}</span>`;
    if (order.delivery_type === 'consegna') {
      metaInfo += `<span class="info-badge consegna">🚚 Consegna</span>`;
      if (order.delivery_time) {
        metaInfo += `<span class="info-badge">${order.delivery_time}</span>`;
      }
    }
    
    // Pulsante per segnare come ordinata (solo per Carlo e Dimitri)
    let goodsButtons = '';
    if (currentUser && (currentUser === 'Carlo' || currentUser === 'Dimitri')) {
      goodsButtons = `<button class="btn-goods-action btn-mark-ordered" onclick="markAsOrdered(${order.id})">✅ Segna come ordinata</button>`;
    }
    
    // Dividi descrizione in righe e aggiungi checkbox
    const lines = order.description.split('\n').filter(line => line.trim());
    let descriptionHtml = '<div class="fabbisogno-lines">';
    lines.forEach((line, index) => {
      descriptionHtml += `
        <div class="fabbisogno-line">
          <input 
            type="checkbox" 
            class="fabbisogno-checkbox" 
            data-order-id="${order.id}" 
            data-line-number="${index}"
            id="check-${order.id}-${index}">
          <label for="check-${order.id}-${index}" class="fabbisogno-line-text">${escapeHtml(line.trim())}</label>
        </div>
      `;
    });
    descriptionHtml += '</div>';
    
    item.innerHTML = `
      <div class="fabbisogno-header">
        <div class="fabbisogno-customer">
          ${escapeHtml(order.customer)}
        </div>
      </div>
      ${descriptionHtml}
      ${metaInfo ? `<div class="fabbisogno-meta">${metaInfo}</div>` : ''}
      ${goodsButtons ? `<div class="fabbisogno-actions">${goodsButtons}</div>` : ''}
    `;
    
      fabbisognoList.appendChild(item);
      console.log(`✅ Ordine #${order.id} aggiunto al DOM`);
    });
  });
  
  console.log(`🎯 Totale elementi nel fabbisogno-list: ${fabbisognoList.children.length}`);
  console.log('📋 Elementi:', Array.from(fabbisognoList.children).map(el => {
    return `${el.className} ${el.dataset.orderId ? `(#${el.dataset.orderId})` : ''}`;
  }));
  
  // DOPO aver creato tutto il DOM, carica stati e aggiungi listener
  // Raccogli tutti gli order ID da tutti i giorni
  const allOrderIds = orders.map(order => order.id);
  
  // (usa Promise.all per parallelizzare)
  Promise.all(
    allOrderIds.map(orderId => loadFabbisognoChecks(orderId))
  ).catch(err => console.error('Errore caricamento checks:', err));
}

// Carica stato checkbox fabbisogno per un ordine
async function loadFabbisognoChecks(orderId) {
  try {
    // ⚠️ IMPORTANTE: Se ci sono salvataggi in corso, ASPETTA che finiscano
    // In questo modo il DB è sempre aggiornato prima di caricare
    await waitForPendingSaves(5000);
    
    console.log('🔵 LOAD CHECKS per orderId:', orderId);
    const response = await authenticatedFetch(`${API_URL}/fabbisogno-checks/${orderId}`);
    const checks = await response.json();
    console.log('🟢 CHECKS RICEVUTE:', checks);
    
    // Per ogni checkbox dell'ordine
    const checkboxes = document.querySelectorAll(`.fabbisogno-checkbox[data-order-id="${orderId}"]`);
    console.log('🔵 TROVATE', checkboxes.length, 'CHECKBOX per ordine', orderId);
    
    checkboxes.forEach(checkbox => {
      const lineNum = parseInt(checkbox.dataset.lineNumber);
      console.log('  - Checkbox lineNum:', lineNum, 'valore DB:', checks[lineNum]);
      
      // Imposta stato checked dal DB
      if (checks[lineNum] !== undefined) {
        checkbox.checked = checks[lineNum];
        console.log('  ✅ Impostata a:', checks[lineNum]);
      }
      
      // Aggiungi listener SOLO se non esiste già
      if (!checkbox._hasListener) {
        checkbox._hasListener = true;
        checkbox.addEventListener('change', async () => {
          console.log('📍 CHANGE EVENT: orderId=', orderId, 'lineNum=', lineNum);
          await toggleFabbisognoCheck(orderId, lineNum);
        });
      }
    });
  } catch (error) {
    console.error('❌ ERRORE CARICAMENTO CHECKS:', error);
  }
}

// Counter salvataggi pending
let pendingSaves = 0;

// Attende che tutti i salvataggi pending finiscano
async function waitForPendingSaves(maxWaitMs = 5000) {
  if (pendingSaves === 0) return;
  
  console.log('⏳ Aspetto', pendingSaves, 'salvataggi pending...');
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (pendingSaves === 0) {
        clearInterval(checkInterval);
        console.log('✅ Tutti i salvataggi completati');
        resolve();
      } else if (Date.now() - startTime > maxWaitMs) {
        clearInterval(checkInterval);
        console.warn('⚠️ Timeout attesa salvataggi (ancora pending:', pendingSaves, ')');
        resolve();
      }
    }, 50);
  });
}

// Toggle checkbox fabbisogno con salvataggio garantito
async function toggleFabbisognoCheck(orderId, lineNumber) {
  // Incrementa counter salvataggi pending
  pendingSaves++;
  updateSaveIndicator();
  
  // Leggi lo stato attuale della checkbox (quello che l'utente vuole)
  const checkbox = document.getElementById(`check-${orderId}-${lineNumber}`);
  const desiredState = checkbox ? checkbox.checked : true;
  
  console.log('🔵 SET CHECK: orderId=', orderId, 'lineNumber=', lineNumber, 'desiredState=', desiredState);
  
  try {
    const url = `${API_URL}/fabbisogno-checks/${orderId}/${lineNumber}`;
    console.log('🔵 POST URL:', url, 'body:', { checked: desiredState });
    
    const response = await authenticatedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: desiredState })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('🟢 RISPOSTA SERVER:', data);
    
    // Aggiorna checkbox con il valore dal server (fonte di verità)
    const checkbox = document.getElementById(`check-${orderId}-${lineNumber}`);
    if (checkbox) {
      checkbox.checked = data.checked;
      console.log('🟢 CHECKBOX AGGIORNATA:', data.checked);
    } else {
      console.error('❌ CHECKBOX NON TROVATA: check-' + orderId + '-' + lineNumber);
    }
  } catch (error) {
    console.error('❌ ERRORE SALVATAGGIO:', error);
    // Ripristina stato precedente in caso di errore
    const checkbox = document.getElementById(`check-${orderId}-${lineNumber}`);
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
    }
  } finally {
    // Decrementa counter salvataggi pending
    pendingSaves--;
    updateSaveIndicator();
  }
}

// Mostra/nascondi indicatore salvataggio
function updateSaveIndicator() {
  let indicator = document.getElementById('save-indicator');
  
  if (pendingSaves > 0) {
    if (!indicator) {
      // Crea indicatore se non esiste
      indicator = document.createElement('div');
      indicator.id = 'save-indicator';
      indicator.innerHTML = '💾 Salvataggio...';
      indicator.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-primary);
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 20px;
        font-size: 0.9rem;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: fadeIn 0.2s;
      `;
      document.body.appendChild(indicator);
    }
  } else {
    // Rimuovi indicatore quando tutti i salvataggi sono completati
    if (indicator) {
      indicator.style.animation = 'fadeOut 0.2s';
      setTimeout(() => indicator.remove(), 200);
    }
  }
}

// Funzione per segnare merce come ordinata (Carlo/Dimitri)
async function markAsOrdered(orderId) {
  if (!confirm('Segnare questa merce come ordinata?')) return;
  
  // Feedback visivo IMMEDIATO
  const button = event.target.closest('.btn-goods-action');
  if (button) {
    button.disabled = true;
    button.innerHTML = '⏳ Salvataggio...';
  }
  
  // Rimuovi l'ordine dal DOM con animazione
  const orderCard = button ? button.closest('.fabbisogno-order-item') : null;
  if (orderCard) {
    orderCard.style.transition = 'opacity 0.3s, transform 0.3s';
    orderCard.style.opacity = '0';
    orderCard.style.transform = 'translateX(-20px)';
  }
  
  // Invalida cache
  calendarCache = null;
  calendarCacheTime = 0;
  
  try {
    console.log('📦 Segno come ordinata:', orderId);
    
    // Salva sul server
    await authenticatedFetch(`${API_URL}/orders/${orderId}/goods-type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goods_type: 'ordinata' })
    });
    
    console.log('✅ Ordinata segnata, ricarico UI...');
    
    // Ricarica UI
    await loadCalendar(true);
    if (currentDate) {
      await loadOrders(currentDate);
    }
    
    // Ricarica fabbisogno per aggiornare la lista
    if (currentFabbisognoDate) {
      await openFabbisognoModal(currentFabbisognoDate, currentFabbisognoDateTo);
    }
    
    console.log('✅ UI ricaricata!');
  } catch (error) {
    console.error('❌ Errore aggiornamento:', error);
    alert('Errore nell\'aggiornamento: ' + error.message);
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

// Apri modal condivisione/azioni
function openShareModal(order) {
  currentDetailOrder = order;
  currentOrderId = order.id;
  
  // Formatta data
  const dateObj = new Date(order.date + 'T00:00:00');
  const dateFormatted = dateObj.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  
  // Popola modal
  document.getElementById('share-customer-name').textContent = order.customer;
  document.getElementById('share-order-date').textContent = dateFormatted;
  document.getElementById('share-header-title').textContent = 'Azioni Ordine';
  
  // Mostra modal
  document.getElementById('modal-share').classList.add('active');
}

// Renderizza dettaglio ordine
function renderOrderDetail(order) {
  const statusLabels = {
    'da_preparare': 'Da preparare',
    'pronto': 'Pronto',
    'ritirato': 'Ritirato'
  };
  
  const orderTypeLabels = {
    'cliente': 'Cliente',
    'whatsapp': 'WhatsApp',
    'mail': 'Email',
    'telefono': 'Telefono'
  };
  
  const deliveryTypeLabels = {
    'ritiro': 'Ritiro',
    'consegna': 'Consegna'
  };
  
  const goodsTypeLabels = {
    'in_cella': 'Pronto',
    'da_ordinare': 'Da ordinare',
    'ordinata': 'Ordinata'
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
  const deliveryText = order.delivery_type === 'consegna' ? 'CONSEGNA' : 'RITIRO';
  const deliveryTime = order.delivery_time ? ` - Ore ${order.delivery_time}` : '';
  
  // Layout ottimizzato per stampa su una pagina
  let html = `
    <!-- HEADER STAMPA (solo in stampa) -->
    <div class="print-header-stack">
      <div class="print-stack-content">
        <div class="print-stack-customer">
          ${escapeHtml(order.customer)}
        </div>
        <div class="print-stack-date">
          ${dateFormatted}
        </div>
        <div class="print-stack-delivery ${order.delivery_type}">
          ${deliveryText}${deliveryTime}
        </div>
      </div>
      <img src="logo.png" alt="LombardaFlor" class="print-stack-logo">
    </div>
    
    <!-- HEADER PRINCIPALE A SCHERMO -->
    <div class="detail-hero no-print">
      <h2 class="detail-customer-name">${escapeHtml(order.customer)}</h2>
      <p class="detail-date">${dateFormatted}</p>
      
      <!-- SEGMENTED CONTROL iOS per cambio stato -->
      <div class="status-segmented-control">
        <button class="status-segment ${order.status === 'da_preparare' ? 'active' : ''}" data-status="da_preparare">
          Da preparare
        </button>
        <button class="status-segment ${order.status === 'pronto' ? 'active' : ''}" data-status="pronto">
          Pronto
        </button>
        <button class="status-segment ${order.status === 'ritirato' ? 'active' : ''}" data-status="ritirato">
          Ritirato
        </button>
      </div>
    </div>
    
    <!-- MERCE (versione schermo) -->
    <div class="detail-section detail-goods no-print">
      <h3 class="detail-section-title">Merce da Preparare</h3>
      <div class="detail-goods-content">${escapeHtml(order.description)}</div>
    </div>
    
    <!-- MERCE STAMPA: con checkbox per ogni riga (SOLO IN STAMPA) -->
    <div class="print-merce-section">
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
    </div>
  `;
  
  // INFO DELIVERY COMPATTE (solo a schermo)
  if (order.delivery_type || order.delivery_time || order.delivery_address || order.goods_type) {
    html += `<div class="detail-section detail-info no-print">`;
    html += `<div class="detail-info-grid">`;
    
    // Modalità
    if (order.delivery_type) {
      html += `
        <div class="detail-info-item">
          <span class="detail-info-label">Modalità</span>
          <span class="detail-info-value">${deliveryTypeLabels[order.delivery_type] || order.delivery_type}</span>
        </div>
      `;
    }
    
    // Orario
    if (order.delivery_time) {
      html += `
        <div class="detail-info-item">
          <span class="detail-info-label">Orario</span>
          <span class="detail-info-value">${order.delivery_time}</span>
        </div>
      `;
    }
    
    // Indirizzo (full width se presente)
    if (order.delivery_type === 'consegna' && order.delivery_address) {
      html += `
        <div class="detail-info-item detail-info-full">
          <span class="detail-info-label">Indirizzo</span>
          <span class="detail-info-value">${escapeHtml(order.delivery_address)}</span>
        </div>
      `;
    }
    
    // Stato merce
    if (order.goods_type) {
      html += `
        <div class="detail-info-item">
          <span class="detail-info-label">Disponibilità</span>
          <span class="detail-info-value">${goodsTypeLabels[order.goods_type] || order.goods_type}</span>
        </div>
      `;
    }
    
    // Tipo ordine
    if (order.order_type) {
      html += `
        <div class="detail-info-item">
          <span class="detail-info-label">Ricevuto via</span>
          <span class="detail-info-value">${orderTypeLabels[order.order_type] || order.order_type}</span>
        </div>
      `;
    }
    
    html += `</div></div>`;
  }
  
  // Foto (solo a schermo)
  if (order.photos && order.photos.length > 0) {
    html += `
      <div class="detail-section detail-photos-section no-print">
        <h3 class="detail-section-title">Foto (${order.photos.length})</h3>
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
  
  // Metadata discreto (solo a schermo)
  if (order.created_by || order.updated_by) {
    html += `<div class="detail-metadata no-print">`;
    
    if (order.created_by) {
      const createdDate = order.created_at ? new Date(order.created_at).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }) : '';
      html += `<span class="detail-metadata-item">Creato da ${escapeHtml(order.created_by)}${createdDate ? ` · ${createdDate}` : ''}</span>`;
    }
    
    if (order.updated_by && order.updated_at && order.updated_at !== order.created_at) {
      const updatedDate = new Date(order.updated_at).toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      html += `<span class="detail-metadata-item">Modificato da ${escapeHtml(order.updated_by)} · ${updatedDate}</span>`;
    }
    
    html += `</div>`;
  }
  
  document.getElementById('detail-content').innerHTML = html;
  
  // Configura segmented control per cambio stato
  const statusSegments = document.querySelectorAll('.status-segment');
  statusSegments.forEach(segment => {
    segment.addEventListener('click', async () => {
      const clickedStatus = segment.dataset.status;
      let newStatus = clickedStatus;
      
      // TOGGLE "Ritirato": se già ritirato e clicco di nuovo, torna a "pronto"
      if (clickedStatus === 'ritirato' && order.status === 'ritirato') {
        newStatus = 'pronto';
      }
      
      if (newStatus !== order.status) {
        // Disabilita tutti i segmenti durante l'update
        statusSegments.forEach(s => s.disabled = true);
        
        try {
          await updateOrderStatus(order.id, newStatus);
          // Ricarica l'ordine aggiornato
          const response = await authenticatedFetch(`${API_URL}/orders/${order.id}`);
          const updatedOrder = await response.json();
          currentDetailOrder = updatedOrder;
          renderOrderDetail(updatedOrder);
        } catch (error) {
          console.error('Errore cambio stato:', error);
          statusSegments.forEach(s => s.disabled = false);
        }
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
    message += `✅ *Merce pronta*\n\n`;
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

// ===========================
// GESTURE NAVIGATION (Swipe Back)
// ===========================
function initSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchEndX = 0;
  let touchEndY = 0;
  
  const minSwipeDistance = 80; // px
  const maxVerticalDistance = 100; // max vertical movement allowed
  
  document.addEventListener('touchstart', (e) => {
    // Only detect swipe from left edge (< 50px from left)
    if (e.touches[0].clientX < 50) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    } else {
      touchStartX = 0;
    }
  }, { passive: true });
  
  document.addEventListener('touchend', (e) => {
    if (touchStartX === 0) return; // Not a swipe from edge
    
    touchEndX = e.changedTouches[0].clientX;
    touchEndY = e.changedTouches[0].clientY;
    
    const horizontalDistance = touchEndX - touchStartX;
    const verticalDistance = Math.abs(touchEndY - touchStartY);
    
    // Swipe right from left edge
    if (
      horizontalDistance > minSwipeDistance && 
      verticalDistance < maxVerticalDistance
    ) {
      handleSwipeBack();
    }
    
    // Reset
    touchStartX = 0;
  }, { passive: true });
}

function handleSwipeBack() {
  const currentPage = getCurrentPage();
  
  if (currentPage === 'orders') {
    showCalendar();
  } else if (currentPage === 'fabbisogno' || currentPage === 'detail') {
    // Close modal
    document.querySelector('.modal.show')?.classList.remove('show');
  }
}

// Initialize swipe gestures after app is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSwipeGestures);
} else {
  initSwipeGestures();
}

// DEBUG: Funzione per verificare schema DB (usa da console browser)
async function debugSchema() {
  try {
    const response = await authenticatedFetch(API_URL + '/debug/schema');
    const data = await response.json();
    console.log('📊 DATABASE SCHEMA:', JSON.stringify(data, null, 2));
    console.table(data.tables);
    console.log('📈 Fabbisogno Count:', data.fabbisognoCount);
    console.log('📋 Fabbisogno Schema:', data.fabbisognoSchema);
    return data;
  } catch (error) {
    console.error('❌ Errore:', error);
  }
}

// Rendi disponibile globalmente per debug
window.debugSchema = debugSchema;

console.log('💡 DEBUG: Usa debugSchema() nella console per verificare il database');
