'use strict';

const FIRESTORE_PROJECT_ID = 'work-report-system-26c12';
const FIRESTORE_COLLECTION = 'efficiency_stats';
const FIRESTORE_DETAIL_COLLECTION = 'efficiency_stats_details';
const FIRESTORE_ENDPOINT_BASE =
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/${FIRESTORE_COLLECTION}`;
const FIRESTORE_RUN_QUERY_ENDPOINT =
  `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents:runQuery`;

const DETAIL_TABLE_COLUMNS = [
  { key: 'pphActual', label: 'PPH(實際)', isNum: true },
  { key: 'pphStandard', label: 'PPH(標準)', isNum: true },
  { key: 'efficiency', label: '效率', isNum: true, isPercent: true },
  { key: 'category', label: '類別' },
  { key: 'parentProductCode', label: '上階產品編號' },
  { key: 'parentProductName', label: '上階產品名稱' },
  { key: 'parentProductSpec', label: '上階產品規格' },
  { key: 'processName', label: '加工名稱' },
  { key: 'orderQty', label: '製令數量', isNum: true },
  { key: 'scheduleNo', label: '排程單號' },
  { key: 'customerShortName', label: '客戶簡稱' },
  { key: 'startTime', label: '開始時間' },
  { key: 'endTime', label: '結束時間' },
  { key: 'colleagues', label: '上工同事' },
  { key: 'colleagueCount', label: '同事數量', isNum: true },
  { key: 'goodQty', label: '完成良品數量(不含NG)', isNum: true },
  { key: 'ngQty', label: 'NG數量', isNum: true },
];

const state = {
  rawData: [],
  filteredData: [],
  sortCol: 'yearMonth',
  sortDir: 'desc',
  filterMonth: 'all',
  filterPerson: 'all',
  searchText: '',
  charts: { trend: null, comparison: null },
  detailRecordsByMonth: {},
  detailModal: {
    isOpen: false,
    tab: 'all',
    row: null,
    records: [],
  },
};

if (window.Chart && window.ChartDataLabels) {
  window.Chart.register(window.ChartDataLabels);
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const docs = await fetchAllEfficiencyDocs();

    const meta = docs.find((d) => d.id === '_metadata') || null;
    state.rawData = docs.filter((d) => d.id !== '_metadata');

    renderLastUpdated(meta);
    renderLatestDataDate(meta);
    populateFilters();
    setupEventListeners();
    applyFiltersAndRender();

    document.getElementById('loadingOverlay').classList.add('hidden');
  } catch (err) {
    console.error('載入資料失敗', err);
    showError(err && err.message ? err.message : '無法載入資料');
  }
}

async function fetchAllEfficiencyDocs() {
  const docs = [];
  let pageToken = '';

  while (true) {
    const url = new URL(FIRESTORE_ENDPOINT_BASE);
    url.searchParams.set('pageSize', '500');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) {
      throw new Error(`讀取 Firestore 失敗 (${res.status})`);
    }

    const json = await res.json();
    const pageDocs = (json.documents || []).map(decodeFirestoreDoc);
    docs.push(...pageDocs);

    pageToken = json.nextPageToken || '';
    if (!pageToken) {
      break;
    }
  }

  return docs;
}

function decodeFirestoreDoc(doc) {
  const out = { id: String(doc.name || '').split('/').pop() || '' };
  const fields = doc.fields || {};

  Object.keys(fields).forEach((key) => {
    out[key] = decodeFirestoreValue(fields[key]);
  });

  return out;
}

function decodeFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(v, 'stringValue')) return v.stringValue;
  if (Object.prototype.hasOwnProperty.call(v, 'integerValue')) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, 'doubleValue')) return Number(v.doubleValue);
  if (Object.prototype.hasOwnProperty.call(v, 'booleanValue')) return Boolean(v.booleanValue);
  if (Object.prototype.hasOwnProperty.call(v, 'timestampValue')) return v.timestampValue;
  if (Object.prototype.hasOwnProperty.call(v, 'nullValue')) return null;

  if (Object.prototype.hasOwnProperty.call(v, 'arrayValue')) {
    return (v.arrayValue.values || []).map(decodeFirestoreValue);
  }

  if (Object.prototype.hasOwnProperty.call(v, 'mapValue')) {
    const mapFields = v.mapValue.fields || {};
    const obj = {};
    Object.keys(mapFields).forEach((key) => {
      obj[key] = decodeFirestoreValue(mapFields[key]);
    });
    return obj;
  }

  return null;
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = String(value ?? '').replace(/,/g, '').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseYearMonth(value) {
  const match = String(value || '').match(/^(\d{4})[\/-](\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month, key: year * 100 + month };
}

function getLatestYearMonth() {
  const latest = state.rawData
    .map((d) => parseYearMonth(d.yearMonth))
    .filter(Boolean)
    .sort((a, b) => b.key - a.key)[0];

  if (!latest) return null;
  return `${latest.year}/${String(latest.month).padStart(2, '0')}`;
}

function renderLatestDataDate(meta) {
  const el = document.getElementById('latestDataDate');
  if (!el) return;

  const latestDate = meta && typeof meta.latestDataDate === 'string'
    ? meta.latestDataDate.trim()
    : '';
  if (latestDate) {
    el.textContent = '\u8cc7\u6599\u6700\u65b0\u65e5\u671f\uff1a' + latestDate;
    return;
  }

  const latest = getLatestYearMonth();
  el.textContent = latest ? '\u8cc7\u6599\u6700\u65b0\u65e5\u671f\uff1a' + latest + '/--' : '\u8cc7\u6599\u6700\u65b0\u65e5\u671f\uff1a--';
}

function renderLastUpdated(meta) {
  const el = document.getElementById('lastUpdated');
  if (!el) return;

  const ts = meta && meta.lastSyncTime ? String(meta.lastSyncTime) : '';
  if (!ts) {
    el.textContent = '最後同步：--';
    return;
  }

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    el.textContent = `最後同步：${ts}`;
    return;
  }

  el.textContent = `最後同步: ${date.toLocaleString('zh-TW')}`;
}

function populateFilters() {
  const months = [...new Set(state.rawData.map((d) => String(d.yearMonth || '')).filter(Boolean))];
  const persons = [...new Set(state.rawData.map((d) => String(d.person || '')).filter(Boolean))];

  months.sort((a, b) => {
    const pa = parseYearMonth(a);
    const pb = parseYearMonth(b);
    const ka = pa ? pa.key : -1;
    const kb = pb ? pb.key : -1;
    return kb - ka;
  });

  persons.sort((a, b) => a.localeCompare(b, 'zh-TW'));

  const monthSelect = document.getElementById('filterMonth');
  monthSelect.innerHTML = '';

  if (months.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = '無資料';
    monthSelect.appendChild(placeholder);
    state.filterMonth = 'all';
  } else {
    months.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });
    state.filterMonth = months[0];
    monthSelect.value = months[0];
  }

  const personSelect = document.getElementById('filterPerson');
  personSelect.innerHTML = '<option value="all">全部</option>';
  persons.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    personSelect.appendChild(opt);
  });
  state.filterPerson = 'all';
}

function setupEventListeners() {
  document.getElementById('filterMonth').addEventListener('change', (e) => {
    state.filterMonth = e.target.value;
    applyFiltersAndRender();
  });

  document.getElementById('filterPerson').addEventListener('change', (e) => {
    state.filterPerson = e.target.value;
    applyFiltersAndRender();
  });

  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchText = String(e.target.value || '').trim().toLowerCase();
      applyFiltersAndRender();
    }, 200);
  });

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (!col) return;

      if (state.sortCol === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortCol = col;
        state.sortDir = col === 'yearMonth' ? 'desc' : 'asc';
      }

      applyFiltersAndRender();
    });
  });

  const tbody = document.getElementById('tableBody');
  if (tbody) {
    tbody.addEventListener('click', (event) => {
      const tr = event.target.closest('tr[data-doc-id]');
      if (!tr) return;
      const docId = tr.getAttribute('data-doc-id');
      const row = state.filteredData.find((item) => String(item.id || '') === String(docId || ''));
      if (!row) return;
      openDetailModal(row);
    });
  }

  const modalBackdrop = document.getElementById('detailModalBackdrop');
  const modalClose = document.getElementById('detailModalClose');
  const modalTabs = document.getElementById('detailModalTabs');

  if (modalClose) {
    modalClose.addEventListener('click', closeDetailModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (event) => {
      if (event.target === modalBackdrop) {
        closeDetailModal();
      }
    });
  }

  if (modalTabs) {
    modalTabs.addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-tab]');
      if (!btn) return;
      state.detailModal.tab = btn.dataset.tab || 'all';
      renderDetailModal();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.detailModal.isOpen) {
      closeDetailModal();
    }
  });
}

function applyFiltersAndRender() {
  const data = state.rawData
    .filter((d) => {
      if (state.filterMonth !== 'all' && String(d.yearMonth) !== state.filterMonth) return false;
      if (state.filterPerson !== 'all' && String(d.person) !== state.filterPerson) return false;
      if (state.searchText && !String(d.person || '').toLowerCase().includes(state.searchText)) return false;
      return true;
    })
    .sort(compareByStateSort);

  state.filteredData = data;

  renderSummaryCards(data);
  renderTable(data);
  renderCharts(data);
  updateSortIndicators();
}

function compareByStateSort(a, b) {
  const col = state.sortCol;
  const dir = state.sortDir === 'asc' ? 1 : -1;

  if (col === 'yearMonth') {
    const ka = (parseYearMonth(a.yearMonth) || { key: -1 }).key;
    const kb = (parseYearMonth(b.yearMonth) || { key: -1 }).key;
    return (ka - kb) * dir;
  }

  if (col === 'person') {
    return String(a.person || '').localeCompare(String(b.person || ''), 'zh-TW') * dir;
  }

  return (toNumber(a[col]) - toNumber(b[col])) * dir;
}

function getSummaryRecordTotal() {
  return state.rawData
    .filter((d) => {
      if (state.filterMonth !== 'all' && String(d.yearMonth) !== state.filterMonth) return false;
      if (state.filterPerson !== 'all' && String(d.person) !== state.filterPerson) return false;
      return true;
    })
    .reduce((sum, d) => sum + toNumber(d.count), 0);
}

function renderSummaryCards(data) {
  const persons = new Set(data.map((d) => String(d.person || '')).filter(Boolean));
  const totalRecords = getSummaryRecordTotal();
  const totalHours = data.reduce((sum, d) => sum + toNumber(d.productionHours), 0);

  let weightedSum = 0;
  let weightTotal = 0;
  data.forEach((d) => {
    const eff = toNumber(d.efficiency);
    const count = toNumber(d.count);
    if (count > 0) {
      weightedSum += eff * count;
      weightTotal += count;
    }
  });

  const avgEfficiency = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;

  animateValue('valPersons', persons.size);
  animateValue('valRecords', totalRecords);
  document.getElementById('valEfficiency').textContent = `${avgEfficiency}%`;
  animateValue('valHours', Math.round(totalHours));
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  if (!el) return;

  const current = toNumber(String(el.textContent || '').replace(/,/g, ''));
  if (Math.round(current) === Math.round(target)) {
    el.textContent = Math.round(target).toLocaleString('zh-TW');
    return;
  }

  const duration = 300;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const val = Math.round(current + (target - current) * eased);
    el.textContent = val.toLocaleString('zh-TW');
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function renderTable(data) {
  const tbody = document.getElementById('tableBody');
  const countEl = document.getElementById('recordCount');

  countEl.textContent = `共 ${data.length} 筆`;

  if (data.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p>找不到符合條件的資料</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  const rows = data.map((d, i) => {
    const eff = toNumber(d.efficiency);
    const effPct = Math.max(0, Math.min(100, Math.round(eff * 100)));
    const effLabel = `${effPct}%`;
    const effClass = getEfficiencyClass(eff);
    const lt09 = toNumber(d.lt09);
    const hours = d.productionHours == null ? '-' : toNumber(d.productionHours).toFixed(1);

    return `
      <tr class="clickable-row" data-doc-id="${escapeHtml(d.id)}" style="animation-delay:${Math.min(i * 0.02, 0.5)}s">
        <td>${escapeHtml(d.yearMonth)}</td>
        <td><strong>${escapeHtml(d.person)}</strong></td>
        <td class="num">${toNumber(d.count)}</td>
        <td class="num">${lt09 > 0 ? `<span class="badge badge-danger">${lt09}</span>` : `<span class="badge">${lt09}</span>`}</td>
        <td class="num">
          <div class="efficiency-cell">
            <div class="efficiency-bar">
              <div class="efficiency-fill ${effClass}" style="width:${effPct}%"></div>
            </div>
            <span class="efficiency-label ${effClass}">${effLabel}</span>
          </div>
        </td>
        <td class="num">${hours}</td>
      </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

