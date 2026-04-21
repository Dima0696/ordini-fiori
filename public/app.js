// Configurazione API
const API_URL = window.location.origin + '/api';

// Constants - Status e Labels
const ORDER_STATUS = {
  DA_PREPARARE: 'da_preparare',
  PRONTO: 'pronto',
  RITIRATO: 'ritirato'
};

const ORDER_STATUS_LABELS = {
  [ORDER_STATUS.DA_PREPARARE]: 'Da preparare',
  [ORDER_STATUS.PRONTO]: 'Pronto',
  [ORDER_STATUS.RITIRATO]: 'Ritirato'
};

const GOODS_TYPE = {
  IN_CELLA: 'in_cella',
  DA_ORDINARE: 'da_ordinare',
  ORDINATA: 'ordinata'
};

const GOODS_TYPE_LABELS = {
  [GOODS_TYPE.IN_CELLA]: 'Pronto',
  [GOODS_TYPE.DA_ORDINARE]: 'Da ordinare',
  [GOODS_TYPE.ORDINATA]: 'Ordinata'
};

// Stato globale
let currentDate = null;
let currentMonth = new Date(); // Parte dal mese corrente
let currentOrderId = null;
let goodsTypeDirty = false; // true quando l'utente cambia disponibilità nel form
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

// Tracking ordini stampati (localStorage)
const PRINTED_ORDERS_KEY = 'lombardaflor_printed_orders';

function markOrderAsPrinted(orderId) {
  const printed = getPrintedOrders();
  const now = new Date().toISOString();
  printed[orderId] = now;
  localStorage.setItem(PRINTED_ORDERS_KEY, JSON.stringify(printed));
  // Ricarica la lista per aggiornare il colore del bottone
  if (currentDate) {
    loadOrders(currentDate);
  }
}

function isOrderPrinted(orderId) {
  const printed = getPrintedOrders();
  return !!printed[orderId];
}

function getPrintedOrders() {
  try {
    return JSON.parse(localStorage.getItem(PRINTED_ORDERS_KEY) || '{}');
  } catch {
    return {};
  }
}

// Ordini Fissi - Date selezionate
const fissoSelectedDates = new Set();
let fissoCurrentMonth = new Date();

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
const pageListini = document.getElementById('page-listini');
const pagePreventivi = document.getElementById('page-preventivi');
const pageClienti = document.getElementById('page-clienti');
const pageCatalogo = document.getElementById('page-catalogo');
const modalOrder = document.getElementById('modal-order');
const modalConfirm = document.getElementById('modal-confirm');
const daysList = document.getElementById('days-list');
const ordersList = document.getElementById('orders-list');
const emptyMessage = document.getElementById('empty-message');

// Splash Screen Management
// Mostra splash SUBITO per sovrascrivere quella nativa Android
const splashScreen = document.getElementById('splash-screen');
if (splashScreen) {
  // Assicura che sia visibile immediatamente
  splashScreen.style.display = 'flex';
}

window.addEventListener('load', () => {
  // Rimuovi splash screen dopo il caricamento completo (ridotto a 800ms per velocità)
  if (splashScreen) {
    setTimeout(() => {
      splashScreen.classList.add('fade-out');
      // Rimuovi dal DOM dopo la transizione e ripristina scroll
      setTimeout(() => {
        splashScreen.remove();
        // Assicura che il body possa scrollare
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
      }, 500);
    }, 800);
  }
});

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
  
  try {
    setupEventListeners();
  } catch (error) {
    console.error('❌ ERRORE in setupEventListeners():', error);
  }
  // Pull-to-refresh disabilitato (dava problemi)
  // setupPullToRefresh();
  
  // Richiedi permessi notifiche
  await requestNotificationPermission();
  
  // Mostra calendario
  await loadCalendar(); // Usa cache se disponibile
  
  // Avvia auto-refresh ogni 2 minuti
  startAutoRefresh();
  
  // Aggiorna badge "ordini in attesa" (portale clienti)
  if (typeof refreshPendingBadgeOnly === 'function') {
    refreshPendingBadgeOnly();
    // Polling ogni 60s per mantenerlo aggiornato
    setInterval(() => {
      if (typeof refreshPendingBadgeOnly === 'function') refreshPendingBadgeOnly();
    }, 60000);
  }
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

// Funzioni refresh manuali con animazione
async function refreshCalendar() {
  const btn = document.getElementById('btn-refresh-calendar');
  if (!btn) return;
  
  // Aggiungi classe spinning
  btn.classList.add('spinning');
  
  try {
    await loadCalendar();
  } catch (error) {
    console.error('Errore refresh calendario:', error);
    alert('Errore durante il caricamento del calendario');
  } finally {
    // Rimuovi animazione dopo 500ms
    setTimeout(() => {
      btn.classList.remove('spinning');
    }, 500);
  }
}

