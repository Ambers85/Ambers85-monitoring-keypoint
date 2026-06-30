/* =======================================================
   MONITORING KEYPOINT JARINGAN — app.js
   =======================================================
   PENTING: Ganti API_URL di bawah ini dengan URL Web App
   Google Apps Script Anda (lihat PANDUAN-SETUP.md).
   ======================================================= */

const API_URL = 'https://script.google.com/macros/s/AKfycbylHJTmcvmRdPz50OrtZgRRwbcMA6PjCZUYCHdhw0rNV9ODNmL5qX_2sJsqIr1qMUqO2w/exec';

function isApiConfigured(){
  return !!API_URL && API_URL.indexOf('https://script.google.com/macros/s/AKfycbylHJTmcvmRdPz50OrtZgRRwbcMA6PjCZUYCHdhw0rNV9ODNmL5qX_2sJsqIr1qMUqO2w/exec') === -1;
}

/* ---------- ambil elemen DOM ---------- */
const el = (id) => document.getElementById(id);

const namaKeypointInput = el('namaKeypoint');
const jamLepasInput     = el('jamLepas');
const jamNormalInput    = el('jamNormal');

const btnAmbilLokasi = el('btnAmbilLokasi');
const lokasiInfo     = el('lokasiInfo');
const lihatPetaLink  = el('lihatPetaLink');

const inputFoto        = el('inputFoto');
const btnAmbilFoto     = el('btnAmbilFoto');
const fotoPlaceholder  = el('fotoPlaceholder');
const fotoPreviewWrap  = el('fotoPreviewWrap');
const fotoPreviewImg   = el('fotoPreviewImg');

const keteranganInput = el('keterangan');

const btnStatusOpen = el('btnStatusOpen');
const btnStatusClose = el('btnStatusClose');
const statusFlag = el('statusFlag');

const form = el('keypointForm');
const submitBtn = el('submitBtn');
const cancelEditBtn = el('cancelEditBtn');
const formMessage = el('formMessage');

const apiWarning = el('apiWarning');
const pendingInfo = el('pendingInfo');
const pendingCount = el('pendingCount');
const btnSyncNow = el('btnSyncNow');
const connStatus = el('connStatus');
const installBtn = el('installBtn');

const searchInput = el('searchInput');
const btnRefresh = el('btnRefresh');
const filterAllBtn = el('filterAll');
const filterOpenBtn = el('filterOpen');
const filterCloseBtn = el('filterClose');

const loadingState = el('loadingState');
const historyError = el('historyError');
const emptyState = el('emptyState');
const historyList = el('historyList');

/* ---------- state ---------- */
let currentStatus = null;        // 'OPEN' | 'CLOSE' | null
let currentLat = null;
let currentLng = null;
let currentAccuracy = null;
let capturedPhotoDataUrl = null; // foto baru (base64) yang akan diunggah
let existingFotoUrl = '';        // foto lama, dipakai saat mode ubah/edit
let editingId = null;            // null = mode tambah baru, isi = mode ubah
let allRecords = [];
let currentFilter = 'ALL';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* =======================================================
   STATUS FLAG (indikator OPEN/CLOSE)
   ======================================================= */
function setStatus(status){
  currentStatus = status;
  btnStatusOpen.classList.toggle('active', status === 'OPEN');
  btnStatusClose.classList.toggle('active', status === 'CLOSE');

  const applyFace = () => {
    if (status === 'OPEN'){
      statusFlag.textContent = 'OPEN';
      statusFlag.className = 'flag-face flag-open';
    } else if (status === 'CLOSE'){
      statusFlag.textContent = 'CLOSE';
      statusFlag.className = 'flag-face flag-close';
    } else {
      statusFlag.textContent = '\u2014';
      statusFlag.className = 'flag-face flag-neutral';
    }
  };

  if (reduceMotion){
    applyFace();
    return;
  }
  statusFlag.classList.add('flap-anim');
  setTimeout(applyFace, 180);
  setTimeout(() => statusFlag.classList.remove('flap-anim'), 400);
}

