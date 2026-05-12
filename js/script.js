'use strict';

// ============================================================
// Configuration
// ============================================================
const YF_BASE   = 'https://query2.finance.yahoo.com';
const CORS_PROXY = 'https://corsproxy.io/?';

let priceChart    = null;
let currentTicker = '';
let fullData      = null;
let watchlist     = JSON.parse(localStorage.getItem('finmetrics_watchlist') || '[]');

// ============================================================
// API Helpers
// ============================================================

async function apiFetch(url) {
  // Try direct first (Yahoo sometimes allows CORS)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const json = await res.json();
      if (json && !json.quoteSummary?.error && !json.chart?.error) return json;
    }
  } catch (_) { /* CORS or network — fall through */ }

  // Proxy fallback
  const proxied = CORS_PROXY + encodeURIComponent(url);
  const res = await fetch(proxied, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchQuoteSummary(ticker) {
  const modules = [
    'price',
    'summaryDetail',
    'defaultKeyStatistics',
    'financialData',
    'incomeStatementHistory',
    'balanceSheetHistory',
    'cashflowStatementHistory',
  ].join(',');

  const url = `${YF_BASE}/v10/finance/quoteSummary/${ticker}?modules=${modules}&lang=en-US&region=US`;
  const data = await apiFetch(url);

  if (data.quoteSummary?.error) {
    throw new Error(data.quoteSummary.error.description || 'Unknown error');
  }
  if (!data.quoteSummary?.result?.[0]) {
    throw new Error(`No data found for "${ticker}"`);
  }
  return data.quoteSummary.result[0];
}

async function fetchPriceHistory(ticker, range = '1y', interval = '1d') {
  const url = `${YF_BASE}/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&lang=en-US&region=US`;
  const data = await apiFetch(url);

  if (data.chart?.error) throw new Error(data.chart.error.description);
  if (!data.chart?.result?.[0]) throw new Error('No chart data');
  return data.chart.result[0];
}

// ============================================================
// Format Utilities
// ============================================================

function fmtBig(num) {
  if (num == null || isNaN(num)) return 'N/A';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(2)  + 'B';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(2)  + 'M';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(1)  + 'K';
  return sign + abs.toFixed(2);
}

function fmtCurrency(num) {
  if (num == null || isNaN(num)) return 'N/A';
  return '$' + fmtBig(num);
}

function fmtPct(num, decimals = 2) {
  if (num == null || isNaN(num)) return 'N/A';
  return (num * 100).toFixed(decimals) + '%';
}

function fmtDate(ts) {
  if (!ts) return 'N/A';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Safely extract .raw or primitive from Yahoo Finance field
function raw(obj, ...keys) {
  for (const key of keys) {
    let val = obj;
    for (const part of key.split('.')) {
      if (val == null) { val = null; break; }
      val = val[part];
    }
    if (val == null) continue;
    if (typeof val === 'object' && val.raw != null) return val.raw;
    if (typeof val !== 'object') return val;
  }
  return null;
}

// ============================================================
// DOM Helpers
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

function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = '';
}

function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ============================================================
// Render: Stock Header
// ============================================================

function renderHeader(data, ticker) {
  const p = data.price || {};
  const name      = raw(p, 'longName', 'shortName') || ticker;
  const exchange  = raw(p, 'exchangeName') || '';
  const sector    = raw(p, 'sector') || raw(data.summaryProfile, 'sector') || '';
  const price     = raw(p, 'regularMarketPrice');
  const change    = raw(p, 'regularMarketChange');
  const changePct = raw(p, 'regularMarketChangePercent');

  setText('stockName', name);
  setText('stockTickerBadge', ticker);
  setText('stockExchange', exchange);
  setText('stockSector', sector || 'Equity');
  setText('stockLogoText', ticker.slice(0, 2));

  if (price != null) {
    setText('currentPrice', '$' + price.toFixed(2));

    const up = change >= 0;
    const changeEl = document.getElementById('priceChange');
    if (changeEl) changeEl.className = 'price-change ' + (up ? 'positive' : 'negative');

    setText('changeAmount', (up ? '+' : '') + '$' + (change ?? 0).toFixed(2));

    const badge = document.getElementById('changeBadge');
    if (badge) {
      badge.textContent = (up ? '+' : '') + (changePct != null ? fmtPct(changePct) : '0.00%');
      badge.className = 'change-badge ' + (up ? 'positive' : 'negative');
    }
  }

  const marketState = raw(p, 'marketState');
  setText('priceDate', marketState === 'REGULAR' ? 'Market Open' : 'Market Closed · ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

  const wlBtn = document.getElementById('watchlistBtn');
  if (wlBtn) wlBtn.dataset.ticker = ticker;
  updateWatchlistBtn(ticker);

  show('stockHeader');
}

// ============================================================
// Render: Quick Stats
// ============================================================

function renderQuickStats(data) {
  const fd = data.financialData      || {};
  const sd = data.summaryDetail      || {};
  const ks = data.defaultKeyStatistics || {};

  setText('statMarketCap',  fmtCurrency(raw(sd, 'marketCap')));
  setText('statPE',         raw(sd, 'trailingPE') != null ? parseFloat(raw(sd, 'trailingPE')).toFixed(2) + 'x' : 'N/A');
  setText('statEPS',        raw(ks, 'trailingEps') != null ? '$' + parseFloat(raw(ks, 'trailingEps')).toFixed(2) : 'N/A');
  setText('statRevenue',    fmtCurrency(raw(fd, 'totalRevenue')));
  setText('statNetIncome',  fmtCurrency(raw(ks, 'netIncomeToCommon')));
  setText('statFCF',        fmtCurrency(raw(fd, 'freeCashflow')));
  const dy = raw(sd, 'dividendYield');
  setText('statDivYield',   dy != null ? fmtPct(dy) : 'N/A');
  const beta = raw(sd, 'beta');
  setText('statBeta',       beta != null ? parseFloat(beta).toFixed(2) : 'N/A');

  show('quickStats');
}

// ============================================================
// Render: KPI Cards
// ============================================================

function renderKPIs(data) {
  const fd = data.financialData        || {};
  const sd = data.summaryDetail        || {};
  const ks = data.defaultKeyStatistics || {};
  const pr = data.price                || {};

  // --- Valuation ---
  const pe = raw(sd, 'trailingPE');
  setText('kpiPE', pe != null ? parseFloat(pe).toFixed(2) + 'x' : 'N/A');

  const fpe = raw(sd, 'forwardPE');
  setText('kpiForwardPE', fpe != null ? parseFloat(fpe).toFixed(2) + 'x' : 'N/A');

  const peg = raw(ks, 'pegRatio');
  setText('kpiPEG', peg != null ? parseFloat(peg).toFixed(2) + 'x' : 'N/A');

  const pb = raw(ks, 'priceToBook');
  setText('kpiPB', pb != null ? parseFloat(pb).toFixed(2) + 'x' : 'N/A');

  const ps = raw(ks, 'enterpriseToRevenue');
  setText('kpiPS', ps != null ? parseFloat(ps).toFixed(2) + 'x' : 'N/A');

  const eveb = raw(ks, 'enterpriseToEbitda');
  setText('kpiEVEBITDA', eveb != null ? parseFloat(eveb).toFixed(2) + 'x' : 'N/A');

  setText('kpiEV', fmtCurrency(raw(ks, 'enterpriseValue')));

  const bv = raw(ks, 'bookValue');
  setText('kpiBookValue', bv != null ? '$' + parseFloat(bv).toFixed(2) : 'N/A');

  // --- Profitability ---
  const margin = (id, val) => {
    if (val == null) { setText(id, 'N/A'); return; }
    setColored(id, fmtPct(val), val > 0);
  };

  margin('kpiGrossMargin',   raw(fd, 'grossMargins'));
  margin('kpiOpMargin',      raw(fd, 'operatingMargins'));
  margin('kpiNetMargin',     raw(fd, 'profitMargins'));
  margin('kpiEBITDAMargin',  raw(fd, 'ebitdaMargins'));
  margin('kpiROE',           raw(fd, 'returnOnEquity'));
  margin('kpiROA',           raw(fd, 'returnOnAssets'));

  const ebitda = raw(fd, 'ebitda');
  setText('kpiEBITDA', fmtCurrency(ebitda));

  const roic = raw(fd, 'returnOnCapital');
  if (roic != null) {
    setColored('kpiROIC', fmtPct(roic), roic > 0);
  } else {
    setText('kpiROIC', 'N/A');
  }

  // --- Financial Health ---
  setText('kpiRevenue', fmtCurrency(raw(fd, 'totalRevenue')));

  const ni = raw(ks, 'netIncomeToCommon');
  if (ni != null) { setColored('kpiNetIncome', fmtCurrency(ni), ni > 0); } else { setText('kpiNetIncome', 'N/A'); }

  setText('kpiTotalCash', fmtCurrency(raw(fd, 'totalCash')));
  setText('kpiTotalDebt', fmtCurrency(raw(fd, 'totalDebt')));

  const de = raw(fd, 'debtToEquity');
  setText('kpiDebtEquity', de != null ? (de / 100).toFixed(2) + 'x' : 'N/A');

  const cr = raw(fd, 'currentRatio');
  setText('kpiCurrentRatio', cr != null ? parseFloat(cr).toFixed(2) + 'x' : 'N/A');

  const qr = raw(fd, 'quickRatio');
  setText('kpiQuickRatio', qr != null ? parseFloat(qr).toFixed(2) + 'x' : 'N/A');

  const fcf = raw(fd, 'freeCashflow');
  if (fcf != null) { setColored('kpiFCF', fmtCurrency(fcf), fcf > 0); } else { setText('kpiFCF', 'N/A'); }

  // --- Growth & Dividends ---
  const growth = (id, val) => {
    if (val == null) { setText(id, 'N/A'); return; }
    setColored(id, (val > 0 ? '+' : '') + fmtPct(val), val > 0);
  };

  growth('kpiRevenueGrowth',  raw(fd, 'revenueGrowth'));
  growth('kpiEarningsGrowth', raw(fd, 'earningsGrowth'));

  const eps = raw(ks, 'trailingEps');
  setText('kpiEPS', eps != null ? '$' + parseFloat(eps).toFixed(2) : 'N/A');

  const fwEPS = raw(ks, 'forwardEps');
  setText('kpiForwardEPS', fwEPS != null ? '$' + parseFloat(fwEPS).toFixed(2) : 'N/A');

  const dy = raw(sd, 'dividendYield');
  setText('kpiDivYield', dy != null ? fmtPct(dy) : 'N/A');

  const dr = raw(sd, 'dividendRate');
  setText('kpiDivRate', dr != null ? '$' + parseFloat(dr).toFixed(2) : 'N/A');

  const payout = raw(sd, 'payoutRatio');
  setText('kpiPayoutRatio', payout != null ? fmtPct(payout) : 'N/A');

  setText('kpiExDivDate', fmtDate(raw(sd, 'exDividendDate')));

  // --- Market Data ---
  const h52 = raw(sd, 'fiftyTwoWeekHigh');
  const l52 = raw(sd, 'fiftyTwoWeekLow');
  setText('kpi52High', h52 != null ? '$' + parseFloat(h52).toFixed(2) : 'N/A');
  setText('kpi52Low',  l52 != null ? '$' + parseFloat(l52).toFixed(2) : 'N/A');

  const ma50  = raw(sd, 'fiftyDayAverage');
  const ma200 = raw(sd, 'twoHundredDayAverage');
  setText('kpi50MA',  ma50  != null ? '$' + parseFloat(ma50).toFixed(2)  : 'N/A');
  setText('kpi200MA', ma200 != null ? '$' + parseFloat(ma200).toFixed(2) : 'N/A');

  setText('kpiVolume',    fmtBig(raw(pr, 'regularMarketVolume')));
  setText('kpiAvgVolume', fmtBig(raw(sd, 'averageVolume10days')));
  setText('kpiShares',    fmtBig(raw(ks, 'sharesOutstanding')));
  setText('kpiFloat',     fmtBig(raw(ks, 'floatShares')));

  // --- Analyst ---
  const curPrice   = raw(pr, 'regularMarketPrice');
  const targetMean = raw(fd, 'targetMeanPrice');
  const targetHigh = raw(fd, 'targetHighPrice');
  const targetLow  = raw(fd, 'targetLowPrice');
  const recKey     = raw(fd, 'recommendationKey') || '';
  const rating     = raw(fd, 'recommendationMean');
  const numAn      = raw(fd, 'numberOfAnalystOpinions');
  const shortRatio = raw(ks, 'shortRatio');

  const recDisplay = recKey
    ? recKey.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'N/A';

  const recEl = document.getElementById('kpiRecommendation');
  if (recEl) {
    recEl.textContent = recDisplay;
    const isBuy  = recKey.includes('buy');
    const isSell = recKey.includes('sell');
    recEl.className = 'kpi-value' + (isBuy ? ' positive' : isSell ? ' negative' : '');
  }

  setText('kpiRating',      rating != null ? parseFloat(rating).toFixed(1) + ' / 5' : 'N/A');
  setText('kpiTargetPrice', targetMean != null ? '$' + parseFloat(targetMean).toFixed(2) : 'N/A');
  setText('kpiTargetHigh',  targetHigh != null ? '$' + parseFloat(targetHigh).toFixed(2) : 'N/A');
  setText('kpiTargetLow',   targetLow  != null ? '$' + parseFloat(targetLow).toFixed(2)  : 'N/A');
  setText('kpiAnalystCount', numAn != null ? numAn.toString() : 'N/A');
  setText('kpiShortRatio',  shortRatio != null ? parseFloat(shortRatio).toFixed(2) : 'N/A');

  if (targetMean != null && curPrice != null) {
    const upside = (targetMean - curPrice) / curPrice;
    setColored('kpiUpside', (upside > 0 ? '+' : '') + fmtPct(upside), upside > 0);
  } else {
    setText('kpiUpside', 'N/A');
  }

  show('kpis');
}

// ============================================================
// Render: Financial Statements
// ============================================================

function renderFinancials(data) {
  fullData = data;
  renderIncomeTable(data.incomeStatementHistory?.incomeStatementHistory || []);
  show('financials');
}

function buildFinTable(fields, statements) {
  if (!statements.length) return '<p class="no-data">No data available.</p>';
  const years = statements.slice(0, 4).reverse();
  const head = years.map(s => {
    const ts = s.endDate?.raw ?? s.endDate;
    return `<th>${ts ? new Date(ts * 1000).getFullYear() : '—'}</th>`;
  }).join('');

  const rows = fields.map(f => {
    const cells = years.map(s => {
      const val = s[f.key]?.raw ?? s[f.key];
      if (val == null) return '<td class="fin-value">N/A</td>';
      const cls = f.colored ? (val > 0 ? ' positive' : val < 0 ? ' negative' : '') : '';
      return `<td class="fin-value${cls}">${fmtCurrency(val)}</td>`;
    }).join('');
    return `<tr><td class="fin-label">${f.label}</td>${cells}</tr>`;
  }).join('');

  return `<div class="fin-table-wrapper">
    <table class="fin-table">
      <thead><tr><th>Metric</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderIncomeTable(statements) {
  const fields = [
    { key: 'totalRevenue',            label: 'Total Revenue' },
    { key: 'grossProfit',             label: 'Gross Profit',       colored: true },
    { key: 'totalOperatingExpenses',  label: 'Operating Expenses', colored: false },
    { key: 'ebit',                    label: 'EBIT',               colored: true },
    { key: 'netIncome',               label: 'Net Income',         colored: true },
    { key: 'researchDevelopment',     label: 'R&D Expenses' },
  ];
  document.getElementById('finContent').innerHTML = buildFinTable(fields, statements);
}

function renderBalanceTable(statements) {
  const fields = [
    { key: 'totalAssets',             label: 'Total Assets' },
    { key: 'totalCurrentAssets',      label: 'Current Assets' },
    { key: 'cash',                    label: 'Cash & Equivalents' },
    { key: 'totalLiab',              label: 'Total Liabilities' },
    { key: 'totalCurrentLiabilities', label: 'Current Liabilities' },
    { key: 'longTermDebt',           label: 'Long-Term Debt' },
    { key: 'totalStockholderEquity', label: "Stockholders' Equity", colored: true },
  ];
  document.getElementById('finContent').innerHTML = buildFinTable(fields, statements);
}

function renderCashFlowTable(statements) {
  const processed = statements.map(s => {
    const cfo   = s.totalCashFromOperatingActivities?.raw ?? s.totalCashFromOperatingActivities ?? 0;
    const capex = s.capitalExpenditures?.raw ?? s.capitalExpenditures ?? 0;
    return { ...s, freeCashFlow: { raw: cfo + capex } }; // capex is negative in YF
  });

  const fields = [
    { key: 'totalCashFromOperatingActivities', label: 'Operating Cash Flow', colored: true },
    { key: 'capitalExpenditures',              label: 'Capital Expenditures' },
    { key: 'freeCashFlow',                     label: 'Free Cash Flow',      colored: true },
    { key: 'totalCashFromInvestingActivities', label: 'Investing Activities' },
    { key: 'totalCashFromFinancingActivities', label: 'Financing Activities' },
    { key: 'dividendsPaid',                   label: 'Dividends Paid' },
  ];
  document.getElementById('finContent').innerHTML = buildFinTable(fields, processed);
}

// ============================================================
// Render: Price Chart
// ============================================================

function renderChart(chartData) {
  const timestamps = chartData.timestamp || [];
  const closes     = chartData.indicators?.quote?.[0]?.close || [];

  const labels = timestamps.map(ts =>
    new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const prices = closes.map(v => v != null ? +v.toFixed(2) : null);

  if (priceChart) { priceChart.destroy(); priceChart = null; }

  const isUp = prices.length >= 2 && (prices[prices.length - 1] ?? 0) >= (prices[0] ?? 0);
  const lineColor = isUp ? '#10b981' : '#ef4444';

  const ctx = document.getElementById('priceChart').getContext('2d');
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
          callbacks: {
            label: ctx => ' $' + (ctx.parsed.y?.toFixed(2) ?? '—'),
          },
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
          ticks: {
            color: '#8892a4',
            font: { size: 11 },
            callback: v => '$' + v.toFixed(0),
          },
        },
      },
    },
  });
}

async function loadChart(ticker, range, interval) {
  try {
    const chartData = await fetchPriceHistory(ticker, range, interval);
    renderChart(chartData);
  } catch (e) {
    console.warn('Chart load failed:', e.message);
  }
}

// ============================================================
// Watchlist
// ============================================================

function updateWatchlistBtn(ticker) {
  const btn = document.getElementById('watchlistBtn');
  if (!btn) return;
  const inList = watchlist.includes(ticker);
  btn.innerHTML = inList
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> In Watchlist`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Add to Watchlist`;
  btn.classList.toggle('active', inList);
}

function toggleWatchlist(ticker) {
  const idx = watchlist.indexOf(ticker);
  if (idx === -1) watchlist.push(ticker);
  else watchlist.splice(idx, 1);
  localStorage.setItem('finmetrics_watchlist', JSON.stringify(watchlist));
  updateWatchlistBtn(ticker);
  renderWatchlistGrid();
}

function renderWatchlistGrid() {
  const grid  = document.getElementById('watchlistGrid');
  const empty = document.getElementById('watchlistEmpty');

  grid.querySelectorAll('.watchlist-item').forEach(el => el.remove());

  if (!watchlist.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  watchlist.forEach(ticker => {
    const item = document.createElement('div');
    item.className = 'watchlist-item';
    item.innerHTML = `
      <span class="watchlist-ticker">${ticker}</span>
      <button class="watchlist-remove" title="Remove">×</button>
    `;
    item.querySelector('.watchlist-ticker').addEventListener('click', () => searchStock(ticker));
    item.querySelector('.watchlist-remove').addEventListener('click', e => {
      e.stopPropagation();
      toggleWatchlist(ticker);
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

  currentTicker = ticker;

  show('loadingOverlay');
  hide('errorBanner');
  hide('stockHeader');
  hide('chartSection');
  hide('quickStats');
  hide('kpis');
  hide('financials');

  try {
    const [summaryData, chartData] = await Promise.allSettled([
      fetchQuoteSummary(ticker),
      fetchPriceHistory(ticker, '1y', '1d'),
    ]);

    if (summaryData.status === 'rejected') {
      throw summaryData.reason;
    }

    const data = summaryData.value;

    renderHeader(data, ticker);
    renderQuickStats(data);
    renderKPIs(data);
    renderFinancials(data);

    if (chartData.status === 'fulfilled') {
      renderChart(chartData.value);
      show('chartSection');
    }

    document.getElementById('stockHeader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('searchStock error:', err);
    const banner = document.getElementById('errorBanner');
    document.getElementById('errorMessage').textContent =
      `Could not fetch data for "${ticker}". ${err.message || 'Please check the ticker and try again.'}`;
    if (banner) banner.style.display = 'flex';
    banner?.scrollIntoView({ behavior: 'smooth' });
  } finally {
    hide('loadingOverlay');
  }
}

// ============================================================
// Event Wiring
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchBtn   = document.getElementById('searchBtn');

  searchBtn.addEventListener('click', () => searchStock(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchStock(searchInput.value);
  });

  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      searchInput.value = chip.dataset.ticker;
      searchStock(chip.dataset.ticker);
    });
  });

  document.getElementById('watchlistBtn').addEventListener('click', () => {
    if (currentTicker) toggleWatchlist(currentTicker);
  });

  document.getElementById('clearWatchlist').addEventListener('click', () => {
    watchlist = [];
    localStorage.setItem('finmetrics_watchlist', JSON.stringify(watchlist));
    renderWatchlistGrid();
  });

  document.getElementById('closeError').addEventListener('click', () => hide('errorBanner'));

  // Timeframe buttons
  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentTicker) loadChart(currentTicker, btn.dataset.range, btn.dataset.interval);
    });
  });

  // Financial statement tabs
  document.querySelectorAll('.fin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      if (!fullData) return;
      const t = tab.dataset.tab;
      if (t === 'income')   renderIncomeTable(fullData.incomeStatementHistory?.incomeStatementHistory || []);
      if (t === 'balance')  renderBalanceTable(fullData.balanceSheetHistory?.balanceSheetStatements || []);
      if (t === 'cashflow') renderCashFlowTable(fullData.cashflowStatementHistory?.cashflowStatements || []);
    });
  });

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Hamburger menu
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
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