async function refreshOrdersList() {
  const btn = document.getElementById('btn-refresh-orders');
  if (!btn) return;
  
  // Aggiungi classe spinning
  btn.classList.add('spinning');
  
  try {
    await loadOrders(currentDate);
  } catch (error) {
    console.error('Errore refresh ordini:', error);
    alert('Errore durante il caricamento degli ordini');
  } finally {
    // Rimuovi animazione dopo 500ms
    setTimeout(() => {
      btn.classList.remove('spinning');
    }, 500);
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

// Helper: Fetch senza cache (per GET che devono essere sempre freschi)
async function fetchNoCache(url, options = {}) {
  return authenticatedFetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      ...options.headers,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });
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
  // Notifiche
  // Logout
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-orders').addEventListener('click', logout);

  // Refresh
  document.getElementById('btn-refresh-calendar').addEventListener('click', refreshCalendar);
  document.getElementById('btn-refresh-orders').addEventListener('click', refreshOrdersList);
  
  // Copia articoli per fornitore
  document.querySelectorAll('.copy-supplier-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const supplier = btn.dataset.supplier;
      // Feedback animazione
      btn.classList.add('copying');
      setTimeout(() => btn.classList.remove('copying'), 600);
      copySupplierItems(supplier);
    });
  });
  
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
  
  document.getElementById('btn-home').addEventListener('click', () => {
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
  
  // Ordine fisso
  document.getElementById('fab-ordine-fisso').addEventListener('click', () => {
    closeFabMenu();
    openOrdineFissoModal();
  });
  
  // Modal ordine fisso
  document.getElementById('btn-close-ordine-fisso').addEventListener('click', closeOrdineFissoModal);
  document.getElementById('btn-cancel-fisso').addEventListener('click', closeOrdineFissoModal);
  
  // Navigazione mesi calendario ordini fissi
  document.getElementById('fisso-prev-month').addEventListener('click', () => {
    // Crea nuova data per evitare problemi con setMonth
    fissoCurrentMonth = new Date(fissoCurrentMonth.getFullYear(), fissoCurrentMonth.getMonth() - 1, 1);
    renderFissoCalendar();
  });

  document.getElementById('fisso-next-month').addEventListener('click', () => {
    // Crea nuova data per evitare problemi con setMonth
    fissoCurrentMonth = new Date(fissoCurrentMonth.getFullYear(), fissoCurrentMonth.getMonth() + 1, 1);
    renderFissoCalendar();
  });
  
  // Clear dates
  document.getElementById('btn-clear-dates').addEventListener('click', () => {
    fissoSelectedDates.clear();
    updateFissoCalendar();
  });
  
  // Form submit
  document.getElementById('ordine-fisso-form').addEventListener('submit', handleOrdineFissoSubmit);
  
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
  
  // Quick Actions Premium (sotto header)
  document.getElementById('quick-nuovo-ordine').addEventListener('click', () => {
    openNewOrderModal();
  });
  
  document.getElementById('quick-ordine-fisso').addEventListener('click', () => {
    openOrdineFissoModal();
  });
  
  document.getElementById('quick-arrivi').addEventListener('click', () => {
    alert('📦 Merce in arrivo - In arrivo! Calendario degli arrivi di merce.');
  });
  
  document.getElementById('quick-listini').addEventListener('click', () => {
    openListiniPage();
  });
  
  // Preventivi
  const quickPrev = document.getElementById('quick-preventivi');
  if (quickPrev) quickPrev.addEventListener('click', () => openPreventiviPage());
  const fabPrev = document.getElementById('fab-preventivi');
  if (fabPrev) fabPrev.addEventListener('click', () => { closeFabMenu(); openPreventiviPage(); });
  
  // Clienti portale
  const quickCli = document.getElementById('quick-clienti');
  if (quickCli) quickCli.addEventListener('click', () => openClientiPage());
  const fabCli = document.getElementById('fab-clienti');
  if (fabCli) fabCli.addEventListener('click', () => { closeFabMenu(); openClientiPage(); });
  const btnBackCli = document.getElementById('btn-back-clienti');
  if (btnBackCli) btnBackCli.addEventListener('click', () => showPage('calendar'));
  const btnHomeCli = document.getElementById('btn-home-clienti');
  if (btnHomeCli) btnHomeCli.addEventListener('click', () => showPage('calendar'));
  const btnLogoutCli = document.getElementById('btn-logout-clienti');
  if (btnLogoutCli) btnLogoutCli.addEventListener('click', logout);
  setupClientiListeners();
  
  // Catalogo del giorno
  const quickCat = document.getElementById('quick-catalogo');
  if (quickCat) quickCat.addEventListener('click', () => openCatalogoPage());
  const btnBackCat = document.getElementById('btn-back-catalogo');
  if (btnBackCat) btnBackCat.addEventListener('click', () => showPage('calendar'));
  const btnHomeCat = document.getElementById('btn-home-catalogo');
  if (btnHomeCat) btnHomeCat.addEventListener('click', () => showPage('calendar'));
  const btnLogoutCat = document.getElementById('btn-logout-catalogo');
  if (btnLogoutCat) btnLogoutCat.addEventListener('click', logout);
  setupCatalogoListeners();
  
  // Pulsanti pagina Listini
  document.getElementById('btn-back-listini').addEventListener('click', () => {
    showPage('calendar');
  });
  
  document.getElementById('btn-home-listini').addEventListener('click', () => {
    showPage('calendar');
  });
  
  document.getElementById('btn-logout-listini').addEventListener('click', logout);
  
  // Pulsanti pagina Preventivi
  const btnBackPrev = document.getElementById('btn-back-preventivi');
  if (btnBackPrev) btnBackPrev.addEventListener('click', () => showPage('calendar'));
  const btnHomePrev = document.getElementById('btn-home-preventivi');
  if (btnHomePrev) btnHomePrev.addEventListener('click', () => showPage('calendar'));
  const btnLogoutPrev = document.getElementById('btn-logout-preventivi');
  if (btnLogoutPrev) btnLogoutPrev.addEventListener('click', logout);
  setupPreventiviListeners();
  
  document.getElementById('btn-select-file').addEventListener('click', () => {
    document.getElementById('listino-file-input').click();
  });
  
  document.getElementById('listino-file-input').addEventListener('change', handleListinoUpload);
  
  // Pulsante "Fabbisogno giorno" nascosto in UI (sostituito da checkbox
  // ORDINATO/PREPARATO a livello di singolo articolo). Le funzioni interne
  // (openFabbisognoModal, modal-fabbisogno, printFabbisogno) restano nel
  // codice perché riutilizzate da altri flussi: NON vanno rimosse.
  const btnFabbisogno = document.getElementById('btn-fabbisogno');
  if (btnFabbisogno) btnFabbisogno.style.display = 'none';
  
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
  
  
  // Modal ordine
  document.getElementById('btn-close-modal').addEventListener('click', closeOrderModal);
  
  const orderForm = document.getElementById('order-form');
  if (orderForm) {
    orderForm.addEventListener('submit', handleOrderSubmit);
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

  // Gestione bottoni disponibilità merce
  document.querySelectorAll('.btn-goods').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const goodsType = e.currentTarget.getAttribute('data-goods');
      // Aggiorna input hidden
      document.getElementById('goods-type').value = goodsType;
      // Aggiorna bottoni attivi
      document.querySelectorAll('.btn-goods').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
    });
  });
  
  // Gestione bottoni disponibilità merce PREMIUM
  document.querySelectorAll('.btn-goods-premium').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const goodsType = e.currentTarget.getAttribute('data-goods');
      document.getElementById('goods-type').value = goodsType;
      document.querySelectorAll('.btn-goods-premium').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      
      // Segna come "sporco" così al submit applicheremo le spunte automaticamente
      goodsTypeDirty = true;
      
      // Se siamo in modifica (ordine esistente), applica subito le spunte
      if (currentOrderId) {
        const description = document.getElementById('order-description').value.trim();
        const totalLines = description.split('\n').filter(l => l.trim() !== '').length;
        if (totalLines > 0) {
          applyGoodsTypeToChecks(currentOrderId, goodsType, totalLines);
        }
      }
    });
  });
  
  // Gestione bottoni stato PREMIUM
  document.querySelectorAll('.btn-status-premium').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const status = e.currentTarget.getAttribute('data-status');
      document.getElementById('order-status').value = status;
      document.querySelectorAll('.btn-status-premium').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
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
    
    // Carica statistiche ordini - sempre freschi
    const response = await fetchNoCache(`${API_URL}/stats/dates`);
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
  
  // Crea array di date - SOLO DA OGGI IN POI + prossimi 30 giorni
  const dates = [];
  
  // Determina il giorno di partenza: oggi o primo del mese se siamo nel futuro
  const startDate = new Date(today);
  
  // Se stiamo guardando un mese futuro, parti dal primo giorno
  if (year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth())) {
    startDate.setFullYear(year);
    startDate.setMonth(month);
    startDate.setDate(1);
  }
  // Se stiamo guardando il mese corrente, parti da oggi
  else if (year === today.getFullYear() && month === today.getMonth()) {
    // startDate è già oggi
  }
  // Se stiamo guardando un mese passato, non mostrare nulla (o parti dal primo)
  else {
    startDate.setFullYear(year);
    startDate.setMonth(month);
    startDate.setDate(1);
  }
  
  // Genera i prossimi 30 giorni a partire dalla data di inizio
  for (let i = 0; i < 30; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    dates.push(date);
  }
  
  // Renderizza giorni nell'ordine corretto
  for (let date of dates) {
    const dateStr = formatDate(date);
    const stat = orderStats[dateStr];
    const dayOfWeek = date.getDay(); // 0 = Domenica
    const day = date.getDate();
    const dateMonth = date.getMonth();
    const dateYear = date.getFullYear();
    
    const dayCard = document.createElement('div');
    dayCard.className = 'day-card';
    dayCard.dataset.date = dateStr;
    
    // Classe per mese successivo (per styling diverso)
    const isNextMonth = dateMonth !== month;
    if (isNextMonth) {
      dayCard.classList.add('next-month');
    }
    
    // Classe per ordini
    if (stat && stat.total > 0) {
      dayCard.classList.add('has-orders');
      
      // Classe per ordini DA PREPARARE (per evidenziare nel calendario)
      if (stat.da_preparare > 0) {
        dayCard.classList.add('has-da-preparare');
      }
    }
    
    // Classe OGGI
    const isToday = dateStr === todayStr;
    if (isToday) {
      dayCard.classList.add('today');
      todayCard = dayCard;
    }
    
    // Classe DOMENICA e FESTIVITÀ (usa il mese effettivo del giorno)
    const monthDay = String(dateMonth + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isHoliday = holidays.includes(monthDay);
    
    if (dayOfWeek === 0) {
      dayCard.classList.add('sunday');
    }
    if (isHoliday) {
      dayCard.classList.add('holiday');
    }
    
    // Formatta data italiana (usa il mese effettivo del giorno)
    const dayName = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'][dayOfWeek];
    let dateFormatted = `${dayName} ${day} ${monthNames[dateMonth]}`;
    
    let content = `
      <div class="day-number-bg">${day}</div>
      <div class="day-date">${dateFormatted}</div>
      <div class="day-info">`;
    
    if (stat && stat.total > 0) {
      content += `
        <div class="day-count">${stat.total} ordin${stat.total === 1 ? 'e' : 'i'}</div>
      `;
      
      // Mostra nomi clienti (cliccabili!)
      if (stat.customers && stat.customers.length > 0) {
        content += `<div class="day-customers">`;
        
        // Mostra max 4 nomi, poi "e altri X"
        const maxToShow = 4;
        const customersToShow = stat.customers.slice(0, maxToShow);
        const remaining = stat.customers.length - maxToShow;
        
        customersToShow.forEach(customer => {
          content += `<span class="customer-name clickable" data-customer="${escapeHtml(customer)}" data-date="${dateStr}">${escapeHtml(customer)}</span>`;
        });
        
        if (remaining > 0) {
          content += `<span class="customer-more">e altri ${remaining}</span>`;
        }
        
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
    // Formatta data
    const dateObj = new Date(order.date + 'T00:00:00');
    const dateFormatted = dateObj.toLocaleDateString('it-IT', {
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    });
    
    let infoBadges = '';
    if (order.goods_type) {
      const goodsClass = order.goods_type === GOODS_TYPE.DA_ORDINARE ? 'da_ordinare' : '';
      const label = order.goods_type === GOODS_TYPE.IN_CELLA ? '✅ Pronto' : 
                    order.goods_type === GOODS_TYPE.DA_ORDINARE ? '📝 Da ordinare' : 
                    order.goods_type === GOODS_TYPE.ORDINATA ? '📦 Ordinata' : '';
      infoBadges += `<span class="info-badge ${goodsClass}">${label}</span>`;
    }
    
    html += `
      <div class="order-card" data-order-id="${order.id}">
        <div class="order-content">
          <div class="order-header">
            <div class="order-customer">${escapeHtml(order.customer)}</div>
            <span class="order-status-badge ${order.status}">${ORDER_STATUS_LABELS[order.status]}</span>
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
    
    // Carica ordini del giorno - sempre freschi
    const response = await fetchNoCache(`${API_URL}/orders/date/${date}`);
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
  
  // Reset giorni extra quando si cambia giorno
  selectedExtraDays = new Set();
  extraDayOrders = {};
  extraDayChecks = {};
  
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
// Cache globale dei checks e ordini visualizzati
let allOrderChecks = {};
let currentDayOrders = [];

// Multi-giorno: giorni extra selezionati + cache loro ordini/checks
let selectedExtraDays = new Set();
let extraDayOrders = {}; // { 'YYYY-MM-DD': [orders] }
let extraDayChecks = {}; // { 'YYYY-MM-DD': { orderId: { line: {...} } } }

async function loadOrders(date) {
  try {
    const response = await fetchNoCache(`${API_URL}/orders/date/${date}`);
    const orders = await response.json();
    currentDayOrders = orders;
    
    // Carica i checks di tutti gli ordini in batch
    if (orders.length > 0) {
      try {
        const ids = orders.map(o => o.id).join(',');
        const checksResponse = await fetchNoCache(`${API_URL}/fabbisogno-checks/batch/${ids}`);
        allOrderChecks = await checksResponse.json();
      } catch (e) {
        console.log('Checks non caricati:', e);
        allOrderChecks = {};
      }
    } else {
      allOrderChecks = {};
    }
    
    renderDaysSelector();
    renderOrdersView();
    
    // Aggiorna anche i giorni extra selezionati (in background)
    if (selectedExtraDays.size > 0) {
      refreshExtraDays();
    }
  } catch (error) {
    console.error('❌ Errore caricamento ordini:', error);
    alert('Errore nel caricamento degli ordini: ' + error.message);
  }
}

// Ricarica ordini + checks di TUTTI i giorni extra selezionati
async function refreshExtraDays() {
  const isos = [...selectedExtraDays];
  if (isos.length === 0) return;
  
  await Promise.all(isos.map(iso => refreshOneExtraDay(iso)));
  renderDaysSelector();
  renderOrdersView();
}

async function refreshOneExtraDay(iso) {
  try {
    const response = await fetchNoCache(`${API_URL}/orders/date/${iso}`);
    const orders = await response.json();
    extraDayOrders[iso] = orders;
    
    if (orders.length > 0) {
      const ids = orders.map(o => o.id).join(',');
      const checksResponse = await fetchNoCache(`${API_URL}/fabbisogno-checks/batch/${ids}`);
      extraDayChecks[iso] = await checksResponse.json();
    } else {
      extraDayChecks[iso] = {};
    }
    
    mergeExtraChecksIntoAll(iso);
  } catch (e) {
    console.error('[EXTRA-DAY] refresh fallito:', iso, e);
  }
}

// Ordina ordini per stato (da_preparare → pronto → ritirato)
function sortOrdersByStatus(orders) {
  const statusOrder = { 'da_preparare': 1, 'pronto': 2, 'ritirato': 3 };
  return [...orders].sort((a, b) => (statusOrder[a.status] || 999) - (statusOrder[b.status] || 999));
}

// Entry point: decide se render single-day o multi-day
function renderOrdersView() {
  if (selectedExtraDays.size === 0) {
    renderOrders(currentDayOrders);
    return;
  }
  
  // Multi-giorno: raccogli gruppi ordinati per data crescente
  const groups = [];
  groups.push({ date: currentDate, orders: currentDayOrders, isCurrent: true });
  
  [...selectedExtraDays].sort().forEach(iso => {
    const orders = extraDayOrders[iso];
    if (Array.isArray(orders)) {
      groups.push({ date: iso, orders, isCurrent: false });
    }
  });
  
  renderOrdersGrouped(groups);
}

// Render multi-giorno con sezioni separate
function renderOrdersGrouped(groups) {
  ordersList.innerHTML = '';
  
  const totalOrders = groups.reduce((sum, g) => sum + g.orders.length, 0);
  if (totalOrders === 0) {
    emptyMessage.style.display = 'block';
    return;
  }
  emptyMessage.style.display = 'none';
  
  const dayNames = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const monthNames = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
                      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  
  groups.forEach(group => {
    const d = new Date(group.date + 'T00:00:00');
    const title = `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}`;
    const count = group.orders.length;
    
    // Separatore giorno
    const sep = document.createElement('div');
    sep.className = `day-separator ${group.isCurrent ? 'day-separator-current' : ''}`;
    sep.innerHTML = `
      <div class="day-separator-line"></div>
      <div class="day-separator-content">
        <span class="day-separator-title">${title}</span>
        <span class="day-separator-count">${count} ${count === 1 ? 'ordine' : 'ordini'}</span>
      </div>
      <div class="day-separator-line"></div>
    `;
    ordersList.appendChild(sep);
    
    if (count === 0) {
      const empty = document.createElement('div');
      empty.className = 'day-group-empty';
      empty.textContent = 'Nessun ordine';
      ordersList.appendChild(empty);
      return;
    }
    
    sortOrdersByStatus(group.orders).forEach((order, index) => {
      ordersList.appendChild(createOrderCard(order, index));
    });
  });
}

// Render lista singola (usata quando non ci sono giorni extra)
function renderOrders(orders) {
  ordersList.innerHTML = '';
  
  if (orders.length === 0) {
    emptyMessage.style.display = 'block';
    return;
  }
  
  emptyMessage.style.display = 'none';
  
  sortOrdersByStatus(orders).forEach((order, index) => {
    ordersList.appendChild(createOrderCard(order, index));
  });
}

// Crea la card di un singolo ordine con tutti i listener
function createOrderCard(order, index) {
    const orderCard = document.createElement('div');
    const isRitirato = order.status === ORDER_STATUS.RITIRATO;
    const isCustomerPending = order.customer_order_status === 'pending';
    const isCustomerRejected = order.customer_order_status === 'rejected';
    const isCustomerOrder = !!order.customer_id;
    let cardExtraCls = '';
    if (isRitirato) cardExtraCls += ' order-ritirato';
    if (isCustomerPending) cardExtraCls += ' is-customer-pending';
    if (isCustomerRejected) cardExtraCls += ' is-customer-rejected';
    orderCard.className = `order-card status-${order.status}${cardExtraCls}`;
    orderCard.dataset.orderId = order.id;
    
    // Calcolo stati automatici dalle spunte
    const orderedProg = getOrderedProgress(order.id, order.description);
    const preparedProg = getOrderProgress(order.id, order.description);
    const hasLines = preparedProg.total > 0;
    const isAllOrdered = hasLines && orderedProg.done === orderedProg.total;
    const isAllPrepared = hasLines && preparedProg.done === preparedProg.total;
    
    // Badge di stato (in alto a destra)
    let stateBadgesHtml = '';
    if (isRitirato) {
      stateBadgesHtml = `<span class="order-state-badge state-ritirato">RITIRATO</span>`;
    } else {
      stateBadgesHtml = `
        <span class="order-state-badge state-ordinato ${isAllOrdered ? 'active' : ''}" title="Tutti gli articoli ordinati">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M2.5 3h2.2l2.7 12.3a2 2 0 0 0 2 1.7h8.5a2 2 0 0 0 2-1.5L21.5 7H6"/></svg>
          <span>ORDINATO</span>
        </span>
        <span class="order-state-badge state-pronto ${isAllPrepared ? 'active' : ''}" title="Tutti gli articoli preparati">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>
          <span>PRONTO</span>
        </span>
      `;
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
    if (order.description && order.description.length > 50) {
      indicators += `<span class="order-indicator" title="Descrizione lunga">📝</span>`;
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
    
    // Badge "CLIENTE WEB" + stato customer
    let customerBadgesHtml = '';
    if (isCustomerOrder) {
      customerBadgesHtml += `<span class="order-chip-customer-web">🌐 CLIENTE WEB</span>`;
      if (isCustomerPending) {
        customerBadgesHtml += `<span class="order-chip-pending">⏳ IN ATTESA</span>`;
      } else if (isCustomerRejected) {
        customerBadgesHtml += `<span class="order-chip-rejected">❌ RIFIUTATO</span>`;
      }
    }
    
    // Azioni specifiche per ordine cliente in attesa
    const customerPendingActions = isCustomerPending ? `
      <button class="btn-small btn-approve-inline" data-id="${order.id}">✓ Approva</button>
      <button class="btn-small btn-reject-inline" data-id="${order.id}">✗ Rifiuta</button>
    ` : '';
    
    orderCard.innerHTML = `
      <div class="order-content">
        <div class="order-header">
          <div class="order-customer">
            ${escapeHtml(order.customer)}
            ${indicators ? `<span class="order-indicators">${indicators}</span>` : ''}
          </div>
          <div class="order-state-badges">${stateBadgesHtml}</div>
        </div>
        ${customerBadgesHtml ? `<div class="order-customer-badges">${customerBadgesHtml}</div>` : ''}
        ${isCustomerRejected && order.customer_reject_reason ? `<div class="order-reject-note">Motivo rifiuto: ${escapeHtml(order.customer_reject_reason)}</div>` : ''}
        <div class="order-description order-checklist" data-order-id="${order.id}">
          ${renderDescriptionWithChecks(order.id, order.description)}
        </div>
        ${renderOrderProgress(order.id, order.description)}
        ${photosHtml}
        ${userInfoHtml}
      </div>
      <div class="order-actions">
        ${customerPendingActions}
        <button class="btn-small btn-print-quick ${isOrderPrinted(order.id) ? 'printed' : ''}" data-id="${order.id}">
          ${isOrderPrinted(order.id) ? '✓ Stampato' : '🖨️ Stampa'}
        </button>
        ${!isRitirato ? `<button class="btn-small btn-edit-order" data-id="${order.id}">✎ Modifica</button>` : ''}
        ${!isRitirato && !isCustomerPending && isAllPrepared ? `<button class="btn-small btn-collected" data-id="${order.id}">✓ Ritirato</button>` : ''}
        ${isRitirato ? `<button class="btn-small btn-undo-collected" data-id="${order.id}">↶ Annulla ritiro</button>` : ''}
      </div>
    `;
    
    // Click sulle checkbox (prima dei listener generici per stopPropagation)
    orderCard.querySelectorAll('.check-box').forEach(checkBox => {
      checkBox.addEventListener('click', (e) => {
        e.stopPropagation();
        const checkLine = checkBox.closest('.check-line');
        const orderId = parseInt(checkLine.dataset.orderId);
        const lineNumber = parseInt(checkLine.dataset.line);
        toggleOrderLineCheck(orderId, lineNumber, e.target);
      });
    });
    
    // Click sui bottoni provenienza (IMPORT / ITA / NL)
    orderCard.querySelectorAll('.supplier-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const group = btn.closest('.supplier-group');
        const orderId = parseInt(group.dataset.orderId);
        const lineNumber = parseInt(group.dataset.line);
        const supplier = btn.dataset.supplier;
        toggleOrderLineSupplier(orderId, lineNumber, supplier, btn);
      });
    });
    
    // Nota: il click sulla card NON apre più il dettaglio.
    // La modifica avviene solo tramite il bottone "Modifica" dedicato.
    
    
    // Event listeners pulsanti
    orderCard.querySelector('.btn-print-quick').addEventListener('click', (e) => {
      e.stopPropagation();
      // Apri dettaglio ordine e stampa
      openOrderDetail(order);
      
      // Listener per tornare alla lista dopo la stampa
      const afterPrintHandler = () => {
        // Rimuovi il listener
        window.removeEventListener('afterprint', afterPrintHandler);
        // Chiudi il modal dettaglio
        const modalDetail = document.getElementById('modal-detail');
        if (modalDetail) {
          modalDetail.classList.remove('active');
        }
        // Segna come stampato
        markOrderAsPrinted(order.id);
      };
      
      // Attendi che il modal si apra e poi stampa
      setTimeout(() => {
        // Aggiungi listener per quando termina la stampa
        window.addEventListener('afterprint', afterPrintHandler);
        // Apri dialog stampa
        window.print();
      }, 300);
    });
    
    const btnEdit = orderCard.querySelector('.btn-edit-order');
    if (btnEdit) {
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditOrderModal(order);
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
        updateOrderStatus(order.id, 'da_preparare');
      });
    }
    
    // Approva / Rifiuta ordini cliente in attesa (inline sulla card)
    const btnApproveInline = orderCard.querySelector('.btn-approve-inline');
    if (btnApproveInline) {
      btnApproveInline.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch(`/api/orders/${order.id}/approve`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (!res.ok) throw new Error('Errore approvazione');
          showMiniToast('Ordine approvato', 'success');
          if (typeof currentDate !== 'undefined' && currentDate) await loadOrders(currentDate);
          if (typeof refreshPendingBadgeOnly === 'function') refreshPendingBadgeOnly();
        } catch (err) { showMiniToast(err.message || 'Errore', 'error'); }
      });
    }
    
    const btnRejectInline = orderCard.querySelector('.btn-reject-inline');
    if (btnRejectInline) {
      btnRejectInline.addEventListener('click', async (e) => {
        e.stopPropagation();
        const reason = prompt('Motivo del rifiuto (verrà mostrato al cliente):', '');
        if (reason === null) return;
        try {
          const res = await fetch(`/api/orders/${order.id}/reject`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason })
          });
          if (!res.ok) throw new Error('Errore rifiuto');
          showMiniToast('Ordine rifiutato', 'success');
          if (typeof currentDate !== 'undefined' && currentDate) await loadOrders(currentDate);
          if (typeof refreshPendingBadgeOnly === 'function') refreshPendingBadgeOnly();
        } catch (err) { showMiniToast(err.message || 'Errore', 'error'); }
      });
    }
    
    return orderCard;
}


// Renderizza descrizione con doppia checkbox: ORDINATO + PREPARATO
function renderDescriptionWithChecks(orderId, description) {
  if (!description) return '';
  
  const lines = description.split('\n').filter(line => line.trim() !== '');
  const checks = allOrderChecks[orderId] || {};
  
  if (lines.length === 0) return '';
  
  let html = '';
  
  html += lines.map((line, index) => {
    const lineData = checks[index] || { checked: false, prepared: false, supplier: '' };
    const isOrdered = lineData.checked === true;
    const isPrepared = lineData.prepared === true;
    const supplier = (lineData.supplier || '').toUpperCase();
    
    // Icone SVG per differenziare visivamente le due spunte
    const cartIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M2.5 3h2.2l2.7 12.3a2 2 0 0 0 2 1.7h8.5a2 2 0 0 0 2-1.5L21.5 7H6"/></svg>`;
    const boxIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>`;
    
    return `<div class="check-line" data-order-id="${orderId}" data-line="${index}">
      <span class="check-box check-ordered ${isOrdered ? 'checked' : ''}" data-type="ordered" title="Ordinato (acquistato dal fornitore)" aria-label="Ordinato">${cartIcon}</span>
      <span class="check-box check-prepared ${isPrepared ? 'checked' : ''}" data-type="prepared" title="Preparato (pronto in negozio)" aria-label="Preparato">${boxIcon}</span>
      <span class="check-text ${isOrdered && isPrepared ? 'all-done' : ''}">${escapeHtml(line.trim())}</span>
      <span class="supplier-group" data-order-id="${orderId}" data-line="${index}">
        <button type="button" class="supplier-btn supplier-import ${supplier === 'IMPORT' ? 'active' : ''}" data-supplier="IMPORT" title="Import">IMP</button>
        <button type="button" class="supplier-btn supplier-ita ${supplier === 'ITA' ? 'active' : ''}" data-supplier="ITA" title="Italia">ITA</button>
        <button type="button" class="supplier-btn supplier-nl ${supplier === 'NL' ? 'active' : ''}" data-supplier="NL" title="Olanda">NL</button>
      </span>
    </div>`;
  }).join('');
  
  return html;
}

// Calcola statistiche preparazione ordine (basato su PREPARATO)
function getOrderProgress(orderId, description) {
  if (!description) return { total: 0, done: 0, percent: 0 };
  const lines = description.split('\n').filter(l => l.trim() !== '');
  const total = lines.length;
  if (total === 0) return { total: 0, done: 0, percent: 0 };
  
  const checks = allOrderChecks[orderId] || {};
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (checks[i] && checks[i].prepared === true) done++;
  }
  
  return {
    total,
    done,
    percent: Math.round((done / total) * 100)
  };
}

// Calcola statistiche di ordinazione (basato su ORDINATO / checked)
function getOrderedProgress(orderId, description) {
  if (!description) return { total: 0, done: 0, percent: 0 };
  const lines = description.split('\n').filter(l => l.trim() !== '');
  const total = lines.length;
  if (total === 0) return { total: 0, done: 0, percent: 0 };
  
  const checks = allOrderChecks[orderId] || {};
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (checks[i] && checks[i].checked === true) done++;
  }
  
  return {
    total,
    done,
    percent: Math.round((done / total) * 100)
  };
}

// Aggiorna badge di stato (ORDINATO / PRONTO) e bottone Ritirato sulla card
function refreshOrderCardState(orderId) {
  const order = findDisplayedOrder(orderId);
  if (!order) return;
  if (order.status === ORDER_STATUS.RITIRATO) return; // card ritirata: nessun aggiornamento automatico
  
  const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
  if (!orderCard) return;
  
  const orderedProg = getOrderedProgress(orderId, order.description);
  const preparedProg = getOrderProgress(orderId, order.description);
  const hasLines = preparedProg.total > 0;
  const isAllOrdered = hasLines && orderedProg.done === orderedProg.total;
  const isAllPrepared = hasLines && preparedProg.done === preparedProg.total;
  
  const badgeOrd = orderCard.querySelector('.order-state-badge.state-ordinato');
  const badgePro = orderCard.querySelector('.order-state-badge.state-pronto');
  if (badgeOrd) badgeOrd.classList.toggle('active', isAllOrdered);
  if (badgePro) badgePro.classList.toggle('active', isAllPrepared);
  
  // Gestione bottone "Ritirato" (appare solo quando tutto è preparato)
  const actionsEl = orderCard.querySelector('.order-actions');
  if (actionsEl) {
    let btnCollected = actionsEl.querySelector('.btn-collected');
    if (isAllPrepared && !btnCollected) {
      btnCollected = document.createElement('button');
      btnCollected.className = 'btn-small btn-collected';
      btnCollected.dataset.id = orderId;
      btnCollected.textContent = '✓ Ritirato';
      btnCollected.addEventListener('click', (e) => {
        e.stopPropagation();
        updateOrderStatus(orderId, 'ritirato');
      });
      actionsEl.appendChild(btnCollected);
    } else if (!isAllPrepared && btnCollected) {
      btnCollected.remove();
    }
  }
}

// Renderizza barra di progresso ordine (basata su PREPARATO)
function renderOrderProgress(orderId, description) {
  const { total, done, percent } = getOrderProgress(orderId, description);
  if (total === 0) return '';
  
  const statusClass = percent === 100 ? 'complete' : percent >= 50 ? 'mid' : 'low';
  
  return `<div class="order-progress ${statusClass}" data-progress-order="${orderId}">
    <div class="progress-header">
      <span class="progress-label">📦 Preparazione</span>
      <span class="progress-stats"><strong>${done}/${total}</strong> <span class="progress-percent">${percent}%</span></span>
    </div>
    <div class="progress-bar-track">
      <div class="progress-bar-fill" style="width: ${percent}%"></div>
    </div>
  </div>`;
}

// Aggiorna barra progresso di un ordine
function updateOrderProgress(orderId) {
  const order = findDisplayedOrder(orderId);
  if (!order) return;
  
  const progressEl = document.querySelector(`[data-progress-order="${orderId}"]`);
  if (!progressEl) return;
  
  const { total, done, percent } = getOrderProgress(orderId, order.description);
  
  const fillEl = progressEl.querySelector('.progress-bar-fill');
  const statsEl = progressEl.querySelector('.progress-stats');
  
  if (fillEl) fillEl.style.width = percent + '%';
  if (statsEl) statsEl.innerHTML = `<strong>${done}/${total}</strong> <span class="progress-percent">${percent}%</span>`;
  
  progressEl.classList.remove('complete', 'mid', 'low');
  progressEl.classList.add(percent === 100 ? 'complete' : percent >= 50 ? 'mid' : 'low');
}

// Applica il tipo disponibilità ai check dell'ordine (chiamata in massa)
//   da_ordinare → azzera tutte le spunte (checked=false, prepared=false)
//   ordinata    → tutte ORDINATO attive, tutte PREPARATO disattive
//   in_cella    → tutte ORDINATO e PREPARATO attive (Pronto)
async function applyGoodsTypeToChecks(orderId, goodsType, totalLines) {
  if (!orderId || !totalLines) return;
  
  let payload = null;
  if (goodsType === GOODS_TYPE.DA_ORDINARE) {
    payload = { totalLines, checked: false, prepared: false };
  } else if (goodsType === GOODS_TYPE.ORDINATA) {
    payload = { totalLines, checked: true, prepared: false };
  } else if (goodsType === GOODS_TYPE.IN_CELLA) {
    payload = { totalLines, checked: true, prepared: true };
  }
  if (!payload) return;
  
  // Optimistic update cache locale
  if (!allOrderChecks[orderId]) allOrderChecks[orderId] = {};
  for (let i = 0; i < totalLines; i++) {
    if (!allOrderChecks[orderId][i]) {
      allOrderChecks[orderId][i] = { checked: false, prepared: false, supplier: '' };
    }
    if (typeof payload.checked === 'boolean') {
      allOrderChecks[orderId][i].checked = payload.checked;
    }
    if (typeof payload.prepared === 'boolean') {
      allOrderChecks[orderId][i].prepared = payload.prepared;
    }
  }
  
  // Aggiorna UI sulla card se visibile
  const orderCard = document.querySelector(`.order-card[data-order-id="${orderId}"]`);
  if (orderCard) {
    orderCard.querySelectorAll('.check-line').forEach(line => {
      const lineIdx = parseInt(line.dataset.line);
      const data = allOrderChecks[orderId][lineIdx] || {};
      const ordBox = line.querySelector('.check-ordered');
      const prepBox = line.querySelector('.check-prepared');
      const text = line.querySelector('.check-text');
      if (ordBox) ordBox.classList.toggle('checked', !!data.checked);
      if (prepBox) prepBox.classList.toggle('checked', !!data.prepared);
      if (text) text.classList.toggle('all-done', !!data.checked && !!data.prepared);
    });
    updateOrderProgress(orderId);
    refreshOrderCardState(orderId);
  }
  
  try {
    await authenticatedFetch(`${API_URL}/fabbisogno-checks/set-all/${orderId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Errore applicazione goods_type alle spunte:', error);
  }
}

// Toggle check su riga ordine (ordinato o preparato)
// Logica coerente:
//   - Spunta PREPARATO su una riga → imposta anche ORDINATO (se preparato => necessariamente ordinato)
//   - Tolta ORDINATO su una riga con preparato attivo → toglie anche PREPARATO
async function toggleOrderLineCheck(orderId, lineNumber, clickedElement) {
  const checkBox = clickedElement.closest('.check-box');
  if (!checkBox) return;
  
  const type = checkBox.dataset.type;
  const isCurrentlyChecked = checkBox.classList.contains('checked');
  const newChecked = !isCurrentlyChecked;
  
  const checkLine = checkBox.closest('.check-line');
  const orderedBox = checkLine.querySelector('.check-ordered');
  const preparedBox = checkLine.querySelector('.check-prepared');
  
  // Stato iniziale per eventuale rollback
  const prevOrdered = orderedBox && orderedBox.classList.contains('checked');
  const prevPrepared = preparedBox && preparedBox.classList.contains('checked');
  
  // Calcolo nuovi stati applicando la logica di coerenza
  let newOrdered = prevOrdered;
  let newPrepared = prevPrepared;
  
  if (type === 'prepared') {
    newPrepared = newChecked;
    // Se stiamo attivando preparato, attiva anche ordinato
    if (newChecked && !newOrdered) newOrdered = true;
  } else { // type === 'ordered'
    newOrdered = newChecked;
    // Se stiamo togliendo ordinato, togli anche preparato
    if (!newChecked && newPrepared) newPrepared = false;
  }
  
  // Optimistic UI
  if (orderedBox) orderedBox.classList.toggle('checked', newOrdered);
  if (preparedBox) preparedBox.classList.toggle('checked', newPrepared);
  const textEl = checkLine.querySelector('.check-text');
  if (textEl) textEl.classList.toggle('all-done', newOrdered && newPrepared);
  
  try {
    // Invia in parallelo solo i campi effettivamente cambiati
    const requests = [];
    if (newOrdered !== prevOrdered) {
      requests.push(authenticatedFetch(`${API_URL}/fabbisogno-checks/${orderId}/${lineNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: newOrdered })
      }));
    }
    if (newPrepared !== prevPrepared) {
      requests.push(authenticatedFetch(`${API_URL}/fabbisogno-checks/${orderId}/${lineNumber}/prepared`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prepared: newPrepared })
      }));
    }
    await Promise.all(requests);
    
    // Aggiorna cache locale
    if (!allOrderChecks[orderId]) allOrderChecks[orderId] = {};
    if (!allOrderChecks[orderId][lineNumber]) allOrderChecks[orderId][lineNumber] = { checked: false, prepared: false };
    allOrderChecks[orderId][lineNumber].checked = newOrdered;
    allOrderChecks[orderId][lineNumber].prepared = newPrepared;
    
    updateOrderProgress(orderId);
    refreshOrderCardState(orderId);
  } catch (error) {
    console.error('Errore salvataggio check:', error);
    // Rollback
    if (orderedBox) orderedBox.classList.toggle('checked', prevOrdered);
    if (preparedBox) preparedBox.classList.toggle('checked', prevPrepared);
    if (textEl) textEl.classList.toggle('all-done', prevOrdered && prevPrepared);
  }
}

// Toggle provenienza (IMPORT / ITA / NL) su una riga
async function toggleOrderLineSupplier(orderId, lineNumber, supplier, btnEl) {
  const group = btnEl.closest('.supplier-group');
  if (!group) return;
  
  const wasActive = btnEl.classList.contains('active');
  const newSupplier = wasActive ? '' : supplier;
  
  // Optimistic UI: deseleziona tutti, poi seleziona (se non era già attivo)
  const prevState = {};
  group.querySelectorAll('.supplier-btn').forEach(b => {
    prevState[b.dataset.supplier] = b.classList.contains('active');
    b.classList.remove('active');
  });
  if (!wasActive) btnEl.classList.add('active');
  
  try {
    await authenticatedFetch(`${API_URL}/fabbisogno-checks/${orderId}/${lineNumber}/supplier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier: newSupplier })
    });
    
    // Aggiorna cache locale
    if (!allOrderChecks[orderId]) allOrderChecks[orderId] = {};
    if (!allOrderChecks[orderId][lineNumber]) {
      allOrderChecks[orderId][lineNumber] = { checked: false, prepared: false, supplier: '' };
    }
    allOrderChecks[orderId][lineNumber].supplier = newSupplier;
  } catch (error) {
    console.error('Errore salvataggio provenienza:', error);
    // Rollback
    group.querySelectorAll('.supplier-btn').forEach(b => {
      b.classList.toggle('active', !!prevState[b.dataset.supplier]);
    });
  }
}

// Renderizza le pillole dei prossimi 7 giorni (escluso il corrente: è sempre attivo)
function renderDaysSelector() {
  const container = document.getElementById('days-selector-chips');
  if (!container || !currentDate) return;
  
  const current = new Date(currentDate + 'T00:00:00');
  const dayNames = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];
  const monthNames = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  
  // Oggi (fissa, sempre attiva)
  const todayChip = `
    <button type="button" class="day-chip day-chip-current active" disabled title="Giorno aperto, sempre incluso">
      <span class="day-chip-name">${dayNames[current.getDay()]}</span>
      <span class="day-chip-num">${current.getDate()}</span>
    </button>
  `;
  
  // Prossimi 6 giorni
  let chipsHtml = todayChip;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(current);
    d.setDate(d.getDate() + i);
    const iso = formatDate(d);
    const isActive = selectedExtraDays.has(iso);
    const isLoading = extraDayOrders[iso] === 'loading';
    
    chipsHtml += `
      <button type="button" class="day-chip ${isActive ? 'active' : ''} ${isLoading ? 'loading' : ''}" data-date="${iso}" title="${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]}">
        <span class="day-chip-name">${dayNames[d.getDay()]}</span>
        <span class="day-chip-num">${d.getDate()}</span>
        <span class="day-chip-month">${monthNames[d.getMonth()]}</span>
      </button>
    `;
  }
  
  container.innerHTML = chipsHtml;
  
  // Bind click
  container.querySelectorAll('.day-chip[data-date]').forEach(chip => {
    chip.addEventListener('click', () => {
      const iso = chip.dataset.date;
      toggleExtraDay(iso);
    });
  });
  
  // Aggiorna indicatore sulla copy-bar
  updateCopyBarInfo();
}