async function openDetailModal(row) {
  const person = String(row.person || '').trim();
  const yearMonth = String(row.yearMonth || '').trim();
  if (!person || !yearMonth) return;

  state.detailModal.isOpen = true;
  state.detailModal.row = { person, yearMonth };
  state.detailModal.tab = 'all';
  state.detailModal.records = [];

  const backdrop = document.getElementById('detailModalBackdrop');
  if (backdrop) {
    backdrop.classList.add('show');
    backdrop.setAttribute('aria-hidden', 'false');
  }
  document.body.classList.add('modal-open');

  const body = document.getElementById('detailTableBody');
  if (body) {
    body.innerHTML = '<tr><td colspan="17" class="loading-cell">讀取中...</td></tr>';
  }
  renderDetailModalHeader();

  try {
    const records = await fetchDetailRecordsByMonth(yearMonth);
    state.detailModal.records = records.filter((item) => String(item.person || '') === person);
    renderDetailModal();
  } catch (error) {
    console.error('載入詳細資料失敗', error);
    if (body) {
      body.innerHTML = `<tr><td colspan="17" class="loading-cell">載入失敗：${escapeHtml(error.message || '未知錯誤')}</td></tr>`;
    }
  }
}

function closeDetailModal() {
  state.detailModal.isOpen = false;
  const backdrop = document.getElementById('detailModalBackdrop');
  if (backdrop) {
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('modal-open');
}

function renderDetailModalHeader() {
  const title = document.getElementById('detailModalTitle');
  const subtitle = document.getElementById('detailModalSubtitle');
  const row = state.detailModal.row;
  if (!row) {
    if (title) title.textContent = '詳細資料';
    if (subtitle) subtitle.textContent = '-';
    return;
  }
  if (title) title.textContent = `${row.person}｜${row.yearMonth} 詳細資料`;
  if (subtitle) subtitle.textContent = `資料來源：${FIRESTORE_DETAIL_COLLECTION}`;
}

async function fetchDetailRecordsByMonth(yearMonth) {
  const cacheKey = String(yearMonth || '');
  if (!cacheKey) return [];
  if (state.detailRecordsByMonth[cacheKey]) return state.detailRecordsByMonth[cacheKey];

  const payload = {
    structuredQuery: {
      from: [{ collectionId: FIRESTORE_DETAIL_COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'yearMonth' },
          op: 'EQUAL',
          value: { stringValue: cacheKey },
        },
      },
    },
  };

  const res = await fetch(FIRESTORE_RUN_QUERY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`讀取詳細資料失敗 (${res.status})`);
  }

  const json = await res.json();
  const rows = (Array.isArray(json) ? json : [])
    .map((entry) => (entry && entry.document ? decodeFirestoreDoc(entry.document) : null))
    .filter(Boolean)
    .sort((a, b) => parseDetailTimeMs(b) - parseDetailTimeMs(a));

  state.detailRecordsByMonth[cacheKey] = rows;
  return rows;
}

