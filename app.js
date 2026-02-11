const S_URL = 'https://tyimhlqtncjynutxihrf.supabase.co';
const S_KEY = 'sb_publishable_jX6gFj0WZfxXFNpwF1bTuw_dQADscTW';
const sb = supabase.createClient(S_URL, S_KEY);

let allLocs = [], allIssues = [], allUpdates = [];
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

  ['v-dash', 'v-insp', 'v-arch', 'v-rep', 'v-admin'].forEach(id => document.getElementById(id).classList.add('hidden'));
  ['n-dash', 'n-insp', 'n-arch', 'n-rep', 'n-admin'].forEach(id => { var el = document.getElementById(id); if (el) el.classList.remove('nav-active'); });

  document.getElementById('v-'+v).classList.remove('hidden');
  var nav = document.getElementById('n-'+v); if (nav) nav.classList.add('nav-active');

  // DÔLEŽITÉ: vráť Promise a počkaj na dáta + render
  if (v === 'dash') return await loadDash();
  if (v === 'insp') return await loadSections();
  if (v === 'arch') return await loadArchive();
  if (v === 'rep')  return await loadReports();
  if (v === 'admin') return await loadAdmin();
}


async function loadDash() {
  const { count: open } = await sb.from('issues').select('*', { count: 'exact', head: true })
    .eq('archived', false)
    .not('status', 'in', '("Opravené","Vybavené")');

  const { count: done } = await sb.from('issues').select('*', { count: 'exact', head: true })
    .eq('archived', false)
    .or('status.eq.Opravené,status.eq.Vybavené');

  document.getElementById('s-open').innerText = open || 0;
  document.getElementById('s-done').innerText = done || 0;
}