// Toggle selezione di un giorno extra (carica ordini+checks se necessario)
async function toggleExtraDay(iso) {
  if (selectedExtraDays.has(iso)) {
    // Deselezione: rimuovi gli ordini di quel giorno dai checks unificati
    selectedExtraDays.delete(iso);
    const orders = extraDayOrders[iso];
    if (Array.isArray(orders)) {
      orders.forEach(o => { delete allOrderChecks[o.id]; });
    }
    renderDaysSelector();
    renderOrdersView();
    return;
  }
  
  selectedExtraDays.add(iso);
  
  // Se già in cache, unisci e rerender
  if (Array.isArray(extraDayOrders[iso])) {
    mergeExtraChecksIntoAll(iso);
    renderDaysSelector();
    renderOrdersView();
    return;
  }
  
  // Carica ordini + checks di quel giorno
  extraDayOrders[iso] = 'loading';
  renderDaysSelector();
  
  try {
    const response = await fetchNoCache(`${API_URL}/orders/date/${iso}`);
    const orders = await response.json();
    extraDayOrders[iso] = orders;
    
    if (orders.length > 0) {
      const ids = orders.map(o => o.id).join(',');
      const checksResponse = await fetchNoCache(`${API_URL}/fabbisogno-checks/batch/${ids}`);
      extraDayChecks[iso] = await checksResponse.json();
    } else {
      extraDayChecks[iso] = {};
    }
    
    mergeExtraChecksIntoAll(iso);
  } catch (e) {
    console.error('[EXTRA-DAY] Errore caricamento', iso, e);
    extraDayOrders[iso] = [];
    extraDayChecks[iso] = {};
    selectedExtraDays.delete(iso);
    showToast('Errore caricamento ordini di quel giorno', 'error');
  }
  
  renderDaysSelector();
  renderOrdersView();
}

// Unisce i checks di un giorno extra dentro allOrderChecks (gli id sono univoci)
function mergeExtraChecksIntoAll(iso) {
  const extraChecks = extraDayChecks[iso] || {};
  Object.keys(extraChecks).forEach(orderId => {
    allOrderChecks[orderId] = extraChecks[orderId];
  });
}

// Cerca un ordine visualizzato (giorno corrente o extra)
function findDisplayedOrder(orderId) {
  const id = parseInt(orderId);
  const inCurrent = (currentDayOrders || []).find(o => o.id === id);
  if (inCurrent) return inCurrent;
  for (const iso of selectedExtraDays) {
    const list = extraDayOrders[iso];
    if (Array.isArray(list)) {
      const found = list.find(o => o.id === id);
      if (found) return found;
    }
  }
  return null;
}

// Aggiorna badge con numero di giorni inclusi nella barra copia
function updateCopyBarInfo() {
  const badge = document.getElementById('orders-toolbar-days-badge');
  if (!badge) return;
  
  const totalDays = 1 + selectedExtraDays.size;
  if (totalDays > 1) {
    badge.textContent = `${totalDays} giorni`;
    badge.hidden = false;
  } else {
    badge.textContent = '';
    badge.hidden = true;
  }
}

// Raccoglie tutti gli (order, checks) da considerare: giorno corrente + extra selezionati
function collectOrdersAndChecks() {
  const items = [];
  
  (currentDayOrders || []).forEach(order => {
    items.push({ order, checks: allOrderChecks[order.id] || {} });
  });
  
  selectedExtraDays.forEach(iso => {
    const orders = extraDayOrders[iso];
    if (!orders || orders === 'loading') return;
    const checksByOrder = extraDayChecks[iso] || {};
    orders.forEach(order => {
      items.push({ order, checks: checksByOrder[order.id] || {} });
    });
  });
  
  return items;
}

