// ============================================
// PANSKÁ 17 - MAIN
// Admin, nájomcovia, prehľad, init, utilities
// ============================================

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

// ============ NÁJOMCOVIA ============

var editingTenantId = null;

window.loadTenants = async function() {
  var { data: tenants = [] } = await sb.from('tenants').select('*').order('name');
  var list = document.getElementById('fin-tenants-list');
  if (!list) return;

  if (tenants.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-300">Žiadni nájomcovia</p>';
    return;
  }

  // Get zone assignments
  var { data: zones = [] } = await sb.from('zones').select('id, name, tenant_name, tenant_id');

  list.innerHTML = tenants.map(function(t) {
    var tZones = zones.filter(function(z) { return z.tenant_id === t.id; });
    var zoneNames = tZones.map(function(z) { return z.tenant_name || z.name; }).join(', ');
    return '<div class="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-bold text-slate-800">' + (t.company_name || t.name) + '</p>' +
        '<p class="text-[9px] text-slate-400">' +
          (t.ico ? 'IČO: ' + t.ico + ' • ' : '') +
          (t.lease_from ? fmtD(t.lease_from) + ' – ' + (t.lease_to ? fmtD(t.lease_to) : '∞') + ' • ' : '') +
          (t.email || '') +
          (zoneNames ? ' • ' + zoneNames : '') +
        '</p>' +
      '</div>' +
      '<div class="flex items-center space-x-2 ml-3">' +
        '<button onclick="window.editTenant(\'' + t.id + '\')" class="text-blue-400 hover:text-blue-600 text-xs"><i class="fa-solid fa-pen"></i></button>' +
        '<button onclick="window.deleteTenant(\'' + t.id + '\')" class="text-red-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>' +
      '</div>' +
    '</div>';
  }).join('');
};

window.showAddTenant = function() {
  editingTenantId = null;
  document.getElementById('tenant-modal-title').innerText = 'Nový nájomca';
  ['ten-name','ten-company','ten-ico','ten-dic','ten-icdph','ten-address','ten-city','ten-zip','ten-email','ten-phone','ten-lease-from','ten-lease-to','ten-iban','ten-note'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  // Zone checkboxes
  var tenZones = document.getElementById('ten-zones');
  if (tenZones) {
    tenZones.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
      return '<label class="flex items-center space-x-1.5 bg-slate-50 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-blue-50">' +
        '<input type="checkbox" value="' + z.id + '" class="ten-zone-cb rounded">' +
        '<span class="text-[9px] font-bold text-slate-600">' + (z.tenant_name || z.name) + '</span>' +
      '</label>';
    }).join('');
  }
  document.getElementById('modal-tenant').classList.remove('hidden');
};

window.closeTenantModal = function() {
  document.getElementById('modal-tenant').classList.add('hidden');
};

window.saveTenant = async function() {
  var data = {
    name: document.getElementById('ten-name').value.trim(),
    company_name: document.getElementById('ten-company').value.trim() || null,
    ico: document.getElementById('ten-ico').value.trim() || null,
    dic: document.getElementById('ten-dic').value.trim() || null,
    ic_dph: document.getElementById('ten-icdph').value.trim() || null,
    address: document.getElementById('ten-address').value.trim() || null,
    city: document.getElementById('ten-city').value.trim() || null,
    zip: document.getElementById('ten-zip').value.trim() || null,
    email: document.getElementById('ten-email').value.trim() || null,
    phone: document.getElementById('ten-phone').value.trim() || null,
    lease_from: document.getElementById('ten-lease-from').value || null,
    lease_to: document.getElementById('ten-lease-to').value || null,
    iban: document.getElementById('ten-iban').value.trim() || null,
    note: document.getElementById('ten-note').value.trim() || null
  };

  if (!data.name) { alert('Vyplňte meno.'); return; }

  var tenantId;
  if (editingTenantId) {
    await sb.from('tenants').update(data).eq('id', editingTenantId);
    tenantId = editingTenantId;
  } else {
    var { data: inserted } = await sb.from('tenants').insert(data).select('id').single();
    tenantId = inserted ? inserted.id : null;
  }

  // Update zone assignments
  if (tenantId) {
    // Clear old assignments
    await sb.from('zones').update({ tenant_id: null }).eq('tenant_id', tenantId);
    // Set new
    var cbs = document.querySelectorAll('.ten-zone-cb:checked');
    for (var i = 0; i < cbs.length; i++) {
      await sb.from('zones').update({ tenant_id: tenantId }).eq('id', cbs[i].value);
    }
    // Refresh allZones
    var { data: z2 } = await sb.from('zones').select('*').order('sort_order', { ascending: true });
    allZones = z2 || [];
  }

  window.closeTenantModal();
  await window.loadTenants();
};

