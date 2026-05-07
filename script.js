// ===================== CONFIG =====================
const WEBHOOK_GET_PRODUCTS = 'https://primary-production-02f5b.up.railway.app/webhook/get-produk';
const WEBHOOK_ORDER = 'https://primary-production-02f5b.up.railway.app/webhook/input-order';
const WEBHOOK_RESTOCK = 'https://primary-production-02f5b.up.railway.app/webhook/restock-stok';
const WEBHOOK_EDIT_STOK = 'https://primary-production-02f5b.up.railway.app/webhook/edit-stok';

// ===================== TELEGRAM =====================
const tg = window.Telegram?.WebApp || null;

function init() {
  if (tg) {
    tg.ready();
    tg.expand();
  }
  fetchProducts();
}

const getChatId = () => String(tg?.initDataUnsafe?.user?.id || '');

// ===================== STATE =====================
let products = [];
let stokData = {};
let orderHistory = [];

try {
  stokData = JSON.parse(localStorage.getItem('stokData')) || {};
} catch (_) {
  stokData = {};
}
try {
  orderHistory = JSON.parse(localStorage.getItem('orderHistory')) || [];
} catch (_) {
  orderHistory = [];
}

// Modal state
let restockTarget = { produkId: '', produkName: '', size: '', color: '', qty: 1 };
let editTarget = { produkId: '', produkName: '', size: '', color: '' };
let isSubmitting = false;

// ===================== UTILS =====================
function saveStok() {
  try {
    localStorage.setItem('stokData', JSON.stringify(stokData));
  } catch (_) {}
}

function saveHistory() {
  try {
    localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
  } catch (_) {}
}

function fixGDriveLink(url) {
  if (!url) return '';
  const match = url.match(/\/d\/([^\/]+)/);
  return match ? `https://lh3.googleusercontent.com/u/0/d/${match[1]}` : url;
}

