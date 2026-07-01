'use strict';

// ============================================================
// Config — Financial Modeling Prep (FMP) stable API
// Legacy /api/v3 endpoints are rejected for accounts created
// after mid-2025, so everything here uses /stable.
// ============================================================
const FMP_BASE = 'https://financialmodelingprep.com';

// Yahoo Finance fallback: Yahoo sends no CORS headers, so browser requests
// must route through public CORS proxies. Tried in order until one works.
const YH_PROXIES = [
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  u => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  u => u,
];

let currentTicker = '';
let fullData      = null;
let priceChart    = null;
let watchlist     = JSON.parse(localStorage.getItem('finmetrics_watchlist') || '[]');
let apiKey        = localStorage.getItem('finmetrics_apikey') || '';

// ============================================================
// API
// ============================================================

async function fmpFetch(path, params = {}) {
  if (!apiKey) throw new Error('Enter your free FMP API key above to get started.');

  const url = new URL(FMP_BASE + path);
  url.searchParams.set('apikey', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());

  // FMP puts its real diagnosis in the body even on error statuses — surface it
  let data = null;
  try { data = await res.json(); } catch (_) {}
  const apiMsg = data && !Array.isArray(data)
    ? (data['Error Message'] || data.message || data.error) : null;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(apiMsg || 'FMP rejected the API key. Double-check it at financialmodelingprep.com → Dashboard.');
    }
    if (res.status === 402) throw new Error(apiMsg || 'This data requires a paid FMP plan.');
    if (res.status === 429) throw new Error('Rate limit hit (250 requests/day on the free plan). Try again later.');
    throw new Error(apiMsg || `API error: HTTP ${res.status}`);
  }
  if (apiMsg) throw new Error(apiMsg);
  return data;
}

const fmpProfile   = t => fmpFetch('/stable/profile',                 { symbol: t });
const fmpQuote     = t => fmpFetch('/stable/quote',                   { symbol: t });
const fmpMetrics   = t => fmpFetch('/stable/key-metrics-ttm',         { symbol: t });
const fmpRatios    = t => fmpFetch('/stable/ratios-ttm',              { symbol: t });
const fmpRecs      = t => fmpFetch('/stable/grades-consensus',        { symbol: t });
const fmpTargets   = t => fmpFetch('/stable/price-target-consensus',  { symbol: t });
const fmpFloat     = t => fmpFetch('/stable/shares-float',            { symbol: t });
const fmpDividends = t => fmpFetch('/stable/dividends',               { symbol: t });
const fmpIncome    = t => fmpFetch('/stable/income-statement',        { symbol: t, limit: 4 });
const fmpBalance   = t => fmpFetch('/stable/balance-sheet-statement', { symbol: t, limit: 4 });
const fmpCashflow  = t => fmpFetch('/stable/cash-flow-statement',     { symbol: t, limit: 4 });
const fmpHistory   = (t, days) => {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return fmpFetch('/stable/historical-price-eod/light', { symbol: t, from });
};

// ============================================================
// Yahoo Finance fallback (unofficial, via CORS proxies)
// Fills analyst data and international tickers that FMP's
// free plan doesn't include. Best-effort: failures are silent.
// ============================================================

