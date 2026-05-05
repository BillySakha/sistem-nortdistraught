// ===================== CONFIG =====================
const WEBHOOK_GET_PRODUCTS = 'https://primary-production-02f5b.up.railway.app/webhook/get-produk';
const WEBHOOK_ORDER = 'https://primary-production-02f5b.up.railway.app/webhook/input-order';
const WEBHOOK_RESTOCK = 'https://primary-production-02f5b.up.railway.app/webhook/restock-stok';
const WEBHOOK_EDIT_STOK = 'https://primary-production-02f5b.up.railway.app/webhook/edit-stok';

// ===================== TELEGRAM INIT =====================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}
const getChatId = () => String(tg?.initDataUnsafe?.user?.id || '');

// ===================== DATA STATE =====================
let products = [];
let stokData = JSON.parse(localStorage.getItem('stokData')) || {};
let orderHistory = JSON.parse(localStorage.getItem('orderHistory')) || [];
let currentPeriod = 'hari';

// Penampung data sementara saat modal dibuka
let restockTarget = { produkId: '', produkName: '', size: '', color: '', qty: 1 };
let editTarget = { produkId: '', produkName: '', size: '', color: '' };

// ===================== UTILS =====================
function fixGDriveLink(url) {
  if (!url) return '';
  const fileId = url.match(/\/d\/([^\/]+)/);
  return fileId ? `https://lh3.googleusercontent.com/d/${fileId[1]}` : url;
}

function saveStok() {
  localStorage.setItem('stokData', JSON.stringify(stokData));
}

function saveHistory() {
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
}