function parseDetailTimeMs(record) {
  const byField = toNumber(record.startTimeMs);
  if (byField > 0) return byField;
  const raw = String(record.startTime || '').trim();
  if (!raw) return 0;
  const m = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  const date = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  return Number.isFinite(date) ? date : 0;
}

function parseEfficiencyPercent(value, record) {
  const pphActual = toNumber(record && record.pphActual);
  const pphStandard = toNumber(record && record.pphStandard);
  if (
    Number.isFinite(pphActual) &&
    Number.isFinite(pphStandard) &&
    pphActual >= 0 &&
    pphStandard > 0
  ) {
    return (pphActual / pphStandard) * 100;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) return Number.NaN;
    if (value <= 2.5) return value * 100;
    return value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return Number.NaN;
  const hasPercent = raw.endsWith('%');
  const parsed = Number(raw.replace(/%/g, '').replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) return Number.NaN;
  if (hasPercent) return parsed;
  if (parsed <= 2.5) return parsed * 100;
  return parsed;
}

function getDetailTabCounts(records) {
  let achieved = 0;
  let notAchieved = 0;
  records.forEach((item) => {
    const eff = parseEfficiencyPercent(item.efficiency, item);
    if (!Number.isFinite(eff)) return;
    if (eff >= 90) achieved += 1;
    else if (eff < 90) notAchieved += 1;
  });
  return { all: records.length, achieved, notAchieved };
}

