// ============================================
// PANSKÁ 17 - FINANCIE
// Merače, náklady, alokácie, účtenky, AI extrakcia
// ============================================

async function loadFinance() {
  // Load categories
  var { data: cats = [] } = await sb.from('cost_categories').select('*').order('sort_order', { ascending: true });
  allCategories = cats;

  // Load tenant lease dates for time-weighted allocation
  var { data: tenantList = [] } = await sb.from('tenants').select('id, lease_from, lease_to');
  var tenantLeaseMap = {};
  tenantList.forEach(function(t) { tenantLeaseMap[t.id] = t; });

  // Zones grid - metraže
  var zonesGrid = document.getElementById('fin-zones-grid');
  if (zonesGrid) {
    zonesGrid.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory'; }).map(function(z) {
      var label = z.tenant_name || z.name;
      var temper = z.tempering_pct || 0;
      var hasBillingArea = z.billing_area_m2 && z.billing_area_m2 !== z.area_m2;
      return '<div class="bg-slate-50 rounded-xl px-3 py-2' + (hasBillingArea ? ' border-2 border-amber-300' : '') + '">' +
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
        '<div class="flex items-center space-x-1 mt-1">' +
          '<span class="text-[8px] text-amber-500">Fakturačná plocha</span>' +
          '<input type="number" step="0.01" value="' + (z.billing_area_m2 || '') + '" data-billing-zone="' + z.id + '" class="zone-billing-input w-14 text-right border border-amber-200 rounded px-1 py-0.5 text-[9px] font-bold" placeholder="—">' +
          '<span class="text-[8px] text-amber-400">m²</span>' +
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
      return '<option value="' + c.id + '" data-method="' + (c.allocation_method || 'area') + '" data-empty-rule="' + (c.empty_zone_rule || 'owner') + '">' + c.name + '</option>';
    }).join('');
    expCat.onchange = async function() {
      // Check last expense for this category to reuse its method
      var catId = this.value;
      var opt = this.options[this.selectedIndex];
      var defaultMethod = opt ? (opt.getAttribute('data-method') || 'area') : 'area';
      var method = defaultMethod;
      try {
        var { data: lastExp } = await sb.from('expenses').select('alloc_method').eq('category_id', catId).order('date', { ascending: false }).limit(1).single();
        if (lastExp && lastExp.alloc_method) method = lastExp.alloc_method;
      } catch(e) {}
      window.setAllocMethod(method);
      window.loadCategoryPreset(this.value);
      window.updateAllocPreview();
      if (window.updateMonthsVisibility) window.updateMonthsVisibility();
    };
  }

  // Zone checkboxes
  var zoneChecks = document.getElementById('exp-zone-checks');
  if (zoneChecks) {
    zoneChecks.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory' && z.name !== 'Dvor'; }).map(function(z) {
      var label = z.tenant_name || z.name;
      var temper = z.tempering_pct || 0;
      var lease = z.tenant_id ? tenantLeaseMap[z.tenant_id] : null;
      var leaseFrom = (lease && lease.lease_from) ? lease.lease_from : '';
      var leaseTo = (lease && lease.lease_to) ? lease.lease_to : '';
      var billingArea = z.billing_area_m2 || z.area_m2 || 0;
      return '<div class="flex flex-wrap items-center gap-1.5 bg-white rounded-lg px-2 py-1.5">' +
        '<input type="checkbox" value="' + z.id + '" data-area="' + (z.area_m2 || 0) + '" data-billing-area="' + billingArea + '" data-temper="' + temper + '" data-lease-from="' + leaseFrom + '" data-lease-to="' + leaseTo + '" class="alloc-zone-cb rounded" onchange="window.updateAllocPreview()">' +
        '<span class="text-[9px] font-bold text-slate-600 truncate flex-1">' + label + '</span>' +
        '<select data-payer-zone="' + z.id + '" class="alloc-payer-sel text-[8px] border border-slate-200 rounded px-1 py-0.5 hidden" onchange="window.onPayerChange(this);window.updateAllocPreview()">' +
          '<option value="tenant">nájomca</option>' +
          '<option value="owner">vlastník</option>' +
        '</select>' +
        '<span data-months-zone="' + z.id + '" class="alloc-months-wrap hidden flex items-center gap-0.5">' +
          '<span class="text-[7px] text-orange-500 font-bold">obsadené</span>' +
          '<input type="number" min="0" max="12" step="1" data-months-input="' + z.id + '" class="alloc-months-input w-7 text-center border border-orange-300 rounded px-0.5 py-0 text-[9px] font-bold text-orange-600" onchange="window.updateAllocPreview()" oninput="window.updateAllocPreview()">' +
          '<span class="text-[7px] text-orange-400 font-bold alloc-months-total">/12 mes.</span>' +
        '</span>' +
      '</div>';
    }).join('');
  }

  // Style payer select: red for owner, default for tenant
  window.onPayerChange = function(sel) {
    if (sel.value === 'owner') {
      sel.className = 'alloc-payer-sel text-[8px] border border-red-300 rounded px-1 py-0.5 bg-red-50 text-red-600 font-bold';
    } else {
      sel.className = 'alloc-payer-sel text-[8px] border border-slate-200 rounded px-1 py-0.5';
    }
  };
  window.styleAllPayerSelects = function() {
    var sels = document.querySelectorAll('.alloc-payer-sel');
    for (var i = 0; i < sels.length; i++) {
      if (!sels[i].classList.contains('hidden')) window.onPayerChange(sels[i]);
    }
  };

  // Helper: calculate total months in billing period
  window.getPeriodMonths = function() {
    var pf = document.getElementById('exp-period-from').value;
    var pt = document.getElementById('exp-period-to').value;
    if (!pf || !pt) return 12;
    var d1 = new Date(pf), d2 = new Date(pt);
    var months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
    return Math.max(1, Math.min(36, months));
  };

  // Calculate overlap months between lease and expense period
  window.calcLeaseOverlapMonths = function(leaseFrom, leaseTo, periodFrom, periodTo) {
    if (!periodFrom || !periodTo) return null; // no period = can't calc
    if (!leaseFrom) return null; // no lease start = assume always active
    // Effective ranges
    var pf = new Date(periodFrom), pt = new Date(periodTo);
    var lf = new Date(leaseFrom);
    var lt = leaseTo ? new Date(leaseTo) : new Date('2099-12-31');
    // Overlap: max(start) to min(end)
    var overlapStart = lf > pf ? lf : pf;
    var overlapEnd = lt < pt ? lt : pt;
    if (overlapStart > overlapEnd) return 0; // no overlap
    // Count months (inclusive of partial months)
    var months = (overlapEnd.getFullYear() - overlapStart.getFullYear()) * 12 
      + (overlapEnd.getMonth() - overlapStart.getMonth()) + 1;
    return Math.max(0, Math.min(months, window.getPeriodMonths()));
  };

  // Show/hide months inputs based on period and lease dates
  window.updateMonthsVisibility = function() {
    var totalMonths = window.getPeriodMonths();
    var periodFrom = document.getElementById('exp-period-from').value;
    var periodTo = document.getElementById('exp-period-to').value;
    var hasPeriod = periodFrom && periodTo;

    var monthsWraps = document.querySelectorAll('.alloc-months-wrap');
    for (var m = 0; m < monthsWraps.length; m++) {
      var zoneId = monthsWraps[m].getAttribute('data-months-zone');
      var cb = document.querySelector('.alloc-zone-cb[value="' + zoneId + '"]');
      var isChecked = cb ? cb.checked : false;

      if (!isChecked || !hasPeriod) {
        monthsWraps[m].classList.add('hidden');
        continue;
      }

      // Auto-calculate from lease dates
      var leaseFrom = cb.getAttribute('data-lease-from') || '';
      var leaseTo = cb.getAttribute('data-lease-to') || '';
      var autoMonths = window.calcLeaseOverlapMonths(leaseFrom, leaseTo, periodFrom, periodTo);
      
      // Update total label
      var totalLabel = monthsWraps[m].querySelector('.alloc-months-total');
      if (totalLabel) totalLabel.textContent = '/' + totalMonths + ' mes.';
      var inp = monthsWraps[m].querySelector('.alloc-months-input');
      if (inp) {
        inp.max = totalMonths;
        // Auto-fill if: no value yet, or user hasn't manually edited
        if (!inp.value || inp.getAttribute('data-auto') === 'true') {
          if (autoMonths !== null) {
            inp.value = autoMonths;
          } else {
            inp.value = totalMonths;
          }
          inp.setAttribute('data-auto', 'true');
        }
        // Clamp
        if (parseInt(inp.value) > totalMonths) inp.value = totalMonths;
      }

      // Show if months < total (partial occupation) 
      var currentVal = inp ? parseInt(inp.value) : totalMonths;
      var show = currentVal < totalMonths;
      // Also show if lease dates indicate partial overlap
      if (autoMonths !== null && autoMonths < totalMonths) show = true;
      monthsWraps[m].classList.toggle('hidden', !show);

      // Warning if manual != auto
      if (inp && autoMonths !== null && parseInt(inp.value) !== autoMonths) {
        inp.classList.add('border-red-500', 'bg-red-50');
        inp.title = 'Z nájomnej zmluvy: ' + autoMonths + ' mes. (lease: ' + leaseFrom + ' – ' + (leaseTo || '∞') + ')';
      } else {
        inp.classList.remove('border-red-500', 'bg-red-50');
        inp.title = '';
      }
    }

    // Mark manual edit
    var allMonthsInputs = document.querySelectorAll('.alloc-months-input');
    for (var mi = 0; mi < allMonthsInputs.length; mi++) {
      allMonthsInputs[mi].onfocus = function() { this.setAttribute('data-auto', 'false'); };
    }
  };

  // Year dropdown
  var yearSel = document.getElementById('fin-year');
  if (yearSel && yearSel.options.length === 0) {
    yearSel.innerHTML = '<option value="">Všetky roky</option>';
    var curYear = new Date().getFullYear();
    for (var y = curYear; y >= 2020; y--) {
      yearSel.innerHTML += '<option value="' + y + '"' + (y === curYear ? ' selected' : '') + '>' + y + '</option>';
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

  // Tenant year dropdown
  var tenYearSel = document.getElementById('fin-tenants-year');
  if (tenYearSel && tenYearSel.options.length === 0) {
    tenYearSel.innerHTML = '<option value="">Všetci</option>';
    var curYear4 = new Date().getFullYear();
    for (var y4 = curYear4; y4 >= 2020; y4--) {
      tenYearSel.innerHTML += '<option value="' + y4 + '"' + (y4 === curYear4 ? ' selected' : '') + '>' + y4 + '</option>';
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
    mtrZones.innerHTML = allZones.filter(function(z) { return z.name !== 'Spoločné priestory'; }).map(function(z) {
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

  // Category override dropdown
  var mtrCat = document.getElementById('mtr-category');
  if (mtrCat) {
    mtrCat.innerHTML = '<option value="">— podľa typu merača —</option>' +
      allCategories.map(function(c) {
        return '<option value="' + c.id + '">' + c.name + '</option>';
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
    if (m.cost_category_id) {
      var cat = allCategories.find(function(c) { return c.id === m.cost_category_id; });
      if (cat) badges += '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">→ ' + cat.name + '</span> ';
    }

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
  document.getElementById('mtr-category').value = '';
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
  document.getElementById('mtr-category').value = m.cost_category_id || '';
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
    cost_category_id: document.getElementById('mtr-category').value || null,
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
  var year = document.getElementById('fin-year').value;
  var catFilter = document.getElementById('fin-cat-filter').value;
  var dateMode = document.getElementById('fin-date-mode').value;

  var query = sb.from('expenses').select('*, cost_categories(name), zones(name, tenant_name), expense_allocations(zone_id, percentage, amount, payer, zones(name, tenant_name))');

  if (year) {
    if (dateMode === 'period') {
      query = query.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    } else {
      query = query.gte('date', year + '-01-01').lte('date', year + '-12-31');
    }
  }

  query = query.order('date', { ascending: false });

  if (catFilter !== 'all') query = query.eq('category_id', catFilter);

  var result = await query;
  var expenses = result.data || [];

  // Fallback if allocations table missing
  if (result.error) {
    console.warn('Expenses query error, trying without allocations:', result.error);
    var q2 = sb.from('expenses').select('*, cost_categories(name), zones(name, tenant_name)');
    if (year) {
      if (dateMode === 'period') {
        q2 = q2.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
      } else {
        q2 = q2.gte('date', year + '-01-01').lte('date', year + '-12-31');
      }
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
    var costTypeBadge = '';
    if (e.cost_type === 'amortized') costTypeBadge = '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">⏱ ' + (e.amort_years || '?') + 'r</span>';
    else if (e.cost_type === 'investment') costTypeBadge = '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600">💰 INV</span>';
    return '<div class="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center space-x-2">' +
          '<span class="text-[8px] font-black text-slate-400 uppercase">' + fmtD(e.date) + '</span>' +
          (e.ref_number ? '<span class="text-[8px] font-bold text-amber-500">#' + e.ref_number + '</span>' : '') +
          '<span class="text-[8px] font-bold text-blue-500 uppercase">' + catName + '</span>' +
          costTypeBadge +
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
        '<button onclick="event.stopPropagation();window.duplicateExpense(\'' + e.id + '\')" class="text-blue-300 hover:text-blue-500 text-xs" title="Duplikát"><i class="fa-solid fa-copy"></i></button>' +
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
    var billingInput = document.querySelector('[data-billing-zone="' + zoneId + '"]');
    var billingArea = billingInput && billingInput.value ? parseFloat(billingInput.value) : null;
    await sb.from('zones').update({ area_m2: area, tempering_pct: temperPct, billing_area_m2: billingArea }).eq('id', zoneId);
  }
  for (var j = 0; j < allZones.length; j++) {
    var inp = document.querySelector('[data-zone-id="' + allZones[j].id + '"]');
    if (inp) allZones[j].area_m2 = parseFloat(inp.value) || 0;
    var tmp = document.querySelector('[data-temper-zone="' + allZones[j].id + '"]');
    if (tmp) allZones[j].tempering_pct = parseFloat(tmp.value) || 0;
    var bil = document.querySelector('[data-billing-zone="' + allZones[j].id + '"]');
    if (bil) allZones[j].billing_area_m2 = bil.value ? parseFloat(bil.value) : null;
  }
  alert('Uložené.');
};

window.addZone = async function() {
  var name = prompt('Názov novej zóny:');
  if (!name || !name.trim()) return;
  var maxSort = allZones.reduce(function(m, z) { return Math.max(m, z.sort_order || 0); }, 0);
  var { data: inserted, error } = await sb.from('zones').insert({ name: name.trim(), area_m2: 0, sort_order: maxSort + 1 }).select('*').single();
  if (error) { alert('Chyba: ' + error.message); return; }
  // Reload zones
  var { data: z2 } = await sb.from('zones').select('*').order('sort_order', { ascending: true });
  allZones = z2 || [];
  await window.loadFinanceSection();
  alert('Zóna "' + name.trim() + '" pridaná.');
};

window.toggleAmortFields = function() {
  var costType = document.getElementById('exp-cost-type').value;
  var amortWrap = document.getElementById('amort-years-wrap');
  amortWrap.classList.toggle('hidden', costType !== 'amortized');
  window.updateAllocPreview();
};

window.showAddExpense = async function() {
  editingExpenseId = null;
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-supplier').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-cost-type').value = 'operating';
  document.getElementById('exp-amort-years').value = '';
  document.getElementById('amort-years-wrap').classList.add('hidden');
  document.getElementById('amort-yearly-hint').classList.add('hidden');
  document.getElementById('exp-invoice').value = '';
  document.getElementById('exp-period-from').value = '';
  document.getElementById('exp-period-to').value = '';
  document.getElementById('exp-note').value = '';
  document.getElementById('exp-ref').value = '';
  document.getElementById('exp-receipt').value = '';
  var receiptPreview = document.getElementById('exp-receipt-preview');
  receiptPreview.classList.add('hidden');
  // Restore img element if destroyed by PDF innerHTML
  var receiptImg = document.getElementById('exp-receipt-img');
  if (!receiptImg) {
    receiptPreview.innerHTML = '<img id="exp-receipt-img" class="max-h-32 rounded-lg cursor-pointer hidden" onclick="window.open(this.src)">';
  } else {
    receiptImg.src = '';
    receiptImg.classList.add('hidden');
    var oldLink = receiptPreview.querySelector('.receipt-pdf-link');
    if (oldLink) oldLink.remove();
  }
  document.getElementById('btn-ai-extract').classList.add('hidden');
  var status = document.getElementById('ai-extract-status');
  status.classList.add('hidden');
  status.className = status.className.replace('text-green-600', 'text-blue-500').replace('text-red-500', 'text-blue-500');
  // Reset checkboxes, payer selectors, and load preset for first category
  window.clearAllocChecks();
  var payerSels = document.querySelectorAll('.alloc-payer-sel');
  for (var p = 0; p < payerSels.length; p++) { payerSels[p].value = 'tenant'; payerSels[p].classList.add('hidden'); payerSels[p].className = 'alloc-payer-sel text-[8px] border border-slate-200 rounded px-1 py-0.5 hidden'; }
  // Reset months inputs
  var monthsInputs = document.querySelectorAll('.alloc-months-input');
  for (var mi = 0; mi < monthsInputs.length; mi++) { monthsInputs[mi].value = ''; }
  var monthsWraps = document.querySelectorAll('.alloc-months-wrap');
  for (var mw = 0; mw < monthsWraps.length; mw++) { monthsWraps[mw].classList.add('hidden'); }
  var catSel = document.getElementById('exp-category');
  if (catSel && catSel.value) {
    var opt = catSel.options[catSel.selectedIndex];
    var defaultMethod = opt ? (opt.getAttribute('data-method') || 'area') : 'area';
    var method = defaultMethod;
    try {
      var { data: lastExp } = await sb.from('expenses').select('alloc_method').eq('category_id', catSel.value).order('date', { ascending: false }).limit(1).single();
      if (lastExp && lastExp.alloc_method) method = lastExp.alloc_method;
    } catch(e) {}
    window.setAllocMethod(method);
    window.loadCategoryPreset(catSel.value);
  }
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
    var area = parseFloat(cbs[i].getAttribute('data-area')) || 0;
    var billingArea = parseFloat(cbs[i].getAttribute('data-billing-area')) || area;
    zones.push({ id: cbs[i].value, area: area, billingArea: billingArea });
  }
  return zones;
};

window.updateAllocPreview = function() {
  // Show/hide payer selectors based on checked state
  var allCbs = document.querySelectorAll('.alloc-zone-cb');
  for (var k = 0; k < allCbs.length; k++) {
    var payerSel = document.querySelector('[data-payer-zone="' + allCbs[k].value + '"]');
    if (payerSel) {
      payerSel.classList.toggle('hidden', !allCbs[k].checked);
      if (allCbs[k].checked) window.onPayerChange(payerSel);
    }
  }

  // Update months visibility for heating
  if (window.updateMonthsVisibility) window.updateMonthsVisibility();

  var checkedZones = window.getSelectedAllocZones();
  var preview = document.getElementById('exp-alloc-preview');
  var rows = document.getElementById('exp-alloc-rows');
  var amount = parseFloat(document.getElementById('exp-amount').value) || 0;
  var costType = document.getElementById('exp-cost-type').value || 'operating';
  var amortYears = parseInt(document.getElementById('exp-amort-years').value) || 0;
  
  // Update amort hint (without recursion)
  var hintEl = document.getElementById('amort-yearly-hint');
  if (costType === 'amortized' && amortYears > 0 && amount > 0) {
    hintEl.textContent = 'Ročná splátka: ' + (amount / amortYears).toFixed(2) + ' € × ' + amortYears + ' rokov';
    hintEl.classList.remove('hidden');
  } else {
    hintEl.classList.add('hidden');
  }
  
  // For amortized: preview shows yearly amount
  var displayAmount = amount;
  var amortNote = '';
  if (costType === 'amortized' && amortYears > 0) {
    displayAmount = amount / amortYears;
    amortNote = '<div class="text-[8px] font-bold text-amber-600 mb-2">⏱ Amortizácia: ' + amount.toFixed(2) + ' € ÷ ' + amortYears + ' rokov = <span class="text-amber-800">' + displayAmount.toFixed(2) + ' €/rok</span></div>';
  } else if (costType === 'investment') {
    amortNote = '<div class="text-[8px] font-bold text-purple-600 mb-2">💰 Investičný náklad – platí vlastník, nerozpočítava sa nájomcom</div>';
  }

  if (checkedZones.length === 0 && amount === 0) {
    preview.classList.add('hidden');
    return;
  }

  // Get payer per zone
  checkedZones.forEach(function(z) {
    var sel = document.querySelector('[data-payer-zone="' + z.id + '"]');
    z.payer = sel ? sel.value : 'tenant';
  });

  // Category empty zone rule
  var catSel = document.getElementById('exp-category');
  var selectedOpt = catSel ? catSel.options[catSel.selectedIndex] : null;
  var selectedCatName = selectedOpt ? selectedOpt.text : '';
  var emptyRule = selectedOpt ? (selectedOpt.getAttribute('data-empty-rule') || 'owner') : 'owner';
  // 'exclude'       = prázdne mesiace sa nepočítajú nikomu (smetie, voda, upratovanie)
  // 'owner'         = vlastník platí plnú plochu (poistka, daň)
  // 'owner_temper'  = vlastník platí tempering % (vykurovanie)
  var isHeating = emptyRule === 'owner_temper';
  var totalMonths = window.getPeriodMonths ? window.getPeriodMonths() : 12;

  // === TIME-WEIGHTED ALLOCATION (all area-based categories) ===
  var timeWeightedSplits = [];

  checkedZones.forEach(function(z) {
    var cb = document.querySelector('.alloc-zone-cb[value="' + z.id + '"]');
    var temper = cb ? (parseFloat(cb.getAttribute('data-temper')) || 0) : 0;
    var monthsInput = document.querySelector('[data-months-input="' + z.id + '"]');
    var monthsOcc = monthsInput && monthsInput.value ? (parseInt(monthsInput.value)) : totalMonths;
    if (isNaN(monthsOcc)) monthsOcc = totalMonths;
    
    if (monthsOcc < totalMonths) {
      var monthsEmpty = totalMonths - monthsOcc;
      z.tenantEffArea = z.area * monthsOcc / totalMonths;
      z.tenantEffBilling = z.billingArea * monthsOcc / totalMonths;
      
      // Owner portion depends on rule (uses pool area, not billing)
      if (emptyRule === 'exclude') {
        z.ownerEffArea = 0;
      } else if (emptyRule === 'owner_temper') {
        z.ownerEffArea = z.area * (temper / 100) * monthsEmpty / totalMonths;
      } else {
        z.ownerEffArea = z.area * monthsEmpty / totalMonths;
      }
      
      z.monthsOcc = monthsOcc;
      z.monthsEmpty = monthsEmpty;
      z.temper = temper;
      z.isTimeWeighted = true;
      z.emptyRule = emptyRule;
      if (emptyRule === 'owner_temper') {
        z.ownerLabel = 'kúr.' + temper + '% × ' + monthsEmpty + ' mes.';
      } else if (emptyRule === 'owner') {
        z.ownerLabel = 'prázdna ' + monthsEmpty + ' mes.';
      }
      timeWeightedSplits.push(z);
    }
  });

  // Unchecked zones with tempering (full period tempered, owner pays) - heating only
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

  // Calculate total effective area (pool = building area, NOT billing area)
  var totalArea = 0;
  checkedZones.forEach(function(z) {
    if (z.isTimeWeighted) {
      totalArea += z.tenantEffArea + z.ownerEffArea;
    } else {
      totalArea += z.area; // pool uses building area
    }
  });
  totalArea += temperedZones.reduce(function(s, z) { return s + z.effectiveArea; }, 0);

  // Split into display groups
  var tenantZones = checkedZones.filter(function(z) { return z.payer === 'tenant'; });
  var ownerZones = checkedZones.filter(function(z) { return z.payer === 'owner'; });

  var html = '';

  // === TENANT ZONES ===
  if (tenantZones.length > 0) {
    html += '<p class="text-[8px] font-black text-green-600 uppercase mb-1">Nájomca platí</p>';
    var tenantTotal = 0;
    html += tenantZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      // Billing area for numerator (what tenant gets charged for)
      var effArea = z.isTimeWeighted ? (z.tenantEffBilling || z.tenantEffArea) : z.billingArea;
      var pct = totalArea > 0 ? (effArea / totalArea * 100) : 0;
      var amt = displayAmount * pct / 100;
      tenantTotal += amt;
      var timeNote = z.isTimeWeighted ? ' <span class="text-orange-500">(' + z.monthsOcc + '/' + totalMonths + ' mes.)</span>' : '';
      var billingNote = (z.billingArea && z.billingArea !== z.area) ? ' <span class="text-amber-500">[fakt. ' + z.billingArea.toFixed(0) + 'm²]</span>' : '';
      return '<div class="flex items-center justify-between text-[9px] bg-white rounded-lg px-2 py-1">' +
        '<span class="font-bold text-slate-600 truncate flex-1">' + label + timeNote + billingNote + '</span>' +
        '<span class="text-slate-400 w-14 text-right">' + effArea.toFixed(1) + ' m²</span>' +
        '<span class="font-bold text-blue-600 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-slate-800 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');
    html += '<div class="flex justify-between text-[9px] font-black text-green-700 px-2 pt-1">' +
      '<span>Nájomcovia spolu</span><span>' + tenantTotal.toFixed(2) + ' €</span></div>';
  }

  // === OWNER ZONES ===
  var hasOwnerItems = ownerZones.length > 0 || temperedZones.length > 0 || timeWeightedSplits.some(function(z) { return z.payer === 'tenant' && z.emptyRule !== 'exclude' && z.ownerEffArea > 0; });

  if (hasOwnerItems) {
    html += '<div class="border-t border-orange-200 mt-2 pt-2">' +
      '<p class="text-[8px] font-black text-orange-500 uppercase mb-1">Vlastník platí</p>';
    var ownerTotal = 0;

    // Explicit owner zones (checked with payer=owner)
    html += ownerZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var effArea = z.isTimeWeighted ? (z.tenantEffArea + z.ownerEffArea) : z.area;
      var pct = totalArea > 0 ? (effArea / totalArea * 100) : 0;
      var amt = displayAmount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + '</span>' +
        '<span class="text-orange-400 w-14 text-right">' + effArea.toFixed(1) + ' m²</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');

    // Time-weighted empty portions (from tenant zones with partial occupation)
    // Only show for 'owner' and 'owner_temper' rules, NOT for 'exclude'
    html += timeWeightedSplits.filter(function(z) { return z.payer === 'tenant' && z.emptyRule !== 'exclude' && z.ownerEffArea > 0; }).map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var pct = totalArea > 0 ? (z.ownerEffArea / totalArea * 100) : 0;
      var amt = displayAmount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + ' <span class="text-orange-400">(' + z.ownerLabel + ')</span></span>' +
        '<span class="text-orange-400 w-14 text-right">' + z.ownerEffArea.toFixed(1) + ' m²</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');

    // Unchecked tempered zones (full period, heating only)
    html += temperedZones.map(function(z) {
      var zone = allZones.find(function(az) { return az.id === z.id; });
      var label = zone ? (zone.tenant_name || zone.name) : z.id;
      var pct = totalArea > 0 ? (z.effectiveArea / totalArea * 100) : 0;
      var amt = displayAmount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + ' (kúrenie ' + z.temper + '%)</span>' +
        '<span class="text-orange-400 w-14 text-right">' + z.effectiveArea.toFixed(1) + ' m²</span>' +
        '<span class="font-bold text-orange-500 w-12 text-right">' + pct.toFixed(1) + '%</span>' +
        '<span class="font-black text-orange-700 w-16 text-right">' + amt.toFixed(2) + ' €</span>' +
      '</div>';
    }).join('');

    html += '<div class="flex justify-between text-[9px] font-black text-orange-700 px-2 pt-1">' +
      '<span>Vlastník spolu</span><span>' + ownerTotal.toFixed(2) + ' €</span></div>';
    html += '</div>';
  }

  // Unallocated check
  if (amount > 0 && checkedZones.length > 0) {
    var grandTotal = 0;
    checkedZones.forEach(function(z) {
      var effArea = z.isTimeWeighted ? (z.tenantEffArea + z.ownerEffArea) : z.area;
      grandTotal += displayAmount * (totalArea > 0 ? effArea / totalArea * 100 : 0) / 100;
    });
    temperedZones.forEach(function(z) {
      grandTotal += displayAmount * (totalArea > 0 ? z.effectiveArea / totalArea * 100 : 0) / 100;
    });
    var unallocated = displayAmount - grandTotal;
    if (Math.abs(unallocated) > 0.01) {
      html += '<div class="flex justify-between text-[9px] font-black text-red-500 px-2 pt-2 border-t border-red-200 mt-2">' +
        '<span>Nerozpočítané</span><span>' + unallocated.toFixed(2) + ' €</span></div>';
    }
  }

  rows.innerHTML = amortNote + html;
  preview.classList.remove('hidden');
};

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
  var catId = catSel ? catSel.value : '';
  var meterType = catMeterType[catName];

  // Load meters: those assigned to this category, OR default type without category override
  var meters = [];
  if (catId) {
    var { data: catMeters = [] } = await sb.from('meters').select('*').eq('cost_category_id', catId);
    meters = meters.concat(catMeters);
  }
  if (meterType) {
    var { data: typeMeters = [] } = await sb.from('meters').select('*').eq('type', meterType).is('cost_category_id', null);
    typeMeters.forEach(function(m) {
      if (!meters.find(function(em) { return em.id === m.id; })) meters.push(m);
    });
  }

  if (meters.length === 0) {
    var hint = meterType ? ('Žiadne ' + meterType + ' merače.') : 'Pre túto kategóriu nie sú merače.';
    meterRows.innerHTML = '<p class="text-[9px] text-slate-400">' + hint + ' Pridajte merače v sekcii Merače alebo nastavte kategóriu na merači.</p>';
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
if (pfInput) pfInput.addEventListener('change', function() {
  if (currentAllocMethod === 'meter') window.calcMeterAllocation();
  else window.updateAllocPreview();
});
if (ptInput) ptInput.addEventListener('change', function() {
  if (currentAllocMethod === 'meter') window.calcMeterAllocation();
  else window.updateAllocPreview();
});

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
    cost_type: document.getElementById('exp-cost-type').value || 'operating',
    amort_years: parseInt(document.getElementById('exp-amort-years').value) || null,
    alloc_method: currentAllocMethod || 'area',
    ref_number: document.getElementById('exp-ref').value.trim() || null,
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
        var selectedOpt = catSel ? catSel.options[catSel.selectedIndex] : null;
        var selectedCatName = selectedOpt ? selectedOpt.text : '';
        var emptyRule = selectedOpt ? (selectedOpt.getAttribute('data-empty-rule') || 'owner') : 'owner';
        var isHeating = emptyRule === 'owner_temper';
        var totalMonths = window.getPeriodMonths ? window.getPeriodMonths() : 12;

        // For amortized: allocations use yearly amount
        var saveAmount = data.amount;
        if (data.cost_type === 'amortized' && data.amort_years > 0) {
          saveAmount = data.amount / data.amort_years;
        }

        // Get time-weighted info for checked zones
        zones.forEach(function(z) {
          var cb = document.querySelector('.alloc-zone-cb[value="' + z.id + '"]');
          var temper = cb ? (parseFloat(cb.getAttribute('data-temper')) || 0) : 0;
          z.temper = temper;
          z.isTimeWeighted = false;
          var monthsInput = document.querySelector('[data-months-input="' + z.id + '"]');
          var monthsOcc = monthsInput && monthsInput.value ? (parseInt(monthsInput.value)) : totalMonths;
          if (isNaN(monthsOcc)) monthsOcc = totalMonths;
          if (monthsOcc < totalMonths) {
            var monthsEmpty = totalMonths - monthsOcc;
            var ownerWeight = emptyRule === 'exclude' ? 0 : (emptyRule === 'owner_temper' ? (temper / 100) : 1);
            z.isTimeWeighted = true;
            z.monthsOcc = monthsOcc;
            z.monthsEmpty = monthsEmpty;
            z.tenantEffArea = z.area * monthsOcc / totalMonths;
            z.tenantEffBilling = z.billingArea * monthsOcc / totalMonths;
            z.ownerEffArea = z.area * ownerWeight * monthsEmpty / totalMonths;
            z.emptyRule = emptyRule;
          }
          var sel = document.querySelector('[data-payer-zone="' + z.id + '"]');
          z.payer = sel ? sel.value : 'tenant';
        });

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

        // Calculate total effective area
        var totalArea = 0;
        zones.forEach(function(z) {
          if (z.isTimeWeighted) {
            totalArea += z.tenantEffArea + z.ownerEffArea;
          } else {
            totalArea += z.area;
          }
        });
        totalArea += temperedZones.reduce(function(s, z) { return s + z.effectiveArea; }, 0);

        zones.forEach(function(z) {
          if (z.isTimeWeighted) {
            // Split into tenant and owner allocations
            // Tenant: uses billing area for amount, pool area for percentage
            var tenantBilling = z.tenantEffBilling || z.tenantEffArea;
            var tenantPct = totalArea > 0 ? (tenantBilling / totalArea * 100) : 0;
            var ownerPct = totalArea > 0 ? (z.ownerEffArea / totalArea * 100) : 0;
            allocs.push({
              expense_id: expenseId,
              zone_id: z.id,
              percentage: parseFloat(tenantPct.toFixed(2)),
              amount: parseFloat((saveAmount * tenantPct / 100).toFixed(2)),
              payer: z.payer,
              months_occupied: z.monthsOcc,
              months_total: totalMonths
            });
            if (z.payer === 'tenant' && ownerPct > 0) {
              allocs.push({
                expense_id: expenseId,
                zone_id: z.id,
                percentage: parseFloat(ownerPct.toFixed(2)),
                amount: parseFloat((saveAmount * ownerPct / 100).toFixed(2)),
                payer: 'owner',
                months_occupied: 0,
                months_total: totalMonths
              });
            }
          } else {
            // Use billing area for tenant charge, pool area for denominator
            var chargeArea = z.billingArea || z.area;
            var pct = totalArea > 0 ? (chargeArea / totalArea * 100) : (100 / zones.length);
            allocs.push({
              expense_id: expenseId,
              zone_id: z.id,
              percentage: parseFloat(pct.toFixed(2)),
              amount: parseFloat((saveAmount * pct / 100).toFixed(2)),
              payer: z.payer
            });
          }
        });
        temperedZones.forEach(function(z) {
          var pct = totalArea > 0 ? (z.effectiveArea / totalArea * 100) : 0;
          allocs.push({
            expense_id: expenseId,
            zone_id: z.id,
            percentage: parseFloat(pct.toFixed(2)),
            amount: parseFloat((saveAmount * pct / 100).toFixed(2)),
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
  if (window.loadOverview) await window.loadOverview();
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
  document.getElementById('exp-ref').value = e.ref_number || '';
  document.getElementById('exp-cost-type').value = e.cost_type || 'operating';
  document.getElementById('exp-amort-years').value = e.amort_years || '';
  window.toggleAmortFields();

  // Load existing allocations
  var { data: allocs = [] } = await sb.from('expense_allocations').select('zone_id, payer, months_occupied, months_total').eq('expense_id', id);
  var allocMap = {};
  allocs.forEach(function(a) { allocMap[a.zone_id] = a; });
  var cbs = document.querySelectorAll('.alloc-zone-cb');
  for (var i = 0; i < cbs.length; i++) {
    var isAlloc = allocMap.hasOwnProperty(cbs[i].value);
    cbs[i].checked = isAlloc;
    var payerSel = document.querySelector('[data-payer-zone="' + cbs[i].value + '"]');
    if (payerSel) {
      payerSel.classList.toggle('hidden', !isAlloc);
      if (isAlloc) {
        payerSel.value = allocMap[cbs[i].value].payer || 'tenant';
        window.onPayerChange(payerSel);
      }
    }
    // Restore months if time-weighted
    var allocData = allocMap[cbs[i].value];
    if (allocData && allocData.months_occupied != null && allocData.months_total) {
      var monthsInput = document.querySelector('[data-months-input="' + cbs[i].value + '"]');
      var monthsWrap = document.querySelector('[data-months-zone="' + cbs[i].value + '"]');
      if (monthsInput) {
        monthsInput.value = allocData.months_occupied;
        monthsInput.setAttribute('data-auto', 'false');
      }
      if (monthsWrap) monthsWrap.classList.remove('hidden');
    } else {
      // No saved months - mark as auto so it recalculates from lease
      var monthsInput2 = document.querySelector('[data-months-input="' + cbs[i].value + '"]');
      if (monthsInput2) monthsInput2.setAttribute('data-auto', 'true');
    }
  }

  // Restore allocation method (area or meter)
  var savedMethod = e.alloc_method || 'area';
  window.setAllocMethod(savedMethod);

  // Reset file input and show saved receipt
  document.getElementById('exp-receipt').value = '';
  var preview = document.getElementById('exp-receipt-preview');
  var img = document.getElementById('exp-receipt-img');
  var aiBtn = document.getElementById('btn-ai-extract');
  // Restore img element if it was replaced by PDF innerHTML
  if (!img) {
    preview.innerHTML = '<img id="exp-receipt-img" class="max-h-32 rounded-lg cursor-pointer hidden" onclick="window.open(this.src)">';
    img = document.getElementById('exp-receipt-img');
  }
  if (e.receipt_url) {
    if (e.receipt_url.match(/\.pdf$/i)) {
      img.classList.add('hidden');
      img.src = '';
      var pdfLink = document.createElement('a');
      pdfLink.href = e.receipt_url;
      pdfLink.target = '_blank';
      pdfLink.className = 'flex items-center space-x-2 bg-red-50 rounded-lg p-2 hover:bg-red-100 mt-1 receipt-pdf-link';
      pdfLink.innerHTML = '<i class="fa-solid fa-file-pdf text-red-500 text-xl"></i><span class="text-xs font-bold text-slate-600">Uložený doklad (PDF)</span>';
      // Remove old PDF link if any
      var oldLink = preview.querySelector('.receipt-pdf-link');
      if (oldLink) oldLink.remove();
      preview.appendChild(pdfLink);
      preview.classList.remove('hidden');
    } else {
      // Remove old PDF link if any
      var oldLink = preview.querySelector('.receipt-pdf-link');
      if (oldLink) oldLink.remove();
      img.src = e.receipt_url;
      img.classList.remove('hidden');
      preview.classList.remove('hidden');
    }
    aiBtn.classList.remove('hidden');
  } else {
    var oldLink = preview.querySelector('.receipt-pdf-link');
    if (oldLink) oldLink.remove();
    img.src = '';
    img.classList.add('hidden');
    preview.classList.add('hidden');
    aiBtn.classList.add('hidden');
  }

  document.getElementById('modal-expense').classList.remove('hidden');

  // Recalculate months visibility and allocation preview with loaded data
  if (window.updateMonthsVisibility) window.updateMonthsVisibility();
  window.updateAllocPreview();
};

window.deleteExpense = async function(id) {
  if (!confirm('Vymazať tento náklad?')) return;
  await sb.from('expenses').delete().eq('id', id);
  await loadExpenses();
  if (window.loadOverview) await window.loadOverview();
};

window.duplicateExpense = async function(id) {
  var { data: orig } = await sb.from('expenses').select('*').eq('id', id).single();
  if (!orig) return;

  var copy = {
    date: orig.date,
    category_id: orig.category_id,
    description: orig.description,
    supplier: orig.supplier,
    amount: orig.amount,
    zone_id: orig.zone_id,
    invoice_number: orig.invoice_number ? orig.invoice_number + '-KÓPIA' : null,
    period_from: orig.period_from,
    period_to: orig.period_to,
    note: orig.note,
    cost_type: orig.cost_type,
    amort_years: orig.amort_years,
    alloc_method: orig.alloc_method,
    created_by: currentUserId
  };

  var { data: inserted } = await sb.from('expenses').insert(copy).select('id').single();
  if (!inserted) return;

  // Copy allocations
  var { data: allocs = [] } = await sb.from('expense_allocations').select('zone_id, percentage, amount, payer, consumption, consumption_unit, months_occupied, months_total').eq('expense_id', id);
  if (allocs.length > 0) {
    var newAllocs = allocs.map(function(a) {
      return {
        expense_id: inserted.id,
        zone_id: a.zone_id,
        percentage: a.percentage,
        amount: a.amount,
        payer: a.payer,
        consumption: a.consumption,
        consumption_unit: a.consumption_unit,
        months_occupied: a.months_occupied,
        months_total: a.months_total
      };
    });
    await sb.from('expense_allocations').insert(newAllocs);
  }

  await loadExpenses();
  await window.editExpense(inserted.id);
};

// Receipt file preview
var expReceipt = document.getElementById('exp-receipt');
if (expReceipt) expReceipt.addEventListener('change', function(e) {
  var file = e.target.files[0];
  var preview = document.getElementById('exp-receipt-preview');
  var img = document.getElementById('exp-receipt-img');
  var aiBtn = document.getElementById('btn-ai-extract');

  if (file) {
    // Remove old PDF link if any
    var oldLink = preview.querySelector('.receipt-pdf-link');
    if (oldLink) oldLink.remove();
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
      img.src = '';
      var pdfDiv = document.createElement('div');
      pdfDiv.className = 'flex items-center space-x-2 bg-red-50 rounded-lg p-2 receipt-pdf-link';
      pdfDiv.innerHTML = '<i class="fa-solid fa-file-pdf text-red-500 text-xl"></i><span class="text-xs font-bold text-slate-600">' + file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)</span>';
      preview.appendChild(pdfDiv);
      preview.classList.remove('hidden');
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

    // Trigger recalculation of tenant allocations after AI fill
    // Reset months inputs to auto-recalculate from lease dates (period changed)
    var monthsInputs = document.querySelectorAll('.alloc-months-input');
    for (var mi = 0; mi < monthsInputs.length; mi++) {
      monthsInputs[mi].setAttribute('data-auto', 'true');
      monthsInputs[mi].value = '';
    }

    var expCatEl = document.getElementById('exp-category');
    if (expCatEl && expCatEl.onchange) {
      await expCatEl.onchange.call(expCatEl);
    } else {
      // Fallback: at least recalc with current method
      if (currentAllocMethod === 'meter') {
        window.calcMeterAllocation();
      } else {
        window.updateAllocPreview();
      }
    }
    // Ensure months visibility recalculates with new period
    if (window.updateMonthsVisibility) window.updateMonthsVisibility();

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