window.editTenant = async function(id) {
  var { data: t } = await sb.from('tenants').select('*').eq('id', id).single();
  if (!t) return;

  editingTenantId = id;
  document.getElementById('tenant-modal-title').innerText = 'Upraviť nájomcu';
  document.getElementById('ten-name').value = t.name || '';
  document.getElementById('ten-company').value = t.company_name || '';
  document.getElementById('ten-ico').value = t.ico || '';
  document.getElementById('ten-dic').value = t.dic || '';
  document.getElementById('ten-icdph').value = t.ic_dph || '';
  document.getElementById('ten-address').value = t.address || '';
  document.getElementById('ten-city').value = t.city || '';
  document.getElementById('ten-zip').value = t.zip || '';
  document.getElementById('ten-email').value = t.email || '';
  document.getElementById('ten-phone').value = t.phone || '';
  document.getElementById('ten-lease-from').value = t.lease_from || '';
  document.getElementById('ten-lease-to').value = t.lease_to || '';
  document.getElementById('ten-iban').value = t.iban || '';
  document.getElementById('ten-note').value = t.note || '';

  // Zone checkboxes
  var tenZones = document.getElementById('ten-zones');
  if (tenZones) {
    tenZones.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
      var checked = z.tenant_id === id ? ' checked' : '';
      return '<label class="flex items-center space-x-1.5 bg-slate-50 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-blue-50">' +
        '<input type="checkbox" value="' + z.id + '" class="ten-zone-cb rounded"' + checked + '>' +
        '<span class="text-[9px] font-bold text-slate-600">' + (z.tenant_name || z.name) + '</span>' +
      '</label>';
    }).join('');
  }

  document.getElementById('modal-tenant').classList.remove('hidden');
};

window.deleteTenant = async function(id) {
  if (!confirm('Vymazať nájomcu?')) return;
  await sb.from('zones').update({ tenant_id: null }).eq('tenant_id', id);
  await sb.from('tenants').delete().eq('id', id);
  await window.loadTenants();
};

// ============ PREHĽAD NÁKLADOV ============

