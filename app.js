const S_URL = 'https://tyimhlqtncjynutxihrf.supabase.co';
const S_KEY = 'sb_publishable_jX6gFj0WZfxXFNpwF1bTuw_dQADscTW';
const sb = supabase.createClient(S_URL, S_KEY);

let allLocs = [], allIssues = [], allUpdates = [];
let allZones = [], currentZoneId = null, userZoneIds = [];
let currentEditingPhotoUrl = null;
let removePhotoFlag = false;
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
  var isAdmin = currentRole === 'admin' || currentRole === 'spravca';
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
      console.log('Vybavené ' + thisYear + ':', resolvedDate, iss.id, iss.title, iss.archived ? 'ARCHIV' : 'aktívne');
    }
  });
  console.log('CELKOM vybavené ' + thisYear + ':', resolvedThisYear);
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
  console.log('Prepočítané statusy pre ' + issues.length + ' záznamov');
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

      const photos = allUpdates
        .filter(u => u.issue_id === i.id && u.photo_url)
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
        if (dateFrom && u.event_date < dateFrom) return false;
        if (dateTo && u.event_date > dateTo) return false;
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
              (u.photo_url ? '<img loading="eager" decoding="async" src="' + (u.photo_thumb_url || u.photo_url) + '" class="report-thumb cursor-pointer" onclick="window.open(\'' + u.photo_url + '\')">' : '') +
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
      ${u.photo_url ? `<img loading="lazy" decoding="async" src="${u.photo_thumb_url || u.photo_url}" class="history-thumb" onclick="window.open('${u.photo_url}')">` : ''}
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

  if(e.photo_url) {
    document.getElementById('edit-photo-preview').classList.remove('hidden');
    document.getElementById('edit-photo-img').src = e.photo_thumb_url || e.photo_url;
    currentEditingPhotoUrl = e.photo_url;
    removePhotoFlag = false;

  } else {
    document.getElementById('edit-photo-preview').classList.add('hidden');
    currentEditingPhotoUrl = null;
    removePhotoFlag = false;
  }

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
    const up = file ? await uploadPhotoWithThumb(file, `upd_${Date.now()}`) : { photo_url: null, photo_thumb_url: null };

    const { data, error } = await sb.from('issues').insert([{
      location_id: locId,
      title: document.getElementById('f-add-title').value,
      responsible_person: document.getElementById('f-add-resp').value,
      reported_by: document.getElementById('f-add-reported').value,
      status: 'Zahlásené'
    }]).select();

    if (error) throw error;

    if (data?.[0]) {
      const { error: upErr } = await sb.from('issue_updates').insert([{
        issue_id: data[0].id,
        status_to: 'Zahlásené',
        note: document.getElementById('f-add-note').value,
        event_date: document.getElementById('f-add-date').value,
        photo_url: up.photo_url,
        photo_thumb_url: up.photo_thumb_url,
        attendance: document.getElementById('f-add-reported').value,
        created_by: currentUserId
      }]);
      if (upErr) throw upErr;

      hideM('m-add');
      e.target.reset();
      var pp = document.getElementById('add-photo-preview'); if (pp) pp.classList.add('hidden');
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
    const up = file ? await uploadPhotoWithThumb(file, `upd_${uId || Date.now()}`) : null;

    const { error: issErr } = await sb.from('issues').update({
      title: document.getElementById('f-stat-title-edit').value,
      responsible_person: document.getElementById('f-stat-resp-edit').value,
      reported_by: document.getElementById('f-stat-reported-edit').value,
      location_id: document.getElementById('f-stat-loc-id').value,
      updated_at: new Date()
    }).eq('id', id);

    if (issErr) throw issErr;

    if (uId) {
      const payload = {
        status_to: document.getElementById('f-stat-val').value,
        note: document.getElementById('f-stat-note').value,
        event_date: document.getElementById('f-stat-date').value,
        attendance: document.getElementById('f-stat-reported-edit').value
      };

      if (removePhotoFlag) {
        payload.photo_url = null;
        payload.photo_thumb_url = null;
      } else if (up?.photo_url) {
        payload.photo_url = up.photo_url;
        if (up?.photo_thumb_url) payload.photo_thumb_url = up.photo_thumb_url;
      } else if (currentEditingPhotoUrl) {
        payload.photo_url = currentEditingPhotoUrl;
      }

      const { error: updErr } = await sb.from('issue_updates').update(payload).eq('id', uId);
      if (updErr) throw updErr;

    } else {
      const { error: insErr } = await sb.from('issue_updates').insert([{
        issue_id: id,
        status_to: document.getElementById('f-stat-val').value,
        note: document.getElementById('f-stat-note').value,
        event_date: document.getElementById('f-stat-date').value,
        photo_url: up?.photo_url || null,
        photo_thumb_url: up?.photo_thumb_url || null,
        attendance: document.getElementById('f-stat-reported-edit').value,
        created_by: currentUserId
      }]);
      if (insErr) throw insErr;
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
  var f = input.files[0];
  var p = document.getElementById('add-photo-preview');
  var im = document.getElementById('add-photo-img');
  if (f && p && im) {
    var r = new FileReader();
    r.onload = function(e) { im.src = e.target.result; p.classList.remove('hidden'); };
    r.readAsDataURL(f);
  } else if (p) { p.classList.add('hidden'); }
};

window.addGalleryFile = null;
window.editGalleryFile = null;

window.addPhotoFromGallery = function(input) {
  window.addGalleryFile = input.files[0];
  window.previewAddPhoto(input);
};

window.editPhotoFromGallery = function(input) {
  window.editGalleryFile = input.files[0];
  window.previewEditPhoto(input);
};

window.clearAddPhoto = function() {
  var i = document.getElementById('f-add-photo'); if (i) i.value = '';
  var g = document.getElementById('f-add-photo-gallery'); if (g) g.value = '';
  window.addGalleryFile = null;
  var p = document.getElementById('add-photo-preview'); if (p) p.classList.add('hidden');
};

window.previewEditPhoto = function(input) {
  var f = input.files[0];
  var p = document.getElementById('edit-photo-preview');
  var im = document.getElementById('edit-photo-img');
  if (f && p && im) {
    var r = new FileReader();
    r.onload = function(e) { im.src = e.target.result; p.classList.remove('hidden'); };
    r.readAsDataURL(f);
    removePhotoFlag = false;
  }
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
  // reset orange highlights
  document.querySelectorAll('#m-history-list [data-uid]').forEach(function(el) {
    el.className = 'p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] mb-2 leading-tight';
  });
};

// -------- Permission helpers --------
function canEdit() { return ['admin', 'spravca'].includes(currentRole); }
function canAdd() { return ['admin', 'spravca', 'pracovnik'].includes(currentRole); }

function canEditEntry(entry) {
  if (['admin', 'spravca'].includes(currentRole)) return true;
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

async function loadFinance() {
  // Load categories
  var { data: cats = [] } = await sb.from('cost_categories').select('*').order('sort_order', { ascending: true });
  allCategories = cats;

  // Zones grid - metraže
  var zonesGrid = document.getElementById('fin-zones-grid');
  if (zonesGrid) {
    zonesGrid.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory'; }).map(function(z) {
      var label = z.tenant_name || z.name;
      return '<div class="flex items-center space-x-2 bg-slate-50 rounded-xl px-3 py-2">' +
        '<span class="text-[9px] font-bold text-slate-600 flex-1 truncate">' + label + '</span>' +
        '<input type="number" step="0.01" value="' + (z.area_m2 || 0) + '" data-zone-id="' + z.id + '" class="zone-area-input w-14 text-right border border-slate-200 rounded-lg px-1 py-1 text-[10px] font-bold">' +
        '<span class="text-[8px] text-slate-400">m²</span>' +
        '</div>';
    }).join('');
  }

  // Category filter dropdown
  var catFilter = document.getElementById('fin-cat-filter');
  if (catFilter) {
    catFilter.innerHTML = '<option value="all">Všetky</option>' + cats.map(function(c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join('');
  }

  // Category dropdown in modal
  var expCat = document.getElementById('exp-category');
  if (expCat) {
    expCat.innerHTML = cats.map(function(c) {
      return '<option value="' + c.id + '">' + c.name + '</option>';
    }).join('');
  }

  // Zone dropdown in modal
  var expZone = document.getElementById('exp-zone');
  if (expZone) {
    expZone.innerHTML = '<option value="">— Celá budova —</option>' + allZones.map(function(z) {
      var label = z.tenant_name || z.name;
      return '<option value="' + z.id + '">' + label + '</option>';
    }).join('');
  }

  // Year dropdown
  var yearSel = document.getElementById('fin-year');
  if (yearSel && yearSel.options.length === 0) {
    var curYear = new Date().getFullYear();
    for (var y = curYear; y >= 2020; y--) {
      yearSel.innerHTML += '<option value="' + y + '">' + y + '</option>';
    }
  }

  // Set default date
  var expDate = document.getElementById('exp-date');
  if (expDate && !expDate.value) expDate.value = new Date().toISOString().split('T')[0];

  await loadMeters();
  await loadExpenses();
}

// ---- MERAČE ----
var allMeters = [];
var editingMeterId = null;
var currentReadingMeterId = null;

async function loadMeters() {
  var { data: meters = [] } = await sb.from('meters').select('*, zones(name, tenant_name)').order('sort_order', { ascending: true });
  allMeters = meters;

  var { data: readings = [] } = await sb.from('meter_readings').select('*').order('date', { ascending: false });

  // Zone dropdown in meter modal
  var mtrZone = document.getElementById('mtr-zone');
  if (mtrZone) {
    mtrZone.innerHTML = '<option value="">— Celá budova / Blok —</option>' + allZones.map(function(z) {
      return '<option value="' + z.id + '">' + (z.tenant_name || z.name) + '</option>';
    }).join('');
  }

  var typeIcons = { water: 'fa-droplet', electricity: 'fa-bolt', gas: 'fa-fire' };
  var typeColors = { water: 'text-blue-500', electricity: 'text-yellow-600', gas: 'text-orange-500' };

  var list = document.getElementById('fin-meters-list');
  if (meters.length === 0) {
    list.innerHTML = '<p class="text-center py-6 text-[10px] text-slate-200 font-bold uppercase">Žiadne merače</p>';
    return;
  }

  list.innerHTML = '<div class="space-y-3">' + meters.map(function(m) {
    var zoneName = m.zones ? (m.zones.tenant_name || m.zones.name) : 'Celá budova';
    var meterReadings = readings.filter(function(r) { return r.meter_id === m.id; });
    var last = meterReadings.length > 0 ? meterReadings[0] : null;
    var prev = meterReadings.length > 1 ? meterReadings[1] : null;
    var consumption = (last && prev) ? (parseFloat(last.value) - parseFloat(prev.value)).toFixed(2) : null;

    return '<div class="bg-slate-50 rounded-xl p-4">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<div class="flex items-center space-x-2">' +
          '<i class="fa-solid ' + (typeIcons[m.type] || 'fa-gauge') + ' ' + (typeColors[m.type] || '') + '"></i>' +
          '<span class="text-xs font-bold text-slate-800">' + m.name + '</span>' +
          '<span class="text-[8px] text-slate-400">' + zoneName + '</span>' +
          (m.meter_number ? '<span class="text-[8px] text-slate-300">#' + m.meter_number + '</span>' : '') +
        '</div>' +
        '<div class="flex items-center space-x-2">' +
          '<button onclick="window.showAddReading(\'' + m.id + '\')" class="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[8px] font-black uppercase">+ Odčítanie</button>' +
          '<button onclick="window.editMeter(\'' + m.id + '\')" class="text-slate-300 hover:text-blue-500 text-xs"><i class="fa-solid fa-pen"></i></button>' +
          '<button onclick="window.deleteMeter(\'' + m.id + '\')" class="text-slate-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      (last ? '<div class="flex items-center space-x-4">' +
        '<div>' +
          '<p class="text-[8px] font-black text-slate-400 uppercase">Posledné</p>' +
          '<p class="text-sm font-bold text-slate-700">' + parseFloat(last.value).toFixed(2) + ' ' + m.unit + ' <span class="text-[8px] text-slate-400">' + fmtD(last.date) + '</span></p>' +
        '</div>' +
        (prev ? '<div>' +
          '<p class="text-[8px] font-black text-slate-400 uppercase">Predchádzajúce</p>' +
          '<p class="text-sm font-bold text-slate-400">' + parseFloat(prev.value).toFixed(2) + ' ' + m.unit + ' <span class="text-[8px] text-slate-300">' + fmtD(prev.date) + '</span></p>' +
        '</div>' : '') +
        (consumption ? '<div>' +
          '<p class="text-[8px] font-black text-slate-400 uppercase">Spotreba</p>' +
          '<p class="text-sm font-black text-green-600">' + consumption + ' ' + m.unit + '</p>' +
        '</div>' : '') +
      '</div>' : '<p class="text-[9px] text-slate-300 italic">Žiadne odčítanie</p>') +
      (meterReadings.length > 0 ? '<details class="mt-2"><summary class="text-[8px] font-bold text-slate-400 uppercase cursor-pointer">História (' + meterReadings.length + ')</summary>' +
        '<div class="mt-2 space-y-1">' + meterReadings.slice(0, 10).map(function(r, idx) {
          var prevR = meterReadings[idx + 1];
          var cons = prevR ? (parseFloat(r.value) - parseFloat(prevR.value)).toFixed(2) : '--';
          return '<div class="flex items-center justify-between text-[9px] text-slate-500 bg-white rounded-lg px-3 py-1.5">' +
            '<span>' + fmtD(r.date) + '</span>' +
            '<span class="font-bold">' + parseFloat(r.value).toFixed(2) + ' ' + m.unit + '</span>' +
            '<span class="text-green-600 font-bold">' + (cons !== '--' ? '+' + cons : '--') + '</span>' +
            '<button onclick="window.deleteReading(\'' + r.id + '\')" class="text-red-300 hover:text-red-500"><i class="fa-solid fa-xmark"></i></button>' +
          '</div>';
        }).join('') + '</div></details>' : '') +
    '</div>';
  }).join('') + '</div>';
}

window.showAddMeter = function() {
  editingMeterId = null;
  document.getElementById('meter-modal-title').innerText = 'Nový merač';
  document.getElementById('mtr-name').value = '';
  document.getElementById('mtr-type').value = 'water';
  document.getElementById('mtr-zone').value = '';
  document.getElementById('mtr-number').value = '';
  document.getElementById('mtr-note').value = '';
  document.getElementById('modal-meter').classList.remove('hidden');
};

window.editMeter = async function(id) {
  var { data: m } = await sb.from('meters').select('*').eq('id', id).single();
  if (!m) return;
  editingMeterId = id;
  document.getElementById('meter-modal-title').innerText = 'Upraviť merač';
  document.getElementById('mtr-name').value = m.name;
  document.getElementById('mtr-type').value = m.type;
  document.getElementById('mtr-zone').value = m.zone_id || '';
  document.getElementById('mtr-number').value = m.meter_number || '';
  document.getElementById('mtr-note').value = m.note || '';
  document.getElementById('modal-meter').classList.remove('hidden');
};

window.saveMeter = async function() {
  var unitMap = { water: 'm³', electricity: 'kWh', gas: 'm³' };
  var type = document.getElementById('mtr-type').value;
  var data = {
    name: document.getElementById('mtr-name').value.trim(),
    type: type,
    unit: unitMap[type] || 'm³',
    zone_id: document.getElementById('mtr-zone').value || null,
    meter_number: document.getElementById('mtr-number').value.trim() || null,
    note: document.getElementById('mtr-note').value.trim() || null
  };
  if (!data.name) { alert('Vyplňte názov.'); return; }

  if (editingMeterId) {
    await sb.from('meters').update(data).eq('id', editingMeterId);
  } else {
    await sb.from('meters').insert(data);
  }
  document.getElementById('modal-meter').classList.add('hidden');
  await loadMeters();
};

window.deleteMeter = async function(id) {
  if (!confirm('Vymazať merač a všetky odčítania?')) return;
  await sb.from('meters').delete().eq('id', id);
  await loadMeters();
};

window.showAddReading = async function(meterId) {
  currentReadingMeterId = meterId;
  var meter = allMeters.find(function(m) { return m.id === meterId; });
  document.getElementById('reading-meter-name').innerText = meter ? meter.name : '';
  document.getElementById('rdg-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('rdg-value').value = '';
  document.getElementById('rdg-note').value = '';

  var { data: prev = [] } = await sb.from('meter_readings').select('*').eq('meter_id', meterId).order('date', { ascending: false }).limit(1);
  var prevInfo = document.getElementById('reading-prev-info');
  if (prev.length > 0) {
    prevInfo.classList.remove('hidden');
    document.getElementById('reading-prev-date').innerText = fmtD(prev[0].date);
    document.getElementById('reading-prev-value').innerText = parseFloat(prev[0].value).toFixed(2) + ' ' + (meter ? meter.unit : '');
  } else {
    prevInfo.classList.add('hidden');
  }

  document.getElementById('modal-reading').classList.remove('hidden');
};

window.saveReading = async function() {
  var data = {
    meter_id: currentReadingMeterId,
    date: document.getElementById('rdg-date').value,
    value: parseFloat(document.getElementById('rdg-value').value) || 0,
    note: document.getElementById('rdg-note').value.trim() || null,
    created_by: currentUserId
  };
  if (!data.value) { alert('Zadajte stav merača.'); return; }

  await sb.from('meter_readings').insert(data);
  document.getElementById('modal-reading').classList.add('hidden');
  await loadMeters();
};

window.deleteReading = async function(id) {
  if (!confirm('Vymazať toto odčítanie?')) return;
  await sb.from('meter_readings').delete().eq('id', id);
  await loadMeters();
};

window.loadExpenses = async function() {
  var year = document.getElementById('fin-year').value || new Date().getFullYear();
  var catFilter = document.getElementById('fin-cat-filter').value;

  var query = sb.from('expenses').select('*, cost_categories(name), zones(name, tenant_name)')
    .gte('date', year + '-01-01').lte('date', year + '-12-31')
    .order('date', { ascending: false });

  if (catFilter !== 'all') query = query.eq('category_id', catFilter);

  var { data: expenses = [] } = await query;

  var list = document.getElementById('fin-expenses-list');
  if (expenses.length === 0) {
    list.innerHTML = '<p class="text-center py-8 text-[10px] text-slate-200 font-bold uppercase">Žiadne náklady</p>';
    document.getElementById('fin-total-amount').innerText = '0 €';
    return;
  }

  var total = 0;
  list.innerHTML = '<div class="space-y-2">' + expenses.map(function(e) {
    total += parseFloat(e.amount) || 0;
    var zoneName = e.zones ? (e.zones.tenant_name || e.zones.name) : 'Celá budova';
    var catName = e.cost_categories ? e.cost_categories.name : '--';
    return '<div class="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center space-x-2">' +
          '<span class="text-[8px] font-black text-slate-400 uppercase">' + fmtD(e.date) + '</span>' +
          '<span class="text-[8px] font-bold text-blue-500 uppercase">' + catName + '</span>' +
          '<span class="text-[8px] text-slate-300">' + zoneName + '</span>' +
        '</div>' +
        '<p class="text-xs font-bold text-slate-700 truncate">' + e.description + '</p>' +
        (e.supplier ? '<p class="text-[8px] text-slate-400">' + e.supplier + (e.invoice_number ? ' • ' + e.invoice_number : '') + '</p>' : '') +
      '</div>' +
      '<div class="flex items-center space-x-3 ml-3">' +
        (e.receipt_url ? '<a href="' + e.receipt_url + '" target="_blank" class="text-green-400 hover:text-green-600 text-xs" title="Účtenka"><i class="fa-solid fa-file-image"></i></a>' : '') +
        '<span class="text-sm font-black text-slate-900 whitespace-nowrap">' + parseFloat(e.amount).toFixed(2) + ' €</span>' +
        '<button onclick="window.editExpense(\'' + e.id + '\')" class="text-blue-400 hover:text-blue-600 text-xs"><i class="fa-solid fa-pen"></i></button>' +
        '<button onclick="window.deleteExpense(\'' + e.id + '\')" class="text-red-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>' +
      '</div>' +
    '</div>';
  }).join('') + '</div>';

  document.getElementById('fin-total-amount').innerText = total.toFixed(2) + ' €';
};

window.saveZoneAreas = async function() {
  var inputs = document.querySelectorAll('.zone-area-input');
  for (var i = 0; i < inputs.length; i++) {
    var zoneId = inputs[i].getAttribute('data-zone-id');
    var area = parseFloat(inputs[i].value) || 0;
    await sb.from('zones').update({ area_m2: area }).eq('id', zoneId);
  }
  // Update local
  for (var j = 0; j < allZones.length; j++) {
    var inp = document.querySelector('[data-zone-id="' + allZones[j].id + '"]');
    if (inp) allZones[j].area_m2 = parseFloat(inp.value) || 0;
  }
  alert('Metraže uložené.');
};

window.showAddExpense = function() {
  editingExpenseId = null;
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-supplier').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-zone').value = '';
  document.getElementById('exp-invoice').value = '';
  document.getElementById('exp-note').value = '';
  document.getElementById('exp-receipt').value = '';
  document.getElementById('exp-receipt-preview').classList.add('hidden');
  document.getElementById('btn-ai-extract').classList.add('hidden');
  var status = document.getElementById('ai-extract-status');
  status.classList.add('hidden');
  status.className = status.className.replace('text-green-600', 'text-blue-500').replace('text-red-500', 'text-blue-500');
  document.getElementById('modal-expense').classList.remove('hidden');
};

window.closeExpenseModal = function() {
  document.getElementById('modal-expense').classList.add('hidden');
};

window.saveExpense = async function() {
  var data = {
    date: document.getElementById('exp-date').value,
    category_id: document.getElementById('exp-category').value,
    description: document.getElementById('exp-desc').value.trim(),
    supplier: document.getElementById('exp-supplier').value.trim() || null,
    amount: parseFloat(document.getElementById('exp-amount').value) || 0,
    zone_id: document.getElementById('exp-zone').value || null,
    invoice_number: document.getElementById('exp-invoice').value.trim() || null,
    note: document.getElementById('exp-note').value.trim() || null,
    created_by: currentUserId
  };

  if (!data.description || !data.amount) {
    alert('Vyplňte popis a sumu.');
    return;
  }

  // Upload receipt if selected
  var receiptFile = document.getElementById('exp-receipt').files[0];
  if (receiptFile) {
    var receiptUrl = await uploadReceipt(receiptFile);
    if (receiptUrl) data.receipt_url = receiptUrl;
  }

  if (editingExpenseId) {
    await sb.from('expenses').update(data).eq('id', editingExpenseId);
  } else {
    await sb.from('expenses').insert(data);
  }

  window.closeExpenseModal();
  await loadExpenses();
};

window.editExpense = async function(id) {
  var { data: e } = await sb.from('expenses').select('*').eq('id', id).single();
  if (!e) return;

  editingExpenseId = id;
  document.getElementById('exp-date').value = e.date;
  document.getElementById('exp-category').value = e.category_id;
  document.getElementById('exp-desc').value = e.description;
  document.getElementById('exp-supplier').value = e.supplier || '';
  document.getElementById('exp-amount').value = e.amount;
  document.getElementById('exp-zone').value = e.zone_id || '';
  document.getElementById('exp-invoice').value = e.invoice_number || '';
  document.getElementById('exp-note').value = e.note || '';
  document.getElementById('modal-expense').classList.remove('hidden');
};

window.deleteExpense = async function(id) {
  if (!confirm('Vymazať tento náklad?')) return;
  await sb.from('expenses').delete().eq('id', id);
  await loadExpenses();
};

// Receipt file preview
var expReceipt = document.getElementById('exp-receipt');
if (expReceipt) expReceipt.addEventListener('change', function(e) {
  var file = e.target.files[0];
  var preview = document.getElementById('exp-receipt-preview');
  var img = document.getElementById('exp-receipt-img');
  var aiBtn = document.getElementById('btn-ai-extract');

  if (file) {
    if (file.type.startsWith('image/')) {
      var reader = new FileReader();
      reader.onload = function(ev) {
        img.src = ev.target.result;
        preview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    } else {
      preview.classList.add('hidden');
    }
    aiBtn.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
    aiBtn.classList.add('hidden');
  }
});

// Upload receipt to Supabase Storage
async function uploadReceipt(file) {
  var ext = file.name.split('.').pop();
  var fileName = 'receipt_' + Date.now() + '.' + ext;
  var { data, error } = await sb.storage.from('receipts').upload(fileName, file);
  if (error) { console.error('Upload error:', error); return null; }
  var { data: urlData } = sb.storage.from('receipts').getPublicUrl(fileName);
  return urlData.publicUrl;
}

// AI Extract from receipt
var anthropicKey = null;

window.aiExtractReceipt = async function() {
  var file = document.getElementById('exp-receipt').files[0];
  if (!file) { alert('Najprv vyberte súbor.'); return; }

  if (!anthropicKey) {
    anthropicKey = prompt('Zadajte Anthropic API kľúč (len prvýkrát):');
    if (!anthropicKey) return;
  }

  var status = document.getElementById('ai-extract-status');
  status.classList.remove('hidden');
  status.innerText = 'Analyzujem účtenku...';

  try {
    // Convert to base64
    var base64 = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() { resolve(reader.result.split(',')[1]); };
      reader.onerror = function() { reject('Chyba čítania'); };
      reader.readAsDataURL(file);
    });

    var mediaType = file.type || 'image/jpeg';
    var content = [];

    if (file.type === 'application/pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }

    content.push({ type: 'text', text: 'Analyzuj túto účtenku/faktúru. Vráť LEN JSON bez markdown, bez backticks:\n{"date":"YYYY-MM-DD","description":"stručný popis","supplier":"názov dodávateľa","amount":číslo,"invoice_number":"číslo faktúry alebo null","category":"jedna z: Vykurovanie, EPS a PO, Odvoz smetí, Voda a kanalizácia, Elektrina, Správa, Náklady na budovu, Údržba, Ostatné"}' });

    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: content }]
      })
    });

    var data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    var text = data.content.map(function(b) { return b.text || ''; }).join('');
    var clean = text.replace(/```json|```/g, '').trim();
    var result = JSON.parse(clean);

    // Fill form
    if (result.date) document.getElementById('exp-date').value = result.date;
    if (result.description) document.getElementById('exp-desc').value = result.description;
    if (result.supplier) document.getElementById('exp-supplier').value = result.supplier;
    if (result.amount) document.getElementById('exp-amount').value = result.amount;
    if (result.invoice_number) document.getElementById('exp-invoice').value = result.invoice_number;

    // Match category
    if (result.category) {
      var cat = allCategories.find(function(c) { return c.name === result.category; });
      if (cat) document.getElementById('exp-category').value = cat.id;
    }

    status.innerText = 'Hotovo – skontrolujte údaje';
    status.classList.add('text-green-600');
    status.classList.remove('text-blue-500');
  } catch (err) {
    console.error('AI error:', err);
    status.innerText = 'Chyba: ' + (err.message || 'Nepodarilo sa analyzovať');
    status.classList.add('text-red-500');
    status.classList.remove('text-blue-500');
    if (err.message && err.message.includes('invalid x-api-key')) anthropicKey = null;
  }
};

