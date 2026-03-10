/* ????????????????????????????????????????
   撌交???蝯梯??銵冽 - Application Logic
   ????????????????????????????????????????*/

// ?? Firebase Configuration ??
// ?? 隢‵?乩???Firebase Web App 閮剖?
// ??Firebase Console ??撠?閮剖? ??銝????雿??蝔? ??Firebase SDK snippet
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAzsCS9fVmD-XSMLkpa8GVVSGzOIJ4k4cY', // ??隢??
  authDomain: 'work-report-system-26c12.firebaseapp.com',
  projectId: 'work-report-system-26c12',
};

// App Check — reCAPTCHA Enterprise Site Key
// 前往 Firebase Console → App Check 註冊後取得 site key
const RECAPTCHA_SITE_KEY = 'YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY'; // TODO: 替換

// ?? App State ??
const state = {
  rawData: [],
  filteredData: [],
  sortCol: 'yearMonth',
  sortDir: 'desc',
  filterMonth: 'all',
  filterPerson: 'all',
  searchText: '',
  charts: { trend: null, comparison: null },
};

// ????????????????????????????????????????
// Initialization
// ????????????????????????????????????????
// 閮餃? datalabels ?辣
Chart.register(ChartDataLabels);

async function fetchDataWithRetry(db, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const [snapshot, metaDoc] = await Promise.all([
        db.collection('efficiency_stats').get(),
        db.collection('efficiency_stats').doc('_metadata').get().catch(() => null),
      ]);
      return { snapshot, metaDoc };
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 500;
      console.warn(
        `Firestore 連線失敗 (第 ${attempt + 1} 次)，${delay}ms 後重試...`,
        err,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);

    // App Check 防爬蟲
    const appCheck = firebase.appCheck();
    appCheck.activate(
      new firebase.appCheck.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      true,
    );

    const db = firebase.firestore();

    // ??頛蝯梯?鞈???metadata
    const { snapshot, metaDoc } = await fetchDataWithRetry(db);

    // 閫??鞈?嚗???_metadata ?辣嚗?
    state.rawData = [];
    snapshot.forEach((doc) => {
      if (doc.id === '_metadata') return;
      state.rawData.push({ id: doc.id, ...doc.data() });
    });

    // 憿舐內?敺?甇交???
    if (metaDoc && metaDoc.exists) {
      const meta = metaDoc.data();
      const syncTime = meta.lastSyncTime
        ? new Date(meta.lastSyncTime).toLocaleString('zh-TW')
        : '?芰';
      document.getElementById('lastUpdated').textContent =
        '?敺?甇? ' + syncTime;
    } else {
      document.getElementById('lastUpdated').textContent = '撌脤??';
    }

    // ????UI
    populateFilters();
    setupEventListeners();
    applyFiltersAndRender();

    // ?梯? loading
    document.getElementById('loadingOverlay').classList.add('hidden');
  } catch (err) {
    console.error('???仃??', err);
    showError(err.message);
  }
}

// ????????????????????????????????????????
// Filters
// ????????????????????????????????????????
function populateFilters() {
  const months = [...new Set(state.rawData.map((d) => d.yearMonth))];
  const persons = [...new Set(state.rawData.map((d) => d.person))];

  months.sort((a, b) => {
    const [ay, am] = a.split('/').map(Number);
    const [by, bm] = b.split('/').map(Number);
    return by * 100 + bm - (ay * 100 + am);
  });
  persons.sort();

  const monthSelect = document.getElementById('filterMonth');
  monthSelect.innerHTML = '';

  if (months.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = '無資料';
    monthSelect.appendChild(placeholder);
  } else {
    months.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });
    monthSelect.value = months[0];
    state.filterMonth = months[0];
  }

  const personSelect = document.getElementById('filterPerson');
  persons.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    personSelect.appendChild(opt);
  });
}

function setupEventListeners() {
  document
    .getElementById('filterMonth')
    .addEventListener('change', (e) => {
      state.filterMonth = e.target.value;
      applyFiltersAndRender();
    });

  document
    .getElementById('filterPerson')
    .addEventListener('change', (e) => {
      state.filterPerson = e.target.value;
      applyFiltersAndRender();
    });

  // ???脫?
  let searchTimer;
  document
    .getElementById('searchInput')
    .addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.searchText = e.target.value.trim().toLowerCase();
        applyFiltersAndRender();
      }, 200);
    });


  // 銵券??
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'yearMonth' ? 'desc' : 'asc';
      }
      applyFiltersAndRender();
    });
  });
}

