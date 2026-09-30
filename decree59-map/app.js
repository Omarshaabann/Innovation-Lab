(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => n == null ? '—' : Number(n).toLocaleString('en-US');
  const usd = n => n == null ? '—' : fmt(n) + ' $';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const st = k => STATUS[k];

  const state = { statuses: new Set(Object.keys(STATUS)), gov: 'all', sector: 'all', q: '', onlyContracting: true, layer: 'projects' };

  /* ---------- الخريطة ---------- */
  const map = L.map('map', { zoomControl: true, minZoom: 7 }).setView([35.75, 36.85], 8);
  // OpenStreetMap يحجب التضمين داخل المواقع (403)، لذا نستخدم CARTO مع بديل Esri تلقائي عند الفشل
  const BASES = [
    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', o: { subdomains: 'abcd', attribution: '© مساهمو OpenStreetMap © CARTO' } },
    { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', o: { attribution: 'Tiles © Esri' } },
  ];
  let baseIdx = 0, tileErrs = 0, base = null;
  function useBase(i) {
    if (base) map.removeLayer(base);
    base = L.tileLayer(BASES[i].url, Object.assign({ maxZoom: 18, crossOrigin: false }, BASES[i].o)).addTo(map);
    base.bringToBack();
    base.on('tileerror', () => { if (++tileErrs === 6 && baseIdx < BASES.length - 1) { tileErrs = 0; useBase(++baseIdx); } });
  }
  useBase(0);
  const projLayer = L.layerGroup().addTo(map);
  const surveyLayer = L.layerGroup();

  /* ---------- الفلاتر ---------- */
  const matchBase = p =>
    (state.gov === 'all' || p.gov === state.gov) &&
    (state.sector === 'all' || p.sector === state.sector) &&
    (!state.q || (p.name + ' ' + (p.place || '') + ' ' + (p.note || '')).includes(state.q));
  const matchList = p => matchBase(p) && state.statuses.has(p.status) && (!state.onlyContracting || p.status === 'contracting');

  function buildControls() {
    Object.entries(GOV).forEach(([k, g]) => $('#fGov').insertAdjacentHTML('beforeend', `<option value="${k}">${g.name}</option>`));
    Object.entries(SECTOR).forEach(([k, s]) => $('#fSector').insertAdjacentHTML('beforeend', `<option value="${k}">${s.icon} ${s.label}</option>`));
    $('#fStatus').innerHTML = Object.entries(STATUS).map(([k, s]) =>
      `<button class="chip on" style="--c:${s.color}" data-s="${k}">${s.short}</button>`).join('');
    $('#legend').innerHTML = '<div class="hd">حالة المشروع</div>' + Object.values(STATUS).map(s =>
      `<div><i style="--c:${s.color}"></i>${s.short}</div>`).join('') +
      '<div><i style="--c:#fff;outline:2px dashed #888"></i>موقع غير محدد بعد</div>';
  }
  function syncChips() {
    document.querySelectorAll('#fStatus .chip').forEach(c => {
      const on = state.onlyContracting ? c.dataset.s === 'contracting' : state.statuses.has(c.dataset.s);
      c.classList.toggle('on', on);
    });
  }

  /* ---------- الخريطة: مجموعات المواقع ---------- */
  function groups() {
    const m = new Map();
    PROJECTS.filter(matchBase).filter(p => state.statuses.has(p.status) || state.onlyContracting).forEach(p => {
      const ll = p.ll || GOV[p.gov].agg;
      const key = p.ll ? p.gov + '|' + ll[0].toFixed(2) + ',' + ll[1].toFixed(2) : 'agg|' + p.gov;
      if (!m.has(key)) m.set(key, { ll, gov: p.gov, items: [], agg: !p.ll });
      m.get(key).items.push(p);
    });
    return [...m.values()];
  }
  const cnt = arr => arr.reduce((a, p) => a + p.count, 0);

  function renderMap() {
    projLayer.clearLayers();
    groups().forEach(g => {
      const hasC = g.items.some(p => p.status === 'contracting');
      const best = g.items.reduce((a, p) => st(p.status).rank < st(a.status).rank ? p : a).status;
      const n = cnt(g.items);
      const dim = state.onlyContracting && !hasC;
      const size = Math.round(Math.min(46, 22 + Math.sqrt(n) * 3.4)) + (hasC ? 4 : 0);
      const label = g.items.length === 1 && !g.agg && g.items[0].count === 1 ? SECTOR[g.items[0].sector].icon : fmt(n);
      const icon = L.divIcon({
        className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: `<div class="pin ${hasC ? 'contract' : ''} ${g.agg ? 'agg' : ''} ${dim ? 'dim' : ''}" style="--c:${st(best).color};width:${size}px;height:${size}px;font-size:${size > 30 ? 14 : 12}px">${label}</div>`
      });
      const mk = L.marker(g.ll, { icon, zIndexOffset: hasC ? 1000 : 0, riseOnHover: true }).addTo(projLayer);
      mk.bindPopup(() => popupHtml(g), { maxWidth: 320 });
      g.marker = mk; g.items.forEach(p => { p._g = g; });
    });
  }

  function itemHtml(p) {
    const s = st(p.status);
    return `<div class="it" style="--c:${s.color}"><b><span class="dot"></span>${esc(p.name)}${p.count > 1 ? ` (${p.count})` : ''}</b>
      <span style="color:${s.color}">${s.short}</span>${p.stage ? ` · <span class="stage">${STAGE[p.stage]}</span>` : ''}
      ${p.cost ? `<br>الكلفة: ${usd(p.cost)}` : ''}${p.ben ? ` · المستفيدون: ${fmt(p.ben)}` : ''}${p.type ? `<br>${esc(p.type)}` : ''}
      ${p.note ? `<br><small>${esc(p.note)}</small>` : ''}</div>`;
  }
  function popupHtml(g) {
    const items = g.items.slice().sort((a, b) => st(a.status).rank - st(b.status).rank);
    const title = g.agg ? `مواقع غير محددة – ${GOV[g.gov].name}` : (items[0].place || items[0].name).split(' – ')[0];
    return `<div class="pop"><h3>${esc(title)}</h3><div class="sub">${GOV[g.gov].name} · ${fmt(cnt(items))} مشروع${g.agg ? '' : items.some(p => p.approx) ? ' · الموقع تقريبي' : ''}</div>
      <div class="items">${items.map(itemHtml).join('')}</div></div>`;
  }

  /* ---------- القائمة ---------- */
  function renderList() {
    const rows = PROJECTS.filter(matchList).sort((a, b) =>
      st(a.status).rank - st(b.status).rank || a.gov.localeCompare(b.gov) || a.id - b.id);
    const total = cnt(rows), cost = costOf(rows);
    $('#count').textContent = `${fmt(total)} مشروع` + (cost ? ` · كلفة معلومة: ${usd(cost)}` : '');
    let html = '', last = '';
    rows.forEach(p => {
      const key = p.status + '|' + p.gov;
      if (key !== last) { html += `<div class="gh">${st(p.status).short} – ${GOV[p.gov].name}</div>`; last = key; }
      const s = st(p.status);
      html += `<div class="card" style="--c:${s.color}" data-id="${p.id}">
        <div class="t">${SECTOR[p.sector].icon} ${esc(p.name)}${p.count > 1 ? ` <small>(${p.count})</small>` : ''}</div>
        <div class="m"><span class="badge">${s.short}</span>${p.place ? `<span>📍 ${esc(p.place.split(' – ')[0])}</span>` : '<span>📍 غير محدد</span>'}
        ${p.cost ? `<span>${usd(p.cost)}</span>` : ''}${p.stage ? `<span class="stage">${STAGE[p.stage]}</span>` : ''}</div></div>`;
    });
    $('#list').innerHTML = html || '<p style="color:#5d6d66">لا توجد مشاريع مطابقة.</p>';
  }
  function costOf(rows) {
    const pools = new Set(); let t = 0;
    rows.forEach(p => { if (p.cost) t += p.cost; if (p.pool && !pools.has(p.pool)) { pools.add(p.pool); t += p.poolCost; } });
    return t;
  }

  function focusProject(id) {
    const p = PROJECTS.find(x => x.id === id); if (!p) return;
    if (state.layer === 'survey') setLayer('projects');
    const g = p._g;
    if (!g || !map.hasLayer(projLayer)) return;
    map.flyTo(g.ll, Math.max(map.getZoom(), g.agg ? 9 : 11), { duration: .7 });
    setTimeout(() => g.marker.openPopup(), 750);
    if (matchMedia('(max-width:820px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- نظرة عامة ---------- */
  function renderOverview() {
    const by = (gov, s) => PROJECTS.filter(p => (!gov || p.gov === gov) && (!s || p.status === s));
    const all = cnt(PROJECTS), con = cnt(by(null, 'contracting'));
    const conCost = costOf(by(null, 'contracting'));
    const govRows = Object.entries(GOV).map(([k, g]) => {
      const tot = cnt(by(k)), parts = Object.keys(STATUS).map(s => cnt(by(k, s)));
      const bar = Object.keys(STATUS).map((s, i) => `<i style="--c:${STATUS[s].color};width:${parts[i] / tot * 100}%" title="${STATUS[s].short}: ${parts[i]}"></i>`).join('');
      return `<tr class="click" data-gov="${k}"><td>${g.name}</td><td class="n">${tot}</td><td class="n"><b style="color:var(--contract)">${parts[0]}</b></td>
        <td class="n">${fmt(GOV_STATS[k].cost)}</td></tr><tr><td colspan="4"><div class="stack">${bar}</div></td></tr>`;
    }).join('');
    const sectors = Object.entries(SECTOR).map(([k, s]) => {
      const c = cnt(PROJECTS.filter(p => p.sector === k && p.status === 'contracting'));
      return c ? `<tr><td>${s.icon} ${s.label}</td><td class="n"><b>${c}</b></td><td class="n">${usd(costOf(PROJECTS.filter(p => p.sector === k && p.status === 'contracting')))}</td></tr>` : '';
    }).join('');
    const stages = {};
    PROJECTS.filter(p => p.status === 'contracting').forEach(p => stages[p.stage] = (stages[p.stage] || 0) + p.count);
    $('#pane-overview').innerHTML = `
      <div class="kpis">
        <div class="kpi hero"><b>${con}</b><span>مشروعاً يتم التعاقد على تنفيذها – ${(con / all * 100).toFixed(1)}% من المصنّف · كلفة معلومة ${usd(conCost)}</span></div>
        <div class="kpi"><b>${all}</b><span>مشروعاً مقرراً – 25,029,515 $</span></div>
        <div class="kpi" style="--c:var(--studied)"><b>${cnt(by(null, 'studied'))}</b><span>دراسة كاملة من سيسكو</span></div>
        <div class="kpi" style="--c:var(--audit)"><b>${cnt(by(null, 'audit'))}</b><span>مدروسة – تدقيق سيسكو</span></div>
        <div class="kpi" style="--c:var(--unresolved)"><b>${cnt(by(null, 'unresolved'))}</b><span>لم يُتفق بشأنها – بحاجة إلى قرار</span></div>
      </div>
      <h2>مراحل المشاريع قيد التعاقد</h2>
      <table><tbody>${Object.entries(stages).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${STAGE[k]}</td><td class="n"><b>${v}</b></td></tr>`).join('')}</tbody></table>
      <h2>حسب المحافظة</h2>
      <table><thead><tr><th>المحافظة</th><th>المقرر</th><th>تعاقد</th><th>الكلفة ($)</th></tr></thead><tbody>${govRows}</tbody></table>
      <div style="font-size:12px;margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 12px">${Object.values(STATUS).map(s => `<span><i style="display:inline-block;width:10px;height:10px;background:${s.color};border-radius:2px"></i> ${s.short}</span>`).join('')}</div>
      <h2>المشاريع قيد التعاقد حسب القطاع</h2>
      <table><thead><tr><th>القطاع</th><th>العدد</th><th>الكلفة المعلومة</th></tr></thead><tbody>${sectors}</tbody></table>
      <p class="src">المصدر: تقرير «الوضع الحالي لمشاريع المرسوم 59» – تحديث 29/09/2026 (إصدار مُستدرَك يحلّ محل تقرير 28/09). التصنيف وفق اجتماع 28/09 بين معاون الوزير للشؤون الفنية ومعاوني مديري سيبكو وسيسكو. كلفة مدارس إدلب (3,440,683 $) مجمّعة ولم تُوزَّع على المدارس.</p>`;
    $('#pane-overview').querySelectorAll('tr.click').forEach(r => r.onclick = () => { setGov(r.dataset.gov); switchTab('list'); });
  }

  /* ---------- المسح السكني ---------- */
  function renderSurvey() {
    const T = SURVEY.reduce((a, s) => a + s.target, 0), D = SURVEY.reduce((a, s) => a + s.done, 0);
    const govs = ['aleppo', 'hama', 'latakia', 'idlib'].map(g => {
      const r = SURVEY.filter(s => s.gov === g), t = r.reduce((a, s) => a + s.target, 0), d = r.reduce((a, s) => a + s.done, 0);
      return `<tr><td>${GOV_NAME[g]}</td><td class="n">${fmt(t)}</td><td class="n">${fmt(d)}</td><td><div class="bar"><i style="width:${d / t * 100}%"></i></div></td><td class="n">${(d / t * 100).toFixed(1)}%</td></tr>`;
    }).join('');
    const rows = SURVEY.map((s, i) => `<tr class="click" data-i="${i}"><td>${s.name}<br><small style="color:#5d6d66">${GOV_NAME[s.gov]}${s.start ? ' · بدأ ' + s.start : ' · لم يبدأ'}</small></td>
      <td class="n">${fmt(s.target)}</td><td class="n">${fmt(s.done)}</td><td><div class="bar"><i style="width:${s.done / s.target * 100}%"></i></div></td><td class="n">${(s.done / s.target * 100).toFixed(0)}%</td></tr>`).join('');
    $('#pane-survey').innerHTML = `
      <div class="kpis">
        <div class="kpi hero" style="--c:var(--green)"><b>${fmt(D)} / ${fmt(T)}</b><span>مسكناً ممسوحاً في المرحلة الأولى (${(D / T * 100).toFixed(1)}%) – 20 قرية وبلدة</span></div>
        <div class="kpi"><b>${fmt(T - D)}</b><span>مسكناً غير منفذ</span></div>
        <div class="kpi"><b>68,682</b><span>مسكناً متضرراً يملكها قاطنو المخيمات</span></div>
      </div>
      <h2>حسب المحافظة</h2>
      <table><thead><tr><th>المحافظة</th><th>المستهدف</th><th>المنجز</th><th></th><th></th></tr></thead><tbody>${govs}</tbody></table>
      <h2>حسب القرية (اضغط للانتقال على الخريطة)</h2>
      <table><thead><tr><th>القرية</th><th>المستهدف</th><th>المنجز</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="src">كلفة الترميم: بالمتوسط الحالي (14,600 $) للمرحلة الأولى ≈ 152.96 مليون $، وبالسقف الموجَّه (6,000 $) ≈ 62.86 مليون $. الفرق بين المسح المنجز والمخطَّط موزَّع بين حلب (≈ 4–5 أيام عمل)، حماة (≈ 23–24 يوم عمل) وإدلب (لم يبدأ – يلزم فريق مستقل).</p>`;
    $('#pane-survey').querySelectorAll('tr.click').forEach(r => r.onclick = () => {
      const s = SURVEY[+r.dataset.i]; setLayer('survey'); map.flyTo(s.ll, 12, { duration: .7 });
      map.once('moveend', () => surveyLayer.eachLayer(l => l._s === s && l.openPopup()));
      if (matchMedia('(max-width:820px)').matches) $('#map').scrollIntoView({ behavior: 'smooth' });
    });
  }
  function renderSurveyLayer() {
    surveyLayer.clearLayers();
    SURVEY.forEach(s => {
      const p = s.done / s.target, col = p >= 1 ? '#1b6b52' : p > 0 ? '#e0a100' : '#8a94a0';
      const c = L.circleMarker(s.ll, { radius: 6 + Math.sqrt(s.target) / 3.2, color: '#123', weight: 1.5, fillColor: col, fillOpacity: p > 0 ? .8 : .25, dashArray: p > 0 ? null : '3 3' });
      c._s = s;
      c.bindPopup(`<div class="pop"><h3>مسح المساكن – ${s.name}</h3><div class="sub">${GOV_NAME[s.gov]}${s.start ? ' · بدء العمل ' + s.start : ' · لم يبدأ'}</div>
        المستهدف: <b>${fmt(s.target)}</b> · المنجز: <b>${fmt(s.done)}</b> · المتبقي: <b>${fmt(s.target - s.done)}</b>
        <div class="bar" style="margin-top:6px"><i style="width:${p * 100}%"></i></div>${(p * 100).toFixed(1)}%</div>`);
      c.addTo(surveyLayer);
    });
  }

  function renderDecisions() {
    $('#pane-decisions').innerHTML = `<h2 style="margin-top:0">القرارات المطلوبة</h2><ol class="dec">${DECISIONS.map(d => `<li>${d}</li>`).join('')}</ol>
      <p class="src">بحسب تقرير 29/09/2026. المشاريع «لم يُتفق بشأنها» (24) تظهر باللون الأحمر على الخريطة.</p>`;
  }

  /* ---------- تفاعل ---------- */
  function setLayer(l) {
    state.layer = l;
    document.querySelectorAll('.layer-switch button').forEach(b => b.classList.toggle('on', b.dataset.layer === l));
    l === 'survey' ? map.removeLayer(projLayer) : map.addLayer(projLayer);
    l === 'projects' ? map.removeLayer(surveyLayer) : map.addLayer(surveyLayer);
    $('#legend').style.display = l === 'survey' ? 'none' : '';
  }
  function setGov(g) {
    state.gov = g; $('#fGov').value = g; refresh();
    if (g !== 'all') map.flyTo(GOV[g].center, GOV[g].zoom, { duration: .7 });
  }
  function switchTab(t) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t));
  }
  function refresh() { syncChips(); renderMap(); renderList(); }

  function bind() {
    document.querySelectorAll('.layer-switch button').forEach(b => b.onclick = () => setLayer(b.dataset.layer));
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
    $('#onlyContracting').onchange = e => { state.onlyContracting = e.target.checked; refresh(); };
    $('#q').oninput = e => { state.q = e.target.value.trim(); refresh(); };
    $('#fGov').onchange = e => setGov(e.target.value);
    $('#fSector').onchange = e => { state.sector = e.target.value; refresh(); };
    $('#fStatus').onclick = e => {
      const b = e.target.closest('.chip'); if (!b) return;
      if (state.onlyContracting) { state.onlyContracting = false; $('#onlyContracting').checked = false; state.statuses = new Set([b.dataset.s]); }
      else state.statuses.has(b.dataset.s) ? state.statuses.delete(b.dataset.s) : state.statuses.add(b.dataset.s);
      if (!state.statuses.size) state.statuses = new Set(Object.keys(STATUS));
      refresh();
    };
    $('#list').onclick = e => { const c = e.target.closest('.card'); if (c) focusProject(+c.dataset.id); };
    $('#csv').onclick = () => {
      const head = ['المحافظة', 'القطاع', 'المشروع', 'الموقع', 'الحالة', 'المرحلة', 'الكلفة ($)', 'العدد', 'ملاحظات'];
      const rows = PROJECTS.filter(matchList).map(p => [GOV[p.gov].name, SECTOR[p.sector].label, p.name, p.place || '', st(p.status).short, p.stage ? STAGE[p.stage] : '', p.cost ?? '', p.count, p.note || '']);
      const csv = '﻿' + [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'decree59-projects.csv'; a.click();
    };
  }

  /* ---------- تشغيل + فحص اتساق مع أرقام التقرير ---------- */
  buildControls(); bind(); renderSurveyLayer(); renderOverview(); renderSurvey(); renderDecisions(); refresh();
  const bad = [];
  Object.entries(GOV_STATS).forEach(([g, s]) => Object.keys(STATUS).forEach(k => {
    const c = cnt(PROJECTS.filter(p => p.gov === g && p.status === k));
    if (c !== s[k]) bad.push(`${g}/${k}: ${c} ≠ ${s[k]}`);
  }));
  if (bad.length) console.warn('عدم اتساق مع أرقام التقرير:', bad);
  window.__decree59 = { state, map, mismatches: bad };
  map.setView([35.7, 36.75], 8);
})();
