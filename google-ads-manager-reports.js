/******************************************
 * Google Ads Performance Report
 * by niukalos
 *
 * Single account level
 * Configurable period: 1 / 7 / 14 / 30 days vs previous period
 * Sends report per manager to personal Telegram chat + group
 *
 * Campaign naming convention: "LastName | Category | ..."
 * Labels: each campaign must have a label matching
 *         the manager's last name (as in RECIPIENTS)
 *
 * Setup:
 * 1. Fill in CONFIG below
 * 2. Each manager writes /start to the bot once
 * 3. Set PERIOD_DAYS: 1 / 7 / 14 / 30
 * 4. Schedule via Google Ads Scripts scheduler
 ******************************************/

// ─── CONFIG ──────────────────────────────────────────────────
var CONFIG = {

  // Telegram bot token (from @BotFather), without "bot" prefix
  TELEGRAM_BOT_TOKEN: 'YOUR_BOT_TOKEN_HERE',

  // Group/channel chat ID where all reports are duplicated
  GROUP_CHAT_ID: '-100YOUR_GROUP_CHAT_ID',

  // Campaign label (last name) → array of Telegram personal chat IDs
  // Each manager must send /start to the bot before first report
  // One manager can have multiple IDs: ['ID1', 'ID2']
  RECIPIENTS: {
    'Smith':    ['YOUR_TELEGRAM_ID'],
    'Johnson':  ['YOUR_TELEGRAM_ID'],
    'Williams': ['YOUR_TELEGRAM_ID'],
    'Brown':    ['YOUR_TELEGRAM_ID'],
    'Jones':    ['YOUR_TELEGRAM_ID'],
    'Davis':    ['YOUR_TELEGRAM_ID'],
  },

  // Report period in days. Options:
  // 1  — yesterday vs day before yesterday
  // 7  — last 7 days vs previous 7 days
  // 14 — last 14 days vs previous 14 days
  // 30 — last 30 days vs previous 30 days
  PERIOD_DAYS: 14,

};
// ─────────────────────────────────────────────────────────────


// ─── HELPERS ─────────────────────────────────────────────────
function safeGet(obj, path, fallback) {
  try {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      cur = cur[path[i]];
      if (cur == null) return fallback;
    }
    return cur;
  } catch(e) {
    return fallback;
  }
}

function microsToCurrency(value) {
  return Number(value || 0) / 1000000;
}

function roundInt(value) {
  return Math.round(Number(value || 0));
}