function formatRp(num) {
  return 'Rp' + Number(num).toLocaleString('id-ID');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function getStokKey(produkId, size, color) {
  return `${produkId}_${size}_${color}`;
}

function getStokSisa(produkId, size, color) {
  const key = getStokKey(produkId, size, color);
  return stokData[key]?.sisa ?? 0;
}

// ===================== FETCH & SYNC =====================
async function fetchProducts() {
  try {
    const res = await fetch(WEBHOOK_GET_PRODUCTS);
    const rawData = await res.json();

    if (!rawData || rawData.length === 0) {
      renderProducts();
      return;
    }

    const grouped = {};

    rawData.forEach((item) => {
      const name = item['Nama Produk'];
      if (!name) return;

      const produkId = item['ID Produk'] || 'P000';
      const size = (item['Varian Size'] || '').trim();
      const color = (item['Varian Warna '] || item['Varian Warna'] || '').trim();
      const serverAwal = parseInt(item['Stok Awal']) || 0;
      const serverMasuk = parseInt(item['Stok Masuk']) || 0;
      const serverSisa = parseInt(item['Stok Sisa']) || 0;
      const key = getStokKey(produkId, size, color);

      // Sinkronisasi lokal ↔ server: server menang jika sisa-nya >= nilai lokal
      if (!stokData[key] || serverSisa >= (stokData[key]?.sisa ?? 0)) {
        stokData[key] = { awal: serverAwal, masuk: serverMasuk, sisa: serverSisa };
      }

      if (!grouped[name]) {
        grouped[name] = {
          id: produkId,
          name: name,
          sizes: [],
          colors: [],
          hpp: parseInt(item['HPP']?.toString().replace(/\D/g, '')) || 0,
          harga: parseInt(item['Harga Jual']?.toString().replace(/\D/g, '')) || 0,
          image: fixGDriveLink(item['Gambar Produk']),
          selectedSize: size,
          selectedColor: color,
          selectedPlatform: 'TikTok',
          quantity: 0,
        };
      }

      if (size && !grouped[name].sizes.includes(size)) grouped[name].sizes.push(size);
      if (color && !grouped[name].colors.includes(color)) grouped[name].colors.push(color);
    });

    products = Object.values(grouped);
    saveStok();
    renderProducts();
  } catch (err) {
    console.error('fetchProducts error:', err);
    renderProducts(); // Render dari data lokal jika ada
  }
}

// ===================== RENDER: PRODUCT LIST (ORDER TAB) =====================
function renderProducts() {
  const container = document.getElementById('product-list');
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="loading-state-text">MEMUAT DATA...</div>
      </div>`;
    updateBottomBar();
    return;
  }

  container.innerHTML = products
    .map((p) => {
      const sisa = getStokSisa(p.id, p.selectedSize, p.selectedColor);

      const sizeChips = p.sizes
        .map(
          (s) =>
            `<div class="chip ${p.selectedSize === s ? 'active' : ''}"
            onclick="selectVariant('${p.id}','size','${escHtml(s)}')">${escHtml(s)}</div>`,
        )
        .join('');

      const colorChips = p.colors
        .map(
          (c) =>
            `<div class="chip ${p.selectedColor === c ? 'active' : ''}"
            onclick="selectVariant('${p.id}','color','${escHtml(c)}')">${escHtml(c)}</div>`,
        )
        .join('');

      const platformChips = ['TikTok', 'Shopee']
        .map(
          (pl) =>
            `<div class="platform-chip ${p.selectedPlatform === pl ? 'active' : ''}"
            onclick="selectVariant('${p.id}','platform','${pl}')">${pl}</div>`,
        )
        .join('');

      const imgHtml = p.image
        ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'thumb-icon\\'>👕</div>'">`
        : `<div class="thumb-icon">👕</div>`;

      // Stok badge color
      const stokColor = sisa === 0 ? '#c0392b' : sisa <= 3 ? '#b05a00' : '#1a7a4a';

      return `
      <div class="product-card ${p.quantity > 0 ? 'has-qty' : ''}">
        <div class="product-thumb">${imgHtml}</div>
        <div class="product-body">

          <div class="product-name">${escHtml(p.name)}</div>
          <div class="product-price">${formatRp(p.harga)}</div>

          ${
            p.sizes.length > 0
              ? `
          <div class="chip-group">
            <span class="chip-label">UKURAN</span>
            <div class="chip-row">${sizeChips}</div>
          </div>`
              : ''
          }

          ${
            p.colors.length > 0
              ? `
          <div class="chip-group">
            <span class="chip-label">WARNA</span>
            <div class="chip-row">${colorChips}</div>
          </div>`
              : ''
          }

          <div class="chip-group">
            <span class="chip-label">PLATFORM</span>
            <div class="chip-row">${platformChips}</div>
          </div>

          <div class="qty-row">
            <div class="product-stok" style="color:${stokColor}">
              ${sisa > 0 ? `${sisa} pcs` : 'HABIS'}
            </div>
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

// ===================== RENDER: STOK LIST =====================
function renderStok() {
  const container = document.getElementById('stok-list');
  if (!container) return;

  if (products.length === 0) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="loading-state-text">BELUM ADA DATA PRODUK</div>
      </div>`;
    return;
  }

  container.innerHTML = products
    .map((p) => {
      const rows = p.sizes
        .flatMap((s) =>
          p.colors.map((c) => {
            const key = getStokKey(p.id, s, c);
            const sisa = stokData[key]?.sisa ?? 0;
            const badgeClass = sisa === 0 ? 'empty' : sisa <= 3 ? 'low' : 'ok';

            return `
        <div class="stok-row">
          <div class="stok-varian-info">
            <span class="stok-varian">${escHtml(s)} · ${escHtml(c)}</span>
          </div>
          <div class="stok-actions-cell">
            <span class="badge ${badgeClass}">${sisa} pcs</span>
            <button class="stok-edit-btn"
              onclick="openEditStok('${p.id}','${escHtml(p.name)}','${escHtml(s)}','${escHtml(c)}',${sisa})">
              EDIT
            </button>
            <button class="stok-restock-btn"
              onclick="openRestock('${p.id}','${escHtml(p.name)}','${escHtml(s)}','${escHtml(c)}')">
              + STOK
            </button>
          </div>
        </div>`;
          }),
        )
        .join('');

      return `
    <div class="stok-card">
      <div class="stok-header">
        <div class="stok-name">${escHtml(p.name)}</div>
      </div>
      ${rows}
    </div>`;
    })
    .join('');
}

