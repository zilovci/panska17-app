// ============================================
// PANSKÁ 17 - FINANCIE
// Merače, náklady, alokácie, účtenky, AI extrakcia
// ============================================

async function loadFinance() {
  // Load categories
  var { data: cats = [] } = await sb.from('cost_categories').select('*').order('sort_order', { ascending: true });
  allCategories = cats;

  // Zones grid - metraže
  var zonesGrid = document.getElementById('fin-zones-grid');
  if (zonesGrid) {
    zonesGrid.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory'; }).map(function(z) {
      var label = z.tenant_name || z.name;
      var temper = z.tempering_pct || 0;
      return '<div class="bg-slate-50 rounded-xl px-3 py-2">' +
        '<div class="flex items-center space-x-2">' +
          '<span class="text-[9px] font-bold text-slate-600 flex-1 truncate">' + label + '</span>' +
          '<input type="number" step="0.01" value="' + (z.area_m2 || 0) + '" data-zone-id="' + z.id + '" class="zone-area-input w-14 text-right border border-slate-200 rounded-lg px-1 py-1 text-[10px] font-bold">' +
          '<span class="text-[8px] text-slate-400">m²</span>' +
        '</div>' +
        '<div class="flex items-center space-x-1 mt-1">' +
          '<span class="text-[8px] text-slate-400">Prikurovanie ak prázdna</span>' +
          '<input type="number" step="1" min="0" max="100" value="' + temper + '" data-temper-zone="' + z.id + '" class="zone-temper-input w-10 text-right border border-slate-200 rounded px-1 py-0.5 text-[9px] font-bold">' +
          '<span class="text-[8px] text-slate-400">%</span>' +
        '</div>' +
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

  // Category dropdown in modal - with preset loading
  var expCat = document.getElementById('exp-category');
  if (expCat) {
    expCat.innerHTML = cats.map(function(c) {
      return '<option value="' + c.id + '" data-method="' + (c.allocation_method || 'area') + '">' + c.name + '</option>';
    }).join('');
    expCat.onchange = function() { window.loadCategoryPreset(this.value); window.updateAllocPreview(); };
  }

  // Zone checkboxes
  var zoneChecks = document.getElementById('exp-zone-checks');
  if (zoneChecks) {
    zoneChecks.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
      var label = z.tenant_name || z.name;
      return '<div class="flex items-center space-x-1.5 bg-white rounded-lg px-2 py-1.5">' +
        '<input type="checkbox" value="' + z.id + '" data-area="' + (z.area_m2 || 0) + '" data-temper="' + (z.tempering_pct || 0) + '" class="alloc-zone-cb rounded" onchange="window.updateAllocPreview()">' +
        '<span class="text-[9px] font-bold text-slate-600 truncate flex-1">' + label + '</span>' +
        '<select data-payer-zone="' + z.id + '" class="alloc-payer-sel text-[8px] border border-slate-200 rounded px-1 py-0.5 hidden" onchange="window.updateAllocPreview()">' +
          '<option value="tenant">nájomca</option>' +
          '<option value="owner">vlastník</option>' +
        '</select>' +
      '</div>';
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

  // Overview year dropdown
  var ovYearSel = document.getElementById('fin-overview-year');
  if (ovYearSel && ovYearSel.options.length === 0) {
    var curYear2 = new Date().getFullYear();
    for (var y2 = curYear2; y2 >= 2020; y2--) {
      ovYearSel.innerHTML += '<option value="' + y2 + '">' + y2 + '</option>';
    }
  }

  // Payment year dropdown
  var payYearSel = document.getElementById('fin-pay-year');
  if (payYearSel && payYearSel.options.length === 0) {
    var curYear3 = new Date().getFullYear();
    for (var y3 = curYear3; y3 >= 2020; y3--) {
      payYearSel.innerHTML += '<option value="' + y3 + '">' + y3 + '</option>';
    }
  }

  // Invoice date defaults (current year)
  var invFrom = document.getElementById('fin-inv-from');
  var invTo = document.getElementById('fin-inv-to');
  if (invFrom && !invFrom.value) invFrom.value = new Date().getFullYear() + '-01-01';
  if (invTo && !invTo.value) invTo.value = new Date().getFullYear() + '-12-31';

  // Invoice tenant dropdown
  var invTenSel = document.getElementById('fin-inv-tenant');
  if (invTenSel) {
    var { data: invTenants = [] } = await sb.from('tenants').select('id, name, company_name').order('name');
    invTenSel.innerHTML = '<option value="">-- Vyberte nájomcu --</option>' +
      invTenants.map(function(t) {
        var label = t.company_name || t.name;
        return '<option value="' + t.id + '">' + label + '</option>';
      }).join('');
  }

  // Set default date
  var expDate = document.getElementById('exp-date');
  if (expDate && !expDate.value) expDate.value = new Date().toISOString().split('T')[0];

  await loadMeters();
  await loadExpenses();
  await window.loadTenants();
  await window.loadPayments();
  await window.loadInvoices();
  await window.loadOverview();
}

// ---- MERAČE ----
var allMeters = [];
var editingMeterId = null;
var currentReadingMeterId = null;

async function loadMeters() {
  var { data: meters = [] } = await sb.from('meters').select('*, zones(name, tenant_name)').order('sort_order', { ascending: true });
  allMeters = meters;

  var { data: readings = [] } = await sb.from('meter_readings').select('*').order('date', { ascending: false });

  // Load meter-zone assignments
  var { data: mzAll = [] } = await sb.from('meter_zones').select('meter_id, zone_id, zones(name, tenant_name)');
  var mzByMeter = {};
  mzAll.forEach(function(mz) {
    if (!mzByMeter[mz.meter_id]) mzByMeter[mz.meter_id] = [];
    mzByMeter[mz.meter_id].push(mz);
  });

  // Zone checkboxes in meter modal
  var mtrZones = document.getElementById('mtr-zones');
  if (mtrZones) {
    mtrZones.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
      return '<label class="flex items-center space-x-1.5 bg-slate-50 rounded-lg px-2 py-1.5 cursor-pointer hover:bg-blue-50">' +
        '<input type="checkbox" value="' + z.id + '" class="mtr-zone-cb rounded">' +
        '<span class="text-[9px] font-bold text-slate-600">' + (z.tenant_name || z.name) + '</span>' +
      '</label>';
    }).join('');
  }

  // Parent meter dropdown
  var mtrParent = document.getElementById('mtr-parent');
  if (mtrParent) {
    mtrParent.innerHTML = '<option value="">— žiadny —</option>' +
      meters.filter(function(m) { return m.is_main; }).map(function(m) {
        return '<option value="' + m.id + '">' + m.name + '</option>';
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
    var mZones = mzByMeter[m.id] || [];
    var zoneName = mZones.length > 0
      ? mZones.map(function(mz) { return mz.zones ? (mz.zones.tenant_name || mz.zones.name) : ''; }).join(', ')
      : (m.zones ? (m.zones.tenant_name || m.zones.name) : 'Celá budova');
    var meterReadings = readings.filter(function(r) { return r.meter_id === m.id; });
    var last = meterReadings.length > 0 ? meterReadings[0] : null;
    var prev = meterReadings.length > 1 ? meterReadings[1] : null;
    var consumption = (last && prev) ? (parseFloat(last.value) - parseFloat(prev.value)).toFixed(2) : null;
    var badges = (m.is_main ? '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600">HLAVNÝ</span> ' : '') +
      (m.parent_meter_id ? '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">SUB</span> ' : '');

    return '<div class="bg-slate-50 rounded-xl p-4">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<div class="flex items-center space-x-2 flex-wrap">' +
          '<i class="fa-solid ' + (typeIcons[m.type] || 'fa-gauge') + ' ' + (typeColors[m.type] || '') + '"></i>' +
          '<span class="text-xs font-bold text-slate-800">' + m.name + '</span>' +
          badges +
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
            (prevR ? '<span class="text-slate-300">pred: ' + parseFloat(prevR.value).toFixed(2) + '</span>' : '<span class="text-slate-300">--</span>') +
            '<span class="text-green-600 font-bold">' + (cons !== '--' ? '+' + cons : '--') + '</span>' +
            '<button onclick="window.editReading(\'' + r.id + '\', \'' + m.id + '\')" class="text-slate-300 hover:text-blue-500"><i class="fa-solid fa-pen"></i></button>' +
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
  document.querySelectorAll('.mtr-zone-cb').forEach(function(cb) { cb.checked = false; });
  document.getElementById('mtr-is-main').checked = false;
  document.getElementById('mtr-parent').value = '';
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
  document.getElementById('mtr-is-main').checked = m.is_main || false;
  document.getElementById('mtr-parent').value = m.parent_meter_id || '';
  document.getElementById('mtr-number').value = m.meter_number || '';
  document.getElementById('mtr-note').value = m.note || '';

  // Load zone assignments
  var { data: mzList = [] } = await sb.from('meter_zones').select('zone_id').eq('meter_id', id);
  var assignedZones = mzList.map(function(mz) { return mz.zone_id; });
  document.querySelectorAll('.mtr-zone-cb').forEach(function(cb) {
    cb.checked = assignedZones.indexOf(cb.value) >= 0;
  });

  document.getElementById('modal-meter').classList.remove('hidden');
};

window.saveMeter = async function() {
  var unitMap = { water: 'm³', electricity: 'kWh', gas: 'm³' };
  var type = document.getElementById('mtr-type').value;
  var data = {
    name: document.getElementById('mtr-name').value.trim(),
    type: type,
    unit: unitMap[type] || 'm³',
    is_main: document.getElementById('mtr-is-main').checked,
    parent_meter_id: document.getElementById('mtr-parent').value || null,
    meter_number: document.getElementById('mtr-number').value.trim() || null,
    note: document.getElementById('mtr-note').value.trim() || null
  };
  if (!data.name) { alert('Vyplňte názov.'); return; }

  var meterId;
  if (editingMeterId) {
    await sb.from('meters').update(data).eq('id', editingMeterId);
    meterId = editingMeterId;
  } else {
    var { data: inserted } = await sb.from('meters').insert(data).select('id').single();
    meterId = inserted.id;
  }

  // Save zone assignments
  await sb.from('meter_zones').delete().eq('meter_id', meterId);
  var selectedZones = [];
  document.querySelectorAll('.mtr-zone-cb:checked').forEach(function(cb) {
    selectedZones.push({ meter_id: meterId, zone_id: cb.value });
  });
  if (selectedZones.length > 0) {
    await sb.from('meter_zones').insert(selectedZones);
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
  editingReadingId = null;
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

var editingReadingId = null;

window.editReading = async function(readingId, meterId) {
  var { data: r } = await sb.from('meter_readings').select('*').eq('id', readingId).single();
  if (!r) return;

  currentReadingMeterId = meterId;
  editingReadingId = readingId;
  var meter = allMeters.find(function(m) { return m.id === meterId; });
  document.getElementById('reading-meter-name').innerText = (meter ? meter.name : '') + ' – úprava';
  document.getElementById('rdg-date').value = r.date;
  document.getElementById('rdg-value').value = r.value;
  document.getElementById('rdg-note').value = r.note || '';

  // Show previous reading before this one
  var { data: prev = [] } = await sb.from('meter_readings').select('*').eq('meter_id', meterId).lt('date', r.date).order('date', { ascending: false }).limit(1);
  // If no earlier by date, try by created_at
  if (prev.length === 0) {
    var { data: prev2 = [] } = await sb.from('meter_readings').select('*').eq('meter_id', meterId).neq('id', readingId).order('date', { ascending: false }).limit(1);
    prev = prev2.filter(function(p) { return p.date <= r.date && p.id !== readingId; });
  }
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
  if (!data.value && data.value !== 0) { alert('Zadajte stav merača.'); return; }

  if (editingReadingId) {
    await sb.from('meter_readings').update({ date: data.date, value: data.value, note: data.note }).eq('id', editingReadingId);
    editingReadingId = null;
  } else {
    await sb.from('meter_readings').insert(data);
  }

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
  var dateMode = document.getElementById('fin-date-mode').value;

  var query = sb.from('expenses').select('*, cost_categories(name), zones(name, tenant_name), expense_allocations(zone_id, percentage, amount, payer, zones(name, tenant_name))');

  if (dateMode === 'period') {
    // Obdobie sa prekrýva s rokom: period_from <= koniec roka AND period_to >= začiatok roka
    query = query.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
  } else {
    query = query.gte('date', year + '-01-01').lte('date', year + '-12-31');
  }

  query = query.order('date', { ascending: false });

  if (catFilter !== 'all') query = query.eq('category_id', catFilter);

  var result = await query;
  var expenses = result.data || [];

  // Fallback if allocations table missing
  if (result.error) {
    console.warn('Expenses query error, trying without allocations:', result.error);
    var q2 = sb.from('expenses').select('*, cost_categories(name), zones(name, tenant_name)');
    if (dateMode === 'period') {
      q2 = q2.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    } else {
      q2 = q2.gte('date', year + '-01-01').lte('date', year + '-12-31');
    }
    q2 = q2.order('date', { ascending: false });
    if (catFilter !== 'all') q2 = q2.eq('category_id', catFilter);
    var r2 = await q2;
    expenses = r2.data || [];
  }

  var list = document.getElementById('fin-expenses-list');
  if (expenses.length === 0) {
    list.innerHTML = '<p class="text-center py-8 text-[10px] text-slate-200 font-bold uppercase">Žiadne náklady</p>';
    document.getElementById('fin-total-amount').innerText = '0 €';
    return;
  }

  var total = 0;
  list.innerHTML = '<div class="space-y-2">' + expenses.map(function(e) {
    total += parseFloat(e.amount) || 0;
    var zoneName = '';
    var allocCount = e.expense_allocations ? e.expense_allocations.length : 0;
    if (allocCount > 0) {
      var tenantCount = e.expense_allocations.filter(function(a) { return a.payer !== 'owner'; }).length;
      var ownerCount = allocCount - tenantCount;
      zoneName = tenantCount + ' nájom.' + (ownerCount > 0 ? ' + ' + ownerCount + ' vlast.' : '');
    } else if (e.zones) {
      zoneName = e.zones.tenant_name || e.zones.name;
    } else {
      zoneName = 'Celá budova';
    }
    var catName = e.cost_categories ? e.cost_categories.name : '--';
    return '<div class="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center space-x-2">' +
          '<span class="text-[8px] font-black text-slate-400 uppercase">' + fmtD(e.date) + '</span>' +
          '<span class="text-[8px] font-bold text-blue-500 uppercase">' + catName + '</span>' +
          '<span class="text-[8px] text-slate-300">' + zoneName + '</span>' +
        '</div>' +
        '<p class="text-xs font-bold text-slate-700 truncate">' + e.description + '</p>' +
        (e.supplier ? '<p class="text-[8px] text-slate-400">' + e.supplier + (e.invoice_number ? ' • ' + e.invoice_number : '') + (e.period_from ? ' • ' + fmtD(e.period_from) + ' – ' + fmtD(e.period_to) : '') + '</p>' : (e.period_from ? '<p class="text-[8px] text-slate-400">' + fmtD(e.period_from) + ' – ' + fmtD(e.period_to) + '</p>' : '')) +
      '</div>' +
      '<div class="flex items-center space-x-3 ml-3">' +
        (e.receipt_url ? (e.receipt_url.match(/\.pdf$/i) ?
          '<a href="' + e.receipt_url + '" target="_blank" class="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center border border-red-200 hover:border-red-400 cursor-pointer shrink-0"><i class="fa-solid fa-file-pdf text-red-500"></i></a>' :
          '<img src="' + e.receipt_url + '" onclick="window.open(\'' + e.receipt_url + '\')" class="w-10 h-10 object-cover rounded-lg cursor-pointer border border-slate-200 hover:border-blue-400 shrink-0">') : '') +
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
    var temperInput = document.querySelector('[data-temper-zone="' + zoneId + '"]');
    var temperPct = temperInput ? (parseFloat(temperInput.value) || 0) : 0;
    await sb.from('zones').update({ area_m2: area, tempering_pct: temperPct }).eq('id', zoneId);
  }
  for (var j = 0; j < allZones.length; j++) {
    var inp = document.querySelector('[data-zone-id="' + allZones[j].id + '"]');
    if (inp) allZones[j].area_m2 = parseFloat(inp.value) || 0;
    var tmp = document.querySelector('[data-temper-zone="' + allZones[j].id + '"]');
    if (tmp) allZones[j].tempering_pct = parseFloat(tmp.value) || 0;
  }
  alert('Uložené.');
};

window.showAddExpense = function() {
  editingExpenseId = null;
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-supplier').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-invoice').value = '';
  document.getElementById('exp-period-from').value = '';
  document.getElementById('exp-period-to').value = '';
  document.getElementById('exp-note').value = '';
  document.getElementById('exp-receipt').value = '';
  document.getElementById('exp-receipt-preview').classList.add('hidden');
  document.getElementById('btn-ai-extract').classList.add('hidden');
  var status = document.getElementById('ai-extract-status');
  status.classList.add('hidden');
  status.className = status.className.replace('text-green-600', 'text-blue-500').replace('text-red-500', 'text-blue-500');
  // Reset checkboxes, payer selectors, and load preset for first category
  window.clearAllocChecks();
  var payerSels = document.querySelectorAll('.alloc-payer-sel');
  for (var p = 0; p < payerSels.length; p++) { payerSels[p].value = 'tenant'; payerSels[p].classList.add('hidden'); }
  var catSel = document.getElementById('exp-category');
  if (catSel && catSel.value) window.loadCategoryPreset(catSel.value);
  document.getElementById('modal-expense').classList.remove('hidden');
};

window.closeExpenseModal = function() {
  document.getElementById('modal-expense').classList.add('hidden');
};

// Allocation helpers
window.clearAllocChecks = function() {
  var cbs = document.querySelectorAll('.alloc-zone-cb');
  for (var i = 0; i < cbs.length; i++) cbs[i].checked = false;
  document.getElementById('exp-alloc-preview').classList.add('hidden');
  currentAllocMethod = 'area';
  window._meterAllocations = null;
  document.getElementById('alloc-area-section').classList.remove('hidden');
  document.getElementById('alloc-meter-section').classList.add('hidden');
  document.getElementById('alloc-method-area').className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-900 text-white';
  document.getElementById('alloc-method-meter').className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-200 text-slate-500';
};

window.allocSelectAll = function(check) {
  var cbs = document.querySelectorAll('.alloc-zone-cb');
  for (var i = 0; i < cbs.length; i++) cbs[i].checked = check;
  window.updateAllocPreview();
};

window.loadCategoryPreset = async function(catId) {
  var { data: presets = [] } = await sb.from('category_zone_presets').select('zone_id, payer').eq('category_id', catId);
  var presetMap = {};
  presets.forEach(function(p) { presetMap[p.zone_id] = p.payer || 'tenant'; });
  var cbs = document.querySelectorAll('.alloc-zone-cb');
  for (var i = 0; i < cbs.length; i++) {
    var isPreset = presetMap.hasOwnProperty(cbs[i].value);
    cbs[i].checked = isPreset;
    var payerSel = document.querySelector('[data-payer-zone="' + cbs[i].value + '"]');
    if (payerSel) {
      payerSel.classList.toggle('hidden', !isPreset);
      if (isPreset) payerSel.value = presetMap[cbs[i].value];
    }
  }
  window.updateAllocPreview();
};

window.saveCategoryPreset = async function(catId, zones) {
  await sb.from('category_zone_presets').delete().eq('category_id', catId);
  if (zones.length > 0) {
    var rows = zones.map(function(z) { return { category_id: catId, zone_id: z.id, payer: z.payer || 'tenant' }; });
    await sb.from('category_zone_presets').insert(rows);
  }
};

window.getSelectedAllocZones = function() {
  var cbs = document.querySelectorAll('.alloc-zone-cb:checked');
  var zones = [];
  for (var i = 0; i < cbs.length; i++) {
    zones.push({ id: cbs[i].value, area: parseFloat(cbs[i].getAttribute('data-area')) || 0 });
  }
  return zones;
};

window.updateAllocPreview = function() {
  // Show/hide payer selectors based on checked state
  var allCbs = document.querySelectorAll('.alloc-zone-cb');
  for (var k = 0; k < allCbs.length; k++) {
    var payerSel = document.querySelector('[data-payer-zone="' + allCbs[k].value + '"]');
    if (payerSel) payerSel.classList.toggle('hidden', !allCbs[k].checked);
  }

  var checkedZones = window.getSelectedAllocZones();
  var preview = document.getElementById('exp-alloc-preview');
  var rows = document.getElementById('exp-alloc-rows');
  var amount = parseFloat(document.getElementById('exp-amount').value) || 0;

  if (checkedZones.length === 0 && amount === 0) {
    preview.classList.add('hidden');
    return;
  }

  // Get payer per zone
  checkedZones.forEach(function(z) {
    var sel = document.querySelector('[data-payer-zone="' + z.id + '"]');
    z.payer = sel ? sel.value : 'tenant';
  });

  // Tempering only for Vykurovanie
  var catSel = document.getElementById('exp-category');
  var selectedCatName = catSel ? catSel.options[catSel.selectedIndex].text : '';
  var isHeating = selectedCatName === 'Vykurovanie';

  var temperedZones = [];
  if (isHeating) {
    for (var i = 0; i < allCbs.length; i++) {
      if (!allCbs[i].checked) {
        var temper = parseFloat(allCbs[i].getAttribute('data-temper')) || 0;
        if (temper > 0) {
          var area = parseFloat(allCbs[i].getAttribute('data-area')) || 0;
          temperedZones.push({ id: allCbs[i].value, area: area, temper: temper, effectiveArea: area * temper / 100 });
        }
      }
    }
  }

  var activeArea = checkedZones.reduce(function(s, z) { return s + z.area; }, 0);
  var temperedArea = temperedZones.reduce(function(s, z) { return s + z.effectiveArea; }, 0);
  var totalArea = activeArea + temperedArea;

  // Split into tenant and owner
  var tenantZones = checkedZones.filter(function(z) { return z.payer === 'tenant'; });
  var ownerZones = checkedZones.filter(function(z) { return z.payer === 'owner'; });

  var html = '';

  // Tenant zones
  if (tenantZones.length > 0) {
    html += '<p class="text-[8px] font-black text-green-600 uppercase mb-1">Nájomca platí</p>';
    var tenantTotal = 0;
    html += tenantZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var pct = totalArea > 0 ? (z.area / totalArea * 100) : 0;
      var amt = amount * pct / 100;
      tenantTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-white rounded-lg px-2 py-1">' +
        '<span class="font-bold text-slate-600 truncate flex-1">' + label + '</span>' +
        '<span class="text-slate-400 w-12 text-right">' + z.area + ' m²</span>' +
        '<span class="font-bold text-blue-600 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-slate-800 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');
    html += '<div class="flex justify-between text-[9px] font-black text-green-700 px-2 pt-1">' +
      '<span>Nájomcovia spolu</span><span>' + tenantTotal.toFixed(2) + ' €</span></div>';
  }

  // Owner zones (from checkboxes)
  if (ownerZones.length > 0 || temperedZones.length > 0) {
    html += '<div class="border-t border-orange-200 mt-2 pt-2">' +
      '<p class="text-[8px] font-black text-orange-500 uppercase mb-1">Vlastník platí</p>';
    var ownerTotal = 0;

    html += ownerZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var pct = totalArea > 0 ? (z.area / totalArea * 100) : 0;
      var amt = amount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + '</span>' +
        '<span class="text-orange-400 w-12 text-right">' + z.area + ' m²</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');

    // Tempered (heating only)
    html += temperedZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var pct = totalArea > 0 ? (z.effectiveArea / totalArea * 100) : 0;
      var amt = amount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + ' (kúrenie ' + z.temper + '%)</span>' +
        '<span class="text-orange-400 w-12 text-right">' + z.effectiveArea.toFixed(1) + ' m²</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');

    html += '<div class="flex justify-between text-[9px] font-black text-orange-700 px-2 pt-1">' +
      '<span>Vlastník spolu</span><span>' + ownerTotal.toFixed(2) + ' €</span></div>';
    html += '</div>';
  }

  // Unallocated
  if (amount > 0 && checkedZones.length > 0) {
    var allTotal = checkedZones.reduce(function(s, z) {
      var pct = totalArea > 0 ? (z.area / totalArea * 100) : 0;
      return s + amount * pct / 100;
    }, 0);
    var tempTot = temperedZones.reduce(function(s, z) {
      var pct = totalArea > 0 ? (z.effectiveArea / totalArea * 100) : 0;
      return s + amount * pct / 100;
    }, 0);
    var unallocated = amount - allTotal - tempTot;
    if (Math.abs(unallocated) > 0.01) {
      html += '<div class="flex justify-between text-[9px] font-black text-red-500 px-2 pt-2 border-t border-red-200 mt-2">' +
        '<span>Nerozpočítané</span><span>' + unallocated.toFixed(2) + ' €</span></div>';
    }
  }

  rows.innerHTML = html;
  preview.classList.remove('hidden');
};

// Update preview when amount changes
var expAmountInput = document.getElementById('exp-amount');
if (expAmountInput) expAmountInput.addEventListener('input', function() { window.updateAllocPreview(); });

// ============ ALLOCATION METHOD ============

var currentAllocMethod = 'area';

window.setAllocMethod = function(method) {
  currentAllocMethod = method;
  var areaBtn = document.getElementById('alloc-method-area');
  var meterBtn = document.getElementById('alloc-method-meter');
  var areaSection = document.getElementById('alloc-area-section');
  var meterSection = document.getElementById('alloc-meter-section');

  if (method === 'meter') {
    meterBtn.className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-900 text-white';
    areaBtn.className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-200 text-slate-500';
    areaSection.classList.add('hidden');
    meterSection.classList.remove('hidden');
    window.calcMeterAllocation();
  } else {
    areaBtn.className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-900 text-white';
    meterBtn.className = 'text-[8px] font-black px-2 py-1 rounded-lg bg-slate-200 text-slate-500';
    areaSection.classList.remove('hidden');
    meterSection.classList.add('hidden');
    window.updateAllocPreview();
  }
};

// Category name → meter type mapping
var catMeterType = {
  'Voda': 'water', 'Vodné a stočné': 'water',
  'Elektrina': 'electricity', 'Elektrická energia': 'electricity',
  'Plyn': 'gas', 'Vykurovanie': 'gas'
};

window.calcMeterAllocation = async function() {
  var meterRows = document.getElementById('alloc-meter-rows');
  var preview = document.getElementById('exp-alloc-preview');
  var allocRows = document.getElementById('exp-alloc-rows');
  var amount = parseFloat(document.getElementById('exp-amount').value) || 0;
  var periodFrom = document.getElementById('exp-period-from').value;
  var periodTo = document.getElementById('exp-period-to').value;

  if (!periodFrom || !periodTo) {
    meterRows.innerHTML = '<p class="text-[9px] text-red-400">Vyplňte obdobie od-do pre výpočet spotreby.</p>';
    preview.classList.add('hidden');
    return;
  }

  // Determine meter type from category
  var catSel = document.getElementById('exp-category');
  var catName = catSel ? catSel.options[catSel.selectedIndex].text : '';
  var meterType = catMeterType[catName];

  if (!meterType) {
    meterRows.innerHTML = '<p class="text-[9px] text-slate-400">Pre túto kategóriu nie sú merače. Použite rozpočítanie podľa plochy.</p>';
    preview.classList.add('hidden');
    return;
  }

  // Load meters of this type
  var { data: meters = [] } = await sb.from('meters').select('*').eq('type', meterType);
  if (meters.length === 0) {
    meterRows.innerHTML = '<p class="text-[9px] text-slate-400">Žiadne ' + meterType + ' merače. Pridajte merače v sekcii Merače.</p>';
    preview.classList.add('hidden');
    return;
  }

  // Load all readings in range (with buffer for finding closest)
  var { data: readings = [] } = await sb.from('meter_readings').select('*')
    .in('meter_id', meters.map(function(m) { return m.id; }))
    .lte('date', periodTo)
    .order('date', { ascending: true });

  // Load meter-zone assignments
  var { data: mzAll = [] } = await sb.from('meter_zones').select('meter_id, zone_id');
  var mzByMeter = {};
  mzAll.forEach(function(mz) {
    if (!mzByMeter[mz.meter_id]) mzByMeter[mz.meter_id] = [];
    mzByMeter[mz.meter_id].push(mz.zone_id);
  });

  // Calculate consumption per meter
  var meterConsumption = [];
  var mainMeter = meters.find(function(m) { return m.is_main; });

  meters.forEach(function(m) {
    var mReadings = readings.filter(function(r) { return r.meter_id === m.id; });
    if (mReadings.length < 2) return;

    // Find reading closest to periodFrom (before or at)
    var startReadings = mReadings.filter(function(r) { return r.date <= periodFrom; });
    var startR = startReadings.length > 0 ? startReadings[startReadings.length - 1] : mReadings[0];

    // Find reading closest to periodTo (before or at)
    var endReadings = mReadings.filter(function(r) { return r.date <= periodTo; });
    var endR = endReadings.length > 0 ? endReadings[endReadings.length - 1] : null;

    if (!endR || endR.id === startR.id) return;

    var consumption = parseFloat(endR.value) - parseFloat(startR.value);
    if (consumption < 0) consumption = 0;

    var zones = mzByMeter[m.id] || [];
    // Fallback to old zone_id if no meter_zones
    if (zones.length === 0 && m.zone_id) zones = [m.zone_id];

    meterConsumption.push({
      meter: m,
      consumption: consumption,
      startValue: parseFloat(startR.value),
      endValue: parseFloat(endR.value),
      startDate: startR.date,
      endDate: endR.date,
      zones: zones
    });
  });

  // Build zone allocation
  var zoneAllocs = []; // { zoneId, zoneName, consumption, pct, amount, payer, meterName, note }
  var totalConsumption = 0;
  var subMeterTotal = 0;

  meterConsumption.forEach(function(mc) {
    if (mc.meter.is_main) return; // Handle main meter separately

    subMeterTotal += mc.consumption;

    if (mc.zones.length === 1) {
      // Single zone meter - direct assignment
      var zone = allZones.find(function(z) { return z.id === mc.zones[0]; });
      zoneAllocs.push({
        zoneId: mc.zones[0],
        zoneName: zone ? (zone.tenant_name || zone.name) : '?',
        consumption: mc.consumption,
        meterName: mc.meter.name,
        payer: 'tenant',
        note: mc.meter.meter_number ? '#' + mc.meter.meter_number : ''
      });
    } else if (mc.zones.length > 1) {
      // Multi-zone meter (e.g., Blok B) - split by area
      var zonesWithArea = mc.zones.map(function(zId) {
        var z = allZones.find(function(az) { return az.id === zId; });
        return { id: zId, name: z ? (z.tenant_name || z.name) : '?', area: z ? (parseFloat(z.area_m2) || 0) : 0 };
      });
      var totalZoneArea = zonesWithArea.reduce(function(s, z) { return s + z.area; }, 0);

      zonesWithArea.forEach(function(z) {
        var share = totalZoneArea > 0 ? (z.area / totalZoneArea) : 0;
        var zoneCons = mc.consumption * share;
        zoneAllocs.push({
          zoneId: z.id,
          zoneName: z.name,
          consumption: zoneCons,
          meterName: mc.meter.name,
          payer: 'tenant',
          note: z.area + ' m² z ' + totalZoneArea + ' m²'
        });
      });
    }
  });

  // Main meter remainder = common areas / losses
  var mainConsumption = 0;
  var mainMc = meterConsumption.find(function(mc) { return mc.meter.is_main; });
  if (mainMc) {
    mainConsumption = mainMc.consumption;
    var remainder = mainConsumption - subMeterTotal;
    if (remainder > 0.01) {
      zoneAllocs.push({
        zoneId: null,
        zoneName: 'Spoločné / straty',
        consumption: remainder,
        meterName: mainMc.meter.name + ' - podmerače',
        payer: 'owner',
        note: mainConsumption.toFixed(2) + ' - ' + subMeterTotal.toFixed(2)
      });
    }
  }

  totalConsumption = zoneAllocs.reduce(function(s, a) { return s + a.consumption; }, 0);

  // Calculate percentages and amounts
  zoneAllocs.forEach(function(a) {
    a.pct = totalConsumption > 0 ? (a.consumption / totalConsumption * 100) : 0;
    a.amount = amount * a.pct / 100;
  });

  // Display meter info
  var unit = meters[0] ? meters[0].unit : 'm³';
  meterRows.innerHTML = meterConsumption.map(function(mc) {
    var badges = mc.meter.is_main ? ' <span class="text-[7px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-600">HLAVNÝ</span>' : '';
    return '<div class="flex justify-between text-[9px] bg-white rounded-lg px-2 py-1.5">' +
      '<span class="font-bold text-slate-600">' + mc.meter.name + badges + '</span>' +
      '<span class="text-slate-400">' + mc.startValue.toFixed(2) + ' → ' + mc.endValue.toFixed(2) + '</span>' +
      '<span class="font-black text-green-600">' + mc.consumption.toFixed(2) + ' ' + unit + '</span>' +
    '</div>';
  }).join('');

  // Display allocation preview
  if (zoneAllocs.length === 0) {
    preview.classList.add('hidden');
    return;
  }

  var tenantAllocs = zoneAllocs.filter(function(a) { return a.payer === 'tenant'; });
  var ownerAllocs = zoneAllocs.filter(function(a) { return a.payer === 'owner'; });

  var html = '';
  if (tenantAllocs.length > 0) {
    html += '<p class="text-[8px] font-black text-green-600 uppercase mb-1">Nájomca platí</p>';
    var tenantTotal = 0;
    html += tenantAllocs.map(function(a) {
      tenantTotal += a.amount;
      return '<div class="flex items-center justify-between text-[9px] bg-white rounded-lg px-2 py-1">' +
        '<span class="font-bold text-slate-600 truncate flex-1">' + a.zoneName + '</span>' +
        '<span class="text-slate-400 w-16 text-right">' + a.consumption.toFixed(2) + ' ' + unit + '</span>' +
        '<span class="font-bold text-blue-600 w-12 text-right">' + a.pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-slate-800 w-16 text-right">' + a.amount.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');
    html += '<div class="flex justify-between text-[9px] font-black text-green-700 px-2 pt-1">' +
      '<span>Nájomcovia spolu</span><span>' + tenantTotal.toFixed(2) + ' €</span></div>';
  }

  if (ownerAllocs.length > 0) {
    html += '<div class="border-t border-orange-200 mt-2 pt-2">' +
      '<p class="text-[8px] font-black text-orange-500 uppercase mb-1">Vlastník platí</p>';
    var ownerTotal = 0;
    html += ownerAllocs.map(function(a) {
      ownerTotal += a.amount;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + a.zoneName + '</span>' +
        '<span class="text-orange-400 w-16 text-right">' + a.consumption.toFixed(2) + ' ' + unit + '</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + a.pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + a.amount.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');
    html += '<div class="flex justify-between text-[9px] font-black text-orange-700 px-2 pt-1">' +
      '<span>Vlastník spolu</span><span>' + ownerTotal.toFixed(2) + ' €</span></div>';
    html += '</div>';
  }

  allocRows.innerHTML = html;
  preview.classList.remove('hidden');

  // Store meter allocations for save
  var allocUnit = meters[0] ? meters[0].unit : 'm³';
  zoneAllocs.forEach(function(a) { a.unit = allocUnit; });
  window._meterAllocations = zoneAllocs;
};

// Recalc meter when period changes
var pfInput = document.getElementById('exp-period-from');
var ptInput = document.getElementById('exp-period-to');
if (pfInput) pfInput.addEventListener('change', function() { if (currentAllocMethod === 'meter') window.calcMeterAllocation(); });
if (ptInput) ptInput.addEventListener('change', function() { if (currentAllocMethod === 'meter') window.calcMeterAllocation(); });

// Amount change → recalc active method
var expAmountInput = document.getElementById('exp-amount');
if (expAmountInput) expAmountInput.addEventListener('input', function() {
  if (currentAllocMethod === 'meter') window.calcMeterAllocation();
  else window.updateAllocPreview();
});

window.saveExpense = async function() {
  var data = {
    date: document.getElementById('exp-date').value,
    category_id: document.getElementById('exp-category').value,
    description: document.getElementById('exp-desc').value.trim(),
    supplier: document.getElementById('exp-supplier').value.trim() || null,
    amount: parseFloat(document.getElementById('exp-amount').value) || 0,
    zone_id: null,
    invoice_number: document.getElementById('exp-invoice').value.trim() || null,
    period_from: document.getElementById('exp-period-from').value || null,
    period_to: document.getElementById('exp-period-to').value || null,
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

  var expenseId;
  if (editingExpenseId) {
    await sb.from('expenses').update(data).eq('id', editingExpenseId);
    expenseId = editingExpenseId;
  } else {
    var { data: inserted } = await sb.from('expenses').insert(data).select('id').single();
    expenseId = inserted ? inserted.id : null;
  }

  // Save allocations
  if (expenseId) {
    try {
      await sb.from('expense_allocations').delete().eq('expense_id', expenseId);

      var allocs = [];

      if (currentAllocMethod === 'meter' && window._meterAllocations && window._meterAllocations.length > 0) {
        // Meter-based allocations
        window._meterAllocations.forEach(function(a) {
          if (!a.zoneId) return;
          allocs.push({
            expense_id: expenseId,
            zone_id: a.zoneId,
            percentage: parseFloat(a.pct.toFixed(2)),
            amount: parseFloat(a.amount.toFixed(2)),
            payer: a.payer,
            consumption: parseFloat(a.consumption.toFixed(4)),
            consumption_unit: a.unit || 'm³'
          });
        });
        var lossAlloc = window._meterAllocations.find(function(a) { return !a.zoneId && a.payer === 'owner'; });
        if (lossAlloc) {
          var commonZone = allZones.find(function(z) { return z.name === 'Spoločné priestory'; });
          if (commonZone) {
            allocs.push({
              expense_id: expenseId,
              zone_id: commonZone.id,
              percentage: parseFloat(lossAlloc.pct.toFixed(2)),
              amount: parseFloat(lossAlloc.amount.toFixed(2)),
              payer: 'owner',
              consumption: parseFloat(lossAlloc.consumption.toFixed(4)),
              consumption_unit: lossAlloc.unit || 'm³'
            });
          }
        }
      } else {
        // Area-based allocations
        var zones = window.getSelectedAllocZones();

        var catSel = document.getElementById('exp-category');
        var selectedCatName = catSel ? catSel.options[catSel.selectedIndex].text : '';
        var isHeating = selectedCatName === 'Vykurovanie';

        var allCbs = document.querySelectorAll('.alloc-zone-cb');
        var temperedZones = [];
        if (isHeating) {
          for (var t = 0; t < allCbs.length; t++) {
            if (!allCbs[t].checked) {
              var temper = parseFloat(allCbs[t].getAttribute('data-temper')) || 0;
              if (temper > 0) {
                var tArea = parseFloat(allCbs[t].getAttribute('data-area')) || 0;
                temperedZones.push({ id: allCbs[t].value, area: tArea, temper: temper, effectiveArea: tArea * temper / 100 });
              }
            }
          }
        }

        var activeArea = zones.reduce(function(s, z) { return s + z.area; }, 0);
        var temperedArea = temperedZones.reduce(function(s, z) { return s + z.effectiveArea; }, 0);
        var totalArea = activeArea + temperedArea;

        zones.forEach(function(z) {
          var pct = totalArea > 0 ? (z.area / totalArea * 100) : (100 / zones.length);
          var sel = document.querySelector('[data-payer-zone="' + z.id + '"]');
          var payer = sel ? sel.value : 'tenant';
          allocs.push({
            expense_id: expenseId,
            zone_id: z.id,
            percentage: parseFloat(pct.toFixed(2)),
            amount: parseFloat((data.amount * pct / 100).toFixed(2)),
            payer: payer
          });
        });
        temperedZones.forEach(function(z) {
          var pct = totalArea > 0 ? (z.effectiveArea / totalArea * 100) : 0;
          allocs.push({
            expense_id: expenseId,
            zone_id: z.id,
            percentage: parseFloat(pct.toFixed(2)),
            amount: parseFloat((data.amount * pct / 100).toFixed(2)),
            payer: 'owner'
          });
        });

        // Save preset
        var presetZones = zones.map(function(z) {
          var sel = document.querySelector('[data-payer-zone="' + z.id + '"]');
          return { id: z.id, payer: sel ? sel.value : 'tenant' };
        });
        await window.saveCategoryPreset(data.category_id, presetZones);
      }

      if (allocs.length > 0) {
        await sb.from('expense_allocations').insert(allocs);
      }
    } catch(allocErr) {
      console.warn('Allocation save error (table may not exist):', allocErr);
    }
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
  document.getElementById('exp-invoice').value = e.invoice_number || '';
  document.getElementById('exp-period-from').value = e.period_from || '';
  document.getElementById('exp-period-to').value = e.period_to || '';
  document.getElementById('exp-note').value = e.note || '';

  // Load existing allocations
  var { data: allocs = [] } = await sb.from('expense_allocations').select('zone_id, payer').eq('expense_id', id);
  var allocMap = {};
  allocs.forEach(function(a) { allocMap[a.zone_id] = a.payer || 'tenant'; });
  var cbs = document.querySelectorAll('.alloc-zone-cb');
  for (var i = 0; i < cbs.length; i++) {
    var isAlloc = allocMap.hasOwnProperty(cbs[i].value);
    cbs[i].checked = isAlloc;
    var payerSel = document.querySelector('[data-payer-zone="' + cbs[i].value + '"]');
    if (payerSel) {
      payerSel.classList.toggle('hidden', !isAlloc);
      if (isAlloc) payerSel.value = allocMap[cbs[i].value];
    }
  }
  window.updateAllocPreview();

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
        img.classList.remove('hidden');
        preview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    } else if (file.type === 'application/pdf') {
      img.classList.add('hidden');
      preview.classList.remove('hidden');
      preview.innerHTML = '<div class="flex items-center space-x-2 bg-red-50 rounded-lg p-2"><i class="fa-solid fa-file-pdf text-red-500 text-xl"></i><span class="text-xs font-bold text-slate-600">' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)</span></div>';
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

    content.push({ type: 'text', text: 'Analyzuj túto účtenku/faktúru. DÔLEŽITÉ: "amount" má byť FAKTUROVANÁ SUMA (celková suma s DPH za služby), NIE preplatok, nedoplatok alebo zostatok. Ak je to vyúčtovacia faktúra, použi fakturovanú sumu s DPH. Vráť LEN JSON bez markdown, bez backticks:\n{"date":"YYYY-MM-DD dátum vystavenia","description":"stručný popis napr. Plyn - vyúčtovanie 2025","supplier":"názov dodávateľa","amount":číslo fakturovanej sumy s DPH,"invoice_number":"číslo faktúry alebo null","period_from":"YYYY-MM-DD alebo null","period_to":"YYYY-MM-DD alebo null","category":"jedna z: Vykurovanie, EPS a PO, Odvoz smetí, Voda a kanalizácia, Elektrina, Správa, Náklady na budovu, Údržba, Ostatné","meter_number":"číslo merača ak je na faktúre alebo null","consumption":"spotreba v m3 alebo kWh ak je na faktúre alebo null","consumption_unit":"m3 alebo kWh alebo null"}' });

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
    if (result.period_from) document.getElementById('exp-period-from').value = result.period_from;
    if (result.period_to) document.getElementById('exp-period-to').value = result.period_to;

    // Auto-fill note with consumption and meter info
    var noteparts = [];
    if (result.consumption) noteparts.push('Spotreba: ' + result.consumption + ' ' + (result.consumption_unit || ''));
    if (result.meter_number) noteparts.push('Merač: ' + result.meter_number);
    if (noteparts.length > 0) document.getElementById('exp-note').value = noteparts.join(' • ');

    // Match category
    if (result.category) {
      var cat = allCategories.find(function(c) { return c.name === result.category; });
      if (cat) document.getElementById('exp-category').value = cat.id;
    }

    status.innerText = 'Hotovo – skontrolujte údaje';
    if (result.consumption) {
      status.innerText = 'Hotovo • Spotreba: ' + result.consumption + ' ' + (result.consumption_unit || '') + (result.meter_number ? ' • Merač: ' + result.meter_number : '');
    }
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


