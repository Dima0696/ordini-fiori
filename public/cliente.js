/* ===========================================
   PORTALE CLIENTI - LOGICA (catalogo-first)
   =========================================== */

const gate = document.getElementById('gate');
const gateErrMsg = document.getElementById('gate-err-msg');
const appEl = document.getElementById('app');
const greeting = document.getElementById('c-greeting');

let me = null;
let addresses = [];

// Catalogo + carrello
let catalog = { date: null, items: [] };
let activeCategory = '__all';
let cart = new Map(); // key = catalog_item_id, value = { item, quantity }

// ============ UTILITY ============

function showToast(message, type = '') {
  const t = document.getElementById('toast');
  t.className = 'toast ' + (type === 'error' ? 'is-error' : type === 'success' ? 'is-success' : '');
  t.textContent = message;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2800);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) {
    showGate('La sessione è scaduta. Apri di nuovo il link che ti abbiamo inviato per rientrare.');
    throw new Error('unauth');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Errore di rete' }));
    throw new Error(err.error || 'Errore');
  }
  if (res.status === 204) return null;
  return res.json();
}

function showGate(msg) {
  if (msg) gateErrMsg.textContent = msg;
  gate.classList.remove('hidden');
  appEl.classList.add('hidden');
}

function showApp() {
  gate.classList.add('hidden');
  appEl.classList.remove('hidden');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateHuman(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d)) return isoDate;
  const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const months = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtEuro(n) {
  return '€ ' + Number(n || 0).toFixed(2).replace('.', ',');
}

// ============ INIT ============
async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('err') === 'invalid') {
    showGate('Il link che hai usato non è valido o è stato rigenerato. Contattaci per ricevere il nuovo link.');
    return;
  }
  
  try {
    me = await api('/api/c/me');
    showApp();
    greeting.textContent = me.name;
    // Carico in parallelo catalogo (primario) + indirizzi (secondario)
    await Promise.all([loadCatalog(), loadAddresses()]);
  } catch (e) {
    if (e.message !== 'unauth') {
      showGate();
    }
  }
  
  bindEvents();
}

// ============ CATALOGO ============
async function loadCatalog() {
  try {
    const data = await api('/api/c/catalog');
    catalog = data || { date: null, items: [] };
    const lbl = document.getElementById('catalog-date-label');
    if (lbl) lbl.textContent = catalog.date ? `aggiornato al ${formatDateHuman(catalog.date)}` : '';
    renderCatalog();
  } catch (e) {
    if (e.message !== 'unauth') showToast('Errore caricamento catalogo', 'error');
  }
}

function renderCatalog() {
  const grid = document.getElementById('catalog-grid-c');
  const empty = document.getElementById('catalog-empty-c');
  const catsBar = document.getElementById('catalog-categories');
  
  if (!catalog.items || catalog.items.length === 0) {
    grid.innerHTML = '';
    catsBar.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  
  // Categorie
  const cats = [...new Set(catalog.items.map(i => i.category || '').filter(Boolean))].sort();
  catsBar.innerHTML = '';
  if (cats.length > 0) {
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'cat-chip' + (activeCategory === '__all' ? ' active' : '');
    allChip.textContent = 'Tutti';
    allChip.addEventListener('click', () => { activeCategory = '__all'; renderCatalog(); });
    catsBar.appendChild(allChip);
    cats.forEach(c => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cat-chip' + (activeCategory === c ? ' active' : '');
      chip.textContent = c;
      chip.addEventListener('click', () => { activeCategory = c; renderCatalog(); });
      catsBar.appendChild(chip);
    });
  }
  
  const visible = activeCategory === '__all'
    ? catalog.items
    : catalog.items.filter(i => i.category === activeCategory);
  
  grid.innerHTML = '';
  visible.forEach(item => {
    const inCart = cart.get(item.id);
    const qty = inCart ? inCart.quantity : 0;
    const step = Math.max(1, item.min_quantity || 1);
    const card = document.createElement('div');
    card.className = 'c-prod-card' + (qty > 0 ? ' in-cart' : '');
    const photoHtml = item.photo_url
      ? `<div class="c-prod-photo"><img src="${item.photo_url}" alt="${escapeHtml(item.name)}" loading="lazy">
          ${qty > 0 ? `<span class="c-prod-qty-chip">${qty}</span>` : ''}
        </div>`
      : `<div class="c-prod-photo no-photo">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          ${qty > 0 ? `<span class="c-prod-qty-chip">${qty}</span>` : ''}
        </div>`;
    
    const controlsHtml = qty > 0
      ? `<div class="c-prod-controls">
          <button type="button" class="c-qty-btn" data-act="dec" data-id="${item.id}" aria-label="Diminuisci">−</button>
          <span class="c-qty-value">${qty}</span>
          <button type="button" class="c-qty-btn" data-act="inc" data-id="${item.id}" aria-label="Aumenta">+</button>
        </div>`
      : `<button type="button" class="c-prod-add-first" data-act="add" data-id="${item.id}">Aggiungi</button>`;
    
    card.innerHTML = `
      ${photoHtml}
      <div class="c-prod-body">
        <div class="c-prod-name">${escapeHtml(item.name)}</div>
        <div class="c-prod-meta">
          <span class="c-prod-price">${item.price > 0 ? fmtEuro(item.price) : 'Prezzo a richiesta'}</span>
          <span>confezione da ${step}</span>
        </div>
        ${item.availability ? `<div class="c-prod-avail">📦 ${escapeHtml(item.availability)}</div>` : ''}
        ${controlsHtml}
      </div>
    `;
    grid.appendChild(card);
  });
  
  grid.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id);
      const act = btn.dataset.act;
      const item = catalog.items.find(i => i.id === id);
      if (!item) return;
      if (act === 'add' || act === 'inc') addToCart(item);
      else if (act === 'dec') removeFromCart(item);
    });
  });
}

