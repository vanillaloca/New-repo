'use strict';

const CLUB_ID = '598236';
const PLATFORM = 'common-gen5';
const CAPTAIN = 'Tim Kuhn';

const BASE = 'https://proclubs.ea.com/api/fc';
const PROXY = 'https://api.allorigins.win/raw?url=';

const POS_MAP = {
  0:  { label: 'TW',  name: 'Torwart',                    group: 'gk',  color: '#f0c040' },
  1:  { label: 'LI',  name: 'Libero',                     group: 'def', color: '#4a9eff' },
  2:  { label: 'RFV', name: 'Rechter Flügelverteidiger',  group: 'def', color: '#4a9eff' },
  3:  { label: 'RV',  name: 'Rechtsverteidiger',           group: 'def', color: '#4a9eff' },
  4:  { label: 'IV',  name: 'Innenverteidiger',            group: 'def', color: '#4a9eff' },
  5:  { label: 'LV',  name: 'Linksverteidiger',            group: 'def', color: '#4a9eff' },
  6:  { label: 'LFV', name: 'Linker Flügelverteidiger',   group: 'def', color: '#4a9eff' },
  7:  { label: 'DM',  name: 'Defensives Mittelfeld',       group: 'mid', color: '#a855f7' },
  8:  { label: 'RM',  name: 'Rechtes Mittelfeld',          group: 'mid', color: '#a855f7' },
  9:  { label: 'ZM',  name: 'Zentrales Mittelfeld',        group: 'mid', color: '#a855f7' },
  10: { label: 'OM',  name: 'Offensives Mittelfeld',       group: 'mid', color: '#a855f7' },
  11: { label: 'LM',  name: 'Linkes Mittelfeld',           group: 'mid', color: '#a855f7' },
  12: { label: 'RA',  name: 'Rechtsaußen',                 group: 'att', color: '#f0c040' },
  13: { label: 'ST',  name: 'Mittelstürmer',               group: 'att', color: '#f0c040' },
  14: { label: 'LA',  name: 'Linksaußen',                  group: 'att', color: '#f0c040' },
  25: { label: 'CF',  name: 'Hängende Spitze',             group: 'att', color: '#f0c040' },
};

function posInfo(pos) {
  return POS_MAP[pos] || { label: 'UNK', name: 'Unbekannt', group: 'mid', color: '#6b7280' };
}

// ===========================
// FETCH HELPERS
// ===========================
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchEA(path) {
  return fetchJSON(`${BASE}${path}`);
}

async function fetchViaProxy(path) {
  const target = encodeURIComponent(`${BASE}${path}`);
  return fetchJSON(`${PROXY}${target}`);
}

// Three-tier: local cached file → direct EA API → CORS proxy
async function fetchWithFallback(localFile, eaPath) {
  // Tier 1: local data/*.json (filled daily by GitHub Actions)
  try {
    const data = await fetchJSON(localFile);
    const isEmpty = Array.isArray(data) ? data.length === 0 : Object.keys(data).length === 0;
    if (!isEmpty) return data;
  } catch (_) { /* fall through */ }

  // Tier 2: direct EA API (browser requests bypass Cloudflare allowlist)
  try {
    return await fetchEA(eaPath);
  } catch (_) { /* fall through */ }

  // Tier 3: CORS proxy as last resort
  return fetchViaProxy(eaPath);
}

// ===========================
// LOAD EVERYTHING
// ===========================
async function loadClubData() {
  try {
    const [clubRes, membersRes, matchRes] = await Promise.allSettled([
      fetchWithFallback('data/club.json',    `/clubs/overallStats?platform=${PLATFORM}&clubIds=${CLUB_ID}`),
      fetchWithFallback('data/members.json', `/clubs/members?platform=${PLATFORM}&clubId=${CLUB_ID}`),
      fetchWithFallback('data/matches.json', `/clubs/matches?matchType=gameType9&platform=${PLATFORM}&clubIds=${CLUB_ID}`),
    ]);

    if (clubRes.status === 'fulfilled')    applyClubStats(clubRes.value);
    else showApiNote('Club-Stats nicht verfügbar.');

    if (membersRes.status === 'fulfilled') buildSquad(membersRes.value);
    else showSquadError();

    if (matchRes.status === 'fulfilled')   buildMatches(matchRes.value);
    else showMatchError();

    showLastUpdated();
  } catch (e) {
    showApiNote('EA-Daten nicht verfügbar.');
  }
}

async function showLastUpdated() {
  try {
    const info = await fetchJSON('data/last_updated.json');
    if (info && info.updated) {
      const d = new Date(info.updated);
      showApiNote(`Daten zuletzt aktualisiert: ${d.toLocaleString('de-DE')}`);
    }
  } catch (_) { /* no timestamp file yet */ }
}