// Copia negli appunti gli articoli di un fornitore (solo quelli NON ancora ordinati)
// supplier può essere 'IMPORT' | 'ITA' | 'NL' | '__UNASSIGNED__'
function copySupplierItems(supplier) {
  console.log('[COPY] Richiesta copia per:', supplier, '| Giorni extra:', [...selectedExtraDays]);
  
  const lines = [];
  let unassignedCount = 0;
  const isUnassignedMode = supplier === '__UNASSIGNED__';
  
  const pool = collectOrdersAndChecks();
  
  pool.forEach(({ order, checks }) => {
    if (!order.description) return;
    const orderLines = order.description.split('\n').filter(l => l.trim() !== '');
    
    orderLines.forEach((line, index) => {
      const data = checks[index] || {};
      const rowSupplier = (data.supplier || '').toUpperCase();
      const isOrdered = data.checked === true;
      
      if (isOrdered) return;
      
      if (!rowSupplier) unassignedCount++;
      
      if (isUnassignedMode) {
        if (!rowSupplier) lines.push(line.trim());
      } else {
        if (rowSupplier === supplier) lines.push(line.trim());
      }
    });
  });
  
  console.log('[COPY] Trovati', lines.length, 'articoli su', pool.length, 'ordini');
  
  if (lines.length === 0) {
    if (isUnassignedMode) {
      showToast('Tutti gli articoli hanno già una provenienza', 'info');
    } else if (unassignedCount > 0) {
      showToast(`0 articoli ${supplier} - ${unassignedCount} senza provenienza. Usa "ALTRI".`, 'info');
    } else {
      showToast(`Nessun articolo da ordinare per ${supplier}`, 'info');
    }
    return;
  }
  
  const label = isUnassignedMode ? 'SENZA PROVENIENZA' : supplier;
  const daysCount = 1 + selectedExtraDays.size;
  showCopyModal(label, lines, daysCount);
}

// Modal anteprima/copia: mostra testo, prova copia automatica, fallback manuale
function showCopyModal(label, lines, daysCount = 1) {
  const text = lines.join('\n');
  const daysBadge = daysCount > 1 ? `<span class="copy-modal-days-badge">${daysCount} giorni</span>` : '';
  
  // Rimuovi modal precedente se esiste
  const existing = document.getElementById('copy-preview-modal');
  if (existing) existing.remove();
  
  const modal = document.createElement('div');
  modal.id = 'copy-preview-modal';
  modal.className = 'modal active copy-preview-modal';
  modal.innerHTML = `
    <div class="modal-content copy-preview-content">
      <div class="copy-preview-header">
        <h2>COPIA ${label}</h2>
        <button type="button" class="btn-close copy-preview-x" aria-label="Chiudi">&times;</button>
      </div>
      <div class="copy-preview-body">
        <p class="copy-preview-info">
          <strong>${lines.length}</strong> articoli da ordinare ${daysBadge}
        </p>
        <textarea class="copy-preview-textarea" readonly spellcheck="false">${text.replace(/</g, '&lt;')}</textarea>
        <div class="copy-preview-status" id="copy-preview-status"></div>
      </div>
      <div class="copy-preview-footer">
        <button type="button" class="btn-secondary copy-preview-close">Chiudi</button>
        <button type="button" class="btn-primary copy-preview-copy">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          COPIA
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const textarea = modal.querySelector('.copy-preview-textarea');
  const statusEl = modal.querySelector('#copy-preview-status');
  const btnCopy = modal.querySelector('.copy-preview-copy');
  const btnClose = modal.querySelector('.copy-preview-close');
  const btnX = modal.querySelector('.copy-preview-x');
  
  const closeModal = () => {
    modal.classList.remove('active');
    setTimeout(() => modal.remove(), 200);
  };
  
  btnClose.addEventListener('click', closeModal);
  btnX.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // Auto-seleziona il testo (utile per copia manuale rapida)
  setTimeout(() => {
    textarea.focus();
    textarea.select();
  }, 100);
  
  // Tenta copia automatica all'apertura (senza await per non perdere user gesture)
  tryCopy(text).then(ok => {
    if (ok) {
      statusEl.textContent = '✓ Copiato automaticamente';
      statusEl.className = 'copy-preview-status success';
    }
  });
  
  // Bottone COPIA: ritenta la copia (user gesture fresco)
  btnCopy.addEventListener('click', async () => {
    const ok = await tryCopy(text, textarea);
    if (ok) {
      statusEl.textContent = `✓ Copiati ${lines.length} articoli`;
      statusEl.className = 'copy-preview-status success';
      btnCopy.classList.add('copied');
      setTimeout(() => {
        closeModal();
      }, 800);
    } else {
      statusEl.textContent = '⚠ Copia automatica non riuscita. Seleziona manualmente il testo e premi Cmd/Ctrl+C.';
      statusEl.className = 'copy-preview-status error';
      textarea.focus();
      textarea.select();
    }
  });
}

// Tenta copia con Clipboard API + fallback execCommand
async function tryCopy(text, textareaEl) {
  // 1) Clipboard API moderna
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      console.log('[COPY] Clipboard API OK');
      return true;
    } catch (e) {
      console.warn('[COPY] Clipboard API fallita:', e);
    }
  }
  
  // 2) Fallback execCommand con textarea esistente o temporanea
  try {
    const ta = textareaEl || (() => {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.position = 'fixed';
      t.style.top = '0';
      t.style.left = '0';
      t.style.opacity = '0';
      document.body.appendChild(t);
      return t;
    })();
    
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    
    const ok = document.execCommand('copy');
    console.log('[COPY] execCommand:', ok);
    
    if (!textareaEl) document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.error('[COPY] execCommand fallito:', e);
    return false;
  }
}

// Mini toast (se non esiste già un helper analogo, crea uno qui)
function showToast(message, type = 'info') {
  let toast = document.getElementById('mini-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'mini-toast';
    toast.className = 'mini-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `mini-toast show ${type}`;
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

// Goods type è sempre "da_ordinare" per nuovi ordini, può diventare "ordinata" dopo

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
  goodsTypeDirty = false;
  
  document.getElementById('modal-title').textContent = 'Nuovo ordine';
  document.getElementById('order-form').reset();
  document.getElementById('order-id').value = '';
  document.getElementById('order-date').value = currentDate;
  document.getElementById('order-status').value = 'da_preparare';
  document.getElementById('goods-type').value = GOODS_TYPE.DA_ORDINARE; // Default: "da ordinare"
  
  // Imposta bottoni disponibilità (default: da ordinare)
  document.querySelectorAll('.btn-goods').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-goods') === GOODS_TYPE.DA_ORDINARE);
  });
  
  document.getElementById('btn-delete-order').style.display = 'none';
  
  renderPhotoPreview();
  modalOrder.classList.add('active');
}

// Apri modal modifica ordine
function openEditOrderModal(order) {
  currentOrderId = order.id;
  currentEditOrder = order;
  uploadedPhotos = order.photos || [];
  goodsTypeDirty = false;
  
  document.getElementById('modal-title').textContent = 'Modifica ordine';
  document.getElementById('order-id').value = order.id;
  document.getElementById('order-date').value = order.date;
  document.getElementById('order-customer').value = order.customer;
  document.getElementById('order-description').value = order.description;
  document.getElementById('order-status').value = order.status;
  
  const goodsType = order.goods_type || GOODS_TYPE.DA_ORDINARE;
  document.getElementById('goods-type').value = goodsType;
  
  // Imposta bottoni disponibilità
  document.querySelectorAll('.btn-goods').forEach(btn => {
    const btnValue = btn.getAttribute('data-goods');
    // Se l'ordine è "ordinata", mostra come "in_cella" (pronto)
    const displayValue = (goodsType === GOODS_TYPE.ORDINATA) ? GOODS_TYPE.IN_CELLA : goodsType;
    btn.classList.toggle('active', btnValue === displayValue);
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
  const goodsType = document.getElementById('goods-type').value;
  
  // LOGICA STATO: se merce è "pronto" → stato "pronto", altrimenti "da_preparare"
  const status = (goodsType === GOODS_TYPE.IN_CELLA) 
    ? ORDER_STATUS.PRONTO 
    : ORDER_STATUS.DA_PREPARARE;
  
  // Solo cliente, merce e giorno sono obbligatori
  if (!customer || !description) {
    alert('Compila i campi obbligatori: Cliente e Merce');
    return;
  }
  
  const orderData = {
    customer,
    description,
    status,
    goods_type: goodsType,
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
    if (orderId) {
      // Aggiorna ordine esistente
      await authenticatedFetch(`${API_URL}/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, date })
      });
      
      // Se la disponibilità è stata cambiata, sincronizza le spunte
      if (goodsTypeDirty) {
        const totalLines = description.split('\n').filter(l => l.trim() !== '').length;
        if (totalLines > 0) {
          await applyGoodsTypeToChecks(parseInt(orderId), goodsType, totalLines);
        }
      }
      
      // Notifica modifica
      if (Notification.permission === 'granted') {
        try {
          const registration = await navigator.serviceWorker.ready;
          registration.showNotification('✏️ Ordine Modificato', {
            body: `${customer} - ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`,
            icon: '/icon-192.png',
            tag: 'order-updated-' + orderId,
            vibrate: [200]
          });
        } catch (e) {
          console.log('Notifica non inviata:', e);
        }
      }
    } else {
      // Crea nuovo ordine
      const createRes = await authenticatedFetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...orderData, date })
      });
      
      // Se la disponibilità è diversa da "da_ordinare", sincronizza le spunte sul nuovo ordine
      if (goodsType !== GOODS_TYPE.DA_ORDINARE && createRes && createRes.ok) {
        try {
          const newOrder = await createRes.json();
          const totalLines = description.split('\n').filter(l => l.trim() !== '').length;
          if (newOrder && newOrder.id && totalLines > 0) {
            await applyGoodsTypeToChecks(newOrder.id, goodsType, totalLines);
          }
        } catch (e) { /* no-op */ }
      }
      
      // Notifica creazione
      if (Notification.permission === 'granted') {
        try {
          const registration = await navigator.serviceWorker.ready;
          registration.showNotification('✅ Nuovo Ordine Creato', {
            body: `${customer} - ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`,
            icon: '/icon-192.png',
            tag: 'order-created',
            vibrate: [200, 100, 200]
          });
        } catch (e) {
          console.log('Notifica non inviata:', e);
        }
      }
    }
    
    // Switcha alla data dell'ordine salvato e ricarica
    currentDate = date;
    await loadOrders(date);
    await loadCalendar(true);
  } catch (error) {
    console.error('❌ Errore salvataggio ordine:', error);
    alert('Errore nel salvataggio dell\'ordine: ' + error.message);
  }
}

