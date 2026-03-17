const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');

const DEFAULTS = {
  collection: 'efficiency_stats',
  detailCollection: 'efficiency_stats_details',
  dataSheetName: 'Data Sheet(Calculation)',
  refSheetName: '勿修改/全部同事DATA',
  refGroupHeader: '組別',
  refStatusHeader: '狀態',
  refNameHeader: '同事名稱',
  includeGroup: '2',
  includeStatus: '1',
  colColleague: 43,
  colDate: 50,
  colProductionHours: 53,
  colBf: 57,
  colCategory: 0,
  colParentProductCode: 6,
  colParentProductName: 7,
  colParentProductSpec: 8,
  colProcessName: 10,
  colOrderQty: 11,
  colScheduleNo: 26,
  colCustomerShortName: 31,
  colStartTime: 42,
  colEndTime: 45,
  colColleagueCount: 44,
  colGoodQty: 46,
  colNgQty: 47,
  colPphActual: 55,
  colPphStandard: 56,
  syncScope: 'all_years',
  syncTimeZone: 'Asia/Taipei',
  port: 8080,
};

function parseInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseJsonEnv(name, required = true) {
  const raw = process.env[name];
  if (!raw) {
    if (required) throw new Error(`${name} is required.`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    throw new Error(`${name} must be valid JSON.`);
  }
}

function normalizeSyncScope(raw) {
  const value = String(raw || DEFAULTS.syncScope).trim().toLowerCase();
  if (value === 'all_years' || value === 'current_year') return value;
  throw new Error("SYNC_SCOPE must be 'all_years' or 'current_year'.");
}

function getCurrentYearInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date());
  const yearPart = parts.find((part) => part.type === 'year');
  const year = Number(yearPart && yearPart.value);
  if (!Number.isInteger(year)) {
    throw new Error(`Unable to determine current year for timezone: ${timeZone}`);
  }
  return year;
}
function loadConfig() {
  const dataSheets = parseJsonEnv('DATA_SHEETS_JSON');
  if (!Array.isArray(dataSheets) || dataSheets.length === 0) {
    throw new Error('DATA_SHEETS_JSON must be a non-empty array.');
  }
  for (const sheet of dataSheets) {
    if (!sheet || typeof sheet.id !== 'string' || typeof sheet.name !== 'string') {
      throw new Error('Each DATA_SHEETS_JSON item needs string fields: id and name.');
    }
  }

  return {
    collection: process.env.FIRESTORE_COLLECTION || DEFAULTS.collection,
    detailCollection: process.env.FIRESTORE_DETAIL_COLLECTION || DEFAULTS.detailCollection,
    refSheetId: process.env.REF_SHEET_ID,
    refSheetName: process.env.REF_SHEET_NAME || DEFAULTS.refSheetName,
    refGroupHeader: process.env.REF_GROUP_HEADER || DEFAULTS.refGroupHeader,
    refStatusHeader: process.env.REF_STATUS_HEADER || DEFAULTS.refStatusHeader,
    refNameHeader: process.env.REF_NAME_HEADER || DEFAULTS.refNameHeader,
    refGroupCol: parseInteger('REF_GROUP_COL', -1),
    refStatusCol: parseInteger('REF_STATUS_COL', -1),
    refNameCol: parseInteger('REF_NAME_COL', -1),
    includeGroup: process.env.INCLUDE_GROUP || DEFAULTS.includeGroup,
    includeStatus: process.env.INCLUDE_STATUS || DEFAULTS.includeStatus,
    dataSheets,
    colColleague: parseInteger('COL_COLLEAGUE', DEFAULTS.colColleague),
    colDate: parseInteger('COL_DATE', DEFAULTS.colDate),
    colProductionHours: parseInteger('COL_PRODUCTION_HOURS', DEFAULTS.colProductionHours),
    colBf: parseInteger('COL_BF', DEFAULTS.colBf),
    colCategory: parseInteger('COL_CATEGORY', DEFAULTS.colCategory),
    colParentProductCode: parseInteger('COL_PARENT_PRODUCT_CODE', DEFAULTS.colParentProductCode),
    colParentProductName: parseInteger('COL_PARENT_PRODUCT_NAME', DEFAULTS.colParentProductName),
    colParentProductSpec: parseInteger('COL_PARENT_PRODUCT_SPEC', DEFAULTS.colParentProductSpec),
    colProcessName: parseInteger('COL_PROCESS_NAME', DEFAULTS.colProcessName),
    colOrderQty: parseInteger('COL_ORDER_QTY', DEFAULTS.colOrderQty),
    colScheduleNo: parseInteger('COL_SCHEDULE_NO', DEFAULTS.colScheduleNo),
    colCustomerShortName: parseInteger('COL_CUSTOMER_SHORT_NAME', DEFAULTS.colCustomerShortName),
    colStartTime: parseInteger('COL_START_TIME', DEFAULTS.colStartTime),
    colEndTime: parseInteger('COL_END_TIME', DEFAULTS.colEndTime),
    colColleagueCount: parseInteger('COL_COLLEAGUE_COUNT', DEFAULTS.colColleagueCount),
    colGoodQty: parseInteger('COL_GOOD_QTY', DEFAULTS.colGoodQty),
    colNgQty: parseInteger('COL_NG_QTY', DEFAULTS.colNgQty),
    colPphActual: parseInteger('COL_PPH_ACTUAL', DEFAULTS.colPphActual),
    colPphStandard: parseInteger('COL_PPH_STANDARD', DEFAULTS.colPphStandard),
    syncScope: normalizeSyncScope(process.env.SYNC_SCOPE),
    syncYear: parseInteger('SYNC_YEAR', getCurrentYearInTimeZone(DEFAULTS.syncTimeZone)),
    syncToken: process.env.SYNC_TOKEN || '',
    port: parseInteger('PORT', DEFAULTS.port),
  };
}