btnStatusOpen.addEventListener('click', () => setStatus('OPEN'));
btnStatusClose.addEventListener('click', () => setStatus('CLOSE'));

/* =======================================================
   LOKASI GPS
   ======================================================= */
function updateLocationUI(){
  if (currentLat != null && currentLng != null && currentLat !== '' && currentLng !== ''){
    const acc = currentAccuracy ? ` (\u00B1${Math.round(currentAccuracy)}m)` : '';
    lokasiInfo.textContent = `${Number(currentLat).toFixed(6)}, ${Number(currentLng).toFixed(6)}${acc}`;
    lihatPetaLink.href = `https://www.google.com/maps?q=${currentLat},${currentLng}`;
    lihatPetaLink.classList.remove('hidden');
  } else {
    lokasiInfo.textContent = 'Lokasi belum diambil';
    lihatPetaLink.classList.add('hidden');
  }
}

btnAmbilLokasi.addEventListener('click', () => {
  if (!('geolocation' in navigator)){
    alert('Perangkat/browser ini tidak mendukung GPS.');
    return;
  }
  const originalText = btnAmbilLokasi.textContent;
  btnAmbilLokasi.disabled = true;
  btnAmbilLokasi.textContent = 'Mengambil lokasi...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      currentAccuracy = pos.coords.accuracy;
      updateLocationUI();
      btnAmbilLokasi.disabled = false;
      btnAmbilLokasi.textContent = 'Perbarui Lokasi';
    },
    (err) => {
      alert('Lokasi tidak dapat diambil: ' + err.message + '. Pastikan GPS aktif dan izin lokasi diberikan.');
      btnAmbilLokasi.disabled = false;
      btnAmbilLokasi.textContent = originalText;
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
});

/* =======================================================
   FOTO + CAP WAKTU/LOKASI (canvas overlay)
   ======================================================= */
btnAmbilFoto.addEventListener('click', () => inputFoto.click());

inputFoto.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => prosesFoto(ev.target.result);
  reader.readAsDataURL(file);
  inputFoto.value = '';
});

