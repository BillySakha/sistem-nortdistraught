// ===================== CONFIG =====================
const WEBHOOK_GET_PRODUCTS = 'https://primary-production-02f5b.up.railway.app/webhook/get-produk';
const WEBHOOK_ORDER = 'https://primary-production-02f5b.up.railway.app/webhook/input-order';
const WEBHOOK_RESTOCK = 'https://primary-production-02f5b.up.railway.app/webhook/restock-stok';
const WEBHOOK_EDIT_STOK = 'https://primary-production-02f5b.up.railway.app/webhook/edit-stok';

// ===================== TELEGRAM & STATE =====================
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}
const getChatId = () => String(tg?.initDataUnsafe?.user?.id || '');

let products = [];
let stokData = JSON.parse(localStorage.getItem('stokData')) || {};
let orderHistory = JSON.parse(localStorage.getItem('orderHistory')) || [];
let currentPeriod = 'hari';

let restockTarget = { produkId: '', produkName: '', size: '', color: '', qty: 1 };
let editTarget = { produkId: '', produkName: '', size: '', color: '' };

// ===================== UTILS =====================
function saveStok() {
  localStorage.setItem('stokData', JSON.stringify(stokData));
}
function saveHistory() {
  localStorage.setItem('orderHistory', JSON.stringify(orderHistory));
}
function fixGDriveLink(url) {
  if (!url) return '';
  const fileId = url.match(/\/d\/([^\/]+)/);
  return fileId ? `https://lh3.googleusercontent.com/d/${fileId[1]}` : url;
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

// ===================== CORE: FETCH DENGAN MERGE SINKRON =====================
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
          hpp: parseInt(item['HPP']?.toString().replace(/\D/g, '')) || 0,
          harga: parseInt(item['Harga Jual']?.toString().replace(/\D/g, '')) || 0,
          image: fixGDriveLink(item['Gambar Produk']),
          selectedSize: item['Varian Size'] || '',
          selectedColor: (item['Varian Warna '] || item['Varian Warna'] || '').trim(),
          selectedPlatform: 'TikTok',
          quantity: 0,
        };
      }

      const colorTrimmed = (item['Varian Warna '] || item['Varian Warna'] || '').trim();
      if (item['Varian Size'] && !acc[name].sizes.includes(item['Varian Size'])) acc[name].sizes.push(item['Varian Size']);
      if (colorTrimmed && !acc[name].colors.includes(colorTrimmed)) acc[name].colors.push(colorTrimmed);

      const key = `${acc[name].id}_${item['Varian Size']}_${colorTrimmed}`;
      const serverAwal = parseInt(item['Stok Awal']) || 0;
      const serverMasuk = parseInt(item['Stok Masuk']) || 0;
      const serverSisa = parseInt(item['Stok Sisa']) || 0;

      // Sinkronisasi: Update lokal cuma kalau data server lebih baru/besar
      if (!stokData[key] || serverSisa >= (stokData[key]?.sisa || 0)) {
        stokData[key] = { awal: serverAwal, masuk: serverMasuk, sisa: serverSisa };
      }

      return acc;
    }, {});

    products = Object.values(grouped);
    saveStok(); // Simpan hasil sinkronisasi
    renderProducts();
  } catch (e) {
    console.error('Fetch error:', e);
    renderProducts();
  }
}

// ===================== LOGIC: RESTOCK (OPTIMISTIC UI) =====================
let isSubmitting = false; // Pengunci global di luar fungsi

async function submitRestock() {
  if (isSubmitting) return; // Jika lagi ngirim, klik selanjutnya diabaikan

  const { produkId, produkName, size, color, qty } = restockTarget;
  const key = `${produkId}_${size}_${color}`;
  let current = stokData[key] || { awal: 0, masuk: 0, sisa: 0 };

  let newAwal = current.awal;
  let newMasuk = current.masuk;

  // Logika pembagian: Input pertama masuk ke 'Awal', selanjutnya ke 'Masuk'
  if (newAwal === 0) {
    newAwal = qty;
    newMasuk = 0;
  } else {
    newMasuk = (current.masuk || 0) + qty;
  }

  const newSisa = newAwal + newMasuk;

  // --- TAHAP 1: UPDATE LOKAL (Optimistic UI) ---
  stokData[key] = { awal: newAwal, masuk: newMasuk, sisa: newSisa };
  saveStok();
  renderProducts();
  if (document.getElementById('tab-stok')?.classList.contains('active')) renderStok();

  showToast(`✓ Stok diperbarui: ${newSisa} pcs`);
  closeRestock();

  // --- TAHAP 2: KIRIM KE SERVER ---
  isSubmitting = true; // KUNCI SEBELUM FETCH

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
        Key: key, // Pastikan konsisten pakai tanda petik jika di n8n pakai spasi
        chat_id: getChatId(),
      }),
    });
  } catch (e) {
    console.error('Gagal sinkron ke Sheets, tapi lokal aman.', e);
  } finally {
    isSubmitting = false; // BUKA GEMBOK LAGI (Wajib!)
  }
}

