/* ===========================================
   PORTALE CLIENTI - LOGICA
   =========================================== */

const gate = document.getElementById('gate');
const gateErrMsg = document.getElementById('gate-err-msg');
const appEl = document.getElementById('app');
const greeting = document.getElementById('c-greeting');
const heroCustomer = document.getElementById('hero-customer');
const ordersList = document.getElementById('orders-list');
const ordersCount = document.getElementById('orders-count');
const ordersEmpty = document.getElementById('orders-empty');

let me = null;
let addresses = [];

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
    // Sessione scaduta
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

// ============ MAPPING STATO ORDINE ============
// Combina customer_order_status (pending/approved/rejected) + status operativo (da_preparare/pronto/ritirato)
// e goods_type (da_ordinare/ordinata/in_cella)
function getOrderStatusChip(o) {
  if (o.customer_order_status === 'pending') {
    return { label: '⏳ In attesa di conferma', cls: 'chip-pending', cardCls: 'is-pending' };
  }
  if (o.customer_order_status === 'rejected') {
    return { label: '❌ Rifiutato', cls: 'chip-rejected', cardCls: 'is-rejected' };
  }
  if (o.status === 'ritirato') {
    return { label: '✅ Consegnato', cls: 'chip-delivered', cardCls: 'is-ritirato' };
  }
  if (o.status === 'pronto') {
    return { label: '🌸 Pronto', cls: 'chip-ready', cardCls: '' };
  }
  if (o.goods_type === 'ordinata') {
    return { label: '📦 Ordinato ai fornitori', cls: 'chip-ordered', cardCls: '' };
  }
  if (o.goods_type === 'da_ordinare') {
    return { label: '🔎 In lavorazione', cls: 'chip-preparing', cardCls: '' };
  }
  return { label: '✔️ Confermato', cls: 'chip-approved', cardCls: '' };
}

// ============ INIZIALIZZAZIONE ============
async function init() {
  // In caso di redirect con errore (?err=invalid)
  const params = new URLSearchParams(location.search);
  if (params.get('err') === 'invalid') {
    showGate('Il link che hai usato non è valido o è stato rigenerato. Contattaci per ricevere il nuovo link.');
    return;
  }
  
  try {
    me = await api('/api/c/me');
    showApp();
    greeting.textContent = me.name;
    heroCustomer.textContent = me.contact_name || me.name;
    await Promise.all([loadOrders(), loadAddresses()]);
  } catch (e) {
    if (e.message !== 'unauth') {
      showGate();
    }
  }
  
  bindEvents();
}

// ============ ORDINI ============
async function loadOrders() {
  try {
    const orders = await api('/api/c/orders');
    renderOrders(orders);
  } catch (e) {
    if (e.message !== 'unauth') showToast('Errore caricamento ordini', 'error');
  }
}

function renderOrders(orders) {
  ordersList.innerHTML = '';
  ordersCount.textContent = orders.length > 0 ? `${orders.length} ${orders.length === 1 ? 'ordine' : 'ordini'}` : '';
  
  if (orders.length === 0) {
    ordersEmpty.classList.remove('hidden');
    return;
  }
  ordersEmpty.classList.add('hidden');
  
  orders.forEach(o => {
    const chip = getOrderStatusChip(o);
    const li = document.createElement('li');
    li.className = 'order-item ' + chip.cardCls;
    
    const deliveryLine = o.delivery_type === 'consegna'
      ? `🚚 Consegna${o.delivery_time ? ' ore ' + o.delivery_time : ''}${o.delivery_address ? ' · ' + escapeHtml(o.delivery_address) : ''}`
      : '🏪 Ritiro in sede';
    
    const rejectHtml = o.customer_order_status === 'rejected' && o.customer_reject_reason
      ? `<div class="order-reject-reason"><strong>Motivo:</strong> ${escapeHtml(o.customer_reject_reason)}</div>`
      : '';
    
    li.innerHTML = `
      <div class="order-row-1">
        <div class="order-date">${formatDateHuman(o.date)}</div>
        <span class="order-status-chip ${chip.cls}">${chip.label}</span>
      </div>
      <div class="order-delivery-info">${deliveryLine}</div>
      <div class="order-description">${escapeHtml(o.description || '')}</div>
      ${rejectHtml}
      <div class="order-footer">
        <span>#${o.id}</span>
        <button class="order-toggle" data-action="toggle">Mostra tutto</button>
      </div>
    `;
    
    li.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
      const desc = li.querySelector('.order-description');
      desc.classList.toggle('expanded');
      e.target.textContent = desc.classList.contains('expanded') ? 'Nascondi' : 'Mostra tutto';
    });
    
    ordersList.appendChild(li);
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ NUOVO ORDINE ============
function openNewOrderModal() {
  document.getElementById('form-order').reset();
  document.getElementById('order-date').min = todayIso();
  document.getElementById('order-date').value = todayIso();
  refreshAddressSelect();
  toggleDeliveryFields();
  document.getElementById('modal-order').classList.remove('hidden');
}

function closeNewOrderModal() {
  document.getElementById('modal-order').classList.add('hidden');
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
  const type = document.querySelector('input[name="delivery_type"]:checked').value;
  document.getElementById('delivery-fields').classList.toggle('hidden', type !== 'consegna');
}

async function submitOrder(e) {
  e.preventDefault();
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  
  try {
    const date = document.getElementById('order-date').value;
    const delivery_type = document.querySelector('input[name="delivery_type"]:checked').value;
    const delivery_time = document.getElementById('order-time').value || null;
    const addrSel = document.getElementById('order-address-select').value;
    const addrManual = document.getElementById('order-address-manual').value.trim();
    const delivery_address = delivery_type === 'consegna' ? (addrManual || addrSel || null) : null;
    const description = document.getElementById('order-description').value.trim();
    
    if (!date || !description) {
      showToast('Compila data e articoli', 'error');
      return;
    }
    
    await api('/api/c/orders', {
      method: 'POST',
      body: JSON.stringify({ date, description, delivery_type, delivery_time, delivery_address })
    });
    
    closeNewOrderModal();
    showToast('Ordine inviato! Ti confermeremo al più presto.', 'success');
    await loadOrders();
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
    heroCustomer.textContent = me.contact_name || me.name;
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
  document.getElementById('btn-new-order').addEventListener('click', openNewOrderModal);
  const ne = document.getElementById('btn-new-order-empty');
  if (ne) ne.addEventListener('click', openNewOrderModal);
  document.getElementById('btn-close-order').addEventListener('click', closeNewOrderModal);
  document.getElementById('btn-cancel-order').addEventListener('click', closeNewOrderModal);
  document.getElementById('form-order').addEventListener('submit', submitOrder);
  document.querySelectorAll('input[name="delivery_type"]').forEach(r => {
    r.addEventListener('change', toggleDeliveryFields);
  });
  document.getElementById('btn-profile').addEventListener('click', openProfileModal);
  document.getElementById('btn-close-profile').addEventListener('click', closeProfileModal);
  document.getElementById('btn-save-profile').addEventListener('click', saveProfile);
  document.getElementById('btn-add-address').addEventListener('click', addAddress);
  document.getElementById('btn-logout').addEventListener('click', logout);
  
  // Tap fuori dal modal per chiudere
  document.querySelectorAll('.modal').forEach(m => {
    m.addEventListener('click', (e) => {
      if (e.target === m) m.classList.add('hidden');
    });
  });
}

// Avvia
init();
