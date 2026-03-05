// ============================================
// PANSKÁ 17 - CORE
// Globals, auth, navigation, photos, dashboard,
// issues, sections, reports
// ============================================
const S_URL = 'https://tyimhlqtncjynutxihrf.supabase.co';
const S_KEY = 'sb_publishable_jX6gFj0WZfxXFNpwF1bTuw_dQADscTW';
const sb = supabase.createClient(S_URL, S_KEY);

let allLocs = [], allIssues = [], allUpdates = [];
let allZones = [], currentZoneId = null, userZoneIds = [];
let currentEditingPhotoUrl = null;
let removePhotoFlag = false;

// Multi-photo support
let pendingAddPhotos = [];    // [{file, previewUrl}] for new issue form
let pendingEditPhotos = [];   // [{file, previewUrl}] for update form
let existingEditPhotos = [];  // [{id, photo_url, photo_thumb_url}] from DB
let photosToRemoveIds = [];   // photo IDs to delete on save
let allIssuePhotos = [];      // all photos loaded from issue_photos table
let currentRole = null;
let currentUserId = null;

// Second client for creating users (won't disrupt admin session)
const sbCreate = supabase.createClient(S_URL, S_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});


const fmtD = (str) => {
  if(!str) return '--';
  const d = str.split('T')[0].split('-');
  return `${d[2]}.${d[1]}.${d[0]}`;
};
window.hideM = (id) => document.getElementById(id).classList.add('hidden');

// LOGOUT FIX
window.handleLogout = async () => {
  await sb.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.reload(true);
};

// LOGIN FIX
document.getElementById('f-login').onsubmit = async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  btn.innerText = "Sync...";

  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('log-email').value,
    password: document.getElementById('log-pass').value
  });

  if (error) {
    document.getElementById('log-error').classList.remove('hidden');
    btn.innerText = "Prihlásiť sa";
  } else {
    init();
  }
};

// -------- Photos (orig + thumb) --------
async function uploadPhoto(file) {
  if (!file) return null;
  const name = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
  const { error } = await sb.storage.from('photos').upload(name, file, { upsert: false });
  if (error) return null;
  return `${S_URL}/storage/v1/object/public/photos/${name}`;
}

async function makeThumbnailBlobFromFile(file, maxW = 420, quality = 0.55) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bmp, 0, 0, w, h);

  return await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

// Used only for one-off migration of existing images
async function makeThumbnailBlobFromUrl(url, maxW = 420, quality = 0.6) {
  const res = await fetch(url);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);

  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bmp, 0, 0, w, h);

  return await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
}