window.loadOverview = async function() {
  var yearSel = document.getElementById('fin-overview-year');
  if (!yearSel) return;
  var year = yearSel.value || new Date().getFullYear();

  // Get all allocations for this year's expenses (by period)
  var { data: expenses = [] } = await sb.from('expenses')
    .select('id, amount, category_id, cost_categories(name), expense_allocations(zone_id, amount, payer, zones(name, tenant_name, tenant_id))')
    .lte('period_from', year + '-12-31')
    .gte('period_to', year + '-01-01');

  // Also get expenses without period but with date in year
  var { data: expenses2 = [] } = await sb.from('expenses')
    .select('id, amount, category_id, cost_categories(name), expense_allocations(zone_id, amount, payer, zones(name, tenant_name, tenant_id))')
    .is('period_from', null)
    .gte('date', year + '-01-01')
    .lte('date', year + '-12-31');

  var allExp = expenses.concat(expenses2);
  // Deduplicate by id
  var seen = {};
  allExp = allExp.filter(function(e) {
    if (seen[e.id]) return false;
    seen[e.id] = true;
    return true;
  });

  // Get categories
  var { data: cats = [] } = await sb.from('cost_categories').select('id, name').order('name');

  // Build matrix: zone -> category -> { tenant, owner }
  var matrix = {};
  var catTotals = {};
  var ownerKey = '__VLASTNÍK__';

  allExp.forEach(function(e) {
    var catName = e.cost_categories ? e.cost_categories.name : 'Ostatné';
    if (!e.expense_allocations || e.expense_allocations.length === 0) return;

    e.expense_allocations.forEach(function(a) {
      if (!a.zones) return;
      var zName = a.zones.name;
      var tName = a.zones.tenant_name || '';
      // Strip s.r.o., a.s., spol. s r.o., etc.
      tName = tName.replace(/,?\s*(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?|spol\.\s*s\s*r\.?\s*o\.?|s\.\s*r\.\s*o\.)$/i, '').trim();
      var zoneName = tName ? tName + ' – ' + zName : zName;
      var key = a.payer === 'owner' ? ownerKey : zoneName;

      if (!matrix[key]) matrix[key] = {};
      if (!matrix[key][catName]) matrix[key][catName] = 0;
      matrix[key][catName] += parseFloat(a.amount) || 0;

      if (!catTotals[catName]) catTotals[catName] = 0;
      catTotals[catName] += parseFloat(a.amount) || 0;
    });
  });

  // Get unique category names that have data
  var catNames = Object.keys(catTotals).sort();
  var zoneNames = Object.keys(matrix).filter(function(k) { return k !== ownerKey; }).sort();
  if (matrix[ownerKey]) zoneNames.push(ownerKey);

  // Build table
  var table = document.getElementById('fin-overview-table');
  if (!table) return;

  if (catNames.length === 0) {
    table.innerHTML = '<p class="text-sm text-slate-300">Žiadne dáta pre tento rok</p>';
    return;
  }

  var html = '<table class="w-full text-[9px]">' +
    '<thead><tr class="border-b-2 border-slate-200">' +
    '<th class="text-left py-2 font-black text-slate-400 uppercase">Nájomca</th>' +
    catNames.map(function(c) { return '<th class="text-right py-2 font-black text-slate-400 uppercase px-2">' + c + '</th>'; }).join('') +
    '<th class="text-right py-2 font-black text-slate-800 uppercase px-2">Spolu</th>' +
    '</tr></thead><tbody>';

  var grandTotals = {};
  catNames.forEach(function(c) { grandTotals[c] = 0; });
  var grandTotal = 0;

  zoneNames.forEach(function(z) {
    var isOwner = z === ownerKey;
    var rowTotal = 0;
    html += '<tr class="border-b border-slate-100' + (isOwner ? ' bg-orange-50' : '') + '">' +
      '<td class="py-2 font-bold ' + (isOwner ? 'text-orange-600' : 'text-slate-700') + '">' + (isOwner ? 'Vlastník' : z) + '</td>';

    catNames.forEach(function(c) {
      var val = (matrix[z] && matrix[z][c]) || 0;
      rowTotal += val;
      grandTotals[c] += val;
      html += '<td class="text-right py-2 px-2 ' + (val > 0 ? (isOwner ? 'text-orange-600' : 'text-slate-600') : 'text-slate-200') + '">' +
        (val > 0 ? val.toFixed(2) : '–') + '</td>';
    });

    grandTotal += rowTotal;
    html += '<td class="text-right py-2 px-2 font-black ' + (isOwner ? 'text-orange-700' : 'text-slate-800') + '">' + rowTotal.toFixed(2) + ' €</td>';
    html += '</tr>';
  });

  // Totals row
  html += '<tr class="border-t-2 border-slate-300 bg-slate-50">' +
    '<td class="py-2 font-black text-slate-800 uppercase">Celkom</td>';
  catNames.forEach(function(c) {
    html += '<td class="text-right py-2 px-2 font-black text-slate-800">' + (grandTotals[c] || 0).toFixed(2) + '</td>';
  });
  html += '<td class="text-right py-2 px-2 font-black text-slate-900">' + grandTotal.toFixed(2) + ' €</td>';
  html += '</tr></tbody></table>';

  table.innerHTML = html;
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
  
