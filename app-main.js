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
        '<p class="text-sm font-bold text-slate-800">' + (t.is_owner ? '👑 ' : '') + (t.company_name || t.name) + '</p>' +
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
    is_owner: document.getElementById('ten-is-owner').checked
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
  document.getElementById('ten-rent').value = t.monthly_rent || '';
  document.getElementById('ten-advance').value = t.monthly_advance || '';
  document.getElementById('ten-note').value = t.note || '';
  document.getElementById('ten-is-owner').checked = t.is_owner || false;

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

// ============ ZÁLOHY ============

var monthNames = ['Jan','Feb','Mar','Apr','Máj','Jún','Júl','Aug','Sep','Okt','Nov','Dec'];

window.loadPayments = async function() {
  var yearSel = document.getElementById('fin-pay-year');
  if (!yearSel) return;
  var year = yearSel.value || new Date().getFullYear();

  var { data: tenants = [] } = await sb.from('tenants').select('id, name, company_name, monthly_rent, monthly_advance').order('name');
  var { data: payments = [] } = await sb.from('tenant_payments').select('*')
    .gte('month', year + '-01-01').lte('month', year + '-12-01');

  var grid = document.getElementById('fin-payments-grid');
  if (!grid) return;

  if (tenants.length === 0) {
    grid.innerHTML = '<p class="text-sm text-slate-300">Najprv pridajte nájomcov</p>';
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
    if (t.monthly_advance > 0) types.push({ type: 'advance', label: 'Zálohy', cls: 'text-blue-500' });
    if (types.length === 0) return;

    // Tenant header
    html += '<tr class="border-t-2 border-slate-200"><td colspan="15" class="pt-3 pb-1 font-black text-slate-700">' + tLabel + '</td></tr>';

    types.forEach(function(tp) {
      var rowTotal = 0;
      html += '<tr class="border-b border-slate-50">' +
        '<td colspan="2" class="py-1 pl-4 text-[8px] font-bold ' + tp.cls + ' uppercase">' + tp.label + '</td>';

      for (var m = 0; m < 12; m++) {
        var monthStr = year + '-' + String(m + 1).padStart(2, '0') + '-01';
        var pay = payments.find(function(p) { return p.tenant_id === t.id && p.month === monthStr && (p.type || 'advance') === tp.type; });

        if (pay) {
          var unpaidCls = tp.type === 'rent' ? 'bg-indigo-50 text-indigo-400 hover:bg-indigo-100' : 'bg-blue-50 text-blue-400 hover:bg-blue-100';
          var paidCls = 'bg-green-100 text-green-700 hover:bg-green-200';
          var cls = pay.paid ? paidCls : unpaidCls;
          rowTotal += parseFloat(pay.amount) || 0;
          html += '<td class="text-center py-1"><div class="' + cls + ' rounded px-1 py-1 text-[8px] font-bold cursor-pointer pay-cell" ' +
            'data-pay-id="' + pay.id + '" data-pay-paid="' + pay.paid + '" data-pay-amount="' + pay.amount + '" ' +
            'title="Klik = zaplatené, Dvojklik = zmeniť sumu">' +
            parseFloat(pay.amount).toFixed(0) +
            (pay.paid ? ' ✓' : '') +
          '</div></td>';
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
    var amount = parseFloat(cell.getAttribute('data-pay-amount')) || 0;
    window.editPaymentAmount(id, amount, cell);
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
        if (t.lease_from && monthStr < t.lease_from.substring(0, 7) + '-01') return;
        if (t.lease_to && monthStr > t.lease_to.substring(0, 7) + '-01') return;

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

  var { data: existing = [] } = await sb.from('tenant_payments').select('tenant_id, month, type')
    .gte('month', year + '-01-01').lte('month', year + '-12-01');

  var existingKeys = {};
  existing.forEach(function(e) { existingKeys[e.tenant_id + '|' + e.month + '|' + (e.type || 'advance')] = true; });

  var newOnly = toInsert.filter(function(p) { return !existingKeys[p.tenant_id + '|' + p.month + '|' + p.type]; });

  if (newOnly.length === 0) {
    alert('Platby pre rok ' + year + ' už existujú.');
  } else {
    await sb.from('tenant_payments').insert(newOnly);
    alert('Vygenerovaných ' + newOnly.length + ' platieb.');
  }

  await window.loadPayments();
};

window.editPaymentAmount = function(payId, currentAmount, el) {
  var input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.value = currentAmount;
  input.className = 'w-full text-center text-[9px] font-bold border border-blue-400 rounded p-1 bg-white';
  input.style.maxWidth = '60px';

  var parent = el.parentNode;
  parent.innerHTML = '';
  parent.appendChild(input);
  input.focus();
  input.select();

  var save = async function() {
    var newVal = parseFloat(input.value);
    if (isNaN(newVal) || newVal < 0) newVal = currentAmount;
    await sb.from('tenant_payments').update({ amount: newVal }).eq('id', payId);
    await window.loadPayments();
  };

  input.onblur = save;
  input.onkeydown = function(e) {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { window.loadPayments(); }
  };
};

window.togglePayment = async function(payId, newPaid) {
  var update = { paid: newPaid };
  if (newPaid) {
    update.paid_date = new Date().toISOString().split('T')[0];
  } else {
    update.paid_date = null;
  }
  await sb.from('tenant_payments').update(update).eq('id', payId);
  await window.loadPayments();
};

// ============ VYÚČTOVANIE ============

// Strip Slovak diacritics for PDF (standard fonts don't support them)
function stripDia(s) {
  if (!s) return '';
  return s.replace(/[áÁ]/g, function(c) { return c === 'á' ? 'a' : 'A'; })
    .replace(/[äÄ]/g, function(c) { return c === 'ä' ? 'a' : 'A'; })
    .replace(/[čČ]/g, function(c) { return c === 'č' ? 'c' : 'C'; })
    .replace(/[ďĎ]/g, function(c) { return c === 'ď' ? 'd' : 'D'; })
    .replace(/[éÉ]/g, function(c) { return c === 'é' ? 'e' : 'E'; })
    .replace(/[íÍ]/g, function(c) { return c === 'í' ? 'i' : 'I'; })
    .replace(/[ľĽ]/g, function(c) { return c === 'ľ' ? 'l' : 'L'; })
    .replace(/[ňŇ]/g, function(c) { return c === 'ň' ? 'n' : 'N'; })
    .replace(/[óÓ]/g, function(c) { return c === 'ó' ? 'o' : 'O'; })
    .replace(/[ôÔ]/g, function(c) { return c === 'ô' ? 'o' : 'O'; })
    .replace(/[ŕŔ]/g, function(c) { return c === 'ŕ' ? 'r' : 'R'; })
    .replace(/[šŠ]/g, function(c) { return c === 'š' ? 's' : 'S'; })
    .replace(/[ťŤ]/g, function(c) { return c === 'ť' ? 't' : 'T'; })
    .replace(/[úÚ]/g, function(c) { return c === 'ú' ? 'u' : 'U'; })
    .replace(/[ýÝ]/g, function(c) { return c === 'ý' ? 'y' : 'Y'; })
    .replace(/[žŽ]/g, function(c) { return c === 'ž' ? 'z' : 'Z'; });
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

  // Load zones for this tenant
  var { data: tenantZones = [] } = await sb.from('zones').select('id, name, tenant_name, area_m2').eq('tenant_id', tenantId);
  var zoneIds = tenantZones.map(function(z) { return z.id; });
  var totalArea = tenantZones.reduce(function(s, z) { return s + (parseFloat(z.area_m2) || 0); }, 0);
  var zoneLabel = tenantZones.map(function(z) { return z.name; }).join(', ');

  // Load allocations for this tenant's zones in period
  var { data: allocs = [] } = await sb.from('expense_allocations')
    .select('amount, percentage, payer, zone_id, consumption, consumption_unit, expenses(id, amount, date, period_from, period_to, supplier, invoice_number, cost_categories(name))')
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

  // Generate PDF
  var { jsPDF } = window.jspdf;
  var doc = new jsPDF('p', 'mm', 'a4');
  var W = 210, M = 20, y = 20;

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(stripDia('VYUCTOVANIE NAKLADOV'), M, y);
  y += 7;
  doc.setFontSize(11);
  doc.text(stripDia('za obdobie ' + periodLabel), M, y);
  y += 5;

  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 8;

  // Landlord info
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(stripDia('Prenajimatel:'), M, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(stripDia('Ing. Vladimir Zila, Ing. Zuzana Zilova'), M, y);
  y += 4;
  doc.text(stripDia('Panska 17, 811 01 Bratislava'), M, y);
  y += 4;
  doc.text('IBAN: SK23 1100 0000 0026 2084 4545', M, y);
  y += 8;

  // Tenant info
  doc.setFont('helvetica', 'bold');
  doc.text(stripDia('Najomca:'), M, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(stripDia(tenant.company_name || tenant.name), M, y);
  y += 4;

  if (tenant.ico) {
    doc.text(stripDia('ICO: ' + tenant.ico + (tenant.dic ? '   DIC: ' + tenant.dic : '') + (tenant.ic_dph ? '   IC DPH: ' + tenant.ic_dph : '')), M, y);
    y += 4;
  }
  if (tenant.address) {
    doc.text(stripDia((tenant.address || '') + ', ' + (tenant.zip || '') + ' ' + (tenant.city || '')), M, y);
    y += 4;
  }

  y += 3;
  doc.text(stripDia('Priestor: ' + zoneLabel + ' - ' + totalArea + ' m2'), M, y);
  y += 8;

  // Costs table
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(stripDia('NAKLADY'), M, y);
  y += 3;

  var costRows = catNames.map(function(c) {
    var avgPct = byCat[c].items.length > 0
      ? (byCat[c].items.reduce(function(s, a) { return s + (parseFloat(a.percentage) || 0); }, 0) / byCat[c].items.length)
      : 0;
    // Sum consumption if available
    var totalCons = byCat[c].items.reduce(function(s, a) { return s + (parseFloat(a.consumption) || 0); }, 0);
    var consUnit = byCat[c].items[0] && byCat[c].items[0].consumption_unit ? byCat[c].items[0].consumption_unit : '';
    var consLabel = totalCons > 0 ? totalCons.toFixed(2) + ' ' + consUnit : '';
    return [stripDia(c), consLabel, avgPct.toFixed(1) + ' %', fmtEur(byCat[c].amount) + ' EUR'];
  });

  costRows.push([
    { content: stripDia('NAKLADY SPOLU'), styles: { fontStyle: 'bold' } },
    '', '',
    { content: fmtEur(totalCosts) + ' EUR', styles: { fontStyle: 'bold' } }
  ]);

  doc.autoTable({
    startY: y,
    margin: { left: M, right: M },
    head: [[stripDia('Polozka'), stripDia('Spotreba'), stripDia('Podiel'), 'Suma']],
    body: costRows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 25, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' }
    }
  });

  y = doc.lastAutoTable.finalY + 8;

  // Advances table
  if (payments.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(stripDia('ZALOHY'), M, y);
    y += 3;

    var advRows = payments.map(function(p) {
      var mDate = new Date(p.month + 'T00:00:00');
      var mLabel = String(mDate.getMonth() + 1).padStart(2, '0') + '/' + mDate.getFullYear();
      return [
        mLabel,
        fmtEur(p.amount) + ' EUR',
        p.paid ? (stripDia('Zaplatene') + (p.paid_date ? ' ' + fmtD(p.paid_date) : '')) : stripDia('Nezaplatene')
      ];
    });

    advRows.push([
      { content: stripDia('ZALOHY SPOLU'), styles: { fontStyle: 'bold' } },
      { content: fmtEur(paidAdvances) + ' EUR', styles: { fontStyle: 'bold' } },
      ''
    ]);

    doc.autoTable({
      startY: y,
      margin: { left: M, right: M },
      head: [[stripDia('Mesiac'), 'Suma', stripDia('Stav')]],
      body: advRows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fontStyle: 'bold', fillColor: [240, 240, 240] },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 40, halign: 'right' },
        2: { cellWidth: 60 }
      }
    });

    y = doc.lastAutoTable.finalY + 10;
  }

  // Result
  doc.setDrawColor(0);
  doc.setLineWidth(0.8);
  doc.line(M, y, W - M, y);
  y += 8;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  if (balance > 0.01) {
    doc.text(stripDia('NEDOPLATOK:  ' + fmtEur(balance) + ' EUR'), M, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(stripDia('Splatnost: ' + fmtD(dueDateStr)), M, y);
    y += 5;
    doc.text('IBAN: SK23 1100 0000 0026 2084 4545', M, y);
    y += 5;
    doc.text('VS: ' + yearLabel + '001', M, y);
  } else if (balance < -0.01) {
    doc.text(stripDia('PREPLATOK:  ' + fmtEur(Math.abs(balance)) + ' EUR'), M, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(stripDia('Preplatok bude vrateny na ucet najomcu.'), M, y);
  } else {
    doc.text(stripDia('VYROVNANE'), M, y);
  }

  // Footer
  y += 15;
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(stripDia('Vyuctovanie vygenerovane ' + new Date().toLocaleDateString('sk-SK')), M, y);

  // Invoice number and DB save
  var invNumber;
  var dueDateStr;

  if (existingInvoice) {
    // Re-download: use existing number, don't save
    invNumber = existingInvoice.invoice_number;
    dueDateStr = existingInvoice.due_date;
  } else {
    // New: generate number and save
    var { data: existingInv = [] } = await sb.from('invoices').select('invoice_number')
      .like('invoice_number', 'VYUCT-' + yearLabel + '-%');
    var nextNum = existingInv.length + 1;
    invNumber = 'VYUCT-' + yearLabel + '-' + String(nextNum).padStart(3, '0');

    var dueDateObj = new Date();
    dueDateObj.setDate(dueDateObj.getDate() + 15);
    dueDateStr = dueDateObj.toISOString().split('T')[0];

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
  doc.setPage(1);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(stripDia('Cislo: ' + invNumber), W - M, 20, { align: 'right' });
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
      '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Náklady</span><span class="font-bold">' + fmtEur(inv.total_costs) + ' €</span></div>' +
      '<div class="flex justify-between"><span class="text-[9px] font-black text-slate-400 uppercase">Zálohy zaplatené</span><span class="font-bold">' + fmtEur(inv.total_advances) + ' €</span></div>' +
      '<div class="flex justify-between border-t border-slate-200 pt-2"><span class="text-[9px] font-black text-slate-400 uppercase">Výsledok</span><span class="font-black text-base ' + balCls + '">' + balLabel + '</span></div>' +
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
  