// ============ CARRELLO (step = min_quantity) ============
function addToCart(item) {
  const step = Math.max(1, item.min_quantity || 1);
  const existing = cart.get(item.id);
  if (existing) {
    existing.quantity += step;
  } else {
    cart.set(item.id, { item, quantity: step });
  }
  updateCartUI();
  renderCatalog();
}

function removeFromCart(item) {
  const step = Math.max(1, item.min_quantity || 1);
  const existing = cart.get(item.id);
  if (!existing) return;
  existing.quantity -= step;
  if (existing.quantity <= 0) {
    cart.delete(item.id);
  }
  updateCartUI();
  renderCatalog();
}

function cartTotals() {
  let total = 0;
  let count = 0;
  cart.forEach(v => {
    total += (Number(v.item.price) || 0) * v.quantity;
    count += 1;
  });
  return { total, count };
}

function updateCartUI() {
  const bar = document.getElementById('cart-bar');
  const { total, count } = cartTotals();
  if (count === 0) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  document.getElementById('cart-count').textContent = count;
  document.getElementById('cart-total').textContent = total > 0 ? fmtEuro(total) : '—';
  const names = [...cart.values()].map(v => `${v.quantity}× ${v.item.name}`);
  document.getElementById('cart-summary-line').textContent =
    names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
}

function openCartModal() {
  const { total } = cartTotals();
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  if (cart.size === 0) {
    list.innerHTML = '<p class="muted" style="text-align:center;padding:1rem;">Il carrello è vuoto</p>';
  } else {
    cart.forEach(entry => {
      const { item, quantity } = entry;
      const row = document.createElement('div');
      row.className = 'cart-row';
      const lineTotal = (Number(item.price) || 0) * quantity;
      row.innerHTML = `
        <div class="cart-row-photo">
          ${item.photo_url ? `<img src="${item.photo_url}" alt="">` : ''}
        </div>
        <div class="cart-row-body">
          <div class="cart-row-name">${escapeHtml(item.name)}</div>
          <div class="cart-row-meta">${item.price > 0 ? fmtEuro(item.price) + '/cad · tot ' + fmtEuro(lineTotal) : 'Prezzo a richiesta'}</div>
        </div>
        <div class="cart-row-qty">
          <button type="button" class="c-qty-btn" data-act="dec" data-id="${item.id}">−</button>
          <span class="cart-row-qty-value">${quantity}</span>
          <button type="button" class="c-qty-btn" data-act="inc" data-id="${item.id}">+</button>
        </div>
      `;
      row.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', () => {
          const act = b.dataset.act;
          if (act === 'inc') addToCart(item);
          else removeFromCart(item);
          openCartModal();
        });
      });
      list.appendChild(row);
    });
  }
  document.getElementById('cart-footer-total').textContent = total > 0 ? fmtEuro(total) : '—';
  document.getElementById('modal-cart').classList.remove('hidden');
}

function closeCartModal() {
  document.getElementById('modal-cart').classList.add('hidden');
}

