const S_URL = 'https://tyimhlqtncjynutxihrf.supabase.co';
const S_KEY = 'sb_publishable_jX6gFj0WZfxXFNpwF1bTuw_dQADscTW';
const sb = supabase.createClient(S_URL, S_KEY);

let allLocs = [], allIssues = [], allUpdates = [];
let currentEditingPhotoUrl = null;

const fmtD = (str) => { if(!str) return '--'; const d = str.split('T')[0].split('-'); return `${d[2]}.${d[1]}.${d[0]}`; };
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
    const btn = document.getElementById('btn-login'); btn.innerText = "Sync...";
    const { data, error } = await sb.auth.signInWithPassword({
        email: document.getElementById('log-email').value,
        password: document.getElementById('log-pass').value
    });
    if (error) { document.getElementById('log-error').classList.remove('hidden'); btn.innerText = "Prihlásiť sa"; }
    else { init(); }
};

async function uploadPhoto(file) {
    if (!file) return null;
    const name = `${Date.now()}_${file.name.replace(/\s/g, '_')}`;
    const { error } = await sb.storage.from('photos').upload(name, file);
    if (error) return null;
    return `${S_URL}/storage/v1/object/public/photos/${name}`;
}

async function switchView(v) {
// ZAVRETIE MENU NA MOBILE PO KLIKNUTÍ
    const accordion = document.getElementById('mobile-accordion');
    if (accordion) {
        accordion.classList.add('hidden');
        const icon = document.getElementById('menu-icon');
        if (icon) icon.classList.replace('fa-xmark', 'fa-bars');
    }
    ['v-dash', 'v-insp', 'v-arch', 'v-rep'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['n-dash', 'n-insp', 'n-arch', 'n-rep'].forEach(id => document.getElementById(id).classList.remove('nav-active'));
    document.getElementById('v-'+v).classList.remove('hidden');
    document.getElementById('n-'+v).classList.add('nav-active');
    if(v === 'dash') loadDash();
    if(v === 'insp') loadSections();
    if(v === 'arch') loadArchive();
    if(v === 'rep') loadReports();
}

async function loadDash() {
    const { count: open } = await sb.from('issues').select('*', { count: 'exact', head: true }).eq('archived', false).not('status', 'in', '("Opravené","Vybavené")');
    const { count: done } = await sb.from('issues').select('*', { count: 'exact', head: true }).eq('archived', false).or('status.eq.Opravené,status.eq.Vybavené');
    document.getElementById('s-open').innerText = open || 0;
    document.getElementById('s-done').innerText = done || 0;
}

async function loadSections() {
    const container = document.getElementById('section-container');
    container.innerHTML = '<div class="py-20 text-center animate-pulse text-[10px] font-black text-slate-300 uppercase italic">Synchronizujem...</div>';
    const { data: locs } = await sb.from('locations').select('*').order('sort_order', { ascending: true }); allLocs = locs || [];
    const { data: isss } = await sb.from('issues').select('*, locations(*)').eq('archived', false).order('created_at', { ascending: false }); allIssues = isss || [];
    const { data: updts } = await sb.from('issue_updates').select('*').order('event_date', { ascending: false }); allUpdates = updts || [];
    
    container.innerHTML = '';
    const floors = [...new Set(allLocs.map(l => l.floor))];
    floors.forEach(floor => {
        const floorLocs = allLocs.filter(l => l.floor === floor);
        const floorIssues = allIssues.filter(i => floorLocs.some(l => l.id === i.location_id));
        const div = document.createElement('div');
        div.className = 'bg-white p-6 md:p-8 rounded-[2rem] shadow-sm italic leading-tight mb-6';
        
        let issuesHtml = floorIssues.map(i => {
            const logs = allUpdates.filter(u => u.issue_id === i.id).sort((a,b) => new Date(a.event_date) - new Date(b.event_date));
            const photos = updts.filter(u => u.issue_id === i.id && u.photo_url).map(l => `<img src="${l.photo_url}?width=60&quality=20" class="app-thumb" onclick="event.stopPropagation(); window.open('${l.photo_url}')">`).join('');
            const fLog = logs.length > 0 ? logs[logs.length-1] : null;
            return `
                <div class="flex justify-between items-start italic leading-tight mb-6 last:mb-0">
                    <div class="flex-1 italic leading-tight">
                        <p class="text-[8px] font-black text-slate-400 uppercase italic leading-none mb-1">${i.locations?.name || '--'}</p>
                        <p class="text-sm font-bold ${i.status === 'Opravené' || i.status === 'Vybavené' ? 'text-green-600' : 'text-slate-800'} italic italic leading-tight mb-1">${i.title}</p>
                        <p class="text-[8px] text-slate-400 font-bold uppercase italic italic leading-tight italic">Nahlásil: ${fLog ? fmtD(fLog.event_date) : '--'} ${i.reported_by || '--'} • Zodpovedný: ${i.responsible_person || '--'}</p>
                    </div>
                    <div class="flex items-center space-x-3 ml-4 leading-tight leading-tight"><div class="flex items-center leading-none">${photos}</div><button onclick="window.prepStat('${i.id}')" class="bg-white px-3 py-1.5 rounded-lg border border-slate-100 text-[9px] font-black uppercase text-blue-600 underline italic leading-tight">Upraviť</button></div>
                </div>`;
        }).join('');
        div.innerHTML = `<div class="flex justify-between items-center border-b pb-4 mb-4 italic leading-tight"><h3 class="font-black text-xl italic uppercase text-slate-900 leading-tight">${floor}</h3><button onclick="window.prepAdd('${floor}')" class="bg-slate-900 text-white px-5 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest leading-none leading-tight">+ Pridať</button></div><div class="space-y-4 italic leading-tight leading-tight leading-tight">${issuesHtml || '<p class="text-center py-6 text-[10px] text-slate-200 font-bold uppercase italic tracking-widest">OK</p>'}</div>`;
        container.appendChild(div);
    });
}

async function loadReports() {
    const todayStr = new Date().toLocaleDateString(); 
    document.getElementById('rep-date-screen').innerText = todayStr;
    const list = document.getElementById('rep-list'); 
    const { data: isss } = await sb.from('issues').select('*, locations(*)').eq('archived', false);
    const { data: updts = [] } = await sb.from('issue_updates').select('*').order('event_date', { ascending: true });
    isss.sort((a,b) => a.locations.sort_order - b.locations.sort_order);
    
    list.innerHTML = isss.map(i => {
        const logs = updts.filter(u => u.issue_id === i.id);
        return `<tr class="rep-row italic leading-snug leading-tight italic"><td class="py-5 px-2 align-top border-r border-slate-50 italic leading-tight leading-tight leading-tight leading-tight italic"><span class="block font-black text-slate-400 uppercase text-[7px] italic">${i.locations.floor}</span><span class="text-[10px] font-bold italic italic leading-tight leading-tight leading-tight leading-tight italic">${i.locations.name}</span><p class="text-[7px] font-bold text-slate-400 uppercase mt-2 italic italic leading-tight leading-tight">Zodpovedá: ${i.responsible_person || '--'}</p></td><td class="py-5 px-3 align-top italic leading-snug leading-tight leading-tight italic"><p class="font-bold text-slate-900 italic mb-3 leading-tight italic leading-tight leading-tight leading-tight italic">${i.title}</p><div class="space-y-4 italic leading-tight leading-tight italic leading-tight leading-tight italic">${logs.map(u => `<div class="flex justify-between items-start space-x-2 pb-1 italic leading-tight leading-tight leading-tight italic"><div class="flex-1 italic leading-tight leading-tight leading-tight italic"><div class="flex items-center space-x-2 mb-1 italic leading-tight leading-tight leading-tight leading-tight italic"><span class="font-black text-[7px] text-slate-400 uppercase italic leading-tight italic leading-tight leading-tight leading-tight italic">${fmtD(u.event_date)}</span><span class="text-[6px] font-black px-1 border rounded uppercase italic leading-tight italic leading-tight leading-tight ${u.status_to === 'Opravené' || u.status_to === 'Vybavené' ? 'text-green-600' : 'text-slate-400'}">${u.status_to}</span></div><p class="text-[9px] text-slate-700 italic leading-snug leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight italic leading-tight">${u.note || '--'}</p></div>${u.photo_url ? `<img src="${u.photo_url}?width=150&quality=20" class="report-thumb cursor-pointer italic" onclick="window.open('${u.photo_url}')">` : ''}</div>`).join('')}</div></td><td class="py-5 px-1 align-top text-center italic leading-tight leading-tight italic leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight italic leading-tight"><span class="text-[7px] font-black px-1.5 py-0.5 rounded uppercase italic leading-tight italic leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight leading-tight italic ${i.status === 'Opravené' || i.status === 'Vybavené' ? 'text-green-600 bg-green-50' : 'text-red-500 bg-red-50'}">${i.status}</span></td></tr>`;
    }).join('');
}

window.prepAdd = (fN) => { document.getElementById('m-add-floor-label').innerText = fN; document.getElementById('f-add-date').value = new Date().toISOString().split('T')[0]; document.getElementById('f-add-reported').value = document.getElementById('att-all').value; document.getElementById('f-add-loc-id').innerHTML = allLocs.filter(l => l.floor === fN).map(l => `<option value="${l.id}">${l.name}</option>`).join(''); document.getElementById('m-add').classList.remove('hidden'); };

window.prepStat = (id) => {
    const item = allIssues.find(i => i.id === id); if(!item) return;
    document.getElementById('f-stat-id').value = id; document.getElementById('f-stat-val').value = item.status;
    document.getElementById('f-stat-title-edit').value = item.title; document.getElementById('f-stat-resp-edit').value = item.responsible_person || '';
    document.getElementById('f-stat-reported-edit').value = item.reported_by || '';
    document.getElementById('f-stat-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('f-stat-loc-id').innerHTML = allLocs.map(l => `<option value="${l.id}" ${l.id === item.location_id ? 'selected' : ''}>${l.floor}: ${l.name}</option>`).join('');
    const logs = allUpdates.filter(u => u.issue_id === id).sort((a,b) => new Date(b.event_date) - new Date(a.event_date));
    document.getElementById('m-history-list').innerHTML = logs.map(u => `
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[10px] mb-2 italic leading-tight">
            <div class="flex justify-between items-start mb-1 leading-tight"><span class="font-black block text-slate-800 uppercase tracking-tighter italic leading-tight leading-tight">${fmtD(u.event_date)} • ${u.status_to}</span><div class="flex space-x-2 leading-tight leading-tight"><button type="button" onclick="window.editHEntry('${u.id}')" class="text-blue-500 italic leading-none italic leading-tight"><i class="fa-solid fa-pencil italic leading-tight"></i></button><button type="button" onclick="window.delHEntry('${u.id}')" class="text-red-300 italic leading-none leading-tight"><i class="fa-solid fa-trash-can italic leading-tight"></i></button></div></div>
            <div class="grid grid-cols-2 gap-2 text-[8px] font-bold uppercase text-slate-500 italic mb-2 leading-tight leading-tight">
                <p>Nahlásil: ${u.attendance || '--'}</p><p>Zodpovedný: ${item.responsible_person || '--'}</p>
            </div>
            <p class="text-slate-500 leading-snug italic">${u.note || '--'}</p>
            ${u.photo_url ? `<img src="${u.photo_url}?width=200&quality=20" class="app-thumb mt-2 italic" onclick="window.open('${u.photo_url}')">` : ''}
        </div>`).join('');
    document.getElementById('m-status').classList.remove('hidden');
};

window.editHEntry = (id) => { const e = allUpdates.find(u => u.id === id); if(!e) return; document.getElementById('f-stat-update-id').value = e.id; document.getElementById('f-stat-note').value = e.note || ""; document.getElementById('f-stat-date').value = e.event_date ? e.event_date.split('T')[0] : ""; document.getElementById('f-stat-val').value = e.status_to; document.getElementById('f-stat-reported-edit').value = e.attendance || ""; if(e.photo_url) { document.getElementById('edit-photo-preview').classList.remove('hidden'); document.getElementById('edit-photo-img').src = e.photo_url; currentEditingPhotoUrl = e.photo_url; } else { document.getElementById('edit-photo-preview').classList.add('hidden'); currentEditingPhotoUrl = null; } };
window.delHEntry = async (id) => { if(confirm("Zmazať?")) { await sb.from('issue_updates').delete().eq('id', id); window.prepStat(document.getElementById('f-stat-id').value); } };

document.getElementById('f-add').onsubmit = async (e) => { e.preventDefault(); const btn = document.getElementById('btn-save-new'); btn.disabled = true; const pUrl = await uploadPhoto(document.getElementById('f-add-photo').files[0]); const { data } = await sb.from('issues').insert([{ location_id: document.getElementById('f-add-loc-id').value, title: document.getElementById('f-add-title').value, responsible_person: document.getElementById('f-add-resp').value, reported_by: document.getElementById('f-add-reported').value, status: 'Zahlásené' }]).select(); if (data?.[0]) { await sb.from('issue_updates').insert([{ issue_id: data[0].id, status_to: 'Zahlásené', note: document.getElementById('f-add-note').value, event_date: document.getElementById('f-add-date').value, photo_url: pUrl, attendance: document.getElementById('f-add-reported').value }]); hideM('m-add'); e.target.reset(); btn.disabled = false; await loadSections(); } };
document.getElementById('f-stat').onsubmit = async (e) => { e.preventDefault(); const btn = document.getElementById('btn-save-stat'); btn.disabled = true; const uId = document.getElementById('f-stat-update-id').value; const pUrl = await uploadPhoto(document.getElementById('f-stat-photo').files[0]); const id = document.getElementById('f-stat-id').value; const st = document.getElementById('f-stat-val').value; await sb.from('issues').update({ status: st, title: document.getElementById('f-stat-title-edit').value, responsible_person: document.getElementById('f-stat-resp-edit').value, reported_by: document.getElementById('f-stat-reported-edit').value, location_id: document.getElementById('f-stat-loc-id').value, updated_at: new Date() }).eq('id', id); if(uId) { await sb.from('issue_updates').update({ status_to: document.getElementById('f-stat-val').value, note: document.getElementById('f-stat-note').value, event_date: document.getElementById('f-stat-date').value, photo_url: pUrl || currentEditingPhotoUrl || undefined, attendance: document.getElementById('f-stat-reported-edit').value }).eq('id', uId); } else { await sb.from('issue_updates').insert([{ issue_id: id, status_to: document.getElementById('f-stat-val').value, note: document.getElementById('f-stat-note').value, event_date: document.getElementById('f-stat-date').value, photo_url: pUrl, attendance: document.getElementById('f-stat-reported-edit').value }]); } hideM('m-status'); btn.disabled = false; await loadSections(); };

window.archiveIssue = async () => { if(confirm("Archivovať?")) { await sb.from('issues').update({ archived: true }).eq('id', document.getElementById('f-stat-id').value); hideM('m-status'); await loadSections(); } };
window.restoreIssue = async (id) => { await sb.from('issues').update({ archived: false }).eq('id', id); await loadArchive(); };
window.confirmDelete = async () => { if(confirm("Vymazať natrvalo?")) { await sb.from('issues').delete().eq('id', document.getElementById('f-stat-id').value); hideM('m-status'); await loadSections(); } };

async function init() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { document.getElementById('login-view').classList.add('hidden'); document.getElementById('app-view').classList.remove('hidden'); switchView('dash'); }
    else { document.getElementById('login-view').classList.remove('hidden'); document.getElementById('app-view').classList.add('hidden'); }
}
async function loadArchive() {
    const container = document.getElementById('archive-container');
    container.innerHTML = '<div class="py-20 text-center animate-pulse text-[10px] font-black text-slate-300 uppercase italic">Sync...</div>';
    
    const { data: arch } = await sb.from('issues')
        .select('*, locations(*)')
        .eq('archived', true)
        .order('updated_at', { ascending: false });

    if (!arch || arch.length === 0) {
        container.innerHTML = '<div class="py-20 text-center text-slate-200 font-black uppercase text-[10px] italic">Archív je prázdny</div>';
        return;
    }

    container.innerHTML = arch.map(i => `
        <div class="bg-white p-5 rounded-2xl shadow-sm flex justify-between items-center italic mb-4">
            <div>
                <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">${i.locations?.name || '--'}</p>
                <p class="text-[13px] font-bold text-slate-600 italic">${i.title}</p>
            </div>
            <button onclick="restoreIssue('${i.id}')" class="text-[10px] font-black uppercase text-blue-600 underline italic leading-tight">Vrátiť</button>
        </div>
    `).join('');
}

window.restoreIssue = async (id) => {
    if(confirm("Vrátiť tento záznam z archívu?")) {
        await sb.from('issues').update({ archived: false }).eq('id', id);
        await loadArchive();
        await loadSections(); // Obnoví aj zoznam obhliadky
    }
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
init();