// Aggiorna solo stato ordine
async function updateOrderStatus(orderId, status) {
  calendarCache = null;
  calendarCacheTime = 0;
  
  // OPTIMISTIC UI: aggiorna subito la card visivamente
  const orderCard = ordersList.querySelector(`.order-card[data-order-id="${orderId}"]`) ||
    [...ordersList.querySelectorAll('.order-card')].find(card => {
      const btn = card.querySelector(`[data-id="${orderId}"]`);
      return btn !== null;
    });
  if (orderCard) {
    orderCard.className = `order-card status-${status}`;
    orderCard.style.opacity = '0.6';
    orderCard.style.transition = 'opacity 0.2s';
    const badge = orderCard.querySelector('.order-status-badge');
    if (badge) {
      badge.className = `order-status-badge ${status}`;
      badge.textContent = ORDER_STATUS_LABELS[status] || status;
    }
    // Se pronto/ritirato, spunta subito tutte le checkbox visivamente
    if (status === 'pronto' || status === 'ritirato') {
      orderCard.querySelectorAll('.check-box:not(.checked)').forEach(box => {
        box.classList.add('checked');
        box.textContent = '✓';
      });
      orderCard.querySelectorAll('.check-text').forEach(text => {
        text.classList.add('all-done');
      });
    }
  }
  
  try {
    // Chiamata principale (status) + auto-check in parallelo
    const statusPromise = authenticatedFetch(`${API_URL}/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    
    let checkPromise = Promise.resolve();
    if (status === 'pronto' || status === 'ritirato') {
      const order = findDisplayedOrder(orderId);
      if (order && order.description) {
        const totalLines = order.description.split('\n').filter(l => l.trim() !== '').length;
        if (totalLines > 0) {
          checkPromise = Promise.all([
            authenticatedFetch(`${API_URL}/fabbisogno-checks/check-all/${orderId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ totalLines, type: 'checked' })
            }),
            authenticatedFetch(`${API_URL}/fabbisogno-checks/check-all/${orderId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ totalLines, type: 'prepared' })
            })
          ]).catch(e => console.log('Auto-check non riuscito:', e));
        }
      }
    }
    
    // Esegui entrambe in parallelo
    await Promise.all([statusPromise, checkPromise]);
    
    // Ricarica ordini e calendario in parallelo
    await Promise.all([
      loadOrders(currentDate),
      loadCalendar(true)
    ]);

    // Notifica in background (non bloccante)
    if (Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then(registration => {
        const statusLabels = {
          'da_preparare': '🟠 Da Preparare',
          'pronto': '✅ Pronto',
          'ritirato': '📦 Ritirato'
        };
        registration.showNotification('🔄 Stato Ordine Aggiornato', {
          body: `Nuovo stato: ${statusLabels[status] || status}`,
          icon: '/icon-192.png',
          tag: 'status-changed-' + orderId,
          vibrate: [100]
        });
      }).catch(() => {});
    }
  } catch (error) {
    console.error('❌ Errore aggiornamento stato:', error);
    alert('Errore nell\'aggiornamento dello stato: ' + error.message);
    // Rollback: ricarica per stato corretto
    await loadOrders(currentDate);
  }
}

// Elimina ordine
async function handleOrderDelete() {
  if (!currentOrderId) return;

  modalConfirm.classList.remove('active');

  calendarCache = null;
  calendarCacheTime = 0;

  try {
    await authenticatedFetch(`${API_URL}/orders/${currentOrderId}`, {
      method: 'DELETE'
    });
    
    // Notifica eliminazione
    if (Notification.permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification('🗑️ Ordine Eliminato', {
          body: 'L\'ordine è stato eliminato con successo',
          icon: '/icon-192.png',
          tag: 'order-deleted-' + currentOrderId,
          vibrate: [100, 50, 100]
        });
      } catch (e) {
        console.log('Notifica non inviata:', e);
      }
    }

    await loadOrders(currentDate);
    await loadCalendar(true);
  } catch (error) {
    console.error('❌ Errore eliminazione ordine:', error);
    alert('Errore nell\'eliminazione dell\'ordine: ' + error.message);
  }
}

// Cambia pagina
function showPage(page) {
  pageCalendar.classList.remove('active');
  pageOrders.classList.remove('active');
  pageListini.classList.remove('active');
  if (pagePreventivi) pagePreventivi.classList.remove('active');
  if (pageClienti) pageClienti.classList.remove('active');
  if (pageCatalogo) pageCatalogo.classList.remove('active');
  
  if (page === 'calendar') {
    pageCalendar.classList.add('active');
  } else if (page === 'orders') {
    pageOrders.classList.add('active');
  } else if (page === 'listini') {
    pageListini.classList.add('active');
  } else if (page === 'preventivi') {
    if (pagePreventivi) pagePreventivi.classList.add('active');
  } else if (page === 'clienti') {
    if (pageClienti) pageClienti.classList.add('active');
  } else if (page === 'catalogo') {
    if (pageCatalogo) pageCatalogo.classList.add('active');
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
  // Verifica supporto notifiche
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('⚠️ Notifiche push non supportate su questo browser');
    return;
  }

  try {
    // AUTO-RIREGISTRAZIONE: Se già autorizzato, rinnova subscription (anche se scaduta)
    if (Notification.permission === 'granted') {
      await registerPushSubscription();
      console.log('✓ Notifiche push auto-registrate');
      return;
    }

    // Se rifiutato, non fare nulla
    if (Notification.permission === 'denied') {
      console.log('⚠️ Notifiche negate dall\'utente');
      return;
    }

    // Se non ancora richiesto (default), chiedi automaticamente dopo 10 secondi
    if (!manualRequest) {
      setTimeout(async () => {
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            await registerPushSubscription();
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification('🔔 Notifiche Attivate', {
              body: 'Riceverai un avviso ogni mattina alle 6:30 per gli ordini del giorno',
              icon: '/icon-192.png',
              vibrate: [200, 100, 200]
            });
            console.log('✓ Notifiche attivate automaticamente');
          }
        } catch (e) {
          console.log('Richiesta notifiche annullata o errore:', e);
        }
      }, 10000); // 10 secondi dopo l'avvio
    }
  } catch (error) {
    console.error('Errore permessi notifiche:', error);
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
      // Singolo giorno - sempre dati freschi
      const response = await fetchNoCache(`${API_URL}/orders/date/${dateFrom}`);
      allOrders = await response.json();
    } else {
      // Range di date - sempre dati freschi
      const response = await fetchNoCache(`${API_URL}/orders/date-range?from=${dateFrom}&to=${dateToUse}`);
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
    fabbisognoEmpty.style.display = 'flex';
    fabbisognoList.style.display = 'none';
    
    // Aggiorna messaggio in base al contesto
    const emptyP = fabbisognoEmpty.querySelector('p:first-of-type');
    const emptySubtitle = fabbisognoEmpty.querySelector('.empty-subtitle');
    
    if (emptyP && emptySubtitle) {
      if (totalOrders === 0) {
        emptyP.textContent = '📭 Nessun ordine per questo periodo';
        emptySubtitle.textContent = '';
      } else {
        emptyP.textContent = '✅ Nessuna merce da ordinare';
        emptySubtitle.textContent = 'Tutta la merce è già disponibile o ordinata';
      }
    }
    return;
  }
  
  fabbisognoEmpty.style.display = 'none';
  fabbisognoList.style.display = 'flex';
  
  // Determina se è multi-day (serve dopo)
  const isMultiDay = dateFrom !== dateTo;
  
  // Aggiorna titolo con conteggio (opzionale, il titolo è ora fisso nell'header)
  const title = document.getElementById('fabbisogno-title');
  if (title) {
    if (isMultiDay) {
      const fromFormatted = formatDateItalian(dateFrom);
      const toFormatted = formatDateItalian(dateTo);
      title.innerHTML = `Fabbisogno ${fromFormatted} - ${toFormatted} <span style="color: #F97316; font-weight: 700;">(${orders.length})</span>`;
    } else {
      title.innerHTML = `Fabbisogno <span style="color: #F97316; font-weight: 700;">(${orders.length})</span>`;
    }
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
    
    // Fetch senza cache - sempre dati freschi
    const response = await fetchNoCache(`${API_URL}/fabbisogno-checks/${orderId}`);
    const checks = await response.json();
    
    // Per ogni checkbox dell'ordine
    const checkboxes = document.querySelectorAll(`.fabbisogno-checkbox[data-order-id="${orderId}"]`);
    
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
    // Ottieni dati ordine per notifica (dal DOM o API)
    let customerName = 'Ordine';
    const orderElement = button ? button.closest('.fabbisogno-item') : null;
    if (orderElement) {
      const customerEl = orderElement.querySelector('.fabbisogno-customer');
      if (customerEl) {
        customerName = customerEl.textContent.trim();
      }
    }
    
    await authenticatedFetch(`${API_URL}/orders/${orderId}/goods-type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goods_type: GOODS_TYPE.ORDINATA })
    });
    
    // Notifica merce ordinata
    if (Notification.permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.ready;
        registration.showNotification('📦 Merce Ordinata', {
          body: `${customerName} - Segnata come ordinata`,
          icon: '/icon-192.png',
          tag: 'order-marked-' + orderId,
          vibrate: [200, 100, 200]
        });
      } catch (e) {
        console.log('Notifica non inviata:', e);
      }
    }
    
    await loadCalendar(true);
    if (currentDate) {
      await loadOrders(currentDate);
    }
    
    // Ricarica fabbisogno per aggiornare la lista
    if (currentFabbisognoDate) {
      await openFabbisognoModal(currentFabbisognoDate, currentFabbisognoDateTo);
    }
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
      </div>
    </div>
  `;
  
  // INFO DISPONIBILITÀ (solo a schermo)
  if (order.goods_type) {
    html += `<div class="detail-section detail-info no-print">`;
    html += `<div class="detail-info-grid">`;
    
    // Disponibilità merce
    if (order.goods_type) {
      html += `
        <div class="detail-info-item">
          <span class="detail-info-label">Disponibilità</span>
          <span class="detail-info-value">${GOODS_TYPE_LABELS[order.goods_type] || order.goods_type}</span>
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
          // Ricarica l'ordine aggiornato - sempre dati freschi
          const response = await fetchNoCache(`${API_URL}/orders/${order.id}`);
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
  
  // Disponibilità merce
  if (order.goods_type === GOODS_TYPE.DA_ORDINARE) {
    message += `⚠️ *Merce da ordinare*\n\n`;
  } else if (order.goods_type === GOODS_TYPE.ORDINATA) {
    message += `✅ *Merce ordinata*\n\n`;
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

// ===========================
// ORDINI FISSI (Ricorrenti)
// ===========================

function openOrdineFissoModal() {
  fissoSelectedDates.clear();
  fissoCurrentMonth = new Date();
  
  document.getElementById('fisso-customer').value = '';
  document.getElementById('fisso-description').value = '';
  
  renderFissoCalendar();
  document.getElementById('modal-ordine-fisso').classList.add('active');
}

function closeOrdineFissoModal() {
  document.getElementById('modal-ordine-fisso').classList.remove('active');
  fissoSelectedDates.clear();
}

function renderFissoCalendar() {
  const year = fissoCurrentMonth.getFullYear();
  const month = fissoCurrentMonth.getMonth();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  
  // Aggiorna header mese/anno
  const monthNames = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  document.getElementById('fisso-month-year').textContent = `${monthNames[month]} ${year}`;
  
  const calendar = document.getElementById('fisso-calendar');
  calendar.innerHTML = '';
  
  // Header giorni della settimana
  const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  dayNames.forEach(name => {
    const header = document.createElement('div');
    header.className = 'fisso-calendar-day-header';
    header.textContent = name;
    calendar.appendChild(header);
  });
  
  // Padding giorni iniziali
  const firstDayOfWeek = firstDay.getDay();
  for (let i = 0; i < firstDayOfWeek; i++) {
    const empty = document.createElement('div');
    calendar.appendChild(empty);
  }
  
  // Giorni del mese
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDate(date);
    const isPast = date < today;
    
    const dayEl = document.createElement('div');
    dayEl.className = 'fisso-day';
    if (isPast) dayEl.classList.add('disabled');
    if (fissoSelectedDates.has(dateStr)) dayEl.classList.add('selected');
    
    dayEl.innerHTML = `
      <div class="fisso-day-num">${day}</div>
    `;
    
    if (!isPast) {
      dayEl.addEventListener('click', () => {
        if (fissoSelectedDates.has(dateStr)) {
          fissoSelectedDates.delete(dateStr);
        } else {
          fissoSelectedDates.add(dateStr);
        }
        updateFissoCalendar();
      });
    }
    
    calendar.appendChild(dayEl);
  }
  
  updateFissoCalendar();
}

function updateFissoCalendar() {
  // Aggiorna contatore
  document.getElementById('selected-dates-count').textContent = 
    `${fissoSelectedDates.size} date selezionate`;
  
  // Aggiorna classi selected
  const allDays = document.querySelectorAll('.fisso-day:not(.disabled)');
  allDays.forEach(dayEl => {
    const dayNum = parseInt(dayEl.querySelector('.fisso-day-num').textContent);
    const date = new Date(fissoCurrentMonth.getFullYear(), fissoCurrentMonth.getMonth(), dayNum);
    const dateStr = formatDate(date);
    dayEl.classList.toggle('selected', fissoSelectedDates.has(dateStr));
  });
}

async function handleOrdineFissoSubmit(e) {
  e.preventDefault();
  
  const customer = document.getElementById('fisso-customer').value.trim();
  const description = document.getElementById('fisso-description').value.trim();
  
  if (!customer || !description) {
    alert('Compila i campi obbligatori: Cliente e Merce');
    return;
  }
  
  if (fissoSelectedDates.size === 0) {
    alert('Seleziona almeno una data dal calendario');
    return;
  }
  
  // Conferma
  const datesCount = fissoSelectedDates.size;
  const datesArray = Array.from(fissoSelectedDates).sort();
  console.log(`📅 ORDINI FISSI: Creazione di ${datesCount} ordini per le date:`, datesArray);
  
  if (!confirm(`Confermi la creazione di ${datesCount} ordini "Da ordinare" per le date selezionate?`)) {
    return;
  }
  
  closeOrdineFissoModal();
  
  // Ordini fissi sono SEMPRE "da_ordinare" e "da_preparare"
  const goodsType = GOODS_TYPE.DA_ORDINARE;
  const status = ORDER_STATUS.DA_PREPARARE;
  
  try {
    console.log('🔄 Inizio creazione ordini fissi...');
    
    // Crea ordini per ogni data selezionata
    const promises = datesArray.map(async (date) => {
      console.log(`📤 Invio ordine per data: ${date}`);
      const response = await authenticatedFetch(`${API_URL}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          customer,
          description,
          status,
          goods_type: goodsType,
          photos: []
        })
      });
      
      if (!response.ok) {
        throw new Error(`Errore HTTP ${response.status} per data ${date}`);
      }
      
      const result = await response.json();
      console.log(`✅ Ordine creato per ${date}:`, result);
      return result;
    });
    
    const results = await Promise.all(promises);
    console.log(`✅ Tutti i ${results.length} ordini creati con successo!`, results);
    
    // Invalida cache e ricarica calendario
    console.log('🔄 Ricarico calendario...');
    calendarCache = null;
    calendarCacheTime = 0;
    await loadCalendar(true);
    console.log('✅ Calendario ricaricato!');
    
    alert(`✅ Creati ${datesCount} ordini con successo!\nPuoi modificarli singolarmente dal calendario.`);
  } catch (error) {
    console.error('❌ Errore creazione ordini fissi:', error);
    alert('Errore nella creazione degli ordini: ' + error.message);
  }
}

// ============================================
// PAGINA LISTINI
// ============================================

function openListiniPage() {
  showPage('listini');
  loadListini();
  
  // Aggiorna username
  const usernameEl = document.getElementById('username-display-listini');
  if (usernameEl) {
    usernameEl.textContent = currentUser;
  }
}

async function loadListini() {
  try {
    const response = await authenticatedFetch(API_URL + '/listini');
    const listini = await response.json();
    
    const listiniList = document.getElementById('listini-list');
    const listiniEmpty = document.getElementById('listini-empty');
    
    if (listini.length === 0) {
      listiniList.style.display = 'none';
      listiniEmpty.style.display = 'block';
      return;
    }
    
    listiniList.style.display = 'flex';
    listiniEmpty.style.display = 'none';
    listiniList.innerHTML = '';
    
    listini.forEach(listino => {
      const item = document.createElement('div');
      item.className = 'listino-item';
      item.innerHTML = `
        <div class="listino-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="listino-info">
          <div class="listino-name">${listino.name}</div>
          <div class="listino-meta">Caricato il ${formatDate(new Date(listino.uploaded_at))} da ${listino.uploaded_by}</div>
        </div>
        <div class="listino-actions">
          <button class="btn-listino-action btn-view-listino" onclick="viewListino('${listino.filename}')" title="Visualizza PDF">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="btn-listino-action btn-delete-listino" onclick="deleteListino(${listino.id}, '${listino.name}')" title="Elimina">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
      listiniList.appendChild(item);
    });
  } catch (error) {
    console.error('Errore caricamento listini:', error);
    showNotification('Errore nel caricamento dei listini', 'error');
  }
}

async function handleListinoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  if (file.type !== 'application/pdf') {
    showNotification('Solo file PDF sono permessi', 'error');
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) { // 10MB max
    showNotification('File troppo grande (max 10MB)', 'error');
    return;
  }
  
  const formData = new FormData();
  formData.append('pdf', file);
  formData.append('uploaded_by', currentUser);
  
  try {
    const response = await fetch(API_URL + '/listini/upload', {
      method: 'POST',
      headers: {
        'x-user': currentUser
      },
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Errore upload');
    }
    
    showNotification('Listino caricato con successo!', 'success');
    loadListini();
    
    // Reset input
    event.target.value = '';
  } catch (error) {
    console.error('Errore upload listino:', error);
    showNotification('Errore nel caricamento del listino', 'error');
  }
}

function viewListino(filename) {
  window.open(API_URL + '/listini/view/' + filename, '_blank');
}

async function deleteListino(id, name) {
  if (!confirm(`Eliminare il listino "${name}"?`)) {
    return;
  }
  
  try {
    const response = await authenticatedFetch(API_URL + '/listini/' + id, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Errore eliminazione');
    }
    
    showNotification('Listino eliminato', 'success');
    loadListini();
  } catch (error) {
    console.error('Errore eliminazione listino:', error);
    showNotification('Errore nell\'eliminazione del listino', 'error');
  }
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

// Funzione di debug per verificare stato notifiche
async function checkNotifications() {
  try {
    console.log('🔔 Verifica stato notifiche...\n');
    
    // 1. Verifica permesso browser
    console.log('1️⃣ PERMESSO BROWSER:');
    console.log(`   Permission: ${Notification.permission}`);
    
    if (Notification.permission !== 'granted') {
      console.log('   ❌ PROBLEMA: Permesso non concesso!');
      console.log('   💡 Le notifiche verranno richieste automaticamente dopo 10 secondi dall\'avvio.');
      console.log('   💡 Oppure ricarica la pagina e accetta quando richiesto.');
      return;
    }
    console.log('   ✅ Permesso concesso\n');
    
    // 2. Verifica Service Worker
    console.log('2️⃣ SERVICE WORKER:');
    const registration = await navigator.serviceWorker.ready;
    console.log(`   ✅ Registrato: ${registration.active ? 'SI' : 'NO'}\n`);
    
    // 3. Verifica Subscription
    console.log('3️⃣ PUSH SUBSCRIPTION:');
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      console.log('   ❌ PROBLEMA: Nessuna subscription attiva!');
      console.log('   💡 Ricarica la pagina per auto-registrare.');
      console.log('   💡 Oppure chiama: await registerPushSubscription()');
      return;
    }
    console.log('   ✅ Subscription attiva');
    console.log(`   Endpoint: ${subscription.endpoint.substring(0, 50)}...\n`);
    
    // 4. Verifica Server
    console.log('4️⃣ SERVER STATUS:');
    const response = await authenticatedFetch(`${API_URL}/push/status`);
    const status = await response.json();
    console.log(`   Notifiche attive: ${status.enabled ? '✅ SI' : '❌ NO'}`);
    console.log(`   Orario programmato: ${status.scheduledTime} (${status.timezone})`);
    console.log(`   Subscription totali: ${status.totalSubscriptions}\n`);
    
    // 5. Test notifica
    console.log('5️⃣ TEST NOTIFICA:');
    console.log('   Invio notifica di test...');
    const testResponse = await authenticatedFetch(`${API_URL}/push/test`, {
      method: 'POST'
    });
    const testResult = await testResponse.json();
    console.log(`   ✅ ${testResult.message}\n`);
    
    console.log('🎯 RISULTATO: Le notifiche sono configurate correttamente!');
    console.log('📅 Riceverai una notifica ogni giorno alle 6:30 se ci sono ordini.');
    
  } catch (error) {
    console.error('❌ Errore verifica notifiche:', error);
    console.log('\n💡 SOLUZIONE: Clicca sul bottone 🔔 in alto a destra per riattivare.');
  }
}

// Rendi disponibili globalmente
window.debugSchema = debugSchema; // Usa debugSchema() nella console per verificare DB
window.checkNotifications = checkNotifications; // Usa checkNotifications() per verificare notifiche
window.viewListino = viewListino;
window.deleteListino = deleteListino;

// ============================================
// PREVENTIVI
// ============================================

let currentPreventivo = null; // preventivo caricato nell'editor (null = nuovo)
let preventiviCache = [];     // cache lista
const PREV_EMPTY_ROW = () => ({ qt: '', qt_min: '', desc: '', prezzo: '' });

function openPreventiviPage() {
  showPage('preventivi');
  loadPreventivi();
  const usernameEl = document.getElementById('username-display-preventivi');
  if (usernameEl) usernameEl.textContent = currentUser;
}

async function loadPreventivi() {
  const listEl = document.getElementById('preventivi-list');
  const emptyEl = document.getElementById('preventivi-empty');
  if (!listEl) return;
  
  try {
    const res = await authenticatedFetch(`${API_URL}/preventivi`);
    const items = await res.json();
    preventiviCache = items || [];
    renderPreventiviList(preventiviCache);
  } catch (err) {
    console.error('Errore caricamento preventivi:', err);
    listEl.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.querySelector('p').textContent = 'Errore nel caricamento';
    }
  }
}