// ============ END FINANCE MODULE ============

async function loadAdmin() {
  if (currentRole !== 'admin') return;
  const { data: users = [] } = await sb.from('user_profiles').select('*').order('created_at', { ascending: true });
  const { data: allAccess = [] } = await sb.from('user_zone_access').select('*');

  var roleLabels = { admin: 'Admin', spravca: 'Správca', pracovnik: 'Pracovník', pozorovatel: 'Pozorovateľ' };

  document.getElementById('admin-user-list').innerHTML = users.length === 0
    ? '<p class="text-center text-slate-300 text-[10px] font-bold uppercase py-6">Žiadni používatelia</p>'
    : users.map(u => {
      var userAccess = allAccess.filter(function(a) { return a.user_id === u.user_id; });
      var userZoneIds = userAccess.map(function(a) { return a.zone_id; });
      var isAdminOrSpravca = u.role === 'admin' || u.role === 'spravca';

      var zoneCheckboxes = isAdminOrSpravca
        ? '<p class="text-[8px] text-slate-400 italic mt-2">Admin/Správca má prístup ku všetkým zónam</p>'
        : '<div class="mt-3">' +
          '<p class="text-[8px] font-black text-slate-400 uppercase mb-1">Zóny:</p>' +
          '<div class="grid grid-cols-2 min-[420px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-2 gap-y-1">' +
          allZones.map(function(z) {
            var checked = userZoneIds.indexOf(z.id) !== -1 ? 'checked' : '';
            var label = z.tenant_name ? z.tenant_name : z.name;
            return '<label class="flex items-center space-x-1 text-[9px] text-slate-600">' +
              '<input type="checkbox" ' + checked + ' onchange="window.toggleUserZone(\'' + u.user_id + '\', \'' + z.id + '\', this.checked)" class="rounded">' +
              '<span>' + label + '</span></label>';
          }).join('') +
          '</div></div>';

      return `
      <div class="p-4 bg-slate-50 rounded-xl">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <p class="text-xs font-bold text-slate-800">${u.display_name || '--'}</p>
            <p class="text-[9px] text-slate-400">${u.email}</p>
          </div>
          <div class="flex items-center space-x-3">
            <select onchange="window.changeUserRole('${u.id}', this.value)" class="text-[10px] font-bold border border-slate-200 rounded-lg px-2 py-1 ${u.user_id === currentUserId ? 'opacity-50' : ''}" ${u.user_id === currentUserId ? 'disabled' : ''}>
              ${['admin','spravca','pracovnik','pozorovatel'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabels[r]}</option>`).join('')}
            </select>
            ${u.user_id !== currentUserId ? `<button onclick="window.deleteUser('${u.id}')" class="text-red-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>
        ${zoneCheckboxes}
      </div>`;
    }).join('');
}