function shiftDate(date, days) {
  var d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateStr(date) {
  var yyyy = date.getFullYear();
  var mm   = ('0' + (date.getMonth() + 1)).slice(-2);
  var dd   = ('0' + date.getDate()).slice(-2);
  return yyyy + '-' + mm + '-' + dd;
}

function formatDateDisplay(dateStr) {
  var p = dateStr.split('-');
  return p[2] + '.' + p[1] + '.' + p[0];
}

function calcDelta(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 'new' : '0%';
  var pct = Math.round(((current - previous) / previous) * 100);
  return (pct > 0 ? '+' : '') + pct + '%';
}

function uniqueKeys(obj) {
  return Object.keys(obj || {});
}

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

function extractCategory(campaignName) {
  var parts = String(campaignName).split('|');
  if (parts.length < 2) return null;
  var cat = parts[1].trim();
  return cat.length > 0 ? cat : null;
}

function normalizeChannel(channelType) {
  return String(channelType).toUpperCase() === 'SEARCH' ? 'Search' : 'Pmax';
}
// ─────────────────────────────────────────────────────────────


// ─── MAIN ────────────────────────────────────────────────────
function main() {
  if (!validateConfig()) return;

  var ranges  = buildDateRanges();
  var campMap = buildCampaignMap();
  Logger.log('Campaigns mapped: ' + uniqueKeys(campMap).length);

  if (uniqueKeys(campMap).length === 0) {
    Logger.log('ERROR: No campaigns found. Check labels and campaign naming.');
    return;
  }

  var current  = fetchMetrics(campMap, ranges.currentStart,  ranges.currentEnd);
  var previous = fetchMetrics(campMap, ranges.previousStart, ranges.previousEnd);
  var merged   = mergeData(current, previous);

  var sent   = 0;
  var errors = 0;

  var labels = uniqueKeys(CONFIG.RECIPIENTS);
  for (var i = 0; i < labels.length; i++) {
    var label   = labels[i];
    var chatIds = CONFIG.RECIPIENTS[label];
    if (!Array.isArray(chatIds)) chatIds = [chatIds];

    if (!merged[label] || uniqueKeys(merged[label]).length === 0) {
      Logger.log('No data for: ' + label);
      continue;
    }

    try {
      var blocks = buildBlocks(merged[label]);
      var header =
        '📊 Report for period\n' +
        '📅 ' + formatDateDisplay(ranges.currentStart) + ' — ' + formatDateDisplay(ranges.currentEnd) + '\n' +
        '👤 Manager: ' + label + '\n' +
        '─────────────────────\n\n';

      var messages = splitMessages(header, blocks);

      for (var m = 0; m < messages.length; m++) {
        sendTelegram(CONFIG.GROUP_CHAT_ID, messages[m]);
        for (var t = 0; t < chatIds.length; t++) {
          sendTelegram(chatIds[t], messages[m]);
        }
        if (m < messages.length - 1) Utilities.sleep(500);
      }

      Logger.log('Sent: ' + label);
      sent++;

    } catch(e) {
      errors++;
      Logger.log('ERROR [' + label + ']: ' + e.message);
      sendErrorAlert(label, e.message, chatIds[0]);
    }
  }

  Logger.log('Done. Sent: ' + sent + ' | Errors: ' + errors);
}


// ─── DATE RANGES ─────────────────────────────────────────────
function buildDateRanges() {
  var today         = new Date();
  var currentEnd    = shiftDate(today, -1);
  var currentStart  = shiftDate(currentEnd,   -(CONFIG.PERIOD_DAYS - 1));
  var previousEnd   = shiftDate(currentStart, -1);
  var previousStart = shiftDate(previousEnd,  -(CONFIG.PERIOD_DAYS - 1));

  return {
    currentStart:  formatDateStr(currentStart),
    currentEnd:    formatDateStr(currentEnd),
    previousStart: formatDateStr(previousStart),
    previousEnd:   formatDateStr(previousEnd),
  };
}


// ─── CAMPAIGN MAP ────────────────────────────────────────────
// Single pass — no N queries per campaign
// Returns { campaignName: { label, category, channel } }
function buildCampaignMap() {
  var campMap  = {};
  var labelMap = {};

  // Step A: collect labels via AdsApp (GAQL does not support labels in SELECT)
  // AdsApp.campaigns().get() returns only ENABLED campaigns by default
  var allCampaigns = [];

  var iterRegular = AdsApp.campaigns().get();
  while (iterRegular.hasNext()) allCampaigns.push(iterRegular.next());

  var iterPmax = AdsApp.performanceMaxCampaigns().get();
  while (iterPmax.hasNext()) allCampaigns.push(iterPmax.next());

  for (var c = 0; c < allCampaigns.length; c++) {
    var campaign = allCampaigns[c];
    var name     = campaign.getName();

    if (name.indexOf('|') === -1) continue; // skip old naming without "|"

    var li = campaign.labels().get();
    while (li.hasNext()) {
      var lbl = li.next().getName();
      if (CONFIG.RECIPIENTS.hasOwnProperty(lbl)) {
        labelMap[name] = lbl;
        break;
      }
    }
  }

  Logger.log('LabelMap: ' + uniqueKeys(labelMap).length);

  // Step B: get channel type via GAQL
  var query =
    'SELECT campaign.name, campaign.advertising_channel_type ' +
    'FROM campaign ' +
    'WHERE campaign.status = "ENABLED"';

  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var row      = rows.next();
    var cname    = safeGet(row, ['campaign', 'name'], '');
    var label    = labelMap[cname];
    if (!label) continue;

    var category = extractCategory(cname);
    if (!category) continue;

    campMap[cname] = {
      label:    label,
      category: category,
      channel:  normalizeChannel(safeGet(row, ['campaign', 'advertisingChannelType'], '')),
    };
  }

  return campMap;
}