async function uploadThumbBlob(blob, baseName) {
  const thumbName = `thumb/${baseName}.jpg`;
  const { error } = await sb.storage.from("photos").upload(thumbName, blob, {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw error;
  return `${S_URL}/storage/v1/object/public/photos/${thumbName}`;
}

async function uploadPhotoWithThumb(file, baseName) {
  if (!file) return { photo_url: null, photo_thumb_url: null };

  const photo_url = await uploadPhoto(file);
  if (!photo_url) return { photo_url: null, photo_thumb_url: null };

  try {
    const thumbBlob = await makeThumbnailBlobFromFile(file, 420, 0.55);
    const photo_thumb_url = await uploadThumbBlob(thumbBlob, baseName);
    return { photo_url, photo_thumb_url };
  } catch (e) {
    console.warn("Thumbnail failed:", e);
    return { photo_url, photo_thumb_url: null };
  }
}

// -------- Multi-photo helpers --------
async function uploadMultiplePhotos(pendingArr) {
  const results = [];
  for (let i = 0; i < pendingArr.length; i++) {
    const r = await uploadPhotoWithThumb(pendingArr[i].file, `upd_${Date.now()}_${i}`);
    if (r.photo_url) results.push(r);
  }
  return results;
}

async function savePhotosForUpdate(updateId, newPhotos, removeIds) {
  // Delete removed photos
  if (removeIds && removeIds.length > 0) {
    const { error } = await sb.from('issue_photos').delete().in('id', removeIds);
    if (error) console.error('Error deleting photos:', error);
  }
  // Insert new photos
  if (newPhotos && newPhotos.length > 0) {
    const maxSort = existingEditPhotos.length;
    const rows = newPhotos.map((p, i) => ({
      issue_update_id: updateId,
      photo_url: p.photo_url,
      photo_thumb_url: p.photo_thumb_url,
      sort_order: maxSort + i
    }));
    const { error } = await sb.from('issue_photos').insert(rows);
    if (error) console.error('Error inserting photos:', error);
  }
}

function renderPhotoGrid(containerId, photos, pending, opts) {
  const c = document.getElementById(containerId);
  if (!c) return;
  opts = opts || {};
  let html = '';

  // Existing photos from DB
  (photos || []).forEach(function(p) {
    html += '<div class="relative inline-block mr-1 mb-1">' +
      '<img src="' + (p.photo_thumb_url || p.photo_url) + '" class="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-sm cursor-pointer" onclick="window.open(\'' + p.photo_url + '\')">' +
      (opts.canRemove !== false ? '<button type="button" onclick="window.removeExistingPhoto(\'' + containerId + '\', \'' + p.id + '\')" class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-md hover:bg-red-600"><i class="fa-solid fa-xmark"></i></button>' : '') +
    '</div>';
  });

  // Pending (not yet uploaded) photos
  (pending || []).forEach(function(p, i) {
    html += '<div class="relative inline-block mr-1 mb-1">' +
      '<img src="' + p.previewUrl + '" class="w-20 h-20 object-cover rounded-lg border-2 border-blue-300 shadow-sm opacity-80">' +
      '<button type="button" onclick="window.removePendingPhoto(\'' + containerId + '\', ' + i + ')" class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center shadow-md hover:bg-red-600"><i class="fa-solid fa-xmark"></i></button>' +
    '</div>';
  });

  c.innerHTML = html;
  c.classList.toggle('hidden', html === '');
}

function getPhotosForUpdate(updateId) {
  return allIssuePhotos.filter(function(p) { return p.issue_update_id === updateId; });
}

function getPhotosForIssue(issueId) {
  var updateIds = allUpdates.filter(function(u) { return u.issue_id === issueId; }).map(function(u) { return u.id; });
  return allIssuePhotos.filter(function(p) { return updateIds.indexOf(p.issue_update_id) !== -1; });
}

async function switchView(v) {
  // ZAVRETIE MENU NA MOBILE PO KLIKNUTÍ
  const accordion = document.getElementById('mobile-accordion');
  if (accordion) {
    accordion.classList.add('hidden');
    const icon = document.getElementById('menu-icon');
    if (icon) icon.classList.replace('fa-xmark', 'fa-bars');
  }

  ['v-dash', 'v-insp', 'v-arch', 'v-rep', 'v-fin', 'v-admin'].forEach(id => { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
  ['n-dash', 'n-insp', 'n-arch', 'n-rep', 'n-fin', 'n-admin'].forEach(id => { var el = document.getElementById(id); if (el) el.classList.remove('nav-active'); });

  document.getElementById('v-'+v).classList.remove('hidden');
  var nav = document.getElementById('n-'+v); if (nav) nav.classList.add('nav-active');

  // DÔLEŽITÉ: vráť Promise a počkaj na dáta + render
  if (v === 'dash') return await loadDash();
  if (v === 'insp') return await loadSections();
  if (v === 'arch') return await loadArchive();
  if (v === 'rep')  return await loadReports();
  if (v === 'fin')  return await loadFinance();
  if (v === 'admin') return await loadAdmin();
}

window.switchZone = function(zoneId) {
  currentZoneId = zoneId === 'all' ? null : zoneId;
  // Sync both selectors
  var sel = document.getElementById('zone-select');
  var selM = document.getElementById('zone-select-mob');
  if (sel) sel.value = zoneId;
  if (selM) selM.value = zoneId;
  // Reload current view
  var activeView = document.querySelector('[id^="v-"]:not(.hidden)');
  if (activeView) {
    var v = activeView.id.replace('v-', '');
    if (v === 'dash') loadDash();
    else if (v === 'insp') loadSections();
    else if (v === 'arch') loadArchive();
    else if (v === 'rep') loadReports();
  }
};

// Filter funkcia - admin vidí všetko, ostatní len svoje zóny
function matchesZone(zoneId) {
  if (currentZoneId) return zoneId === currentZoneId;
  // "Všetko" - admin vidí všetko, ostatní len pridelené
  var isAdmin = currentRole === 'admin' || currentRole === 'ekonom' || currentRole === 'spravca' || currentRole === 'zastupca';
  if (isAdmin) return true;
  return userZoneIds.indexOf(zoneId) !== -1;
}

function getZoneName() {
  if (!currentZoneId) return 'Panská 17';
  var z = allZones.find(function(z) { return z.id === currentZoneId; });
  if (!z) return 'Panská 17';
  return z.tenant_name || z.name;
}


async function loadDash() {
  var now = new Date();
  var thisYear = now.getFullYear();
  document.getElementById('s-year').innerText = thisYear;

  var dashTitle = document.getElementById('dash-zone-title');
  if (dashTitle) dashTitle.innerText = getZoneName();

  // Načítaj issues s locations filtrované podľa zóny
  var issQuery = sb.from('issues').select('id, title, status, archived, created_at, location_id, locations(floor, name, zone_id)');
  var { data: rawIss = [] } = await issQuery;

  // Filter podľa zóny
  var allIss = rawIss.filter(function(i) {
    return i.locations && matchesZone(i.locations.zone_id);
  });

  var issIds = allIss.map(function(i) { return i.id; });
  var { data: allUpd = [] } = await sb.from('issue_updates').select('issue_id, status_to, event_date, note').order('event_date', { ascending: false });
  // Filter updaty len pre naše issues
  allUpd = allUpd.filter(function(u) { return issIds.indexOf(u.issue_id) !== -1; });

  // Vybavené tento rok - len NEARCHIVOVANÉ issues so statusom Opravené/Vybavené
  // a posledný resolved dátum v tomto roku
  var lastResolved = {};
  allUpd.forEach(function(u) {
    if ((u.status_to === 'Opravené' || u.status_to === 'Vybavené') && u.event_date) {
      if (!lastResolved[u.issue_id] || u.event_date > lastResolved[u.issue_id]) {
        lastResolved[u.issue_id] = u.event_date;
      }
    }
  });
  var resolvedThisYear = 0;
  allIss.forEach(function(iss) {
    var isDone = iss.status === 'Opravené' || iss.status === 'Vybavené';
    var resolvedDate = lastResolved[iss.id];
    if (isDone && resolvedDate && resolvedDate.startsWith(String(thisYear))) {
      resolvedThisYear++;
    }
  });
  document.getElementById('s-done-year').innerText = resolvedThisYear;

  // V riešení (nie archivované, nie vybavené/opravené)
  var activeCount = allIss.filter(function(i) {
    return !i.archived && i.status !== 'Opravené' && i.status !== 'Vybavené';
  }).length;
  document.getElementById('s-active').innerText = activeCount;

  // Celkom záznamov
  document.getElementById('s-total').innerText = allIss.length;

  // Graf - posledných 12 mesiacov
  var months = [];
  for (var m = 11; m >= 0; m--) {
    var d = new Date(thisYear, now.getMonth() - m, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleString('sk', { month: 'short' }).replace('.','') });
  }

  var chartData = months.map(function(mo) {
    var prefix = mo.year + '-' + String(mo.month).padStart(2, '0');
    var newCount = 0;
    var doneCount = 0;
    allUpd.forEach(function(u) {
      if (!u.event_date || !u.event_date.startsWith(prefix)) return;
      if (u.status_to === 'Zahlásené') newCount++;
      if (u.status_to === 'Opravené' || u.status_to === 'Vybavené') doneCount++;
    });
    return { label: mo.label, newC: newCount, doneC: doneCount };
  });

  var maxVal = Math.max(1, Math.max.apply(null, chartData.map(function(c) { return Math.max(c.newC, c.doneC); })));

  document.getElementById('dash-chart').innerHTML = chartData.map(function(c) {
    var hDone = c.doneC > 0 ? Math.max(6, Math.round((c.doneC / maxVal) * 100)) : 0;
    var hNew = c.newC > 0 ? Math.max(6, Math.round((c.newC / maxVal) * 100)) : 0;
    return '<div class="flex-1 flex flex-col items-center">' +
      '<div class="w-full flex space-x-0.5 items-end" style="height:160px">' +
        '<div class="flex-1 rounded-t-sm" style="height:' + hDone + '%;background:#4ade80;-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>' +
        '<div class="flex-1 rounded-t-sm" style="height:' + hNew + '%;background:#e2e8f0;-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>' +
      '</div>' +
      '<p class="text-[8px] font-bold text-slate-400 mt-1 uppercase">' + c.label + '</p>' +
      '<p class="text-[7px] text-green-500 font-bold">' + (c.doneC > 0 ? c.doneC : '') + '</p>' +
    '</div>';
  }).join('');

  // Posledné aktivity feed - s názvom úlohy
  var issMap = {};
  allIss.forEach(function(i) { issMap[i.id] = i; });
  // Len updaty pre existujúce issues
  var validUpd = allUpd.filter(function(u) { return issMap[u.issue_id]; });
  var recent = validUpd.slice(0, 8);

  document.getElementById('dash-feed').innerHTML = recent.length === 0
    ? '<p class="text-center text-slate-300 text-[10px] font-bold uppercase py-6">Žiadne aktivity</p>'
    : recent.map(function(u) {
      var iss = issMap[u.issue_id];
      var statusColor = (u.status_to === 'Opravené' || u.status_to === 'Vybavené') ? 'text-green-600' : 'text-slate-600';
      return '<div class="flex items-start space-x-3 py-2 border-b border-slate-100 last:border-0">' +
        '<span class="text-[9px] font-bold text-slate-300 min-w-[65px]">' + fmtD(u.event_date) + '</span>' +
        '<span class="text-[9px] font-bold ' + statusColor + ' uppercase min-w-[70px]">' + u.status_to + '</span>' +
        '<span class="text-[9px] font-bold text-slate-700">' + (iss && iss.locations ? '<span class="text-slate-400">' + iss.locations.floor + ' / ' + iss.locations.name + '</span> — ' : '') + (iss ? iss.title : '') + '</span>' +
      '</div>';
    }).join('');
}

window.printDashboard = async function() {
  window.print();
};

// Prepočítaj status všetkých issues podľa posledného update (manuálne cez konzolu)
async function recalcAllStatuses() {
  var { data: issues = [] } = await sb.from('issues').select('id');
  for (var i = 0; i < issues.length; i++) {
    await syncIssueStatusFromLastEvent(issues[i].id);
  }
  alert('Statusy prepočítané pre ' + issues.length + ' záznamov. Obnov stránku.');
}

async function loadSections() {
  const container = document.getElementById('section-container');
  container.innerHTML = '<div class="py-20 text-center animate-pulse text-[10px] font-black text-slate-300 uppercase">Synchronizujem...</div>';

  // Názov zóny
  var inspTitle = document.getElementById('insp-zone-title');
  if (inspTitle) inspTitle.innerText = getZoneName();

  const { data: locs } = await sb.from('locations').select('*').order('sort_order', { ascending: true });
  allLocs = (locs || []).filter(function(l) { return matchesZone(l.zone_id); });

  const { data: isss } = await sb.from('issues').select('*, locations(*)').eq('archived', false).order('created_at', { ascending: false });
  var locIds = allLocs.map(function(l) { return l.id; });
  allIssues = (isss || []).filter(function(i) { return locIds.indexOf(i.location_id) !== -1; });

  const { data: updts } = await sb.from('issue_updates').select('*').order('event_date', { ascending: false });
  allUpdates = updts || [];

  // Load multi-photos from issue_photos table (with fallback to issue_updates.photo_url)
  try {
    const { data: iPhotos } = await sb.from('issue_photos').select('*').order('sort_order', { ascending: true });
    allIssuePhotos = iPhotos || [];
  } catch (e) {
    allIssuePhotos = [];
  }

  container.innerHTML = '';
  const floors = [...new Set(allLocs.map(l => l.floor))];

  floors.forEach(floor => {
    const floorLocs = allLocs.filter(l => l.floor === floor);
    const floorIssues = allIssues.filter(i => floorLocs.some(l => l.id === i.location_id));

    const div = document.createElement('div');
    var isEmpty = floorIssues.length === 0;
    div.className = isEmpty
      ? 'bg-white px-6 py-3 md:px-8 md:py-3 rounded-2xl shadow-sm leading-tight mb-3'
      : 'bg-white p-6 md:p-8 rounded-[2rem] shadow-sm leading-tight mb-6';

    let issuesHtml = floorIssues.map(i => {
      const logs = allUpdates.filter(u => u.issue_id === i.id)
        .sort((a,b) => new Date(a.event_date) - new Date(b.event_date));

      // Use issue_photos table; fallback to issue_updates.photo_url for unmigrated data
      let issuePhotos = getPhotosForIssue(i.id);
      if (issuePhotos.length === 0) {
        // Fallback: old single-photo on issue_updates
        issuePhotos = allUpdates.filter(u => u.issue_id === i.id && u.photo_url).map(u => ({
          id: u.id, photo_url: u.photo_url, photo_thumb_url: u.photo_thumb_url, issue_update_id: u.id
        }));
      }
      const photos = issuePhotos
        .map(l => `<img loading="lazy" decoding="async" src="${l.photo_thumb_url || l.photo_url}" class="app-thumb" onclick="event.stopPropagation(); window.open('${l.photo_url}')">`)
        .join('');

      const fLog = logs.length > 0 ? logs[0] : null;

      return `
        <div class="flex justify-between items-start leading-tight">
          <div class="flex-1 leading-tight">
            <p class="text-[8px] font-black text-slate-400 uppercase leading-none mb-1">${i.locations?.name || '--'}</p>
            <p class="text-sm font-bold ${i.status === 'Opravené' || i.status === 'Vybavené' ? 'text-green-600' : 'text-slate-800'} leading-tight mb-1">${i.title}</p>
            <p class="text-[8px] text-slate-400 font-bold leading-tight"><span class="uppercase">Nahlásil:</span> ${fLog ? fmtD(fLog.event_date) : '--'} ${i.reported_by || '--'} • <span class="uppercase">Zodpovedný:</span> ${i.responsible_person || '--'}</p>
          </div>
          <div class="flex items-center space-x-3 ml-4 leading-tight leading-tight">
            <div class="flex items-center leading-none">${photos}</div>
            ${currentRole !== 'pozorovatel' ? `<button onclick="window.prepStat('${i.id}')" class="bg-white px-3 py-1.5 rounded-lg border border-slate-100 text-[9px] font-black uppercase text-blue-600 underline leading-tight">Upraviť</button>` : ''}
          </div>
        </div>`;
    }).join('');

    if (isEmpty) {
      div.innerHTML = `
        <div class="flex justify-between items-center leading-tight">
          <div class="flex items-center space-x-3">
            <h3 class="font-black text-sm uppercase text-slate-300 leading-tight">${floor}</h3>
            <span class="text-[9px] text-slate-200 font-bold uppercase">OK</span>
          </div>
          ${canAdd() ? `<button onclick="window.prepAdd('${floor}')" class="bg-slate-900 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest leading-none">+ Pridať</button>` : ''}
        </div>
      `;
    } else {
      div.innerHTML = `
        <div class="flex justify-between items-center border-b pb-4 mb-4 leading-tight">
          <h3 class="font-black text-xl uppercase text-slate-900 leading-tight">${floor}</h3>
          ${canAdd() ? `<button onclick="window.prepAdd('${floor}')" class="bg-slate-900 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest leading-none leading-tight">+ Pridať</button>` : ''}
        </div>
        <div class="space-y-4 leading-tight">
          ${issuesHtml}
        </div>
      `;
    }
    container.appendChild(div);
  });

  // Show orphaned issues (no valid location)
  const orphans = allIssues.filter(i => !allLocs.some(l => l.id === i.location_id));
  if (orphans.length > 0) {
    const odiv = document.createElement('div');
    odiv.className = 'bg-red-50 p-6 md:p-8 rounded-[2rem] shadow-sm leading-tight mb-6 border border-red-200';
    odiv.innerHTML = `
      <div class="flex justify-between items-center border-b border-red-200 pb-4 mb-4 leading-tight">
        <h3 class="font-black text-xl uppercase text-red-400 leading-tight">Bez lokácie</h3>
      </div>
      <div class="space-y-4 leading-tight">
        ${orphans.map(i => `
          <div class="flex justify-between items-center leading-tight mb-2">
            <div>
              <p class="text-sm font-bold text-slate-600">${i.title}</p>
              <p class="text-[8px] text-red-400 font-bold uppercase">Záznam nemá priradenú miestnosť</p>
            </div>
            ${canEdit() ? `<button onclick="window.deleteOrphan('${i.id}')" class="bg-red-500 text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase leading-tight">Vymazať</button>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(odiv);
  }
}

async function loadReports() {
  const todayStr = new Date().toLocaleDateString();
  document.getElementById('rep-date-screen').innerText = todayStr;

  // Názov zóny v reporte
  var repTitle = document.getElementById('rep-zone-title');
  if (repTitle) repTitle.innerText = getZoneName();

  // Set default Do dátum ak je prázdny
  var dateTo = document.getElementById('rep-date-to');
  if (!dateTo.value) dateTo.value = new Date().toISOString().split('T')[0];

  const list = document.getElementById('rep-list');

  // Filtre
  var dateFrom = document.getElementById('rep-date-from').value;
  var dateTo = document.getElementById('rep-date-to').value;
  var filterStatus = document.getElementById('rep-filter-status').value;
  var filterType = document.getElementById('rep-filter-type').value;
  var filterFloor = document.getElementById('rep-filter-floor').value;

  // Načítaj dáta
  var query = sb.from('issues').select('*, locations(*)');
  if (filterType === 'active') query = query.eq('archived', false);
  else if (filterType === 'archived') query = query.eq('archived', true);

  const { data: rawIsss } = await query;
  // Filter podľa zóny
  var isss = (rawIsss || []).filter(function(i) {
    return i.locations && matchesZone(i.locations.zone_id);
  });
  const { data: updts = [] } = await sb.from('issue_updates').select('*').order('event_date', { ascending: true });

  // Load multi-photos for report
  var repPhotos = [];
  try {
    const { data: rp } = await sb.from('issue_photos').select('*').order('sort_order', { ascending: true });
    repPhotos = rp || [];
  } catch (e) { repPhotos = []; }

  if (!isss || isss.length === 0) { list.innerHTML = '<tr><td colspan="3" class="text-center py-10 text-slate-300 text-[10px] font-bold uppercase">Žiadne záznamy</td></tr>'; return; }

  // Naplň podlažia dropdown - zoradené podľa sort_order
  var floorOrder = {};
  isss.forEach(function(i) {
    if (i.locations && i.locations.floor) {
      if (floorOrder[i.locations.floor] === undefined || i.locations.sort_order < floorOrder[i.locations.floor]) {
        floorOrder[i.locations.floor] = i.locations.sort_order;
      }
    }
  });
  var floors = [];
  isss.forEach(function(i) {
    if (i.locations && i.locations.floor && floors.indexOf(i.locations.floor) === -1) floors.push(i.locations.floor);
  });
  floors.sort(function(a, b) { return (floorOrder[a] || 0) - (floorOrder[b] || 0); });
  var floorSel = document.getElementById('rep-filter-floor');
  var curFloor = floorSel.value;
  floorSel.innerHTML = '<option value="all">Všetky</option>' + floors.map(function(f) {
    return '<option value="' + f + '"' + (f === curFloor ? ' selected' : '') + '>' + f + '</option>';
  }).join('');

  var validIssues = isss.filter(function(i) {
    if (!i.locations) return false;
    // Filter podlažie
    if (filterFloor !== 'all' && i.locations.floor !== filterFloor) return false;
    // Filter stav
    if (filterStatus === 'done' && i.status !== 'Opravené' && i.status !== 'Vybavené') return false;
    if (filterStatus === 'active' && (i.status === 'Opravené' || i.status === 'Vybavené')) return false;
    return true;
  });

  validIssues.sort(function(a,b) { return a.locations.sort_order - b.locations.sort_order; });

  list.innerHTML = validIssues.map(function(i) {
    var logs = updts.filter(function(u) { return u.issue_id === i.id; });

    // Filter dátumový rozsah na update úrovni
    if (dateFrom || dateTo) {
      logs = logs.filter(function(u) {
        if (!u.event_date) return false;
        var ed = (u.event_date || '').split('T')[0];
        if (dateFrom && ed < dateFrom) return false;
        if (dateTo && ed > dateTo) return false;
        return true;
      });
      if (logs.length === 0) return '';
    }

    return '<tr class="rep-row leading-snug">' +
      '<td class="py-5 px-2 align-top border-r border-slate-50">' +
        '<span class="block font-black text-slate-400 uppercase text-[7px]">' + (i.locations ? i.locations.floor : '--') + '</span>' +
        '<span class="text-[10px] font-bold">' + (i.locations ? i.locations.name : '--') + '</span>' +
        '<p class="text-[7px] font-bold text-slate-400 uppercase mt-2">Zodpovedá: ' + (i.responsible_person || '--') + '</p>' +
      '</td>' +
      '<td class="py-5 px-3 align-top leading-snug">' +
        '<p class="font-bold text-slate-900 mb-3">' + i.title + '</p>' +
        '<div class="space-y-4">' +
          logs.map(function(u) {
            return '<div class="flex justify-between items-start space-x-2 pb-1">' +
              '<div class="flex-1">' +
                '<div class="flex items-center space-x-2 mb-1">' +
                  '<span class="font-black text-[7px] text-slate-400 uppercase">' + fmtD(u.event_date) + '</span>' +
                  '<span class="text-[6px] font-black px-1 border rounded uppercase ' + (u.status_to === 'Opravené' || u.status_to === 'Vybavené' ? 'text-green-600' : 'text-slate-400') + '">' + u.status_to + '</span>' +
                '</div>' +
                '<p class="text-[9px] text-slate-700 leading-snug">' + (u.note || '--') + '</p>' +
              '</div>' +
              (function() {
                var uPhotos = repPhotos.filter(function(p) { return p.issue_update_id === u.id; });
                if (uPhotos.length === 0 && u.photo_url) {
                  uPhotos = [{ photo_url: u.photo_url, photo_thumb_url: u.photo_thumb_url }];
                }
                return uPhotos.length > 0 ? '<div class="flex flex-wrap gap-0.5 ml-2">' + uPhotos.map(function(p) {
                  return '<img loading="eager" decoding="async" src="' + (p.photo_thumb_url || p.photo_url) + '" class="report-thumb cursor-pointer" onclick="window.open(\'' + p.photo_url + '\')">';
                }).join('') + '</div>' : '';
              })() +
            '</div>';
          }).join('') +
        '</div>' +
      '</td>' +
      '<td class="py-5 px-1 align-top text-center">' +
        '<span class="text-[7px] font-black px-1.5 py-0.5 rounded uppercase ' + (i.status === 'Opravené' || i.status === 'Vybavené' ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50') + '">' + i.status + '</span>' +
      '</td>' +
    '</tr>';
  }).join('');
}

window.prepAdd = (fN) => {
  document.getElementById('f-add').reset();
  document.getElementById('m-add-floor-label').innerText = fN;
  document.getElementById('f-add-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('f-add-reported').value = document.getElementById('att-all').value;
  document.getElementById('f-add-loc-id').innerHTML = allLocs.filter(l => l.floor === fN).map(l => `<option value="${l.id}">${l.name}</option>`).join('');
  var pp = document.getElementById('add-photo-preview'); if (pp) pp.classList.add('hidden');
  var fi = document.getElementById('f-add-photo'); if (fi) fi.value = '';
  // Reset multi-photo state
  pendingAddPhotos = [];
  window.addGalleryFile = null;
  renderPhotoGrid('add-photos-grid', [], []);
  document.getElementById('m-add').classList.remove('hidden');
};

async function syncIssueStatusFromLastEvent(issueId) {
  // posledný event podľa dátumu, pri rovnakom dátume podľa created_at (ak existuje) a id
  const { data: last, error } = await sb
    .from('issue_updates')
    .select('id, status_to, event_date, created_at')
    .eq('issue_id', issueId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    console.error("syncIssueStatusFromLastEvent error:", error);
    return;
  }

  const finalStatus = last?.[0]?.status_to || 'Zahlásené';

  const { error: upErr } = await sb
    .from('issues')
    .update({ status: finalStatus, updated_at: new Date() })
    .eq('id', issueId);

  if (upErr) console.error("issues.status update error:", upErr);
}



window.prepStat = (id) => {
  const item = allIssues.find(i => i.id === id);
  if(!item) return;

  // reset to new-entry mode
  var ep = document.getElementById('edit-photo-preview'); if (ep) ep.classList.add('hidden');
  var ef = document.getElementById('f-stat-photo'); if (ef) ef.value = '';
  var eb = document.getElementById('edit-mode-bar'); if (eb) eb.classList.add('hidden');
  document.getElementById('f-stat-update-id').value = '';
  document.getElementById('f-stat-note').value = '';
  currentEditingPhotoUrl = null;
  removePhotoFlag = false;
  // Reset multi-photo state
  pendingEditPhotos = [];
  existingEditPhotos = [];
  photosToRemoveIds = [];
  renderPhotoGrid('edit-photos-grid', [], []);

  document.getElementById('f-stat-id').value = id;
  document.getElementById('f-stat-val').value = item.status;
  document.getElementById('f-stat-title-edit').value = item.title;
  document.getElementById('f-stat-resp-edit').value = item.responsible_person || '';
  document.getElementById('f-stat-reported-edit').value = item.reported_by || '';
  document.getElementById('f-stat-date').value = new Date().toISOString().split('T')[0];

  document.getElementById('f-stat-loc-id').innerHTML = allLocs.map(l => `<option value="${l.id}" ${l.id === item.location_id ? 'selected' : ''}>${l.floor}: ${l.name}</option>`).join('');

  const logs = allUpdates.filter(u => u.issue_id === id).sort((a,b) => new Date(b.event_date) - new Date(a.event_date));
  document.getElementById('m-history-list').innerHTML = logs.map(u => {
    var showActions = canEditEntry(u);
    return `
    <div data-uid="${u.id}" class="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] mb-2 leading-tight">
      <div class="flex justify-between items-start mb-1 leading-tight">
        <span class="font-black block text-slate-800 uppercase tracking-tighter leading-tight leading-tight">${fmtD(u.event_date)} • ${u.status_to}</span>
        ${showActions ? `<div class="flex space-x-2 leading-tight leading-tight">
          <button type="button" onclick="window.editHEntry('${u.id}')" class="text-blue-500 leading-none leading-tight"><i class="fa-solid fa-pencil leading-tight"></i></button>
          <button type="button" onclick="window.delHEntry('${u.id}')" class="text-red-300 leading-none leading-tight"><i class="fa-solid fa-trash-can leading-tight"></i></button>
        </div>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-2 text-[8px] font-bold text-slate-500 mb-2 leading-tight">
        <p><span class="uppercase">Nahlásil:</span> ${u.attendance || '--'}</p><p><span class="uppercase">Zodpovedný:</span> ${item.responsible_person || '--'}</p>
      </div>
      <p class="text-slate-500 leading-snug">${u.note || '--'}</p>
      ${(() => {
        let uPhotos = getPhotosForUpdate(u.id);
        if (uPhotos.length === 0 && u.photo_url) {
          uPhotos = [{ id: u.id, photo_url: u.photo_url, photo_thumb_url: u.photo_thumb_url }];
        }
        return uPhotos.length > 0 ? '<div class="flex flex-wrap gap-1 mt-2">' + uPhotos.map(p =>
          `<img loading="lazy" decoding="async" src="${p.photo_thumb_url || p.photo_url}" class="history-thumb" onclick="window.open('${p.photo_url}')">`
        ).join('') + '</div>' : '';
      })()}
    </div>`;
  }).join('');

  document.getElementById('m-status').classList.remove('hidden');

  // Permission-based button visibility
  var delBtn = document.getElementById('btn-del-issue'); if (delBtn) delBtn.classList.toggle('hidden', !canEdit());
  var archBtn = document.getElementById('btn-archive-issue'); if (archBtn) archBtn.classList.toggle('hidden', !canEdit());
  var saveBtn = document.getElementById('btn-save-stat'); if (saveBtn) saveBtn.classList.toggle('hidden', currentRole === 'pozorovatel');
};

window.editHEntry = (id) => {
  const e = allUpdates.find(u => u.id === id);
  if(!e) return;

  // highlight edited entry orange, reset others
  document.querySelectorAll('#m-history-list [data-uid]').forEach(function(el) {
    if (el.dataset.uid === id) {
      el.className = 'p-3 bg-orange-50 rounded-xl border border-orange-200 text-[10px] mb-2 leading-tight';
    } else {
      el.className = 'p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] mb-2 leading-tight';
    }
  });

  document.getElementById('f-stat-update-id').value = e.id;
  document.getElementById('f-stat-note').value = e.note || "";
  document.getElementById('f-stat-date').value = e.event_date ? e.event_date.split('T')[0] : "";
  document.getElementById('f-stat-val').value = e.status_to;
  document.getElementById('f-stat-reported-edit').value = e.attendance || "";

  // Load existing photos for this update (multi-photo)
  existingEditPhotos = getPhotosForUpdate(e.id);
  // Fallback: if no issue_photos rows, use legacy photo_url
  if (existingEditPhotos.length === 0 && e.photo_url) {
    existingEditPhotos = [{ id: '__legacy_' + e.id, photo_url: e.photo_url, photo_thumb_url: e.photo_thumb_url, issue_update_id: e.id }];
  }
  pendingEditPhotos = [];
  photosToRemoveIds = [];
  currentEditingPhotoUrl = e.photo_url || null;
  removePhotoFlag = false;

  // Hide old single-photo preview, use multi-photo grid instead
  var ep = document.getElementById('edit-photo-preview'); if (ep) ep.classList.add('hidden');
  renderPhotoGrid('edit-photos-grid', existingEditPhotos, pendingEditPhotos);

  var eb = document.getElementById('edit-mode-bar'); if (eb) eb.classList.remove('hidden');
};

window.delHEntry = async (id) => {
  var entry = allUpdates.find(u => u.id === id);
  if (entry && !canEditEntry(entry)) { alert('Nemáte oprávnenie mazať tento záznam.'); return; }
  if(confirm("Zmazať?")) {
    await sb.from('issue_updates').delete().eq('id', id);
    var issueId = document.getElementById('f-stat-id').value;
    await loadSections();
    window.prepStat(issueId);
  }
};

// -------- Forms (save) --------
document.getElementById('f-add').onsubmit = async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-save-new');
  btn.disabled = true;

  try {
    const locId = document.getElementById('f-add-loc-id').value;
    if (!locId) { alert('Vyber miestnosť.'); btn.disabled = false; return; }

    const file = document.getElementById('f-add-photo').files[0] || window.addGalleryFile;
    // Collect all pending photos (multi-photo: from pendingAddPhotos + legacy single file)
    var allAddFiles = pendingAddPhotos.slice();
    if (file && allAddFiles.length === 0) {
      allAddFiles.push({ file: file, previewUrl: '' });
    }

    const { data, error } = await sb.from('issues').insert([{
      location_id: locId,
      title: document.getElementById('f-add-title').value,
      responsible_person: document.getElementById('f-add-resp').value,
      reported_by: document.getElementById('f-add-reported').value,
      status: 'Zahlásené'
    }]).select();

    if (error) throw error;

    if (data?.[0]) {
      const { data: updData, error: upErr } = await sb.from('issue_updates').insert([{
        issue_id: data[0].id,
        status_to: 'Zahlásené',
        note: document.getElementById('f-add-note').value,
        event_date: document.getElementById('f-add-date').value,
        attendance: document.getElementById('f-add-reported').value,
        created_by: currentUserId
      }]).select();
      if (upErr) throw upErr;

      // Upload and save multi-photos to issue_photos table
      if (allAddFiles.length > 0 && updData?.[0]) {
        const uploaded = await uploadMultiplePhotos(allAddFiles);
        if (uploaded.length > 0) {
          await savePhotosForUpdate(updData[0].id, uploaded, []);
        }
      }

      hideM('m-add');
      e.target.reset();
      var pp = document.getElementById('add-photo-preview'); if (pp) pp.classList.add('hidden');
      var apg = document.getElementById('add-photos-grid'); if (apg) { apg.innerHTML = ''; apg.classList.add('hidden'); }
      pendingAddPhotos = [];
      window.addGalleryFile = null;
      await loadSections();
    }
  } catch (err) {
    console.error(err);
    alert("Nepodarilo sa uložiť. Pozri Console.");
  } finally {
    btn.disabled = false;
  }
};

document.getElementById('f-stat').onsubmit = async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-save-stat');
  btn.disabled = true;

  try {
    const uId = document.getElementById('f-stat-update-id').value;
    const id = document.getElementById('f-stat-id').value;
    const st = document.getElementById('f-stat-val').value;

    const file = document.getElementById('f-stat-photo').files[0] || window.editGalleryFile;
    // Collect pending edit photos (multi-photo: from pendingEditPhotos + legacy single file)
    var allEditFiles = pendingEditPhotos.slice();
    if (file && allEditFiles.length === 0) {
      allEditFiles.push({ file: file, previewUrl: '' });
    }

    const { error: issErr } = await sb.from('issues').update({
      title: document.getElementById('f-stat-title-edit').value,
      responsible_person: document.getElementById('f-stat-resp-edit').value,
      reported_by: document.getElementById('f-stat-reported-edit').value,
      location_id: document.getElementById('f-stat-loc-id').value,
      updated_at: new Date()
    }).eq('id', id);

    if (issErr) throw issErr;

    if (uId) {
      // Editing existing update
      const payload = {
        status_to: document.getElementById('f-stat-val').value,
        note: document.getElementById('f-stat-note').value,
        event_date: document.getElementById('f-stat-date').value,
        attendance: document.getElementById('f-stat-reported-edit').value
      };

      const { error: updErr } = await sb.from('issue_updates').update(payload).eq('id', uId);
      if (updErr) throw updErr;

      // Multi-photo: upload new, remove deleted
      const uploaded = allEditFiles.length > 0 ? await uploadMultiplePhotos(allEditFiles) : [];
      // Filter out legacy placeholder IDs
      var realRemoveIds = photosToRemoveIds.filter(function(rid) { return !rid.startsWith('__legacy_'); });
      await savePhotosForUpdate(uId, uploaded, realRemoveIds);

      // Handle legacy photo_url removal if legacy photo was removed
      var legacyRemoved = photosToRemoveIds.some(function(rid) { return rid.startsWith('__legacy_'); });
      if (legacyRemoved) {
        await sb.from('issue_updates').update({ photo_url: null, photo_thumb_url: null }).eq('id', uId);
      }

    } else {
      // Creating new update entry
      const { data: newUpd, error: insErr } = await sb.from('issue_updates').insert([{
        issue_id: id,
        status_to: document.getElementById('f-stat-val').value,
        note: document.getElementById('f-stat-note').value,
        event_date: document.getElementById('f-stat-date').value,
        attendance: document.getElementById('f-stat-reported-edit').value,
        created_by: currentUserId
      }]).select();
      if (insErr) throw insErr;

      // Multi-photo: upload and save
      if (allEditFiles.length > 0 && newUpd?.[0]) {
        const uploaded = await uploadMultiplePhotos(allEditFiles);
        if (uploaded.length > 0) {
          await savePhotosForUpdate(newUpd[0].id, uploaded, []);
        }
      }
    }

    await syncIssueStatusFromLastEvent(id);
    await loadSections();
    window.prepStat(id);

  } catch (err) {
    console.error(err);
    alert("Nepodarilo sa uložiť. Pozri Console.");
  } finally {
    btn.disabled = false;
  }
};

window.archiveIssue = async () => {
  if(confirm("Archivovať?")) {
    await sb.from('issues').update({ archived: true }).eq('id', document.getElementById('f-stat-id').value);
    hideM('m-status');
    await loadSections();
  }
};

window.restoreIssue = async (id) => {
  await sb.from('issues').update({ archived: false }).eq('id', id);
  await loadArchive();
};

window.confirmDelete = async () => {
  if(confirm("Vymazať natrvalo?")) {
    var issueId = document.getElementById('f-stat-id').value;
    await sb.from('issue_updates').delete().eq('issue_id', issueId);
    await sb.from('issues').delete().eq('id', issueId);
    hideM('m-status');
    await loadSections();
  }
};

window.previewAddPhoto = function(input) {
  var files = input.files;
  for (var i = 0; i < files.length; i++) {
    (function(f) {
      var r = new FileReader();
      r.onload = function(e) {
        pendingAddPhotos.push({ file: f, previewUrl: e.target.result });
        renderPhotoGrid('add-photos-grid', [], pendingAddPhotos);
      };
      r.readAsDataURL(f);
    })(files[i]);
  }
  input.value = '';
};

window.addGalleryFile = null;
window.editGalleryFile = null;

window.addPhotoFromGallery = function(input) {
  window.previewAddPhoto(input);
};

window.editPhotoFromGallery = function(input) {
  window.previewEditPhoto(input);
};

window.clearAddPhoto = function() {
  var i = document.getElementById('f-add-photo'); if (i) i.value = '';
  var g = document.getElementById('f-add-photo-gallery'); if (g) g.value = '';
  window.addGalleryFile = null;
  pendingAddPhotos = [];
  var p = document.getElementById('add-photo-preview'); if (p) p.classList.add('hidden');
  renderPhotoGrid('add-photos-grid', [], []);
};

window.previewEditPhoto = function(input) {
  var files = input.files;
  for (var i = 0; i < files.length; i++) {
    (function(f) {
      var r = new FileReader();
      r.onload = function(e) {
        pendingEditPhotos.push({ file: f, previewUrl: e.target.result });
        renderPhotoGrid('edit-photos-grid', existingEditPhotos.filter(function(p) {
          return photosToRemoveIds.indexOf(p.id) === -1;
        }), pendingEditPhotos);
      };
      r.readAsDataURL(f);
    })(files[i]);
  }
  input.value = '';
};

// Multi-photo: remove pending photo from queue
window.removePendingPhoto = function(containerId, index) {
  if (containerId === 'add-photos-grid') {
    pendingAddPhotos.splice(index, 1);
    renderPhotoGrid('add-photos-grid', [], pendingAddPhotos);
  } else {
    pendingEditPhotos.splice(index, 1);
    renderPhotoGrid('edit-photos-grid', existingEditPhotos.filter(function(p) {
      return photosToRemoveIds.indexOf(p.id) === -1;
    }), pendingEditPhotos);
  }
};

// Multi-photo: mark existing photo for removal
window.removeExistingPhoto = function(containerId, photoId) {
  photosToRemoveIds.push(photoId);
  renderPhotoGrid('edit-photos-grid', existingEditPhotos.filter(function(p) {
    return photosToRemoveIds.indexOf(p.id) === -1;
  }), pendingEditPhotos);
};

window.deleteOrphan = async (id) => {
  if (!confirm('Vymazať tento záznam bez lokácie? Vymaže sa aj celá história.')) return;
  await sb.from('issue_updates').delete().eq('issue_id', id);
  await sb.from('issues').delete().eq('id', id);
  await loadSections();
};

window.resetToNewEntry = function() {
  document.getElementById('f-stat-update-id').value = '';
  document.getElementById('f-stat-note').value = '';
  document.getElementById('f-stat-date').value = new Date().toISOString().split('T')[0];
  var ep = document.getElementById('edit-photo-preview'); if (ep) ep.classList.add('hidden');
  var ef = document.getElementById('f-stat-photo'); if (ef) ef.value = '';
  var eb = document.getElementById('edit-mode-bar'); if (eb) eb.classList.add('hidden');
  currentEditingPhotoUrl = null;
  removePhotoFlag = false;
  // Reset multi-photo state
  pendingEditPhotos = [];
  existingEditPhotos = [];
  photosToRemoveIds = [];
  renderPhotoGrid('edit-photos-grid', [], []);
  // reset orange highlights
  document.querySelectorAll('#m-history-list [data-uid]').forEach(function(el) {
    el.className = 'p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] mb-2 leading-tight';
  });
};

// -------- Permission helpers --------
function canEdit() { return ['admin', 'ekonom', 'spravca', 'zastupca'].includes(currentRole); }
function canAdd() { return ['admin', 'ekonom', 'spravca', 'zastupca', 'pracovnik'].includes(currentRole); }

function canEditEntry(entry) {
  if (['admin', 'ekonom', 'spravca', 'zastupca'].includes(currentRole)) return true;
  if (currentRole === 'pracovnik') {
    var today = new Date().toISOString().split('T')[0];
    var entryDate = entry.event_date ? entry.event_date.split('T')[0] : '';
    return entry.created_by === currentUserId && entryDate === today;
  }
  return false;
}

// -------- Admin panel --------
// ============ FINANCE MODULE ============

var allCategories = [];
var editingExpenseId = null;