function renderPreventiviList(items) {
  const listEl = document.getElementById('preventivi-list');
  const emptyEl = document.getElementById('preventivi-empty');
  if (!listEl) return;
  
  if (!items || items.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  
  listEl.innerHTML = items.map(p => {
    const dataStr = p.data_preventivo ? formatDateItalianShort(p.data_preventivo) : '';
    const totale = formatCurrency(p.totale || 0);
    const who = p.updated_by || p.created_by || '';
    const subtitleParts = [];
    if (p.ragione_sociale) subtitleParts.push(escapeHtml(p.ragione_sociale));
    if (p.luogo_consegna) subtitleParts.push(escapeHtml(p.luogo_consegna));
    return `
      <div class="preventivo-card" data-id="${p.id}">
        <div class="preventivo-card-head">
          <div class="preventivo-numero">${escapeHtml(p.numero || '—')}</div>
          <div class="preventivo-totale-mini">${totale}</div>
        </div>
        <div class="preventivo-cliente">${escapeHtml(p.cliente || '')}</div>
        ${subtitleParts.length ? `<div class="preventivo-sub">${subtitleParts.join(' · ')}</div>` : ''}
        <div class="preventivo-meta">
          <span>${dataStr}</span>
          ${who ? `<span>· ${escapeHtml(who)}</span>` : ''}
        </div>
        <div class="preventivo-card-actions">
          <button class="btn-mini btn-mini-edit" data-action="edit" data-id="${p.id}">Apri</button>
          <button class="btn-mini btn-mini-dup" data-action="duplicate" data-id="${p.id}">Duplica</button>
          <button class="btn-mini btn-mini-del" data-action="delete" data-id="${p.id}">Elimina</button>
        </div>
      </div>
    `;
  }).join('');
  
  listEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const action = btn.dataset.action;
      if (action === 'edit') openPreventivoEditor(id);
      else if (action === 'duplicate') duplicatePreventivo(id);
      else if (action === 'delete') deletePreventivoHandler(id);
    });
  });
  
  listEl.querySelectorAll('.preventivo-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = parseInt(card.dataset.id);
      openPreventivoEditor(id);
    });
  });
}

function formatDateItalianShort(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

function formatCurrency(n) {
  const num = Number(n) || 0;
  return '€ ' + num.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setupPreventiviListeners() {
  const searchEl = document.getElementById('preventivi-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      if (!q) return renderPreventiviList(preventiviCache);
      const filtered = preventiviCache.filter(p => {
        const str = `${p.numero || ''} ${p.cliente || ''} ${p.ragione_sociale || ''} ${p.luogo_consegna || ''}`.toLowerCase();
        return str.includes(q);
      });
      renderPreventiviList(filtered);
    });
  }
  
  const btnNew = document.getElementById('btn-new-preventivo');
  if (btnNew) btnNew.addEventListener('click', () => openPreventivoEditor(null));
  
  const btnClose = document.getElementById('btn-close-preventivo');
  if (btnClose) btnClose.addEventListener('click', closePreventivoEditor);
  
  const modal = document.getElementById('modal-preventivo');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePreventivoEditor();
    });
  }
  
  const btnAddRow = document.getElementById('btn-add-prev-row');
  if (btnAddRow) btnAddRow.addEventListener('click', () => addPrevRow(PREV_EMPTY_ROW()));
  
  const btnSave = document.getElementById('btn-save-preventivo');
  if (btnSave) btnSave.addEventListener('click', savePreventivo);
  
  const btnPrint = document.getElementById('btn-print-preventivo');
  if (btnPrint) btnPrint.addEventListener('click', downloadPreventivoPDF);
  
  const btnShare = document.getElementById('btn-share-preventivo');
  if (btnShare) btnShare.addEventListener('click', sharePreventivoPDF);
  
  const btnDel = document.getElementById('btn-delete-preventivo');
  if (btnDel) btnDel.addEventListener('click', () => {
    if (currentPreventivo && currentPreventivo.id) {
      deletePreventivoHandler(currentPreventivo.id, true);
    }
  });
}

function openPreventivoEditor(id) {
  currentPreventivo = null;
  const modal = document.getElementById('modal-preventivo');
  const itemsBox = document.getElementById('preventivo-items');
  if (itemsBox) itemsBox.innerHTML = '';
  
  const titleEl = document.getElementById('preventivo-modal-title');
  const delBtn = document.getElementById('btn-delete-preventivo');
  
  if (!id) {
    // Nuovo
    if (titleEl) titleEl.textContent = 'Nuovo preventivo';
    if (delBtn) delBtn.style.display = 'none';
    document.getElementById('prev-numero').value = '';
    document.getElementById('prev-data').value = new Date().toISOString().slice(0, 10);
    document.getElementById('prev-cliente').value = '';
    document.getElementById('prev-ragione').value = '';
    document.getElementById('prev-luogo').value = '';
    document.getElementById('prev-data-consegna').value = '';
    document.getElementById('prev-indirizzo').value = '';
    const oggEl = document.getElementById('prev-oggetto');
    if (oggEl) oggEl.value = 'Preventivo offerta';
    document.getElementById('prev-note').value = '';
    addPrevRow(PREV_EMPTY_ROW());
    recalcPreventivoTotale();
    modal.classList.add('active');
    return;
  }
  
  // Modifica: carica dal server
  (async () => {
    try {
      const res = await authenticatedFetch(`${API_URL}/preventivi/${id}`);
      if (!res.ok) throw new Error('Preventivo non trovato');
      const p = await res.json();
      currentPreventivo = p;
      
      if (titleEl) titleEl.textContent = `Preventivo ${p.numero || ''}`;
      if (delBtn) delBtn.style.display = 'flex';
      
      document.getElementById('prev-numero').value = p.numero || '';
      document.getElementById('prev-data').value = p.data_preventivo || '';
      document.getElementById('prev-cliente').value = p.cliente || '';
      document.getElementById('prev-ragione').value = p.ragione_sociale || '';
      document.getElementById('prev-luogo').value = p.luogo_consegna || '';
      document.getElementById('prev-data-consegna').value = p.data_consegna || '';
      document.getElementById('prev-indirizzo').value = p.indirizzo_consegna || '';
      const oggEl2 = document.getElementById('prev-oggetto');
      if (oggEl2) oggEl2.value = p.oggetto || 'Preventivo offerta';
      document.getElementById('prev-note').value = p.note || '';
      
      const items = Array.isArray(p.items) ? p.items : [];
      if (items.length === 0) {
        addPrevRow(PREV_EMPTY_ROW());
      } else {
        items.forEach(it => addPrevRow({
          qt: it.qt ?? '',
          qt_min: it.qt_min ?? '',
          desc: it.desc ?? '',
          prezzo: it.prezzo ?? ''
        }));
      }
      recalcPreventivoTotale();
      modal.classList.add('active');
    } catch (err) {
      console.error(err);
      alert('Errore caricamento preventivo: ' + err.message);
    }
  })();
}

function closePreventivoEditor() {
  const modal = document.getElementById('modal-preventivo');
  if (modal) modal.classList.remove('active');
  currentPreventivo = null;
}

function addPrevRow(data = {}) {
  const container = document.getElementById('preventivo-items');
  if (!container) return;
  
  const row = document.createElement('div');
  row.className = 'preventivo-item-row';
  row.innerHTML = `
    <input type="number" class="prev-inp prev-qt" step="1" min="0" inputmode="decimal" placeholder="0" value="${data.qt ?? ''}">
    <input type="number" class="prev-inp prev-qtmin" step="1" min="0" inputmode="decimal" placeholder="—" value="${data.qt_min ?? ''}">
    <input type="text" class="prev-inp prev-desc" placeholder="Descrizione articolo" value="${escapeAttr(data.desc ?? '')}">
    <input type="number" class="prev-inp prev-prezzo" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${data.prezzo ?? ''}">
    <div class="prev-totale-cell" data-totale>—</div>
    <button type="button" class="btn-row-del" title="Rimuovi riga" aria-label="Rimuovi riga">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  container.appendChild(row);
  
  const update = () => updateRowTotale(row);
  row.querySelectorAll('.prev-qt, .prev-prezzo').forEach(inp => inp.addEventListener('input', update));
  row.querySelector('.btn-row-del').addEventListener('click', () => {
    row.remove();
    recalcPreventivoTotale();
  });
  update();
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function updateRowTotale(row) {
  const qt = parseFloat(row.querySelector('.prev-qt').value) || 0;
  const prezzo = parseFloat(row.querySelector('.prev-prezzo').value) || 0;
  const tot = qt * prezzo;
  const cell = row.querySelector('[data-totale]');
  if (cell) cell.textContent = tot > 0 ? formatCurrency(tot) : '—';
  recalcPreventivoTotale();
}

function recalcPreventivoTotale() {
  let totale = 0;
  document.querySelectorAll('#preventivo-items .preventivo-item-row').forEach(row => {
    const qt = parseFloat(row.querySelector('.prev-qt').value) || 0;
    const prezzo = parseFloat(row.querySelector('.prev-prezzo').value) || 0;
    totale += qt * prezzo;
  });
  const box = document.getElementById('prev-totale');
  if (box) box.textContent = formatCurrency(totale);
  return totale;
}

function collectPreventivoFormData() {
  const rows = [...document.querySelectorAll('#preventivo-items .preventivo-item-row')];
  const items = rows.map(r => ({
    qt: parseFloat(r.querySelector('.prev-qt').value) || 0,
    qt_min: parseFloat(r.querySelector('.prev-qtmin').value) || 0,
    desc: r.querySelector('.prev-desc').value.trim(),
    prezzo: parseFloat(r.querySelector('.prev-prezzo').value) || 0
  })).filter(it => it.desc !== '' || it.qt > 0 || it.prezzo > 0);
  
  const totale = items.reduce((s, it) => s + (it.qt * it.prezzo), 0);
  
  const oggettoEl = document.getElementById('prev-oggetto');
  const oggettoVal = oggettoEl ? oggettoEl.value.trim() : '';
  
  return {
    numero: document.getElementById('prev-numero').value.trim(),
    cliente: document.getElementById('prev-cliente').value.trim(),
    ragione_sociale: document.getElementById('prev-ragione').value.trim(),
    luogo_consegna: document.getElementById('prev-luogo').value.trim(),
    indirizzo_consegna: document.getElementById('prev-indirizzo').value.trim(),
    data_preventivo: document.getElementById('prev-data').value || new Date().toISOString().slice(0, 10),
    data_consegna: document.getElementById('prev-data-consegna').value || '',
    oggetto: oggettoVal || 'Preventivo offerta',
    items,
    totale,
    note: document.getElementById('prev-note').value.trim()
  };
}

async function savePreventivo() {
  const data = collectPreventivoFormData();
  if (!data.cliente) {
    alert('Inserisci almeno l\'intestazione cliente (es. "Sig. Mario Rossi").');
    document.getElementById('prev-cliente').focus();
    return;
  }
  
  try {
    let saved;
    if (currentPreventivo && currentPreventivo.id) {
      const res = await authenticatedFetch(`${API_URL}/preventivi/${currentPreventivo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      saved = await res.json();
    } else {
      const res = await authenticatedFetch(`${API_URL}/preventivi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      saved = await res.json();
    }
    currentPreventivo = saved;
    // Aggiorna titolo e numero generato auto
    const titleEl = document.getElementById('preventivo-modal-title');
    if (titleEl) titleEl.textContent = `Preventivo ${saved.numero || ''}`;
    const numeroInp = document.getElementById('prev-numero');
    if (numeroInp && !numeroInp.value) numeroInp.value = saved.numero || '';
    const delBtn = document.getElementById('btn-delete-preventivo');
    if (delBtn) delBtn.style.display = 'flex';
    showMiniToast('Preventivo salvato', 'success');
    loadPreventivi();
  } catch (err) {
    console.error(err);
    alert('Errore salvataggio preventivo: ' + err.message);
  }
}

async function duplicatePreventivo(id) {
  try {
    const res = await authenticatedFetch(`${API_URL}/preventivi/${id}`);
    if (!res.ok) throw new Error('Preventivo non trovato');
    const p = await res.json();
    // Crea copia senza id e numero (il server genererà un nuovo numero)
    const copy = {
      cliente: p.cliente,
      ragione_sociale: p.ragione_sociale,
      luogo_consegna: p.luogo_consegna,
      indirizzo_consegna: p.indirizzo_consegna,
      data_preventivo: new Date().toISOString().slice(0, 10),
      data_consegna: p.data_consegna,
      items: p.items,
      totale: p.totale,
      note: p.note
    };
    const cres = await authenticatedFetch(`${API_URL}/preventivi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(copy)
    });
    const newPrev = await cres.json();
    showMiniToast('Preventivo duplicato', 'success');
    loadPreventivi();
    openPreventivoEditor(newPrev.id);
  } catch (err) {
    console.error(err);
    alert('Errore duplicazione preventivo: ' + err.message);
  }
}

async function deletePreventivoHandler(id, fromEditor = false) {
  if (!confirm('Eliminare definitivamente questo preventivo?')) return;
  try {
    await authenticatedFetch(`${API_URL}/preventivi/${id}`, { method: 'DELETE' });
    if (fromEditor) closePreventivoEditor();
    showMiniToast('Preventivo eliminato', 'success');
    loadPreventivi();
  } catch (err) {
    console.error(err);
    alert('Errore eliminazione: ' + err.message);
  }
}

