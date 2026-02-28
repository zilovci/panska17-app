// ============================================
// PANSKÁ 17 - FINANCIE
// Merače, náklady, alokácie, účtenky, AI extrakcia
// ============================================

async function loadFinance() {
  // Always reload zones from DB to ensure fresh data
  var { data: freshZones } = await sb.from('zones').select('*').order('sort_order', { ascending: true });
  if (freshZones) allZones = freshZones;

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

  // Refresh lease dates on zone checkboxes from current DB state
  // Must be called before any expense edit to ensure correct dates
  window.refreshZoneLeaseDates = async function() {
    try {
      var { data: freshZones = [] } = await sb.from('zones').select('id, name, tenant_name, tenant_id, area_m2, billing_area_m2, tempering_pct');
      var { data: freshTenants = [] } = await sb.from('tenants').select('id, lease_from, lease_to');
      var leaseMap = {};
      freshTenants.forEach(function(t) { leaseMap[t.id] = t; });
      var cbs = document.querySelectorAll('.alloc-zone-cb');
      for (var i = 0; i < cbs.length; i++) {
        var zoneId = cbs[i].value;
        var zone = freshZones.find(function(z) { return z.id === zoneId; });
        if (!zone) continue;
        var lease = zone.tenant_id ? leaseMap[zone.tenant_id] : null;
        var leaseFrom = (lease && lease.lease_from) ? lease.lease_from : '';
        var leaseTo = (lease && lease.lease_to) ? lease.lease_to : '';
        cbs[i].setAttribute('data-lease-from', leaseFrom);
        cbs[i].setAttribute('data-lease-to', leaseTo);
        cbs[i].setAttribute('data-area', zone.area_m2 || 0);
        cbs[i].setAttribute('data-billing-area', zone.billing_area_m2 || zone.area_m2 || 0);
        cbs[i].setAttribute('data-temper', zone.tempering_pct || 0);
        // Update allZones in memory too
        var memZone = allZones.find(function(z) { return z.id === zoneId; });
        if (memZone) {
          memZone.area_m2 = zone.area_m2;
          memZone.billing_area_m2 = zone.billing_area_m2;
          memZone.tempering_pct = zone.tempering_pct;
        }
        var label = zone.tenant_name || zone.name;
        var span = cbs[i].nextElementSibling;
        if (span) span.title = label + (leaseFrom ? ' • Zmluva: ' + leaseFrom + ' – ' + (leaseTo || '∞') : ' • Bez dátumu zmluvy');
      }
      console.log('Zone data refreshed from DB (areas, tempering, lease dates)');
    } catch(err) {
      console.warn('refreshZoneLeaseDates error:', err);
    }
  };

  // Zone checkboxes for allocation
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
        '<span class="text-[9px] font-bold text-slate-600 truncate flex-1" title="' + label + (leaseFrom ? ' • Zmluva: ' + leaseFrom + ' – ' + (leaseTo || '∞') : ' • Bez dátumu zmluvy') + '">' + label + '</span>' +
        '<select data-payer-zone="' + z.id + '" class="alloc-payer-sel text-[8px] border border-slate-200 rounded px-1 py-0.5 hidden" onchange="window.onPayerChange(this);window.updateAllocPreview()">' +
          '<option value="tenant">nájomca</option>' +
          '<option value="owner">vlastník</option>' +
        '</select>' +
        '<span data-months-zone="' + z.id + '" class="alloc-months-wrap hidden flex flex-col gap-0">' +
          '<span class="flex items-center gap-0.5">' +
            '<input type="number" min="0" max="12" step="1" data-months-input="' + z.id + '" class="alloc-months-input w-7 text-center border border-orange-300 rounded px-0.5 py-0 text-[9px] font-bold text-orange-600" onchange="window.updateAllocPreview()" oninput="window.updateAllocPreview()">' +
            '<span class="text-[7px] text-orange-400 font-bold alloc-months-total">/12 mes.</span>' +
          '</span>' +
          '<span class="alloc-months-detail text-[7px] text-slate-400 leading-tight"></span>' +
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

  // Timezone-safe date parsing (avoids UTC vs local issues with new Date('YYYY-MM-DD'))
  function parseDate(str) {
    if (!str) return null;
    var parts = str.split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2] || '1'));
  }

  // Helper: calculate total months in billing period
  window.getPeriodMonths = function() {
    var pf = document.getElementById('exp-period-from').value;
    var pt = document.getElementById('exp-period-to').value;
    if (!pf || !pt) return 12;
    var d1 = parseDate(pf), d2 = parseDate(pt);
    var months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth()) + 1;
    return Math.max(1, Math.min(36, months));
  };

  // Calculate overlap months between lease and expense period
  window.calcLeaseOverlapMonths = function(leaseFrom, leaseTo, periodFrom, periodTo) {
    if (!periodFrom || !periodTo) return null; // no period = can't calc
    if (!leaseFrom) return null; // no lease start = assume always active
    // Effective ranges
    var pf = parseDate(periodFrom), pt = parseDate(periodTo);
    var lf = parseDate(leaseFrom);
    var lt = leaseTo ? parseDate(leaseTo) : new Date(2099, 11, 31);
    // Overlap: max(start) to min(end)
    var overlapStart = lf > pf ? lf : pf;
    var overlapEnd = lt < pt ? lt : pt;
    if (overlapStart > overlapEnd) return 0; // no overlap
    // Count months (inclusive of partial months)
    var months = (overlapEnd.getFullYear() - overlapStart.getFullYear()) * 12 
      + (overlapEnd.getMonth() - overlapStart.getMonth()) + 1;
    return Math.max(0, Math.min(months, window.getPeriodMonths()));
  };

  var monthNamesShort = ['jan','feb','mar','apr','máj','jún','júl','aug','sep','okt','nov','dec'];

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
      
      // Debug log for zones with lease dates
      var zoneName = cb.nextElementSibling ? cb.nextElementSibling.textContent.trim() : zoneId;
      console.log('Months calc:', zoneName, '| lease:', leaseFrom || '(none)', '| period:', periodFrom, '-', periodTo, '| total:', totalMonths, '| auto:', autoMonths, '| data-auto:', inp ? inp.getAttribute('data-auto') : 'N/A', '| current val:', inp ? inp.value : 'N/A');
      
      // Update total label - ALWAYS from current period
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
        // Clamp to current period total
        if (parseInt(inp.value) > totalMonths) inp.value = totalMonths;
      }

      // Build detail text showing where the number comes from
      var detailEl = monthsWraps[m].querySelector('.alloc-months-detail');
      if (detailEl) {
        try {
          var detailText = '';
          if (leaseFrom) {
            var lf = parseDate(leaseFrom);
            detailText = 'zmluva od ' + lf.getDate() + '.' + (lf.getMonth()+1) + '.' + lf.getFullYear();
            if (autoMonths !== null && autoMonths < totalMonths) {
              var pf = parseDate(periodFrom), pt = parseDate(periodTo);
              var lt = leaseTo ? parseDate(leaseTo) : new Date(2099, 11, 31);
              var overlapStart = lf > pf ? lf : pf;
              var overlapEnd = lt < pt ? lt : pt;
              if (overlapStart <= overlapEnd) {
                detailText += ' → ' + monthNamesShort[overlapStart.getMonth()] + '–' + monthNamesShort[overlapEnd.getMonth()] + ' ' + overlapEnd.getFullYear();
              }
            }
          } else {
            detailText = 'bez dátumu zmluvy';
          }
          detailEl.textContent = detailText;
        } catch(detErr) {
          detailEl.textContent = '';
        }
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
        inp.title = 'Podľa zmluvy by malo byť ' + autoMonths + ' mes. (zmluva: ' + leaseFrom + ' – ' + (leaseTo || '∞') + ')';
      } else if (inp) {
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
  var { data: meters } = await sb.from('meters').select('*, zones(name, tenant_name)').order('sort_order', { ascending: true });
  meters = meters || [];
  allMeters = meters;

  var { data: readings = [] } = await sb.from('meter_readings').select('*').order('date', { ascending: false });

  // Sort: same date → initial replacement before final (in descending order, initial is "newer")
  readings.sort(function(a, b) {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    // Same date: initial > final > normal
    var rank = function(r) {
      if (r.is_replacement && r.replacement_type === 'initial') return 2;
      if (r.is_replacement && r.replacement_type === 'final') return 0;
      return 1;
    };
    return rank(b) - rank(a);
  });

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
    // Handle replacement boundary - don't subtract across initial/final
    var consumption = null;
    if (last && prev) {
      if (last.is_replacement && last.replacement_type === 'initial') {
        consumption = null; // New meter just installed, no consumption yet
      } else if (prev.is_replacement && prev.replacement_type === 'initial') {
        // Previous is initial of new meter, this is first real reading
        consumption = (parseFloat(last.value) - parseFloat(prev.value)).toFixed(2);
      } else if (prev.is_replacement && prev.replacement_type === 'final') {
        // Previous is final of old meter, this must be initial of new - skip
        consumption = null;
      } else {
        consumption = (parseFloat(last.value) - parseFloat(prev.value)).toFixed(2);
      }
    }
    var badges = (m.is_main ? '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600">HLAVNÝ</span> ' : '') +
      (m.parent_meter_id ? '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">SUB</span> ' : '');
    if (m.cost_category_id) {
      var cat = allCategories.find(function(c) { return c.id === m.cost_category_id; });
      if (cat) badges += '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">→ ' + cat.name + '</span> ';
      if (m.has_deduction) badges += '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">ODPOČET' + (m.deduction_note ? ': ' + m.deduction_note : '') + '</span> ';
    }

    return '<div class="bg-slate-50 rounded-xl p-4">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<div class="flex items-center space-x-2 flex-wrap">' +
          '<i class="fa-solid ' + (typeIcons[m.type] || 'fa-gauge') + ' ' + (typeColors[m.type] || '') + '"></i>' +
          '<span class="text-xs font-bold text-slate-800">' + m.name + '</span>' +
          badges +
          '<span class="text-[8px] text-slate-400">' + zoneName + '</span>' +
          (m.meter_number ? '<span class="text-[8px] text-slate-300">#' + m.meter_number + '</span>' : '') +
          (m.previous_meter_number ? '<span class="text-[7px] text-amber-400">(predtým #' + m.previous_meter_number + ')</span>' : '') +
        '</div>' +
        '<div class="flex items-center space-x-2">' +
          '<button onclick="window.showAddReading(\'' + m.id + '\')" class="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[8px] font-black uppercase">+ Odčítanie</button>' +
          '<button onclick="window.showMeterReplacement(\'' + m.id + '\')" class="bg-amber-100 text-amber-600 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase hover:bg-amber-200">Výmena</button>' +
          '<button onclick="window.editMeter(\'' + m.id + '\')" class="text-slate-300 hover:text-blue-500 text-xs"><i class="fa-solid fa-pen"></i></button>' +
          '<button onclick="window.deleteMeter(\'' + m.id + '\')" class="text-slate-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>' +
        '</div>' +
      '</div>' +
      (last ? '<div class="flex items-center space-x-4">' +
        '<div>' +
          '<p class="text-[8px] font-black text-slate-400 uppercase">Posledné' +
            (last.is_replacement && last.replacement_type === 'initial' ? ' <span class="text-green-500">(nový merač)</span>' : '') +
          '</p>' +
          '<p class="text-sm font-bold text-slate-700">' + parseFloat(last.value).toFixed(2) + ' ' + m.unit + ' <span class="text-[8px] text-slate-400">' + fmtD(last.date) + '</span></p>' +
        '</div>' +
        (prev ? '<div>' +
          '<p class="text-[8px] font-black text-slate-400 uppercase">Predchádzajúce' +
            (prev.is_replacement && prev.replacement_type === 'initial' ? ' <span class="text-green-500">(nový merač)</span>' : '') +
            (prev.is_replacement && prev.replacement_type === 'final' ? ' <span class="text-red-400">(starý merač)</span>' : '') +
          '</p>' +
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
          var isRepl = r.is_replacement;
          var replType = r.replacement_type;
          var cons = null;

          if (isRepl && replType === 'initial') {
            // New meter just installed - no consumption to show
            cons = null;
          } else if (isRepl && replType === 'final') {
            // Final reading of old meter - show consumption vs previous normal reading
            if (prevR && !prevR.is_replacement) {
              cons = (parseFloat(r.value) - parseFloat(prevR.value)).toFixed(2);
            }
          } else if (prevR && prevR.is_replacement && prevR.replacement_type === 'initial') {
            // Normal reading after new meter - consumption from initial
            cons = (parseFloat(r.value) - parseFloat(prevR.value)).toFixed(2);
          } else if (prevR && prevR.is_replacement && prevR.replacement_type === 'final') {
            // Should not happen with correct sort, but safety
            cons = null;
          } else if (prevR) {
            // Normal vs normal
            cons = (parseFloat(r.value) - parseFloat(prevR.value)).toFixed(2);
          }

          var replBadge = '';
          if (isRepl && replType === 'final') replBadge = '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-500">KONEČNÝ</span>';
          if (isRepl && replType === 'initial') replBadge = '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">NOVÝ MERAČ</span>';
          var prevLabel = '';
          if (prevR && !isRepl && !(prevR.is_replacement && prevR.replacement_type === 'final')) {
            prevLabel = '<span class="text-slate-300">pred: ' + parseFloat(prevR.value).toFixed(2) + '</span>';
          } else {
            prevLabel = '<span class="text-slate-300">--</span>';
          }
          var deductBadge = r.deduction ? '<span class="text-[7px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-600">-' + parseFloat(r.deduction).toFixed(0) + ' ' + m.unit + '</span>' : '';
          return '<div class="flex items-center justify-between text-[9px] text-slate-500 bg-white rounded-lg px-3 py-1.5' + (isRepl ? ' border border-amber-200' : '') + '">' +
            '<span>' + fmtD(r.date) + '</span>' +
            replBadge +
            '<span class="font-bold">' + parseFloat(r.value).toFixed(2) + ' ' + m.unit + '</span>' +
            prevLabel +
            '<span class="text-green-600 font-bold">' + (cons !== null ? '+' + cons : '--') + '</span>' +
            deductBadge +
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
  document.getElementById('mtr-deduction').value = '';
  document.getElementById('mtr-deduction-note').value = '';
  document.getElementById('mtr-has-deduction').checked = false;
  document.getElementById('mtr-deduction-row').classList.add('hidden');
  document.getElementById('modal-meter').classList.remove('hidden');
};

// Show/hide deduction when category changes
var mtrCatSel = document.getElementById('mtr-category');
if (mtrCatSel) mtrCatSel.addEventListener('change', function() {
  document.getElementById('mtr-deduction-row').classList.toggle('hidden', !this.value);
});

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
  document.getElementById('mtr-deduction-note').value = m.deduction_note || '';
  document.getElementById('mtr-has-deduction').checked = m.has_deduction || false;
  // Show deduction row if category is set (redirected meter)
  document.getElementById('mtr-deduction-row').classList.toggle('hidden', !m.cost_category_id);

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
    note: document.getElementById('mtr-note').value.trim() || null,
    has_deduction: document.getElementById('mtr-has-deduction').checked || false,
    deduction_note: document.getElementById('mtr-deduction-note').value.trim() || null
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

  // Check if any meter-based expenses use this meter and may need recalculation
  if (editingMeterId) {
    var { data: meterExpenses = [] } = await sb.from('expenses')
      .select('id, description, period_from, date')
      .eq('alloc_method', 'meter')
      .order('date', { ascending: false })
      .limit(10);

    if (meterExpenses.length > 0) {
      var names = meterExpenses.slice(0, 5).map(function(e) {
        return '\u2022 ' + e.description + (e.period_from ? ' (' + e.period_from.substring(0, 4) + ')' : '');
      }).join('\n');
      var more = meterExpenses.length > 5 ? '\n... a \u010Fal\u0161ie' : '';

      if (confirm('Zmena mera\u010Da m\u00F4\u017Ee ovplyvni\u0165 tieto fakt\u00FAry:\n\n' + names + more + '\n\nChcete otvori\u0165 prv\u00FA na prepo\u010D\u00EDtanie?\n(Otvorte ka\u017Ed\u00FA meter-based fakt\u00FAru a kliknite Ulo\u017Ei\u0165)')) {
        document.getElementById('modal-meter').classList.add('hidden');
        await loadMeters();
        await window.editExpense(meterExpenses[0].id);
        return;
      }
    }
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
  document.getElementById('rdg-deduction').value = '';
  // Show deduction field if meter has it enabled
  var showDed = meter && meter.has_deduction;
  document.getElementById('rdg-deduction-row').classList.toggle('hidden', !showDed);
  if (showDed) {
    document.getElementById('rdg-deduction-label').innerText = 'Odpočet' + (meter.deduction_note ? ' (' + meter.deduction_note + ')' : '') + ' – ' + (meter.unit || 'kWh');
  }

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
  document.getElementById('rdg-deduction').value = r.deduction || '';
  // Show deduction field if meter has it enabled
  var showDed2 = meter && meter.has_deduction;
  document.getElementById('rdg-deduction-row').classList.toggle('hidden', !showDed2);
  if (showDed2) {
    document.getElementById('rdg-deduction-label').innerText = 'Odpočet' + (meter.deduction_note ? ' (' + meter.deduction_note + ')' : '') + ' – ' + (meter.unit || 'kWh');
  }

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
  var deductionVal = parseFloat(document.getElementById('rdg-deduction').value) || null;
  var data = {
    meter_id: currentReadingMeterId,
    date: document.getElementById('rdg-date').value,
    value: parseFloat(document.getElementById('rdg-value').value) || 0,
    note: document.getElementById('rdg-note').value.trim() || null,
    deduction: deductionVal,
    created_by: currentUserId
  };
  if (!data.value && data.value !== 0) { alert('Zadajte stav merača.'); return; }

  if (editingReadingId) {
    await sb.from('meter_readings').update({ date: data.date, value: data.value, note: data.note, deduction: data.deduction }).eq('id', editingReadingId);
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

// ---- VÝMENA MERAČA ----
var replacementMeterId = null;

window.showMeterReplacement = async function(meterId) {
  replacementMeterId = meterId;
  var meter = allMeters.find(function(m) { return m.id === meterId; });
  if (!meter) return;

  document.getElementById('repl-meter-name').innerText = meter.name;
  document.getElementById('repl-old-number').innerText = meter.meter_number || '(bez čísla)';
  document.getElementById('repl-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('repl-old-final').value = '';
  document.getElementById('repl-new-number').value = '';
  document.getElementById('repl-new-initial').value = '0';

  // Show last reading
  var { data: lastReadings = [] } = await sb.from('meter_readings').select('*').eq('meter_id', meterId).order('date', { ascending: false }).limit(1);
  if (lastReadings.length > 0) {
    var lr = lastReadings[0];
    document.getElementById('repl-old-last').innerText = parseFloat(lr.value).toFixed(2) + ' ' + meter.unit + ' (' + fmtD(lr.date) + ')';
    document.getElementById('repl-old-final').value = lr.value;
  } else {
    document.getElementById('repl-old-last').innerText = 'žiadne';
  }

  document.getElementById('modal-replacement').classList.remove('hidden');
};

window.saveMeterReplacement = async function() {
  if (!replacementMeterId) return;
  var meter = allMeters.find(function(m) { return m.id === replacementMeterId; });
  if (!meter) return;

  var replDate = document.getElementById('repl-date').value;
  var oldFinal = parseFloat(document.getElementById('repl-old-final').value);
  var newNumber = document.getElementById('repl-new-number').value.trim();
  var newInitial = parseFloat(document.getElementById('repl-new-initial').value) || 0;

  if (!replDate) { alert('Zadajte dátum výmeny.'); return; }
  if (isNaN(oldFinal)) { alert('Zadajte konečný stav starého merača.'); return; }

  // 1. Insert final reading for old meter
  await sb.from('meter_readings').insert({
    meter_id: replacementMeterId,
    date: replDate,
    value: oldFinal,
    note: 'Výmena – konečný stav #' + (meter.meter_number || ''),
    is_replacement: true,
    replacement_type: 'final',
    created_by: currentUserId
  });

  // 2. Insert initial reading for new meter
  await sb.from('meter_readings').insert({
    meter_id: replacementMeterId,
    date: replDate,
    value: newInitial,
    note: 'Výmena – počiatočný stav #' + (newNumber || ''),
    is_replacement: true,
    replacement_type: 'initial',
    created_by: currentUserId
  });

  // 3. Update meter with new number, save old
  var updateData = {
    previous_meter_number: meter.meter_number,
    replacement_date: replDate
  };
  if (newNumber) updateData.meter_number = newNumber;

  await sb.from('meters').update(updateData).eq('id', replacementMeterId);

  document.getElementById('modal-replacement').classList.add('hidden');
  await loadMeters();
  alert('Merač vymenený. Staré číslo: ' + (meter.meter_number || '–') + ' → Nové: ' + (newNumber || '–'));
};

window.loadExpenses = async function() {
  var year = document.getElementById('fin-year').value;
  var catFilter = document.getElementById('fin-cat-filter').value;
  var dateMode = document.getElementById('fin-date-mode').value;

  var query = sb.from('expenses').select('*, cost_categories(name, empty_zone_rule), zones(name, tenant_name), expense_allocations(*, zones(name, tenant_name))');

  if (year) {
    if (dateMode === 'period') {
      query = query.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    } else {
      query = query.gte('date', year + '-01-01').lte('date', year + '-12-31');
    }
  }

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
    if (catFilter !== 'all') q2 = q2.eq('category_id', catFilter);
    var r2 = await q2;
    expenses = r2.data || [];
  }

  // Client-side sorting
  var sortBy = document.getElementById('fin-sort') ? document.getElementById('fin-sort').value : 'ref';
  // Helper: compare ref numbers like "24-90" vs "24-91"
  function compareRef(ra, rb) {
    if (!ra && !rb) return 0;
    if (!ra) return 1;
    if (!rb) return -1;
    var pa = ra.split(/[-\/]/); 
    var pb = rb.split(/[-\/]/);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var na = i < pa.length ? (parseInt(pa[i]) || 0) : 0;
      var nb = i < pb.length ? (parseInt(pb[i]) || 0) : 0;
      if (na !== nb) return na - nb;
    }
    return 0;
  }

  expenses.sort(function(a, b) {
    switch (sortBy) {
      case 'ref':
        var rc = compareRef(a.ref_number, b.ref_number);
        if (rc !== 0) return rc;
        return (a.date || '').localeCompare(b.date || '');
      case 'date':
        return (b.date || '').localeCompare(a.date || '');
      case 'category':
        var ca = a.cost_categories ? a.cost_categories.name : '';
        var cb = b.cost_categories ? b.cost_categories.name : '';
        if (ca !== cb) return ca.localeCompare(cb);
        return (a.date || '').localeCompare(b.date || '');
      case 'supplier':
        var sa = (a.supplier || '').toLowerCase();
        var sb2 = (b.supplier || '').toLowerCase();
        if (sa !== sb2) return sa.localeCompare(sb2);
        return (a.date || '').localeCompare(b.date || '');
      case 'amount':
        return (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0);
      default:
        return (b.date || '').localeCompare(a.date || '');
    }
  });

  var list = document.getElementById('fin-expenses-list');
  if (expenses.length === 0) {
    list.innerHTML = '<p class="text-center py-8 text-[10px] text-slate-200 font-bold uppercase">Žiadne náklady</p>';
    document.getElementById('fin-total-amount').innerText = '0 €';
    return;
  }

  // Build zone maps for mismatch detection
  var zoneTemperMap = {};
  var zoneAreaMap = {};
  allZones.forEach(function(z) {
    zoneTemperMap[z.id] = z.tempering_pct || 0;
    zoneAreaMap[z.id] = z.area_m2 || 0;
  });

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
    var isAutoGenerated = e.is_auto_generated;
    if (isAutoGenerated) costTypeBadge += '<span class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600">🔗 AUTO</span>';

    // Mismatch detection (tempering + area)
    var warnings = [];
    var isHeatingCat = e.cost_categories && e.cost_categories.empty_zone_rule === 'owner_temper';
    if (allocCount > 0) {
      var temperMismatches = [];
      var areaMismatches = [];
      var hasNoData = false;
      e.expense_allocations.forEach(function(a) {
        var zName = a.zones ? (a.zones.tenant_name || a.zones.name) : '?';
        // Tempering check (only for heating)
        if (isHeatingCat) {
          if (a.tempering_used != null) {
            var currTemp = zoneTemperMap[a.zone_id] || 0;
            if (parseFloat(a.tempering_used) !== currTemp) {
              temperMismatches.push(zName + ': ' + a.tempering_used + '% → ' + currTemp + '%');
            }
          } else {
            hasNoData = true;
          }
        }
        // Area check (for all area-based expenses)
        if (a.area_used != null) {
          var currArea = zoneAreaMap[a.zone_id] || 0;
          if (parseFloat(a.area_used) !== currArea) {
            areaMismatches.push(zName + ': ' + a.area_used + ' → ' + currArea + ' m²');
          }
        }
      });
      if (temperMismatches.length > 0) {
        warnings.push('<button onclick="event.stopPropagation();window.recalcExpense(\'' + e.id + '\')" class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 hover:bg-red-200 cursor-pointer" title="Temperovanie zmenené: ' + temperMismatches.join(', ') + '">⚠️ temp</button>');
      } else if (isHeatingCat && hasNoData) {
        warnings.push('<button onclick="event.stopPropagation();window.recalcExpense(\'' + e.id + '\')" class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-600 hover:bg-yellow-200 cursor-pointer" title="Chýba tempering info">🔄 temp</button>');
      }
      if (areaMismatches.length > 0) {
        warnings.push('<button onclick="event.stopPropagation();window.recalcExpense(\'' + e.id + '\')" class="text-[7px] font-bold px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200 cursor-pointer" title="Plocha zmenená: ' + areaMismatches.join(', ') + '">⚠️ m²</button>');
      }
    }
    var warningHtml = warnings.join(' ');

    return '<div class="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center space-x-2">' +
          '<span class="text-[8px] font-black text-slate-400 uppercase">' + fmtD(e.date) + '</span>' +
          (e.ref_number ? '<span class="text-[8px] font-bold text-amber-500">#' + e.ref_number + '</span>' : '') +
          '<span class="text-[8px] font-bold text-blue-500 uppercase">' + catName + '</span>' +
          costTypeBadge +
          warningHtml +
          '<span class="text-[8px] text-slate-300">' + zoneName + '</span>' +
        '</div>' +
        '<p class="text-xs font-bold text-slate-700 truncate">' + e.description + '</p>' +
        (function() {
          var parts = [];
          if (e.supplier) parts.push(e.supplier);
          if (e.invoice_number) parts.push(e.invoice_number);
          if (e.billing_period_from && e.billing_period_from !== e.period_from) {
            parts.push('fakt: ' + fmtD(e.billing_period_from) + '–' + fmtD(e.billing_period_to));
          }
          if (e.period_from) parts.push('zúčt: ' + fmtD(e.period_from) + '–' + fmtD(e.period_to));
          return parts.length ? '<p class="text-[8px] text-slate-400">' + parts.join(' • ') + '</p>' : '';
        })() +
      '</div>' +
      '<div class="flex items-center space-x-3 ml-3">' +
        (e.receipt_url ? (e.receipt_url.match(/\.pdf$/i) ?
          '<a href="' + e.receipt_url + '" target="_blank" class="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center border border-red-200 hover:border-red-400 cursor-pointer shrink-0"><i class="fa-solid fa-file-pdf text-red-500"></i></a>' :
          '<img src="' + e.receipt_url + '" onclick="window.open(\'' + e.receipt_url + '\')" class="w-10 h-10 object-cover rounded-lg cursor-pointer border border-slate-200 hover:border-blue-400 shrink-0">') : '') +
        '<span class="text-sm font-black text-slate-900 whitespace-nowrap">' + parseFloat(e.amount).toFixed(2) + ' €</span>' +
        '<button onclick="event.stopPropagation();window.duplicateExpense(\'' + e.id + '\')" class="text-blue-300 hover:text-blue-500 text-xs" title="Duplikát"><i class="fa-solid fa-copy"></i></button>' +
        (isAutoGenerated ?
          '<span class="text-[7px] text-blue-400 cursor-pointer" onclick="window.editExpense(\'' + e.parent_expense_id + '\')" title="Upraviť cez rodičovskú faktúru"><i class="fa-solid fa-link"></i></span>' :
          '<button onclick="window.editExpense(\'' + e.id + '\')" class="text-blue-400 hover:text-blue-600 text-xs"><i class="fa-solid fa-pen"></i></button>' +
          '<button onclick="window.deleteExpense(\'' + e.id + '\')" class="text-red-300 hover:text-red-500 text-xs"><i class="fa-solid fa-trash"></i></button>'
        ) +
      '</div>' +
    '</div>';
  }).join('') + '</div>';

  document.getElementById('fin-total-amount').innerText = total.toFixed(2) + ' €';
};

// Recalculate expense with current zone settings (tempering, areas)
window.recalcExpense = async function(id) {
  if (!confirm('Otvoriť náklad na prepočítanie s aktuálnymi hodnotami (plochy, temperovanie)?\n\nPo otvorení skontrolujte náhľad a kliknite Uložiť.')) return;
  await window.editExpense(id);
};

// Consistency check - analyze expenses for potential issues
window.runConsistencyCheck = async function() {
  var report = document.getElementById('consistency-report');
  report.innerHTML = '<p class="text-[9px] text-slate-400 text-center py-2">Analyzujem...</p>';
  report.classList.remove('hidden');

  var year = document.getElementById('fin-year').value;
  var dateMode = document.getElementById('fin-date-mode').value;
  var query = sb.from('expenses').select('*, cost_categories(name, empty_zone_rule), expense_allocations(*, zones(name, tenant_name))');
  if (year) {
    if (dateMode === 'period') {
      query = query.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    } else {
      query = query.gte('date', year + '-01-01').lte('date', year + '-12-31');
    }
  }
  var { data: expenses = [] } = await query;
  var filterLabel = year ? (year + ', ' + (dateMode === 'period' ? 'zúčt. obdobie' : 'dátum faktúry')) : 'všetky roky';
  if (expenses.length === 0) {
    report.innerHTML = '<p class="text-[9px] text-slate-400 text-center py-2">Žiadne náklady na kontrolu.</p>';
    return;
  }

  // Helper: expense label
  function expLabel(e) {
    return e.ref_number ? '#' + e.ref_number : (e.description || '').substring(0, 25);
  }
  function expRef(e) {
    var ref = e.ref_number ? '#' + e.ref_number : '(bez ref.)';
    var amt = parseFloat(e.amount).toFixed(0) + '€';
    return '<b>' + ref + '</b> ' + amt;
  }

  var issues = [];
  var zoneTemperMap = {};
  var zoneAreaMap = {};
  allZones.forEach(function(z) {
    zoneTemperMap[z.id] = z.tempering_pct || 0;
    zoneAreaMap[z.id] = z.area_m2 || 0;
  });

  // 1. Tempering mismatches
  var temperIssues = [];
  expenses.forEach(function(e) {
    var isHeating = e.cost_categories && e.cost_categories.empty_zone_rule === 'owner_temper';
    if (!isHeating || !e.expense_allocations) return;
    var mismatches = [];
    e.expense_allocations.forEach(function(a) {
      if (a.tempering_used != null) {
        var curr = zoneTemperMap[a.zone_id] || 0;
        if (parseFloat(a.tempering_used) !== curr) {
          var zName = a.zones ? (a.zones.tenant_name || a.zones.name) : '?';
          mismatches.push(zName + ': ' + a.tempering_used + '% → ' + curr + '%');
        }
      }
    });
    if (mismatches.length > 0) {
      temperIssues.push({ ref: expRef(e), zones: mismatches.join(', ') });
    }
  });
  if (temperIssues.length > 0) {
    var details = temperIssues.map(function(t) {
      return t.ref + ' – ' + t.zones;
    }).join('<br>');
    issues.push({ type: 'danger', icon: '⚠️', title: 'Temperovanie zmenené (' + temperIssues.length + ')', detail: details });
  }

  // 2. Area mismatches
  var areaExpenses = [];
  expenses.forEach(function(e) {
    if (!e.expense_allocations) return;
    var mismatches = [];
    e.expense_allocations.forEach(function(a) {
      if (a.area_used != null) {
        var curr = zoneAreaMap[a.zone_id] || 0;
        if (parseFloat(a.area_used) !== curr) {
          var zName = a.zones ? (a.zones.tenant_name || a.zones.name) : '?';
          mismatches.push(zName + ': ' + a.area_used + ' → ' + curr + ' m²');
        }
      }
    });
    if (mismatches.length > 0) {
      areaExpenses.push({ ref: expRef(e), zones: mismatches.join(', ') });
    }
  });
  if (areaExpenses.length > 0) {
    var details = areaExpenses.map(function(t) {
      return t.ref + ' – ' + t.zones;
    }).join('<br>');
    issues.push({ type: 'danger', icon: '⚠️', title: 'Plocha zmenená (' + areaExpenses.length + ')', detail: details });
  }

  // 3. Missing tracking data (pre-migration) - list ref numbers
  var noDataList = [];
  expenses.forEach(function(e) {
    if (!e.expense_allocations || e.expense_allocations.length === 0) return;
    var hasAny = e.expense_allocations.some(function(a) { return a.tempering_used != null || a.area_used != null; });
    if (!hasAny) noDataList.push(expLabel(e));
  });
  if (noDataList.length > 0) {
    issues.push({ type: 'warning', icon: '🔄', title: 'Bez sledovacích údajov (' + noDataList.length + ')', detail: 'Treba otvoriť a uložiť: ' + noDataList.join(', ') });
  }

  // 4. Same category + same period - different zone selections
  var catPeriodMap = {};
  expenses.forEach(function(e) {
    if (!e.period_from || !e.period_to || !e.expense_allocations || e.expense_allocations.length === 0) return;
    var key = (e.category_id || '') + '|' + e.period_from + '|' + e.period_to;
    if (!catPeriodMap[key]) catPeriodMap[key] = [];
    catPeriodMap[key].push(e);
  });
  var zoneDiffIssues = [];
  Object.keys(catPeriodMap).forEach(function(key) {
    var group = catPeriodMap[key];
    if (group.length < 2) return;
    var zoneSets = group.map(function(e) {
      return e.expense_allocations.filter(function(a) { return a.payer !== 'owner'; }).map(function(a) { return a.zone_id; }).sort().join(',');
    });
    var unique = zoneSets.filter(function(v, i, a) { return a.indexOf(v) === i; });
    if (unique.length > 1) {
      var catName = group[0].cost_categories ? group[0].cost_categories.name : '?';
      var period = fmtD(group[0].period_from) + ' – ' + fmtD(group[0].period_to);
      var refs = group.map(function(e) { return expLabel(e); }).join(', ');
      zoneDiffIssues.push({ category: catName, period: period, refs: refs });
    }
  });
  if (zoneDiffIssues.length > 0) {
    var details = zoneDiffIssues.map(function(z) {
      return '<b>' + z.category + '</b> ' + z.period + '<br><span class="text-[8px]">→ ' + z.refs + '</span>';
    }).join('<br>');
    issues.push({ type: 'info', icon: '🔀', title: 'Rôzne zóny v rovnakom období (' + zoneDiffIssues.length + ')', detail: details });
  }

  // 5. Same supplier + category + identical period (potential duplicates)
  var supplierMap = {};
  expenses.forEach(function(e) {
    if (!e.supplier || !e.period_from) return;
    var key = (e.supplier || '').toLowerCase().trim() + '|' + (e.category_id || '');
    if (!supplierMap[key]) supplierMap[key] = [];
    supplierMap[key].push(e);
  });
  var overlapIssues = [];
  Object.keys(supplierMap).forEach(function(key) {
    var group = supplierMap[key];
    if (group.length < 2) return;
    // Find groups with same period
    var periodGroups = {};
    group.forEach(function(e) {
      var pk = e.period_from + '|' + e.period_to;
      if (!periodGroups[pk]) periodGroups[pk] = [];
      periodGroups[pk].push(e);
    });
    Object.keys(periodGroups).forEach(function(pk) {
      var pg = periodGroups[pk];
      if (pg.length < 2) return;
      var catName = pg[0].cost_categories ? pg[0].cost_categories.name : '?';
      var period = fmtD(pg[0].period_from) + ' – ' + fmtD(pg[0].period_to);
      var refs = pg.map(function(e) { return expRef(e); }).join(', ');
      overlapIssues.push({ supplier: pg[0].supplier, category: catName, period: period, refs: refs });
    });
  });
  if (overlapIssues.length > 0) {
    var details = overlapIssues.map(function(o) {
      return '<b>' + o.supplier + '</b> • ' + o.category + ' • ' + o.period + '<br><span class="text-[8px]">→ ' + o.refs + '</span>';
    }).join('<br>');
    issues.push({ type: 'info', icon: '📋', title: 'Rovnaký dodávateľ + obdobie (' + overlapIssues.length + ')', detail: details });
  }

  // 6. Expenses without allocations - list ref numbers
  var noAllocList = [];
  expenses.forEach(function(e) {
    if (!e.expense_allocations || e.expense_allocations.length === 0) {
      noAllocList.push(expLabel(e));
    }
  });
  if (noAllocList.length > 0) {
    issues.push({ type: 'warning', icon: '❓', title: 'Bez rozpočítania (' + noAllocList.length + ')', detail: noAllocList.join(', ') });
  }

  // 6b. Allocation sum mismatch - saved allocations don't add up to expense amount
  var mismatchList = [];
  expenses.forEach(function(e) {
    if (!e.expense_allocations || e.expense_allocations.length === 0) return;
    if (e.is_auto_generated) return; // skip auto-generated children
    var allocTotal = e.expense_allocations.reduce(function(s, a) { return s + (parseFloat(a.amount) || 0); }, 0);
    var expAmount = parseFloat(e.amount) || 0;
    // For amortized, compare yearly amount
    if (e.cost_type === 'amortized' && e.amort_years > 0) {
      expAmount = expAmount / e.amort_years;
    }
    var diff = Math.abs(allocTotal - expAmount);
    var diffPct = Math.abs(expAmount) > 0 ? (diff / Math.abs(expAmount) * 100) : 0;
    // Only flag significant mismatches: >1% AND >5€ (small rounding from meter calculations is normal)
    if (diff > 5 && diffPct > 1) {
      mismatchList.push(expLabel(e) + ': <b>' + expAmount.toFixed(2) + ' €</b> vs alokované <b>' + allocTotal.toFixed(2) + ' €</b> (rozdiel ' + diff.toFixed(2) + ' €)');
    }
  });
  if (mismatchList.length > 0) {
    issues.push({ type: 'danger', icon: '💰', title: 'Nesúlad suma vs. alokácie (' + mismatchList.length + ')', detail: mismatchList.join('<br>') });
  }

  // 7. Meter consistency checks
  if (year) {
    var periodStart = year + '-01-01';
    var periodEnd = year + '-12-31';

    // Load all meters and readings
    var { data: checkMeters = [] } = await sb.from('meters').select('*, cost_categories(name)').order('sort_order', { ascending: true });
    var meterIds = checkMeters.map(function(m) { return m.id; });
    var { data: checkReadings = [] } = await sb.from('meter_readings').select('*')
      .in('meter_id', meterIds.length > 0 ? meterIds : ['none'])
      .order('date', { ascending: true });
    var { data: checkMeterZones = [] } = await sb.from('meter_zones').select('meter_id, zone_id');

    // Check each meter type group
    var meterTypes = ['water', 'electricity', 'gas'];
    var typeLabels = { water: 'Voda', electricity: 'Elektrina', gas: 'Plyn' };

    meterTypes.forEach(function(mType) {
      var typeMeters = checkMeters.filter(function(m) { return m.type === mType; });
      if (typeMeters.length === 0) return;

      var mainM = typeMeters.find(function(m) { return m.is_main; });
      var subMs = typeMeters.filter(function(m) { return !m.is_main && !m.cost_category_id; });
      var meterIssues = [];

      // 7a. Meters without zone assignments (skip gas and redirected meters - they don't need zones)
      if (mType !== 'gas') {
        subMs.forEach(function(m) {
          if (m.cost_category_id) return; // redirected meter, no zones needed
          var zones = checkMeterZones.filter(function(mz) { return mz.meter_id === m.id; });
          if (zones.length === 0) {
            meterIssues.push('<b>' + m.name + '</b>: <span class="text-red-600">nemá priradené zóny!</span>');
          }
        });
      }

      // 7b. Meters with insufficient readings for period
      typeMeters.forEach(function(m) {
        var mRdgs = checkReadings.filter(function(r) { return r.meter_id === m.id; });
        var inPeriod = mRdgs.filter(function(r) { return r.date >= periodStart && r.date <= periodEnd; });
        var beforePeriod = mRdgs.filter(function(r) { return r.date < periodStart; });

        if (mRdgs.length === 0) {
          meterIssues.push('<b>' + m.name + '</b>: žiadne odčítania vôbec');
        } else if (mRdgs.length === 1) {
          var isZero = parseFloat(mRdgs[0].value) === 0;
          if (!isZero) {
            meterIssues.push('<b>' + m.name + '</b>: len 1 odčítanie – spotreba sa nedá vypočítať');
          }
        } else if (inPeriod.length === 0 && beforePeriod.length > 0) {
          var lastR = mRdgs[mRdgs.length - 1];
          meterIssues.push('<b>' + m.name + '</b>: posledné odčítanie ' + fmtD(lastR.date));
        } else {
          // 7c. Check that there are readings BEFORE and IN/AFTER period
          var hasBeforeOrAtStart = mRdgs.some(function(r) { return r.date <= periodStart; });
          if (!hasBeforeOrAtStart && !m.is_main) {
            var firstR = mRdgs[0];
            meterIssues.push('<b>' + m.name + '</b>: prvé odčítanie ' + fmtD(firstR.date) + ' – chýba počiatočný stav pred ' + year);
          }
        }
      });

      // 7d. Main vs sub consumption comparison
      if (mainM) {
        var mainRdgs = checkReadings.filter(function(r) { return r.meter_id === mainM.id && !r.is_replacement; });
        var mainStart = mainRdgs.filter(function(r) { return r.date <= periodStart; });
        var mainEnd = mainRdgs.filter(function(r) { return r.date <= periodEnd; });
        var mStartR = mainStart.length > 0 ? mainStart[mainStart.length - 1] : (mainRdgs.length > 0 ? mainRdgs[0] : null);
        var mEndR = mainEnd.length > 0 ? mainEnd[mainEnd.length - 1] : null;

        if (mStartR && mEndR && mStartR.id !== mEndR.id) {
          var mainCons = parseFloat(mEndR.value) - parseFloat(mStartR.value);
          var subTotal = 0;

          subMs.forEach(function(sm) {
            var sRdgs = checkReadings.filter(function(r) { return r.meter_id === sm.id && !r.is_replacement; });
            var sStart = sRdgs.filter(function(r) { return r.date <= periodStart; });
            var sEnd = sRdgs.filter(function(r) { return r.date <= periodEnd; });
            var sS = sStart.length > 0 ? sStart[sStart.length - 1] : (sRdgs.length > 0 ? sRdgs[0] : null);
            var sE = sEnd.length > 0 ? sEnd[sEnd.length - 1] : null;
            if (sS && sE && sS.id !== sE.id) {
              subTotal += parseFloat(sE.value) - parseFloat(sS.value);
            }
          });

          if (mainCons > 0) {
            var lossPct = ((mainCons - subTotal) / mainCons * 100);
            if (lossPct > 20) {
              meterIssues.push('Straty ' + lossPct.toFixed(0) + '% (' + typeLabels[mType] + ': hlavný ' + mainCons.toFixed(0) + ' – podmerače ' + subTotal.toFixed(0) + ')');
            }
            if (subTotal > mainCons) {
              meterIssues.push('<span class="text-red-600">Podmerače (' + subTotal.toFixed(0) + ') > hlavný (' + mainCons.toFixed(0) + ')!</span>');
            }
          }
        }
      }

      if (meterIssues.length > 0) {
        issues.push({ type: 'warning', icon: '🔧', title: typeLabels[mType] + ' – merače', detail: meterIssues.join('<br>') });
      }
    });

    // 8. Meter-based expenses: check for stale/wrong allocations
    var meterExpIssues = [];
    expenses.forEach(function(e) {
      if (e.alloc_method !== 'meter' || !e.expense_allocations || e.expense_allocations.length === 0) return;
      if (e.is_auto_generated) return;

      // 8a. Meter expense missing main meter data
      if (e.meter_main_consumption == null && e.meter_sub_consumption == null) {
        meterExpIssues.push(expRef(e) + ' – <span class="text-red-600">nemá uložené meter údaje</span> (treba otvoriť a uložiť)');
      }

      // 8b. Check for zones that shouldn't be in this expense (no meter for them)
      var catName = e.cost_categories ? e.cost_categories.name : '';
      var catMeterType2 = null;
      if (catName.match(/vod|kanal/i)) catMeterType2 = 'water';
      else if (catName.match(/elektr/i)) catMeterType2 = 'electricity';
      else if (catName.match(/plyn|vykur/i)) catMeterType2 = 'gas';

      if (catMeterType2) {
        var typeMs = checkMeters.filter(function(m) { return m.type === catMeterType2 && !m.is_main && !m.cost_category_id; });
        var coveredZoneIds = [];
        typeMs.forEach(function(m) {
          checkMeterZones.filter(function(mz) { return mz.meter_id === m.id; }).forEach(function(mz) {
            if (coveredZoneIds.indexOf(mz.zone_id) < 0) coveredZoneIds.push(mz.zone_id);
          });
        });

        var unexpectedZones = [];
        e.expense_allocations.forEach(function(a) {
          if (a.payer === 'owner') return;
          if (coveredZoneIds.indexOf(a.zone_id) < 0) {
            var zName = a.zones ? (a.zones.tenant_name || a.zones.name) : '?';
            unexpectedZones.push(zName);
          }
        });

        if (unexpectedZones.length > 0) {
          meterExpIssues.push(expRef(e) + ' – zóny <b>bez merača</b> v alokácii: <span class="text-red-600">' + unexpectedZones.join(', ') + '</span>');
        }
      }
    });

    if (meterExpIssues.length > 0) {
      issues.push({ type: 'danger', icon: '⚡', title: 'Meter-based faktúry – problémy', detail: meterExpIssues.join('<br>') });
    }

    // 9. Area-based expenses that SHOULD be meter-based (category has meters but expense uses area)
    var shouldBeMeter = [];
    expenses.forEach(function(e) {
      if (e.alloc_method === 'meter' || e.is_auto_generated) return;
      if (!e.expense_allocations || e.expense_allocations.length === 0) return;
      var catName = e.cost_categories ? e.cost_categories.name : '';
      var catMeterType3 = null;
      if (catName.match(/vod|kanal/i)) catMeterType3 = 'water';
      else if (catName.match(/elektr/i)) catMeterType3 = 'electricity';
      else if (catName.match(/plyn/i)) catMeterType3 = 'gas';

      if (catMeterType3) {
        var hasMeters = checkMeters.some(function(m) { return m.type === catMeterType3 && !m.cost_category_id; });
        if (hasMeters) {
          shouldBeMeter.push(expRef(e) + ' <span class="text-slate-500">(' + catName + ' – podľa plochy, ale existujú merače)</span>');
        }
      }
    });
    if (shouldBeMeter.length > 0) {
      issues.push({ type: 'warning', icon: '📐', title: 'Podľa plochy, ale existujú merače (' + shouldBeMeter.length + ')', detail: shouldBeMeter.join('<br>') });
    }
  }

  // Render
  if (issues.length === 0) {
    report.innerHTML = '<div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center">' +
      '<span class="text-green-600 font-bold text-sm">\u2705 V\u0161etko v poriadku</span>' +
      '<p class="text-[9px] text-green-500 mt-1">' + expenses.length + ' fakt\u00far \u2013 ' + filterLabel + '</p>' +
      '<button onclick="document.getElementById(\'consistency-report\').classList.add(\'hidden\')" class="text-[8px] text-green-400 mt-1 hover:text-green-600">zavrie\u0165</button>' +
    '</div>';
  } else {
    var colors = { danger: ['bg-red-50 border-red-200', 'text-red-700', 'text-red-600'], warning: ['bg-yellow-50 border-yellow-200', 'text-yellow-700', 'text-yellow-600'], info: ['bg-blue-50 border-blue-200', 'text-blue-700', 'text-blue-600'] };
    report.innerHTML = '<div class="bg-white border border-amber-200 rounded-xl p-4 space-y-2">' +
      '<div class="flex justify-between items-center">' +
        '<span class="text-[9px] font-black text-amber-600 uppercase">Kontrola \u2013 ' + filterLabel + '</span>' +
        '<button onclick="document.getElementById(\'consistency-report\').classList.add(\'hidden\')" class="text-slate-300 hover:text-slate-500 text-sm">&times;</button>' +
      '</div>' +
      issues.map(function(issue) {
        var c = colors[issue.type] || ['bg-slate-50 border-slate-200', 'text-slate-700', 'text-slate-600'];
        return '<div class="' + c[0] + ' rounded-lg p-3">' +
          '<div class="flex items-start gap-2">' +
            '<span class="text-sm">' + issue.icon + '</span>' +
            '<div class="flex-1 min-w-0">' +
              '<p class="text-[10px] font-bold ' + c[1] + '">' + issue.title + '</p>' +
              '<p class="text-[9px] ' + c[2] + ' mt-0.5">' + issue.detail + '</p>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }
};

// ============ RECONCILIATION REPORT ============
window.runReconciliation = async function() {
  var report = document.getElementById('consistency-report');
  if (!report) return;
  report.classList.remove('hidden');
  report.innerHTML = '<p class="text-[9px] text-slate-400">Načítavam...</p>';

  var year = document.getElementById('fin-year').value;
  if (!year) { report.innerHTML = '<p class="text-[9px] text-red-400">Vyberte rok.</p>'; return; }

  var periodStart = year + '-01-01', periodEnd = year + '-12-31';

  // Use SAME query logic as overview (billing period overlap)
  var fields = 'id, description, supplier, amount, date, period_from, period_to, category_id, alloc_method, cost_type, amort_years, ref_number, is_auto_generated, parent_expense_id, cost_categories(name), expense_allocations(amount, payer, zone_id, zones(name, tenant_name))';

  // 1. Expenses with billing period overlapping the year
  var { data: exp1 = [] } = await sb.from('expenses').select(fields)
    .lte('period_from', periodEnd).gte('period_to', periodStart);

  // 2. Expenses without billing period but with date in year
  var { data: exp2 = [] } = await sb.from('expenses').select(fields)
    .is('period_from', null).gte('date', periodStart).lte('date', periodEnd);

  // Deduplicate
  var expMap = {};
  exp1.concat(exp2).forEach(function(e) { expMap[e.id] = e; });
  var allExp = Object.values(expMap);

  // Build map of parent → child expenses (redirected amounts)
  var childAmountsByParent = {};
  var childExpenseIds = {};
  allExp.forEach(function(e) {
    if (e.parent_expense_id) {
      if (!childAmountsByParent[e.parent_expense_id]) childAmountsByParent[e.parent_expense_id] = 0;
      childAmountsByParent[e.parent_expense_id] += parseFloat(e.amount) || 0;
      childExpenseIds[e.id] = true;
    }
  });

  // Process each expense
  var byCat = {};
  var byType = { operating: { label: 'Prevádzkové', amount: 0, alloc: 0, count: 0 }, amortized: { label: 'Amortizované (ročný podiel)', amount: 0, alloc: 0, count: 0 }, investment: { label: 'Investičné', amount: 0, alloc: 0, count: 0 } };
  var grandTotals = { expAmount: 0, expFull: 0, allocTenant: 0, allocOwner: 0, allocTotal: 0, noAlloc: 0, count: 0, childRedirected: 0 };

  allExp.forEach(function(e) {
    var catName = e.cost_categories ? e.cost_categories.name : 'Bez kategórie';
    if (!byCat[catName]) byCat[catName] = { expenses: [], expTotal: 0, expFull: 0, tenantTotal: 0, ownerTotal: 0, allocTotal: 0, childTotal: 0 };

    var fullAmount = parseFloat(e.amount) || 0;
    var yearlyAmount = fullAmount;
    var costType = e.cost_type || 'operating';

    if (costType === 'amortized' && e.amort_years > 0) {
      yearlyAmount = fullAmount / e.amort_years;
    }

    var allocs = e.expense_allocations || [];
    var tenantSum = 0, ownerSum = 0;
    allocs.forEach(function(a) {
      var amt = parseFloat(a.amount) || 0;
      if (a.payer === 'owner') ownerSum += amt;
      else tenantSum += amt;
    });
    var allocTotal = tenantSum + ownerSum;

    // For parent expenses: add child (redirected) amounts to allocated total
    var childAmount = childAmountsByParent[e.id] || 0;
    var effectiveAlloc = allocTotal + childAmount;
    var diff = yearlyAmount - effectiveAlloc;

    var isChild = !!childExpenseIds[e.id];

    byCat[catName].expenses.push({
      ref: e.ref_number || '',
      desc: e.description || '',
      supplier: e.supplier || '',
      method: e.alloc_method || 'area',
      costType: costType,
      amortYears: e.amort_years,
      fullAmount: fullAmount,
      yearlyAmount: yearlyAmount,
      tenantSum: tenantSum,
      ownerSum: ownerSum,
      allocTotal: allocTotal,
      childAmount: childAmount,
      effectiveAlloc: effectiveAlloc,
      diff: diff,
      isAuto: e.is_auto_generated,
      isChild: isChild,
      allocCount: allocs.length,
      periodFrom: e.period_from,
      periodTo: e.period_to
    });

    byCat[catName].expTotal += yearlyAmount;
    byCat[catName].expFull += fullAmount;
    byCat[catName].tenantTotal += tenantSum;
    byCat[catName].ownerTotal += ownerSum;
    byCat[catName].allocTotal += allocTotal;
    byCat[catName].childTotal += childAmount;

    grandTotals.expAmount += yearlyAmount;
    grandTotals.expFull += fullAmount;
    grandTotals.allocTenant += tenantSum;
    grandTotals.allocOwner += ownerSum;
    grandTotals.allocTotal += allocTotal;
    grandTotals.childRedirected += childAmount;
    grandTotals.count++;
    if (allocs.length === 0 && !isChild) grandTotals.noAlloc++;

    if (byType[costType]) {
      byType[costType].amount += yearlyAmount;
      byType[costType].alloc += effectiveAlloc;
      byType[costType].count++;
    }
  });

  grandTotals.diff = grandTotals.expAmount - grandTotals.allocTotal - grandTotals.childRedirected;

  // Build HTML
  var catNames = Object.keys(byCat).sort();
  var html = '<div class="bg-white border border-teal-200 rounded-xl p-4 space-y-3 max-h-[80vh] overflow-y-auto">' +
    '<div class="flex justify-between items-center mb-2">' +
      '<span class="text-[11px] font-black text-teal-700 uppercase">\uD83D\uDCCA Reconcili\u00E1cia ' + year + ' \u2013 podľa z\u00FA\u010Dtovacieho obdobia</span>' +
      '<button onclick="document.getElementById(\'consistency-report\').classList.add(\'hidden\')" class="text-slate-300 hover:text-slate-500 text-sm">&times;</button>' +
    '</div>';

  // Grand summary
  var grandOk = Math.abs(grandTotals.diff) <= 1;
  var grandColor = grandOk ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
  html += '<div class="' + grandColor + ' border rounded-lg p-3">' +
    '<table class="w-full text-[9px]">' +
    '<tr><td class="font-bold text-slate-600">\uD83D\uDCC4 Fakt\u00FAry (' + grandTotals.count + '):</td><td class="text-right font-black">' + fmtE(grandTotals.expAmount) + '</td><td class="text-[7px] text-slate-400 pl-2">' + (grandTotals.expFull !== grandTotals.expAmount ? '(pln\u00E1 hodnota: ' + fmtE(grandTotals.expFull) + ')' : '') + '</td></tr>' +
    '<tr><td class="text-blue-600">\uD83D\uDC65 N\u00E1jomcovia:</td><td class="text-right font-bold text-blue-600">' + fmtE(grandTotals.allocTenant) + '</td><td class="text-[7px] text-slate-400 pl-2">' + (grandTotals.expAmount > 0 ? (grandTotals.allocTenant / grandTotals.expAmount * 100).toFixed(1) + '%' : '') + '</td></tr>' +
    '<tr><td class="text-orange-600">\uD83C\uDFE0 Vlastn\u00EDk:</td><td class="text-right font-bold text-orange-600">' + fmtE(grandTotals.allocOwner) + '</td><td class="text-[7px] text-slate-400 pl-2">' + (grandTotals.expAmount > 0 ? (grandTotals.allocOwner / grandTotals.expAmount * 100).toFixed(1) + '%' : '') + '</td></tr>' +
    '<tr class="border-t border-slate-200"><td class="font-bold pt-1">Alokovan\u00E9 celkom:</td><td class="text-right font-black pt-1">' + fmtE(grandTotals.allocTotal + grandTotals.childRedirected) + '</td><td></td></tr>' +
    (grandTotals.childRedirected > 0 ? '<tr><td class="text-teal-600 text-[8px]">\u00A0\u00A0z toho presmerovan\u00E9 (auto-fakt\u00FAry):</td><td class="text-right text-teal-600 text-[8px]">' + fmtE(grandTotals.childRedirected) + '</td><td></td></tr>' : '') +
    '<tr class="' + (grandOk ? 'text-green-600' : 'text-red-600') + '"><td class="font-bold">' + (grandOk ? '\u2705' : '\u26A0') + ' Rozdiel:</td><td class="text-right font-black">' + fmtE(Math.abs(grandTotals.diff)) + '</td><td class="text-[7px] pl-2">' + (grandTotals.noAlloc > 0 ? grandTotals.noAlloc + ' fakt\u00FAr bez alok\u00E1ci\u00ED' : '') + '</td></tr>' +
    '</table></div>';

  // Type breakdown
  html += '<div class="bg-slate-50 border border-slate-200 rounded-lg p-3">' +
    '<p class="text-[8px] font-black text-slate-500 uppercase mb-1">Podľa typu n\u00E1kladu</p>' +
    '<table class="w-full text-[9px]">';
  ['operating', 'amortized', 'investment'].forEach(function(key) {
    var t = byType[key];
    if (t.count === 0) return;
    var tDiff = Math.abs(t.amount - t.alloc);
    html += '<tr><td class="text-slate-600">' + t.label + ' (' + t.count + '):</td>' +
      '<td class="text-right font-bold">' + fmtE(t.amount) + '</td>' +
      '<td class="text-right text-slate-400 text-[8px]">' + (tDiff > 1 ? '<span class="text-red-500">\u0394 ' + fmtE(tDiff) + '</span>' : '\u2705') + '</td></tr>';
  });
  html += '</table></div>';

  // Per category
  catNames.forEach(function(catName) {
    var cat = byCat[catName];
    var catDiff = cat.expTotal - cat.allocTotal - cat.childTotal;
    var catOk = Math.abs(catDiff) <= 1;
    var catBg = catOk ? 'bg-slate-50' : 'bg-red-50';

    html += '<div class="' + catBg + ' border border-slate-200 rounded-lg p-3">' +
      '<div class="flex justify-between items-center cursor-pointer" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">' +
        '<span class="text-[10px] font-black text-slate-700">' + (catOk ? '\u2705' : '\u26A0') + ' ' + catName + ' <span class="text-[8px] text-slate-400">(' + cat.expenses.length + ')</span></span>' +
        '<span class="text-[9px]">' +
          '<span class="font-bold mr-3">' + fmtE(cat.expTotal) + '</span>' +
          '<span class="text-blue-600 mr-1">N:' + fmtE(cat.tenantTotal) + '</span>' +
          '<span class="text-orange-600 mr-1">V:' + fmtE(cat.ownerTotal) + '</span>' +
          (cat.childTotal > 0 ? '<span class="text-teal-600 mr-1">\u2192' + fmtE(cat.childTotal) + '</span>' : '') +
          (Math.abs(catDiff) > 1 ? '<span class="text-red-600 font-bold">\u0394 ' + fmtE(catDiff) + '</span>' : '') +
        '</span>' +
      '</div>';

    // Detail table (collapsed)
    html += '<div class="hidden mt-2 overflow-x-auto">' +
      '<table class="w-full text-[8px]">' +
      '<tr class="text-slate-400 border-b border-slate-200">' +
        '<th class="text-left py-1">Ref.</th><th class="text-left">Popis</th><th class="text-left">Dodávateľ</th>' +
        '<th class="text-right">Fakt\u00FAra</th><th class="text-right">N\u00E1jom.</th><th class="text-right">Vlastn.</th><th class="text-right">Rozdiel</th>' +
      '</tr>';

    cat.expenses.forEach(function(exp) {
      var absDiff = Math.abs(exp.diff);
      var rowCls = absDiff > 1 ? ' class="bg-red-50"' : (exp.isAuto ? ' class="bg-blue-50 opacity-70"' : (exp.isChild ? ' class="bg-teal-50 opacity-80"' : ''));
      var badges = '';
      if (exp.method === 'meter') badges += '<span class="text-[6px] bg-purple-100 text-purple-600 px-1 rounded">M</span> ';
      if (exp.isAuto || exp.isChild) badges += '<span class="text-[6px] bg-blue-100 text-blue-600 px-1 rounded">AUTO</span> ';
      if (exp.costType === 'amortized') badges += '<span class="text-[6px] bg-amber-100 text-amber-600 px-1 rounded">' + exp.amortYears + 'r</span> ';
      if (exp.childAmount > 0) badges += '<span class="text-[6px] bg-teal-100 text-teal-600 px-1 rounded">\u2192 ' + fmtE(exp.childAmount) + '</span> ';
      if (exp.allocCount === 0 && !exp.isChild) badges += '<span class="text-[6px] bg-red-100 text-red-600 px-1 rounded">\u2205</span> ';

      html += '<tr' + rowCls + '>' +
        '<td class="py-0.5 text-slate-500">' + exp.ref + '</td>' +
        '<td class="truncate max-w-[130px]">' + badges + exp.desc.substring(0, 35) + '</td>' +
        '<td class="text-slate-400 truncate max-w-[80px]">' + exp.supplier.substring(0, 20) + '</td>' +
        '<td class="text-right font-bold">' + fmtE(exp.yearlyAmount) + (exp.costType === 'amortized' ? '<br><span class="text-[6px] text-slate-400">z ' + fmtE(exp.fullAmount) + '</span>' : '') + '</td>' +
        '<td class="text-right text-blue-600">' + fmtE(exp.tenantSum) + '</td>' +
        '<td class="text-right text-orange-600">' + fmtE(exp.ownerSum) + '</td>' +
        '<td class="text-right' + (absDiff > 1 ? ' text-red-600 font-bold' : ' text-green-600') + '">' + (absDiff > 1 ? fmtE(exp.diff) : '\u2713') + '</td>' +
      '</tr>';
    });

    // Category totals
    html += '<tr class="border-t border-slate-300 font-bold">' +
      '<td colspan="3" class="py-1">' + catName + '</td>' +
      '<td class="text-right">' + fmtE(cat.expTotal) + '</td>' +
      '<td class="text-right text-blue-600">' + fmtE(cat.tenantTotal) + '</td>' +
      '<td class="text-right text-orange-600">' + fmtE(cat.ownerTotal) + '</td>' +
      '<td class="text-right' + (Math.abs(catDiff) > 1 ? ' text-red-600' : ' text-green-600') + '">' + (Math.abs(catDiff) > 1 ? fmtE(catDiff) : '\u2713') + '</td>' +
    '</tr>';

    html += '</table></div></div>';
  });

  // Legend
  html += '<div class="text-[7px] text-slate-400 mt-2 flex flex-wrap gap-3">' +
    '<span><span class="bg-purple-100 text-purple-600 px-1 rounded">M</span> Mera\u010D</span>' +
    '<span><span class="bg-blue-100 text-blue-600 px-1 rounded">AUTO</span> Auto-generovan\u00E9</span>' +
    '<span><span class="bg-amber-100 text-amber-600 px-1 rounded">Xr</span> Amortiz\u00E1cia</span>' +
    '<span><span class="bg-red-100 text-red-600 px-1 rounded">\u2205</span> Bez alok\u00E1ci\u00ED</span>' +
    '<span><span class="bg-teal-100 text-teal-600 px-1 rounded">\u2192</span> Presmerovan\u00E9 (auto-child)</span>' +
    '<span class="ml-4"><span class="text-blue-600 font-bold">N:</span> N\u00E1jomcovia</span>' +
    '<span><span class="text-orange-600 font-bold">V:</span> Vlastn\u00EDk</span>' +
  '</div></div>';

  report.innerHTML = html;
};

function fmtE(n) { return (parseFloat(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20AC'; }

// ============ RECALCULATE ALL EXPENSES ============
window.recalcAllExpenses = async function() {
  var year = document.getElementById('fin-year').value;
  var catFilter = document.getElementById('fin-cat-filter').value;
  var dateMode = document.getElementById('fin-date-mode').value;
  if (!year) { alert('Vyberte rok'); return; }
  var catLabel = catFilter === 'all' ? 'všetky kategórie' : document.getElementById('fin-cat-filter').options[document.getElementById('fin-cat-filter').selectedIndex].text;
  if (!confirm('Prepočítať plošné alokácie za rok ' + year + ' (' + catLabel + ') podľa aktuálnych plôch zón?\n\nMeračové náklady sa nezmenia.')) return;

  // Load current zones
  var { data: zones = [] } = await sb.from('zones').select('*');
  var zoneMap = {};
  zones.forEach(function(z) { zoneMap[z.id] = z; });

  // Load categories
  var { data: cats = [] } = await sb.from('cost_categories').select('*');
  var catMap = {};
  cats.forEach(function(c) { catMap[c.id] = c; });

  // Load expenses respecting filters
  var q1 = sb.from('expenses').select('*, expense_allocations(*)');
  var q2 = sb.from('expenses').select('*, expense_allocations(*)');
  if (dateMode === 'period') {
    q1 = q1.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
    q2 = null; // period mode doesn't need fallback
  } else {
    q1 = q1.gte('date', year + '-01-01').lte('date', year + '-12-31');
    q2 = q2.lte('period_from', year + '-12-31').gte('period_to', year + '-01-01');
  }
  if (catFilter !== 'all') {
    q1 = q1.eq('category_id', catFilter);
    if (q2) q2 = q2.eq('category_id', catFilter);
  }

  var { data: expenses = [] } = await q1;
  var expenses2 = [];
  if (q2) {
    var r2 = await q2;
    expenses2 = r2.data || [];
  }

  var allExp = expenses.concat(expenses2);
  var seen = {};
  allExp = allExp.filter(function(e) {
    if (seen[e.id]) return false;
    seen[e.id] = true;
    return true;
  });

  var updated = 0, skipped = 0, errors = 0;
  var skipDetails = [];

  for (var ei = 0; ei < allExp.length; ei++) {
    var e = allExp[ei];
    var allocs = e.expense_allocations || [];
    var eLabel = (e.ref_number || '') + ' ' + (e.description || '').substring(0, 40);
    if (allocs.length === 0) { skipped++; skipDetails.push(eLabel.trim() + ' → bez alokácií'); continue; }

    // Skip meter-based
    if (e.alloc_method === 'meter') { skipped++; skipDetails.push(eLabel.trim() + ' → merač (ručne)'); continue; }

    var cat = catMap[e.category_id] || {};
    var emptyRule = cat.empty_zone_rule || 'owner';
    var isHeating = emptyRule === 'owner_temper';

    // Determine save amount
    var saveAmount = e.amount || 0;
    if (e.cost_type === 'amortized' && e.amort_years > 0) {
      saveAmount = e.amount / e.amort_years;
    }

    // Calculate period months
    var totalMonths = 12;
    if (e.period_from && e.period_to) {
      var pf = new Date(e.period_from), pt = new Date(e.period_to);
      totalMonths = Math.round((pt - pf) / (30.44 * 24 * 60 * 60 * 1000));
      if (totalMonths < 1) totalMonths = 1;
      if (totalMonths > 24) totalMonths = 24;
    }

    // Deduplicate zones from allocations (merge tenant+owner splits)
    var zoneAllocMap = {};
    allocs.forEach(function(a) {
      if (!zoneAllocMap[a.zone_id]) {
        zoneAllocMap[a.zone_id] = { payer: a.payer, months_occupied: a.months_occupied, months_total: a.months_total };
      }
      // Prefer tenant entry over owner for payer
      if (a.payer === 'tenant') {
        zoneAllocMap[a.zone_id].payer = 'tenant';
        zoneAllocMap[a.zone_id].months_occupied = a.months_occupied;
        zoneAllocMap[a.zone_id].months_total = a.months_total;
      }
    });

    // Build zone list with current areas
    var zoneList = [];
    Object.keys(zoneAllocMap).forEach(function(zid) {
      var z = zoneMap[zid];
      if (!z) return;
      var aInfo = zoneAllocMap[zid];
      zoneList.push({
        id: zid,
        area: z.area_m2 || 0,
        billingArea: z.billing_area_m2 || z.area_m2 || 0,
        temper: z.tempering_pct || 0,
        payer: aInfo.payer || 'tenant',
        monthsOcc: aInfo.months_occupied != null ? aInfo.months_occupied : totalMonths,
        monthsTotal: aInfo.months_total || totalMonths,
        isTimeWeighted: false
      });
    });

    if (zoneList.length === 0) { skipped++; skipDetails.push(eLabel.trim() + ' → žiadne zóny'); continue; }

    // Time-weighted detection
    zoneList.forEach(function(z) {
      if (z.monthsOcc < totalMonths) {
        var monthsEmpty = totalMonths - z.monthsOcc;
        var ownerWeight = emptyRule === 'exclude' ? 0 : (emptyRule === 'owner_temper' ? (z.temper / 100) : 1);
        z.isTimeWeighted = true;
        z.monthsEmpty = monthsEmpty;
        z.tenantEffArea = z.area * z.monthsOcc / totalMonths;
        z.tenantEffBilling = z.billingArea * z.monthsOcc / totalMonths;
        z.ownerEffArea = z.area * ownerWeight * monthsEmpty / totalMonths;
      }
    });

    // Tempered zones (heating: unchecked zones with tempering)
    var temperedZones = [];
    if (isHeating) {
      var allocatedIds = {};
      zoneList.forEach(function(z) { allocatedIds[z.id] = true; });
      zones.forEach(function(z) {
        if (!allocatedIds[z.id] && z.tempering_pct > 0) {
          temperedZones.push({ id: z.id, area: z.area_m2, temper: z.tempering_pct, effectiveArea: z.area_m2 * z.tempering_pct / 100 });
        }
      });
    }

    // Calculate total area (pool)
    var totalArea = 0;
    zoneList.forEach(function(z) {
      if (z.isTimeWeighted) {
        totalArea += z.tenantEffArea + z.ownerEffArea;
      } else if (isHeating && z.payer === 'owner') {
        z.ownerTemperedArea = z.area * (z.temper || 0) / 100;
        totalArea += z.ownerTemperedArea;
      } else {
        totalArea += z.area;
      }
    });
    totalArea += temperedZones.reduce(function(s, z) { return s + z.effectiveArea; }, 0);

    if (totalArea === 0) { skipped++; skipDetails.push(eLabel.trim() + ' → plocha 0'); continue; }

    // Build new allocations
    var newAllocs = [];
    zoneList.forEach(function(z) {
      if (z.isTimeWeighted) {
        var tenantBilling = z.tenantEffBilling || z.tenantEffArea;
        var tenantPct = tenantBilling / totalArea * 100;
        var ownerPct = z.ownerEffArea / totalArea * 100;
        newAllocs.push({
          expense_id: e.id, zone_id: z.id,
          percentage: parseFloat(tenantPct.toFixed(2)),
          amount: parseFloat((saveAmount * tenantPct / 100).toFixed(2)),
          payer: z.payer,
          months_occupied: z.monthsOcc, months_total: totalMonths,
          tempering_used: isHeating ? z.temper : null,
          area_used: z.area
        });
        if (z.payer === 'tenant' && ownerPct > 0) {
          newAllocs.push({
            expense_id: e.id, zone_id: z.id,
            percentage: parseFloat(ownerPct.toFixed(2)),
            amount: parseFloat((saveAmount * ownerPct / 100).toFixed(2)),
            payer: 'owner',
            months_occupied: 0, months_total: totalMonths,
            tempering_used: isHeating ? z.temper : null,
            area_used: z.area
          });
        }
      } else {
        var chargeArea;
        if (isHeating && z.payer === 'owner' && z.ownerTemperedArea !== undefined) {
          chargeArea = z.ownerTemperedArea;
        } else {
          chargeArea = (z.payer === 'tenant') ? z.billingArea : z.area;
        }
        var pct = chargeArea / totalArea * 100;
        newAllocs.push({
          expense_id: e.id, zone_id: z.id,
          percentage: parseFloat(pct.toFixed(2)),
          amount: parseFloat((saveAmount * pct / 100).toFixed(2)),
          payer: z.payer,
          tempering_used: isHeating ? z.temper : null,
          area_used: z.area
        });
      }
    });
    temperedZones.forEach(function(z) {
      var pct = z.effectiveArea / totalArea * 100;
      newAllocs.push({
        expense_id: e.id, zone_id: z.id,
        percentage: parseFloat(pct.toFixed(2)),
        amount: parseFloat((saveAmount * pct / 100).toFixed(2)),
        payer: 'owner',
        tempering_used: z.temper,
        area_used: z.area
      });
    });

    // Replace allocations
    try {
      await sb.from('expense_allocations').delete().eq('expense_id', e.id);
      if (newAllocs.length > 0) {
        var ins = await sb.from('expense_allocations').insert(newAllocs);
        if (ins.error) throw ins.error;
      }
      updated++;
    } catch(err) {
      console.error('Recalc error for expense ' + e.id + ':', err);
      errors++;
    }
  }

  var skipInfo = skipped > 0 ? '\n⏭ Preskočených: ' + skipped + '\n' + skipDetails.join('\n') : '';
  alert('Hotovo!\n\n✅ Prepočítaných: ' + updated + skipInfo + (errors > 0 ? '\n❌ Chýb: ' + errors : ''));
  await loadExpenses();
  if (window.loadOverview) await window.loadOverview();
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
  // Rebuild zone checkboxes with fresh data
  if (window.refreshZoneLeaseDates) await window.refreshZoneLeaseDates();
  // Refresh expense list (previews may have changed)
  if (window.loadExpenses) await window.loadExpenses();
  // Refresh overview table
  if (window.loadOverview) await window.loadOverview();
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
  await loadFinance();
  alert('Zóna "' + name.trim() + '" pridaná.');
};

window.toggleAmortFields = function() {
  var costType = document.getElementById('exp-cost-type').value;
  var amortWrap = document.getElementById('amort-years-wrap');
  amortWrap.classList.toggle('hidden', costType !== 'amortized');
  window.updateAllocPreview();
};

// Auto-fill accounting period from billing period
window.autofillAccountingPeriod = function() {
  var billingFrom = document.getElementById('exp-billing-from').value;
  var billingTo = document.getElementById('exp-billing-to').value;
  var periodFrom = document.getElementById('exp-period-from');
  var periodTo = document.getElementById('exp-period-to');
  var hint = document.getElementById('period-hint');

  if (billingFrom) {
    // Accounting period = full year of billing period
    var year = billingFrom.substring(0, 4);
    if (!periodFrom.value || periodFrom.getAttribute('data-auto') === 'true') {
      periodFrom.value = year + '-01-01';
      periodFrom.setAttribute('data-auto', 'true');
    }
    if (!periodTo.value || periodTo.getAttribute('data-auto') === 'true') {
      periodTo.value = year + '-12-31';
      periodTo.setAttribute('data-auto', 'true');
    }
    if (hint) {
      if (billingFrom === periodFrom.value && billingTo === periodTo.value) {
        hint.textContent = '';
      } else {
        hint.textContent = 'Zúčt. obdobie ≠ fakturačné (prepísané na celý rok)';
      }
    }
  }

  // Trigger recalculations
  if (window.updateMonthsVisibility) window.updateMonthsVisibility();
  window.updateAllocPreview();
};

// When accounting period is manually changed, mark as non-auto
document.getElementById('exp-period-from').addEventListener('input', function() {
  this.setAttribute('data-auto', 'false');
  var hint = document.getElementById('period-hint');
  if (hint) hint.textContent = hint.textContent ? 'Zúčt. obdobie manuálne upravené' : '';
});
document.getElementById('exp-period-to').addEventListener('input', function() {
  this.setAttribute('data-auto', 'false');
  var hint = document.getElementById('period-hint');
  if (hint) hint.textContent = hint.textContent ? 'Zúčt. obdobie manuálne upravené' : '';
});

window.showAddExpense = async function() {
  // Refresh lease dates from DB
  await window.refreshZoneLeaseDates();

  editingExpenseId = null;
  document.getElementById('expense-modal-title').innerText = 'Nový náklad';
  document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-supplier').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-cost-type').value = 'operating';
  document.getElementById('exp-amort-years').value = '';
  document.getElementById('amort-years-wrap').classList.add('hidden');
  document.getElementById('amort-yearly-hint').classList.add('hidden');
  document.getElementById('exp-invoice').value = '';
  document.getElementById('exp-billing-from').value = '';
  document.getElementById('exp-billing-to').value = '';
  document.getElementById('exp-period-from').value = '';
  document.getElementById('exp-period-from').setAttribute('data-auto', 'true');
  document.getElementById('exp-period-to').value = '';
  document.getElementById('exp-period-to').setAttribute('data-auto', 'true');
  document.getElementById('period-hint').textContent = '';
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
  window._meterSummary = null;
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
    // Always read current area from allZones (not stale checkbox attributes)
    var zoneId = cbs[i].value;
    var zoneData = allZones.find(function(z) { return z.id === zoneId; });
    var area = zoneData ? (parseFloat(zoneData.area_m2) || 0) : (parseFloat(cbs[i].getAttribute('data-area')) || 0);
    var billingArea = zoneData ? (parseFloat(zoneData.billing_area_m2) || area) : (parseFloat(cbs[i].getAttribute('data-billing-area')) || area);
    zones.push({ id: zoneId, area: area, billingArea: billingArea });
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
  try {
    if (window.updateMonthsVisibility) window.updateMonthsVisibility();
  } catch(monthsErr) {
    console.warn('updateMonthsVisibility error:', monthsErr);
  }

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
        var zoneId = allCbs[i].value;
        var zoneData = allZones.find(function(z) { return z.id === zoneId; });
        var temper = zoneData ? (parseFloat(zoneData.tempering_pct) || 0) : (parseFloat(allCbs[i].getAttribute('data-temper')) || 0);
        if (temper > 0) {
          var area = zoneData ? (parseFloat(zoneData.area_m2) || 0) : (parseFloat(allCbs[i].getAttribute('data-area')) || 0);
          temperedZones.push({ id: zoneId, area: area, temper: temper, effectiveArea: area * temper / 100 });
        }
      }
    }
  }

  // Calculate total effective area (pool = building area)
  var totalArea = 0;
  checkedZones.forEach(function(z) {
    if (z.isTimeWeighted) {
      totalArea += z.tenantEffArea + z.ownerEffArea;
    } else if (isHeating && z.payer === 'owner') {
      // For heating: owner zones use tempered area, not full
      var cb = document.querySelector('.alloc-zone-cb[value="' + z.id + '"]');
      var temper = cb ? (parseFloat(cb.getAttribute('data-temper')) || 0) : 0;
      z.ownerTemperedArea = z.area * temper / 100;
      totalArea += z.ownerTemperedArea;
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
      var timeNote = '';
      if (z.isTimeWeighted) {
        try {
          var pFrom = document.getElementById('exp-period-from').value;
          var lFrom = document.querySelector('.alloc-zone-cb[value="' + z.id + '"]');
          var leaseStart = lFrom ? lFrom.getAttribute('data-lease-from') : '';
          if (leaseStart && pFrom) {
            var ls = parseDate(leaseStart), ps = parseDate(pFrom);
            var startM = ls > ps ? ls : ps;
            timeNote = ' <span class="text-orange-500">(' + monthNamesShort[startM.getMonth()] + '–' + z.monthsOcc + '/' + totalMonths + ' mes.)</span>';
          } else {
            timeNote = ' <span class="text-orange-500">(' + z.monthsOcc + '/' + totalMonths + ' mes.)</span>';
          }
        } catch(tnErr) {
          timeNote = ' <span class="text-orange-500">(' + z.monthsOcc + '/' + totalMonths + ' mes.)</span>';
        }
      }
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
      var effArea;
      var temperNote = '';
      if (z.isTimeWeighted) {
        effArea = z.tenantEffArea + z.ownerEffArea;
      } else if (isHeating && z.ownerTemperedArea !== undefined) {
        // Heating: owner pays only tempered portion
        effArea = z.ownerTemperedArea;
        var cb = document.querySelector('.alloc-zone-cb[value="' + z.id + '"]');
        var temper = cb ? (parseFloat(cb.getAttribute('data-temper')) || 0) : 0;
        temperNote = ' <span class="text-orange-400">(kúr. ' + temper + '%)</span>';
      } else {
        effArea = z.area;
      }
      var pct = totalArea > 0 ? (effArea / totalArea * 100) : 0;
      var amt = displayAmount * pct / 100;
      ownerTotal += amt;
      return '<div class="flex items-center justify-between text-[9px] bg-orange-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-orange-600 truncate flex-1">' + label + temperNote + '</span>' +
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
      var effArea;
      if (z.isTimeWeighted) {
        effArea = z.tenantEffArea + z.ownerEffArea;
      } else if (isHeating && z.payer === 'owner' && z.ownerTemperedArea !== undefined) {
        effArea = z.ownerTemperedArea;
      } else {
        effArea = z.area;
      }
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
  'Voda': 'water', 'Vodné a stočné': 'water', 'Voda a kanalizácia': 'water', 'Voda a kanalizacia': 'water',
  'Elektrina': 'electricity', 'Elektrická energia': 'electricity', 'Elektricka energia': 'electricity',
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
  var redirectedMeters = []; // meters of this type but assigned to different category (e.g., water meter → Vykurovanie)
  if (catId) {
    var { data: catMeters = [] } = await sb.from('meters').select('*').eq('cost_category_id', catId);
    meters = meters.concat(catMeters);
  }
  if (meterType) {
    var { data: typeMeters = [] } = await sb.from('meters').select('*').eq('type', meterType).is('cost_category_id', null);
    typeMeters.forEach(function(m) {
      if (!meters.find(function(em) { return em.id === m.id; })) meters.push(m);
    });
    // Also load meters of same type that are redirected to OTHER categories (e.g., vodomer kotolne → Vykurovanie)
    if (catId) {
      var { data: redirMeters = [] } = await sb.from('meters').select('*, cost_categories(name)').eq('type', meterType).not('cost_category_id', 'is', null).neq('cost_category_id', catId);
      redirectedMeters = redirMeters;
    }
  }

  if (meters.length === 0) {
    var hint = meterType ? ('Žiadne ' + meterType + ' merače.') : 'Pre túto kategóriu nie sú merače.';
    meterRows.innerHTML = '<p class="text-[9px] text-slate-400">' + hint + ' Pridajte merače v sekcii Merače alebo nastavte kategóriu na merači.</p>';
    preview.classList.add('hidden');
    return;
  }

  // Load all readings in range (with buffer for finding closest)
  var allMeterIds = meters.map(function(m) { return m.id; }).concat(redirectedMeters.map(function(m) { return m.id; }));
  var { data: readings = [] } = await sb.from('meter_readings').select('*')
    .in('meter_id', allMeterIds.length > 0 ? allMeterIds : ['none'])
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
  var meterWarnings = []; // { meter, type, message }
  var mainMeter = meters.find(function(m) { return m.is_main; });

  // Combine regular + redirected meters for consumption calc
  var allCalcMeters = meters.concat(redirectedMeters.map(function(m) { m._redirected = true; return m; }));

  allCalcMeters.forEach(function(m) {
    var mReadings = readings.filter(function(r) { return r.meter_id === m.id; });
    if (mReadings.length < 2) {
      // Special case: single reading with value 0 = clearly zero consumption
      if (mReadings.length === 1 && parseFloat(mReadings[0].value) === 0) {
        var zones = mzByMeter[m.id] || [];
        if (zones.length === 0 && m.zone_id) zones = [m.zone_id];
        meterConsumption.push({
          meter: m, consumption: 0, startValue: 0, endValue: 0,
          startDate: mReadings[0].date, endDate: mReadings[0].date,
          zones: zones, hadReplacement: false,
          isRedirected: !!m._redirected,
          redirectedCatName: m._redirected && m.cost_categories ? m.cost_categories.name : null,
          isZeroConsumption: true
        });
        return;
      }
      if (!m._redirected && !m.is_main) {
        if (mReadings.length === 0) {
          meterWarnings.push({ meter: m, type: 'no_readings', message: m.name + ': žiadne odčítanie' });
        } else {
          meterWarnings.push({ meter: m, type: 'single_reading', message: m.name + ': len 1 odčítanie – spotreba sa nedá vypočítať' });
        }
      }
      return;
    }

    // Check for replacement readings in range
    var replacements = mReadings.filter(function(r) { return r.is_replacement; });
    var hasFinal = replacements.find(function(r) { return r.replacement_type === 'final'; });
    var hasInitial = replacements.find(function(r) { return r.replacement_type === 'initial'; });

    // Separate readings into old meter (before/at replacement) and new meter (after replacement)
    var consumption, startValue, endValue, startDate, endDate;

    if (hasFinal && hasInitial) {
      // Meter was replaced during period
      // Old meter: readings before/at final
      var oldReadings = mReadings.filter(function(r) {
        return !r.is_replacement && r.date <= hasFinal.date;
      });
      // Find start reading for old meter
      var oldStart = oldReadings.filter(function(r) { return r.date <= periodFrom; });
      var startR = oldStart.length > 0 ? oldStart[oldStart.length - 1] : (oldReadings.length > 0 ? oldReadings[0] : null);
      if (!startR) startR = hasFinal; // fallback

      var oldConsumption = parseFloat(hasFinal.value) - parseFloat(startR.value);
      if (oldConsumption < 0) oldConsumption = 0;

      // New meter: readings after initial
      var newReadings = mReadings.filter(function(r) {
        return !r.is_replacement && r.date >= hasInitial.date;
      });
      // Find end reading for new meter
      var newEnd = newReadings.filter(function(r) { return r.date <= periodTo; });
      var endR = newEnd.length > 0 ? newEnd[newEnd.length - 1] : null;

      var newConsumption = endR ? parseFloat(endR.value) - parseFloat(hasInitial.value) : 0;
      if (newConsumption < 0) newConsumption = 0;

      consumption = oldConsumption + newConsumption;
      startValue = parseFloat(startR.value);
      endValue = endR ? parseFloat(endR.value) : parseFloat(hasInitial.value);
      startDate = startR.date;
      endDate = endR ? endR.date : hasInitial.date;
    } else {
      // No replacement – normal calculation (skip replacement readings)
      var normalReadings = mReadings.filter(function(r) { return !r.is_replacement; });
      if (normalReadings.length < 2) {
        // Maybe all readings are replacement + 1 normal
        normalReadings = mReadings;
      }

      // Find reading closest to periodFrom (before or at)
      var startReadings = normalReadings.filter(function(r) { return r.date <= periodFrom; });
      var startR = startReadings.length > 0 ? startReadings[startReadings.length - 1] : normalReadings[0];

      // Find reading closest to periodTo (before or at, with 14-day tolerance after)
      var endReadings = normalReadings.filter(function(r) { return r.date <= periodTo; });
      var endR = endReadings.length > 0 ? endReadings[endReadings.length - 1] : null;

      // If no end reading found in period, check for readings just after period end (up to 14 days)
      if (!endR || (endR.id === startR.id)) {
        var toleranceDate = new Date(periodTo);
        toleranceDate.setDate(toleranceDate.getDate() + 14);
        var toleranceDateStr = toleranceDate.toISOString().split('T')[0];
        var nearbyReadings = normalReadings.filter(function(r) {
          return r.date > periodTo && r.date <= toleranceDateStr;
        });
        if (nearbyReadings.length > 0) {
          endR = nearbyReadings[0]; // closest reading after period end
          var daysDiff = Math.round((new Date(endR.date) - new Date(periodTo)) / 86400000);
          meterWarnings.push({ meter: m, type: 'tolerance_used', message: m.name + ': odčítanie z ' + fmtD(endR.date) + ' je ' + daysDiff + ' dní po konci obdobia (' + fmtD(periodTo) + ')' });
        }
      }

      if (!endR) {
        if (!m._redirected && !m.is_main) {
          meterWarnings.push({ meter: m, type: 'no_end_reading', message: m.name + ': žiadne odčítanie v období' });
        }
        return; // No readings at all → will be caught by warning
      }

      if (endR.id === startR.id) {
        // Same reading for start and end → zero consumption (nobody there / no change)
        consumption = 0;
        startValue = parseFloat(startR.value);
        endValue = parseFloat(endR.value);
        startDate = startR.date;
        endDate = endR.date;
      } else {
        consumption = parseFloat(endR.value) - parseFloat(startR.value);
        if (consumption < 0) consumption = 0;
        startValue = parseFloat(startR.value);
        endValue = parseFloat(endR.value);
        startDate = startR.date;
        endDate = endR.date;
      }
    }

    var zones = mzByMeter[m.id] || [];
    // Fallback to old zone_id if no meter_zones
    if (zones.length === 0 && m.zone_id) zones = [m.zone_id];

    // Sum deductions from readings in period
    var totalDeduction = 0;
    if (m.has_deduction) {
      mReadings.forEach(function(r) {
        if (r.deduction && r.date > (startDate || periodFrom) && r.date <= (endDate || periodTo)) {
          totalDeduction += parseFloat(r.deduction) || 0;
        }
      });
    }

    meterConsumption.push({
      meter: m,
      consumption: consumption,
      totalDeduction: totalDeduction,
      startValue: startValue,
      endValue: endValue,
      startDate: startDate,
      endDate: endDate,
      zones: zones,
      hadReplacement: !!(hasFinal && hasInitial),
      isRedirected: !!m._redirected,
      redirectedCatName: m._redirected && m.cost_categories ? m.cost_categories.name : null,
      isZeroConsumption: consumption === 0
    });
  });

  // Build zone allocation
  var zoneAllocs = []; // { zoneId, zoneName, consumption, pct, amount, payer, meterName, note }
  var totalConsumption = 0;
  var subMeterTotal = 0;
  var redirectedTotal = 0;      // NET (after deduction) - used for amount calculation
  var redirectedFullTotal = 0;  // FULL meter reading - used for remainder/loss calculation

  meterConsumption.forEach(function(mc) {
    if (mc.meter.is_main) return; // Handle main meter separately

    // Redirected meters (e.g., vodomer kotolne → Vykurovanie) - subtract but don't allocate here
    if (mc.isRedirected) {
      // Apply deductions from readings (e.g., Gatto chladničky) before redirecting
      var deduction = mc.totalDeduction || 0;
      var redirectedCons = mc.consumption - deduction;
      if (redirectedCons < 0) redirectedCons = 0;
      mc.redirectedConsumption = redirectedCons;
      mc.deduction = deduction;
      mc.deductionNote = mc.meter.deduction_note || '';

      // Only NET consumption goes to other category (Vykurovanie)
      // Deduction is just a meter correction (e.g., Blahovec unauthorized usage)
      // - it reduces the reading, does NOT go into the pool or get allocated anywhere
      redirectedTotal += redirectedCons;
      redirectedFullTotal += mc.consumption;  // full reading for remainder calc

      return;
    }

    // Skip child meters (parent is not main) - they're handled by their parent
    if (mc.meter.parent_meter_id) {
      var parentMc = meterConsumption.find(function(p) { return p.meter.id === mc.meter.parent_meter_id; });
      if (parentMc && !parentMc.meter.is_main) {
        // This is a level-2 child (e.g., Elektromer A1 under Elektromer Blok A)
        // Don't add to subMeterTotal - parent already covers it
        return;
      }
    }

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
      // Multi-zone meter (e.g., Blok A covering A1 + A2)
      // Check for child sub-meters under this meter
      var childMcs = meterConsumption.filter(function(ch) {
        return ch.meter.parent_meter_id === mc.meter.id && !ch.meter.is_main;
      });

      if (childMcs.length > 0) {
        // Hierarchical: child meters get exact consumption, rest gets remainder
        var childTotal = 0;
        var coveredZoneIds = [];

        childMcs.forEach(function(ch) {
          var chZones = ch.zones || [];
          chZones.forEach(function(zId) {
            coveredZoneIds.push(zId);
          });
          childTotal += ch.consumption;

          // Allocate child meter consumption to its zones
          if (chZones.length === 1) {
            var chZone = allZones.find(function(z) { return z.id === chZones[0]; });
            zoneAllocs.push({
              zoneId: chZones[0],
              zoneName: chZone ? (chZone.tenant_name || chZone.name) : '?',
              consumption: ch.consumption,
              meterName: ch.meter.name,
              payer: 'tenant',
              note: (ch.meter.meter_number ? '#' + ch.meter.meter_number : '') + ' (podmerač)'
            });
          }
        });

        // Remainder goes to uncovered zones
        var remainder = mc.consumption - childTotal;
        if (remainder < 0) remainder = 0;
        var uncoveredZones = mc.zones.filter(function(zId) {
          return coveredZoneIds.indexOf(zId) < 0;
        });

        if (uncoveredZones.length === 1) {
          var remZone = allZones.find(function(z) { return z.id === uncoveredZones[0]; });
          zoneAllocs.push({
            zoneId: uncoveredZones[0],
            zoneName: remZone ? (remZone.tenant_name || remZone.name) : '?',
            consumption: remainder,
            meterName: mc.meter.name,
            payer: 'tenant',
            note: 'zvyšok (' + mc.consumption.toFixed(0) + ' - ' + childTotal.toFixed(0) + ')'
          });
        } else if (uncoveredZones.length > 1) {
          // Multiple uncovered zones - split remainder by area
          var uncZonesWithArea = uncoveredZones.map(function(zId) {
            var z = allZones.find(function(az) { return az.id === zId; });
            return { id: zId, name: z ? (z.tenant_name || z.name) : '?', area: z ? (parseFloat(z.area_m2) || 0) : 0 };
          });
          var uncTotalArea = uncZonesWithArea.reduce(function(s, z) { return s + z.area; }, 0);
          uncZonesWithArea.forEach(function(z) {
            var share = uncTotalArea > 0 ? (z.area / uncTotalArea) : (1 / uncoveredZones.length);
            zoneAllocs.push({
              zoneId: z.id,
              zoneName: z.name,
              consumption: remainder * share,
              meterName: mc.meter.name,
              payer: 'tenant',
              note: 'zvyšok podľa m²'
            });
          });
        }
        // If remainder < 0, warn
        if (mc.consumption - childTotal < -0.5) {
          meterWarnings.push({
            meter: mc.meter,
            type: 'child_exceeds_parent',
            message: mc.meter.name + ': podmerače (' + childTotal.toFixed(0) + ') > nadradený (' + mc.consumption.toFixed(0) + ')'
          });
        }
      } else {
        // No child meters - split by area (original behavior)
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
    }
  });

  // Main meter remainder = common areas / losses
  var mainConsumption = 0;
  var mainMc = meterConsumption.find(function(mc) { return mc.meter.is_main; });

  // Check if main meter was expected but not found in consumption
  var mainMeterObj = meters.find(function(m) { return m.is_main; });
  if (mainMeterObj && !mainMc) {
    // Main meter exists but couldn't calculate consumption (missing readings, replacement issue, etc.)
    meterWarnings.push({
      meter: mainMeterObj,
      type: 'main_no_consumption',
      message: mainMeterObj.name + ': hlavný merač – nepodarilo sa vypočítať spotrebu (chýbajúce alebo nedostatočné odčítania). Celá suma bude rozdelená len medzi podmerače!'
    });
  }

  if (mainMc) {
    mainConsumption = mainMc.consumption;
    // Redirected meters: full consumption subtracted from main (includes deductions)
    var remainder = mainConsumption - subMeterTotal - redirectedFullTotal;

    if (remainder > 0.01) {
      zoneAllocs.push({
        zoneId: null,
        zoneName: 'Spoločné / straty',
        consumption: remainder,
        meterName: mainMc.meter.name + ' – podmerače',
        payer: 'owner',
        note: mainConsumption.toFixed(2) + ' - ' + (subMeterTotal + redirectedFullTotal).toFixed(2)
      });
    } else if (remainder < -0.01) {
      // Sub-meters exceed main → meter inaccuracy, reduce proportionally
      zoneAllocs.push({
        zoneId: null,
        zoneName: 'Nepresnosť meračov',
        consumption: remainder,  // negative
        meterName: mainMc.meter.name + ' – podmerače',
        payer: 'correction',
        note: 'Podmerače (' + (subMeterTotal + redirectedFullTotal).toFixed(2) + ') > hlavný (' + mainConsumption.toFixed(2) + ')'
      });
    }
  }

  // Add redirected consumption as informational line (works with or without main meter)
  var redirectedMcs = meterConsumption.filter(function(mc) { return mc.isRedirected; });
  redirectedMcs.forEach(function(rmc) {
    zoneAllocs.push({
      zoneId: null,
      zoneName: '→ ' + (rmc.redirectedCatName || 'Iná kategória'),
      consumption: rmc.redirectedConsumption !== undefined ? rmc.redirectedConsumption : rmc.consumption,
      fullConsumption: rmc.consumption,
      deduction: rmc.deduction || 0,
      deductionNote: rmc.deductionNote || '',
      meterName: rmc.meter.name,
      payer: 'redirect',
      note: rmc.meter.meter_number ? '#' + rmc.meter.meter_number : ''
    });
  });

  totalConsumption = zoneAllocs.filter(function(a) { return a.payer !== 'redirect' && a.payer !== 'correction'; }).reduce(function(s, a) { return s + a.consumption; }, 0);

  // Calculate redirected amounts first (proportional to main meter or total if no main)
  var redirectedTotalAmount = 0;
  var mainMc3 = meterConsumption.find(function(mc) { return mc.meter.is_main; });
  var mainCons3 = mainMc3 ? mainMc3.consumption : 0;
  // Base for unit price: sub-meters + NET redirected (deduction is NOT in invoice)
  var priceBase = subMeterTotal + redirectedTotal;

  zoneAllocs.forEach(function(a) {
    if (a.payer === 'redirect') {
      a.amount = priceBase > 0 ? (a.consumption / priceBase * amount) : 0;
      a.amount = parseFloat(a.amount.toFixed(2));
      a.pct = 0;
      redirectedTotalAmount += a.amount;
    }
  });

  // Tenant/owner allocations use remaining amount after redirects
  // Deduction has NO financial impact (not included in invoice)
  var allocatableAmount = amount - redirectedTotalAmount;

  // Calculate percentages and amounts
  zoneAllocs.forEach(function(a) {
    if (a.payer === 'redirect') return; // already calculated
    if (a.payer === 'correction') {
      a.pct = 0;
      a.amount = 0;
      return;
    }
    a.pct = totalConsumption > 0 ? (a.consumption / totalConsumption * 100) : 0;
    a.amount = allocatableAmount * a.pct / 100;
  });

  // Display meter info
  var unit = meters[0] ? meters[0].unit : 'm³';
  meterRows.innerHTML = meterConsumption.map(function(mc) {
    var badges = mc.meter.is_main ? ' <span class="text-[7px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-600">HLAVNÝ</span>' : '';
    if (mc.hadReplacement) badges += ' <span class="text-[7px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-600">VÝMENA</span>';
    if (mc.isRedirected) badges += ' <span class="text-[7px] font-bold px-1 py-0.5 rounded bg-blue-100 text-blue-600">→ ' + (mc.redirectedCatName || 'Iná kat.') + '</span>';
    if (mc.isZeroConsumption && !mc.meter.is_main) badges += ' <span class="text-[7px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-400">0</span>';
    var consColor = mc.isZeroConsumption ? 'text-slate-400' : 'text-green-600';
    var dateRange = mc.startDate && mc.endDate ? '<span class="text-[7px] text-slate-300 ml-1">(' + fmtD(mc.startDate) + ' – ' + fmtD(mc.endDate) + ')</span>' : '';
    return '<div class="flex justify-between text-[9px] bg-white rounded-lg px-2 py-1.5' + (mc.isRedirected ? ' opacity-60' : '') + '">' +
      '<span class="font-bold text-slate-600">' + mc.meter.name + badges + '</span>' +
      '<span class="text-slate-400">' + mc.startValue.toFixed(2) + ' → ' + mc.endValue.toFixed(2) + (mc.hadReplacement ? ' (výmena)' : '') + dateRange + '</span>' +
      '<span class="font-black ' + consColor + '">' + mc.consumption.toFixed(2) + ' ' + unit + '</span>' +
    '</div>';
  }).join('');

  // Summary: main vs sub-meters
  var summaryMainCons = mainMc ? mainMc.consumption : 0;
  var summarySubCons = subMeterTotal;
  var summaryRedirCons = redirectedTotal;
  // Deduction info (just for display, not affecting calculations)
  var summaryDeductCons = meterConsumption.filter(function(mc) { return mc.isRedirected; }).reduce(function(s, mc) { return s + (mc.deduction || 0); }, 0);
  var summaryFullRedirCons = meterConsumption.filter(function(mc) { return mc.isRedirected; }).reduce(function(s, mc) { return s + mc.consumption; }, 0);
  var summaryRemainder = summaryMainCons - summarySubCons - summaryFullRedirCons;
  var summaryColor = !mainMc ? 'bg-red-50 border-red-200' : (summaryRemainder < -0.5 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200');

  // Store summary for audit trail
  window._meterSummary = 'Hlavný: ' + summaryMainCons.toFixed(0) + ' ' + unit +
    ' | Podmerače: ' + summarySubCons.toFixed(0) + ' ' + unit +
    (summaryRedirCons > 0 ? ' | Presm.: ' + summaryRedirCons.toFixed(0) + ' ' + unit : '') +
    (summaryDeductCons > 0 ? ' | Odpočet: ' + summaryDeductCons.toFixed(0) + ' ' + unit : '') +
    (mainMc ? ' | Rozdiel: ' + summaryRemainder.toFixed(0) + ' ' + unit + ' (' + (summaryMainCons > 0 ? (summaryRemainder / summaryMainCons * 100).toFixed(1) : '0') + '%)' : ' | Hlavný merač chýba!');

  meterRows.innerHTML += '<div class="' + summaryColor + ' border rounded-lg px-3 py-2 mt-2 text-[9px]">' +
    '<p class="font-black text-slate-500 uppercase mb-1">Súhrn</p>' +
    (mainMc ?
      '<div class="flex justify-between"><span>Hlavný merač:</span><span class="font-bold">' + summaryMainCons.toFixed(2) + ' ' + unit + '</span></div>' : 
      '<div class="flex justify-between text-red-600"><span>Hlavný merač:</span><span class="font-bold">nenájdený / bez odčítaní</span></div>'
    ) +
    '<div class="flex justify-between"><span>Podmerače spolu:</span><span class="font-bold">' + summarySubCons.toFixed(2) + ' ' + unit + '</span></div>' +
    (summaryFullRedirCons > 0 ? '<div class="flex justify-between text-blue-600"><span>Presmerované (→ iná kat.):</span><span class="font-bold">' + summaryRedirCons.toFixed(2) + ' ' + unit + (summaryDeductCons > 0 ? ' <span class="text-amber-500 text-[7px]">(z ' + summaryFullRedirCons.toFixed(0) + ' - odpočet ' + summaryDeductCons.toFixed(0) + ')</span>' : '') + '</span></div>' : '') +
    (summaryDeductCons > 0 ? '<div class="flex justify-between text-amber-600"><span>Odpočet (' + (meterConsumption.filter(function(mc){return mc.isRedirected && mc.deduction > 0;})[0] || {deductionNote:''}).deductionNote + '):</span><span class="font-bold">' + summaryDeductCons.toFixed(2) + ' ' + unit + ' (nie je vo faktúre)</span></div>' : '') +
    (mainMc ?
      '<div class="flex justify-between border-t border-slate-200 pt-1 mt-1' + (summaryRemainder < -0.5 ? ' text-red-600' : summaryRemainder > 0.01 ? ' text-orange-600' : ' text-green-600') + '">' +
        '<span>Rozdiel (straty):</span><span class="font-bold">' + summaryRemainder.toFixed(2) + ' ' + unit + 
        (summaryMainCons > 0 ? ' (' + (summaryRemainder / summaryMainCons * 100).toFixed(1) + '%)' : '') +
        '</span></div>' : 
      '<div class="flex justify-between text-red-600 border-t border-red-200 pt-1 mt-1"><span>⚠</span><span class="font-bold">Chýba hlavný merač – straty nie je možné vypočítať</span></div>'
    ) +
  '</div>';

  // Show warnings for missing/incomplete meters
  if (meterWarnings.length > 0) {
    meterRows.innerHTML += '<div class="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">' +
      '<p class="text-[8px] font-black text-amber-600 uppercase mb-1"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Upozornenia</p>' +
      meterWarnings.map(function(w) {
        return '<p class="text-[9px] text-amber-700">' + w.message + ' – spotreba zahrnutá v stratách</p>';
      }).join('') +
    '</div>';
  }

  // Display allocation preview
  if (zoneAllocs.length === 0) {
    preview.classList.add('hidden');
    return;
  }

  var tenantAllocs = zoneAllocs.filter(function(a) { return a.payer === 'tenant'; });
  var ownerAllocs = zoneAllocs.filter(function(a) { return a.payer === 'owner'; });
  var redirectAllocs = zoneAllocs.filter(function(a) { return a.payer === 'redirect'; });
  var correctionAllocs = zoneAllocs.filter(function(a) { return a.payer === 'correction'; });

  var html = '';

  // Redirected meters info (e.g., vodomer kotolne → Vykurovanie)
  if (redirectAllocs.length > 0) {
    html += '<div class="bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 mb-2">';
    html += '<p class="text-[8px] font-black text-blue-500 uppercase mb-1">Presmerované do inej kategórie (automaticky)</p>';
    html += redirectAllocs.map(function(a) {
      var deductInfo = '';
      if (a.deduction > 0) {
        deductInfo = '<div class="text-[8px] text-amber-600 ml-2">odpočet: -' + a.deduction.toFixed(0) + ' ' + unit +
          (a.deductionNote ? ' (' + a.deductionNote + ')' : '') +
          ' z ' + a.fullConsumption.toFixed(0) + ' ' + unit + '</div>';
      }
      return '<div class="flex items-center justify-between text-[9px]">' +
        '<span class="font-bold text-blue-600 truncate flex-1">' + a.meterName + '</span>' +
        '<span class="text-blue-400 w-16 text-right">' + a.consumption.toFixed(2) + ' ' + unit + '</span>' +
        '<span class="font-black text-blue-600 w-16 text-right">' + a.amount.toFixed(2) + ' €</span>' +
        '<span class="font-bold text-blue-500">' + a.zoneName + '</span>' +
      '</div>' + deductInfo;
    }).join('');
    html += '</div>';
  }

  // Warning if sub-meters exceed main (only show if no correction line)
  if (mainMc3 && subMeterTotal + redirectedFullTotal > mainCons3 + 0.01 && correctionAllocs.length === 0) {
    var excess = subMeterTotal + redirectedFullTotal - mainCons3;
    html += '<div class="bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-2">' +
      '<p class="text-[8px] text-amber-700"><i class="fa-solid fa-triangle-exclamation mr-1"></i>' +
      'Podmerače (' + (subMeterTotal + redirectedFullTotal).toFixed(0) + ' ' + unit + ') prevyšujú hlavný (' + mainCons3.toFixed(0) + ' ' + unit + ') o ' + excess.toFixed(1) + ' ' + unit + ' – bežná nepresnosť meračov</p>' +
    '</div>';
  }

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

  // Correction (sub-meters > main) - informational
  if (correctionAllocs.length > 0) {
    html += '<div class="border-t border-slate-200 mt-2 pt-2">' +
      '<div class="flex items-center justify-between text-[9px] bg-slate-50 rounded-lg px-2 py-1">' +
        '<span class="font-bold text-slate-400"><i class="fa-solid fa-scale-unbalanced mr-1"></i>Nepresnosť meračov</span>' +
        '<span class="text-slate-400">' + correctionAllocs[0].consumption.toFixed(2) + ' ' + unit + '</span>' +
        '<span class="text-[8px] text-slate-300">' + correctionAllocs[0].note + '</span>' +
      '</div></div>';
  }

  // Summary if redirected amounts exist
  if (redirectAllocs.length > 0) {
    var tenantTotal2 = tenantAllocs.reduce(function(s, a) { return s + a.amount; }, 0);
    var ownerTotal2 = ownerAllocs.reduce(function(s, a) { return s + a.amount; }, 0);
    var redirectTotal2 = redirectAllocs.reduce(function(s, a) { return s + a.amount; }, 0);
    html += '<div class="border-t-2 border-slate-300 mt-2 pt-2 space-y-0.5">';
    html += '<div class="flex justify-between text-[8px] text-slate-400 px-2"><span>Nájomcovia</span><span>' + tenantTotal2.toFixed(2) + ' €</span></div>';
    if (ownerTotal2 > 0) html += '<div class="flex justify-between text-[8px] text-orange-400 px-2"><span>Vlastník</span><span>' + ownerTotal2.toFixed(2) + ' €</span></div>';
    html += '<div class="flex justify-between text-[8px] text-blue-400 px-2"><span>→ ' + redirectAllocs.map(function(a) { return a.zoneName.replace('→ ', ''); }).join(', ') + '</span><span>' + redirectTotal2.toFixed(2) + ' €</span></div>';
    html += '<div class="flex justify-between text-[9px] font-black text-slate-800 px-2"><span>Spolu</span><span>' + (tenantTotal2 + ownerTotal2 + redirectTotal2).toFixed(2) + ' €</span></div>';
    html += '</div>';
  }

  allocRows.innerHTML = html;
  preview.classList.remove('hidden');

  // Store meter allocations for save (exclude redirected - they belong to another category)
  var allocUnit = meters[0] ? meters[0].unit : 'm³';
  zoneAllocs.forEach(function(a) { a.unit = allocUnit; });
  window._meterAllocations = zoneAllocs.filter(function(a) { return a.payer !== 'redirect' && a.payer !== 'correction'; });

  // Store meter summary for audit trail on expense
  window._meterSummary = {
    mainConsumption: mainMc ? mainMc.consumption : null,
    subTotal: subMeterTotal,
    redirectedTotal: redirectedTotal,
    redirectedFullTotal: redirectedFullTotal,
    deductionTotal: meterConsumption.filter(function(mc) { return mc.isRedirected; }).reduce(function(s, mc) { return s + (mc.deduction || 0); }, 0),
    losses: mainMc ? (mainMc.consumption - subMeterTotal - redirectedFullTotal) : null,
    lossesPct: mainMc && mainMc.consumption > 0 ? ((mainMc.consumption - subMeterTotal - redirectedFullTotal) / mainMc.consumption * 100) : null,
    unit: allocUnit
  };

  // Store redirected info for creating child expenses
  window._redirectedAllocations = zoneAllocs.filter(function(a) { return a.payer === 'redirect'; }).map(function(a) {
    var rdMeter = redirectedMeters.find(function(rm) { return rm.name === a.meterName; });
    return {
      consumption: a.consumption,
      unit: allocUnit,
      meterName: a.meterName,
      meterId: rdMeter ? rdMeter.id : null,
      targetCategoryId: rdMeter ? rdMeter.cost_category_id : null,
      targetCategoryName: a.zoneName.replace('→ ', ''),
      mainConsumption: mainConsumption,
      calculatedAmount: a.amount  // pre-calculated proportional amount
    };
  });
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
    billing_period_from: document.getElementById('exp-billing-from').value || null,
    billing_period_to: document.getElementById('exp-billing-to').value || null,
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

  // Save meter audit data for transparency in reports
  if (currentAllocMethod === 'meter' && window._meterSummary) {
    var ms = window._meterSummary;
    data.meter_main_consumption = ms.mainConsumption;
    data.meter_sub_consumption = ms.subTotal;
    data.meter_redirected_consumption = ms.redirectedTotal || 0;
    data.meter_losses = ms.losses;
    data.meter_consumption_unit = ms.unit || 'm³';
  } else {
    data.meter_main_consumption = null;
    data.meter_sub_consumption = null;
    data.meter_redirected_consumption = null;
    data.meter_losses = null;
    data.meter_consumption_unit = null;
  }

  // Upload receipt if selected
  var receiptFile = document.getElementById('exp-receipt').files[0];
  if (receiptFile) {
    var receiptUrl = await uploadReceipt(receiptFile);
    if (receiptUrl) data.receipt_url = receiptUrl;
  }

  var expenseId;
  if (editingExpenseId) {
    var updateResult = await sb.from('expenses').update(data).eq('id', editingExpenseId);
    if (updateResult.error) {
      console.warn('Expense update failed, retrying without new columns:', updateResult.error);
      var fallbackData = {};
      for (var k in data) {
        var newCols = ['billing_period_from','billing_period_to','meter_main_consumption','meter_sub_consumption','meter_redirected_consumption','meter_losses','meter_consumption_unit','meter_sub_total','meter_losses_pct','consumption_unit','parent_expense_id','is_auto_generated','auto_source_meter_id']; if (newCols.indexOf(k) < 0) fallbackData[k] = data[k];
      }
      var retryUpdate = await sb.from('expenses').update(fallbackData).eq('id', editingExpenseId);
      if (retryUpdate.error) {
        alert('CHYBA: Náklad sa nepodarilo uložiť!\n\n' + retryUpdate.error.message);
        return;
      }
    }
    expenseId = editingExpenseId;
  } else {
    var insertResult = await sb.from('expenses').insert(data).select('id').single();
    if (insertResult.error) {
      console.warn('Expense insert failed, retrying without new columns:', insertResult.error);
      var fallbackData = {};
      for (var k in data) {
        var newCols = ['billing_period_from','billing_period_to','meter_main_consumption','meter_sub_consumption','meter_redirected_consumption','meter_losses','meter_consumption_unit','meter_sub_total','meter_losses_pct','consumption_unit','parent_expense_id','is_auto_generated','auto_source_meter_id']; if (newCols.indexOf(k) < 0) fallbackData[k] = data[k];
      }
      var retryInsert = await sb.from('expenses').insert(fallbackData).select('id').single();
      if (retryInsert.error) {
        alert('CHYBA: Náklad sa nepodarilo vytvoriť!\n\n' + retryInsert.error.message);
        return;
      }
      expenseId = retryInsert.data ? retryInsert.data.id : null;
    } else {
      expenseId = insertResult.data ? insertResult.data.id : null;
    }
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
          var mZone = allZones.find(function(z) { return z.id === a.zoneId; });
          allocs.push({
            expense_id: expenseId,
            zone_id: a.zoneId,
            percentage: parseFloat(a.pct.toFixed(2)),
            amount: parseFloat(a.amount.toFixed(2)),
            payer: a.payer,
            consumption: parseFloat(a.consumption.toFixed(4)),
            consumption_unit: a.unit || 'm³',
            area_used: mZone ? mZone.area_m2 : null
          });
        });
        var lossAlloc = window._meterAllocations.find(function(a) { return !a.zoneId && a.payer === 'owner'; });
        if (lossAlloc && lossAlloc.consumption > 0.01) {
          // Find common/shared zone by various names
          var commonZone = allZones.find(function(z) { return z.name === 'Spoločné priestory'; })
            || allZones.find(function(z) { return z.name.toLowerCase().indexOf('spoločn') >= 0 || z.name.toLowerCase().indexOf('spoloc') >= 0 || z.name.toLowerCase().indexOf('common') >= 0; });

          if (!commonZone) {
            // Auto-create "Spoločné priestory" zone
            var { data: newZone } = await sb.from('zones').insert({
              name: 'Spoločné priestory',
              area_m2: 0,
              billing_area_m2: 0,
              is_active: true
            }).select('*').single();
            if (newZone) {
              commonZone = newZone;
              allZones.push(newZone);
            }
          }

          if (commonZone) {
            allocs.push({
              expense_id: expenseId,
              zone_id: commonZone.id,
              percentage: parseFloat(lossAlloc.pct.toFixed(2)),
              amount: parseFloat(lossAlloc.amount.toFixed(2)),
              payer: 'owner',
              consumption: parseFloat(lossAlloc.consumption.toFixed(4)),
              consumption_unit: lossAlloc.unit || 'm³',
              area_used: commonZone.area_m2 || null
            });
          } else {
            alert('Upozornenie: Straty (' + lossAlloc.consumption.toFixed(2) + ' ' + (lossAlloc.unit || 'm³') + ' / ' + lossAlloc.amount.toFixed(2) + ' €) sa nepodarilo uložiť – chýba zóna "Spoločné priestory".');
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

        // Calculate total effective area (pool = building area)
        var totalArea = 0;
        zones.forEach(function(z) {
          if (z.isTimeWeighted) {
            totalArea += z.tenantEffArea + z.ownerEffArea;
          } else if (isHeating && z.payer === 'owner') {
            // For heating: owner zones use tempered area
            z.ownerTemperedArea = z.area * (z.temper || 0) / 100;
            totalArea += z.ownerTemperedArea;
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
              months_total: totalMonths,
              tempering_used: isHeating ? (z.temper || 0) : null,
              area_used: z.area
            });
            if (z.payer === 'tenant' && ownerPct > 0) {
              allocs.push({
                expense_id: expenseId,
                zone_id: z.id,
                percentage: parseFloat(ownerPct.toFixed(2)),
                amount: parseFloat((saveAmount * ownerPct / 100).toFixed(2)),
                payer: 'owner',
                months_occupied: 0,
                months_total: totalMonths,
                tempering_used: isHeating ? (z.temper || 0) : null,
                area_used: z.area
              });
            }
          } else {
            // Use billing area for tenant charge, pool area for denominator
            var chargeArea;
            if (isHeating && z.payer === 'owner' && z.ownerTemperedArea !== undefined) {
              chargeArea = z.ownerTemperedArea;
            } else {
              chargeArea = (z.payer === 'tenant') ? (z.billingArea || z.area) : z.area;
            }
            var pct = totalArea > 0 ? (chargeArea / totalArea * 100) : (100 / zones.length);
            allocs.push({
              expense_id: expenseId,
              zone_id: z.id,
              percentage: parseFloat(pct.toFixed(2)),
              amount: parseFloat((saveAmount * pct / 100).toFixed(2)),
              payer: z.payer,
              tempering_used: isHeating ? (z.temper || 0) : null,
              area_used: z.area
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
            payer: 'owner',
            tempering_used: z.temper,
            area_used: z.area
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
        var insertResult = await sb.from('expense_allocations').insert(allocs);
        if (insertResult.error) {
          console.warn('Allocation insert failed, retrying without new columns:', insertResult.error);
          // Strip new columns that might not exist yet (migration not run)
          var fallbackAllocs = allocs.map(function(a) {
            var copy = {};
            for (var k in a) {
              if (k !== 'area_used' && k !== 'tempering_used') copy[k] = a[k];
            }
            return copy;
          });
          var retryResult = await sb.from('expense_allocations').insert(fallbackAllocs);
          if (retryResult.error) {
            alert('CHYBA: Alokácie sa nepodarilo uložiť!\n\n' + retryResult.error.message);
            console.error('Allocation insert retry failed:', retryResult.error);
          } else {
            alert('Upozornenie: Alokácie uložené, ale bez sledovania zmien plôch/temperovania.\n\nSpustite migrácie v Supabase:\n- migration_add_tempering_used.sql\n- migration_add_area_used.sql');
          }
        }
      }
    } catch(allocErr) {
      console.warn('Allocation save error (table may not exist):', allocErr);
    }

    // Post-save validation: check saved allocations sum matches expense amount
    try {
      var { data: savedAllocs = [] } = await sb.from('expense_allocations')
        .select('amount, payer')
        .eq('expense_id', expenseId);
      var savedTotal = savedAllocs.reduce(function(s, a) { return s + (parseFloat(a.amount) || 0); }, 0);
      var expAmount = parseFloat(data.amount) || 0;
      // For amortized expenses, compare against yearly amount
      if (data.cost_type === 'amortized' && data.amort_years > 0) {
        expAmount = expAmount / data.amort_years;
      }
      var diff = Math.abs(savedTotal - expAmount);
      if (diff > 1 && savedAllocs.length > 0) {
        var ownerTotal = savedAllocs.filter(function(a) { return a.payer === 'owner'; }).reduce(function(s, a) { return s + (parseFloat(a.amount) || 0); }, 0);
        var tenantTotal = savedAllocs.filter(function(a) { return a.payer !== 'owner'; }).reduce(function(s, a) { return s + (parseFloat(a.amount) || 0); }, 0);
        alert('⚠ Kontrola po uložení:\n\n' +
          'Suma faktúry: ' + expAmount.toFixed(2) + ' €\n' +
          'Uložené alokácie: ' + savedTotal.toFixed(2) + ' €\n' +
          'Rozdiel: ' + diff.toFixed(2) + ' €\n\n' +
          'Nájomcovia: ' + tenantTotal.toFixed(2) + ' €\n' +
          'Vlastník: ' + ownerTotal.toFixed(2) + ' €\n\n' +
          'Skontrolujte rozpočítanie – možno chýbajú straty alebo niektoré zóny.');
      }
    } catch(valErr) {
      console.warn('Post-save validation error:', valErr);
    }
  }

  // Redirected meter amounts (water/electricity → Vykurovanie) are handled
  // directly in PDF via meter_redirected_consumption field on the parent expense.
  // No auto-child expenses needed.
  window._redirectedAllocations = null;

  // Clean up any legacy auto-children from previous versions
  if (expenseId) {
    var { data: legacyChildren = [] } = await sb.from('expenses').select('id')
      .eq('parent_expense_id', expenseId).eq('is_auto_generated', true);
    for (var ci = 0; ci < legacyChildren.length; ci++) {
      await sb.from('expense_allocations').delete().eq('expense_id', legacyChildren[ci].id);
      await sb.from('expenses').delete().eq('id', legacyChildren[ci].id);
    }
  }

  window.closeExpenseModal();
  await loadExpenses();
  if (window.loadOverview) await window.loadOverview();
};

window.editExpense = async function(id) {
  var { data: e } = await sb.from('expenses').select('*').eq('id', id).single();
  if (!e) return;

  // Refresh lease dates from DB before anything else
  await window.refreshZoneLeaseDates();

  editingExpenseId = id;
  document.getElementById('expense-modal-title').innerText = 'Upraviť náklad';
  document.getElementById('exp-date').value = e.date;
  document.getElementById('exp-category').value = e.category_id;
  document.getElementById('exp-desc').value = e.description;
  document.getElementById('exp-supplier').value = e.supplier || '';
  document.getElementById('exp-amount').value = e.amount;
  document.getElementById('exp-invoice').value = e.invoice_number || '';
  document.getElementById('exp-billing-from').value = e.billing_period_from || '';
  document.getElementById('exp-billing-to').value = e.billing_period_to || '';
  document.getElementById('exp-period-from').value = e.period_from || '';
  document.getElementById('exp-period-from').setAttribute('data-auto', 'false');
  document.getElementById('exp-period-to').value = e.period_to || '';
  document.getElementById('exp-period-to').setAttribute('data-auto', 'false');
  // Show hint if billing ≠ accounting period
  var hint = document.getElementById('period-hint');
  if (e.billing_period_from && e.period_from && (e.billing_period_from !== e.period_from || e.billing_period_to !== e.period_to)) {
    hint.textContent = 'Zúčt. obdobie ≠ fakturačné';
  } else {
    hint.textContent = '';
  }
  document.getElementById('exp-note').value = e.note || '';
  document.getElementById('exp-ref').value = e.ref_number || '';
  document.getElementById('exp-cost-type').value = e.cost_type || 'operating';
  document.getElementById('exp-amort-years').value = e.amort_years || '';
  window.toggleAmortFields();

  // Load existing allocations
  // First refresh checkbox data attributes from current allZones
  var cbsRefresh = document.querySelectorAll('.alloc-zone-cb');
  for (var r = 0; r < cbsRefresh.length; r++) {
    var zd = allZones.find(function(z) { return z.id === cbsRefresh[r].value; });
    if (zd) {
      cbsRefresh[r].setAttribute('data-area', zd.area_m2 || 0);
      cbsRefresh[r].setAttribute('data-billing-area', zd.billing_area_m2 || zd.area_m2 || 0);
      cbsRefresh[r].setAttribute('data-temper', zd.tempering_pct || 0);
    }
  }
  var { data: allocs = [] } = await sb.from('expense_allocations').select('zone_id, payer, months_occupied, months_total').eq('expense_id', id);
  var allocMap = {};
  allocs.forEach(function(a) {
    // For time-weighted zones, there are 2 rows: tenant + owner (auto-generated).
    // Prefer the non-owner entry as that represents the user's choice.
    if (!allocMap[a.zone_id] || allocMap[a.zone_id].payer === 'owner') {
      allocMap[a.zone_id] = a;
    }
  });
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
    // Always recalculate months from lease dates when editing
    // DB values were often wrong due to earlier bugs - fresh calc is always correct
    var monthsInput = document.querySelector('[data-months-input="' + cbs[i].value + '"]');
    if (monthsInput) {
      monthsInput.value = '';
      monthsInput.setAttribute('data-auto', 'true');
      // Debug: log what we're doing for zones that had saved months
      var allocData = allocMap[cbs[i].value];
      if (allocData && allocData.months_occupied != null) {
        var zLabel = cbs[i].nextElementSibling ? cbs[i].nextElementSibling.textContent : cbs[i].value;
        console.log('Months reset:', zLabel, 'DB had:', allocData.months_occupied + '/' + allocData.months_total, 'lease-from:', cbs[i].getAttribute('data-lease-from') || '(none)');
      }
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
  try {
    if (window.updateMonthsVisibility) window.updateMonthsVisibility();
    window.updateAllocPreview();
  } catch(recalcErr) {
    console.warn('Recalc after edit error:', recalcErr);
  }
};

window.deleteExpense = async function(id) {
  if (!confirm('Vymazať tento náklad?')) return;
  // Delete child expenses and their allocations first
  var { data: children = [] } = await sb.from('expenses').select('id').eq('parent_expense_id', id);
  for (var i = 0; i < children.length; i++) {
    await sb.from('expense_allocations').delete().eq('expense_id', children[i].id);
    await sb.from('expenses').delete().eq('id', children[i].id);
  }
  await sb.from('expense_allocations').delete().eq('expense_id', id);
  await sb.from('expenses').delete().eq('id', id);
  await loadExpenses();
  if (window.loadOverview) await window.loadOverview();
};

window.duplicateExpense = async function(id) {
  var { data: orig } = await sb.from('expenses').select('*').eq('id', id).single();
  if (!orig) return;

  // Refresh lease dates from DB
  await window.refreshZoneLeaseDates();

  // Open as NEW expense (no editingExpenseId) with data pre-filled from original
  editingExpenseId = null;
  document.getElementById('expense-modal-title').innerText = 'Duplikát nákladu';
  document.getElementById('exp-date').value = orig.date || new Date().toISOString().split('T')[0];
  document.getElementById('exp-category').value = orig.category_id;
  document.getElementById('exp-desc').value = orig.description || '';
  document.getElementById('exp-supplier').value = orig.supplier || '';
  document.getElementById('exp-amount').value = orig.amount || '';
  document.getElementById('exp-invoice').value = orig.invoice_number ? orig.invoice_number + '-KÓPIA' : '';
  document.getElementById('exp-billing-from').value = orig.billing_period_from || '';
  document.getElementById('exp-billing-to').value = orig.billing_period_to || '';
  document.getElementById('exp-period-from').value = orig.period_from || '';
  document.getElementById('exp-period-from').setAttribute('data-auto', 'false');
  document.getElementById('exp-period-to').value = orig.period_to || '';
  document.getElementById('exp-period-to').setAttribute('data-auto', 'false');
  document.getElementById('period-hint').textContent = '';
  document.getElementById('exp-note').value = orig.note || '';
  document.getElementById('exp-ref').value = '';
  document.getElementById('exp-cost-type').value = orig.cost_type || 'operating';
  document.getElementById('exp-amort-years').value = orig.amort_years || '';
  window.toggleAmortFields();

  // Load original allocations to restore zone checkboxes + payer selections
  var { data: allocs = [] } = await sb.from('expense_allocations').select('zone_id, payer').eq('expense_id', id);
  var allocMap = {};
  allocs.forEach(function(a) {
    if (!allocMap[a.zone_id] || allocMap[a.zone_id].payer === 'owner') {
      allocMap[a.zone_id] = a;
    }
  });

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
    // Fresh months calculation (no stale DB values)
    var monthsInput = document.querySelector('[data-months-input="' + cbs[i].value + '"]');
    if (monthsInput) {
      monthsInput.value = '';
      monthsInput.setAttribute('data-auto', 'true');
    }
  }

  // Restore allocation method
  var savedMethod = orig.alloc_method || 'area';
  window.setAllocMethod(savedMethod);

  // Clear receipt (don't copy - user uploads new one)
  document.getElementById('exp-receipt').value = '';
  var preview = document.getElementById('exp-receipt-preview');
  var img = document.getElementById('exp-receipt-img');
  if (img) { img.src = ''; img.classList.add('hidden'); }
  var oldLink = preview.querySelector('.receipt-pdf-link');
  if (oldLink) oldLink.remove();
  preview.classList.add('hidden');
  document.getElementById('btn-ai-extract').classList.add('hidden');

  document.getElementById('modal-expense').classList.remove('hidden');

  // Recalculate
  try {
    if (window.updateMonthsVisibility) window.updateMonthsVisibility();
    window.updateAllocPreview();
  } catch(err) {
    console.warn('Recalc after duplicate error:', err);
  }
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

    content.push({ type: 'text', text: 'Analyzuj túto účtenku/faktúru. DÔLEŽITÉ: "amount" má byť FAKTUROVANÁ SUMA (celková suma s DPH za služby), NIE preplatok, nedoplatok alebo zostatok. Ak je to vyúčtovacia faktúra, použi fakturovanú sumu s DPH. Vráť LEN JSON bez markdown, bez backticks:\n{"date":"YYYY-MM-DD dátum vystavenia","description":"stručný popis napr. Plyn - vyúčtovanie 2025","supplier":"názov dodávateľa","amount":číslo fakturovanej sumy s DPH,"invoice_number":"číslo faktúry alebo null","period_from":"YYYY-MM-DD alebo null","period_to":"YYYY-MM-DD alebo null","category":"jedna z: Vykurovanie, EPS a PO, EZS, Odvoz smetí, Voda a kanalizácia, Elektrina, Správa, Náklady na budovu, Údržba, Upratovanie, Opravy, Ostatné","meter_number":"číslo merača ak je na faktúre alebo null","consumption":"spotreba v m3 alebo kWh ak je na faktúre alebo null","consumption_unit":"m3 alebo kWh alebo null"}' });

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
    // AI-extracted period goes to billing period (what's on the invoice)
    if (result.period_from) document.getElementById('exp-billing-from').value = result.period_from;
    if (result.period_to) document.getElementById('exp-billing-to').value = result.period_to;
    // Accounting period = full year of billing period (or invoice date)
    var refDate = result.period_from || result.date || '';
    if (refDate) {
      var refYear = refDate.substring(0, 4);
      document.getElementById('exp-period-from').value = refYear + '-01-01';
      document.getElementById('exp-period-from').setAttribute('data-auto', 'true');
      document.getElementById('exp-period-to').value = refYear + '-12-31';
      document.getElementById('exp-period-to').setAttribute('data-auto', 'true');
      var hint = document.getElementById('period-hint');
      if (result.period_from && (result.period_from !== refYear + '-01-01' || result.period_to !== refYear + '-12-31')) {
        hint.textContent = 'Zúčt. obdobie = celý rok ' + refYear + ' (fakt. obdobie: ' + result.period_from + ' – ' + result.period_to + ')';
      } else {
        hint.textContent = '';
      }
    }

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