function formatRp(num) {
  return 'Rp' + num.toLocaleString('id-ID');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ===================== CORE LOGIC: FETCH DATA =====================
async function fetchProducts() {
  try {
    const response = await fetch(WEBHOOK_GET_PRODUCTS);
    const rawData = await response.json();
    if (!rawData || rawData.length === 0) return;

    const grouped = rawData.reduce((acc, item) => {
      const name = item['Nama Produk'];
      if (!name) return acc;

      if (!acc[name]) {
        acc[name] = {
          id: item['ID Produk'] || 'P000',
          name: name,
          sizes: [],
          colors: [],
          hpp: item['HPP'] ? parseInt(item['HPP'].toString().replace(/\D/g, '')) : 0,
          harga: item['Harga Jual'] ? parseInt(item['Harga Jual'].toString().replace(/\D/g, '')) : 0,
          image: fixGDriveLink(item['Gambar Produk']),
          selectedSize: item['Varian Size'] || '',
          selectedColor: (item['Varian Warna '] || item['Varian Warna'] || '').trim(),
          selectedPlatform: 'TikTok',
          quantity: 0,
        };
      }

      if (item['Varian Size'] && !acc[name].sizes.includes(item['Varian Size'])) {
        acc[name].sizes.push(item['Varian Size']);
      }

      const colorTrimmed = (item['Varian Warna '] || item['Varian Warna'] || '').trim();
      if (colorTrimmed && !acc[name].colors.includes(colorTrimmed)) {
        acc[name].colors.push(colorTrimmed);
      }

      // Sync stokData (Kalau di Sheets ada angka stok, kita ambil)
      const key = `${acc[name].id}_${item['Varian Size']}_${colorTrimmed}`;
      if (item['Stok Sisa'] !== undefined) {
        stokData[key] = parseInt(item['Stok Sisa']) || 0;
      } else if (stokData[key] === undefined) {
        stokData[key] = 0;
      }

      return acc;
    }, {});

    products = Object.values(grouped);
    saveStok();
    renderProducts();
  } catch (e) {
    console.error('Fetch error:', e);
    showToast('Gagal memuat data server');
  }
}

// ===================== UI RENDERING =====================
function renderProducts() {
  const container = document.getElementById('product-list');
  if (!container) return;

  container.innerHTML = products
    .map((p) => {
      const stokKey = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
      const sisaStok = stokData[stokKey] ?? 0;

      const sizeChips = p.sizes.map((s) => `<div class="chip ${p.selectedSize === s ? 'active' : ''}" onclick="selectVariant('${p.id}','size','${s}')">${s}</div>`).join('');

      const colorChips = p.colors.map((c) => `<div class="chip ${p.selectedColor === c ? 'active' : ''}" onclick="selectVariant('${p.id}','color','${c}')">${c}</div>`).join('');

      const platformChips = ['TikTok', 'Shopee'].map((pl) => `<div class="platform-chip ${p.selectedPlatform === pl ? 'active' : ''}" onclick="selectVariant('${p.id}','platform','${pl}')">${pl}</div>`).join('');

      return `
      <div class="product-card ${p.quantity > 0 ? 'has-qty' : ''}">
        <div class="product-thumb">
          ${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : `<div class="thumb-icon">👕</div>`}
        </div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-price">Rp${p.harga.toLocaleString('id')}</div>
          <div class="chip-group"><div class="chip-label">UKURAN</div><div class="chip-row">${sizeChips}</div></div>
          <div class="chip-group"><div class="chip-label">WARNA</div><div class="chip-row">${colorChips}</div></div>
          <div class="chip-group"><div class="chip-label">PLATFORM</div><div class="chip-row">${platformChips}</div></div>
          <div class="qty-row">
            <div class="qty-label">STOK: ${sisaStok} pcs</div>
            <div class="qty-ctrl">
              <button class="qty-btn" onclick="updateQty('${p.id}',-1)">−</button>
              <span class="qty-num ${p.quantity > 0 ? 'active' : ''}">${p.quantity}</span>
              <button class="qty-btn" onclick="updateQty('${p.id}',1)">+</button>
            </div>
          </div>
        </div>
      </div>`;
    })
    .join('');
  updateBottomBar();
}

// ===================== INTERACTION =====================
function selectVariant(id, type, value) {
  const p = products.find((p) => p.id === id);
  if (!p) return;
  if (type === 'size') p.selectedSize = value;
  if (type === 'color') p.selectedColor = value;
  if (type === 'platform') p.selectedPlatform = value;
  renderProducts();
}

function updateQty(id, delta) {
  const p = products.find((p) => p.id === id);
  if (!p) return;
  const stokKey = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
  const sisaStok = stokData[stokKey] ?? 0;

  if (delta > 0 && p.quantity >= sisaStok) {
    showToast('Stok tidak cukup!');
    return;
  }
  p.quantity = Math.max(0, p.quantity + delta);
  renderProducts();
}

function updateBottomBar() {
  const total = products.reduce((sum, p) => sum + p.quantity, 0);
  document.getElementById('total-item-count').textContent = `${total} item`;
  document.getElementById('btn-kirim').disabled = total === 0;
}

// ===================== RESTOCK MODAL LOGIC =====================
function openRestock(produkId, produkName, size, color) {
  restockTarget = { produkId, produkName, size, color, qty: 1 };
  document.getElementById('restock-produk-name').textContent = produkName;
  document.getElementById('restock-varian-name').textContent = `${size} · ${color}`;
  document.getElementById('restock-qty').textContent = '1';
  document.getElementById('restock-modal').classList.add('show');
}

function changeRestockQty(delta) {
  restockTarget.qty = Math.max(1, restockTarget.qty + delta);
  document.getElementById('restock-qty').textContent = restockTarget.qty;
}

function closeRestock() {
  document.getElementById('restock-modal').classList.remove('show');
}

async function submitRestock() {
  const { produkId, produkName, size, color, qty } = restockTarget;
  const key = `${produkId}_${size}_${color}`;
  const stokLama = stokData[key] || 0;

  stokData[key] = stokLama + qty;

  const dataKeN8n = {
    'ID Produk': produkId,
    'Nama Produk': produkName,
    'Varian Size': size,
    'Varian Warna': color,
    'Stok Awal': stokLama,
    'Stok Masuk': qty,
    'Stok Sisa': stokData[key],
    Key: key,
    chat_id: getChatId(),
  };

  const btn = document.querySelector('#restock-modal .btn-confirm');
  btn.disabled = true;
  btn.textContent = 'MENGIRIM...';

  try {
    await fetch(WEBHOOK_RESTOCK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataKeN8n),
    });
    showToast(`✓ Berhasil restock ${qty} pcs!`);
    saveStok();
    closeRestock();
    if (document.getElementById('tab-stok').classList.contains('active')) renderStok();
    renderProducts();
  } catch (e) {
    showToast('Gagal kirim ke server');
  } finally {
    btn.disabled = false;
    btn.textContent = 'KONFIRMASI';
  }
}

// ===================== EDIT STOK LOGIC =====================
function openEditStok(produkId, produkName, size, color, qty) {
  editTarget = { produkId, produkName, size, color };
  document.getElementById('edit-produk-name').textContent = produkName;
  document.getElementById('edit-varian-name').textContent = `${size} · ${color}`;
  document.getElementById('edit-qty-input').value = qty;
  document.getElementById('edit-stok-modal').classList.add('show');
}

function closeEditStok() {
  document.getElementById('edit-stok-modal').classList.remove('show');
}