function getVisibleDetailRecords() {
  const records = state.detailModal.records || [];
  if (state.detailModal.tab === 'achieved') {
    return records.filter((item) => {
      const eff = parseEfficiencyPercent(item.efficiency, item);
      return Number.isFinite(eff) && eff >= 90;
    });
  }
  if (state.detailModal.tab === 'notAchieved') {
    return records.filter((item) => {
      const eff = parseEfficiencyPercent(item.efficiency, item);
      return Number.isFinite(eff) && eff < 90;
    });
  }
  return records;
}

function renderDetailModal() {
  renderDetailModalHeader();

  const records = state.detailModal.records || [];
  const counts = getDetailTabCounts(records);
  const tabText = {
    all: `總筆數 (${counts.all})`,
    achieved: `達成 (${counts.achieved})`,
    notAchieved: `未達成 (${counts.notAchieved})`,
  };

  document.querySelectorAll('#detailModalTabs .detail-tab').forEach((btn) => {
    const tab = btn.dataset.tab || 'all';
    btn.classList.toggle('active', tab === state.detailModal.tab);
    btn.textContent = tabText[tab] || btn.textContent;
  });

  const visible = getVisibleDetailRecords();
  renderDetailTableRows(visible);
}

function renderDetailTableRows(records) {
  const body = document.getElementById('detailTableBody');
  if (!body) return;

  if (!records || records.length === 0) {
    body.innerHTML = '<tr><td colspan="17" class="loading-cell">沒有符合條件的詳細資料</td></tr>';
    return;
  }

  body.innerHTML = records.map((item) => {
    const eff = parseEfficiencyPercent(item.efficiency, item);
    const isLow = Number.isFinite(eff) && eff < 90;
    const rowClass = isLow ? ' class="detail-row-low"' : '';
    const cols = DETAIL_TABLE_COLUMNS.map((col) => {
      const raw = item[col.key];
      const value = formatDetailValue(raw, col, item);
      const cls = col.isNum ? ' class="num"' : '';
      return `<td${cls}>${value}</td>`;
    }).join('');
    return `<tr${rowClass}>${cols}</tr>`;
  }).join('');
}