window.changeUserRole = async (profileId, newRole) => {
  await sb.from('user_profiles').update({ role: newRole }).eq('id', profileId);
  await loadAdmin();
};

window.toggleUserZone = async (userId, zoneId, checked) => {
  if (checked) {
    await sb.from('user_zone_access').insert({ user_id: userId, zone_id: zoneId });
  } else {
    await sb.from('user_zone_access').delete().eq('user_id', userId).eq('zone_id', zoneId);
  }
};

window.deleteUser = async (profileId) => {
  if (!confirm('Vymazať tohto používateľa?')) return;
  await sb.from('user_profiles').delete().eq('id', profileId);
  await loadAdmin();
};

window.changeOwnPassword = async () => {
  var input = document.getElementById('own-new-pass');
  var newPass = input ? input.value.trim() : '';
  if (newPass.length < 6) { alert('Heslo musí mať aspoň 6 znakov.'); return; }

  try {
    const { error } = await sb.auth.updateUser({ password: newPass });
    if (error) throw error;
    input.value = '';
    alert('Heslo zmenené.');
  } catch (err) {
    console.error(err);
    alert('Chyba: ' + (err.message || 'Nepodarilo sa zmeniť heslo.'));
  }
};

document.getElementById('f-add-user').onsubmit = async (e) => {
  e.preventDefault();
  var email = document.getElementById('f-user-email').value;
  var pass = document.getElementById('f-user-pass').value;
  var name = document.getElementById('f-user-name').value;
  var role = document.getElementById('f-user-role').value;

  if (pass.length < 6) { alert('Heslo musí mať aspoň 6 znakov.'); return; }

  try {
    var result = await sbCreate.auth.signUp({ email: email, password: pass });
    if (result.error) throw result.error;
    if (!result.data.user) throw new Error('Nepodarilo sa vytvoriť používateľa');

    // Create profile
    const { error: profErr } = await sb.from('user_profiles').insert([{
      user_id: result.data.user.id,
      email: email,
      display_name: name,
      role: role
    }]);
    if (profErr) throw profErr;

    e.target.reset();
    await loadAdmin();
    alert('Používateľ vytvorený.');

  } catch (err) {
    console.error(err);
    alert('Chyba: ' + (err.message || 'Nepodarilo sa.'));
  }
};