// ????????????????????????????????????????
// Filter + Sort + Render Pipeline
// ????????????????????????????????????????
function applyFiltersAndRender() {
  // 蝭拚
  let data = state.rawData.filter((d) => {
    if (state.filterMonth !== 'all' && d.yearMonth !== state.filterMonth)
      return false;
    if (state.filterPerson !== 'all' && d.person !== state.filterPerson)
      return false;
    if (state.searchText && !d.person.toLowerCase().includes(state.searchText))
      return false;
    return true;
  });

  // ??
  const col = state.sortCol;
  const dir = state.sortDir === 'asc' ? 1 : -1;

  data.sort((a, b) => {
    let va = a[col];
    let vb = b[col];

    // 撟湔??寞???
    if (col === 'yearMonth') {
      const [ay, am] = String(va).split('/').map(Number);
      const [by, bm] = String(vb).split('/').map(Number);
      return ((ay * 100 + am) - (by * 100 + bm)) * dir;
    }

    // 摮葡 vs ?詨?
    if (typeof va === 'string') {
      return va.localeCompare(vb, 'zh-TW') * dir;
    }

    // null/undefined ??敺?
    if (va == null) return 1;
    if (vb == null) return -1;

    return (va - vb) * dir;
  });

  state.filteredData = data;

  renderSummaryCards(data);
  renderTable(data);
  renderCharts(data);
  updateSortIndicators();
}