function formatDetailValue(value, col, row) {
  if (value === undefined || value === null || value === '') return '-';
  if (col && col.isPercent) {
    const eff = parseEfficiencyPercent(value, row);
    if (!Number.isFinite(eff)) return '-';
    const rounded = Math.round(eff);
    const text = String(rounded);
    return `${escapeHtml(text)}%`;
  }
  if (col && col.isNum) {
    const num = toNumber(value);
    if (!Number.isFinite(num)) return '-';
    const text = Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
    return escapeHtml(text);
  }
  return escapeHtml(value);
}

function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach((th) => {
    th.classList.remove('sorted-asc', 'sorted-desc');
    if (th.dataset.col === state.sortCol) {
      th.classList.add(`sorted-${state.sortDir}`);
    }
  });
}

function renderCharts(data) {
  if (!window.Chart) return;
  renderTrendChart();
  renderComparisonChart(data);
}

function renderTrendChart() {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  if (state.charts.trend) {
    state.charts.trend.destroy();
  }

  const selectedYear = getSelectedYear();
  const monthMap = new Map();

  state.rawData.forEach((d) => {
    const ym = parseYearMonth(d.yearMonth);
    if (!ym || String(ym.year) !== selectedYear) return;

    const count = toNumber(d.count);
    const eff = toNumber(d.efficiency);
    if (count <= 0) return;

    const key = ym.month;
    if (!monthMap.has(key)) {
      monthMap.set(key, { weightedSum: 0, weightTotal: 0 });
    }

    const item = monthMap.get(key);
    item.weightedSum += eff * count;
    item.weightTotal += count;
  });

  const months = [...monthMap.keys()].sort((a, b) => a - b);
  const labels = months.map((m) => `${m}月`);
  const values = months.map((m) => {
    const item = monthMap.get(m);
    return item.weightTotal > 0 ? Math.round((item.weightedSum / item.weightTotal) * 10000) / 100 : 0;
  });

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '平均效率 (%)',
        data: values,
        borderColor: '#b8a9c9',
        backgroundColor: 'rgba(184,169,201,0.12)',
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: { display: false },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
        },
      },
    },
  });
}