// ===================== TAB SWITCHING =====================
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'));

  const targetContent = document.getElementById('tab-' + tabName);
  const targetBtn = document.querySelector(`[data-tab="${tabName}"]`);

  if (targetContent) targetContent.classList.add('active');
  if (targetBtn) targetBtn.classList.add('active');

  const bottomBar = document.getElementById('bottom-bar');
  if (bottomBar) {
    bottomBar.style.display = tabName === 'order' ? 'flex' : 'none';
  }

  if (tabName === 'stok') renderStok();
}

// ===================== VARIANT SELECTION =====================
function selectVariant(produkId, type, value) {
  const p = products.find((p) => p.id === produkId);
  if (!p) return;

  if (type === 'size') p.selectedSize = value;
  if (type === 'color') p.selectedColor = value;
  if (type === 'platform') p.selectedPlatform = value;

  renderProducts();
}

// ===================== QUANTITY CONTROLS =====================
function updateQty(produkId, delta) {
  const p = products.find((p) => p.id === produkId);
  if (!p) return;

  const sisa = getStokSisa(p.id, p.selectedSize, p.selectedColor);

  if (delta > 0 && p.quantity >= sisa) {
    showToast('⚠️ Stok habis!');
    return;
  }

  p.quantity = Math.max(0, p.quantity + delta);
  renderProducts();
}

function updateBottomBar() {
  const total = products.reduce((sum, p) => sum + p.quantity, 0);

  const countEl = document.getElementById('total-item-count');
  if (countEl) countEl.textContent = `${total} item`;

  const btn = document.getElementById('btn-kirim');
  if (btn) btn.disabled = total === 0;
}

// ===================== RESTOCK MODAL =====================
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
  if (isSubmitting) return;

  const { produkId, produkName, size, color, qty } = restockTarget;
  const key = getStokKey(produkId, size, color);
  const current = stokData[key] || { awal: 0, masuk: 0, sisa: 0 };

  // Logika: input pertama → Stok Awal; input berikutnya → Stok Masuk
  let newAwal = current.awal;
  let newMasuk = current.masuk;

  if (newAwal === 0) {
    newAwal = qty;
    newMasuk = 0;
  } else {
    newMasuk = (current.masuk || 0) + qty;
  }

  const newSisa = newAwal + newMasuk;

  // --- OPTIMISTIC UI ---
  stokData[key] = { awal: newAwal, masuk: newMasuk, sisa: newSisa };
  saveStok();
  renderProducts();
  if (document.getElementById('tab-stok')?.classList.contains('active')) renderStok();

  showToast(`✓ Stok diperbarui: ${newSisa} pcs`);
  closeRestock();

  // --- SYNC TO SERVER ---
  isSubmitting = true;
  try {
    await fetch(WEBHOOK_RESTOCK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'ID Produk': produkId,
        'Nama Produk': produkName,
        'Varian Size': size,
        'Varian Warna': color,
        'Stok Awal': newAwal,
        'Stok Masuk': newMasuk,
        'Stok Sisa': newSisa,
        Key: key,
        chat_id: getChatId(),
      }),
    });
  } catch (err) {
    console.error('Restock sync error (lokal tetap aman):', err);
  } finally {
    isSubmitting = false;
  }
}

// ===================== EDIT STOK MODAL =====================
function openEditStok(produkId, produkName, size, color, currentQty) {
  editTarget = { produkId, produkName, size, color };

  document.getElementById('edit-produk-name').textContent = produkName;
  document.getElementById('edit-varian-name').textContent = `${size} · ${color}`;
  document.getElementById('edit-qty-input').value = currentQty;
  document.getElementById('edit-stok-modal').classList.add('show');
}