async function loadSections() {
  const container = document.getElementById('section-container');
  container.innerHTML = '<div class="py-20 text-center animate-pulse text-[10px] font-black text-slate-300 uppercase">Synchronizujem...</div>';

  const { data: locs } = await sb.from('locations').select('*').order('sort_order', { ascending: true });
  allLocs = locs || [];

  const { data: isss } = await sb.from('issues').select('*, locations(*)').eq('archived', false).order('created_at', { ascending: false });
  allIssues = isss || [];

  const { data: updts } = await sb.from('issue_updates').select('*').order('event_date', { ascending: false });
  allUpdates = updts || [];

  container.innerHTML = '';
  const floors = [...new Set(allLocs.map(l => l.floor))];

  floors.forEach(floor => {
    const floorLocs = allLocs.filter(l => l.floor === floor);
    const floorIssues = allIssues.filter(i => floorLocs.some(l => l.id === i.location_id));

    const div = document.createElement('div');
    div.className = 'bg-white p-6 md:p-8 rounded-[2rem] shadow-sm leading-tight mb-6';

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
            <p class="text-[8px] text-slate-400 font-bold uppercase leading-tight">Nahlásil: ${fLog ? fmtD(fLog.event_date) : '--'} ${i.reported_by || '--'} • Zodpovedný: ${i.responsible_person || '--'}</p>
          </div>
          <div class="flex items-center space-x-3 ml-4 leading-tight leading-tight">
            <div class="flex items-center leading-none">${photos}</div>
            ${currentRole !== 'pozorovatel' ? `<button onclick="window.prepStat('${i.id}')" class="bg-white px-3 py-1.5 rounded-lg border border-slate-100 text-[9px] font-black uppercase text-blue-600 underline leading-tight">Upraviť</button>` : ''}
          </div>
        </div>`;
    }).join('');

    div.innerHTML = `
      <div class="flex justify-between items-center border-b pb-4 mb-4 leading-tight">
        <h3 class="font-black text-xl uppercase text-slate-900 leading-tight">${floor}</h3>
        ${canAdd() ? `<button onclick="window.prepAdd('${floor}')" class="bg-slate-900 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest leading-none leading-tight">+ Pridať</button>` : ''}
      </div>
      <div class="space-y-4 leading-tight leading-tight leading-tight">
        ${issuesHtml || '<p class="text-center py-6 text-[10px] text-slate-200 font-bold uppercase tracking-widest">OK</p>'}
      </div>
    `;
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

  const list = document.getElementById('rep-list');

  const { data: isss } = await sb.from('issues').select('*, locations(*)').eq('archived', false);
  const { data: updts = [] } = await sb.from('issue_updates').select('*').order('event_date', { ascending: true });

  if (!isss || isss.length === 0) { list.innerHTML = ''; return; }

  const validIssues = isss.filter(i => i.locations);
  if (validIssues.length === 0) { list.innerHTML = ''; return; }

  validIssues.sort((a,b) => a.locations.sort_order - b.locations.sort_order);

  list.innerHTML = validIssues.map(i => {
    const logs = updts.filter(u => u.issue_id === i.id);
    return `<tr class="rep-row leading-snug leading-tight">
      <td class="py-5 px-2 align-top border-r border-slate-50 leading-tight leading-tight leading-tight leading-tight">
        <span class="block font-black text-slate-400 uppercase text-[7px]">${i.locations ? i.locations.floor : '--'}</span>
        <span class="text-[10px] font-bold leading-tight leading-tight leading-tight leading-tight">${i.locations ? i.locations.name : '--'}</span>
        <p class="text-[7px] font-bold text-slate-400 uppercase mt-2 leading-tight leading-tight">Zodpovedá: ${i.responsible_person || '--'}</p>
      </td>
      <td class="py-5 px-3 align-top leading-snug leading-tight leading-tight">
        <p class="font-bold text-slate-900 mb-3 leading-tight leading-tight leading-tight leading-tight">${i.title}</p>
        <div class="space-y-4 leading-tight leading-tight leading-tight leading-tight">
          ${logs.map(u => `
            <div class="flex justify-between items-start space-x-2 pb-1 leading-tight leading-tight leading-tight">
              <div class="flex-1 leading-tight leading-tight leading-tight">
                <div class="flex items-center space-x-2 mb-1 leading-tight leading-tight leading-tight leading-tight">
                  <span class="font-black text-[7px] text-slate-400 uppercase leading-tight leading-tight leading-tight leading-tight">${fmtD(u.event_date)}</span>
                  <span class="text-[6px] font-black px-1 border rounded uppercase leading-tight leading-tight leading-tight ${u.status_to === 'Opravené' || u.status_to === 'Vybavené' ? 'text-green-600' : 'text-slate-400'}">${u.status_to}</span>
                </div>
                <p class="text-[9px] text-slate-700 leading-snug leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight">${u.note || '--'}</p>
              </div>
              ${u.photo_url ? `<img loading="eager" decoding="async" src="${u.photo_thumb_url || u.photo_url}" class="report-thumb cursor-pointer" onclick="window.open('${u.photo_url}')">` : ''}
            </div>
          `).join('')}
        </div>
      </td>
      <td class="py-5 px-1 align-top text-center leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight">
        <span class="text-[7px] font-black px-1.5 py-0.5 rounded uppercase leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight ${i.status === 'Opravené' || i.status === 'Vybavené' ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}">${i.status}</span>
      </td>
    </tr>`;
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
      <div class="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase text-slate-500 mb-2 leading-tight leading-tight">
        <p>Nahlásil: ${u.attendance || '--'}</p><p>Zodpovedný: ${item.responsible_person || '--'}</p>
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

    const file = document.getElementById('f-add-photo').files[0];
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

    const file = document.getElementById('f-stat-photo').files[0];
    const up = file ? await uploadPhotoWithThumb(file, `upd_${uId || Date.now()}`) : null;

    const { error: issErr } = await sb.from('issues').update({
      status: st,
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

window.clearAddPhoto = function() {
  var i = document.getElementById('f-add-photo'); if (i) i.value = '';
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
async function loadAdmin() {
  if (currentRole !== 'admin') return;
  const { data: users = [] } = await sb.from('user_profiles').select('*').order('created_at', { ascending: true });

  var roleLabels = { admin: 'Admin', spravca: 'Správca', pracovnik: 'Pracovník', pozorovatel: 'Pozorovateľ' };

  document.getElementById('admin-user-list').innerHTML = users.length === 0
    ? '<p class="text-center text-slate-300 text-[10px] font-bold uppercase py-6">Žiadni používatelia</p>'
    : users.map(u => `
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
      </div>
    `).join('');
}

window.changeUserRole = async (profileId, newRole) => {
  await sb.from('user_profiles').update({ role: newRole }).eq('id', profileId);
  await loadAdmin();
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
    currentRole = profile ? profile.role : 'spravca'; // default spravca if no profile yet

    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    applyPermissions();
    switchView('dash');
  } else {
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('app-view').classList.add('hidden');
  }
}

function applyPermissions() {
  // Admin nav - only for admin
  var na = document.getElementById('n-admin'); if (na) na.classList.toggle('hidden', currentRole !== 'admin');
  var nam = document.getElementById('n-admin-mob'); if (nam) nam.classList.toggle('hidden', currentRole !== 'admin');

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

  const { data: arch } = await sb.from('issues')
    .select('*, locations(*)')
    .eq('archived', true)
    .order('updated_at', { ascending: false });

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