function getSelectedYear() {
  if (state.filterMonth && state.filterMonth !== 'all') {
    const ym = parseYearMonth(state.filterMonth);
    if (ym) return String(ym.year);
  }

  const years = state.rawData
    .map((d) => parseYearMonth(d.yearMonth))
    .filter(Boolean)
    .map((p) => p.year);

  if (years.length === 0) return String(new Date().getFullYear());
  return String(Math.max(...years));
}

function renderComparisonChart(data) {
  const ctx = document.getElementById('comparisonChart');
  if (!ctx) return;

  if (state.charts.comparison) {
    state.charts.comparison.destroy();
  }

  const personMap = new Map();
  data.forEach((d) => {
    const person = String(d.person || '');
    if (!person) return;

    const count = toNumber(d.count);
    const eff = toNumber(d.efficiency);
    if (count <= 0) return;

    if (!personMap.has(person)) {
      personMap.set(person, { weightedSum: 0, weightTotal: 0 });
    }

    const item = personMap.get(person);
    item.weightedSum += eff * count;
    item.weightTotal += count;
  });

  const entries = [...personMap.entries()]
    .map(([name, item]) => ({
      name,
      eff: item.weightTotal > 0 ? Math.round((item.weightedSum / item.weightTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.eff - a.eff);

  const labels = entries.map((e) => e.name);
  const values = entries.map((e) => e.eff);
  const targetLineValues = labels.map(() => 90);

  state.charts.comparison = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '個人成績(效率90%以上)',
          data: values,
          backgroundColor: 'rgba(155,184,201,0.65)',
          borderColor: '#9bb8c9',
          borderWidth: 1.5,
          borderRadius: 4,
          order: 1,
        },
        {
          type: 'line',
          label: '達成目標(達成率90%以上)',
          data: targetLineValues,
          borderColor: '#e74c3c',
          backgroundColor: '#e74c3c',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0,
          fill: false,
          order: 2,
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
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: false,
            padding: 16,
            sort: (a, b) => {
              const rank = {
                '個人成績(效率90%以上)': 1,
                '達成目標(達成率90%以上)': 2,
              };
              return (rank[a.text] || 99) - (rank[b.text] || 99);
            },
          },
        },
        datalabels: {
          display: (context) => context.dataset.type !== 'line',
          anchor: 'start',
          align: 'end',
          offset: 6,
          clamp: true,
          clip: true,
          formatter: (v) => `${v}%`,
          font: { weight: '600', size: 11 },
          color: '#4a3f35',
        },
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
        },
      },
    },
  });
}

function getEfficiencyClass(eff) {
  if (eff >= 0.9) return 'high';
  if (eff >= 0.7) return 'mid';
  return 'low';
}

function escapeHtml(value) {
  if (value == null) return '';
  const div = document.createElement('div');
  div.textContent = String(value);
  return div.innerHTML;
}

function showError(message) {
  document.getElementById('loadingOverlay').classList.add('hidden');
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;

  document
    .querySelectorAll('.summary-grid, .filters-bar, .table-section, .charts-grid')
    .forEach((el) => {
      el.style.display = 'none';
    });
}