// ─── FETCH METRICS ───────────────────────────────────────────
// Returns { label: { category: { channel: { cost, conversions, revenue } } } }
function fetchMetrics(campMap, startDate, endDate) {
  var result = {};

  // Query 1: spend
  var querySpend =
    'SELECT campaign.name, metrics.cost_micros ' +
    'FROM campaign ' +
    'WHERE segments.date >= \'' + startDate + '\' ' +
    '  AND segments.date <= \'' + endDate + '\'';

  var spendRows = AdsApp.search(querySpend);
  while (spendRows.hasNext()) {
    var srow  = spendRows.next();
    var cname = safeGet(srow, ['campaign', 'name'], '');
    var meta  = campMap[cname];
    if (!meta) continue;
    var entry = getOrCreate(result, meta);
    entry.cost += microsToCurrency(safeGet(srow, ['metrics', 'costMicros'], 0));
  }

  // Query 2: conversions with value
  var queryConv =
    'SELECT ' +
    '  campaign.name, ' +
    '  metrics.conversions, ' +
    '  metrics.conversions_value ' +
    'FROM campaign ' +
    'WHERE segments.date >= \'' + startDate + '\' ' +
    '  AND segments.date <= \'' + endDate + '\'';

  var convRows = AdsApp.search(queryConv);
  while (convRows.hasNext()) {
    var crow   = convRows.next();
    var ccname = safeGet(crow, ['campaign', 'name'], '');
    var cmeta  = campMap[ccname];
    if (!cmeta) continue;
    var centry = getOrCreate(result, cmeta);
    centry.conversions += Number(safeGet(crow, ['metrics', 'conversions'], 0));
    centry.revenue     += Number(safeGet(crow, ['metrics', 'conversionsValue'], 0));
  }

  return result;
}

function getOrCreate(result, meta) {
  if (!result[meta.label])                            result[meta.label] = {};
  if (!result[meta.label][meta.category])             result[meta.label][meta.category] = {};
  if (!result[meta.label][meta.category][meta.channel])
    result[meta.label][meta.category][meta.channel]   = { cost: 0, conversions: 0, revenue: 0 };
  return result[meta.label][meta.category][meta.channel];
}


// ─── MERGE PERIODS ───────────────────────────────────────────
function mergeData(current, previous) {
  var result    = {};
  var allLabels = uniqueKeys(current).concat(uniqueKeys(previous)).filter(onlyUnique);

  for (var i = 0; i < allLabels.length; i++) {
    var label = allLabels[i];
    result[label] = {};

    var curCats  = current[label]  || {};
    var prevCats = previous[label] || {};
    var allCats  = uniqueKeys(curCats).concat(uniqueKeys(prevCats)).filter(onlyUnique);

    for (var j = 0; j < allCats.length; j++) {
      var cat = allCats[j];
      result[label][cat] = {};

      var curChannels  = curCats[cat]  || {};
      var prevChannels = prevCats[cat] || {};
      var allChannels  = uniqueKeys(curChannels).concat(uniqueKeys(prevChannels)).filter(onlyUnique);

      for (var k = 0; k < allChannels.length; k++) {
        var ch  = allChannels[k];
        var cur = curChannels[ch]  || { cost: 0, conversions: 0, revenue: 0 };
        var prv = prevChannels[ch] || { cost: 0, conversions: 0, revenue: 0 };

        // Skip categories with no activity in current period
        if (cur.cost === 0 && cur.conversions === 0) continue;

        result[label][cat][ch] = {
          current:  enrichMetrics(cur),
          previous: enrichMetrics(prv),
        };
      }

      if (uniqueKeys(result[label][cat]).length === 0) delete result[label][cat];
    }
  }

  return result;
}

function enrichMetrics(obj) {
  var cost        = Number(obj.cost        || 0);
  var conversions = Number(obj.conversions || 0);
  var revenue     = Number(obj.revenue     || 0);
  return {
    cost:        roundInt(cost),
    conversions: roundInt(conversions),
    cpa:         conversions > 0 ? roundInt(cost / conversions) : 0,
    revenue:     roundInt(revenue),
    aov:         conversions > 0 ? roundInt(revenue / conversions) : 0,
    roas:        cost > 0 ? roundInt((revenue / cost) * 100) : 0,
  };
}