async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUserId = session.user.id;

    // Fetch user role
    const { data: profile } = await sb.from('user_profiles').select('role, display_name').eq('user_id', currentUserId).single();
    currentRole = profile ? profile.role : 'spravca';

    // Load zones
    var zonesResult = await sb.from('zones').select('*').order('sort_order', { ascending: true });
    allZones = zonesResult.data || [];

    // Load user zone access
    var accessResult = await sb.from('user_zone_access').select('zone_id').eq('user_id', currentUserId);
    userZoneIds = (accessResult.data || []).map(function(a) { return a.zone_id; });

    // Ak zóny ešte neexistujú, pokračuj bez nich
    if (allZones.length === 0) {
      currentZoneId = null;
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('app-view').classList.remove('hidden');
      applyPermissions();
      switchView('insp');
      return;
    }

    // Admin/spravca sees all zones
    var isAdmin = currentRole === 'admin' || currentRole === 'spravca';
    var availableZones = isAdmin ? allZones : allZones.filter(function(z) { return userZoneIds.indexOf(z.id) !== -1; });

    // If user has no zone access and is not admin, show first zone as fallback
    if (availableZones.length === 0) availableZones = allZones.slice(0, 1);

    // Populate zone selectors - "Všetko" pre kohokoľvek s 2+ zónami
    var allOpt = (isAdmin || availableZones.length > 1) ? '<option value="all">— Všetko —</option>' : '';
    var opts = availableZones.map(function(z) {
      var label = z.tenant_name || z.name;
      return '<option value="' + z.id + '">' + label + '</option>';
    }).join('') + allOpt;

    var sel = document.getElementById('zone-select');
    var selM = document.getElementById('zone-select-mob');
    if (sel) sel.innerHTML = opts;
    if (selM) selM.innerHTML = opts;

    // Default: prvá zóna (nie "Všetko")
    currentZoneId = availableZones.length > 0 ? availableZones[0].id : null;
    if (sel) sel.value = currentZoneId || 'all';
    if (selM) selM.value = currentZoneId || 'all';

    // Hide zone selector if only one zone and not admin
    if (availableZones.length <= 1 && !isAdmin) {
      if (sel) sel.parentElement.classList.add('hidden');
      if (selM) selM.parentElement.classList.add('hidden');
    }

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    applyPermissions();
    switchView('insp');
  } else {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
  }
}