function showMiniToast(msg, type = 'info') {
  // Usa stile mini-toast esistente se disponibile, altrimenti fallback
  const existing = document.querySelector('.mini-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'mini-toast ' + (type === 'success' ? 'success' : (type === 'error' ? 'error' : 'info'));
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}

// ============================================
// PREVENTIVO PDF (jsPDF) — download & share
// ============================================

const LOMBARDA_FOOTER = 'LombardaFlor S.r.l. · Via Enrico De Nicola 20, Cesano Boscone (MI)';

let _logoDataUrlCache = null;
async function getLogoDataUrl() {
  if (_logoDataUrlCache) return _logoDataUrlCache;
  try {
    const res = await fetch('logo.png', { cache: 'force-cache' });
    if (!res.ok) throw new Error('logo fetch failed: ' + res.status);
    const blob = await res.blob();
    _logoDataUrlCache = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return _logoDataUrlCache;
  } catch (err) {
    console.warn('Impossibile caricare logo per PDF:', err);
    return null;
  }
}

function buildPreventivoFilename(p) {
  const parts = [];
  if (p.numero) parts.push(p.numero);
  const who = (p.ragione_sociale || p.cliente || 'cliente')
    .replace(/[^a-zA-Z0-9àèìòùÀÈÌÒÙ ]+/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 40);
  parts.push(who || 'cliente');
  return `Preventivo-${parts.join('-')}.pdf`;
}

async function generatePreventivoPDFBlob(p) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Libreria PDF non caricata. Controlla la connessione e riprova.');
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  
  // ---------- HEADER ----------
  const logo = await getLogoDataUrl();
  if (logo) {
    try {
      // Mantieni aspect ratio originale del logo
      const props = doc.getImageProperties(logo);
      const maxW = 50;  // larghezza massima in mm
      const maxH = 22;  // altezza massima in mm
      const ratio = props.width / props.height;
      let w = maxW;
      let h = w / ratio;
      if (h > maxH) { h = maxH; w = h * ratio; }
      doc.addImage(logo, 'PNG', margin, 14, w, h, undefined, 'FAST');
    } catch (e) {
      console.warn('Errore inserimento logo:', e);
    }
  }
  
  const dataPrev = p.data_preventivo ? formatDateItalianShort(p.data_preventivo) : '';
  const citta = p.luogo_consegna || 'Cesano Boscone';
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(42, 122, 46);
  if (p.numero) doc.text(`N° ${p.numero}`, pageW - margin, 20, { align: 'right' });
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  if (dataPrev) doc.text(`${citta}, ${dataPrev}`, pageW - margin, 26, { align: 'right' });
  
  // ---------- INTESTAZIONE ----------
  let y = 44;
  doc.setTextColor(26, 26, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const intestazione = (p.cliente || '') + (p.ragione_sociale ? ' - ' + p.ragione_sociale : '');
  doc.text(intestazione, margin, y);
  y += 6;
  
  doc.setFontSize(9.5);
  if (p.data_consegna) {
    doc.setFont('helvetica', 'bold');
    doc.text('CONSEGNA:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDateItalianShort(p.data_consegna), margin + 23, y);
    y += 5;
  }
  if (p.indirizzo_consegna) {
    doc.setFont('helvetica', 'bold');
    doc.text('LUOGO:', margin, y);
    doc.setFont('helvetica', 'normal');
    const luogoLines = doc.splitTextToSize(p.indirizzo_consegna, pageW - margin - (margin + 18));
    doc.text(luogoLines, margin + 18, y);
    y += 5 * luogoLines.length;
  }
  y += 3;
  
  // ---------- OGGETTO ----------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('OGGETTO:', margin, y);
  doc.setFont('helvetica', 'normal');
  const oggettoTxt = (p.oggetto && p.oggetto.trim()) ? p.oggetto.trim() : 'Preventivo offerta';
  doc.text(oggettoTxt, margin + 21, y);
  y += 7;
  
  // ---------- INTRO ----------
  doc.setFontSize(9.5);
  doc.text('Con la presente Vi inoltriamo preventivo come da Vostra richiesta.', margin, y);
  y += 5;
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(192, 57, 43);
  const warn = 'I prezzi indicati si intendono esclusi di Iva e sono orientativi, in quanto potrebbero subire variazioni di mercato.';
  const warnLines = doc.splitTextToSize(warn, pageW - margin * 2);
  doc.text(warnLines, margin, y);
  y += 4.5 * warnLines.length + 3;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(26, 26, 26);
  
  // ---------- TABELLA ARTICOLI ----------
  const body = (p.items || []).map(it => {
    const qt = Number(it.qt) || 0;
    const qtMin = Number(it.qt_min) || 0;
    const prezzo = Number(it.prezzo) || 0;
    const totale = qt * prezzo;
    return [
      qt ? String(qt) : '',
      qtMin ? String(qtMin) : '—',
      it.desc || '',
      prezzo > 0 ? prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
      totale > 0 ? totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
    ];
  });
  
  const totale = (p.items || []).reduce((s, it) => s + ((Number(it.qt) || 0) * (Number(it.prezzo) || 0)), 0);
  const totaleFmt = totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  doc.autoTable({
    startY: y,
    head: [['Qt', 'Qt min.', 'Descrizione', 'Prezzo\nunitario (€)', 'Prezzo\ncomplessivo']],
    body: body.length ? body : [['', '', '—', '', '']],
    foot: [['', '', '', 'Totale', `€ ${totaleFmt}`]],
    theme: 'grid',
    styles: {
      font: 'helvetica', fontSize: 9, cellPadding: 2,
      textColor: [26, 26, 26], lineColor: [150, 150, 150], lineWidth: 0.15,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [238, 238, 238], textColor: [26, 26, 26],
      fontStyle: 'bold', fontSize: 8.5, halign: 'center'
    },
    footStyles: {
      fillColor: [249, 249, 249], textColor: [26, 26, 26],
      fontStyle: 'bold', fontSize: 10, halign: 'right'
    },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: 16, halign: 'center', textColor: [90, 90, 90], fontStyle: 'italic' },
      2: { halign: 'left' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' }
    },
    margin: { left: margin, right: margin, bottom: 22 },
    didDrawPage: () => drawFooter(doc, pageW, pageH, margin)
  });
  
  y = doc.lastAutoTable.finalY + 8;
  
  // ---------- CLOSING ----------
  const ensureSpace = (needed) => {
    if (y + needed > pageH - 22) {
      doc.addPage();
      drawFooter(doc, pageW, pageH, margin);
      y = margin;
    }
  };
  
  doc.setFontSize(9.5);
  const closing = 'Restiamo in attesa di ricevere Vs conferma al più presto, in modo tale da poterVi dare disponibilità e prezzi effettivi fiori.';
  const closingLines = doc.splitTextToSize(closing, pageW - margin * 2);
  ensureSpace(closingLines.length * 4.5 + 20);
  doc.text(closingLines, margin, y);
  y += 4.5 * closingLines.length + 6;
  
  doc.text('Cordiali saluti,', margin, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(42, 122, 46);
  doc.text('LOMBARDA FLOR SRL', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(26, 26, 26);
  y += 6;
  
  if (p.note) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(90, 90, 90);
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(p.note, pageW - margin * 2);
    ensureSpace(noteLines.length * 4 + 6);
    doc.text(noteLines, margin, y);
    y += 4 * noteLines.length;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(26, 26, 26);
  }
  
  // Assicura footer su tutte le pagine
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooter(doc, pageW, pageH, margin);
  }
  
  return doc.output('blob');
}

function drawFooter(doc, pageW, pageH, margin) {
  const y = pageH - 12;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.15);
  doc.line(margin, y - 3, pageW - margin, y - 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110, 110, 110);
  doc.text(LOMBARDA_FOOTER, pageW / 2, y, { align: 'center' });
  doc.setTextColor(26, 26, 26);
}

async function buildPreventivoBlobOrFail() {
  const data = collectPreventivoFormData();
  if (!data.cliente) {
    alert('Inserisci almeno l\'intestazione cliente prima di esportare.');
    document.getElementById('prev-cliente').focus();
    return null;
  }
  try {
    const blob = await generatePreventivoPDFBlob(data);
    return { blob, data };
  } catch (err) {
    console.error('Errore generazione PDF:', err);
    alert('Errore generazione PDF: ' + err.message);
    return null;
  }
}

