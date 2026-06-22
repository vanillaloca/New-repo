'use strict';

// ============================================================
// Config — Financial Modeling Prep (FMP) API
// ============================================================
const FMP_BASE = 'https://financialmodelingprep.com/api';

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
  if (res.status === 401 || res.status === 403) throw new Error('Invalid API key. Get your free key at financialmodelingprep.com and enter it above.');
  if (res.status === 429) throw new Error('Rate limit hit. Wait a moment and try again.');
  if (!res.ok) throw new Error(`API error: HTTP ${res.status}`);
  const data = await res.json();
  if (data?.['Error Message']) throw new Error(data['Error Message']);
  return data;
}

const fmpProfile   = t => fmpFetch(`/v3/profile/${t}`);
const fmpQuote     = t => fmpFetch(`/v3/quote/${t}`);
const fmpMetrics   = t => fmpFetch(`/v3/key-metrics-ttm/${t}`);
const fmpRatios    = t => fmpFetch(`/v3/ratios-ttm/${t}`);
const fmpRecs      = t => fmpFetch(`/v3/analyst-stock-recommendations/${t}`);
const fmpTargets   = t => fmpFetch(`/v3/price-target/${t}`); 
const fmpIncome    = t => fmpFetch(`/v3/income-statement/${t}`, { limit: 4 });
const fmpBalance   = t => fmpFetch(`/v3/balance-sheet-statement/${t}`, { limit: 4 });
const fmpCashflow  = t => fmpFetch(`/v3/cash-flow-statement/${t}`, { limit: 4 });
const fmpHistory   = (t, days) => fmpFetch(`/v3/historical-price-full/${t}`, { timeseries: days, serietype: 'line' });

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
  const price  = parseFloat(quote.price);
  const change = parseFloat(quote.change);
  const pct    = parseFloat(quote.changesPercentage);
  const isUp   = change >= 0;

  setText('stockName',        profile.companyName || ticker);
  setText('stockTickerBadge', ticker);
  setText('stockExchange',    profile.exchangeShortName || profile.exchange || '');
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

  setText('currentPrice', isNaN(price) ? 'N/A' : '$' + price.toFixed(2));

  const changeEl = document.getElementById('priceChange');
  if (changeEl) changeEl.className = 'price-change ' + (isUp ? 'positive' : 'negative');

  setText('changeAmount', (isUp ? '+' : '') + (isNaN(change) ? '0.00' : '$' + Math.abs(change).toFixed(2)));

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

function renderQuickStats(profile, quote, metrics, income) {
  const latestIncome = Array.isArray(income) && income.length ? income[0] : {};

  setText('statMarketCap', fmtCurrency(profile.mktCap));
  setText('statPE',        fmtRatio(quote.pe));
  setText('statEPS',       fmtPrice(quote.eps));
  setText('statRevenue',   fmtCurrency(latestIncome.revenue));
  setText('statNetIncome', fmtCurrency(latestIncome.netIncome));
  setText('statFCF',       fmtCurrency(latestIncome.operatingCashflow || latestIncome.freeCashFlow));
  setText('statDivYield', profile.lastDiv > 0 && profile.price > 0
    ? fmtPctDirect((profile.lastDiv / profile.price) * 100) : 'N/A');
  setText('statBeta', profile.beta != null ? parseFloat(profile.beta).toFixed(2) : 'N/A');

  show('quickStats');
}

// ============================================================
// Render: KPI Cards
// ============================================================

