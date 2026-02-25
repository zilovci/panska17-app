// ============================================
// PANSKÁ 17 - MAIN
// Admin, nájomcovia, prehľad, init, utilities
// ============================================

async function loadAdmin() {
  if (currentRole !== 'admin') return;
  const { data: users = [] } = await sb.from('user_profiles').select('*').order('created_at', { ascending: true });
  const { data: allAccess = [] } = await sb.from('user_zone_access').select('*');

  var roleLabels = { admin: 'Admin', ekonom: 'Ekonóm', spravca: 'Správca', pracovnik: 'Pracovník', pozorovatel: 'Pozorovateľ' };

  document.getElementById('admin-user-list').innerHTML = users.length === 0
    ? '<p class="text-center text-slate-300 text-[10px] font-bold uppercase py-6">Žiadni používatelia</p>'
    : users.map(u => {
      var userAccess = allAccess.filter(function(a) { return a.user_id === u.user_id; });
      var userZoneIds = userAccess.map(function(a) { return a.zone_id; });
      var isAdminOrSpravca = u.role === 'admin' || u.role === 'ekonom' || u.role === 'spravca';

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
              ${['admin','ekonom','spravca','pracovnik','pozorovatel'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabels[r]}</option>`).join('')}
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
  if (!confirm('Vymazať tohto používateľa? Vymaže sa aj prihlasovací účet.')) return;
  try {
    // Find user_id from profile before deleting
    const { data: prof } = await sb.from('user_profiles').select('user_id').eq('id', profileId).single();
    if (!prof) { alert('Profil sa nenašiel.'); return; }

    // Delete zone access
    await sb.from('user_zone_access').delete().eq('user_id', prof.user_id);
    // Delete profile
    await sb.from('user_profiles').delete().eq('id', profileId);
    // Delete auth user via RPC
    const { error: rpcErr } = await sb.rpc('delete_auth_user', { target_user_id: prof.user_id });
    if (rpcErr) console.warn('Auth user delete failed (may need manual cleanup):', rpcErr.message);

    await loadAdmin();
  } catch (err) {
    console.error(err);
    alert('Chyba pri mazaní: ' + (err.message || 'Pozri konzolu.'));
  }
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

  // Filter by year if selected
  var tenYearSel = document.getElementById('fin-tenants-year');
  var filterYear = tenYearSel ? tenYearSel.value : '';
  if (filterYear) {
    var yearStart = filterYear + '-01-01';
    var yearEnd = filterYear + '-12-31';
    tenants = tenants.filter(function(t) {
      var startOk = !t.lease_from || t.lease_from <= yearEnd;
      var endOk = !t.lease_to || t.lease_to >= yearStart;
      return startOk && endOk;
    });
  }

  // Sort alphabetically by display name
  tenants.sort(function(a, b) {
    var na = (a.company_name || a.name || '').toLowerCase();
    var nb = (b.company_name || b.name || '').toLowerCase();
    return na.localeCompare(nb, 'sk');
  });

  if (tenants.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-300">' + (filterYear ? 'Žiadni aktívni nájomcovia v ' + filterYear : 'Žiadni nájomcovia') + '</p>';
    return;
  }

  // Get zone assignments
  var { data: zones = [] } = await sb.from('zones').select('id, name, tenant_name, tenant_id');

  list.innerHTML = '<p class="text-[9px] text-slate-400 mb-2">' + tenants.length + ' nájomcov' + (filterYear ? ' aktívnych v ' + filterYear : '') + '</p>' +
    tenants.map(function(t) {
    var tZones = zones.filter(function(z) { return z.tenant_id === t.id; });
    var zoneNames = tZones.map(function(z) { return z.tenant_name || z.name; }).join(', ');
    // Partial year indicator
    var partialTag = '';
    if (filterYear) {
      var startedMid = t.lease_from && t.lease_from > filterYear + '-01-01';
      var endedMid = t.lease_to && t.lease_to < filterYear + '-12-31';
      if (startedMid && endedMid) {
        partialTag = '<span class="text-[8px] bg-orange-100 text-orange-600 font-bold px-1.5 py-0.5 rounded-full ml-2">od ' + fmtD(t.lease_from) + ' do ' + fmtD(t.lease_to) + '</span>';
      } else if (startedMid) {
        partialTag = '<span class="text-[8px] bg-blue-100 text-blue-600 font-bold px-1.5 py-0.5 rounded-full ml-2">od ' + fmtD(t.lease_from) + '</span>';
      } else if (endedMid) {
        partialTag = '<span class="text-[8px] bg-red-100 text-red-600 font-bold px-1.5 py-0.5 rounded-full ml-2">do ' + fmtD(t.lease_to) + '</span>';
      }
    }
    return '<div class="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-bold text-slate-800">' + (t.is_owner ? '👑 ' : '') + (t.company_name || t.name) + partialTag + '</p>' +
        '<p class="text-[9px] text-slate-400">' +
          (t.ico ? 'IČO: ' + t.ico + ' • ' : '') +
          (t.lease_from ? fmtD(t.lease_from) + ' – ' + (t.lease_to ? fmtD(t.lease_to) : '∞') + ' • ' : '') +
          (t.monthly_rent > 0 ? 'Nájom: ' + parseFloat(t.monthly_rent).toFixed(0) + ' € • ' : '') +
          (t.monthly_advance > 0 ? 'Záloha: ' + parseFloat(t.monthly_advance).toFixed(0) + ' € • ' : '') +
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
  ['ten-name','ten-company','ten-ico','ten-dic','ten-icdph','ten-address','ten-city','ten-zip','ten-email','ten-phone','ten-lease-from','ten-lease-to','ten-iban','ten-rent','ten-advance','ten-note'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('ten-is-owner').checked = false;
  document.getElementById('ten-rent-account').value = '';
  document.getElementById('ten-service-account').value = '';
  document.getElementById('ten-no-billing').checked = false;
  // Zone checkboxes - render all, hide Spoločné/Dvor for non-owner
  window.renderTenantZones();
  document.getElementById('modal-tenant').classList.remove('hidden');
};

window.renderTenantZones = function(checkedIds) {
  var tenZones = document.getElementById('ten-zones');
  if (!tenZones) return;
  // If no checkedIds passed, read from current checkboxes
  if (!checkedIds) {
    checkedIds = [];
    document.querySelectorAll('.ten-zone-cb:checked').forEach(function(cb) { checkedIds.push(cb.value); });
  }
  tenZones.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
    var checked = checkedIds.indexOf(z.id) >= 0 ? ' checked' : '';
    return '<label class="flex items-center space-x-1.5 bg-slate-50 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-blue-50">' +
      '<input type="checkbox" value="' + z.id + '" class="ten-zone-cb rounded"' + checked + '>' +
      '<span class="text-[9px] font-bold text-slate-600">' + (z.tenant_name || z.name) + '</span>' +
    '</label>';
  }).join('');
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
    monthly_rent: parseFloat(document.getElementById('ten-rent').value) || 0,
    monthly_advance: parseFloat(document.getElementById('ten-advance').value) || 0,
    note: document.getElementById('ten-note').value.trim() || null,
    is_owner: document.getElementById('ten-is-owner').checked,
    payment_account: document.getElementById('ten-rent-account').value || null,
    service_account: document.getElementById('ten-service-account').value || null,
    no_billing: document.getElementById('ten-no-billing').checked
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
  // Refresh zone lease dates for expense allocation (tenant assignments may have changed)
  if (window.refreshZoneLeaseDates) await window.refreshZoneLeaseDates();
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
  document.getElementById('ten-rent').value = t.monthly_rent || '';
  document.getElementById('ten-advance').value = t.monthly_advance || '';
  document.getElementById('ten-note').value = t.note || '';
  document.getElementById('ten-is-owner').checked = t.is_owner || false;
  document.getElementById('ten-rent-account').value = t.payment_account || '';
  document.getElementById('ten-service-account').value = t.service_account || '';
  document.getElementById('ten-no-billing').checked = t.no_billing || false;

  // Zone checkboxes
  var assignedZoneIds = allZones.filter(function(z) { return z.tenant_id === id; }).map(function(z) { return z.id; });
  window.renderTenantZones(assignedZoneIds);

  document.getElementById('modal-tenant').classList.remove('hidden');
};

window.deleteTenant = async function(id) {
  if (!confirm('Vymazať nájomcu?')) return;
  await sb.from('zones').update({ tenant_id: null }).eq('tenant_id', id);
  await sb.from('tenants').delete().eq('id', id);
  await window.loadTenants();
};

// ============ PREHĽAD NÁKLADOV ============

var overviewMode = 'period'; // 'period' or 'payment'

window.setOverviewMode = function(mode) {
  overviewMode = mode;
  var btns = document.querySelectorAll('#fin-overview-mode button');
  btns.forEach(function(btn) {
    if (btn.getAttribute('data-mode') === mode) {
      btn.className = 'px-2 py-1 rounded-md bg-white text-slate-800 shadow-sm';
    } else {
      btn.className = 'px-2 py-1 rounded-md text-slate-400';
    }
  });
  window.loadOverview();
};

window.loadOverview = async function() {
  var yearSel = document.getElementById('fin-overview-year');
  if (!yearSel) return;
  var year = yearSel.value || new Date().getFullYear();

  var selectFields = 'id, amount, supplier, description, date, invoice_number, period_from, period_to, category_id, alloc_method, meter_main_consumption, meter_sub_consumption, meter_redirected_consumption, meter_losses, meter_consumption_unit, is_auto_generated, cost_type, amort_years, cost_categories(name), expense_allocations(zone_id, amount, payer, zones(name, tenant_name, tenant_id))';
  var selectFieldsFallback = 'id, amount, supplier, description, date, invoice_number, period_from, period_to, category_id, cost_categories(name), expense_allocations(zone_id, amount, payer, zones(name, tenant_name, tenant_id))';
  var allExp = [];

  if (overviewMode === 'payment') {
    // By payment date (date field)
    var { data: exp1, error: err1 } = await sb.from('expenses')
      .select(selectFields)
      .gte('date', year + '-01-01')
      .lte('date', year + '-12-31');
    if (err1) {
      var { data: exp1 = [] } = await sb.from('expenses').select(selectFieldsFallback).gte('date', year + '-01-01').lte('date', year + '-12-31');
    }
    allExp = exp1 || [];
  } else {
    // By billing period (period_from/period_to)
    var { data: expenses, error: err2 } = await sb.from('expenses')
      .select(selectFields)
      .lte('period_from', year + '-12-31')
      .gte('period_to', year + '-01-01');
    if (err2) {
      var { data: expenses = [] } = await sb.from('expenses').select(selectFieldsFallback).lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    }

    // Also get expenses without period but with date in year
    var { data: expenses2, error: err3 } = await sb.from('expenses')
      .select(selectFields)
      .is('period_from', null)
      .gte('date', year + '-01-01')
      .lte('date', year + '-12-31');
    if (err3) {
      var { data: expenses2 = [] } = await sb.from('expenses').select(selectFieldsFallback).is('period_from', null).gte('date', year + '-01-01').lte('date', year + '-12-31');
    }

    allExp = (expenses || []).concat(expenses2 || []);
  }

  // Deduplicate by id
  var seen = {};
  allExp = allExp.filter(function(e) {
    if (seen[e.id]) return false;
    seen[e.id] = true;
    return true;
  });

  // Get categories
  var { data: cats = [] } = await sb.from('cost_categories').select('id, name').order('name');

  // Build matrix: zone -> category -> amount + items
  var matrix = {};
  var zoneItems = {}; // zoneName -> catName -> [{expense info + alloc amount}]
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

      // Collect items for accordion
      if (!zoneItems[key]) zoneItems[key] = {};
      if (!zoneItems[key][catName]) zoneItems[key][catName] = [];
      zoneItems[key][catName].push({
        id: e.id,
        description: e.description || '',
        supplier: e.supplier || '',
        date: e.date,
        allocAmount: parseFloat(a.amount) || 0,
        totalAmount: parseFloat(e.amount) || 0,
        invoice_number: e.invoice_number || '',
        period_from: e.period_from,
        period_to: e.period_to
      });

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

  var modeLabel = overviewMode === 'payment' ? 'Rok zaplatenia: ' + year : 'Zúčtovacie obdobie: ' + year;

  if (catNames.length === 0) {
    table.innerHTML = '<p class="text-sm text-slate-300">Žiadne dáta pre ' + modeLabel.toLowerCase() + '</p>';
    return;
  }

  var html = '<p class="text-[9px] text-slate-400 mb-2">' + modeLabel + ' • ' + allExp.length + ' položiek</p>' +
    '<table class="w-full text-[9px]">' +
    '<thead><tr class="border-b-2 border-slate-200">' +
    '<th class="text-left py-2 font-black text-slate-400 uppercase">Nájomca</th>' +
    catNames.map(function(c) { return '<th class="text-right py-2 font-black text-slate-400 uppercase px-2">' + c + '</th>'; }).join('') +
    '<th class="text-right py-2 font-black text-slate-800 uppercase px-2">Spolu</th>' +
    '</tr></thead><tbody>';

  var grandTotals = {};
  catNames.forEach(function(c) { grandTotals[c] = 0; });
  var grandTotal = 0;
  var zIdx = 0;

  zoneNames.forEach(function(z) {
    var isOwner = z === ownerKey;
    var rowTotal = 0;
    var zid = 'zone-' + zIdx++;

    html += '<tr class="border-b border-slate-100 cursor-pointer hover:bg-blue-50 transition-colors' + (isOwner ? ' bg-orange-50' : '') + '" onclick="var rows=document.querySelectorAll(\'.' + zid + '\');var open=rows[0]&&rows[0].style.display!==\'none\';rows.forEach(function(r){r.style.display=open?\'none\':\'table-row\'});this.querySelector(\'.zone-arrow\').textContent=open?\'▾\':\'▸\'">' +
      '<td class="py-2 font-bold ' + (isOwner ? 'text-orange-600' : 'text-slate-700') + '"><span class="zone-arrow text-[8px] text-slate-400 mr-1">▸</span>' + (isOwner ? 'Vlastník' : z) + '</td>';

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

    // Detail rows (hidden by default)
    var allItems = [];
    catNames.forEach(function(c) {
      if (zoneItems[z] && zoneItems[z][c]) {
        zoneItems[z][c].forEach(function(item) {
          allItems.push({ catName: c, item: item });
        });
      }
    });
    allItems.sort(function(a, b) { return (a.item.date || '').localeCompare(b.item.date || ''); });

    allItems.forEach(function(entry) {
      var item = entry.item;
      var period = '';
      if (item.period_from && item.period_to) {
        period = item.period_from.substring(5, 7) + '/' + item.period_from.substring(0, 4) + '–' + item.period_to.substring(5, 7) + '/' + item.period_to.substring(0, 4);
      }
      var label = '';
      if (item.date) label = item.date.substring(8, 10) + '.' + item.date.substring(5, 7) + '. ';
      if (item.supplier) label += item.supplier;
      if (item.description) label += (item.supplier ? ' – ' : '') + item.description;
      if (item.invoice_number) label += ' • ' + item.invoice_number;
      if (period) label += ' • ' + period;

      html += '<tr class="' + zid + ' border-b border-dashed border-slate-100 bg-blue-50/30" style="display:none">' +
        '<td class="py-1 pl-6 text-[8px] text-slate-500">' + label + '</td>';

      catNames.forEach(function(c) {
        if (c === entry.catName) {
          html += '<td class="text-right py-1 px-2 text-[8px] text-blue-600">' + item.allocAmount.toFixed(2) + '</td>';
        } else {
          html += '<td class="text-right py-1 px-2 text-slate-200">–</td>';
        }
      });

      html += '<td class="text-right py-1 px-2 text-[8px] font-bold text-slate-500">' + item.allocAmount.toFixed(2) + ' €</td>';
      html += '</tr>';
    });
  });

  // Totals row
  html += '<tr class="border-t-2 border-slate-300 bg-slate-50">' +
    '<td class="py-2 font-black text-slate-800 uppercase">Celkom</td>';
  catNames.forEach(function(c) {
    html += '<td class="text-right py-2 px-2 font-black text-slate-800">' + (grandTotals[c] || 0).toFixed(2) + '</td>';
  });
  html += '<td class="text-right py-2 px-2 font-black text-slate-900">' + grandTotal.toFixed(2) + ' €</td>';
  html += '</tr></tbody></table>';

  // Meter diagnostics section
  var meterExps = allExp.filter(function(e) { return e.alloc_method === 'meter' && e.meter_main_consumption != null && !e.is_auto_generated; });
  if (meterExps.length > 0) {
    html += '<div class="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">' +
      '<p class="text-[9px] font-black text-slate-500 uppercase mb-2">🔧 Merače – straty a nepresnosti</p>' +
      '<table class="w-full text-[9px]">' +
      '<thead><tr class="border-b border-slate-200">' +
        '<th class="text-left py-1 text-slate-400">Faktúra</th>' +
        '<th class="text-right py-1 text-slate-400 px-2">Hlavný</th>' +
        '<th class="text-right py-1 text-slate-400 px-2">Podmerače</th>' +
        '<th class="text-right py-1 text-slate-400 px-2">Rozdiel</th>' +
        '<th class="text-right py-1 text-slate-400 px-2">%</th>' +
        '<th class="text-right py-1 text-slate-400 px-2">Suma</th>' +
      '</tr></thead><tbody>';

    meterExps.forEach(function(e) {
      var catName = e.cost_categories ? e.cost_categories.name : '';
      var unit = e.consumption_unit || 'm³';
      var losses = parseFloat(e.meter_losses) || 0;
      var lossesPct = parseFloat(e.meter_losses_pct) || 0;
      var mainCons = parseFloat(e.meter_main_consumption) || 0;
      var lossAmount = mainCons > 0 ? (losses / mainCons * parseFloat(e.amount)) : 0;
      var color = losses < -0.5 ? 'text-red-600' : losses > mainCons * 0.05 ? 'text-amber-600' : 'text-green-600';
      var label = losses < -0.5 ? 'podmerače > hlavný' : losses > mainCons * 0.05 ? 'straty' : 'OK';

      html += '<tr class="border-b border-slate-100">' +
        '<td class="py-1"><span class="font-bold text-slate-600">' + catName + '</span> <span class="text-slate-400">' + (e.description || '') + '</span></td>' +
        '<td class="text-right py-1 px-2 font-bold">' + mainCons.toFixed(0) + ' ' + unit + '</td>' +
        '<td class="text-right py-1 px-2">' + (parseFloat(e.meter_sub_total) || 0).toFixed(0) + ' ' + unit + '</td>' +
        '<td class="text-right py-1 px-2 font-bold ' + color + '">' + losses.toFixed(0) + ' ' + unit + '</td>' +
        '<td class="text-right py-1 px-2 ' + color + '">' + lossesPct.toFixed(1) + '%</td>' +
        '<td class="text-right py-1 px-2 ' + color + '">' + lossAmount.toFixed(2) + ' €  <span class="text-[7px]">' + label + '</span></td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
  }

  table.innerHTML = html;

  // ===== METER AUDIT SECTION =====
  var meterExpenses = allExp.filter(function(e) {
    return e.alloc_method === 'meter' && e.meter_main_consumption != null;
  });
  if (meterExpenses.length > 0) {
    var mauditHtml = '<div class="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-4">' +
      '<p class="text-[10px] font-black text-slate-500 uppercase mb-2">🔧 Audit meračov</p>';
    meterExpenses.forEach(function(e) {
      var catName = e.cost_categories ? e.cost_categories.name : '';
      var mainC = parseFloat(e.meter_main_consumption) || 0;
      var subC = parseFloat(e.meter_sub_consumption) || 0;
      var redirC = parseFloat(e.meter_redirected_consumption) || 0;
      var losses = parseFloat(e.meter_losses) || 0;
      var unit = e.meter_consumption_unit || 'm³';
      var lossPct = mainC > 0 ? (losses / mainC * 100) : 0;
      var lossColor = losses < -0.5 ? 'text-red-600' : losses > mainC * 0.05 ? 'text-orange-600' : 'text-green-600';
      var lossLabel = losses < -0.5 ? 'podmerače > hlavný' : losses > 0.01 ? 'straty' : 'OK';

      // Calculate loss amount in euros
      var lossAmount = mainC > 0 ? (Math.abs(losses) / mainC * (parseFloat(e.amount) || 0)) : 0;

      mauditHtml += '<div class="flex items-center justify-between text-[9px] bg-white rounded-lg px-3 py-2 mb-1">' +
        '<span class="font-bold text-slate-600">' + catName + '</span>' +
        '<span class="text-slate-400">' + e.description + '</span>' +
        '<span class="text-slate-500">hlavný: <b>' + mainC.toFixed(0) + '</b> ' + unit +
        '  podm: <b>' + subC.toFixed(0) + '</b>' +
        (redirC > 0 ? '  presm: <b>' + redirC.toFixed(0) + '</b>' : '') + '</span>' +
        '<span class="font-bold ' + lossColor + '">' + losses.toFixed(1) + ' ' + unit + ' (' + lossPct.toFixed(1) + '%) = ' + lossAmount.toFixed(2) + ' € ' + lossLabel + '</span>' +
      '</div>';
    });
    mauditHtml += '</div>';
    table.innerHTML += mauditHtml;
  }

  // ===== SUPPLIER BREAKDOWN TABLE WITH ACCORDION =====
  var supplierMatrix = {};
  var supplierItems = {}; // supplier -> catName -> [expense items]
  var supplierCatTotals = {};

  allExp.forEach(function(e) {
    var catName = e.cost_categories ? e.cost_categories.name : 'Ostatné';
    var supplier = e.supplier ? e.supplier.trim() : 'Bez dodávateľa';
    var amt = parseFloat(e.amount) || 0;
    if (amt === 0) return;

    if (!supplierMatrix[supplier]) supplierMatrix[supplier] = {};
    if (!supplierMatrix[supplier][catName]) supplierMatrix[supplier][catName] = 0;
    supplierMatrix[supplier][catName] += amt;

    if (!supplierItems[supplier]) supplierItems[supplier] = {};
    if (!supplierItems[supplier][catName]) supplierItems[supplier][catName] = [];
    supplierItems[supplier][catName].push({
      id: e.id,
      description: e.description || '',
      date: e.date,
      amount: amt,
      invoice_number: e.invoice_number || '',
      period_from: e.period_from,
      period_to: e.period_to
    });

    if (!supplierCatTotals[catName]) supplierCatTotals[catName] = 0;
    supplierCatTotals[catName] += amt;
  });

  var supplierNames = Object.keys(supplierMatrix).sort(function(a, b) {
    if (a === 'Bez dodávateľa') return 1;
    if (b === 'Bez dodávateľa') return -1;
    return a.localeCompare(b, 'sk');
  });

  if (supplierNames.length > 0) {
    var colCount = catNames.length + 2;
    var shtml = '<div class="mt-6 pt-4 border-t-2 border-slate-200">' +
      '<h4 class="text-[10px] font-black text-slate-400 uppercase mb-2">Náklady podľa dodávateľa</h4>' +
      '<table class="w-full text-[9px]">' +
      '<thead><tr class="border-b-2 border-slate-200">' +
      '<th class="text-left py-2 font-black text-slate-400 uppercase">Dodávateľ</th>' +
      catNames.map(function(c) { return '<th class="text-right py-2 font-black text-slate-400 uppercase px-2">' + c + '</th>'; }).join('') +
      '<th class="text-right py-2 font-black text-slate-800 uppercase px-2">Spolu</th>' +
      '</tr></thead><tbody>';

    var sGrandTotals = {};
    catNames.forEach(function(c) { sGrandTotals[c] = 0; });
    var sGrandTotal = 0;
    var suppIdx = 0;

    supplierNames.forEach(function(s) {
      var rowTotal = 0;
      var isNone = s === 'Bez dodávateľa';
      var sid = 'supp-' + suppIdx++;

      // Collect all items for this supplier across all categories
      var hasItems = false;
      catNames.forEach(function(c) {
        if (supplierItems[s] && supplierItems[s][c] && supplierItems[s][c].length > 0) hasItems = true;
      });

      shtml += '<tr class="border-b border-slate-100 cursor-pointer hover:bg-blue-50 transition-colors' + (isNone ? ' bg-slate-50 italic' : '') + '" onclick="var rows=document.querySelectorAll(\'.' + sid + '\');var open=rows[0]&&rows[0].style.display!==\'none\';rows.forEach(function(r){r.style.display=open?\'none\':\'table-row\'});this.querySelector(\'.supp-arrow\').textContent=open?\'▸\':\'▾\'">' +
        '<td class="py-2 font-bold ' + (isNone ? 'text-slate-400' : 'text-slate-700') + '"><span class="supp-arrow text-[8px] text-slate-400 mr-1">▸</span>' + s + '</td>';

      catNames.forEach(function(c) {
        var val = (supplierMatrix[s] && supplierMatrix[s][c]) || 0;
        rowTotal += val;
        sGrandTotals[c] += val;
        shtml += '<td class="text-right py-2 px-2 ' + (val > 0 ? 'text-slate-600' : 'text-slate-200') + '">' +
          (val > 0 ? val.toFixed(2) : '–') + '</td>';
      });

      sGrandTotal += rowTotal;
      shtml += '<td class="text-right py-2 px-2 font-black text-slate-800">' + rowTotal.toFixed(2) + ' €</td>';
      shtml += '</tr>';

      // Detail rows (hidden by default) - one row per expense item
      if (hasItems) {
        // Collect all items sorted by date
        var allItems = [];
        catNames.forEach(function(c) {
          if (supplierItems[s] && supplierItems[s][c]) {
            supplierItems[s][c].forEach(function(item) {
              allItems.push({ catName: c, item: item });
            });
          }
        });
        allItems.sort(function(a, b) { return (a.item.date || '').localeCompare(b.item.date || ''); });

        allItems.forEach(function(entry) {
          var item = entry.item;
          var period = '';
          if (item.period_from && item.period_to) {
            period = item.period_from.substring(5, 7) + '/' + item.period_from.substring(0, 4) + '–' + item.period_to.substring(5, 7) + '/' + item.period_to.substring(0, 4);
          }
          var label = item.description || '';
          if (item.invoice_number) label += (label ? ' • ' : '') + item.invoice_number;
          if (period) label += (label ? ' • ' : '') + period;
          if (item.date) label = item.date.substring(8, 10) + '.' + item.date.substring(5, 7) + '. ' + label;

          shtml += '<tr class="' + sid + ' border-b border-dashed border-slate-100 bg-blue-50/30" style="display:none">' +
            '<td class="py-1 pl-6 text-[8px] text-slate-500">' + label + '</td>';

          catNames.forEach(function(c) {
            if (c === entry.catName) {
              shtml += '<td class="text-right py-1 px-2 text-[8px] text-blue-600">' + item.amount.toFixed(2) + '</td>';
            } else {
              shtml += '<td class="text-right py-1 px-2 text-slate-200">–</td>';
            }
          });

          shtml += '<td class="text-right py-1 px-2 text-[8px] font-bold text-slate-500">' + item.amount.toFixed(2) + ' €</td>';
          shtml += '</tr>';
        });
      }
    });

    // Supplier totals row
    shtml += '<tr class="border-t-2 border-slate-300 bg-slate-50">' +
      '<td class="py-2 font-black text-slate-800 uppercase">Celkom</td>';
    catNames.forEach(function(c) {
      shtml += '<td class="text-right py-2 px-2 font-black text-slate-800">' + (sGrandTotals[c] || 0).toFixed(2) + '</td>';
    });
    shtml += '<td class="text-right py-2 px-2 font-black text-slate-900">' + sGrandTotal.toFixed(2) + ' €</td>';
    shtml += '</tr></tbody></table></div>';

    table.innerHTML += shtml;
  }
};

// ============ ZÁLOHY ============

var monthNames = ['Jan','Feb','Mar','Apr','Máj','Jún','Júl','Aug','Sep','Okt','Nov','Dec'];

window.loadPayments = async function() {
  var yearSel = document.getElementById('fin-pay-year');
  if (!yearSel) return;
  var year = yearSel.value || new Date().getFullYear();

  var { data: tenants = [] } = await sb.from('tenants').select('id, name, company_name, monthly_rent, monthly_advance, lease_from, lease_to').order('name');
  var { data: payments = [] } = await sb.from('tenant_payments').select('*')
    .gte('month', year + '-01-01').lte('month', year + '-12-01');

  // Filter tenants active in selected year
  var yearStart = year + '-01-01';
  var yearEnd = year + '-12-31';
  tenants = tenants.filter(function(t) {
    var startOk = !t.lease_from || t.lease_from <= yearEnd;
    var endOk = !t.lease_to || t.lease_to >= yearStart;
    return startOk && endOk;
  });

  var grid = document.getElementById('fin-payments-grid');
  if (!grid) return;

  if (tenants.length === 0) {
    grid.innerHTML = '<p class="text-sm text-slate-300">Žiadni aktívni nájomcovia v ' + year + '</p>';
    return;
  }

  var html = '<table class="w-full text-[9px]">' +
    '<thead><tr class="border-b-2 border-slate-200">' +
    '<th class="text-left py-2 font-black text-slate-400 uppercase" colspan="2">Nájomca</th>' +
    monthNames.map(function(m) { return '<th class="text-center py-2 font-black text-slate-400 uppercase w-12">' + m + '</th>'; }).join('') +
    '<th class="text-right py-2 font-black text-slate-800 uppercase px-2">Spolu</th>' +
    '</tr></thead><tbody>';

  var grandRent = 0, grandAdv = 0;

  tenants.forEach(function(t) {
    var tLabel = t.company_name || t.name;
    tLabel = tLabel.replace(/,?\s*(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?)$/i, '').trim();

    var types = [];
    if (t.monthly_rent > 0) types.push({ type: 'rent', label: 'Nájomné', cls: 'text-indigo-500' });
    // Show advance row if tenant has advance amount OR has advance payments in DB
    var hasAdvancePayments = payments.some(function(p) { return p.tenant_id === t.id && (p.type === 'advance' || !p.type); });
    if (t.monthly_advance > 0 || hasAdvancePayments) types.push({ type: 'advance', label: 'Zálohy', cls: 'text-blue-500' });
    // Show settlement row if tenant has settlement payments
    var hasSettlement = payments.some(function(p) { return p.tenant_id === t.id && p.type === 'settlement'; });
    if (hasSettlement) types.push({ type: 'settlement', label: 'Vyúčtovanie', cls: 'text-orange-500' });
    if (types.length === 0) return;

    // Tenant header
    html += '<tr class="border-t-2 border-slate-200"><td colspan="15" class="pt-3 pb-1 font-black text-slate-700">' + tLabel + '</td></tr>';

    types.forEach(function(tp) {
      var rowTotal = 0;
      html += '<tr class="border-b border-slate-50">' +
        '<td colspan="2" class="py-1 pl-4 text-[8px] font-bold ' + tp.cls + ' uppercase">' + tp.label + '</td>';

      for (var m = 0; m < 12; m++) {
        var monthStr = year + '-' + String(m + 1).padStart(2, '0') + '-01';
        var cellPays = payments.filter(function(p) { return p.tenant_id === t.id && p.month === monthStr && (p.type || 'advance') === tp.type; });

        if (cellPays.length > 0) {
          html += '<td class="text-center py-1"><div class="flex flex-col gap-0.5">';
          cellPays.forEach(function(pay) {
            var unpaidCls = tp.type === 'rent' ? 'bg-indigo-50 text-indigo-400 hover:bg-indigo-100' :
              tp.type === 'settlement' ? 'bg-orange-50 text-orange-400 hover:bg-orange-100' :
              'bg-blue-50 text-blue-400 hover:bg-blue-100';
            var paidCls = 'bg-green-100 text-green-700 hover:bg-green-200';
            var cls = pay.paid ? paidCls : unpaidCls;
            rowTotal += parseFloat(pay.amount) || 0;
            var tooltip = (pay.paid_date ? 'Uhradené: ' + pay.paid_date : 'Klik = zaplatené') +
              (pay.period_from && pay.period_to ? ' • Obdobie: ' + pay.period_from.substring(0,7) + ' – ' + pay.period_to.substring(0,7) : '') +
              (pay.note ? ' • ' + pay.note : '') + ', Dvojklik = upraviť';
            html += '<div class="' + cls + ' rounded px-1 py-1 text-[8px] font-bold cursor-pointer pay-cell" ' +
              'data-pay-id="' + pay.id + '" data-pay-paid="' + pay.paid + '" data-pay-amount="' + pay.amount + '" ' +
              'title="' + tooltip + '">' +
              parseFloat(pay.amount).toFixed(0) +
              (pay.paid ? ' ✓' : '') +
            '</div>';
          });
          html += '</div></td>';
        } else {
          html += '<td class="text-center py-1"><span class="text-slate-200">–</span></td>';
        }
      }

      if (tp.type === 'rent') grandRent += rowTotal;
      else grandAdv += rowTotal;

      html += '<td class="text-right py-1 px-2 font-black text-slate-700">' + (rowTotal > 0 ? rowTotal.toFixed(0) + ' €' : '–') + '</td>';
      html += '</tr>';
    });
  });

  // Totals
  html += '<tr class="border-t-2 border-slate-300 bg-slate-50">' +
    '<td colspan="2" class="py-2 font-black text-slate-800 uppercase">Celkom</td>' +
    '<td colspan="12" class="py-2 text-center text-[8px] text-slate-400">' +
      'Nájomné: ' + grandRent.toFixed(0) + ' € • Zálohy: ' + grandAdv.toFixed(0) + ' €' +
    '</td>' +
    '<td class="text-right py-2 px-2 font-black text-slate-900">' + (grandRent + grandAdv).toFixed(0) + ' €</td>' +
    '</tr></tbody></table>';

  grid.innerHTML = html;

  // Delegated click vs dblclick handler
  var clickTimer = null;
  grid.onclick = function(e) {
    var cell = e.target.closest('.pay-cell');
    if (!cell) return;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
    clickTimer = setTimeout(function() {
      clickTimer = null;
      var id = cell.getAttribute('data-pay-id');
      var paid = cell.getAttribute('data-pay-paid') === 'true';
      window.togglePayment(id, !paid);
    }, 250);
  };
  grid.ondblclick = function(e) {
    var cell = e.target.closest('.pay-cell');
    if (!cell) return;
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    var id = cell.getAttribute('data-pay-id');
    window.editPayment(id);
  };
};

window.generatePayments = async function() {
  var yearSel = document.getElementById('fin-pay-year');
  var year = yearSel ? yearSel.value : new Date().getFullYear();

  var { data: tenants = [] } = await sb.from('tenants').select('id, name, monthly_rent, monthly_advance, lease_from, lease_to');

  var toInsert = [];
  tenants.forEach(function(t) {
    var amounts = [];
    if (t.monthly_rent > 0) amounts.push({ type: 'rent', amount: t.monthly_rent });
    if (t.monthly_advance > 0) amounts.push({ type: 'advance', amount: t.monthly_advance });

    amounts.forEach(function(a) {
      for (var m = 0; m < 12; m++) {
        var monthStr = year + '-' + String(m + 1).padStart(2, '0') + '-01';
        if (t.lease_from && monthStr < t.lease_from.substring(0, 7) + '-01') continue;
        if (t.lease_to && monthStr > t.lease_to.substring(0, 7) + '-01') continue;

        toInsert.push({
          tenant_id: t.id,
          month: monthStr,
          amount: a.amount,
          type: a.type,
          paid: false
        });
      }
    });
  });

  if (toInsert.length === 0) {
    alert('Žiadni nájomcovia s nájomným alebo zálohou.');
    return;
  }

  var { data: existing = [] } = await sb.from('tenant_payments').select('id, tenant_id, month, type, paid')
    .gte('month', year + '-01-01').lte('month', year + '-12-01');

  var existingMap = {};
  existing.forEach(function(e) {
    // Normalize month to YYYY-MM-DD (DB may return with time portion)
    var normMonth = (e.month || '').substring(0, 10);
    existingMap[e.tenant_id + '|' + normMonth + '|' + (e.type || 'advance')] = e;
  });

  var newOnly = [];
  var updated = 0;
  for (var i = 0; i < toInsert.length; i++) {
    var p = toInsert[i];
    var key = p.tenant_id + '|' + p.month + '|' + p.type;
    var ex = existingMap[key];
    if (!ex) {
      newOnly.push(p);
    } else if (!ex.paid) {
      // Update unpaid with current amount
      await sb.from('tenant_payments').update({ amount: p.amount }).eq('id', ex.id);
      updated++;
    }
    // paid → skip
  }

  var msgs = [];
  if (newOnly.length > 0) {
    await sb.from('tenant_payments').insert(newOnly);
    msgs.push(newOnly.length + ' nových');
  }
  if (updated > 0) msgs.push(updated + ' aktualizovaných');
  if (msgs.length === 0) {
    alert('Platby pre rok ' + year + ' už existujú (potvrdené sa nemenia).');
  } else {
    alert('Platby: ' + msgs.join(', ') + '.');
  }

  await window.loadPayments();
};

window.editPayment = async function(payId) {
  var { data: pay } = await sb.from('tenant_payments').select('*').eq('id', payId).single();
  if (!pay) return;

  editingPaymentId = payId;

  var { data: tenants = [] } = await sb.from('tenants').select('id, name, company_name').order('name');
  var sel = document.getElementById('pay-tenant');
  sel.innerHTML = '<option value="">-- Vyberte --</option>' +
    tenants.map(function(t) { return '<option value="' + t.id + '">' + (t.company_name || t.name) + '</option>'; }).join('');
  sel.value = pay.tenant_id;

  document.getElementById('pay-type').value = pay.type || 'advance';
  document.getElementById('pay-amount').value = pay.amount || '';
  document.getElementById('pay-date').value = pay.paid_date || '';
  var pfVal = pay.period_from ? pay.period_from.substring(0, 7) : pay.month ? pay.month.substring(0, 7) : '';
  var ptVal = pay.period_to ? pay.period_to.substring(0, 7) : pfVal;
  document.getElementById('pay-period-from').value = pfVal;
  document.getElementById('pay-period-to').value = ptVal;
  document.getElementById('pay-note').value = pay.note || '';

  document.getElementById('pay-modal-title').innerText = 'Upraviť platbu';
  document.getElementById('pay-delete-btn').classList.remove('hidden');
  document.getElementById('modal-payment').classList.remove('hidden');
};

window.deletePayment = async function() {
  if (!editingPaymentId) return;
  if (!confirm('Vymazať túto platbu?')) return;
  await sb.from('tenant_payments').delete().eq('id', editingPaymentId);
  editingPaymentId = null;
  document.getElementById('modal-payment').classList.add('hidden');
  await window.loadPayments();
};

window.togglePayment = async function(payId, newPaid) {
  if (newPaid) {
    var { data: existing } = await sb.from('tenant_payments').select('paid_date, month, type').eq('id', payId).single();
    var update = { paid: true };
    if (!existing || !existing.paid_date) {
      // For monthly payments, default to 1st of that month
      if (existing && existing.month && (existing.type === 'rent' || existing.type === 'advance')) {
        update.paid_date = existing.month;
      } else {
        update.paid_date = new Date().toISOString().split('T')[0];
      }
    }
    await sb.from('tenant_payments').update(update).eq('id', payId);
  } else {
    await sb.from('tenant_payments').update({ paid: false }).eq('id', payId);
  }
  await window.loadPayments();
};

var editingPaymentId = null;

window.showAddPayment = async function() {
  editingPaymentId = null;
  var { data: tenants = [] } = await sb.from('tenants').select('id, name, company_name').order('name');
  var sel = document.getElementById('pay-tenant');
  sel.innerHTML = '<option value="">-- Vyberte --</option>' +
    tenants.map(function(t) { return '<option value="' + t.id + '">' + (t.company_name || t.name) + '</option>'; }).join('');
  document.getElementById('pay-type').value = 'settlement';
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  var yearSel = document.getElementById('fin-pay-year');
  var year = yearSel ? yearSel.value : new Date().getFullYear();
  document.getElementById('pay-period-from').value = year + '-01';
  document.getElementById('pay-period-to').value = year + '-12';
  document.getElementById('pay-note').value = '';
  document.getElementById('pay-modal-title').innerText = 'Nová platba';
  document.getElementById('pay-delete-btn').classList.add('hidden');
  document.getElementById('modal-payment').classList.remove('hidden');
};

window.saveManualPayment = async function() {
  var tenantId = document.getElementById('pay-tenant').value;
  var type = document.getElementById('pay-type').value;
  var amount = parseFloat(document.getElementById('pay-amount').value) || 0;
  var paidDate = document.getElementById('pay-date').value;
  var periodFrom = document.getElementById('pay-period-from').value;
  var periodTo = document.getElementById('pay-period-to').value;
  var note = document.getElementById('pay-note').value.trim() || null;

  if (!tenantId) { alert('Vyberte nájomcu.'); return; }
  if (!periodFrom) { alert('Vyplňte obdobie od.'); return; }

  var row = {
    tenant_id: tenantId,
    amount: amount,
    type: type,
    paid: true
  };
  if (paidDate) row.paid_date = paidDate;
  if (periodFrom) row.period_from = periodFrom + '-01';
  if (periodTo) row.period_to = (periodTo || periodFrom) + '-01';
  row.note = note;

  var error;
  if (editingPaymentId) {
    // NEVER change month on edit - keep grid position
    var res = await sb.from('tenant_payments').update(row).eq('id', editingPaymentId);
    error = res.error;
  } else {
    // New payment: month = period_from (grid position = obdobie)
    row.month = periodFrom + '-01';
    var res = await sb.from('tenant_payments').insert(row);
    error = res.error;
  }

  if (error) {
    alert('Chyba pri ukladaní: ' + error.message);
    console.error('Payment save error:', error);
    return;
  }

  editingPaymentId = null;
  document.getElementById('modal-payment').classList.add('hidden');
  await window.loadPayments();
};

// ============ VYÚČTOVANIE ============

// Strip Slovak diacritics for PDF (standard fonts don't support them)
function stripDia(s) {
  return s || '';
}

function fmtEur(n) { return parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

window.redownloadInvoice = async function(invId) {
  var { data: inv } = await sb.from('invoices').select('*').eq('id', invId).single();
  if (!inv) { alert('Vyúčtovanie nenájdené.'); return; }

  // Set fields and generate without saving new record
  document.getElementById('fin-inv-tenant').value = inv.tenant_id;
  document.getElementById('fin-inv-from').value = inv.period_from;
  document.getElementById('fin-inv-to').value = inv.period_to;

  await window.generateInvoice(inv);
};

window.generateInvoice = async function(existingInvoice) {
  var tenantId = document.getElementById('fin-inv-tenant').value;
  var dateFrom = document.getElementById('fin-inv-from').value;
  var dateTo = document.getElementById('fin-inv-to').value;
  if (!tenantId) { alert('Vyberte najomcu.'); return; }
  if (!dateFrom || !dateTo) { alert('Vyplnte obdobie.'); return; }

  // Load tenant
  var { data: tenant } = await sb.from('tenants').select('*').eq('id', tenantId).single();
  if (!tenant) { alert('Najomca nenajdeny.'); return; }

  // Load owner (prenajímateľ) from tenants with is_owner=true
  var { data: owners = [] } = await sb.from('tenants').select('*').eq('is_owner', true).limit(1);
  var owner = owners.length > 0 ? owners[0] : null;

  // Load zones for this tenant
  var { data: tenantZones = [] } = await sb.from('zones').select('id, name, tenant_name, area_m2').eq('tenant_id', tenantId);
  var zoneIds = tenantZones.map(function(z) { return z.id; });
  var totalArea = tenantZones.reduce(function(s, z) { return s + (parseFloat(z.area_m2) || 0); }, 0);
  var zoneLabel = tenantZones.map(function(z) { return z.name; }).join(', ');

  // Load allocations for this tenant's zones in period
  var { data: allocs = [] } = await sb.from('expense_allocations')
    .select('amount, percentage, payer, zone_id, consumption, consumption_unit, expenses(id, amount, description, date, period_from, period_to, supplier, invoice_number, alloc_method, cost_type, amort_years, is_auto_generated, auto_source_meter_id, meter_main_consumption, meter_sub_consumption, meter_redirected_consumption, meter_losses, meter_consumption_unit, cost_categories(name))')
    .in('zone_id', zoneIds.length > 0 ? zoneIds : ['none']);

  // Filter by period overlap
  var periodAllocs = allocs.filter(function(a) {
    if (!a.expenses) return false;
    var e = a.expenses;
    if (e.period_from && e.period_to) {
      return e.period_from <= dateTo && e.period_to >= dateFrom;
    }
    return e.date && e.date >= dateFrom && e.date <= dateTo;
  });

  // Load expenses with redirected meter consumption (water/electricity → heating)
  var redirectedExpenses = [];
  try {
    var rResult = await sb.from('expenses')
      .select('id, amount, description, supplier, date, period_from, period_to, alloc_method, meter_main_consumption, meter_sub_consumption, meter_redirected_consumption, meter_consumption_unit, cost_categories(name)')
      .gt('meter_redirected_consumption', 0)
      .lte('period_from', dateTo).gte('period_to', dateFrom);
    redirectedExpenses = rResult.data || [];
  } catch(e) { /* column may not exist */ }

  // Only tenant-paid allocations
  var tenantAllocs = periodAllocs.filter(function(a) { return a.payer !== 'owner'; });

  // Group by category
  var byCat = {};
  tenantAllocs.forEach(function(a) {
    var cat = a.expenses.cost_categories ? a.expenses.cost_categories.name : 'Ostatne';
    if (!byCat[cat]) byCat[cat] = { amount: 0, items: [] };
    byCat[cat].amount += parseFloat(a.amount) || 0;
    byCat[cat].items.push(a);
  });

  var catNames = Object.keys(byCat).sort();
  var totalCosts = catNames.reduce(function(s, c) { return s + byCat[c].amount; }, 0);

  // (allBuildingAllocs removed - detail pages now show only tenant's own data)

  // Load advance payments in period
  var { data: payments = [] } = await sb.from('tenant_payments').select('*')
    .eq('tenant_id', tenantId).eq('type', 'advance')
    .gte('month', dateFrom.substring(0, 7) + '-01')
    .lte('month', dateTo.substring(0, 7) + '-01')
    .order('month');

  var paidAdvances = payments.filter(function(p) { return p.paid; }).reduce(function(s, p) { return s + (parseFloat(p.amount) || 0); }, 0);

  var balance = totalCosts - paidAdvances;

  // Period label
  var periodLabel = fmtD(dateFrom) + ' - ' + fmtD(dateTo);
  var yearLabel = dateFrom.substring(0, 4);
  if (dateFrom.substring(0, 4) !== dateTo.substring(0, 4)) {
    yearLabel = dateFrom.substring(0, 4) + '-' + dateTo.substring(0, 4);
  }

  // Pre-calculate invoice number and due date (needed in PDF)
  var invNumber;
  var dueDateStr;
  var isNewInvoice = false;

  if (existingInvoice) {
    invNumber = existingInvoice.invoice_number;
    dueDateStr = existingInvoice.due_date;
  } else {
    var { data: existingInv = [] } = await sb.from('invoices').select('invoice_number')
      .like('invoice_number', 'VYUCT-' + yearLabel + '-%');
    var nextNum = existingInv.length + 1;
    invNumber = 'VYUCT-' + yearLabel + '-' + String(nextNum).padStart(3, '0');
    var dueDateObj = new Date();
    dueDateObj.setDate(dueDateObj.getDate() + 15);
    dueDateStr = dueDateObj.toISOString().split('T')[0];
    isNewInvoice = true;
  }

  // Generate PDF
  var { jsPDF } = window.jspdf;
  var doc = new jsPDF('p', 'mm', 'a4');
  registerRobotoFont(doc);
  var W = 210, M = 20, y = 20;

  // Header
  doc.setFontSize(16);
  doc.setFont('Roboto', 'bold');
  doc.text(stripDia('VYÚČTOVANIE NÁKLADOV'), M, y);
  y += 7;
  doc.setFontSize(11);
  doc.text(stripDia('za obdobie ' + periodLabel), M, y);
  y += 5;

  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.line(M, y, W - M, y);
  y += 8;

  // ===== PAGE 1: MAIN INVOICE =====

  // Two-column: Prenajímateľ (left) | Nájomca (right)
  var colL = M, colR = W / 2 + 5;

  doc.setFontSize(9);
  doc.setFont('Roboto', 'bold');
  doc.text(stripDia('Prenajímateľ:'), colL, y);
  doc.text(stripDia('Nájomca:'), colR, y);
  y += 4;
  doc.setFontSize(9);
  doc.setFont('Roboto', 'normal');

  // Left column - Owner
  var oy = y;
  if (owner) {
    doc.text(stripDia(owner.company_name || owner.name), colL, oy); oy += 4;
    if (owner.address) { doc.text(stripDia((owner.address || '') + ', ' + (owner.zip || '') + ' ' + (owner.city || '')), colL, oy); oy += 4; }
    if (owner.ico) { doc.text(stripDia('IČO: ' + owner.ico + (owner.dic ? '  DIČ: ' + owner.dic : '')), colL, oy); oy += 4; }
    doc.text('IBAN: ' + (owner.iban || 'SK00 0000 0000 0000 0000 0000'), colL, oy); oy += 4;
    if (owner.name && owner.company_name) { doc.text(stripDia('Kontakt: ' + owner.name), colL, oy); oy += 4; }
    if (owner.phone) { doc.text(stripDia('Tel: ' + owner.phone), colL, oy); oy += 4; }
    if (owner.email) { doc.text(stripDia('Email: ' + owner.email), colL, oy); oy += 4; }
  } else {
    doc.text(stripDia('Ing. Vladimír Žila, správca'), colL, oy); oy += 4;
    doc.text(stripDia('Panská 17, 811 01 Bratislava'), colL, oy); oy += 4;
  }

  // Right column - Tenant
  var ty = y;
  doc.text(stripDia(tenant.company_name || tenant.name), colR, ty); ty += 4;
  if (tenant.address) { doc.text(stripDia((tenant.address || '') + ', ' + (tenant.zip || '') + ' ' + (tenant.city || '')), colR, ty); ty += 4; }
  if (tenant.ico) { doc.text(stripDia('IČO: ' + tenant.ico + (tenant.dic ? '  DIČ: ' + tenant.dic : '')), colR, ty); ty += 4; }
  if (tenant.name && tenant.company_name) { doc.text(stripDia('Kontakt: ' + tenant.name), colR, ty); ty += 4; }
  if (tenant.phone) { doc.text(stripDia('Tel: ' + tenant.phone), colR, ty); ty += 4; }
  if (tenant.email) { doc.text(stripDia('Email: ' + tenant.email), colR, ty); ty += 4; }

  y = Math.max(oy, ty) + 8;

  // COSTS TABLE: Položka | Mesačne | Suma
  doc.setFontSize(11);
  doc.setFont('Roboto', 'bold');
  doc.text(stripDia('NÁKLADY'), M, y);
  y += 5;

  var numMonths = 12;
  if (dateFrom && dateTo) {
    var dfp = new Date(dateFrom + 'T00:00:00');
    var dtp = new Date(dateTo + 'T00:00:00');
    numMonths = Math.max(1, Math.round((dtp - dfp) / (30.44 * 24 * 60 * 60 * 1000)));
  }

  var costRows = catNames.map(function(c) {
    var monthlyAmt = byCat[c].amount / numMonths;
    return [stripDia(c), fmtEur(monthlyAmt) + ' EUR', fmtEur(byCat[c].amount) + ' EUR'];
  });

  costRows.push([
    { content: stripDia('NÁKLADY SPOLU'), styles: { fontStyle: 'bold' } },
    { content: fmtEur(totalCosts / numMonths) + ' EUR', styles: { fontStyle: 'bold' } },
    { content: fmtEur(totalCosts) + ' EUR', styles: { fontStyle: 'bold' } }
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [[stripDia('Položka'), { content: stripDia('Mesačne'), styles: { halign: 'right' } }, { content: stripDia('Ročne'), styles: { halign: 'right' } }]],
    body: costRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2, halign: 'left', font: 'Roboto' },
    headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { cellWidth: 40, halign: 'right' },
      2: { cellWidth: 40, halign: 'right' }
    }
  });

  y = doc.lastAutoTable.finalY + 8;

  // VYÚČTOVANIE (balance summary - no monthly payment list)
  doc.setFontSize(11);
  doc.setFont('Roboto', 'bold');
  doc.text(stripDia('VYÚČTOVANIE'), M, y);
  y += 5;

  var balanceRows = [
    [stripDia('Náklady spolu'), fmtEur(totalCosts) + ' EUR'],
    [stripDia('Zálohy zaplatené'), fmtEur(paidAdvances) + ' EUR']
  ];

  // balance already calculated above
  var balLabel = balance > 0.01 ? 'Nedoplatok' : (balance < -0.01 ? 'Preplatok' : 'Vyrovnané');
  var balAmount = balance > 0.01 ? balance : (balance < -0.01 ? Math.abs(balance) : 0);

  balanceRows.push([
    { content: stripDia(balLabel), styles: { fontStyle: 'bold', fontSize: 11 } },
    { content: (balAmount > 0 ? fmtEur(balAmount) + ' EUR' : '0.00 EUR'), styles: { fontStyle: 'bold', fontSize: 11 } }
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    body: balanceRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2, font: 'Roboto' },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 50, halign: 'right' }
    }
  });

  y = doc.lastAutoTable.finalY + 5;

  // Payment instructions
  if (balance > 0.01) {
    doc.setFontSize(8);
    doc.setFont('Roboto', 'normal');
    var ownerIban = owner ? (owner.iban || 'SK00 0000 0000 0000 0000 0000') : 'SK00 0000 0000 0000 0000 0000';
    doc.text(stripDia('Splatnosť: ' + fmtD(dueDateStr) + '   |   IBAN: ' + ownerIban + '   |   VS: ' + yearLabel + '001'), M, y);
    y += 5;
  } else if (balance < -0.01) {
    doc.setFontSize(8);
    doc.setFont('Roboto', 'normal');
    doc.text(stripDia('Preplatok bude vrátený na účet nájomcu.'), M, y);
    y += 5;
  }

  // Footer
  y += 5;
  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text(stripDia('Vyúčtovanie vygenerované ' + new Date().toLocaleDateString('sk-SK')), M, y);
  doc.setTextColor(0);

  // ===== PAGE 2: DETAIL SPOTREBY =====
  // All categories on one page with consistent formatting

  var meterCategories = {};
  periodAllocs.forEach(function(a) {
    if (!a.expenses || a.expenses.alloc_method !== 'meter') return;
    var cat = a.expenses.cost_categories ? a.expenses.cost_categories.name : 'Ostatne';
    if (!meterCategories[cat]) {
      meterCategories[cat] = {
        expenseIds: [], expenses: [],
        mainCons: 0, subCons: 0, redirCons: 0,
        unit: a.expenses.meter_consumption_unit || 'm\u00B3',
        totalAmount: 0
      };
    }
    var mc = meterCategories[cat];
    if (mc.expenseIds.indexOf(a.expenses.id) < 0) {
      mc.expenseIds.push(a.expenses.id);
      mc.expenses.push(a.expenses);
      mc.mainCons += parseFloat(a.expenses.meter_main_consumption) || 0;
      mc.subCons += parseFloat(a.expenses.meter_sub_consumption) || 0;
      mc.redirCons += parseFloat(a.expenses.meter_redirected_consumption) || 0;
      mc.totalAmount += parseFloat(a.expenses.amount) || 0;
    }
  });

  // Check if we have any detail content
  var hasWater = meterCategories['Voda a kanalizácia'] || meterCategories['Voda a kanalizácia'];
  var hasElec = meterCategories['Elektrina'];
  var hasHeat = byCat['Vykurovanie'];
  var hasEps = byCat['EPS a PO'];

  if (hasWater || hasElec || hasHeat || hasEps) {
    doc.addPage();
    var dy = 20;

    doc.setFontSize(13);
    doc.setFont('Roboto', 'bold');
    doc.text(stripDia('DETAILNÝ ROZPIS'), M, dy);
    dy += 9;
    doc.setDrawColor(0); doc.setLineWidth(0.25);
    doc.line(M, dy, W - M, dy);
    dy += 8;

    // Helper: detail section with consistent format
    function detailSection(title, rows) {
      // Check if we need a new page
      if (dy > 240) { doc.addPage(); dy = 20; }
      doc.setFontSize(10);
      doc.setFont('Roboto', 'bold');
      doc.setTextColor(0);
      doc.text(stripDia(title), M, dy);
      dy += 5;

      doc.autoTable({
        startY: dy,
        margin: { left: M + 2, right: M },
        body: rows,
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 1.2, font: 'Roboto' },
        columnStyles: { 0: { cellWidth: 75 }, 1: { cellWidth: 55, halign: 'right' } }
      });
      dy = doc.lastAutoTable.finalY + 10;
    }

    // --- VODA A KANALIZÁCIA ---
    var waterKey = Object.keys(meterCategories).find(function(k) { return k.match(/vod|kanal/i); });
    if (waterKey) {
      var wc = meterCategories[waterKey];
      var wItems = byCat[waterKey] ? byCat[waterKey].items : [];
      var wCons = wItems.reduce(function(s, a) { return s + (parseFloat(a.consumption) || 0); }, 0);
      var wAmount = byCat[waterKey] ? byCat[waterKey].amount : 0;
      var wRows = [];
      if (wc.mainCons > 0) {
        wRows.push([stripDia('Hlavný merač (budova)'), wc.mainCons.toFixed(2) + ' m3']);
        if (wc.redirCons > 0) wRows.push([stripDia('  z toho kotolňa (vykurovanie)'), wc.redirCons.toFixed(2) + ' m3']);
        var wLoss = wc.mainCons - wc.subCons - wc.redirCons;
        if (Math.abs(wLoss) > 0.5) wRows.push([stripDia('  straty / nepresnosť'), wLoss.toFixed(2) + ' m3']);
      }
      wRows.push([stripDia('Váš merač'), wCons.toFixed(2) + ' m3']);
      if (wCons > 0 && wAmount > 0) wRows.push([stripDia('Jednotková cena'), (wAmount / wCons).toFixed(6) + ' EUR/m3']);
      wRows.push([stripDia('Mesačný náklad'), fmtEur(wAmount / numMonths) + ' EUR']);
      wRows.push([{content: stripDia('Celkom'), styles: {fontStyle: 'bold'}}, {content: fmtEur(wAmount) + ' EUR', styles: {fontStyle: 'bold'}}]);
      detailSection('Voda a kanalizácia', wRows);
    }

    // --- ELEKTRINA ---
    if (hasElec) {
      var ec = meterCategories['Elektrina'];
      var eItems = byCat['Elektrina'] ? byCat['Elektrina'].items : [];
      var eCons = eItems.reduce(function(s, a) { return s + (parseFloat(a.consumption) || 0); }, 0);
      var eAmount = byCat['Elektrina'] ? byCat['Elektrina'].amount : 0;
      var eRows = [];
      if (ec.mainCons > 0) {
        eRows.push([stripDia('Hlavný merač (budova)'), ec.mainCons.toFixed(2) + ' kWh']);
        if (ec.redirCons > 0) eRows.push([stripDia('  z toho kotolňa (vykurovanie)'), ec.redirCons.toFixed(2) + ' kWh']);
      }
      eRows.push([stripDia('Váš merač'), eCons.toFixed(2) + ' kWh']);
      if (eCons > 0 && eAmount > 0) eRows.push([stripDia('Jednotková cena'), (eAmount / eCons).toFixed(6) + ' EUR/kWh']);
      eRows.push([stripDia('Mesačný náklad'), fmtEur(eAmount / numMonths) + ' EUR']);
      eRows.push([{content: stripDia('Celkom'), styles: {fontStyle: 'bold'}}, {content: fmtEur(eAmount) + ' EUR', styles: {fontStyle: 'bold'}}]);
      detailSection('Elektrina', eRows);
    }

    // --- VYKUROVANIE ---
    if (hasHeat) {
      var heatAmount = byCat['Vykurovanie'].amount;

      // Collect heating composition (building-level expenses for this category)
      var heatingInputs = [];
      var heatingTotal = 0;
      periodAllocs.forEach(function(a) {
        if (!a.expenses || !a.expenses.cost_categories) return;
        if (a.expenses.cost_categories.name !== 'Vykurovanie') return;
        if (zoneIds.indexOf(a.zone_id) < 0) return;
        var desc = a.expenses.description || '';
        if (heatingInputs.some(function(h) { return h.expId === a.expenses.id; })) return;

        var fullAmount = parseFloat(a.expenses.amount) || 0;
        var isAmort = a.expenses.cost_type === 'amortized' && a.expenses.amort_years > 0;
        var yearlyAmount = isAmort ? fullAmount / a.expenses.amort_years : fullAmount;

        heatingInputs.push({
          expId: a.expenses.id,
          desc: desc,
          supplier: a.expenses.supplier || '',
          fullAmount: fullAmount,
          amount: yearlyAmount,
          isAuto: !!a.expenses.is_auto_generated,
          isAmort: isAmort,
          amortYears: a.expenses.amort_years || 0
        });
        heatingTotal += yearlyAmount;
      });

      // Group into 4 categories
      // Rule: amortized = always kurič (never media delivery)
      //       auto-generated = water or electricity from kotolňa
      //       SPP/plyn = gas delivery (only non-amortized)
      //       everything else = kurič
      var heatGroups = {
        plyn: { label: 'Plyn', amount: 0, items: [] },
        kuric: { label: 'Kuric, revizie a udrzba', amount: 0, items: [] },
        elektrina: { label: 'Elektrina', amount: 0, items: [] },
        voda: { label: 'Voda', amount: 0, items: [] }
      };

      heatingInputs.forEach(function(h) {
        var descLow = (h.desc + ' ' + h.supplier).toLowerCase();
        var group;
        if (h.isAmort) {
          // Amortized = always maintenance/repair, never media delivery
          group = 'kuric';
        } else if (h.isAuto && descLow.match(/vodomer|voda/)) {
          group = 'voda';
        } else if (h.isAuto && descLow.match(/elektromer|elektri/)) {
          group = 'elektrina';
        } else if (descLow.match(/spp|plyn|gas/) && !descLow.match(/gasenerg/)) {
          group = 'plyn';
        } else if (!h.isAuto && (descLow.match(/kuric|reviz|udrz|oprav|servis|cistenenie|komin/) || !descLow.match(/spp|plyn/))) {
          group = 'kuric';
        } else {
          group = 'kuric';
        }
        heatGroups[group].amount += h.amount;
        heatGroups[group].items.push(h);
      });

      // Add redirected amounts from other categories (water/electricity → heating)
      // Find from already-loaded periodAllocs: expenses with meter_redirected_consumption > 0
      var seenRedirected = {};
      periodAllocs.forEach(function(a) {
        if (!a.expenses) return;
        var e = a.expenses;
        if (seenRedirected[e.id]) return;
        var catName = e.cost_categories ? e.cost_categories.name : '';
        if (catName === 'Vykurovanie') return; // skip heating itself
        var mainCons = parseFloat(e.meter_main_consumption) || 0;
        var subCons = parseFloat(e.meter_sub_consumption) || 0;
        var redirCons = parseFloat(e.meter_redirected_consumption) || 0;
        if (redirCons <= 0) return;
        // For water: mainCons > 0, use it as denominator
        // For electricity (no main meter): use subCons + redirCons
        var denominator = mainCons > 0 ? mainCons : (subCons + redirCons);
        if (denominator <= 0) return;
        seenRedirected[e.id] = true;

        var redirAmount = parseFloat(((redirCons / denominator) * (parseFloat(e.amount) || 0)).toFixed(2));
        var group;
        if (catName.match(/[Vv]od|[Kk]anal/)) {
          group = 'voda';
        } else if (catName.match(/[Ee]lektr/)) {
          group = 'elektrina';
        } else {
          group = 'kuric';
        }
        heatGroups[group].amount += redirAmount;
        heatGroups[group].items.push({
          desc: (e.description || catName) + ' (kotolňa)',
          supplier: e.supplier || '',
          amount: redirAmount,
          isRedirected: true
        });
        heatingTotal += redirAmount;
      });
      // Also check redirectedExpenses query (for expenses not in tenant's allocs)
      redirectedExpenses.forEach(function(re) {
        if (seenRedirected[re.id]) return;
        var mainCons = parseFloat(re.meter_main_consumption) || 0;
        var subCons = parseFloat(re.meter_sub_consumption) || 0;
        var redirCons = parseFloat(re.meter_redirected_consumption) || 0;
        var reAmount = parseFloat(re.amount) || 0;
        if (redirCons <= 0) return;
        var denominator = mainCons > 0 ? mainCons : (subCons + redirCons);
        if (denominator <= 0) return;
        seenRedirected[re.id] = true;

        var redirAmount = parseFloat(((redirCons / denominator) * reAmount).toFixed(2));
        var catName = re.cost_categories ? re.cost_categories.name.toLowerCase() : '';
        var group;
        if (catName.match(/vod|kanal/)) group = 'voda';
        else if (catName.match(/elektr/)) group = 'elektrina';
        else group = 'kuric';
        heatGroups[group].amount += redirAmount;
        heatingTotal += redirAmount;
      });

      // Get total heated area from building zones
      // Occupied zones = full area, empty/owner zones = area * tempering%
      var totalHeatedArea = 0;
      allZones.forEach(function(z) {
        if (!z.is_active) return;
        var area = parseFloat(z.area_m2) || 0;
        var temp = parseFloat(z.tempering_pct) || 0;
        if (area === 0) return;
        if (z.tenant_id) {
          totalHeatedArea += area;
        } else if (temp > 0) {
          totalHeatedArea += area * temp / 100;
        }
      });

      var hRows = [];
      if (totalHeatedArea > 0) hRows.push([stripDia('Vykurovaná plocha budovy'), totalHeatedArea.toFixed(2) + ' m²']);

      // Show 4 groups
      hRows.push(['', '']); // spacer
      hRows.push([{content: stripDia('Náklady na vykurovanie budovy:'), styles: {fontStyle: 'bold'}}, '']);
      ['plyn', 'kuric', 'elektrina', 'voda'].forEach(function(key) {
        var g = heatGroups[key];
        if (g.amount > 0) {
          hRows.push([stripDia('  ' + g.label), fmtEur(g.amount) + ' EUR']);
        }
      });
      hRows.push([{content: stripDia('Celkom'), styles: {fontStyle: 'bold'}}, {content: fmtEur(heatingTotal) + ' EUR', styles: {fontStyle: 'bold'}}]);

      // Tenant's portion with percentage
      // heatAmount = direct Vykurovanie allocations to tenant zones
      // Redirected amounts (water/electricity for kotolňa) are building-level,
      // so tenant gets proportional share by area
      var redirectedTotal = 0;
      ['plyn', 'kuric', 'elektrina', 'voda'].forEach(function(key) {
        heatGroups[key].items.forEach(function(item) {
          if (item.isRedirected) redirectedTotal += item.amount;
        });
      });
      var tenantRedirShare = totalHeatedArea > 0 ? parseFloat((redirectedTotal * totalArea / totalHeatedArea).toFixed(2)) : 0;
      var heatAmountWithRedir = heatAmount + tenantRedirShare;

      hRows.push(['', '']); // spacer
      hRows.push([{content: stripDia('Váš podiel:'), styles: {fontStyle: 'bold'}}, '']);
      hRows.push([stripDia('Vaša plocha'), totalArea.toFixed(2) + ' m²']);
      var periodLabel = numMonths >= 12 ? 'rok' : numMonths + ' mes.';
      if (heatAmountWithRedir > 0 && totalArea > 0) {
        hRows.push([stripDia('Náklad na m² / ' + periodLabel), fmtEur(heatAmountWithRedir / totalArea) + ' EUR']);
        hRows.push([stripDia('Náklad na m² / mesiac'), fmtEur(heatAmountWithRedir / totalArea / numMonths) + ' EUR']);
      }
      hRows.push([stripDia('Mesačný náklad'), fmtEur(heatAmountWithRedir / numMonths) + ' EUR']);
      hRows.push([{content: stripDia('Celkom'), styles: {fontStyle: 'bold'}}, {content: fmtEur(heatAmountWithRedir) + ' EUR', styles: {fontStyle: 'bold'}}]);
      detailSection('Vykurovanie', hRows);
    }

    // --- EPS a PO ---
    if (hasEps) {
      var epsAmount = byCat['EPS a PO'].amount;
      // Get total protected area
      var totalProtectedArea = allZones.reduce(function(s, z) {
        if (!z.is_active) return s;
        return s + (parseFloat(z.area_m2) || 0);
      }, 0);

      var epsRows = [];
      if (totalProtectedArea > 0) epsRows.push([stripDia('Chránená plocha budovy'), totalProtectedArea.toFixed(2) + ' m²']);
      epsRows.push([stripDia('Vaša plocha'), totalArea.toFixed(2) + ' m²']);
      var epsPeriodLabel = numMonths >= 12 ? 'rok' : numMonths + ' mes.';
      if (epsAmount > 0 && totalArea > 0) {
        epsRows.push([stripDia('Náklad na m² / ' + epsPeriodLabel), fmtEur(epsAmount / totalArea) + ' EUR']);
        epsRows.push([stripDia('Náklad na m² / mesiac'), fmtEur(epsAmount / totalArea / numMonths) + ' EUR']);
      }
      epsRows.push([stripDia('Mesačný náklad'), fmtEur(epsAmount / numMonths) + ' EUR']);
      epsRows.push([{content: stripDia('Celkom'), styles: {fontStyle: 'bold'}}, {content: fmtEur(epsAmount) + ' EUR', styles: {fontStyle: 'bold'}}]);
      detailSection('EPS a PO', epsRows);
    }
  }


  // Save invoice to DB (if new)
  if (isNewInvoice) {
    await sb.from('invoices').insert({
      tenant_id: tenantId,
      invoice_number: invNumber,
      period_from: dateFrom,
      period_to: dateTo,
      total_costs: parseFloat(totalCosts.toFixed(2)),
      total_advances: parseFloat(paidAdvances.toFixed(2)),
      balance: parseFloat(balance.toFixed(2)),
      due_date: dueDateStr,
      status: 'draft'
    });

    await window.loadInvoices();
  }
  // Add page numbers and invoice number to all pages
  var totalPages = doc.internal.getNumberOfPages();
  for (var pi = 1; pi <= totalPages; pi++) {
    doc.setPage(pi);
    doc.setFontSize(7);
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(150);
    doc.text(pi + ' / ' + totalPages, W / 2, 290, { align: 'center' });
    // Invoice number on all pages
    doc.setFontSize(8);
    doc.text(stripDia('Číslo: ' + invNumber), W - M, 290, { align: 'right' });
    // Priestor on all pages (top right)
    if (pi > 1) {
      doc.setFontSize(9);
      doc.setFont('Roboto', 'normal');
      doc.setTextColor(100);
      doc.text(stripDia('Číslo: ' + invNumber), W - M, 20, { align: 'right' });
      doc.setFontSize(8);
      doc.text(stripDia('Priestor: ' + zoneLabel + ' - ' + totalArea.toFixed(2) + ' m²'), W - M, 25, { align: 'right' });
      doc.setTextColor(0);
    }
  }

  doc.setPage(1);
  doc.setFontSize(9);
  doc.setFont('Roboto', 'normal');
  doc.setTextColor(100);
  doc.text(stripDia('Číslo: ' + invNumber), W - M, 20, { align: 'right' });
  doc.setFontSize(8);
  doc.text(stripDia('Priestor: ' + zoneLabel + ' - ' + totalArea.toFixed(2) + ' m²'), W - M, 25, { align: 'right' });
  doc.setTextColor(0);

  // Save PDF
  var fileName = stripDia(invNumber + '_' + (tenant.company_name || tenant.name).replace(/[^a-zA-Z0-9]/g, '_') + '.pdf');
  doc.save(fileName);

  // Refresh list
  await window.loadInvoices();
};

// ============ EVIDENCIA VYÚČTOVANÍ ============

var invoiceStatuses = {
  'draft': { label: 'Koncept', cls: 'bg-slate-100 text-slate-500' },
  'sent': { label: 'Odoslané', cls: 'bg-blue-100 text-blue-600' },
  'paid': { label: 'Zaplatené', cls: 'bg-green-100 text-green-700' },
  'cancelled': { label: 'Zrušené', cls: 'bg-red-100 text-red-500' }
};

window.loadInvoices = async function() {
  var list = document.getElementById('fin-inv-list');
  if (!list) return;

  var { data: invoices = [] } = await sb.from('invoices')
    .select('*, tenants(name, company_name)')
    .order('created_at', { ascending: false });

  // Populate year filter
  var yearSel = document.getElementById('fin-inv-year');
  if (yearSel) {
    var years = {};
    invoices.forEach(function(inv) {
      if (inv.period_from) years[inv.period_from.substring(0, 4)] = true;
      if (inv.period_to) years[inv.period_to.substring(0, 4)] = true;
    });
    var currentVal = yearSel.value;
    var opts = '<option value="">Všetky roky</option>';
    Object.keys(years).sort().reverse().forEach(function(y) {
      opts += '<option value="' + y + '"' + (currentVal === y ? ' selected' : '') + '>' + y + '</option>';
    });
    yearSel.innerHTML = opts;
    if (currentVal) yearSel.value = currentVal;
  }

  // Filter by year
  var filterYear = yearSel ? yearSel.value : '';
  if (filterYear) {
    invoices = invoices.filter(function(inv) {
      return (inv.period_from && inv.period_from.substring(0, 4) === filterYear) ||
             (inv.period_to && inv.period_to.substring(0, 4) === filterYear);
    });
  }

  if (invoices.length === 0) {
    list.innerHTML = '<p class="text-sm text-slate-300 mt-3">Žiadne vyúčtovania</p>';
    return;
  }

  list.innerHTML = invoices.map(function(inv) {
    var tenantLabel = inv.tenants ? (inv.tenants.company_name || inv.tenants.name) : '';
    tenantLabel = tenantLabel.replace(/,?\s*(s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?)$/i, '').trim();
    var st = invoiceStatuses[inv.status] || invoiceStatuses['draft'];
    var balLabel = inv.balance > 0.01 ? 'Nedoplatok ' + fmtEur(inv.balance) + ' €'
      : inv.balance < -0.01 ? 'Preplatok ' + fmtEur(Math.abs(inv.balance)) + ' €'
      : 'Vyrovnané';
    var balCls = inv.balance > 0.01 ? 'text-red-500' : inv.balance < -0.01 ? 'text-green-600' : 'text-slate-400';

    return '<div class="flex items-center justify-between py-3 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 rounded-lg px-2 -mx-2" onclick="window.showInvoiceDetail(\'' + inv.id + '\')">' +
      '<div class="flex-1 min-w-0">' +
        '<span class="text-xs font-black text-slate-700">' + inv.invoice_number + '</span>' +
        ' <span class="text-[8px] font-bold px-2 py-0.5 rounded-full ' + st.cls + '">' + st.label + '</span>' +
        ' <span class="text-xs font-bold text-slate-500">' + tenantLabel + '</span>' +
        ' <span class="text-[9px] text-slate-400">' +
          fmtD(inv.period_from) + ' - ' + fmtD(inv.period_to) + ' • ' +
          '<span class="' + balCls + '">' + balLabel + '</span>' +
          (inv.due_date ? ' • Splat.: ' + fmtD(inv.due_date) : '') +
        '</span>' +
      '</div>' +
      '<i class="fa-solid fa-chevron-right text-slate-300 ml-3"></i>' +
    '</div>';
  }).join('');
};

window.changeInvoiceStatus = async function(id, newStatus) {
  var update = { status: newStatus };
  if (newStatus === 'sent') update.sent_date = new Date().toISOString().split('T')[0];
  if (newStatus === 'paid') update.paid_date = new Date().toISOString().split('T')[0];
  await sb.from('invoices').update(update).eq('id', id);
  await window.loadInvoices();
  if (currentInvoiceId === id) await window.showInvoiceDetail(id);
};

window.deleteInvoice = async function(id) {
  if (!confirm('Vymazať vyúčtovanie?')) return;
  await sb.from('invoices').delete().eq('id', id);
  await window.loadInvoices();
};

var currentInvoiceId = null;

window.showInvoiceDetail = async function(id) {
  var { data: inv } = await sb.from('invoices').select('*, tenants(name, company_name, ico, dic, ic_dph, address, city, zip)').eq('id', id).single();
  if (!inv) return;
  currentInvoiceId = id;

  var t = inv.tenants || {};
  var tenantLabel = t.company_name || t.name || '';
  var st = invoiceStatuses[inv.status] || invoiceStatuses['draft'];

  document.getElementById('inv-modal-title').innerText = inv.invoice_number;

  var balLabel, balCls;
  if (inv.balance > 0.01) { balLabel = 'Nedoplatok: ' + fmtEur(inv.balance) + ' €'; balCls = 'text-red-600'; }
  else if (inv.balance < -0.01) { balLabel = 'Preplatok: ' + fmtEur(Math.abs(inv.balance)) + ' €'; balCls = 'text-green-600'; }
  else { balLabel = 'Vyrovnané'; balCls = 'text-slate-500'; }

  var html = '' +
    '<div class="bg-slate-50 rounded-xl p-4 space-y-2">' +
      '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Nájomca</span><span class="font-bold">' + tenantLabel + '</span></div>' +
      (t.ico ? '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">IČO</span><span>' + t.ico + (t.dic ? ' • DIČ: ' + t.dic : '') + '</span></div>' : '') +
      (t.address ? '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Adresa</span><span>' + (t.address || '') + ', ' + (t.zip || '') + ' ' + (t.city || '') + '</span></div>' : '') +
      '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Obdobie</span><span>' + fmtD(inv.period_from) + ' - ' + fmtD(inv.period_to) + '</span></div>' +
    '</div>' +

    '<div class="bg-slate-50 rounded-xl p-4 space-y-2">' +
      '<div class="flex justify-between items-center"><span class="text-[9px] font-black text-slate-400 uppercase">Náklady</span><input type="number" step="0.01" id="inv-edit-costs" value="' + (inv.total_costs || 0) + '" onchange="window.recalcInvoiceBalance()" class="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold"></div>' +
      '<div class="flex justify-between items-center"><span class="text-[9px] font-black text-slate-400 uppercase">Zálohy zaplatené</span><input type="number" step="0.01" id="inv-edit-advances" value="' + (inv.total_advances || 0) + '" onchange="window.recalcInvoiceBalance()" class="w-28 text-right border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold"></div>' +
      '<div class="flex justify-between border-t border-slate-200 pt-2"><span class="text-[9px] font-black text-slate-400 uppercase">Výsledok</span><span id="inv-edit-balance" class="font-black text-base ' + balCls + '">' + balLabel + '</span></div>' +
      (inv.due_date ? '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Splatnosť</span><span>' + fmtD(inv.due_date) + '</span></div>' : '') +
    '</div>' +

    '<div class="flex items-center gap-3">' +
      '<label class="text-[9px] font-black text-slate-400 uppercase">Stav</label>' +
      '<select id="inv-detail-status" onchange="window.changeInvoiceStatus(\'' + id + '\', this.value)" class="border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold">' +
        Object.keys(invoiceStatuses).map(function(s) {
          return '<option value="' + s + '"' + (inv.status === s ? ' selected' : '') + '>' + invoiceStatuses[s].label + '</option>';
        }).join('') +
      '</select>' +
      '<span class="text-[8px] font-bold px-2 py-0.5 rounded-full ' + st.cls + '">' + st.label + '</span>' +
    '</div>' +

    (inv.sent_date ? '<p class="text-[9px] text-slate-400">Odoslané: ' + fmtD(inv.sent_date) + '</p>' : '') +
    (inv.paid_date ? '<p class="text-[9px] text-slate-400">Zaplatené: ' + fmtD(inv.paid_date) + '</p>' : '');

  document.getElementById('inv-modal-body').innerHTML = html;
  document.getElementById('modal-invoice').classList.remove('hidden');
};

window.closeInvoiceModal = function() {
  document.getElementById('modal-invoice').classList.add('hidden');
  currentInvoiceId = null;
};

window.recalcInvoiceBalance = function() {
  var costs = parseFloat(document.getElementById('inv-edit-costs').value) || 0;
  var advances = parseFloat(document.getElementById('inv-edit-advances').value) || 0;
  var balance = costs - advances;
  var el = document.getElementById('inv-edit-balance');
  if (balance > 0.01) { el.innerText = 'Nedoplatok: ' + fmtEur(balance) + ' €'; el.className = 'font-black text-base text-red-600'; }
  else if (balance < -0.01) { el.innerText = 'Preplatok: ' + fmtEur(Math.abs(balance)) + ' €'; el.className = 'font-black text-base text-green-600'; }
  else { el.innerText = 'Vyrovnané'; el.className = 'font-black text-base text-slate-500'; }
};

window.saveInvoiceAmounts = async function() {
  if (!currentInvoiceId) return;
  var costs = parseFloat(document.getElementById('inv-edit-costs').value) || 0;
  var advances = parseFloat(document.getElementById('inv-edit-advances').value) || 0;
  var balance = costs - advances;
  await sb.from('invoices').update({ total_costs: costs, total_advances: advances, balance: balance }).eq('id', currentInvoiceId);
  alert('Uložené.');
  await window.loadInvoices();
};

window.redownloadInvoiceFromModal = async function() {
  if (!currentInvoiceId) return;
  await window.redownloadInvoice(currentInvoiceId);
};

window.deleteInvoiceFromModal = async function() {
  if (!currentInvoiceId) return;
  if (!confirm('Vymazať vyúčtovanie?')) return;
  await sb.from('invoices').delete().eq('id', currentInvoiceId);
  window.closeInvoiceModal();
  await window.loadInvoices();
};

window.duplicateInvoice = async function() {
  if (!currentInvoiceId) return;
  var { data: orig } = await sb.from('invoices').select('*').eq('id', currentInvoiceId).single();
  if (!orig) return;

  var newNum = orig.invoice_number + '-KÓPIA';
  var copy = {
    tenant_id: orig.tenant_id,
    invoice_number: newNum,
    period_from: orig.period_from,
    period_to: orig.period_to,
    total_costs: orig.total_costs,
    total_advances: orig.total_advances,
    balance: orig.balance,
    due_date: orig.due_date,
    status: 'draft',
    created_by: currentUserId
  };

  var { data: inserted } = await sb.from('invoices').insert(copy).select('id').single();
  if (inserted) {
    window.closeInvoiceModal();
    await window.loadInvoices();
    await window.showInvoiceDetail(inserted.id);
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
    var isAdmin = currentRole === 'admin' || currentRole === 'ekonom' || currentRole === 'spravca';
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
  var nf = document.getElementById('n-fin'); if (nf) nf.classList.toggle('hidden', !['admin', 'ekonom'].includes(currentRole));
  var nfm = document.getElementById('n-fin-mob'); if (nfm) nfm.classList.toggle('hidden', !['admin', 'ekonom'].includes(currentRole));

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

// Thumbnail migration for issue_photos table
window.migrateThumbsIssuePhotos = async () => {
  const { data: rows, error } = await sb
    .from("issue_photos")
    .select("id, photo_url, photo_thumb_url")
    .not("photo_url", "is", null)
    .is("photo_thumb_url", null);

  if (error) { console.error(error); alert("DB error"); return; }
  if (!rows || rows.length === 0) { alert("Nič na migráciu v issue_photos"); return; }

  console.log("issue_photos na migráciu:", rows.length);

  for (const r of rows) {
    try {
      const base = `iphoto_${r.id}`;
      const thumbBlob = await makeThumbnailBlobFromUrl(r.photo_url, 420, 0.55);
      const thumbUrl = await uploadThumbBlob(thumbBlob, base);

      const { error: upErr } = await sb
        .from("issue_photos")
        .update({ photo_thumb_url: thumbUrl })
        .eq("id", r.id);

      if (upErr) throw upErr;
      console.log("OK issue_photos", r.id);
    } catch (e) {
      console.warn("FAIL issue_photos", r.id, e);
    }
  }

  alert("Migrácia issue_photos hotová.");
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
  