// ????????????????????????????????????????
// Summary Cards
// ????????????????????????????????????????
function renderSummaryCards(data) {
  const persons = new Set(data.map((d) => d.person));
  const totalRecords = data.reduce((sum, d) => sum + (Number(d.count) || 0), 0);
  const totalHours = data.reduce((s, d) => s + (d.productionHours || 0), 0);

  // ??撟喳???嚗誑 count ?箸???
  let weightedSum = 0;
  let weightTotal = 0;
  data.forEach((d) => {
    if (d.efficiency != null && d.count > 0) {
      weightedSum += d.efficiency * d.count;
      weightTotal += d.count;
    }
  });
  const avgEfficiency =
    weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;

  animateValue('valPersons', persons.size);
  animateValue('valRecords', totalRecords);
  document.getElementById('valEfficiency').textContent = avgEfficiency + '%';
  animateValue('valHours', Math.round(totalHours));
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  const current = parseInt(el.textContent) || 0;
  if (current === target) {
    el.textContent = target.toLocaleString();
    return;
  }

  const duration = 400;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const val = Math.round(current + (target - current) * eased);
    el.textContent = val.toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ????????????????????????????????????????
// Data Table
// ????????????????????????????????????????
function renderTable(data) {
  const tbody = document.getElementById('tableBody');
  const countEl = document.getElementById('recordCount');

  countEl.textContent = `??${data.length} 蝑;

  if (data.length === 0) {
    tbody.innerHTML = `
    < tr >
    <td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">?</div>
        <p>瘝?蝚血?璇辣????/p>
      </div>
    </td>
      </tr > `;
    return;
  }

  // 雿輻 DocumentFragment ???
  const frag = document.createDocumentFragment();

  data.forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = `${ Math.min(i * 0.02, 0.5) } s`;

    const effClass = getEfficiencyClass(d.efficiency);
    const effPct = d.efficiency != null ? Math.round(d.efficiency * 100) : 0;
    const effLabel =
      d.efficiency != null ? Math.round(d.efficiency * 100) + '%' : '-';

    tr.innerHTML = `
    < td > ${ escapeHtml(d.yearMonth) }</td >
      <td><strong>${escapeHtml(d.person)}</strong></td>
      <td class="num">${d.count}</td>
      <td class="num">${d.lt09 > 0
        ? '<span class="badge badge-danger">' + d.lt09 + '</span>'
        : '<span class="badge">' + d.lt09 + '</span>'
      }</td>
      <td class="num">
        <div class="efficiency-cell">
          <div class="efficiency-bar">
            <div class="efficiency-fill ${effClass}" style="width: ${effPct}%"></div>
          </div>
          <span class="efficiency-label ${effClass}">${effLabel}</span>
        </div>
      </td>
      <td class="num">${d.productionHours != null
        ? d.productionHours.toFixed(1)
        : '-'
      }</td>`;

    frag.appendChild(tr);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === state.sortCol) {
      th.classList.add(`sorted - ${ state.sortDir } `);
    }
  });
}

// ????????????????????????????????????????
// Charts
// ????????????????????????????????????????
function renderCharts(data) {
  renderTrendChart(data);
  renderComparisonChart(data);
}

function renderTrendChart(data) {
  const ctx = document.getElementById('trendChart');
  if (state.charts.trend) state.charts.trend.destroy();

  // ????詨僑隞踝?敺?filterMonth ?僑嚗?∪????啣僑隞踝?
  let selectedYear;
  if (state.filterMonth && state.filterMonth !== 'all') {
    selectedYear = String(state.filterMonth).split('/')[0];
  } else {
    // 敺?rawData ???啣僑隞?
    const years = state.rawData
      .map((d) => String(d.yearMonth).split('/')[0])
      .filter(Boolean);
    selectedYear = years.length > 0 ? Math.max(...years.map(Number)).toString() : null;
  }

  // 敺????瞈曇府撟港遢???隞踝?銝?鈭箏蝭拚敶梢嚗?
  const yearData = state.rawData.filter(
    (d) => String(d.yearMonth).split('/')[0] === selectedYear
  );

  // ??隞賢?蝮賢?甈像????
  const monthMap = {};
  yearData.forEach((d) => {
    if (d.efficiency == null) return;
    if (!monthMap[d.yearMonth]) {
      monthMap[d.yearMonth] = { sum: 0, weightSum: 0 };
    }
    monthMap[d.yearMonth].sum += d.efficiency * d.count;
    monthMap[d.yearMonth].weightSum += d.count;
  });

  // ?遢??嚗?~12嚗?
  const months = Object.keys(monthMap).sort((a, b) => {
    const am = Number(a.split('/')[1]);
    const bm = Number(b.split('/')[1]);
    return am - bm;
  });

  // x 頠詨憿舐內?遢?詨?
  const labels = months.map((m) => m.split('/')[1] + '??);
  const values = months.map((m) => {
    const g = monthMap[m];
    return g.weightSum > 0
      ? Math.round((g.sum / g.weightSum) * 10000) / 100
      : 0;
  });

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '撟喳??? (%)',
          data: values,
          borderColor: '#b8a9c9',
          backgroundColor: 'rgba(184, 169, 201, 0.12)',
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          pointBackgroundColor: '#b8a9c9',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          titleColor: '#4a3f35',
          bodyColor: '#8a7e72',
          borderColor: 'rgba(0, 0, 0, 0.08)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (ctx) => `??: ${ ctx.parsed.y }% `,
          },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(0, 0, 0, 0.04)' },
          ticks: { color: '#8a7e72', font: { size: 11 } },
        },
        y: {
          min: 0,
          max: 100,
          grid: { color: 'rgba(0, 0, 0, 0.04)' },
          ticks: {
            color: '#8a7e72',
            font: { size: 11 },
            callback: (v) => v + '%',
          },
        },
      },
    },
  });
}

function renderComparisonChart(data) {
  const ctx = document.getElementById('comparisonChart');
  if (state.charts.comparison) state.charts.comparison.destroy();

  // ?犖?∟?蝞擃???
  const personMap = {};
  data.forEach((d) => {
    if (d.efficiency == null) return;
    if (!personMap[d.person]) {
      personMap[d.person] = { sum: 0, weightSum: 0 };
    }
    personMap[d.person].sum += d.efficiency * d.count;
    personMap[d.person].weightSum += d.count;
  });

  const entries = Object.entries(personMap)
    .map(([name, g]) => ({
      name,
      eff:
        g.weightSum > 0
          ? Math.round((g.sum / g.weightSum) * 10000) / 100
          : 0,
    }))
    .sort((a, b) => b.eff - a.eff);

  const labels = entries.map((e) => e.name);
  const values = entries.map((e) => e.eff);

  state.charts.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '?犖?蜀(??90%隞乩?)',
          data: values,
          backgroundColor: 'rgba(155, 184, 201, 0.65)',
          borderColor: '#9bb8c9',
          borderWidth: 1.5,
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
        {
          label: '???格?(????0%隞乩?)',
          data: Array(labels.length).fill(90),
          type: 'line',
          borderColor: '#c9908a',
          borderWidth: 2,
          borderDash: [6, 3],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          datalabels: { display: false },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#8a7e72',
            font: { size: 11, family: 'Inter' },
            usePointStyle: true,
            pointStyle: (ctx) =>
              ctx.datasetIndex === 1 ? 'line' : 'rect',
            padding: 16,
          },
        },
        datalabels: {
          anchor: 'end',
          align: 'top',
          offset: 4,
          formatter: (value) => value + '%',
          font: { weight: '600', size: 11, family: 'Inter' },
          color: '#4a3f35',
        },
        tooltip: {
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          titleColor: '#4a3f35',
          bodyColor: '#8a7e72',
          borderColor: 'rgba(0, 0, 0, 0.08)',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          callbacks: {
            label: (ctx) => `??: ${ ctx.parsed.y }% `,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#8a7e72',
            font: { size: 11 },
            maxRotation: 45,
            minRotation: 0,
          },
        },
        y: {
          min: 0,
          max: 112,
          grid: { color: 'rgba(0, 0, 0, 0.04)' },
          ticks: {
            color: '#8a7e72',
            font: { size: 11 },
            callback: (v) => (v <= 100 ? v + '%' : ''),
          },
        },
      },
    },
  });
}

// ????????????????????????????????????????
// Helpers
// ????????????????????????????????????????
function getEfficiencyClass(eff) {
  if (eff == null) return '';
  if (eff >= 0.9) return 'high';
  if (eff >= 0.7) return 'mid';
  return 'low';
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showError(message) {
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;

  // ?梯?銝餉??批捆
  document.querySelectorAll('.summary-grid, .filters-bar, .table-section, .charts-grid')
    .forEach((el) => (el.style.display = 'none'));
}

