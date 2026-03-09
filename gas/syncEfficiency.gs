/**
 * 計算效率統計並同步至 Firestore efficiency_stats 集合
 *
 * 使用方式：
 *   1. 把此檔案加入你現有的 GAS 專案（跟 Firestore 同步腳本同一個專案）
 *   2. 在 dailySync() 最後加入：syncEfficiencyToFirestore();
 *      或設定獨立的每日觸發器
 *
 * 前提：需要同專案中已有 getFirestore() 與 CONFIG 物件
 *
 * @version 1.0
 * @lastModified 2025/03/06
 */

function syncEfficiencyToFirestore() {
  Logger.log('📊 開始計算效率統計...');
  var firestore = getFirestore();

  // ── 1. 取得有效人員（組別=2, 狀態=1）──
  var refSS = SpreadsheetApp.openById(
    '1JkRsmdkVBcUfmaV8rBMERG9LCgNfACK-uwQhOwjLnH0'
  );
  var refSheet = refSS.getSheetByName('勿修改/全部同事DATA');
  var refData = refSheet.getDataRange().getValues();
  var hdr = refData[0];
  var gIdx = hdr.indexOf('組別');
  var sIdx = hdr.indexOf('狀態(1表示顯示0不顯示)');
  var nIdx = hdr.indexOf('人員名稱');

  var validPersons = [];
  for (var i = 1; i < refData.length; i++) {
    if (refData[i][gIdx] == 2 && refData[i][sIdx] == 1) {
      validPersons.push(refData[i][nIdx]);
    }
  }
  Logger.log('有效人員: ' + validPersons.length + ' 位');

  // ── 2. 取得源資料 ──
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var srcSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  var srcData = srcSheet
    .getRange(2, 1, srcSheet.getLastRow() - 1, srcSheet.getLastColumn())
    .getValues();
  var tz = ss.getSpreadsheetTimeZone();

  // ── 3. 分組統計（邏輯與原 countMultipleColleaguesWorkingHours 一致）──
  var result = {};

  srcData.forEach(function (row) {
    if (row[43] && row[50]) {
      var yearMonth = Utilities.formatDate(
        new Date(row[50]),
        tz,
        'yyyy/M'
      );
      var prodHours = row[53] || 0;
      var bf = row[57];
      var colleagues = String(row[43]).split(',');

      colleagues.forEach(function (c) {
        c = c.trim();
        if (validPersons.indexOf(c) !== -1) {
          var key = c + '_' + yearMonth;
          if (!result[key]) {
            result[key] = {
              yearMonth: yearMonth,
              person: c,
              count: 0,
              lt09: 0,
              btw0912: 0,
              gt12: 0,
              productionHours: 0,
            };
          }

          result[key].productionHours += prodHours;

          if (bf !== '') {
            result[key].count++;
            if (bf < 0.9) {
              result[key].lt09++;
            } else if (bf > 1.2) {
              result[key].gt12++;
            } else {
              result[key].btw0912++;
            }
          }
        }
      });
    }
  });

  // ── 4. 計算效率 = (count - lt09) / count（與原公式一致）──
  for (var key in result) {
    var r = result[key];
    r.efficiency =
      r.count > 0
        ? Math.round(((r.count - r.lt09) / r.count) * 100) / 100
        : null;
  }

  // ── 5. 只刪除「此次涵蓋年月」的舊資料（保留其他年度）──
  var coveredYearMonths = {};
  for (var key in result) {
    coveredYearMonths[result[key].yearMonth] = true;
  }
  Logger.log('此次涵蓋年月: ' + Object.keys(coveredYearMonths).join(', '));

  var totalDeleted = 0;
  try {
    var oldDocs = firestore.getDocuments('efficiency_stats');
    if (oldDocs && oldDocs.length > 0) {
      for (var i = 0; i < oldDocs.length; i++) {
        var path = oldDocs[i].name.split('/documents/')[1];
        var fields = oldDocs[i].fields || {};
        // 讀取 yearMonth 欄位（FirestoreApp 回傳格式可能是 stringValue 或直接是字串）
        var ymField = fields.yearMonth;
        var ym = ymField
          ? typeof ymField === 'object'
            ? ymField.stringValue || null
            : ymField
          : null;
        if (ym && coveredYearMonths[ym]) {
          firestore.deleteDocument(path);
          totalDeleted++;
        }
      }
    }
  } catch (e) {
    Logger.log('efficiency_stats 集合為空或不存在: ' + e);
  }
  Logger.log('已刪除此次涵蓋年月的舊統計: ' + totalDeleted + ' 筆');

  // ── 6. 寫入新統計 ──
  var writeCount = 0;
  for (var key in result) {
    // 將 yyyy/M 中的 / 替換成 - 避免 Firestore path 問題
    var docId = key.replace(/\//g, '-');
    firestore.createDocument('efficiency_stats/' + docId, result[key]);
    writeCount++;
  }

  // ── 7. 寫入 metadata（最後同步時間）──
  var meta = {
    lastSyncTime: new Date().toISOString(),
    recordCount: writeCount,
    validPersonsCount: validPersons.length,
  };
  try {
    firestore.updateDocument('efficiency_stats/_metadata', meta);
  } catch (e) {
    firestore.createDocument('efficiency_stats/_metadata', meta);
  }

  Logger.log('✅ 效率統計同步完成: ' + writeCount + ' 筆');
}