// ============ CHECKOUT ============
function openCheckoutModal() {
  if (cart.size === 0) {
    showToast('Aggiungi almeno un articolo al carrello', 'error');
    return;
  }
  
  document.getElementById('form-checkout').reset();
  const dateInp = document.getElementById('order-date');
  dateInp.min = todayIso();
  dateInp.value = todayIso();
  refreshAddressSelect();
  toggleDeliveryFields();
  
  const { total, count } = cartTotals();
  document.getElementById('checkout-items-count').textContent = count;
  document.getElementById('checkout-total').textContent = total > 0 ? fmtEuro(total) : '—';
  
  document.getElementById('modal-checkout').classList.remove('hidden');
}

function closeCheckoutModal() {
  document.getElementById('modal-checkout').classList.add('hidden');
}

function refreshAddressSelect() {
  const sel = document.getElementById('order-address-select');
  sel.innerHTML = '<option value="">— Seleziona un indirizzo salvato —</option>';
  addresses.forEach(a => {
    const text = `${a.label ? a.label + ' · ' : ''}${a.street}${a.city ? ', ' + a.city : ''}`.trim();
    const opt = document.createElement('option');
    opt.value = text;
    opt.textContent = text;
    if (a.is_default) opt.selected = true;
    sel.appendChild(opt);
  });
}

function toggleDeliveryFields() {
  const checked = document.querySelector('input[name="delivery_type"]:checked');
  const type = checked ? checked.value : 'ritiro';
  document.getElementById('delivery-fields').classList.toggle('hidden', type !== 'consegna');
}