function initFirebase() {
  if (admin.apps.length > 0) return;
  const firebaseCreds = parseJsonEnv('FIREBASE_CREDENTIALS');
  admin.initializeApp({ credential: admin.credential.cert(firebaseCreds) });
}

function initSheets() {
  const googleCreds = parseJsonEnv('GOOGLE_CREDENTIALS');
  const auth = new google.auth.GoogleAuth({
    credentials: googleCreds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readSheet(sheetsClient, spreadsheetId, sheetName) {
  const result = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return result.data.values || [];
}

function findColumnIndex(headerRow, expectedHeader, fallbackIndex) {
  if (fallbackIndex >= 0) return fallbackIndex;
  const idx = headerRow.findIndex((cell) => String(cell || '').trim() === expectedHeader);
  if (idx === -1) {
    throw new Error(`Cannot find column "${expectedHeader}". Set fallback index env if needed.`);
  }
  return idx;
}

function parseSheetDate(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Google Sheet time-only serial (e.g. 0:00) should not be treated as a date.
    if (value < 1) return null;
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
  }

  const text = String(value).trim();
  if (!text) return null;

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) {
    return null;
  }

  const ymdMatch = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    if (
      Number.isInteger(year) &&
      Number.isInteger(month) &&
      Number.isInteger(day)
    ) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  const maybeNumber = Number(text);
  if (!Number.isNaN(maybeNumber)) {
    if (maybeNumber < 1) return null;
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + maybeNumber * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDateYYYYMMDD(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeBfRatio(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) return null;
    return value > 10 ? value / 100 : value;
  }

  const text = String(value).trim();
  if (!text) return null;

  const hasPercent = text.endsWith('%');
  const cleaned = text.replace(/%/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  if (hasPercent) return parsed / 100;
  return parsed > 10 ? parsed / 100 : parsed;
}

function resolveEfficiencyRatio(row, config) {
  const pphActual = toNullableNumber(row[config.colPphActual]);
  const pphStandard = toNullableNumber(row[config.colPphStandard]);
  if (
    Number.isFinite(pphActual) &&
    Number.isFinite(pphStandard) &&
    pphActual >= 0 &&
    pphStandard > 0
  ) {
    return pphActual / pphStandard;
  }
  return normalizeBfRatio(row[config.colBf]);
}

function splitColleagues(value) {
  const set = new Set();
  String(value || '')
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((name) => set.add(name));
  return Array.from(set);
}

function formatDateTimeYYYYMMDDHHMM(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

function toCellString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function buildDetailDocId(sheetId, sourceRowNumber, person, yearMonth) {
  const safePerson = String(person || '').replace(/[\/\\?#\[\]]/g, '-');
  const safeYearMonth = String(yearMonth || '').replace(/[\/\\?#\[\]]/g, '-');
  const safeSheetId = String(sheetId || '').replace(/[\/\\?#\[\]]/g, '-');
  return `${safePerson}_${safeYearMonth}_${safeSheetId}_${sourceRowNumber}`;
}

function buildDetailRecord(row, person, yearMonth, config, sheetId, sourceRowNumber, efficiencyRatio) {
  const startDate = parseSheetDate(row[config.colStartTime]);
  const endDate = parseSheetDate(row[config.colEndTime]);
  const startTime = formatDateTimeYYYYMMDDHHMM(startDate) || toCellString(row[config.colStartTime]);
  const endTime = formatDateTimeYYYYMMDDHHMM(endDate) || toCellString(row[config.colEndTime]);
  const efficiencyPct = Math.round(efficiencyRatio * 10000) / 100;

  return {
    yearMonth,
    person,
    category: toCellString(row[config.colCategory]),
    parentProductCode: toCellString(row[config.colParentProductCode]),
    parentProductName: toCellString(row[config.colParentProductName]),
    parentProductSpec: toCellString(row[config.colParentProductSpec]),
    processName: toCellString(row[config.colProcessName]),
    orderQty: toNullableNumber(row[config.colOrderQty]),
    scheduleNo: toCellString(row[config.colScheduleNo]),
    customerShortName: toCellString(row[config.colCustomerShortName]),
    startTime,
    endTime,
    colleagues: toCellString(row[config.colColleague]),
    colleagueCount: toNullableNumber(row[config.colColleagueCount]),
    goodQty: toNullableNumber(row[config.colGoodQty]),
    ngQty: toNullableNumber(row[config.colNgQty]),
    pphActual: toNullableNumber(row[config.colPphActual]),
    pphStandard: toNullableNumber(row[config.colPphStandard]),
    efficiency: efficiencyPct,
    startTimeMs: startDate ? startDate.getTime() : null,
    endTimeMs: endDate ? endDate.getTime() : null,
    sourceSheetId: sheetId,
    sourceRowNumber,
  };
}

async function getValidPersons(sheetsClient, config) {
  if (!config.refSheetId) {
    throw new Error('REF_SHEET_ID is required.');
  }

  const rows = await readSheet(sheetsClient, config.refSheetId, config.refSheetName);
  if (rows.length === 0) return new Set();

  const header = rows[0];
  const groupIdx = findColumnIndex(header, config.refGroupHeader, config.refGroupCol);
  const statusIdx = findColumnIndex(header, config.refStatusHeader, config.refStatusCol);
  const nameIdx = findColumnIndex(header, config.refNameHeader, config.refNameCol);

  const persons = new Set();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const groupValue = String(row[groupIdx] ?? '').trim();
    const statusValue = String(row[statusIdx] ?? '').trim();
    if (groupValue === config.includeGroup && statusValue === config.includeStatus) {
      const name = String(row[nameIdx] ?? '').trim();
      if (name) persons.add(name);
    }
  }
  return persons;
}

function mergeStats(target, partial) {
  for (const [key, value] of Object.entries(partial)) {
    if (!target[key]) {
      target[key] = {
        yearMonth: value.yearMonth,
        person: value.person,
        count: 0,
        lt09: 0,
        btw0912: 0,
        gt12: 0,
        productionHours: 0,
      };
    }
    target[key].count += value.count;
    target[key].lt09 += value.lt09;
    target[key].btw0912 += value.btw0912;
    target[key].gt12 += value.gt12;
    target[key].productionHours += value.productionHours;
  }
}

function calculateStats(rows, validPersons, config, sheetId) {
  const stats = {};
  const detailRecords = {};
  let latestDate = null;
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;

    const colleagueRaw = row[config.colColleague];
    const dateRaw = row[config.colDate];
    if (!colleagueRaw || !dateRaw) continue;

    const date = parseSheetDate(dateRaw);
    if (!date || Number.isNaN(date.getTime())) continue;

    if (config.syncScope === 'current_year' && date.getUTCFullYear() !== config.syncYear) {
      continue;
    }

    if (!latestDate || date.getTime() > latestDate.getTime()) {
      latestDate = date;
    }

    const yearMonth = `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}`;
    const productionHours = toNumber(row[config.colProductionHours]);

    const efficiencyRatio = resolveEfficiencyRatio(row, config);
    const ratioIsValid = efficiencyRatio !== null;

    const colleagues = splitColleagues(colleagueRaw);

    for (const person of colleagues) {
      if (!validPersons.has(person)) continue;

      const key = `${person}_${yearMonth}`;
      if (!stats[key]) {
        stats[key] = {
          yearMonth,
          person,
          count: 0,
          lt09: 0,
          btw0912: 0,
          gt12: 0,
          productionHours: 0,
        };
      }

      stats[key].productionHours += productionHours;
      if (ratioIsValid) {
        stats[key].count += 1;
        if (efficiencyRatio < 0.9) stats[key].lt09 += 1;
        else if (efficiencyRatio > 1.2) stats[key].gt12 += 1;
        else stats[key].btw0912 += 1;

        const detailDocId = buildDetailDocId(sheetId, i + 1, person, yearMonth);
        detailRecords[detailDocId] = buildDetailRecord(
          row,
          person,
          yearMonth,
          config,
          sheetId,
          i + 1,
          efficiencyRatio,
        );
      }
    }
  }

  for (const value of Object.values(stats)) {
    value.efficiency = value.count > 0
      ? Math.round(((value.count - value.lt09) / value.count) * 100) / 100
      : null;
  }

  return { stats, detailRecords, latestDate };
}

async function deleteCoveredMonths(db, collectionName, monthsToReplace) {
  const snapshot = await db.collection(collectionName).get();
  const docs = snapshot.docs.filter((doc) => {
    if (doc.id === '_metadata') return false;
    const month = doc.get('yearMonth');
    return month && monthsToReplace.has(month);
  });

  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + 450)) {
      batch.delete(doc.ref);
    }
    await batch.commit();
  }

  return docs.length;
}

async function writeStats(db, collectionName, statsMap) {
  const entries = Object.entries(statsMap);
  for (let i = 0; i < entries.length; i += 450) {
    const batch = db.batch();
    for (const [key, data] of entries.slice(i, i + 450)) {
      const docId = key.replace(/\//g, '-');
      batch.set(db.collection(collectionName).doc(docId), data);
    }
    await batch.commit();
  }
  return entries.length;
}

async function writeDetailRecords(db, collectionName, detailRecordsMap) {
  const entries = Object.entries(detailRecordsMap);
  for (let i = 0; i < entries.length; i += 450) {
    const batch = db.batch();
    for (const [docId, data] of entries.slice(i, i + 450)) {
      batch.set(db.collection(collectionName).doc(docId), data);
    }
    await batch.commit();
  }
  return entries.length;
}

async function runSync() {
  const config = loadConfig();
  initFirebase();
  const sheetsClient = initSheets();
  const db = admin.firestore();

  const startedAt = new Date();
  const validPersons = await getValidPersons(sheetsClient, config);
  const mergedStats = {};
  const mergedDetailRecords = {};
  let sourceRows = 0;
  let latestDataDate = null;

  for (const sheet of config.dataSheets) {
    const rows = await readSheet(sheetsClient, sheet.id, sheet.name || DEFAULTS.dataSheetName);
    sourceRows += Math.max(rows.length - 1, 0);
    const partial = calculateStats(rows, validPersons, config, sheet.id);
    mergeStats(mergedStats, partial.stats);
    Object.assign(mergedDetailRecords, partial.detailRecords);
    if (
      partial.latestDate &&
      (!latestDataDate || partial.latestDate.getTime() > latestDataDate.getTime())
    ) {
      latestDataDate = partial.latestDate;
    }
  }

  for (const row of Object.values(mergedStats)) {
    row.efficiency = row.count > 0
      ? Math.round(((row.count - row.lt09) / row.count) * 100) / 100
      : null;
  }

  const coveredMonths = new Set(Object.values(mergedStats).map((item) => item.yearMonth));
  const deletedCount = await deleteCoveredMonths(db, config.collection, coveredMonths);
  const writtenCount = await writeStats(db, config.collection, mergedStats);
  const detailDeletedCount = await deleteCoveredMonths(db, config.detailCollection, coveredMonths);
  const detailWrittenCount = await writeDetailRecords(db, config.detailCollection, mergedDetailRecords);

  await db.collection(config.collection).doc('_metadata').set({
    lastSyncTime: new Date().toISOString(),
    latestDataDate: latestDataDate ? formatDateYYYYMMDD(latestDataDate) : null,
    recordCount: writtenCount,
    detailRecordCount: detailWrittenCount,
    detailCollection: config.detailCollection,
    validPersonsCount: validPersons.size,
    coveredMonths: Array.from(coveredMonths),
    sourceRows,
    deletedCount,
    detailDeletedCount,
    syncScope: config.syncScope,
    syncYear: config.syncScope === 'current_year' ? config.syncYear : null,
    durationMs: Date.now() - startedAt.getTime(),
  });

  return {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    collection: config.collection,
    detailCollection: config.detailCollection,
    sourceRows,
    validPersonsCount: validPersons.size,
    coveredMonths: Array.from(coveredMonths),
    deletedCount,
    writtenCount,
    detailDeletedCount,
    detailWrittenCount,
    syncScope: config.syncScope,
    syncYear: config.syncScope === 'current_year' ? config.syncYear : null,
    latestDataDate: latestDataDate ? formatDateYYYYMMDD(latestDataDate) : null,
  };
}

function authorizeRequest(syncToken, req) {
  if (!syncToken) return true;
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token === syncToken;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'sync-efficiency' });
});

app.post('/sync-efficiency', async (req, res) => {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
    return;
  }

  if (!authorizeRequest(config.syncToken, req)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    const result = await runSync();
    res.status(200).json(result);
  } catch (error) {
    console.error('sync failed', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

if (require.main === module) {
  const port = parseInteger('PORT', DEFAULTS.port);
  app.listen(port, () => {
    console.log(`sync-efficiency listening on port ${port}`);
  });
}

module.exports = { app, runSync };