function closeEditStok() {
  document.getElementById('edit-stok-modal').classList.remove('show');
}

async function submitEditStok() {
  if (isSubmitting) return;

  const { produkId, produkName, size, color } = editTarget;
  const inputVal = document.getElementById('edit-qty-input').value;
  const qtyBaru = Math.max(0, parseInt(inputVal) || 0);
  const key = getStokKey(produkId, size, color);

  // --- OPTIMISTIC UI ---
  stokData[key] = { awal: qtyBaru, masuk: 0, sisa: qtyBaru };
  saveStok();
  renderStok();
  renderProducts();
  closeEditStok();
  showToast(`✓ Stok berhasil direset ke ${qtyBaru}`);

  // --- SYNC TO SERVER ---
  isSubmitting = true;
  try {
    await fetch(WEBHOOK_EDIT_STOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'ID Produk': produkId,
        'Nama Produk': produkName,
        'Varian Size': size,
        'Varian Warna': color,
        'Stok Baru': qtyBaru,
        'Stok Sisa': qtyBaru,
        Key: key,
        chat_id: getChatId(),
      }),
    });
  } catch (err) {
    console.error('Edit stok sync error:', err);
  } finally {
    isSubmitting = false;
  }
}

// ===================== KIRIM ORDER =====================
async function kirimLaporan() {
  const items = products.filter((p) => p.quantity > 0);
  if (items.length === 0) {
    showToast('⚠️ Belum ada item yang dipilih!');
    return;
  }

  const btn = document.getElementById('btn-kirim');
  if (btn) {
    btn.disabled = true;
    btn.querySelector('span').textContent = 'MENGIRIM...';
  }

  let allSuccess = true;

  for (const p of items) {
    const key = getStokKey(p.id, p.selectedSize, p.selectedColor);
    const total = p.harga * p.quantity;
    const potongan = Math.round(total * 0.15);
    const untungBersih = total - potongan - p.hpp * p.quantity;

    try {
      await fetch(WEBHOOK_ORDER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: getChatId(),
          id_produk: p.id,
          nama_produk: p.name,
          varian: `${p.selectedSize}-${p.selectedColor}`,
          jumlah: p.quantity,
          harga_jual: p.harga,
          hpp: p.hpp,
          platform: p.selectedPlatform,
        }),
      });

      // Update stok lokal setelah order terkirim
      if (stokData[key]) {
        stokData[key].sisa = Math.max(0, (stokData[key].sisa ?? 0) - p.quantity);
        saveStok();
      }

      // Simpan ke history
      orderHistory.unshift({
        tanggal: new Date().toLocaleDateString('id-ID'),
        nama_produk: p.name,
        varian: `${p.selectedSize}-${p.selectedColor}`,
        jumlah: p.quantity,
        total_penjualan: total,
        untung_bersih: untungBersih,
        platform: p.selectedPlatform,
      });
      saveHistory();

      // Delay antar request agar n8n / Google Sheets tidak kewalahan
      await sleep(1000);
    } catch (err) {
      console.error(`Gagal kirim order: ${p.name}`, err);
      allSuccess = false;
    }
  }

  // Kirim ringkasan via Telegram sendData (jika di lingkungan Telegram)
  if (tg?.sendData) {
    const lines = items.map((p) => `${p.name} | ${p.selectedSize} | ${p.selectedColor} | ${p.selectedPlatform} | x${p.quantity}`);
    const report = `ORDER NOTDISTRAUGHT\n${new Date().toLocaleString('id-ID')}\n\n${lines.join('\n')}`;
    try {
      tg.sendData(report);
    } catch (_) {}
  }

  // Reset semua quantity
  products.forEach((p) => (p.quantity = 0));
  renderProducts();

  if (allSuccess) {
    showToast('✓ Semua order berhasil terkirim!');
  } else {
    showToast('⚠️ Sebagian order gagal — cek koneksi!');
  }

  if (btn) {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'KIRIM ORDER';
  }
}

// ===================== SECURITY HELPER =====================
function escHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ===================== BOOT =====================
window.onload = init;