async function submitOrder(e) {
  if (e) e.preventDefault();
  
  if (cart.size === 0) {
    showToast('Carrello vuoto', 'error');
    return;
  }
  
  const date = document.getElementById('order-date').value;
  if (!date) {
    showToast('Seleziona la data', 'error');
    return;
  }
  
  const delivery_type = document.querySelector('input[name="delivery_type"]:checked').value;
  const delivery_time = document.getElementById('order-time').value || null;
  const addrSel = document.getElementById('order-address-select').value;
  const addrManual = document.getElementById('order-address-manual').value.trim();
  const delivery_address = delivery_type === 'consegna' ? (addrManual || addrSel || null) : null;
  
  const items = [...cart.values()].map(v => ({
    catalog_item_id: v.item.id,
    name: v.item.name,
    category: v.item.category || '',
    photo_url: v.item.photo_url || '',
    quantity: v.quantity,
    unit_price: Number(v.item.price) || 0
  }));
  
  const btn = document.getElementById('btn-checkout-submit');
  if (btn) btn.disabled = true;
  
  try {
    await api('/api/c/orders', {
      method: 'POST',
      body: JSON.stringify({ date, delivery_type, delivery_time, delivery_address, items })
    });
    
    // Reset + chiusura
    cart.clear();
    updateCartUI();
    renderCatalog();
    closeCheckoutModal();
    closeCartModal();
    showToast('Ordine inviato! Ti confermeremo al più presto.', 'success');
  } catch (err) {
    showToast(err.message || 'Errore invio ordine', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ============ PROFILO & INDIRIZZI ============
function openProfileModal() {
  document.getElementById('prof-name').value = me.name || '';
  document.getElementById('prof-contact').value = me.contact_name || '';
  document.getElementById('prof-email').value = me.email || '';
  document.getElementById('prof-phone').value = me.phone || '';
  renderAddresses();
  document.getElementById('modal-profile').classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('modal-profile').classList.add('hidden');
}

async function loadAddresses() {
  try {
    addresses = await api('/api/c/addresses');
  } catch (e) {
    addresses = [];
  }
}

function renderAddresses() {
  const ul = document.getElementById('addresses-list');
  ul.innerHTML = '';
  
  if (addresses.length === 0) {
    const li = document.createElement('li');
    li.style.color = 'var(--c-text-3)';
    li.style.fontSize = '0.9rem';
    li.textContent = 'Nessun indirizzo salvato. Aggiungilo qui sotto per averlo pronto nei prossimi ordini.';
    ul.appendChild(li);
    return;
  }
  
  addresses.forEach(a => {
    const li = document.createElement('li');
    li.className = 'address-item' + (a.is_default ? ' is-default' : '');
    li.innerHTML = `
      <div class="address-info">
        <div class="address-label">
          ${escapeHtml(a.label || 'Indirizzo')}
          ${a.is_default ? '<span class="address-default-tag">PREDEFINITO</span>' : ''}
        </div>
        <div class="address-detail">
          ${escapeHtml(a.street || '')}${a.city ? ', ' + escapeHtml(a.city) : ''}
          ${a.notes ? '<br>' + escapeHtml(a.notes) : ''}
        </div>
      </div>
      <button class="address-delete" data-id="${a.id}" title="Elimina indirizzo" aria-label="Elimina">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    `;
    li.querySelector('.address-delete').addEventListener('click', () => deleteAddress(a.id));
    ul.appendChild(li);
  });
}

async function saveProfile() {
  try {
    const updated = await api('/api/c/me', {
      method: 'PUT',
      body: JSON.stringify({
        contact_name: document.getElementById('prof-contact').value.trim(),
        email: document.getElementById('prof-email').value.trim(),
        phone: document.getElementById('prof-phone').value.trim()
      })
    });
    me = { ...me, ...updated };
    showToast('Profilo aggiornato', 'success');
  } catch (e) {
    showToast(e.message || 'Errore salvataggio', 'error');
  }
}

async function addAddress() {
  const label = document.getElementById('addr-label').value.trim();
  const street = document.getElementById('addr-street').value.trim();
  const city = document.getElementById('addr-city').value.trim();
  const notes = document.getElementById('addr-notes').value.trim();
  const is_default = document.getElementById('addr-default').checked;
  
  if (!street) {
    showToast('Inserisci almeno la via', 'error');
    return;
  }
  
  try {
    await api('/api/c/addresses', {
      method: 'POST',
      body: JSON.stringify({ label, street, city, notes, is_default })
    });
    document.getElementById('addr-label').value = '';
    document.getElementById('addr-street').value = '';
    document.getElementById('addr-city').value = '';
    document.getElementById('addr-notes').value = '';
    document.getElementById('addr-default').checked = false;
    await loadAddresses();
    renderAddresses();
    showToast('Indirizzo aggiunto', 'success');
  } catch (e) {
    showToast(e.message || 'Errore', 'error');
  }
}

async function deleteAddress(id) {
  if (!confirm('Eliminare questo indirizzo?')) return;
  try {
    await api('/api/c/addresses/' + id, { method: 'DELETE' });
    await loadAddresses();
    renderAddresses();
    showToast('Indirizzo eliminato', 'success');
  } catch (e) {
    showToast(e.message || 'Errore', 'error');
  }
}

// ============ LOGOUT ============
async function logout() {
  if (!confirm('Vuoi uscire dal portale?')) return;
  try {
    await fetch('/api/c/logout', { method: 'POST', credentials: 'same-origin' });
  } catch { /* ignore */ }
  showGate('Sei uscito dal portale. Apri di nuovo il link personale per rientrare.');
}

// ============ EVENT BINDING ============
function bindEvents() {
  // Carrello bar
  const btnCartView = document.getElementById('btn-cart-view');
  if (btnCartView) btnCartView.addEventListener('click', openCartModal);
  const btnCartSubmit = document.getElementById('btn-cart-submit');
  if (btnCartSubmit) btnCartSubmit.addEventListener('click', openCheckoutModal);
  
  // Modal cart
  const btnCloseCart = document.getElementById('btn-close-cart');
  if (btnCloseCart) btnCloseCart.addEventListener('click', closeCartModal);
  const btnCartKeep = document.getElementById('btn-cart-keep');
  if (btnCartKeep) btnCartKeep.addEventListener('click', closeCartModal);
  const btnCartProceed = document.getElementById('btn-cart-proceed');
  if (btnCartProceed) btnCartProceed.addEventListener('click', () => {
    closeCartModal();
    openCheckoutModal();
  });
  
  // Modal checkout
  const btnCloseCheckout = document.getElementById('btn-close-checkout');
  if (btnCloseCheckout) btnCloseCheckout.addEventListener('click', closeCheckoutModal);
  const btnCheckoutBack = document.getElementById('btn-checkout-back');
  if (btnCheckoutBack) btnCheckoutBack.addEventListener('click', closeCheckoutModal);
  const formCheckout = document.getElementById('form-checkout');
  if (formCheckout) formCheckout.addEventListener('submit', submitOrder);
  document.querySelectorAll('input[name="delivery_type"]').forEach(r => {
    r.addEventListener('change', toggleDeliveryFields);
  });
  
  // Profilo
  document.getElementById('btn-profile').addEventListener('click', openProfileModal);
  document.getElementById('btn-close-profile').addEventListener('click', closeProfileModal);
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-add-address').addEventListener('click', addAddress);
  document.getElementById('btn-logout').addEventListener('click', logout);
  
  // Click fuori modal per chiudere
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.add('hidden');
    });
  });
}

// Avvia
init();