function applyPermissions() {
  // Admin nav - only for admin
  var na = document.getElementById('n-admin'); if (na) na.classList.toggle('hidden', currentRole !== 'admin');
  var nam = document.getElementById('n-admin-mob'); if (nam) nam.classList.toggle('hidden', currentRole !== 'admin');
  var nf = document.getElementById('n-fin'); if (nf) nf.classList.toggle('hidden', !['admin', 'spravca'].includes(currentRole));
  var nfm = document.getElementById('n-fin-mob'); if (nfm) nfm.classList.toggle('hidden', !['admin', 'spravca'].includes(currentRole));

  // Pozorovateľ: hide add buttons, edit buttons etc via CSS class on body
  if (currentRole === 'pozorovatel') {
    document.body.classList.add('role-readonly');
  } else {
    document.body.classList.remove('role-readonly');
  }
}

async function loadArchive() {
  const container = document.getElementById('archive-container');
  container.innerHTML = '<div class="py-20 text-center animate-pulse text-[10px] font-black text-slate-300 uppercase">Sync...</div>';

  var archTitle = document.getElementById('arch-zone-title');
  if (archTitle) archTitle.innerText = 'Archív – ' + getZoneName();

  const { data: rawArch } = await sb.from('issues')
    .select('*, locations(*)')
    .eq('archived', true)
    .order('updated_at', { ascending: false });

  // Filter podľa zóny
  var arch = (rawArch || []).filter(function(i) {
    return i.locations && matchesZone(i.locations.zone_id);
  });

  if (!arch || arch.length === 0) {
    container.innerHTML = '<div class="py-20 text-center text-slate-200 font-black uppercase text-[10px]">Archív je prázdny</div>';
    return;
  }

  const { data: updts = [] } = await sb.from('issue_updates').select('issue_id, event_date').order('event_date', { ascending: true });

  container.innerHTML = arch.map(i => {
    const firstUpdate = updts.find(u => u.issue_id === i.id);
    const firstDate = firstUpdate ? fmtD(firstUpdate.event_date) : '--';
    return `
    <div class="bg-white p-5 rounded-2xl shadow-sm flex justify-between items-center mb-4">
      <div>
        <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">${i.locations?.floor || '--'} • ${i.locations?.name || '--'} • ${firstDate}</p>
        <p class="text-[13px] font-bold text-slate-600">${i.title}</p>
      </div>
      <button onclick="restoreIssue('${i.id}')" class="text-[10px] font-black uppercase text-blue-600 underline leading-tight">Vrátiť</button>
    </div>`;
  }).join('');
}