// ===========================
// CLUB STATS
// ===========================
function applyClubStats(data) {
  const club = Array.isArray(data) ? data[0] : (data[CLUB_ID] || Object.values(data)[0]);
  if (!club) return;

  const wins   = parseInt(club.wins   || club.totalWins   || 0);
  const losses = parseInt(club.losses || club.totalLosses || 0);
  const draws  = parseInt(club.ties   || club.totalTies   || 0);
  const goals  = parseInt(club.goals  || club.totalGoals  || 0);
  const games  = wins + losses + draws;
  const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
  const div     = club.divisionRank || club.rankingPoints || '–';
  const members = club.memberCount  || club.members || '–';
  const seasonWins = club.curSeasonWins || club.seasonWins || wins;

  animateNumber(document.getElementById('statMember'), members);
  animateNumber(document.getElementById('statWins'),   wins);
  animateNumber(document.getElementById('statGoals'),  goals);
  setText('statDiv', typeof div === 'number' ? `Div ${div}` : div);

  setRing('ringWinRate', winRate, winRate + '%');
  setText('valWinRate', winRate + '%');
  setText('labelWinRate', `${wins}S / ${losses}N / ${draws}U`);

  setRing('ringGoals', Math.min(goals / 5, 100), goals);
  setText('valGoals', goals);

  setRing('ringSeason', Math.min((seasonWins / 10) * 100, 100), seasonWins);
  setText('valSeason', seasonWins);

  setRing('ringGames', Math.min((games / 20) * 100, 100), games);
  setText('valGames', games);
}

// ===========================
// SQUAD
// ===========================
function buildSquad(data) {
  const members = data.members || data || [];
  const grid = document.getElementById('squadGrid');
  if (!members.length) { grid.innerHTML = '<p class="no-data">Keine Spieler gefunden.</p>'; return; }

  const sorted = [...members].sort((a, b) => (b.skOverall || 0) - (a.skOverall || 0));

  grid.innerHTML = sorted.map(p => {
    const pos     = posInfo(p.proPos ?? p.position ?? 9);
    const ovr     = p.skOverall || '?';
    const name    = p.name || p.proName || 'Unbekannt';
    const goals   = p.skGoals   || 0;
    const assists = p.skAssists || 0;
    const rating  = p.skRating  ? parseFloat(p.skRating).toFixed(1) : '–';
    const isCapt  = name.toLowerCase() === CAPTAIN.toLowerCase();

    return `
      <div class="player-card${isCapt ? ' player-card--captain' : ''}" data-pos="${pos.group}">
        <div class="player-card__rating">${ovr}</div>
        <div class="player-card__pos" style="background:${pos.color}22;color:${pos.color}">${pos.label}</div>
        ${isCapt ? '<div class="captain-badge">©</div>' : ''}
        <div class="player-card__avatar">
          <svg viewBox="0 0 80 80" fill="none">
            <circle cx="40" cy="30" r="18" fill="${pos.color}" opacity=".2"/>
            <circle cx="40" cy="28" r="14" fill="${pos.color}" opacity=".5"/>
            <ellipse cx="40" cy="68" rx="24" ry="16" fill="${pos.color}" opacity=".15"/>
          </svg>
        </div>
        <div class="player-card__info">
          <h4>${name}${isCapt ? ' <span class="capt-icon">Kapitän</span>' : ''}</h4>
          <span>${pos.name}</span>
        </div>
        <div class="player-card__stats">
          <div><span>TORE</span><b>${goals}</b></div>
          <div><span>ASS</span><b>${assists}</b></div>
          <div><span>WTG</span><b>${rating}</b></div>
        </div>
      </div>`;
  }).join('');

  buildTopScorers(members);
  initFilters();
  revealCards();
}

function showSquadError() {
  document.getElementById('squadGrid').innerHTML =
    '<p class="no-data">Squad-Daten konnten nicht geladen werden.</p>';
}

// ===========================
// TOP SCORERS
// ===========================
function buildTopScorers(members) {
  const sorted = [...members]
    .filter(p => (p.skGoals || 0) > 0)
    .sort((a, b) => (b.skGoals || 0) - (a.skGoals || 0))
    .slice(0, 5);

  if (!sorted.length) return;
  const max    = sorted[0].skGoals || 1;
  const colors = ['#f0c040,#ff8c00', '#4a9eff,#7c3aed', '#a855f7,#ec4899', '#22c55e,#16a34a', '#f0c040,#4a9eff'];

  document.getElementById('topScorers').innerHTML = sorted.map((p, i) => `
    <div class="stats-bar-item">
      <div class="stats-bar-meta">
        <span>${p.name || p.proName}</span>
        <span>${p.skGoals} Tore</span>
      </div>
      <div class="stats-bar-track">
        <div class="stats-bar-fill" data-width="${Math.round((p.skGoals / max) * 95)}"
          style="background:linear-gradient(90deg,${colors[i]});width:0%"></div>
      </div>
    </div>`).join('');

  setTimeout(() => {
    document.querySelectorAll('.stats-bar-fill').forEach(el => {
      el.style.width = el.dataset.width + '%';
    });
  }, 300);
}