async function submitEditStok() {
  const { produkId, produkName, size, color } = editTarget;
  const qtyBaru = parseInt(document.getElementById('edit-qty-input').value) || 0;
  const key = `${produkId}_${size}_${color}`;

  stokData[key] = qtyBaru;
  saveStok();

  const dataKeN8nEdit = {
    'ID Produk': produkId,
    'Nama Produk': produkName,
    'Varian Size': size,
    'Varian Warna': color,
    'Stok Baru': qtyBaru,
    'Stok Sisa': qtyBaru,
    Key: key,
    chat_id: getChatId(),
  };

  try {
    await fetch(WEBHOOK_EDIT_STOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataKeN8nEdit),
    });
    showToast(`✓ Stok diupdate!`);
    closeEditStok();
    renderStok();
    renderProducts();
  } catch (e) {
    showToast('Gagal update server');
  }
}

// ===================== TABS & OTHERS =====================
function switchTab(tab) {
  document.querySelectorAll('.tab-content, .tab').forEach((el) => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('bottom-bar').style.display = tab === 'order' ? 'flex' : 'none';
  if (tab === 'stok') renderStok();
  if (tab === 'laporan') renderLaporan();
}

function renderStok() {
  const container = document.getElementById('stok-list');
  if (!container) return;
  container.innerHTML = products
    .map((p) => {
      const rows = p.sizes
        .flatMap((s) =>
          p.colors.map((c) => {
            const key = `${p.id}_${s}_${c}`;
            const qty = stokData[key] ?? 0;
            return `
        <div class="stok-row">
          <div class="stok-varian-info"><span class="stok-varian">${s} · ${c}</span></div>
          <div class="stok-actions">
            <span class="badge ${qty === 0 ? 'empty' : qty <= 3 ? 'low' : 'ok'}">${qty} pcs</span>
            <button class="stok-restock-btn" onclick="openRestock('${p.id}','${p.name}','${s}','${c}')">+ RESTOCK</button>
            <button class="stok-edit-btn" onclick="openEditStok('${p.id}','${p.name}','${s}','${c}',${qty})">✏️ EDIT</button>
          </div>
        </div>`;
          }),
        )
        .join('');
      return `<div class="stok-card"><div class="stok-header"><div class="stok-name">${p.name}</div></div>${rows}</div>`;
    })
    .join('');
}

async function kirimLaporan() {
  const items = products.filter((p) => p.quantity > 0);
  const btn = document.getElementById('btn-kirim');
  btn.disabled = true;
  btn.textContent = 'MENGIRIM...';

  for (const p of items) {
    const total = p.harga * p.quantity;
    const potongan = Math.round(total * 0.15);
    const data = {
      chat_id: getChatId(),
      id_produk: p.id,
      nama_produk: p.name,
      varian: `${p.selectedSize}-${p.selectedColor}`,
      jumlah: p.quantity,
      harga_jual: p.harga,
      hpp: p.hpp,
      platform: p.selectedPlatform,
    };

    try {
      await fetch(WEBHOOK_ORDER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const key = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
      stokData[key] = Math.max(0, (stokData[key] ?? 0) - p.quantity);
      saveStok();
      orderHistory.unshift({
        tanggal: new Date().toLocaleDateString('id-ID'),
        nama_produk: p.name,
        varian: `${p.selectedSize}-${p.selectedColor}`,
        jumlah: p.quantity,
        total_penjualan: total,
        untung_bersih: total - potongan - p.hpp * p.quantity,
        platform: p.selectedPlatform,
      });
      saveHistory();
    } catch (e) {
      console.error(e);
    }
  }

  products.forEach((p) => (p.quantity = 0));
  renderProducts();
  showToast('✓ Order berhasil!');
  btn.disabled = false;
  btn.textContent = 'KIRIM ORDER';
}

function renderLaporan() {
  const filtered = orderHistory.filter((o) => {
    if (currentPeriod === 'hari') return o.tanggal === new Date().toLocaleDateString('id-ID');
    return true;
  });
  document.getElementById('stat-penjualan').textContent = formatRp(filtered.reduce((s, o) => s + o.total_penjualan, 0));
  document.getElementById('stat-untung').textContent = formatRp(filtered.reduce((s, o) => s + o.untung_bersih, 0));
  document.getElementById('stat-order').textContent = filtered.length;
  document.getElementById('order-history').innerHTML =
    filtered
      .map(
        (o) => `
    <div class="order-history-item">
      <div class="order-history-top">
        <div class="order-history-name">${o.nama_produk}</div>
        <div class="order-history-untung">+${formatRp(o.untung_bersih)}</div>
      </div>
      <div class="order-history-detail">${o.varian} · ${o.jumlah} pcs · ${o.platform}</div>
    </div>
  `,
      )
      .join('') || '<div class="empty-state">Belum ada order</div>';
}

window.onload = fetchProducts;