async function yahooFetch(yahooUrl) {
  let lastErr = null;
  for (const wrap of YH_PROXIES) {
    try {
      const res = await fetch(wrap(yahooUrl));
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      return await res.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Yahoo fallback unreachable');
}

// Yahoo wraps numbers as {raw, fmt} in some responses
const yraw = v => (v && typeof v === 'object' && 'raw' in v) ? v.raw : v;

async function yahooAnalyst(t) {
  const out = { recs: null, targets: null, shortRatio: null };
  try {
    const d = await yahooFetch(
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(t)}?modules=financialData%2CrecommendationTrend%2CdefaultKeyStatistics`);
    const q   = d?.quoteSummary?.result?.[0];
    const fin = q?.financialData;
    if (fin && yraw(fin.targetMeanPrice) != null) {
      out.targets = [{ targetHigh: yraw(fin.targetHighPrice), targetLow: yraw(fin.targetLowPrice),
                       targetConsensus: yraw(fin.targetMeanPrice), targetMedian: yraw(fin.targetMedianPrice) }];
    }
    const tr = q?.recommendationTrend?.trend?.find(x => x.period === '0m') || q?.recommendationTrend?.trend?.[0];
    if (tr) out.recs = [{ strongBuy: yraw(tr.strongBuy), buy: yraw(tr.buy), hold: yraw(tr.hold),
                          sell: yraw(tr.sell), strongSell: yraw(tr.strongSell) }];
    out.shortRatio = yraw(q?.defaultKeyStatistics?.shortRatio) ?? null;
  } catch (e) {
    // quoteSummary is sometimes crumb-gated — insights endpoint at least has a target price
    try {
      const d = await yahooFetch(`https://query1.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=${encodeURIComponent(t)}`);
      const rec = d?.finance?.result?.instrumentInfo?.recommendation;
      if (rec?.targetPrice != null) out.targets = [{ targetConsensus: rec.targetPrice }];
    } catch (_) {}
  }
  return out;
}

async function yahooChart(t, days) {
  const range    = days <= 5 ? '5d' : days <= 30 ? '1mo' : days <= 90 ? '3mo'
                 : days <= 180 ? '6mo' : days <= 365 ? '1y' : '5y';
  const interval = days <= 5 ? '30m' : days <= 365 ? '1d' : '1wk';
  const d = await yahooFetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=${range}&interval=${interval}`);
  const r = d?.chart?.result?.[0];
  if (!r) throw new Error('No Yahoo chart data');
  const closes = r.indicators?.quote?.[0]?.close || [];
  const hist = (r.timestamp || [])
    .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), price: closes[i] }))
    .filter(x => x.price != null);
  return { meta: r.meta || {}, hist };
}

// ============================================================
// Formatters
// ============================================================

function fmtBig(v) {
  const n = parseFloat(v);
  if (v == null || isNaN(n)) return 'N/A';
  const abs = Math.abs(n), s = n < 0 ? '-' : '';
  if (abs >= 1e12) return s + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return s + (abs / 1e9).toFixed(2)  + 'B';
  if (abs >= 1e6)  return s + (abs / 1e6).toFixed(2)  + 'M';
  if (abs >= 1e3)  return s + (abs / 1e3).toFixed(1)  + 'K';
  return s + abs.toFixed(2);
}

function fmtCurrency(v)  { const s = fmtBig(v); return s === 'N/A' ? 'N/A' : '$' + s; }
function fmtPrice(v)     { const n = parseFloat(v); return (v == null || isNaN(n)) ? 'N/A' : '$' + n.toFixed(2); }
function fmtRatio(v, d=2){ const n = parseFloat(v); return (v == null || isNaN(n)) ? 'N/A' : n.toFixed(d) + 'x'; }

// FMP margins/ratios as decimals: 0.4413 = 44.13%
function fmtPctDecimal(v, d=2) {
  const n = parseFloat(v);
  return (v == null || isNaN(n)) ? 'N/A' : (n * 100).toFixed(d) + '%';
}

function fmtPctDirect(v, d=2) {
  const n = parseFloat(v);
  return (v == null || isNaN(n)) ? 'N/A' : n.toFixed(d) + '%';
}

function fmtDate(v) {
  if (!v) return 'N/A';
  const d = new Date(v);
  if (isNaN(d)) return 'N/A';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// First value that parses to a finite number, else null
function pick(...vals) {
  for (const v of vals) {
    const n = parseFloat(v);
    if (v != null && !isNaN(n)) return n;
  }
  return null;
}

// ============================================================
// DOM helpers
// ============================================================

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text ?? 'N/A';
}

function setColored(id, text, positive) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text ?? 'N/A';
  el.className = 'kpi-value' + (positive === true ? ' positive' : positive === false ? ' negative' : '');
}

function show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// ============================================================
// Render: Stock Header
// ============================================================

function renderHeader(profile, quote, ticker) {
  const price  = pick(quote.price, profile.price);
  const change = pick(quote.change, profile.change);
  const pct    = pick(quote.changesPercentage, quote.changePercentage, profile.changePercentage);
  const isUp   = (change ?? 0) >= 0;

  setText('stockName',        profile.companyName || quote.name || ticker);
  setText('stockTickerBadge', ticker);
  setText('stockExchange',    profile.exchangeShortName || profile.exchange || quote.exchange || '');
  setText('stockSector',      profile.sector || profile.industry || 'Equity');

  const logoContainer = document.getElementById('stockLogo');
  if (logoContainer) {
    if (profile.image) {
      logoContainer.innerHTML = `<img src="${profile.image}" alt="${ticker}"
        style="width:36px;height:36px;object-fit:contain;border-radius:6px;"
        onerror="this.outerHTML='<span id=stockLogoText>${ticker.slice(0,2)}</span>'" />`;
    } else {
      logoContainer.innerHTML = `<span id="stockLogoText">${ticker.slice(0, 2)}</span>`;
    }
  }

  setText('currentPrice', price == null ? 'N/A' : '$' + price.toFixed(2));

  const changeEl = document.getElementById('priceChange');
  if (changeEl) changeEl.className = 'price-change ' + (isUp ? 'positive' : 'negative');

  setText('changeAmount', (isUp ? '+' : '-') + (change == null ? '0.00' : '$' + Math.abs(change).toFixed(2)));

  const badge = document.getElementById('changeBadge');
  if (badge) {
    badge.textContent = (isUp ? '+' : '') + (pct == null ? '0.00' : pct.toFixed(2)) + '%';
    badge.className   = 'change-badge ' + (isUp ? 'positive' : 'negative');
  }

  setText('priceDate', 'Real-time · ' + (profile.currency || 'USD'));

  const wlBtn = document.getElementById('watchlistBtn');
  if (wlBtn) wlBtn.dataset.ticker = ticker;
  updateWatchlistBtn(ticker);
  show('stockHeader');
}

// ============================================================
// Render: Quick Stats
// ============================================================

function renderQuickStats(profile, quote, metrics, ratios, income, cashflow) {
  const ic = Array.isArray(income)   && income.length   ? income[0]   : {};
  const cf = Array.isArray(cashflow) && cashflow.length ? cashflow[0] : {};
  const m  = Array.isArray(metrics)  && metrics.length  ? metrics[0]  : {};
  const r  = Array.isArray(ratios)   && ratios.length   ? ratios[0]   : {};

  const price   = pick(quote.price, profile.price);
  const eps     = pick(quote.eps, ic.epsDiluted, ic.epsdiluted, ic.eps);
  const pe      = pick(quote.pe, r.priceToEarningsRatioTTM, m.peRatioTTM,
                       price != null && eps ? price / eps : null);
  const lastDiv = pick(profile.lastDiv, profile.lastDividend);

  setText('statMarketCap', fmtCurrency(pick(profile.mktCap, profile.marketCap, quote.marketCap)));
  setText('statPE',        fmtRatio(pe));
  setText('statEPS',       fmtPrice(eps));
  setText('statRevenue',   fmtCurrency(ic.revenue));
  setText('statNetIncome', fmtCurrency(ic.netIncome));
  setText('statFCF',       fmtCurrency(pick(cf.freeCashFlow, cf.operatingCashFlow, cf.netCashProvidedByOperatingActivities)));
  setText('statDivYield',  lastDiv > 0 && price > 0 ? fmtPctDirect((lastDiv / price) * 100) : 'N/A');
  setText('statBeta',      profile.beta != null ? parseFloat(profile.beta).toFixed(2) : 'N/A');

  show('quickStats');
}

// ============================================================
// Render: KPI Cards
// ============================================================

function renderKPIs(profile, quote, metrics, ratios, recs, targets, floatData, dividends, balance, income, cashflow, shortRatio) {
  const m    = Array.isArray(metrics)   && metrics.length   ? metrics[0]   : {};
  const r    = Array.isArray(ratios)    && ratios.length    ? ratios[0]    : {};
  const b    = Array.isArray(balance)   && balance.length   ? balance[0]   : {};
  const ic   = Array.isArray(income)    && income.length    ? income[0]    : {};
  const cf   = Array.isArray(cashflow)  && cashflow.length  ? cashflow[0]  : {};
  const fl   = Array.isArray(floatData) && floatData.length ? floatData[0] : {};
  const div0 = Array.isArray(dividends) && dividends.length ? dividends[0] : {};

  const curPrice = pick(quote.price, profile.price);
  const mcap     = pick(profile.mktCap, profile.marketCap, quote.marketCap);
  const eps      = pick(quote.eps, ic.epsDiluted, ic.epsdiluted, ic.eps);
  const shares   = pick(profile.sharesOutstanding, quote.sharesOutstanding,
                        fl.outstandingShares, ic.weightedAverageShsOutDil, ic.weightedAverageShsOut,
                        mcap != null && curPrice ? mcap / curPrice : null);
  const lastDiv  = pick(profile.lastDiv, profile.lastDividend);

  // -- Valuation --
  const pe = pick(quote.pe, r.priceToEarningsRatioTTM, m.peRatioTTM,
                  curPrice != null && eps ? curPrice / eps : null);
  setText('kpiPE',        fmtRatio(pe));
  setText('kpiForwardPE', fmtRatio(pick(m.forwardPE, curPrice != null && eps ? curPrice / eps : null)));
  setText('kpiPEG',       fmtRatio(pick(r.priceToEarningsGrowthRatioTTM, m.pegRatioTTM, r.priceEarningsToGrowthRatioTTM)));
  setText('kpiPB',        fmtRatio(pick(r.priceToBookRatioTTM, m.pbRatioTTM)));
  setText('kpiPS',        fmtRatio(pick(r.priceToSalesRatioTTM, m.priceToSalesRatioTTM)));
  setText('kpiEVEBITDA',  fmtRatio(pick(m.evToEBITDATTM, m.evToEbitdaTTM, r.enterpriseValueMultipleTTM)));

  const ev = pick(m.enterpriseValueTTM,
                  mcap != null ? mcap + (pick(b.totalDebt) ?? 0) - (pick(b.cashAndCashEquivalents) ?? 0) : null);
  setText('kpiEV',        fmtCurrency(ev));
  setText('kpiBookValue', fmtPrice(pick(m.bookValuePerShareTTM,
                                        b.totalStockholdersEquity && shares ? b.totalStockholdersEquity / shares : null)));

  // -- Profitability --
  const setMargin = (id, val) => {
    const n = parseFloat(val);
    if (val == null || isNaN(n)) { setText(id, 'N/A'); return; }
    const pct = n * 100;
    setColored(id, pct.toFixed(2) + '%', pct > 0);
  };

  setMargin('kpiGrossMargin', pick(r.grossProfitMarginTTM, m.grossProfitMarginTTM));
  setMargin('kpiOpMargin',    pick(r.operatingProfitMarginTTM, m.operatingProfitMarginTTM));
  setMargin('kpiNetMargin',   pick(r.netProfitMarginTTM, m.netProfitMarginTTM));

  setText('kpiEBITDA', fmtCurrency(ic.ebitda));
  const ebMarginDec = pick(ic.ebitda && ic.revenue && parseFloat(ic.revenue) !== 0
                             ? parseFloat(ic.ebitda) / parseFloat(ic.revenue) : null,
                           r.ebitdaMarginTTM);
  setMargin('kpiEBITDAMargin', ebMarginDec);

  setMargin('kpiROE',  pick(r.returnOnEquityTTM, m.returnOnEquityTTM, m.roeTTM));
  setMargin('kpiROA',  pick(r.returnOnAssetsTTM, m.returnOnAssetsTTM, m.roaTTM));
  setMargin('kpiROIC', pick(m.returnOnInvestedCapitalTTM, m.roicTTM, r.returnOnCapitalEmployedTTM));

  // -- Financial Health --
  setText('kpiRevenue', fmtCurrency(ic.revenue));
  const ni = parseFloat(ic.netIncome);
  if (!isNaN(ni)) setColored('kpiNetIncome', fmtCurrency(ic.netIncome), ni > 0);
  else setText('kpiNetIncome', 'N/A');

  setText('kpiTotalCash', fmtCurrency(pick(b.cashAndCashEquivalents, b.cashAndShortTermInvestments)));
  setText('kpiTotalDebt', fmtCurrency(pick(b.totalDebt, b.longTermDebt)));

  const de = pick(r.debtToEquityRatioTTM, r.debtEquityRatioTTM, m.debtToEquityTTM);
  setText('kpiDebtEquity', de == null ? 'N/A' : de.toFixed(2) + 'x');

  setText('kpiCurrentRatio', fmtRatio(pick(r.currentRatioTTM, m.currentRatioTTM)));
  setText('kpiQuickRatio',   fmtRatio(pick(r.quickRatioTTM, m.quickRatioTTM)));

  const fcf = pick(cf.freeCashFlow, cf.operatingCashFlow, cf.netCashProvidedByOperatingActivities);
  if (fcf != null) setColored('kpiFCF', fmtCurrency(fcf), fcf > 0);
  else setText('kpiFCF', 'N/A');

  // -- Growth & Dividends --
  const income2 = Array.isArray(income) && income.length > 1 ? income[1] : null;
  if (income2 && parseFloat(income2.revenue)) {
    const revG = (parseFloat(ic.revenue) - parseFloat(income2.revenue)) / Math.abs(parseFloat(income2.revenue));
    setColored('kpiRevenueGrowth', (revG >= 0 ? '+' : '') + (revG * 100).toFixed(2) + '%', revG > 0);
  } else setText('kpiRevenueGrowth', 'N/A');

  if (income2 && parseFloat(income2.netIncome)) {
    const niG = (parseFloat(ic.netIncome) - parseFloat(income2.netIncome)) / Math.abs(parseFloat(income2.netIncome));
    setColored('kpiEarningsGrowth', (niG >= 0 ? '+' : '') + (niG * 100).toFixed(2) + '%', niG > 0);
  } else setText('kpiEarningsGrowth', 'N/A');

  setText('kpiEPS',        fmtPrice(eps));
  setText('kpiForwardEPS', fmtPrice(pick(ic.epsDiluted, ic.epsdiluted, eps)));

  const divYield = lastDiv > 0 && curPrice > 0 ? (lastDiv / curPrice) * 100 : null;
  setText('kpiDivYield',   divYield != null ? fmtPctDirect(divYield)
                            : (r.dividendYieldTTM != null ? fmtPctDecimal(r.dividendYieldTTM) : 'N/A'));
  setText('kpiDivRate',    lastDiv > 0 ? fmtPrice(lastDiv) : 'N/A');

  const payout = pick(r.dividendPayoutRatioTTM, r.payoutRatioTTM, m.payoutRatioTTM);
  setText('kpiPayoutRatio', payout == null ? 'N/A' : fmtPctDecimal(payout));
  setText('kpiExDivDate',   fmtDate(div0.date || quote.exDividendDate || profile.exDividendDate));

  // -- Market Data --
  setText('kpi52High',    fmtPrice(quote.yearHigh));
  setText('kpi52Low',     fmtPrice(quote.yearLow));
  setText('kpi50MA',      fmtPrice(quote.priceAvg50));
  setText('kpi200MA',     fmtPrice(quote.priceAvg200));
  setText('kpiVolume',    fmtBig(pick(quote.volume, profile.volume)));
  setText('kpiAvgVolume', fmtBig(pick(quote.avgVolume, quote.averageVolume, profile.volAvg, profile.averageVolume)));
  setText('kpiShares',    fmtBig(shares));
  setText('kpiFloat',     fmtBig(pick(fl.floatShares, profile.floatShares, quote.floatShares)));

  // -- Analyst Consensus --
  const latestRec = Array.isArray(recs) ? (recs.length ? recs[0] : null) : recs;
  const sb  = pick(latestRec?.strongBuy,  latestRec?.analystRatingsStrongBuy)  ?? 0;
  const b2  = pick(latestRec?.buy,        latestRec?.analystRatingsBuy)        ?? 0;
  const h   = pick(latestRec?.hold,       latestRec?.analystRatingsHold)       ?? 0;
  const s   = pick(latestRec?.sell,       latestRec?.analystRatingsSell)       ?? 0;
  const ss  = pick(latestRec?.strongSell, latestRec?.analystRatingsStrongSell) ?? 0;
  const total = sb + b2 + h + s + ss;

  if (latestRec && total > 0) {
    const buyPct = (sb + b2) / total;
    let rec = latestRec.consensus || 'Hold';
    if (!latestRec.consensus) {
      if (buyPct > 0.6) rec = buyPct > 0.8 ? 'Strong Buy' : 'Buy';
      if ((s + ss) / total > 0.4) rec = 'Sell';
    }

    const recEl = document.getElementById('kpiRecommendation');
    if (recEl) {
      recEl.textContent = rec;
      recEl.className   = 'kpi-value' + (rec.includes('Buy') ? ' positive' : rec.includes('Sell') ? ' negative' : '');
    }
    setText('kpiRating',       `${sb + b2} Buy · ${h} Hold · ${s + ss} Sell`);
    setText('kpiAnalystCount', total.toString());
  } else {
    setText('kpiRecommendation', 'N/A');
    setText('kpiRating',         'N/A');
    setText('kpiAnalystCount',   'N/A');
  }

  const t0 = Array.isArray(targets) ? (targets.length ? targets[0] : null) : targets;
  if (t0 && (t0.targetConsensus != null || t0.targetMedian != null)) {
    const mean   = pick(t0.targetConsensus, t0.targetMedian);
    const upside = curPrice && mean != null ? (mean - curPrice) / curPrice : null;
    setText('kpiTargetPrice', fmtPrice(mean));
    setText('kpiTargetHigh',  fmtPrice(t0.targetHigh));
    setText('kpiTargetLow',   fmtPrice(t0.targetLow));
    if (upside != null) setColored('kpiUpside', (upside >= 0 ? '+' : '') + (upside * 100).toFixed(2) + '%', upside > 0);
    else setText('kpiUpside', 'N/A');
  } else {
    ['kpiTargetPrice', 'kpiTargetHigh', 'kpiTargetLow', 'kpiUpside'].forEach(id => setText(id, 'N/A'));
  }

  const sr = parseFloat(shortRatio);
  setText('kpiShortRatio', (shortRatio != null && !isNaN(sr)) ? sr.toFixed(2) : 'N/A');
  show('kpis');
}

// ============================================================
// Render: Price Chart
// ============================================================

function renderChart(historical) {
  // stable API returns a bare array; legacy v3 wrapped it in {historical}
  const raw = Array.isArray(historical) ? historical : historical?.historical;
  if (!Array.isArray(raw) || !raw.length) return;

  const sorted = [...raw].sort((a, b) => new Date(a.date) - new Date(b.date));
  const labels = sorted.map(d => {
    const dt = new Date(d.date);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const prices = sorted.map(d => {
    const v = d.close ?? d.price;
    return v != null ? +parseFloat(v).toFixed(2) : null;
  });

  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const isUp      = prices.length >= 2 && (prices[prices.length - 1] ?? 0) >= (prices[0] ?? 0);
  const lineColor = isUp ? '#10b981' : '#ef4444';

  const ctx  = document.getElementById('priceChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 320);
  grad.addColorStop(0, isUp ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: prices,
        borderColor: lineColor,
        backgroundColor: grad,
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: lineColor,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f1628',
          borderColor: '#1e3254',
          borderWidth: 1,
          titleColor: '#8892a4',
          bodyColor: '#f0f4ff',
          padding: 10,
          callbacks: { label: c => ' $' + (c.parsed.y?.toFixed(2) ?? '—') },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.03)' },
          ticks: { color: '#8892a4', font: { size: 11 }, maxTicksLimit: 8 },
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8892a4', font: { size: 11 }, callback: v => '$' + v.toFixed(0) },
        },
      },
    },
  });
}

const TF_DAYS = { '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '5y': 1825 };

async function loadChart(ticker, range) {
  const days = TF_DAYS[range] || 365;
  try {
    const hist = await fmpHistory(ticker, days);
    const arr = Array.isArray(hist) ? hist : hist?.historical;
    if (Array.isArray(arr) && arr.length) { renderChart(arr); return; }
    throw new Error('no FMP history');
  } catch (e) {
    try {
      const y = await yahooChart(ticker, days);
      if (y.hist.length) renderChart(y.hist);
    } catch (e2) {
      console.warn('Chart error:', e2.message);
    }
  }
}

// ============================================================
// Render: Financial Statements
// ============================================================

// f.key may be a single field name or an array of candidates
// (stable and legacy statements use different names for a few rows)
function buildFinTable(fields, reports) {
  if (!reports?.length) {
    return '<p style="padding:20px;color:var(--text-muted)">No annual data available for this ticker.</p>';
  }
  const years = reports.slice(0, 4).reverse();
  const head  = years.map(r => `<th>${String(r.date || r.calendarYear || r.fiscalYear || '').slice(0, 4)}</th>`).join('');
  const rows  = fields.map(f => {
    const keys  = Array.isArray(f.key) ? f.key : [f.key];
    const cells = years.map(r => {
      const v = keys.map(k => r[k]).find(x => x != null && x !== '');
      if (v == null) return '<td class="fin-value">N/A</td>';
      const n = parseFloat(v);
      const cls = f.colored ? (n > 0 ? ' positive' : n < 0 ? ' negative' : '') : '';
      return `<td class="fin-value${cls}">${fmtCurrency(v)}</td>`;
    }).join('');
    return `<tr><td class="fin-label">${f.label}</td>${cells}</tr>`;
  }).join('');

  return `<div class="fin-table-wrapper"><table class="fin-table">
    <thead><tr><th>Metric</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

const INCOME_FIELDS = [
  { key: 'revenue',              label: 'Total Revenue' },
  { key: 'grossProfit',         label: 'Gross Profit',     colored: true },
  { key: 'operatingIncome',     label: 'Operating Income', colored: true },
  { key: 'netIncome',           label: 'Net Income',       colored: true },
  { key: 'ebitda',              label: 'EBITDA',           colored: true },
  { key: 'researchAndDevelopmentExpenses', label: 'R&D Expenses' },
];
const BALANCE_FIELDS = [
  { key: 'totalAssets',                label: 'Total Assets' },
  { key: 'totalCurrentAssets',         label: 'Current Assets' },
  { key: 'cashAndCashEquivalents',     label: 'Cash & Equivalents' },
  { key: 'totalLiabilities',           label: 'Total Liabilities' },
  { key: 'totalCurrentLiabilities',    label: 'Current Liabilities' },
  { key: 'longTermDebt',               label: 'Long-Term Debt' },
  { key: 'totalStockholdersEquity',    label: "Stockholders' Equity", colored: true },
];
const CASHFLOW_FIELDS = [
  { key: ['operatingCashFlow', 'netCashProvidedByOperatingActivities'], label: 'Operating Cash Flow', colored: true },
  { key: 'capitalExpenditure',         label: 'Capital Expenditures' },
  { key: 'freeCashFlow',               label: 'Free Cash Flow',      colored: true },
  { key: ['dividendsPaid', 'netDividendsPaid', 'commonDividendsPaid'], label: 'Dividends Paid' },
  { key: ['netCashUsedForInvestingActivites', 'netCashProvidedByInvestingActivities'], label: 'Investing Activities' },
];

async function loadAndRenderTab(fetchFn, fields) {
  const data = await fetchFn(currentTicker);
  document.getElementById('finContent').innerHTML = buildFinTable(fields, data);
}

// ============================================================
// Watchlist
// ============================================================

function updateWatchlistBtn(ticker) {
  const btn    = document.getElementById('watchlistBtn');
  if (!btn) return;
  const inList = watchlist.includes(ticker);
  btn.innerHTML = inList
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> In Watchlist`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Add to Watchlist`;
  btn.classList.toggle('active', inList);
}

function toggleWatchlist(ticker) {
  const idx = watchlist.indexOf(ticker);
  if (idx === -1) watchlist.push(ticker); else watchlist.splice(idx, 1);
  localStorage.setItem('finmetrics_watchlist', JSON.stringify(watchlist));
  updateWatchlistBtn(ticker);
  renderWatchlistGrid();
}

function renderWatchlistGrid() {
  const grid  = document.getElementById('watchlistGrid');
  const empty = document.getElementById('watchlistEmpty');
  grid.querySelectorAll('.watchlist-item').forEach(el => el.remove());
  if (!watchlist.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  watchlist.forEach(ticker => {
    const item = document.createElement('div');
    item.className = 'watchlist-item';
    item.innerHTML = `<span class="watchlist-ticker">${ticker}</span><button class="watchlist-remove">×</button>`;
    item.querySelector('.watchlist-ticker').addEventListener('click', () => searchStock(ticker));
    item.querySelector('.watchlist-remove').addEventListener('click', e => {
      e.stopPropagation(); toggleWatchlist(ticker);
    });
    grid.appendChild(item);
  });
}

// ============================================================
// Main Search
// ============================================================

async function searchStock(ticker) {
  ticker = ticker.trim().toUpperCase();
  if (!ticker) return;

  if (!apiKey) {
    const banner = document.getElementById('errorBanner');
    document.getElementById('errorMessage').textContent =
      'Please enter your free FMP API key above. Register at financialmodelingprep.com — takes 30 seconds, no credit card.';
    if (banner) banner.style.display = 'flex';
    document.querySelector('.apikey-box')?.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  currentTicker = ticker;
  fullData      = {};

  show('loadingOverlay');
  hide('errorBanner');
  hide('stockHeader');
  hide('chartSection');
  hide('quickStats');
  hide('kpis');
  hide('financials');
  document.querySelectorAll('.fin-tab').forEach((t, i) => t.classList.toggle('active', i === 0));

  try {
    // FMP is primary; remember its core error so we can surface it if the
    // Yahoo rescue below also fails
    let fmpCoreError = null;
    const [profileArr, quoteArr, metricsArr, ratiosArr, recsArr, targetsArr, floatArr, divArr, incomeArr, balanceArr, cashflowArr, histData] = await Promise.all([
      fmpProfile(ticker).catch(err => { fmpCoreError = err; return []; }),
      fmpQuote(ticker).catch(err => { fmpCoreError = fmpCoreError || err; return []; }),
      fmpMetrics(ticker).catch(() => []),
      fmpRatios(ticker).catch(() => []),
      fmpRecs(ticker).catch(() => []),
      fmpTargets(ticker).catch(() => []),
      fmpFloat(ticker).catch(() => []),
      fmpDividends(ticker).catch(() => []),
      fmpIncome(ticker).catch(() => []),
      fmpBalance(ticker).catch(() => []),
      fmpCashflow(ticker).catch(() => []),
      fmpHistory(ticker, 365).catch(() => []),
    ]);

    let profile = Array.isArray(profileArr) ? (profileArr[0] || null) : profileArr;
    let quote   = Array.isArray(quoteArr)   ? (quoteArr[0]   || null) : quoteArr;
    let histArr = Array.isArray(histData)   ? histData : histData?.historical;

    // Yahoo rescue: international tickers FMP's free plan doesn't cover
    if (!profile?.companyName && !quote?.symbol) {
      try {
        const y = await yahooChart(ticker, 365);
        const m = y.meta;
        if (m.regularMarketPrice != null) {
          profile = {
            companyName: m.longName || m.shortName || ticker,
            exchange:    m.fullExchangeName || m.exchangeName || '',
            currency:    m.currency || 'USD',
          };
          quote = { symbol: m.symbol || ticker, price: m.regularMarketPrice,
                    yearHigh: m.fiftyTwoWeekHigh, yearLow: m.fiftyTwoWeekLow };
          const prev = m.chartPreviousClose ?? m.previousClose;
          if (prev) {
            quote.change = m.regularMarketPrice - prev;
            quote.changePercentage = ((m.regularMarketPrice - prev) / prev) * 100;
          }
          if (!Array.isArray(histArr) || !histArr.length) histArr = y.hist;
        }
      } catch (_) {}
    }

    if (!profile?.companyName && !quote?.symbol) {
      throw fmpCoreError || new Error(`"${ticker}" not found. Please check the ticker symbol.`);
    }

    // Yahoo fallback: analyst ratings/targets are premium on FMP's free plan
    let recsData = recsArr, targetsData = targetsArr, shortRatio = null;
    const t0chk = Array.isArray(targetsData) && targetsData.length ? targetsData[0] : null;
    const recsMissing    = !(Array.isArray(recsData) && recsData.length);
    const targetsMissing = !t0chk || (t0chk.targetConsensus == null && t0chk.targetMedian == null);
    if (recsMissing || targetsMissing) {
      const y = await yahooAnalyst(ticker).catch(() => null);
      if (y) {
        if (y.recs && recsMissing)       recsData    = y.recs;
        if (y.targets && targetsMissing) targetsData = y.targets;
        shortRatio = y.shortRatio;
      }
    }

    const p = profile || {};
    const q = quote   || {};

    fullData = { profile: p, quote: q, metrics: metricsArr, ratios: ratiosArr, recs: recsData,
                 targets: targetsData, floatData: floatArr, dividends: divArr,
                 income: incomeArr, balance: balanceArr, cashflow: cashflowArr };

    renderHeader(p, q, ticker);
    renderQuickStats(p, q, metricsArr, ratiosArr, incomeArr, cashflowArr);
    renderKPIs(p, q, metricsArr, ratiosArr, recsData, targetsData, floatArr, divArr, balanceArr, incomeArr, cashflowArr, shortRatio);

    if (Array.isArray(histArr) && histArr.length) {
      try {
        renderChart(histArr);
        show('chartSection');
      } catch (e) {
        console.warn('Chart render failed:', e.message);
      }
    }

    show('financials');
    if (Array.isArray(incomeArr) && incomeArr.length) {
      document.getElementById('finContent').innerHTML = buildFinTable(INCOME_FIELDS, incomeArr);
    } else {
      document.getElementById('finContent').innerHTML =
        '<p style="padding:20px;color:var(--text-muted)">Financial statements unavailable for this ticker.</p>';
    }

    document.getElementById('stockHeader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('searchStock error:', err);
    const banner = document.getElementById('errorBanner');
    document.getElementById('errorMessage').textContent = err.message || 'An unexpected error occurred.';
    if (banner) banner.style.display = 'flex';
    banner?.scrollIntoView({ behavior: 'smooth' });
  } finally {
    hide('loadingOverlay');
  }
}

// ============================================================
// API Key UI
// ============================================================

function updateApiKeyStatus() {
  const status = document.getElementById('apiKeyStatus');
  if (!status) return;
  if (apiKey) {
    status.innerHTML = `Key active: <strong>${apiKey.slice(0, 6)}****</strong> — search any stock globally.`;
    status.className = 'apikey-saved';
  } else {
    status.innerHTML = 'No key set — enter your free FMP API key to search any stock.';
    status.className = '';
  }
}

// ============================================================
// Event Wiring
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');

  document.getElementById('searchBtn').addEventListener('click', () => searchStock(searchInput.value));
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchStock(searchInput.value); });

  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      searchInput.value = chip.dataset.ticker;
      searchStock(chip.dataset.ticker);
    });
  });

  // API Key
  const keyInput = document.getElementById('apiKeyInput');
  if (keyInput && apiKey) keyInput.value = apiKey;
  updateApiKeyStatus();

  document.getElementById('saveApiKey')?.addEventListener('click', () => {
    const val = (keyInput?.value || '').trim();
    apiKey = val;
    if (val) localStorage.setItem('finmetrics_apikey', val);
    else localStorage.removeItem('finmetrics_apikey');
    updateApiKeyStatus();
  });

  // Watchlist
  document.getElementById('watchlistBtn').addEventListener('click', () => {
    if (currentTicker) toggleWatchlist(currentTicker);
  });
  document.getElementById('clearWatchlist').addEventListener('click', () => {
    watchlist = [];
    localStorage.setItem('finmetrics_watchlist', '[]');
    renderWatchlistGrid();
  });

  // Error close
  document.getElementById('closeError').addEventListener('click', () => hide('errorBanner'));

  // Timeframe
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentTicker) loadChart(currentTicker, btn.dataset.range);
    });
  });

  // Financial tabs
  document.querySelectorAll('.fin-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (!fullData || !currentTicker) return;
      document.getElementById('finContent').innerHTML =
        '<p style="padding:20px;color:var(--text-muted)">Loading...</p>';
      try {
        const t = tab.dataset.tab;
        if (t === 'income')   await loadAndRenderTab(fmpIncome,   INCOME_FIELDS);
        if (t === 'balance')  await loadAndRenderTab(fmpBalance,  BALANCE_FIELDS);
        if (t === 'cashflow') await loadAndRenderTab(fmpCashflow, CASHFLOW_FIELDS);
      } catch (e) {
        document.getElementById('finContent').innerHTML =
          `<p style="padding:20px;color:var(--red)">${e.message}</p>`;
      }
    });
  });

  // Navbar scroll
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const html    = document.documentElement;
    const isLight = html.dataset.theme === 'light';
    html.dataset.theme = isLight ? 'dark' : 'light';
    document.getElementById('themeIconSun').style.display  = isLight ? '' : 'none';
    document.getElementById('themeIconMoon').style.display = isLight ? 'none' : '';
    localStorage.setItem('finmetrics_theme', html.dataset.theme);
  });

  // Restore saved theme
  const savedTheme = localStorage.getItem('finmetrics_theme');
  if (savedTheme) {
    document.documentElement.dataset.theme = savedTheme;
    if (savedTheme === 'light') {
      document.getElementById('themeIconSun').style.display  = 'none';
      document.getElementById('themeIconMoon').style.display = '';
    }
  }

  renderWatchlistGrid();
});