// ===================== LOGIC: EDIT STOK (FIXED) =====================
function openEditStok(produkId, produkName, size, color, qty) {
  editTarget = { produkId, produkName, size, color };
  document.getElementById('edit-produk-name').textContent = produkName;
  document.getElementById('edit-varian-name').textContent = `${size} · ${color}`;
  document.getElementById('edit-qty-input').value = qty;
  document.getElementById('edit-stok-modal').classList.add('show');
}

async function submitEditStok() {
  const { produkId, produkName, size, color } = editTarget;
  const qtyBaru = parseInt(document.getElementById('edit-qty-input').value) || 0;
  const key = `${produkId}_${size}_${color}`;

  stokData[key] = { awal: qtyBaru, masuk: 0, sisa: qtyBaru };
  saveStok();
  renderStok();
  renderProducts();
  closeEditStok();
  showToast(`✓ Stok direset ke ${qtyBaru}`);

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
  } catch (e) {
    console.error(e);
  }
}

function closeEditStok() {
  document.getElementById('edit-stok-modal').classList.remove('show');
}

// ===================== UI RENDERING =====================
function renderStok() {
  const container = document.getElementById('stok-list');
  if (!container) return;
  container.innerHTML = products
    .map((p) => {
      const rows = p.sizes
        .flatMap((s) =>
          p.colors.map((c) => {
            const key = `${p.id}_${s}_${c}`;
            const q = stokData[key] || { sisa: 0 };
            return `
        <div class="stok-row">
          <div class="stok-varian-info"><span class="stok-varian">${s} · ${c}</span></div>
          <div class="stok-actions">
            <span class="badge ${q.sisa === 0 ? 'empty' : q.sisa <= 3 ? 'low' : 'ok'}">${q.sisa} pcs</span>
            <button class="stok-restock-btn" onclick="openRestock('${p.id}','${p.name}','${s}','${c}')">+ RESTOCK</button>
            <button class="stok-edit-btn" onclick="openEditStok('${p.id}','${p.name}','${s}','${c}',${q.sisa})">✏️ EDIT</button>
          </div>
        </div>`;
          }),
        )
        .join('');
      return `<div class="stok-card"><div class="stok-header"><div class="stok-name">${p.name}</div></div>${rows}</div>`;
    })
    .join('');
}

