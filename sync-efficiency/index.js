const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');

const DEFAULTS = {
  collection: 'efficiency_stats',
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
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + value * 24 * 60 * 60 * 1000);
  }

  const maybeNumber = Number(value);
  if (!Number.isNaN(maybeNumber) && String(value).trim() !== '') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + maybeNumber * 24 * 60 * 60 * 1000);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
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

function calculateStats(rows, validPersons, config) {
  const stats = {};
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;

    const colleagueRaw = row[config.colColleague];
    const dateRaw = row[config.colDate];
    if (!colleagueRaw || !dateRaw) continue;

    const date = parseSheetDate(dateRaw);
    if (!date || Number.isNaN(date.getTime())) continue;

    const yearMonth = `${date.getFullYear()}/${date.getMonth() + 1}`;
    const productionHours = toNumber(row[config.colProductionHours]);

    const bfRaw = row[config.colBf];
    const bf = bfRaw === '' || bfRaw === undefined || bfRaw === null ? null : Number(bfRaw);
    const bfIsValid = bf !== null && !Number.isNaN(bf);

    const colleagues = String(colleagueRaw)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

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
      if (bfIsValid) {
        stats[key].count += 1;
        if (bf < 0.9) stats[key].lt09 += 1;
        else if (bf > 1.2) stats[key].gt12 += 1;
        else stats[key].btw0912 += 1;
      }
    }
  }

  for (const value of Object.values(stats)) {
    value.efficiency = value.count > 0
      ? Math.round(((value.count - value.lt09) / value.count) * 100) / 100
      : null;
  }

  return stats;
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

async function runSync() {
  const config = loadConfig();
  initFirebase();
  const sheetsClient = initSheets();
  const db = admin.firestore();

  const startedAt = new Date();
  const validPersons = await getValidPersons(sheetsClient, config);
  const mergedStats = {};
  let sourceRows = 0;

  for (const sheet of config.dataSheets) {
    const rows = await readSheet(sheetsClient, sheet.id, sheet.name || DEFAULTS.dataSheetName);
    sourceRows += Math.max(rows.length - 1, 0);
    const partial = calculateStats(rows, validPersons, config);
    mergeStats(mergedStats, partial);
  }

  for (const row of Object.values(mergedStats)) {
    row.efficiency = row.count > 0
      ? Math.round(((row.count - row.lt09) / row.count) * 100) / 100
      : null;
  }

  const coveredMonths = new Set(Object.values(mergedStats).map((item) => item.yearMonth));
  const deletedCount = await deleteCoveredMonths(db, config.collection, coveredMonths);
  const writtenCount = await writeStats(db, config.collection, mergedStats);

  await db.collection(config.collection).doc('_metadata').set({
    lastSyncTime: new Date().toISOString(),
    recordCount: writtenCount,
    validPersonsCount: validPersons.size,
    coveredMonths: Array.from(coveredMonths),
    sourceRows,
    deletedCount,
    durationMs: Date.now() - startedAt.getTime(),
  });

  return {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    collection: config.collection,
    sourceRows,
    validPersonsCount: validPersons.size,
    coveredMonths: Array.from(coveredMonths),
    deletedCount,
    writtenCount,
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
