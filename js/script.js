'use strict';

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
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  navLinks.classList.toggle('open');
  const bars = hamburger.querySelectorAll('span');
  const isOpen = navLinks.classList.contains('open');
  bars[0].style.transform = isOpen ? 'rotate(45deg) translate(5px, 5px)' : '';
  bars[1].style.opacity = isOpen ? '0' : '1';
  bars[2].style.transform = isOpen ? 'rotate(-45deg) translate(5px, -5px)' : '';
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    hamburger.querySelectorAll('span').forEach(s => {
      s.style.transform = '';
      s.style.opacity = '';
    });
  });
});

// ===========================
// COUNTER ANIMATION (HERO)
// ===========================
function animateCounter(el) {
  const target = parseInt(el.dataset.count, 10);
  const duration = 2000;
  const start = performance.now();
  const update = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target);
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

// ===========================
// SCROLL REVEAL
// ===========================
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.about-card, .player-card, .stat-card, .match-item, .stats-bar-item').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});

// ===========================
// HERO COUNTER TRIGGER
// ===========================
const heroObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    document.querySelectorAll('.hero-stat__number').forEach(animateCounter);
    heroObserver.disconnect();
  }
}, { threshold: 0.5 });
const heroStats = document.querySelector('.hero-stats');
if (heroStats) heroObserver.observe(heroStats);

// ===========================
// STATS RINGS ANIMATION
// ===========================
const ringObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const ring = entry.target;
    const percent = parseInt(ring.dataset.percent, 10);
    const circumference = 2 * Math.PI * 52;
    const offset = circumference * (1 - percent / 100);
    ring.style.strokeDashoffset = offset;
    ringObserver.unobserve(ring);
  });
}, { threshold: 0.3 });

document.querySelectorAll('.stat-ring').forEach(ring => {
  const percent = parseInt(ring.dataset.percent, 10);
  const circumference = 2 * Math.PI * 52;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference;
  ringObserver.observe(ring);
});

// ===========================
// STATS BARS ANIMATION
// ===========================
const barObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const fills = entry.target.querySelectorAll('.stats-bar-fill');
    fills.forEach(fill => {
      fill.style.width = fill.dataset.width + '%';
    });
    barObserver.unobserve(entry.target);
  });
}, { threshold: 0.3 });

const barsSection = document.querySelector('.stats-bar-section');
if (barsSection) barObserver.observe(barsSection);

// ===========================
// SQUAD FILTER
// ===========================
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    document.querySelectorAll('.player-card').forEach(card => {
      if (filter === 'all' || card.dataset.pos === filter) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  });
});

// ===========================
// MATCHES TABS
// ===========================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const tab = btn.dataset.tab;
    document.querySelectorAll('.match-list').forEach(list => {
      list.classList.toggle('hidden', list.id !== tab);
    });
  });
});

// ===========================
// JOIN FORM
// ===========================
const joinForm = document.getElementById('joinForm');
const joinSuccess = document.getElementById('joinSuccess');

if (joinForm) {
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinForm.style.opacity = '0';
    joinForm.style.transform = 'scale(0.95)';
    joinForm.style.transition = '0.3s ease';
    setTimeout(() => {
      joinForm.classList.add('hidden');
      joinSuccess.classList.remove('hidden');
      joinSuccess.style.animation = 'fadeInUp 0.5s ease both';
    }, 300);
  });
}

// ===========================
// SMOOTH SCROLL ACTIVE LINKS
// ===========================
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

const activeObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navAnchors.forEach(a => {
        a.style.color = '';
        a.style.background = '';
      });
      const active = document.querySelector(`.nav-links a[href="#${entry.target.id}"]`);
      if (active) {
        active.style.color = 'var(--gold)';
        active.style.background = 'rgba(240,192,64,0.08)';
      }
    }
  });
}, { threshold: 0.4 });

sections.forEach(s => activeObserver.observe(s));