// ─── BUILD MESSAGE BLOCKS ────────────────────────────────────
function buildBlocks(categories) {
  var blocks = [];
  var cats   = uniqueKeys(categories).sort();

  var totalCur  = { cost: 0, conversions: 0, revenue: 0 };
  var totalPrev = { cost: 0, conversions: 0, revenue: 0 };

  for (var i = 0; i < cats.length; i++) {
    var cat      = cats[i];
    var channels = categories[cat];
    var block    = '';

    var channelOrder = ['Search', 'Pmax'];
    for (var j = 0; j < channelOrder.length; j++) {
      var ch   = channelOrder[j];
      var data = channels[ch];
      if (!data) continue;

      var c = data.current;
      var p = data.previous;

      totalCur.cost        += c.cost;
      totalCur.conversions += c.conversions;
      totalCur.revenue     += c.revenue;
      totalPrev.cost        += p.cost;
      totalPrev.conversions += p.conversions;
      totalPrev.revenue     += p.revenue;

      block += '🟢 *' + ch + ' | ' + cat + '*\n';
      block += 'Spend: '     + c.cost        + ' (' + calcDelta(c.cost,        p.cost)        + ')\n';
      block += 'Conv: '      + c.conversions + ' (' + calcDelta(c.conversions, p.conversions) + ')\n';
      block += 'CPA: '       + c.cpa         + ' (' + calcDelta(c.cpa,         p.cpa)         + ')\n';
      block += 'Revenue: '   + c.revenue     + ' (' + calcDelta(c.revenue,     p.revenue)     + ')\n';
      block += 'Avg order: ' + c.aov         + ' (' + calcDelta(c.aov,         p.aov)         + ')\n';
      block += 'ROAS: '      + c.roas        + '% (' + calcDelta(c.roas,       p.roas)        + ')\n';
    }

    blocks.push(block);
  }

  var tc = enrichMetrics(totalCur);
  var tp = enrichMetrics(totalPrev);

  var summary =
    '─────────────────────\n' +
    '💁‍♂️ *Total*\n' +
    'Spend: '     + tc.cost        + ' (' + calcDelta(tc.cost,        tp.cost)        + ')\n' +
    'Conv: '      + tc.conversions + ' (' + calcDelta(tc.conversions, tp.conversions) + ')\n' +
    'CPA: '       + tc.cpa         + ' (' + calcDelta(tc.cpa,         tp.cpa)         + ')\n' +
    'Revenue: '   + tc.revenue     + ' (' + calcDelta(tc.revenue,     tp.revenue)     + ')\n' +
    'Avg order: ' + tc.aov         + ' (' + calcDelta(tc.aov,         tp.aov)         + ')\n' +
    'ROAS: '      + tc.roas        + '% (' + calcDelta(tc.roas,       tp.roas)        + ')';

  blocks.push(summary);
  return blocks;
}


// ─── SPLIT LONG MESSAGES ─────────────────────────────────────
var TG_LIMIT = 3800;

function splitMessages(header, blocks) {
  var messages = [];
  var current  = header;

  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i] + '\n';
    if ((current + block).length > TG_LIMIT) {
      messages.push(current.trim());
      current = block;
    } else {
      current += block;
    }
  }

  if (current.trim().length > 0) messages.push(current.trim());
  return messages;
}


// ─── VALIDATION ──────────────────────────────────────────────
function validateConfig() {
  var ok = true;

  if (!CONFIG.TELEGRAM_BOT_TOKEN || CONFIG.TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    Logger.log('ERROR: TELEGRAM_BOT_TOKEN is not set');
    ok = false;
  }
  if (!CONFIG.GROUP_CHAT_ID || CONFIG.GROUP_CHAT_ID === '-100YOUR_GROUP_CHAT_ID') {
    Logger.log('ERROR: GROUP_CHAT_ID is not set');
    ok = false;
  }
  if (!CONFIG.RECIPIENTS || uniqueKeys(CONFIG.RECIPIENTS).length === 0) {
    Logger.log('ERROR: RECIPIENTS is empty');
    ok = false;
  }

  if (!ok) Logger.log('Fill in CONFIG and run again.');
  return ok;
}


// ─── TELEGRAM ────────────────────────────────────────────────
function sendTelegram(chatId, text) {
  var url      = 'https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/sendMessage';
  var maxTries = 3;

  for (var i = 1; i <= maxTries; i++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        method:             'post',
        contentType:        'application/json',
        payload:            JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' }),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      var body = JSON.parse(response.getContentText());

      if (code === 200 && body.ok) return true;

      if (code === 429) {
        var wait = (body.parameters && body.parameters.retry_after)
          ? body.parameters.retry_after * 1000
          : 2000;
        Logger.log('Rate limit. Retry ' + i + '/' + maxTries);
        Utilities.sleep(wait);
        continue;
      }

      Logger.log('Telegram error ' + code + ': ' + response.getContentText());
      return false;

    } catch(e) {
      Logger.log('Request failed (try ' + i + '): ' + e.message);
      if (i < maxTries) Utilities.sleep(2000);
    }
  }

  return false;
}

function sendErrorAlert(label, errorMessage, chatId) {
  var text =
    'Report error\n' +
    '─────────────────────\n' +
    'Manager: ' + label + '\n' +
    errorMessage + '\n' +
    formatDateDisplay(formatDateStr(new Date()));

  sendTelegram(CONFIG.GROUP_CHAT_ID, text);
  if (chatId) sendTelegram(chatId, text);
}