function prosesFoto(dataUrl){
  const img = new Image();
  img.onload = () => {
    const MAX_DIM = 1280;
    let w = img.width, h = img.height;
    if (w >= h && w > MAX_DIM){ h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
    else if (h > w && h > MAX_DIM){ w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const lines = [];
    if (namaKeypointInput.value.trim()) lines.push(namaKeypointInput.value.trim().toUpperCase());
    const now = new Date();
    lines.push(now.toLocaleString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }));
    if (currentLat != null && currentLng != null){
      lines.push(`${Number(currentLat).toFixed(6)}, ${Number(currentLng).toFixed(6)}`);
    }

    const fontSize = Math.max(13, Math.round(w * 0.032));
    const lineHeight = fontSize * 1.4;
    const paddingX = fontSize * 0.55;
    const boxHeight = lineHeight * lines.length + fontSize * 0.5;

    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, h - boxHeight, w, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${fontSize}px 'IBM Plex Mono', monospace`;
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, paddingX, h - boxHeight + (fontSize * 0.32) + i * lineHeight);
    });

    capturedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.72);
    existingFotoUrl = '';
    updatePhotoUI();
  };
  img.onerror = () => alert('Gagal memproses foto. Coba ambil ulang.');
  img.src = dataUrl;
}

function getThumbnailUrl(driveViewUrl){
  if (!driveViewUrl) return null;
  const m = driveViewUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return driveViewUrl;
  return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w800';
}

function updatePhotoUI(){
  if (capturedPhotoDataUrl){
    fotoPreviewImg.src = capturedPhotoDataUrl;
    fotoPreviewWrap.classList.remove('hidden');
    fotoPlaceholder.classList.add('hidden');
    btnAmbilFoto.textContent = 'Ambil Ulang Foto';
  } else if (existingFotoUrl){
    fotoPreviewImg.src = getThumbnailUrl(existingFotoUrl) || existingFotoUrl;
    fotoPreviewWrap.classList.remove('hidden');
    fotoPlaceholder.classList.add('hidden');
    btnAmbilFoto.textContent = 'Ganti Foto';
  } else {
    fotoPreviewWrap.classList.add('hidden');
    fotoPlaceholder.classList.remove('hidden');
    btnAmbilFoto.textContent = 'Ambil Foto';
  }
}

/* =======================================================
   KOMUNIKASI KE GOOGLE APPS SCRIPT (Google Sheet)
   ======================================================= */
async function kirimData(payload){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Gagal menyimpan data.');
  return json;
}

async function ambilSemuaData(){
  const res = await fetch(API_URL, { method: 'GET' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Gagal mengambil data.');
  return json.data || [];
}

/* ---------- antrean offline (jika tidak ada koneksi) ---------- */
const QUEUE_KEY = 'kp_pending_queue_v1';
function getQueue(){
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch(e){ return []; }
}
function saveQueue(q){
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  updatePendingBadge();
}
function addToQueue(payload){
  const q = getQueue();
  q.push(payload);
  saveQueue(q);
}
function updatePendingBadge(){
  const q = getQueue();
  pendingInfo.classList.toggle('hidden', q.length === 0);
  pendingCount.textContent = q.length;
}
async function prosesQueue(){
  if (!isApiConfigured()) return;
  let q = getQueue();
  if (q.length === 0) return;
  const sisa = [];
  let adaYangBerhasil = false;
  for (const item of q){
    try { await kirimData(item); adaYangBerhasil = true; }
    catch(e){ sisa.push(item); }
  }
  saveQueue(sisa);
  if (adaYangBerhasil) muatRiwayat();
}
window.addEventListener('online', () => { updateOnlineStatus(); prosesQueue(); });
window.addEventListener('offline', updateOnlineStatus);
btnSyncNow.addEventListener('click', prosesQueue);

function updateOnlineStatus(){
  if (navigator.onLine){
    connStatus.textContent = 'ONLINE';
    connStatus.className = 'conn-pill online';
  } else {
    connStatus.textContent = 'OFFLINE';
    connStatus.className = 'conn-pill offline';
  }
}

/* =======================================================
   FORM: simpan / ubah
   ======================================================= */
function showFormMessage(text, type){
  formMessage.textContent = text;
  formMessage.className = 'form-message ' + (type || '');
}

function setSubmitting(isSubmitting){
  submitBtn.disabled = isSubmitting;
  // Selalu hitung label dari status editingId SAAT INI (bukan label yang
  // di-cache sebelum kirim data), supaya setelah resetForm() mengubah
  // editingId, tombol langsung menampilkan label yang benar.
  submitBtn.textContent = isSubmitting ? 'Menyimpan...' : (editingId ? 'Update Data' : 'Simpan Data');
}

function resetForm(){
  form.reset();
  editingId = null;
  currentLat = null; currentLng = null; currentAccuracy = null;
  capturedPhotoDataUrl = null; existingFotoUrl = '';
  updateLocationUI();
  updatePhotoUI();
  setStatus(null);
  submitBtn.textContent = 'Simpan Data';
  cancelEditBtn.classList.add('hidden');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showFormMessage('', '');

  const namaKeypoint = namaKeypointInput.value.trim();
  if (!namaKeypoint){
    showFormMessage('Nama Keypoint wajib diisi.', 'error');
    namaKeypointInput.focus();
    return;
  }
  if (!currentStatus){
    showFormMessage('Pilih status OPEN atau CLOSE terlebih dahulu.', 'error');
    return;
  }
  if (!isApiConfigured()){
    showFormMessage('Backend belum diatur. Lihat PANDUAN-SETUP.md untuk menghubungkan ke Google Spreadsheet.', 'error');
    return;
  }
  if (!capturedPhotoDataUrl && !existingFotoUrl){
    const lanjut = confirm('Anda belum mengambil foto. Simpan tanpa foto?');
    if (!lanjut) return;
  }

  const isUpdate = !!editingId;
  const payload = {
    action: isUpdate ? 'update' : 'create',
    id: editingId || undefined,
    namaKeypoint,
    jamLepas: jamLepasInput.value,
    jamNormal: jamNormalInput.value,
    lat: currentLat,
    lng: currentLng,
    foto: capturedPhotoDataUrl || null,
    existingFotoUrl: existingFotoUrl || '',
    keterangan: keteranganInput.value.trim(),
    status: currentStatus
  };

  setSubmitting(true);
  try {
    await kirimData(payload);
    showFormMessage(isUpdate ? 'Data berhasil diperbarui.' : 'Data berhasil disimpan.', 'success');
    resetForm();
    muatRiwayat();
  } catch(err){
    if (err instanceof TypeError){
      addToQueue(payload);
      showFormMessage('Tidak ada koneksi. Data disimpan di perangkat dan akan dikirim otomatis saat online.', 'warning');
      resetForm();
    } else {
      showFormMessage('Gagal menyimpan: ' + err.message, 'error');
    }
  } finally {
    setSubmitting(false);
  }
});

cancelEditBtn.addEventListener('click', resetForm);

/* =======================================================
   RIWAYAT (read, update-load, delete)
   ======================================================= */
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function formatTanggal(value){
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value || '-');
  return d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function renderRecordCard(record){
  const id = record['ID'];
  const status = String(record['Status'] || '').toUpperCase();
  const statusClass = status === 'OPEN' ? 'rec-open' : (status === 'CLOSE' ? 'rec-close' : '');
  const lat = record['Latitude'];
  const lng = record['Longitude'];
  const mapLink = record['Link Peta'];
  const fotoUrl = record['Foto URL'];
  const thumb = getThumbnailUrl(fotoUrl);

  const div = document.createElement('div');
  div.className = 'record-card ' + statusClass;
  div.dataset.id = id;

  div.innerHTML = `
    <div class="record-top">
      <span class="record-title">${escapeHtml(record['Nama Keypoint'] || '(Tanpa nama)')}</span>
      <span class="status-pill ${statusClass}">${status || '-'}</span>
    </div>
    <div class="record-row"><span class="rec-label">Waktu</span><span>Lepas ${escapeHtml(record['Jam Lepas'] || '-')} &middot; Normal ${escapeHtml(record['Jam Normal'] || '-')}</span></div>
    <div class="record-row"><span class="rec-label">Dicatat</span><span>${formatTanggal(record['Timestamp'])}</span></div>
    <div class="record-row"><span class="rec-label">Lokasi</span><span>${mapLink ? `<a href="${mapLink}" target="_blank" rel="noopener">${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} &#8599;</a>` : 'Tidak tercatat'}</span></div>
    ${record['Keterangan'] ? `<p class="record-note">${escapeHtml(record['Keterangan'])}</p>` : ''}
    ${thumb ? `<img class="record-thumb" src="${thumb}" alt="Foto keypoint ${escapeHtml(record['Nama Keypoint'] || '')}">` : ''}
    <div class="record-actions">
      <button type="button" class="btn-small btn-edit" data-action="edit">Ubah</button>
      <button type="button" class="btn-small btn-delete" data-action="delete">Hapus</button>
    </div>
  `;

  const img = div.querySelector('.record-thumb');
  if (img){
    img.addEventListener('error', () => {
      const link = document.createElement('a');
      link.href = fotoUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Lihat Foto \u2197';
      link.className = 'photo-fallback-link';
      img.replaceWith(link);
    }, { once:true });
  }

  return div;
}

function renderList(){
  const query = searchInput.value.trim().toLowerCase();
  const filtered = allRecords.filter(r => {
    const matchesQuery = !query ||
      String(r['Nama Keypoint'] || '').toLowerCase().includes(query) ||
      String(r['Keterangan'] || '').toLowerCase().includes(query);
    const matchesStatus = currentFilter === 'ALL' || String(r['Status'] || '').toUpperCase() === currentFilter;
    return matchesQuery && matchesStatus;
  }).sort((a, b) => new Date(b['Timestamp']) - new Date(a['Timestamp']));

  historyList.innerHTML = '';
  emptyState.classList.toggle('hidden', filtered.length !== 0);
  filtered.forEach(r => historyList.appendChild(renderRecordCard(r)));
}

async function muatRiwayat(){
  if (!isApiConfigured()) return;
  loadingState.classList.remove('hidden');
  historyError.classList.add('hidden');
  try {
    allRecords = await ambilSemuaData();
    renderList();
  } catch(err){
    historyList.innerHTML = '';
    emptyState.classList.add('hidden');
    historyError.textContent = 'Gagal memuat riwayat: ' + err.message;
    historyError.classList.remove('hidden');
  } finally {
    loadingState.classList.add('hidden');
  }
}

historyList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.record-card');
  const id = card.dataset.id;
  const record = allRecords.find(r => String(r['ID']) === String(id));
  if (!record) return;
  if (btn.dataset.action === 'edit') editRecord(record);
  else if (btn.dataset.action === 'delete') hapusRecord(id);
});

function editRecord(record){
  editingId = record['ID'];
  namaKeypointInput.value = record['Nama Keypoint'] || '';
  jamLepasInput.value = record['Jam Lepas'] || '';
  jamNormalInput.value = record['Jam Normal'] || '';
  currentLat = (record['Latitude'] !== '' && record['Latitude'] != null) ? record['Latitude'] : null;
  currentLng = (record['Longitude'] !== '' && record['Longitude'] != null) ? record['Longitude'] : null;
  currentAccuracy = null;
  updateLocationUI();
  capturedPhotoDataUrl = null;
  existingFotoUrl = record['Foto URL'] || '';
  updatePhotoUI();
  keteranganInput.value = record['Keterangan'] || '';
  setStatus(String(record['Status'] || '').toUpperCase() || null);
  submitBtn.textContent = 'Update Data';
  cancelEditBtn.classList.remove('hidden');
  showFormMessage('Mengubah data: ' + (record['Nama Keypoint'] || ''), 'info');
  el('form-section').scrollIntoView({ behavior:'smooth', block:'start' });
}

async function hapusRecord(id){
  if (!confirm('Yakin ingin menghapus data ini? Tindakan ini tidak dapat dibatalkan.')) return;
  try {
    await kirimData({ action:'delete', id });
    muatRiwayat();
  } catch(err){
    alert('Gagal menghapus data: ' + err.message);
  }
}

searchInput.addEventListener('input', renderList);
btnRefresh.addEventListener('click', muatRiwayat);

[filterAllBtn, filterOpenBtn, filterCloseBtn].forEach(btn => {
  btn.addEventListener('click', () => {
    currentFilter = btn.dataset.filter;
    [filterAllBtn, filterOpenBtn, filterCloseBtn].forEach(b => b.classList.toggle('active', b === btn));
    renderList();
  });
});

/* =======================================================
   INSTALL APP (PWA)
   ======================================================= */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installBtn.classList.remove('hidden');
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.classList.add('hidden');
});
window.addEventListener('appinstalled', () => installBtn.classList.add('hidden'));

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}

/* =======================================================
   INISIALISASI
   ======================================================= */
setStatus(null);
updateLocationUI();
updatePhotoUI();
updateOnlineStatus();
updatePendingBadge();

if (!isApiConfigured()){
  apiWarning.classList.remove('hidden');
  emptyState.textContent = 'Riwayat akan tampil di sini setelah backend terhubung (lihat pesan di atas).';
  emptyState.classList.remove('hidden');
} else {
  muatRiwayat();
}
prosesQueue();
