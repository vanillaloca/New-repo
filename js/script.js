'use strict';

// ============================================================
// Config — Finnhub API (free: 60 req/min, global stocks)
// ============================================================
const FH_BASE = 'https://finnhub.io/api/v1';

let currentTicker = '';
let fullData      = null;
let priceChart    = null;
let watchlist     = JSON.parse(localStorage.getItem('finmetrics_watchlist') || '[]');
let apiKey        = localStorage.getItem('finmetrics_apikey') || '';

// ============================================================
// API
// ============================================================

async function fhFetch(endpoint, params = {}) {
  if (!apiKey) throw new Error('Enter your free Finnhub API key above to get started.');

  const url = new URL(FH_BASE + endpoint);
  url.searchParams.set('token', apiKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (res.status === 401) throw new Error('Invalid API key. Get your free key at finnhub.io and enter it above.');
  if (res.status === 403) throw new Error('Access denied. This data may require a higher Finnhub plan.');
  if (res.status === 429) throw new Error('Rate limit hit (60/min on free plan). Wait a moment and try again.');
  if (!res.ok) throw new Error(`API error: HTTP ${res.status}`);
  return res.json();
}

const fhProfile    = t         => fhFetch('/stock/profile2',       { symbol: t });
const fhQuote      = t         => fhFetch('/quote',                { symbol: t });
const fhMetrics    = t         => fhFetch('/stock/metric',         { symbol: t, metric: 'all' });
const fhRecs       = t         => fhFetch('/stock/recommendation', { symbol: t });
const fhTargets    = t         => fhFetch('/stock/price-target',   { symbol: t });
const fhCandle     = (t,r,f,to)=> fhFetch('/stock/candle',         { symbol: t, resolution: r, from: f, to });
const fhFinancials = (t, stmt) => fhFetch('/stock/financials',     { symbol: t, statement: stmt, freq: 'annual' });

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

function fmtMillions(v)  { return fmtCurrency(parseFloat(v) * 1e6); }
function fmtCurrency(v)  { const s = fmtBig(v); return s === 'N/A' ? 'N/A' : '$' + s; }
function fmtPrice(v)     { const n = parseFloat(v); return (v == null || isNaN(n)) ? 'N/A' : '$' + n.toFixed(2); }
function fmtRatio(v, d=2){ const n = parseFloat(v); return (v == null || isNaN(n)) ? 'N/A' : n.toFixed(d) + 'x'; }

function fmtPctDirect(v, d=2) {
  const n = parseFloat(v);
  return (v == null || isNaN(n)) ? 'N/A' : n.toFixed(d) + '%';
}

function fmtPctDecimal(v, d=2) {
  const n = parseFloat(v);
  return (v == null || isNaN(n)) ? 'N/A' : (n * 100).toFixed(d) + '%';
}

function fmtDate(v) {
  if (!v) return 'N/A';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  const price  = parseFloat(quote.c);
  const change = parseFloat(quote.d);
  const pct    = parseFloat(quote.dp);
  const isUp   = change >= 0;

  setText('stockName',        profile.name || ticker);
  setText('stockTickerBadge', ticker);
  setText('stockExchange',    profile.exchange || '');
  setText('stockSector',      profile.finnhubIndustry || 'Equity');

  const logoContainer = document.getElementById('stockLogo');
  if (logoContainer) {
    if (profile.logo) {
      logoContainer.innerHTML = `<img src="${profile.logo}" alt="${ticker}"
        style="width:36px;height:36px;object-fit:contain;border-radius:6px;"
        onerror="this.outerHTML='<span id=stockLogoText>${ticker.slice(0,2)}</span>'" />`;
    } else {
      logoContainer.innerHTML = `<span id="stockLogoText">${ticker.slice(0, 2)}</span>`;
    }
  }

  setText('currentPrice', isNaN(price) ? 'N/A' : '$' + price.toFixed(2));

  const changeEl = document.getElementById('priceChange');
  if (changeEl) changeEl.className = 'price-change ' + (isUp ? 'positive' : 'negative');

  setText('changeAmount', (isUp ? '+' : '') + (isNaN(change) ? '0.00' : '$' + change.toFixed(2)));

  const badge = document.getElementById('changeBadge');
  if (badge) {
    badge.textContent = (isUp ? '+' : '') + (isNaN(pct) ? '0.00' : pct.toFixed(2)) + '%';
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

function renderQuickStats(profile, quote, metrics) {
  const m      = metrics.metric || {};
  const shares = parseFloat(profile.shareOutstanding);

  setText('statMarketCap', fmtMillions(profile.marketCapitalization));
  setText('statPE',        fmtRatio(m.peBasicExclExtraTTM || m.peNormalizedAnnual));
  setText('statEPS',       fmtPrice(m.epsNormalizedAnnual || m.epsAnnual));

  const rev = parseFloat(m.revenuePerShareAnnual) * shares * 1e6;
  setText('statRevenue',   isNaN(rev) ? 'N/A' : fmtCurrency(rev));

  const ni = parseFloat(m.epsAnnual) * shares * 1e6;
  setText('statNetIncome', isNaN(ni) ? 'N/A' : fmtCurrency(ni));

  const fcf = parseFloat(m.pfcfShareAnnual || m.cashFlowPerShareAnnual) * shares * 1e6;
  setText('statFCF', isNaN(fcf) ? 'N/A' : fmtCurrency(fcf));

  setText('statDivYield', m.dividendYieldIndicatedAnnual != null
    ? fmtPctDirect(m.dividendYieldIndicatedAnnual) : 'N/A');
  setText('statBeta', m.beta != null ? parseFloat(m.beta).toFixed(2) : 'N/A');

  show('quickStats');
}

// ============================================================
// Render: KPI Cards
// ============================================================

function renderKPIs(profile, quote, metrics, recs, targets) {
  const m        = metrics.metric || {};
  const shares   = parseFloat(profile.shareOutstanding);
  const curPrice = parseFloat(quote.c);

  setText('kpiPE',        fmtRatio(m.peBasicExclExtraTTM || m.peNormalizedAnnual));
  setText('kpiForwardPE', 'N/A');
  setText('kpiPEG',       'N/A');
  setText('kpiPB',        fmtRatio(m.ptbvAnnual || m.ptbvQuarterly));
  setText('kpiPS',        fmtRatio(m.psTTM || m.psAnnual));
  setText('kpiEVEBITDA',  'N/A');
  setText('kpiEV',        fmtMillions(profile.marketCapitalization));
  setText('kpiBookValue', fmtPrice(m.bookValuePerShareAnnual || m.bookValuePerShareQuarterly));

  const setMargin = (id, val) => {
    const n = parseFloat(val);
    if (val == null || isNaN(n)) { setText(id, 'N/A'); return; }
    setColored(id, n.toFixed(2) + '%', n > 0);
  };

  setMargin('kpiGrossMargin',   m.grossMarginTTM    || m.grossMarginAnnual);
  setMargin('kpiOpMargin',      m.operatingMarginTTM|| m.operatingMarginAnnual);
  setMargin('kpiNetMargin',     m.netProfitMarginTTM|| m.netProfitMarginAnnual);
  setMargin('kpiEBITDAMargin',  m.ebitdaMarginAnnual);
  setMargin('kpiROE',           m.roeTTM   || m.roeRfy);
  setMargin('kpiROA',           m.roaTTM   || m.roaRfy);
  setMargin('kpiROIC',          m.roiTTM   || m.roicRfy);
  setText('kpiEBITDA', 'N/A');

  const rev = parseFloat(m.revenuePerShareAnnual) * shares * 1e6;
  setText('kpiRevenue', isNaN(rev) ? 'N/A' : fmtCurrency(rev));

  const ni = parseFloat(m.epsAnnual) * shares * 1e6;
  if (!isNaN(ni)) setColored('kpiNetIncome', fmtCurrency(ni), ni > 0);
  else setText('kpiNetIncome', 'N/A');

  setText('kpiTotalCash', 'N/A');

  const debt = parseFloat(m.totalDebtAnnual || m.totalDebtMRQ);
  setText('kpiTotalDebt', isNaN(debt) ? 'N/A' : fmtCurrency(debt));

  const de = parseFloat(m['totalDebt/totalEquityAnnual'] || m['totalDebt/totalEquityQuarterly']);
  setText('kpiDebtEquity', isNaN(de) ? 'N/A' : (de / 100).toFixed(2) + 'x');

  const cr = parseFloat(m.currentRatioAnnual || m.currentRatioQuarterly);
  setText('kpiCurrentRatio', isNaN(cr) ? 'N/A' : cr.toFixed(2) + 'x');

  const qr = parseFloat(m.quickRatioAnnual || m.quickRatioQuarterly);
  setText('kpiQuickRatio', isNaN(qr) ? 'N/A' : qr.toFixed(2) + 'x');

  const fcf = parseFloat(m.pfcfShareAnnual || m.cashFlowPerShareAnnual) * shares * 1e6;
  if (!isNaN(fcf)) setColored('kpiFCF', fmtCurrency(fcf), fcf > 0);
  else setText('kpiFCF', 'N/A');

  const revG = parseFloat(m.revenueGrowthTTMYoy || m.revenueGrowthQuarterlyYoy);
  const epsG = parseFloat(m.epsGrowthTTMYoy     || m.epsGrowthQuarterlyYoy);

  if (!isNaN(revG)) setColored('kpiRevenueGrowth',  (revG > 0 ? '+' : '') + fmtPctDecimal(revG), revG > 0);
  else setText('kpiRevenueGrowth', 'N/A');

  if (!isNaN(epsG)) setColored('kpiEarningsGrowth', (epsG > 0 ? '+' : '') + fmtPctDecimal(epsG), epsG > 0);
  else setText('kpiEarningsGrowth', 'N/A');

  setText('kpiEPS',        fmtPrice(m.epsAnnual || m.epsNormalizedAnnual));
  setText('kpiForwardEPS', 'N/A');
  setText('kpiDivYield',   m.dividendYieldIndicatedAnnual != null
    ? fmtPctDirect(m.dividendYieldIndicatedAnnual) : 'N/A');
  setText('kpiDivRate',    fmtPrice(m.dividendPerShareAnnual));
  setText('kpiPayoutRatio', m.payoutRatioAnnual != null ? fmtPctDirect(m.payoutRatioAnnual) : 'N/A');
  setText('kpiExDivDate',  'N/A');

  setText('kpi52High',    fmtPrice(m['52WeekHigh']));
  setText('kpi52Low',     fmtPrice(m['52WeekLow']));
  setText('kpi50MA',      'N/A');
  setText('kpi200MA',     'N/A');
  setText('kpiVolume',    fmtBig(parseFloat(quote.v)));
  setText('kpiAvgVolume', m['10DayAverageTradingVolume'] != null
    ? fmtBig(parseFloat(m['10DayAverageTradingVolume']) * 1e6) : 'N/A');
  setText('kpiShares',    fmtBig(shares * 1e6));
  setText('kpiFloat',     'N/A');

  const latestRec = Array.isArray(recs) && recs.length ? recs[0] : null;
  if (latestRec) {
    const sb    = latestRec.strongBuy  || 0;
    const b     = latestRec.buy        || 0;
    const h     = latestRec.hold       || 0;
    const s     = latestRec.sell       || 0;
    const ss    = latestRec.strongSell || 0;
    const total = sb + b + h + s + ss;
    const buyPct = total ? (sb + b) / total : 0;

    let rec = 'Hold';
    if (buyPct > 0.6) rec = buyPct > 0.8 ? 'Strong Buy' : 'Buy';
    if ((s + ss) / total > 0.4) rec = 'Sell';

    const recEl = document.getElementById('kpiRecommendation');
    if (recEl) {
      recEl.textContent = rec;
      recEl.className   = 'kpi-value' + (rec.includes('Buy') ? ' positive' : rec.includes('Sell') ? ' negative' : '');
    }
    setText('kpiRating',       `${sb + b} Buy · ${h} Hold · ${s + ss} Sell`);
    setText('kpiAnalystCount', total.toString());
  } else {
    setText('kpiRecommendation', 'N/A');
    setText('kpiRating',         'N/A');
    setText('kpiAnalystCount',   'N/A');
  }

  if (targets?.targetMean) {
    const mean   = parseFloat(targets.targetMean);
    const upside = (mean - curPrice) / curPrice;
    setText('kpiTargetPrice', fmtPrice(mean));
    setText('kpiTargetHigh',  fmtPrice(targets.targetHigh));
    setText('kpiTargetLow',   fmtPrice(targets.targetLow));
    setColored('kpiUpside', (upside > 0 ? '+' : '') + fmtPctDecimal(upside), upside > 0);
  } else {
    ['kpiTargetPrice', 'kpiTargetHigh', 'kpiTargetLow', 'kpiUpside'].forEach(id => setText(id, 'N/A'));
  }
  setText('kpiShortRatio', 'N/A');

  show('kpis');
}

// ============================================================
// Render: Price Chart
// ============================================================

function renderChart(candle) {
  if (candle.s !== 'ok' || !candle.t?.length) return;

  const labels = candle.t.map(ts =>
    new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const prices = candle.c.map(v => v != null ? +parseFloat(v).toFixed(2) : null);

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

const TF_MAP = {
  '5d':  ['30', 5],
  '1mo': ['D',  30],
  '3mo': ['D',  90],
  '6mo': ['D',  180],
  '1y':  ['D',  365],
  '5y':  ['W',  5 * 365],
};

async function loadChart(ticker, range) {
  const [resolution, days] = TF_MAP[range] || ['D', 365];
  const to   = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 60 * 60;
  try {
    const candle = await fhCandle(ticker, resolution, from, to);
    renderChart(candle);
  } catch (e) {
    console.warn('Chart error:', e.message);
  }
}

// ============================================================
// Render: Financial Statements
// ============================================================

function buildFinTable(fields, reports) {
  if (!reports?.length) {
    return '<p style="padding:20px;color:var(--text-muted)">No annual data available for this ticker.</p>';
  }
  const years = reports.slice(0, 4).reverse();
  const head  = years.map(r => `<th>${(r.period || '').slice(0, 4)}</th>`).join('');
  const rows  = fields.map(f => {
    const cells = years.map(r => {
      const v = r[f.key];
      if (v == null || v === '') return '<td class="fin-value">N/A</td>';
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

async function loadAndRenderTab(stmt, fields) {
  if (!fullData.financials) fullData.financials = {};
  if (!fullData.financials[stmt]) {
    const res = await fhFinancials(currentTicker, stmt);
    fullData.financials[stmt] = res?.financials || [];
  }
  document.getElementById('finContent').innerHTML = buildFinTable(fields, fullData.financials[stmt]);
}

const INCOME_FIELDS = [
  { key: 'totalRevenue',        label: 'Total Revenue' },
  { key: 'grossProfit',         label: 'Gross Profit',     colored: true },
  { key: 'operatingIncome',     label: 'Operating Income', colored: true },
  { key: 'netIncome',           label: 'Net Income',       colored: true },
  { key: 'ebitda',              label: 'EBITDA',           colored: true },
  { key: 'researchDevelopment', label: 'R&D Expenses' },
];
const BALANCE_FIELDS = [
  { key: 'totalAssets',             label: 'Total Assets' },
  { key: 'totalCurrentAssets',      label: 'Current Assets' },
  { key: 'cash',                    label: 'Cash & Equivalents' },
  { key: 'totalLiab',              label: 'Total Liabilities' },
  { key: 'totalCurrentLiabilities', label: 'Current Liabilities' },
  { key: 'longTermDebt',           label: 'Long-Term Debt' },
  { key: 'totalStockholderEquity', label: "Stockholders' Equity", colored: true },
];
const CASHFLOW_FIELDS = [
  { key: 'totalCashFromOperatingActivities', label: 'Operating Cash Flow', colored: true },
  { key: 'capitalExpenditures',              label: 'Capital Expenditures' },
  { key: 'totalCashFromInvestingActivities', label: 'Investing Activities' },
  { key: 'totalCashFromFinancingActivities', label: 'Financing Activities' },
  { key: 'dividendsPaid',                   label: 'Dividends Paid' },
];

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
      'Please enter your free Finnhub API key above. Register at finnhub.io — takes 30 seconds, no credit card.';
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
    const now  = Math.floor(Date.now() / 1000);
    const from = now - 365 * 24 * 60 * 60;

    const [profile, quote, metrics, recs, targets, candle] = await Promise.all([
      fhProfile(ticker),
      fhQuote(ticker),
      fhMetrics(ticker),
      fhRecs(ticker).catch(() => []),
      fhTargets(ticker).catch(() => ({})),
      fhCandle(ticker, 'D', from, now).catch(() => ({ s: 'no_data' })),
    ]);

    if (!profile.name && !profile.ticker) {
      throw new Error(`"${ticker}" not found. Please check the ticker symbol.`);
    }

    fullData = { profile, quote, metrics, recs, targets };

    renderHeader(profile, quote, ticker);
    renderQuickStats(profile, quote, metrics);
    renderKPIs(profile, quote, metrics, recs, targets);

    if (candle.s === 'ok') { renderChart(candle); show('chartSection'); }

    show('financials');
    document.getElementById('finContent').innerHTML =
      '<p style="padding:20px;color:var(--text-muted)">Loading...</p>';
    try {
      await loadAndRenderTab('ic', INCOME_FIELDS);
    } catch (_) {
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
    status.innerHTML = 'No key set — enter your free Finnhub key to search any stock.';
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

  document.getElementById('watchlistBtn').addEventListener('click', () => {
    if (currentTicker) toggleWatchlist(currentTicker);
  });
  document.getElementById('clearWatchlist').addEventListener('click', () => {
    watchlist = [];
    localStorage.setItem('finmetrics_watchlist', '[]');
    renderWatchlistGrid();
  });

  document.getElementById('closeError').addEventListener('click', () => hide('errorBanner'));

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentTicker) loadChart(currentTicker, btn.dataset.range);
    });
  });

  document.querySelectorAll('.fin-tab').forEach(tab => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (!fullData || !currentTicker) return;
      document.getElementById('finContent').innerHTML =
        '<p style="padding:20px;color:var(--text-muted)">Loading...</p>';
      try {
        const t = tab.dataset.tab;
        if (t === 'income')   await loadAndRenderTab('ic', INCOME_FIELDS);
        if (t === 'balance')  await loadAndRenderTab('bs', BALANCE_FIELDS);
        if (t === 'cashflow') await loadAndRenderTab('cf', CASHFLOW_FIELDS);
      } catch (e) {
        document.getElementById('finContent').innerHTML =
          `<p style="padding:20px;color:var(--red)">${e.message}</p>`;
      }
    });
  });

  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });

  document.getElementById('themeToggle').addEventListener('click', () => {
    const html    = document.documentElement;
    const isLight = html.dataset.theme === 'light';
    html.dataset.theme = isLight ? 'dark' : 'light';
    document.getElementById('themeIconSun').style.display  = isLight ? '' : 'none';
    document.getElementById('themeIconMoon').style.display = isLight ? 'none' : '';
    localStorage.setItem('finmetrics_theme', html.dataset.theme);
  });

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