function renderProducts() {
  const container = document.getElementById('product-list');
  if (!container) return;
  container.innerHTML = products
    .map((p) => {
      const key = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
      const sisa = stokData[key]?.sisa || 0;
      const sizeChips = p.sizes.map((s) => `<div class="chip ${p.selectedSize === s ? 'active' : ''}" onclick="selectVariant('${p.id}','size','${s}')">${s}</div>`).join('');
      const colorChips = p.colors.map((c) => `<div class="chip ${p.selectedColor === c ? 'active' : ''}" onclick="selectVariant('${p.id}','color','${c}')">${c}</div>`).join('');
      const platformChips = ['TikTok', 'Shopee'].map((pl) => `<div class="platform-chip ${p.selectedPlatform === pl ? 'active' : ''}" onclick="selectVariant('${p.id}','platform','${pl}')">${pl}</div>`).join('');
      return `
      <div class="product-card ${p.quantity > 0 ? 'has-qty' : ''}">
        <div class="product-thumb">${p.image ? `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : `<div class="thumb-icon">👕</div>`}</div>
        <div class="product-body">
          <div class="product-name">${p.name}</div>
          <div class="product-price">Rp${p.harga.toLocaleString('id')}</div>
          <div class="chip-group"><div class="chip-label">UKURAN</div><div class="chip-row">${sizeChips}</div></div>
          <div class="chip-group"><div class="chip-label">WARNA</div><div class="chip-row">${colorChips}</div></div>
          <div class="chip-group"><div class="chip-label">PLATFORM</div><div class="chip-row">${platformChips}</div></div>
          <div class="qty-row">
            <div class="qty-label">STOK: ${sisa} pcs</div>
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

// ... (Fungsi switchTab, renderLaporan, kirimLaporan, dll tetap sama)

function switchTab(tab) {
  document.querySelectorAll('.tab-content, .tab').forEach((el) => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('bottom-bar').style.display = tab === 'order' ? 'flex' : 'none';
  if (tab === 'stok') renderStok();
  if (tab === 'laporan') renderLaporan();
}

function renderLaporan() {
  const filtered = orderHistory.filter((o) => (currentPeriod === 'hari' ? o.tanggal === new Date().toLocaleDateString('id-ID') : true));
  document.getElementById('stat-penjualan').textContent = formatRp(filtered.reduce((s, o) => s + o.total_penjualan, 0));
  document.getElementById('stat-untung').textContent = formatRp(filtered.reduce((s, o) => s + o.untung_bersih, 0));
  document.getElementById('stat-order').textContent = filtered.length;
  document.getElementById('order-history').innerHTML =
    filtered
      .map(
        (o) => `
    <div class="order-history-item">
      <div class="order-history-top"><div class="order-history-name">${o.nama_produk}</div><div class="order-history-untung">+${formatRp(o.untung_bersih)}</div></div>
      <div class="order-history-detail">${o.varian} · ${o.jumlah} pcs · ${o.platform}</div>
    </div>`,
      )
      .join('') || '<div class="empty-state">Belum ada order</div>';
}

// Tambahkan fungsi delay di paling atas script
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function kirimLaporan() {
  const items = products.filter((p) => p.quantity > 0);
  const btn = document.getElementById('btn-kirim');
  btn.disabled = true;
  btn.textContent = 'MENGIRIM...';

  for (const p of items) {
    const key = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
    const total = p.harga * p.quantity;
    const potongan = Math.round(total * 0.15);

    try {
      console.log(`Mengirim produk: ${p.name}`);
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

      // Update stok lokal
      if (stokData[key]) {
        stokData[key].sisa = Math.max(0, (stokData[key].sisa || 0) - p.quantity);
        saveStok();
      }

      // Simpan history
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

      // JURUS KUNCI: Kasih delay 1 detik biar n8n & Google Sheets gak panik
      await sleep(1000);
    } catch (e) {
      console.error(`Gagal kirim ${p.name}:`, e);
    }
  }

  products.forEach((p) => (p.quantity = 0));
  renderProducts();
  showToast('✓ Semua order berhasil terkirim!');
  btn.disabled = false;
  btn.textContent = 'KIRIM ORDER';
}

function updateQty(id, delta) {
  const p = products.find((p) => p.id === id);
  const key = `${p.id}_${p.selectedSize}_${p.selectedColor}`;
  const sisa = stokData[key]?.sisa || 0;
  if (delta > 0 && p.quantity >= sisa) {
    showToast('Stok habis!');
    return;
  }
  p.quantity = Math.max(0, p.quantity + delta);
  renderProducts();
}
function selectVariant(id, type, value) {
  const p = products.find((p) => p.id === id);
  if (type === 'size') p.selectedSize = value;
  if (type === 'color') p.selectedColor = value;
  if (type === 'platform') p.selectedPlatform = value;
  renderProducts();
}
function openRestock(id, name, s, c) {
  restockTarget = { produkId: id, produkName: name, size: s, color: c, qty: 1 };
  document.getElementById('restock-produk-name').textContent = name;
  document.getElementById('restock-varian-name').textContent = `${s} · ${c}`;
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
function updateBottomBar() {
  const total = products.reduce((sum, p) => sum + p.quantity, 0);
  const el = document.getElementById('total-item-count');
  if (el) el.textContent = `${total} item`;
  const btn = document.getElementById('btn-kirim');
  if (btn) btn.disabled = total === 0;
}

window.onload = fetchProducts;