async function downloadPreventivoPDF() {
  const res = await buildPreventivoBlobOrFail();
  if (!res) return;
  const filename = buildPreventivoFilename(res.data);
  const url = URL.createObjectURL(res.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
  showMiniToast('PDF scaricato', 'success');
}

async function sharePreventivoPDF() {
  const res = await buildPreventivoBlobOrFail();
  if (!res) return;
  const filename = buildPreventivoFilename(res.data);
  const file = new File([res.blob], filename, { type: 'application/pdf' });
  
  const shareData = {
    files: [file],
    title: `Preventivo ${res.data.numero || ''}`.trim(),
    text: `Preventivo ${res.data.numero ? 'N° ' + res.data.numero + ' ' : ''}- LombardaFlor`
  };
  
  if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
    try {
      await navigator.share(shareData);
      showMiniToast('Preventivo condiviso', 'success');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('share fallita, fallback a download:', err);
    }
  }
  
  // Fallback: scarica il PDF e avvisa
  const url = URL.createObjectURL(res.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  alert('La condivisione diretta non è supportata su questo dispositivo o browser.\nIl PDF è stato scaricato: puoi allegarlo manualmente su WhatsApp.');
}

// (Funzione storica, ora non più usata; mantenuta per retrocompatibilità)
function renderPreventivoPrintHtml(p) {
  const dataPrev = p.data_preventivo ? formatDateItalianShort(p.data_preventivo) : '';
  const dataCons = p.data_consegna ? formatDateItalianShort(p.data_consegna) : '';
  
  const rowsHtml = (p.items || []).map(it => {
    const qt = Number(it.qt) || 0;
    const qtMin = Number(it.qt_min) || 0;
    const prezzo = Number(it.prezzo) || 0;
    const totale = qt * prezzo;
    return `
      <tr>
        <td class="ppv-col-qt">${qt || ''}</td>
        <td class="ppv-col-qtmin">${qtMin || '—'}</td>
        <td class="ppv-col-desc">${escapeHtml(it.desc || '')}</td>
        <td class="ppv-col-price">${prezzo > 0 ? prezzo.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
        <td class="ppv-col-total">${totale > 0 ? totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
      </tr>
    `;
  }).join('');
  
  const totale = (p.items || []).reduce((s, it) => s + ((Number(it.qt) || 0) * (Number(it.prezzo) || 0)), 0);
  const totaleFmt = totale.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const numero = p.numero ? `N° ${p.numero}` : '';
  const citta = p.luogo_consegna || 'Cesano Boscone';
  
  return `
    <div class="ppv-sheet">
      <div class="ppv-top">
        <img src="logo.png" alt="LombardaFlor" class="ppv-logo">
        <div class="ppv-top-right">
          <div class="ppv-numero">${escapeHtml(numero)}</div>
          <div class="ppv-city">${escapeHtml(citta)}, ${escapeHtml(dataPrev)}</div>
        </div>
      </div>
      
      <div class="ppv-intestazione">
        <div class="ppv-sig"><strong>${escapeHtml(p.cliente)}</strong>${p.ragione_sociale ? ' - ' + escapeHtml(p.ragione_sociale) : ''}</div>
        ${p.indirizzo_consegna ? `<div class="ppv-info-row"><span class="ppv-label">CONSEGNA:</span> ${escapeHtml(dataCons || '')}</div>` : ''}
        ${p.indirizzo_consegna ? `<div class="ppv-info-row"><span class="ppv-label">LUOGO:</span> ${escapeHtml(p.indirizzo_consegna)}</div>` : ''}
      </div>
      
      <div class="ppv-oggetto"><strong>OGGETTO:</strong> Preventivo offerta</div>
      
      <p class="ppv-intro">Con la presente Vi inoltriamo preventivo come da Vostra richiesta.</p>
      <p class="ppv-intro ppv-intro-highlight">I prezzi indicati si intendono esclusi di Iva e sono orientativi, in quanto potrebbero subire variazioni di mercato.</p>
      
      <table class="ppv-table">
        <thead>
          <tr>
            <th class="ppv-col-qt">Qt</th>
            <th class="ppv-col-qtmin">Qt min.</th>
            <th class="ppv-col-desc">Descrizione</th>
            <th class="ppv-col-price">Prezzo<br>unitario (€)</th>
            <th class="ppv-col-total">Prezzo<br>complessivo</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        <tfoot>
          <tr class="ppv-totale-row">
            <td colspan="4" class="ppv-totale-label">Totale</td>
            <td class="ppv-totale-value">€ ${totaleFmt}</td>
          </tr>
        </tfoot>
      </table>
      
      <p class="ppv-closing">Restiamo in attesa di ricevere Vs conferma al più presto, in modo tale da poterVi dare disponibilità e prezzi effettivi fiori.</p>
      
      <p class="ppv-regards">Cordiali saluti,<br><strong>LOMBARDA FLOR SRL</strong></p>
      
      ${p.note ? `<p class="ppv-note"><em>${escapeHtml(p.note)}</em></p>` : ''}
      
      <div class="ppv-footer">
        <span>LombardaFlor S.r.l.</span> · 
        <span>Via Enrico De Nicola 20, Cesano Boscone (MI)</span> · 
        <span>P.IVA 00000000000</span>
      </div>
    </div>
  `;
}

window.openPreventivoEditor = openPreventivoEditor;

// =========================================================
// PAGINA CLIENTI PORTALE (gestione account + ordini in attesa)
// =========================================================

let clientiCache = [];
let pendingOrdersCache = [];
let currentCliente = null; // cliente in modifica nel modal

async function openClientiPage() {
  showPage('clienti');
  const unameEl = document.getElementById('username-display-clienti');
  if (unameEl) unameEl.textContent = currentUser || '';
  await Promise.all([loadClienti(), loadPendingOrders()]);
}

async function loadClienti() {
  try {
    const res = await fetch('/api/customers', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore caricamento clienti');
    clientiCache = await res.json();
    renderClientiList(clientiCache);
  } catch (e) {
    console.error('loadClienti', e);
    showMiniToast('Errore caricamento clienti', 'error');
  }
}

function renderClientiList(items) {
  const list = document.getElementById('clienti-list');
  const empty = document.getElementById('clienti-empty');
  if (!list) return;
  list.innerHTML = '';
  
  if (!items || items.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';
  
  items.forEach(c => {
    const card = document.createElement('div');
    card.className = 'cliente-card' + (c.active ? '' : ' is-inactive');
    card.innerHTML = `
      <div class="cliente-card-info">
        <div class="cliente-card-name">
          ${escapeHtml(c.name)}
          <span class="cliente-status ${c.active ? 'is-active' : 'is-inactive'}">
            ${c.active ? 'Attivo' : 'Disattivo'}
          </span>
        </div>
        <div class="cliente-card-meta">
          ${c.contact_name ? `<span>👤 ${escapeHtml(c.contact_name)}</span>` : ''}
          ${c.phone ? `<span>📞 ${escapeHtml(c.phone)}</span>` : ''}
          ${c.email ? `<span>✉️ ${escapeHtml(c.email)}</span>` : ''}
          ${c.last_login ? `<span>🕒 Ultimo accesso: ${formatLastLogin(c.last_login)}</span>` : '<span style="color:#9ca3af">Mai entrato</span>'}
        </div>
      </div>
      <div class="cliente-card-actions">
        <button class="btn-copy-cust" data-action="copy" data-id="${c.id}">📋 Copia link</button>
        <button data-action="edit" data-id="${c.id}">Modifica</button>
      </div>
    `;
    card.querySelector('[data-action="copy"]').addEventListener('click', () => copyCustomerLink(c));
    card.querySelector('[data-action="edit"]').addEventListener('click', () => openClienteEditor(c.id));
    list.appendChild(card);
  });
}

function formatLastLogin(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function buildMagicLink(token) {
  return `${window.location.origin}/c/${token}`;
}

async function copyCustomerLink(c) {
  const url = buildMagicLink(c.login_token);
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement('textarea');
      ta.value = url; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    showMiniToast('Link copiato negli appunti', 'success');
  } catch {
    prompt('Copia il link:', url);
  }
}

// Editor cliente
function openClienteEditor(id) {
  currentCliente = id ? clientiCache.find(c => c.id === id) : null;
  const titleEl = document.getElementById('cliente-modal-title');
  if (titleEl) titleEl.textContent = currentCliente ? 'Modifica cliente' : 'Nuovo cliente';
  
  document.getElementById('cliente-name').value = currentCliente?.name || '';
  document.getElementById('cliente-contact').value = currentCliente?.contact_name || '';
  document.getElementById('cliente-email').value = currentCliente?.email || '';
  document.getElementById('cliente-phone').value = currentCliente?.phone || '';
  document.getElementById('cliente-notes').value = currentCliente?.notes || '';
  document.getElementById('cliente-active').checked = currentCliente ? !!currentCliente.active : true;
  
  const linkBox = document.getElementById('cliente-link-box');
  const delBtn = document.getElementById('btn-delete-cliente');
  if (currentCliente) {
    linkBox.style.display = 'block';
    const url = buildMagicLink(currentCliente.login_token);
    document.getElementById('cliente-link-url').value = url;
    const waMsg = encodeURIComponent(`Ciao! Ecco il tuo link personale per accedere al portale clienti di LombardaFlor: ${url}`);
    document.getElementById('cliente-link-wa').href = `https://wa.me/?text=${waMsg}`;
    delBtn.style.display = 'inline-block';
  } else {
    linkBox.style.display = 'none';
    delBtn.style.display = 'none';
  }
  
  document.getElementById('modal-cliente').classList.add('active');
}

function closeClienteEditor() {
  document.getElementById('modal-cliente').classList.remove('active');
  currentCliente = null;
}

async function saveCliente() {
  const name = document.getElementById('cliente-name').value.trim();
  if (!name) {
    showMiniToast('Nome azienda obbligatorio', 'error');
    return;
  }
  const body = {
    name,
    contact_name: document.getElementById('cliente-contact').value.trim(),
    email: document.getElementById('cliente-email').value.trim(),
    phone: document.getElementById('cliente-phone').value.trim(),
    notes: document.getElementById('cliente-notes').value.trim(),
    active: document.getElementById('cliente-active').checked
  };
  
  try {
    const url = currentCliente ? `/api/customers/${currentCliente.id}` : '/api/customers';
    const method = currentCliente ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Errore salvataggio');
    }
    const saved = await res.json();
    showMiniToast(currentCliente ? 'Cliente aggiornato' : 'Cliente creato', 'success');
    await loadClienti();
    if (!currentCliente) {
      // Se nuovo: riapri editor per mostrare subito il link
      openClienteEditor(saved.id);
    } else {
      closeClienteEditor();
    }
  } catch (e) {
    console.error('saveCliente', e);
    showMiniToast(e.message || 'Errore', 'error');
  }
}

async function deleteClienteHandler() {
  if (!currentCliente) return;
  if (!confirm(`Eliminare "${currentCliente.name}"?\n\nGli ordini già fatti rimarranno nel sistema ma non saranno più collegati al cliente.`)) return;
  try {
    const res = await fetch(`/api/customers/${currentCliente.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore eliminazione');
    showMiniToast('Cliente eliminato', 'success');
    closeClienteEditor();
    await loadClienti();
  } catch (e) {
    showMiniToast(e.message, 'error');
  }
}

async function regenCustomerToken() {
  if (!currentCliente) return;
  if (!confirm('Rigenerare il link magico?\n\nIl vecchio link smetterà di funzionare immediatamente.')) return;
  try {
    const res = await fetch(`/api/customers/${currentCliente.id}/regenerate-token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore rigenerazione');
    const updated = await res.json();
    showMiniToast('Nuovo link generato', 'success');
    await loadClienti();
    openClienteEditor(updated.id);
  } catch (e) {
    showMiniToast(e.message, 'error');
  }
}

function copyClienteLinkFromModal() {
  const url = document.getElementById('cliente-link-url').value;
  if (!url) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(
      () => showMiniToast('Link copiato', 'success'),
      () => prompt('Copia il link:', url)
    );
  } else {
    const ta = document.createElement('textarea');
    ta.value = url; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showMiniToast('Link copiato', 'success'); }
    catch { prompt('Copia il link:', url); }
    ta.remove();
  }
}

// Ordini in attesa
async function loadPendingOrders() {
  try {
    const res = await fetch('/api/admin/pending-orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore');
    pendingOrdersCache = await res.json();
    renderPendingOrders();
    updatePendingBadge();
  } catch (e) {
    console.error('loadPendingOrders', e);
  }
}

function renderPendingOrders() {
  const section = document.getElementById('pending-orders-section');
  const list = document.getElementById('pending-orders-list');
  const count = document.getElementById('pending-count-display');
  if (!section || !list) return;
  
  if (!pendingOrdersCache || pendingOrdersCache.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  count.textContent = pendingOrdersCache.length;
  list.innerHTML = '';
  
  pendingOrdersCache.forEach(o => {
    const card = document.createElement('div');
    card.className = 'pending-order-card';
    const deliveryInfo = o.delivery_type === 'consegna'
      ? `🚚 Consegna${o.delivery_time ? ' ore ' + o.delivery_time : ''}${o.delivery_address ? ' · ' + escapeHtml(o.delivery_address) : ''}`
      : '🏪 Ritiro in sede';
    
    card.innerHTML = `
      <div class="pending-order-head">
        <div class="pending-order-customer">${escapeHtml(o.customer_name || o.customer)}</div>
        <div class="pending-order-date">📅 ${formatDateItalian(o.date)}</div>
      </div>
      <div style="color:#5b6963; font-size:0.85rem; margin-bottom:0.5rem;">${deliveryInfo}</div>
      <div class="pending-order-desc">${escapeHtml(o.description || '')}</div>
      <div class="pending-order-actions">
        <button class="btn-approve" data-action="approve" data-id="${o.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Approva
        </button>
        <button class="btn-reject" data-action="reject" data-id="${o.id}">Rifiuta</button>
      </div>
    `;
    card.querySelector('[data-action="approve"]').addEventListener('click', () => approveOrder(o.id));
    card.querySelector('[data-action="reject"]').addEventListener('click', () => rejectOrder(o.id));
    list.appendChild(card);
  });
}

function updatePendingBadge() {
  const badge = document.getElementById('badge-pending-orders');
  if (!badge) return;
  const n = (pendingOrdersCache || []).length;
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function approveOrder(id) {
  try {
    const res = await fetch(`/api/orders/${id}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore approvazione');
    showMiniToast('Ordine approvato', 'success');
    await loadPendingOrders();
    if (typeof loadOrders === 'function' && typeof currentDate !== 'undefined' && currentDate) {
      try { loadOrders(currentDate); } catch {}
    }
  } catch (e) { showMiniToast(e.message, 'error'); }
}

async function rejectOrder(id) {
  const reason = prompt('Motivo del rifiuto (verrà mostrato al cliente):', '');
  if (reason === null) return;
  try {
    const res = await fetch(`/api/orders/${id}/reject`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    });
    if (!res.ok) throw new Error('Errore rifiuto');
    showMiniToast('Ordine rifiutato', 'success');
    await loadPendingOrders();
  } catch (e) { showMiniToast(e.message, 'error'); }
}

// Aggiorna badge ogni volta che il calendario viene caricato
async function refreshPendingBadgeOnly() {
  try {
    const res = await fetch('/api/admin/pending-orders', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    pendingOrdersCache = await res.json();
    updatePendingBadge();
  } catch { /* no-op */ }
}

function setupClientiListeners() {
  const btnNew = document.getElementById('btn-new-cliente');
  if (btnNew) btnNew.addEventListener('click', () => openClienteEditor(null));
  const btnClose = document.getElementById('btn-close-cliente');
  if (btnClose) btnClose.addEventListener('click', closeClienteEditor);
  const btnSave = document.getElementById('btn-save-cliente');
  if (btnSave) btnSave.addEventListener('click', saveCliente);
  const btnDel = document.getElementById('btn-delete-cliente');
  if (btnDel) btnDel.addEventListener('click', deleteClienteHandler);
  const btnRegen = document.getElementById('btn-regen-token');
  if (btnRegen) btnRegen.addEventListener('click', regenCustomerToken);
  const btnCopyModal = document.getElementById('btn-copy-link');
  if (btnCopyModal) btnCopyModal.addEventListener('click', copyClienteLinkFromModal);
  
  const modalCli = document.getElementById('modal-cliente');
  if (modalCli) {
    modalCli.addEventListener('click', (e) => {
      if (e.target === modalCli) closeClienteEditor();
    });
  }
}

window.openClientiPage = openClientiPage;
window.refreshPendingBadgeOnly = refreshPendingBadgeOnly;

// =========================================================
// PAGINA CATALOGO DEL GIORNO (staff)
// =========================================================

let catalogoCurrentDate = null;
let catalogoItemsCache = [];
let catalogoCategoriesCache = new Set();
let currentCatalogItem = null; // in editing

function todayIsoStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yesterdayIsoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function catalogoDayLabel(isoDate) {
  try {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const today = todayIsoStr();
    const yesterday = yesterdayIsoStr();
    const tomorrow = (() => {
      const t = new Date(); t.setDate(t.getDate() + 1);
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    let prefix = '';
    if (isoDate === today) prefix = '· Oggi';
    else if (isoDate === yesterday) prefix = '· Ieri';
    else if (isoDate === tomorrow) prefix = '· Domani';
    const txt = dt.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `${txt.charAt(0).toUpperCase() + txt.slice(1)} ${prefix}`.trim();
  } catch { return isoDate; }
}

async function openCatalogoPage() {
  showPage('catalogo');
  const unameEl = document.getElementById('username-display-catalogo');
  if (unameEl) unameEl.textContent = currentUser || '';
  catalogoCurrentDate = todayIsoStr();
  const inp = document.getElementById('catalogo-date');
  if (inp) inp.value = catalogoCurrentDate;
  await loadCatalogo(catalogoCurrentDate);
}

async function loadCatalogo(date) {
  try {
    const res = await fetch(`/api/catalog?date=${encodeURIComponent(date)}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore catalogo');
    const data = await res.json();
    catalogoItemsCache = data.items || [];
    catalogoCurrentDate = data.date;
    updateCatalogoCategorySuggestions();
    renderCatalogoStaff();
  } catch (e) {
    console.error('loadCatalogo', e);
    showMiniToast('Errore caricamento catalogo', 'error');
  }
}

function updateCatalogoCategorySuggestions() {
  catalogoCategoriesCache = new Set();
  catalogoItemsCache.forEach(i => { if (i.category) catalogoCategoriesCache.add(i.category); });
  const dl = document.getElementById('catalog-cat-suggestions');
  if (dl) {
    dl.innerHTML = '';
    [...catalogoCategoriesCache].sort().forEach(c => {
      const opt = document.createElement('option');
      opt.value = c;
      dl.appendChild(opt);
    });
  }
}

function renderCatalogoStaff() {
  const grid = document.getElementById('catalogo-grid');
  const empty = document.getElementById('catalogo-empty');
  const summary = document.getElementById('catalogo-summary');
  const dayLabel = document.getElementById('catalogo-day-label');
  if (dayLabel) dayLabel.textContent = catalogoDayLabel(catalogoCurrentDate);
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (!catalogoItemsCache.length) {
    empty.style.display = 'flex';
    if (summary) summary.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  
  // Summary
  const active = catalogoItemsCache.filter(i => i.active).length;
  const cats = [...new Set(catalogoItemsCache.map(i => i.category).filter(Boolean))];
  if (summary) {
    summary.innerHTML = `
      <span class="pill"><strong>${catalogoItemsCache.length}</strong> articoli · <strong>${active}</strong> attivi</span>
      ${cats.length ? `<span class="pill">${cats.length} ${cats.length === 1 ? 'categoria' : 'categorie'}: ${cats.slice(0, 4).map(escapeHtml).join(', ')}${cats.length > 4 ? '…' : ''}</span>` : ''}
    `;
  }
  
  catalogoItemsCache.forEach(item => {
    const card = document.createElement('div');
    card.className = 'catalog-card' + (item.active ? '' : ' is-inactive');
    const photoHtml = item.photo_url
      ? `<div class="catalog-card-photo"><img src="${item.photo_url}" alt="${escapeHtml(item.name)}" loading="lazy">
           ${item.category ? `<span class="catalog-card-cat">${escapeHtml(item.category)}</span>` : ''}
           ${!item.active ? `<span class="catalog-card-badge-inactive">NASCOSTO</span>` : ''}
         </div>`
      : `<div class="catalog-card-photo no-photo">
           <svg class="no-photo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
             <rect x="3" y="3" width="18" height="18" rx="2"/>
             <circle cx="8.5" cy="8.5" r="1.5"/>
             <polyline points="21 15 16 10 5 21"/>
           </svg>
           ${item.category ? `<span class="catalog-card-cat">${escapeHtml(item.category)}</span>` : ''}
           ${!item.active ? `<span class="catalog-card-badge-inactive">NASCOSTO</span>` : ''}
         </div>`;
    card.innerHTML = `
      ${photoHtml}
      <div class="catalog-card-body">
        <div class="catalog-card-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="catalog-card-desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="catalog-card-meta">
          <span class="catalog-card-price">${item.price > 0 ? '€ ' + Number(item.price).toFixed(2) : '—'}</span>
          <span class="catalog-card-qty">min ${item.min_quantity}</span>
        </div>
        ${item.availability ? `<div class="catalog-card-avail">📦 ${escapeHtml(item.availability)}</div>` : ''}
      </div>
    `;
    card.addEventListener('click', () => openCatalogItemEditor(item));
    grid.appendChild(card);
  });
}

// Editor articolo
let uploadedPhotoUrl = null;

function openCatalogItemEditor(item) {
  currentCatalogItem = item || null;
  uploadedPhotoUrl = item?.photo_url || null;
  const titleEl = document.getElementById('catalog-item-title');
  if (titleEl) titleEl.textContent = item ? 'Modifica articolo' : 'Nuovo articolo';
  
  document.getElementById('catalog-name').value = item?.name || '';
  document.getElementById('catalog-category').value = item?.category || '';
  document.getElementById('catalog-description').value = item?.description || '';
  document.getElementById('catalog-price').value = item?.price ?? '';
  document.getElementById('catalog-min-qty').value = item?.min_quantity || 1;
  document.getElementById('catalog-availability').value = item?.availability || '';
  document.getElementById('catalog-active').checked = item ? !!item.active : true;
  document.getElementById('btn-delete-catalog-item').style.display = item ? 'inline-block' : 'none';
  
  updateCatalogPhotoPreview();
  document.getElementById('modal-catalog-item').classList.add('active');
}

function closeCatalogItemEditor() {
  document.getElementById('modal-catalog-item').classList.remove('active');
  currentCatalogItem = null;
  uploadedPhotoUrl = null;
}

function updateCatalogPhotoPreview() {
  const prev = document.getElementById('catalog-photo-preview');
  const removeBtn = document.getElementById('btn-catalog-remove-photo');
  if (!prev) return;
  if (uploadedPhotoUrl) {
    prev.innerHTML = `<img src="${uploadedPhotoUrl}" alt="preview">`;
    if (removeBtn) removeBtn.style.display = 'inline-block';
  } else {
    prev.innerHTML = `
      <div class="catalog-photo-placeholder">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>Tocca "Scegli foto" per caricare</span>
      </div>`;
    if (removeBtn) removeBtn.style.display = 'none';
  }
}

async function uploadCatalogPhoto(file) {
  if (!file) return;
  const btn = document.getElementById('btn-catalog-upload-photo');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Caricamento...'; }
  try {
    const fd = new FormData();
    fd.append('photo', file);
    const res = await fetch('/api/catalog/upload-photo', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` },
      body: fd
    });
    if (!res.ok) throw new Error('Errore upload');
    const data = await res.json();
    uploadedPhotoUrl = data.photo_url;
    updateCatalogPhotoPreview();
    showMiniToast('Foto caricata', 'success');
  } catch (e) {
    console.error('uploadCatalogPhoto', e);
    showMiniToast('Errore upload foto', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷 Scegli foto'; }
  }
}

async function saveCatalogItem() {
  const name = document.getElementById('catalog-name').value.trim();
  if (!name) { showMiniToast('Nome articolo obbligatorio', 'error'); return; }
  
  const body = {
    catalog_date: catalogoCurrentDate || todayIsoStr(),
    name,
    category: document.getElementById('catalog-category').value.trim(),
    description: document.getElementById('catalog-description').value.trim(),
    price: parseFloat(document.getElementById('catalog-price').value) || 0,
    min_quantity: parseInt(document.getElementById('catalog-min-qty').value) || 1,
    availability: document.getElementById('catalog-availability').value.trim(),
    photo_url: uploadedPhotoUrl || '',
    active: document.getElementById('catalog-active').checked
  };
  
  try {
    const url = currentCatalogItem ? `/api/catalog/items/${currentCatalogItem.id}` : '/api/catalog/items';
    const method = currentCatalogItem ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Errore salvataggio');
    }
    showMiniToast(currentCatalogItem ? 'Articolo aggiornato' : 'Articolo aggiunto', 'success');
    closeCatalogItemEditor();
    await loadCatalogo(catalogoCurrentDate);
  } catch (e) {
    console.error('saveCatalogItem', e);
    showMiniToast(e.message || 'Errore', 'error');
  }
}

async function deleteCatalogItem() {
  if (!currentCatalogItem) return;
  if (!confirm(`Eliminare "${currentCatalogItem.name}"?`)) return;
  try {
    const res = await fetch(`/api/catalog/items/${currentCatalogItem.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) throw new Error('Errore eliminazione');
    showMiniToast('Articolo eliminato', 'success');
    closeCatalogItemEditor();
    await loadCatalogo(catalogoCurrentDate);
  } catch (e) { showMiniToast(e.message, 'error'); }
}

async function duplicateFromYesterday() {
  const from = yesterdayIsoStr();
  const to = catalogoCurrentDate;
  if (from === to) {
    showMiniToast('Seleziona una data diversa da ieri', 'error');
    return;
  }
  if (catalogoItemsCache.length > 0) {
    if (!confirm('La data corrente ha già articoli. La duplicazione funziona solo su date vuote. Vuoi comunque procedere?')) return;
  }
  if (!confirm(`Copiare tutti gli articoli del ${from} nel catalogo di ${to}?`)) return;
  try {
    const res = await fetch('/api/catalog/duplicate', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Errore duplicazione');
    }
    const data = await res.json();
    showMiniToast(`${data.copied} articoli duplicati`, 'success');
    await loadCatalogo(to);
  } catch (e) { showMiniToast(e.message, 'error'); }
}

function setupCatalogoListeners() {
  const dateInput = document.getElementById('catalogo-date');
  if (dateInput) {
    dateInput.addEventListener('change', (e) => {
      catalogoCurrentDate = e.target.value;
      loadCatalogo(catalogoCurrentDate);
    });
  }
  const btnNew = document.getElementById('btn-new-catalog-item');
  if (btnNew) btnNew.addEventListener('click', () => openCatalogItemEditor(null));
  const btnDup = document.getElementById('btn-duplicate-yesterday');
  if (btnDup) btnDup.addEventListener('click', duplicateFromYesterday);
  const btnClose = document.getElementById('btn-close-catalog-item');
  if (btnClose) btnClose.addEventListener('click', closeCatalogItemEditor);
  const btnSave = document.getElementById('btn-save-catalog-item');
  if (btnSave) btnSave.addEventListener('click', saveCatalogItem);
  const btnDel = document.getElementById('btn-delete-catalog-item');
  if (btnDel) btnDel.addEventListener('click', deleteCatalogItem);
  
  // Foto
  const photoInput = document.getElementById('catalog-photo-input');
  const btnUpload = document.getElementById('btn-catalog-upload-photo');
  const btnRemove = document.getElementById('btn-catalog-remove-photo');
  const preview = document.getElementById('catalog-photo-preview');
  if (btnUpload && photoInput) {
    btnUpload.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) uploadCatalogPhoto(f);
      e.target.value = '';
    });
  }
  if (preview && photoInput) {
    preview.addEventListener('click', () => { if (!uploadedPhotoUrl) photoInput.click(); });
  }
  if (btnRemove) {
    btnRemove.addEventListener('click', () => {
      uploadedPhotoUrl = null;
      updateCatalogPhotoPreview();
    });
  }
  
  const modal = document.getElementById('modal-catalog-item');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCatalogItemEditor();
    });
  }
}

window.openCatalogoPage = openCatalogoPage;