// ===========================
// MATCHES
// ===========================
function buildMatches(data) {
  const matches = Array.isArray(data) ? data : (data.matches || []);
  const list    = document.getElementById('matchList');

  if (!matches.length) {
    list.innerHTML = '<p class="no-data">Keine Spiele gefunden.</p>';
    return;
  }

  list.innerHTML = matches.slice(0, 8).map(m => {
    const clubs    = m.clubs || {};
    const clubKeys = Object.keys(clubs);
    const ourKey   = clubKeys.find(k => k === CLUB_ID || clubs[k]?.clubId == CLUB_ID) || clubKeys[0];
    const oppKey   = clubKeys.find(k => k !== ourKey) || clubKeys[1];
    const us       = clubs[ourKey] || {};
    const opp      = clubs[oppKey] || {};
    const ourGoals = parseInt(us.goals  ?? 0);
    const oppGoals = parseInt(opp.goals ?? 0);
    const oppName  = opp.details?.name || opp.name || 'Gegner';
    const result   = ourGoals > oppGoals ? 'win' : ourGoals < oppGoals ? 'loss' : 'draw';
    const badge    = result === 'win' ? 'S' : result === 'loss' ? 'N' : 'U';
    const date     = m.timestamp
      ? new Date(m.timestamp * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
      : '–';

    return `
      <div class="match-item match-item--${result}">
        <div class="match-date">${date}</div>
        <div class="match-teams">
          <span class="match-home">nk Verdansk</span>
          <div class="match-score">
            <span>${ourGoals}</span>
            <span class="match-score-sep">:</span>
            <span>${oppGoals}</span>
          </div>
          <span class="match-away">${oppName}</span>
        </div>
        <div class="match-badge match-badge--${result}">${badge}</div>
      </div>`;
  }).join('');
}

function showMatchError() {
  document.getElementById('matchList').innerHTML =
    '<p class="no-data">Spielergebnisse konnten nicht geladen werden.</p>';
}

// ===========================
// HELPERS
// ===========================
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function animateNumber(el, target) {
  if (!el || isNaN(target)) { if (el) el.textContent = target; return; }
  const n     = parseInt(target);
  const dur   = 1800;
  const start = performance.now();
  const tick  = (now) => {
    const p = Math.min((now - start) / dur, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(e * n);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setRing(id, percent, label) {
  const ring = document.getElementById(id);
  if (!ring) return;
  const circ = 2 * Math.PI * 52;
  ring.style.strokeDasharray  = circ;
  ring.style.strokeDashoffset = circ * (1 - Math.min(percent, 100) / 100);
}

function showApiNote(msg) {
  const el = document.getElementById('apiStatus');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

// ===========================
// FILTERS
// ===========================
function initFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      document.querySelectorAll('.player-card').forEach(c => {
        c.classList.toggle('hidden', f !== 'all' && c.dataset.pos !== f);
      });
    });
  });
}

function revealCards() {
  document.querySelectorAll('.player-card, .about-card, .stat-card, .match-item, .stats-bar-item').forEach(el => {
    el.classList.add('reveal');
    revealObserver.observe(el);
  });
}

// ===========================
// NAVBAR SCROLL
// ===========================
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
});

// ===========================
// MOBILE MENU
// ===========================
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const bars   = hamburger.querySelectorAll('span');
  const isOpen = navLinks.classList.contains('open');
  bars[0].style.transform = isOpen ? 'rotate(45deg) translate(5px, 5px)' : '';
  bars[1].style.opacity   = isOpen ? '0' : '1';
  bars[2].style.transform = isOpen ? 'rotate(-45deg) translate(5px, -5px)' : '';
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.querySelectorAll('span').forEach(s => { s.style.transform = ''; s.style.opacity = ''; });
  });
});

// ===========================
// SCROLL REVEAL
// ===========================
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); revealObserver.unobserve(entry.target); }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.about-card, .stat-card').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});

// ===========================
// JOIN FORM
// ===========================
const joinForm    = document.getElementById('joinForm');
const joinSuccess = document.getElementById('joinSuccess');
if (joinForm) {
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinForm.style.opacity    = '0';
    joinForm.style.transform  = 'scale(0.95)';
    joinForm.style.transition = '0.3s ease';
    setTimeout(() => { joinForm.classList.add('hidden'); joinSuccess.classList.remove('hidden'); }, 300);
  });
}

// ===========================
// ACTIVE NAV
// ===========================
const sections    = document.querySelectorAll('section[id]');
const navAnchors  = document.querySelectorAll('.nav-links a[href^="#"]');
const activeObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navAnchors.forEach(a => { a.style.color = ''; a.style.background = ''; });
      const active = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (active) { active.style.color = 'var(--gold)'; active.style.background = 'rgba(240,192,64,0.08)'; }
    }
  });
}, { threshold: 0.4 });
sections.forEach(s => activeObserver.observe(s));

// ===========================
// BOOT
// ===========================
loadClubData();