window.restoreIssue = async (id) => {
  if(confirm("Vrátiť tento záznam z archívu?")) {
    await sb.from('issues').update({ archived: false }).eq('id', id);
    await loadArchive();
    await loadSections();
  }
};


window.removePhotoFromUpdate = () => {
  removePhotoFlag = true;
  currentEditingPhotoUrl = null;
  var i = document.getElementById('f-stat-photo'); if (i) i.value = '';
  var g = document.getElementById('f-stat-photo-gallery'); if (g) g.value = '';
  window.editGalleryFile = null;
  var p = document.getElementById('edit-photo-preview'); if (p) p.classList.add('hidden');
};


window.toggleMobileMenu = () => {
  const accordion = document.getElementById('mobile-accordion');
  const icon = document.getElementById('menu-icon');
  if (accordion.classList.contains('hidden')) {
    accordion.classList.remove('hidden');
    icon.classList.replace('fa-bars', 'fa-xmark');
  } else {
    accordion.classList.add('hidden');
    icon.classList.replace('fa-xmark', 'fa-bars');
  }
};

// One-off migration helper (optional)
window.migrateThumbs = async () => {
  const { data: rows, error } = await sb
    .from("issue_updates")
    .select("id, photo_url, photo_thumb_url")
    .not("photo_url", "is", null)
    .is("photo_thumb_url", null);

  if (error) { console.error(error); alert("DB error"); return; }
  if (!rows || rows.length === 0) { alert("Nič na migráciu"); return; }

  console.log("Na migráciu:", rows.length);

  for (const r of rows) {
    try {
      const base = `upd_${r.id}`;
      const thumbBlob = await makeThumbnailBlobFromUrl(r.photo_url, 420, 0.55);
      const thumbUrl = await uploadThumbBlob(thumbBlob, base);

      const { error: upErr } = await sb
        .from("issue_updates")
        .update({ photo_thumb_url: thumbUrl })
        .eq("id", r.id);

      if (upErr) throw upErr;
      console.log("OK", r.id);
    } catch (e) {
      console.warn("FAIL", r.id, e);
    }
  }

  alert("Migrácia hotová (pozri konzolu pre detaily).");
};

async function waitForImages(rootSelector = '#v-rep', timeoutMs = 20000) {
  const root = document.querySelector(rootSelector);
  if (!root) return;

  const imgs = Array.from(root.querySelectorAll('img'))
    .filter(img => img.offsetParent !== null); // iba viditeľné

  if (imgs.length === 0) return;

  const start = Date.now();

  await Promise.all(imgs.map(img => new Promise((resolve) => {
    const done = () => resolve();

    // už načítané OK
    if (img.complete && img.naturalWidth > 0) return resolve();

    // load/error
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });

    // timeout guard
    const tick = () => {
      if (Date.now() - start > timeoutMs) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  })));
}

window.printReport = async () => {
  await switchView('rep');
  await new Promise(r => setTimeout(r, 50)); // stačí menej

  // čakaj na obrázky v samotnom liste
  await waitForImages('#rep-list', 25000);

  window.print();
};


init();
