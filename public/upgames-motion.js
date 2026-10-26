/* ═══════════════════════════════════════════════════════════════
   UpGames · Motion — movimiento fluido y continuo
   ───────────────────────────────────────────────────────────────
   • Indicador "líquido" en la navegación inferior que se desliza
     entre pestañas con curva de resorte.
   • Transición suave al cambiar de vista.
   • Aparición escalonada de tarjetas al entrar en pantalla.
   • Header que gana cuerpo de vidrio al hacer scroll.
   Todo usa transform/opacity (GPU) y respeta prefers-reduced-motion.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raf = window.requestAnimationFrame.bind(window);

  /* ── 1. Indicador líquido de la navegación ── */
  function initNavPill() {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    const pill = document.createElement('span');
    pill.className = 'ug-nav-pill';
    nav.prepend(pill);

    function mover() {
      const act = nav.querySelector('.nav-tab.active:not(.nav-nexus)');
      if (!act) { pill.style.opacity = '0'; return; }
      const n = nav.getBoundingClientRect();
      const r = act.getBoundingClientRect();
      const w = Math.min(r.width - 8, 76);
      pill.style.opacity = '1';
      pill.style.width = w + 'px';
      pill.style.transform = `translateX(${r.left - n.left + (r.width - w) / 2}px)`;
    }

    // Primera colocación sin animación
    pill.style.transition = 'none';
    mover();
    raf(() => raf(() => { pill.style.transition = ''; }));

    new MutationObserver(() => raf(mover))
      .observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => raf(mover), { passive: true });
  }

  /* ── 2. Transición entre vistas ── */
  function initViewTransitions() {
    const orig = window.switchTab;
    if (typeof orig !== 'function') return;
    let actual = 'main';
    const vistas = { main: 'main-view', favs: 'favs-view', economia: 'economia-view', profile: 'profile-view' };
    window.switchTab = function (t) {
      const prev = actual;
      orig.apply(this, arguments);
      actual = t;
      if (reduce) return;
      const id = vistas[t === 'upload' ? 'profile' : t];
      const el = id && document.getElementById(id);
      if (!el || prev === t) return;
      el.classList.remove('ug-view-enter');
      void el.offsetWidth; // reinicia la animación
      el.classList.add('ug-view-enter');
    };
    document.addEventListener('animationend', e => {
      if (e.animationName === 'ugViewIn') e.target.classList.remove('ug-view-enter');
    });
  }

  /* ── 3. Aparición escalonada de tarjetas ── */
  function initReveal() {
    if (reduce || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          en.target.classList.add('ug-in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });

    let lote = 0, loteTimer = null;
    function preparar(el) {
      if (!el.classList || el.dataset.ugReveal) return;
      if (!el.classList.contains('game-tile') && !el.classList.contains('pf-item-card') && !el.classList.contains('pf-vault-card')) return;
      el.dataset.ugReveal = '1';
      el.style.setProperty('--i', Math.min(lote++, 8));
      el.classList.add('ug-reveal');
      io.observe(el);
      clearTimeout(loteTimer);
      loteTimer = setTimeout(() => { lote = 0; }, 120);
    }
    // Quita el delay tras aparecer para que el :active responda al instante
    document.addEventListener('transitionend', e => {
      const el = e.target;
      if (el.classList && el.classList.contains('ug-in') && e.propertyName === 'opacity') {
        el.classList.remove('ug-reveal', 'ug-in');
        el.style.removeProperty('--i');
      }
    });

    const mo = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        preparar(n);
        if (n.querySelectorAll) n.querySelectorAll('.game-tile, .pf-item-card, .pf-vault-card').forEach(preparar);
      }));
    });
    ['output', 'favs-grid', 'profile-view'].forEach(id => {
      const el = document.getElementById(id);
      if (el) mo.observe(el, { childList: true, subtree: true });
    });
  }

  /* ── 4. Header con vidrio al hacer scroll ── */
  function initScrollState() {
    let ticking = false, estado = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      raf(() => {
        const s = window.scrollY > 8;
        if (s !== estado) { estado = s; document.body.classList.toggle('ug-scrolled', s); }
        ticking = false;
      });
    }, { passive: true });
  }

  /* ── 5. Chip activo siempre visible (desliza la fila con suavidad) ── */
  function initChips() {
    const row = document.getElementById('category-row');
    if (!row) return;
    row.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const x = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2;
      row.scrollTo({ left: Math.max(0, x), behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  function init() {
    initNavPill();
    initViewTransitions();
    initReveal();
    initScrollState();
    initChips();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