function renderKPIs(profile, quote, metrics, ratios, recs, targets, balance, income, cashflow) {
  const m  = Array.isArray(metrics) && metrics.length ? metrics[0] : {};
  const r  = Array.isArray(ratios)  && ratios.length  ? ratios[0]  : {};
  const b  = Array.isArray(balance) && balance.length ? balance[0] : {};
  const ic = Array.isArray(income)  && income.length  ? income[0]  : {};
  const cf = Array.isArray(cashflow)&& cashflow.length? cashflow[0]: {};
  const curPrice = parseFloat(quote.price);

  // -- Valuation --
  setText('kpiPE',        fmtRatio(quote.pe || m.peRatioTTM));
  setText('kpiForwardPE', fmtRatio(m.forwardPE || r.forwardPE || (curPrice && quote.eps ? curPrice / parseFloat(quote.eps) : null)));
  setText('kpiPEG',       fmtRatio(m.pegRatioTTM));
  setText('kpiPB',        fmtRatio(m.pbRatioTTM || r.priceToBookRatioTTM));
  setText('kpiPS',        fmtRatio(m.priceToSalesRatioTTM || r.priceToSalesRatioTTM));
  setText('kpiEVEBITDA',  fmtRatio(m.evToEbitdaTTM || r.enterpriseValueMultipleTTM));
  setText('kpiEV',        fmtCurrency(m.enterpriseValueTTM));
  setText('kpiBookValue', fmtPrice(m.bookValuePerShareTTM));

  // -- Profitability --
  const setMargin = (id, val, isDecimal=true) => {
    const n = parseFloat(val);
    if (val == null || isNaN(n)) { setText(id, 'N/A'); return; }
    const pct = isDecimal ? n * 100 : n;
    setColored(id, pct.toFixed(2) + '%', pct > 0);
  };

  setMargin('kpiGrossMargin',  m.grossProfitMarginTTM  || r.grossProfitMarginTTM);
  setMargin('kpiOpMargin',     m.operatingProfitMarginTTM || r.operatingProfitMarginTTM);
  setMargin('kpiNetMargin',    m.netProfitMarginTTM    || r.netProfitMarginTTM);

  setText('kpiEBITDA', fmtCurrency(ic.ebitda));
  if (ic.ebitda && ic.revenue && parseFloat(ic.revenue) !== 0) {
    const ebMargin = (parseFloat(ic.ebitda) / parseFloat(ic.revenue)) * 100;
    setColored('kpiEBITDAMargin', ebMargin.toFixed(2) + '%', ebMargin > 0);
  } else {
    setText('kpiEBITDAMargin', 'N/A');
  }

  setMargin('kpiROE',  m.roeTTM  || r.returnOnEquityTTM);
  setMargin('kpiROA',  m.roaTTM  || r.returnOnAssetsTTM);
  setMargin('kpiROIC', m.roicTTM || r.returnOnCapitalEmployedTTM);

  // -- Financial Health --
  setText('kpiRevenue', fmtCurrency(ic.revenue));
  const ni = parseFloat(ic.netIncome);
  if (!isNaN(ni)) setColored('kpiNetIncome', fmtCurrency(ic.netIncome), ni > 0);
  else setText('kpiNetIncome', 'N/A');

  setText('kpiTotalCash', fmtCurrency(b.cashAndCashEquivalents || b.cashAndShortTermInvestments));
  setText('kpiTotalDebt', fmtCurrency(b.totalDebt || b.longTermDebt));

  const de = parseFloat(m.debtToEquityTTM || r.debtEquityRatioTTM);
  setText('kpiDebtEquity', isNaN(de) ? 'N/A' : de.toFixed(2) + 'x');

  setText('kpiCurrentRatio', fmtRatio(m.currentRatioTTM || r.currentRatioTTM));
  setText('kpiQuickRatio',   fmtRatio(m.quickRatioTTM   || r.quickRatioTTM));

  const fcf = parseFloat(cf.freeCashFlow || cf.operatingCashFlow);
  if (!isNaN(fcf)) setColored('kpiFCF', fmtCurrency(fcf), fcf > 0);
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

  setText('kpiEPS',        fmtPrice(quote.eps || ic.epsdiluted));
  setText('kpiForwardEPS', fmtPrice(ic.epsdiluted));

  const divYield = profile.lastDiv > 0 && profile.price > 0
    ? ((profile.lastDiv / profile.price) * 100) : null;
  setText('kpiDivYield',    divYield != null ? fmtPctDirect(divYield) : 'N/A');
  setText('kpiDivRate',     profile.lastDiv > 0 ? fmtPrice(profile.lastDiv) : 'N/A');

  const payout = parseFloat(r.payoutRatioTTM || m.payoutRatioTTM);
  setText('kpiPayoutRatio', isNaN(payout) ? 'N/A' : fmtPctDecimal(payout));
  setText('kpiExDivDate',   fmtDate(quote.exDividendDate || profile.exDividendDate));

  // -- Market Data --
  setText('kpi52High',    fmtPrice(quote.yearHigh));
  setText('kpi52Low',     fmtPrice(quote.yearLow));
  setText('kpi50MA',      fmtPrice(quote.priceAvg50));
  setText('kpi200MA',     fmtPrice(quote.priceAvg200));
  setText('kpiVolume',    fmtBig(quote.volume));
  setText('kpiAvgVolume', fmtBig(quote.avgVolume));
  setText('kpiShares',    fmtBig(profile.sharesOutstanding || quote.sharesOutstanding));
  setText('kpiFloat',     fmtBig(profile.floatShares || quote.floatShares));

  // -- Analyst Consensus --
  const latestRec = Array.isArray(recs) && recs.length ? recs[0] : null;
  if (latestRec) {
    const sb    = latestRec.strongBuy  || 0;
    const b2    = latestRec.buy        || 0;
    const h     = latestRec.hold       || 0;
    const s     = latestRec.sell       || 0;
    const ss    = latestRec.strongSell || 0;
    const total = sb + b2 + h + s + ss;
    const buyPct = total ? (sb + b2) / total : 0;

    let rec = 'Hold';
    if (buyPct > 0.6) rec = buyPct > 0.8 ? 'Strong Buy' : 'Buy';
    if (total && (s + ss) / total > 0.4) rec = 'Sell';

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

  if (targets && targets.length) {
    const t = targets[0];
    const mean   = parseFloat(t.targetConsensus || t.targetMedian);
    const upside = curPrice ? (mean - curPrice) / curPrice : null;
    setText('kpiTargetPrice', fmtPrice(mean));
    setText('kpiTargetHigh',  fmtPrice(t.targetHigh));
    setText('kpiTargetLow',   fmtPrice(t.targetLow));
    if (upside != null) setColored('kpiUpside', (upside >= 0 ? '+' : '') + (upside * 100).toFixed(2) + '%', upside > 0);
    else setText('kpiUpside', 'N/A');
    if (t.numberOfAnalysts) setText('kpiAnalystCount', String(t.numberOfAnalysts));
  } else {
    ['kpiTargetPrice', 'kpiTargetHigh', 'kpiTargetLow', 'kpiUpside'].forEach(id => setText(id, 'N/A'));
  }

  setText('kpiShortRatio', 'N/A');
  show('kpis');
}

// ============================================================
// Render: Price Chart
// ============================================================

function renderChart(historical) {
  const raw = historical?.historical;
  if (!Array.isArray(raw) || !raw.length) return;

  const sorted = [...raw].reverse();
  const labels = sorted.map(d => {
    const dt = new Date(d.date);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const prices = sorted.map(d => d.close != null ? +parseFloat(d.close).toFixed(2) : null);

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
    renderChart(hist);
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
  const head  = years.map(r => `<th>${(r.date || r.calendarYear || '').slice(0, 4)}</th>`).join('');
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
  { key: 'operatingCashFlow',          label: 'Operating Cash Flow', colored: true },
  { key: 'capitalExpenditure',         label: 'Capital Expenditures' },
  { key: 'freeCashFlow',               label: 'Free Cash Flow',      colored: true },
  { key: 'dividendsPaid',              label: 'Dividends Paid' },
  { key: 'netCashUsedForInvestingActivites', label: 'Investing Activities' },
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
    // profile and quote errors propagate — bad API key surfaces here instead of silently becoming empty
    const [profileArr, quoteArr, metricsArr, ratiosArr, recsArr, targetsArr, incomeArr, balanceArr, cashflowArr, histData] = await Promise.all([
      fmpProfile(ticker),
      fmpQuote(ticker),
      fmpMetrics(ticker).catch(() => [{}]),
      fmpRatios(ticker).catch(() => [{}]),
      fmpRecs(ticker).catch(() => []),
      fmpTargets(ticker).catch(() => []),
      fmpIncome(ticker).catch(() => []),
      fmpBalance(ticker).catch(() => []),
      fmpCashflow(ticker).catch(() => []),
      fmpHistory(ticker, 365).catch(() => ({})),
    ]);

    const profile = Array.isArray(profileArr) && profileArr.length ? profileArr[0] : null;
    const quote   = Array.isArray(quoteArr)   && quoteArr.length   ? quoteArr[0]   : null;

    if (!profile?.companyName && !quote?.symbol) {
      throw new Error(`"${ticker}" not found. Please check the ticker symbol.`);
    }

    const p = profile || {};
    const q = quote   || {};

    fullData = { profile: p, quote: q, metrics: metricsArr, ratios: ratiosArr, recs: recsArr, targets: targetsArr, income: incomeArr, balance: balanceArr, cashflow: cashflowArr };

    renderHeader(p, q, ticker);
    renderQuickStats(p, q, metricsArr, incomeArr);
    renderKPIs(p, q, metricsArr, ratiosArr, recsArr, targetsArr, balanceArr, incomeArr, cashflowArr);

    if (Array.isArray(histData?.historical) && histData.historical.length) {
      renderChart(histData);
      show('chartSection');
    }

    show('financials');
    document.getElementById('finContent').innerHTML =
      '<p style="padding:20px;color:var(--text-muted)">Loading...</p>';
    try {
      await loadAndRenderTab(fmpIncome, INCOME_FIELDS);
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
        if (t === 'income')   await loadAndRenderTab(fmpIncome,   INCOME_FIELDS);
        if (t === 'balance')  await loadAndRenderTab(fmpBalance,  BALANCE_FIELDS);
        if (t === 'cashflow') await loadAndRenderTab(fmpCashflow, CASHFLOW_FIELDS);
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
