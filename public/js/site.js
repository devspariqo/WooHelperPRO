/* WooHelperPro — public site behaviour */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Mobile navigation
  // ---------------------------------------------------------------
  const navToggle = document.querySelector('[data-nav-toggle]');
  const siteNav = document.getElementById('siteNav');

  if (navToggle && siteNav) {
    navToggle.addEventListener('click', function () {
      const open = siteNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });

    // Close the menu after tapping a link on mobile.
    siteNav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && window.innerWidth <= 860) {
        siteNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---------------------------------------------------------------
  // Auto-dismissing alerts
  // ---------------------------------------------------------------
  document.querySelectorAll('.alert').forEach(function (alert) {
    const closeBtn = alert.querySelector('.alert-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () { alert.remove(); });
    }
    // Success messages fade; errors stay until dismissed.
    if (alert.classList.contains('alert-success')) {
      setTimeout(function () {
        alert.style.transition = 'opacity .4s, transform .4s';
        alert.style.opacity = '0';
        alert.style.transform = 'translateY(-6px)';
        setTimeout(function () { alert.remove(); }, 400);
      }, 6000);
    }
  });

  // ---------------------------------------------------------------
  // Confirm destructive actions
  // ---------------------------------------------------------------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) {
        e.preventDefault();
      }
    });
  });

  // ---------------------------------------------------------------
  // Order form: keep the summary in sync with the selection
  // ---------------------------------------------------------------
  const checkoutForm = document.getElementById('checkoutForm');

  if (checkoutForm) {
    const summaryEl = document.getElementById('orderSummary');
    const packageSelect = checkoutForm.querySelector('[name="packageId"]');
    const paymentModeInputs = checkoutForm.querySelectorAll('[name="paymentMode"]');
    const couponInput = checkoutForm.querySelector('[name="couponCode"]');
    const csrf = checkoutForm.querySelector('[name="_csrf"]');

    let debounceTimer = null;

    function refreshSummary() {
      if (!packageSelect || !packageSelect.value) return;

      const body = new URLSearchParams();
      body.append('_csrf', csrf ? csrf.value : '');
      body.append('packageId', packageSelect.value);
      body.append('couponCode', couponInput ? couponInput.value.trim() : '');

      const checkedMode = checkoutForm.querySelector('[name="paymentMode"]:checked');
      body.append('paymentMode', checkedMode ? checkedMode.value : 'one_time');

      fetch('/order/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
        body: body.toString(),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) {
            if (data.error && summaryEl) {
              const note = summaryEl.querySelector('.summary-note');
              if (note) { note.textContent = data.error; note.className = 'summary-note err'; }
            }
            return;
          }
          if (summaryEl) summaryEl.outerHTML = data.html;

          const note = document.querySelector('#orderSummary .summary-note');
          if (note) {
            note.textContent = data.couponMessage || '';
            note.className = 'summary-note ' + (data.couponValid ? 'ok' : 'err');
          }
        })
        .catch(function () { /* keep the server-rendered totals on failure */ });
    }

    function scheduleRefresh() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(refreshSummary, 350);
    }

    if (packageSelect) packageSelect.addEventListener('change', refreshSummary);
    if (couponInput) couponInput.addEventListener('input', scheduleRefresh);
    paymentModeInputs.forEach(function (input) {
      input.addEventListener('change', function () {
        // Highlight the selected radio card.
        checkoutForm.querySelectorAll('.radio-card').forEach(function (card) {
          const radio = card.querySelector('input[type="radio"]');
          card.classList.toggle('selected', radio && radio.checked);
        });
        refreshSummary();
      });
    });

    // Mark the initially-selected radio cards.
    checkoutForm.querySelectorAll('.radio-card').forEach(function (card) {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && radio.checked) card.classList.add('selected');
    });

    // Prevent double submission of a real order.
    checkoutForm.addEventListener('submit', function () {
      const submitBtn = checkoutForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Placing your order…';
      }
    });
  }

  // ---------------------------------------------------------------
  // Payment method picker on the invoice page
  // ---------------------------------------------------------------
  const payForm = document.getElementById('paymentForm');

  if (payForm) {
    const instructions = document.getElementById('paymentInstructions');

    payForm.querySelectorAll('[name="method"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        if (!instructions) return;
        const template = instructions.querySelector('[data-gateway="' + radio.value + '"]');
        instructions.querySelectorAll('[data-gateway]').forEach(function (block) {
          block.hidden = true;
        });
        if (template) template.hidden = false;
      });
    });

    // Reveal the block matching whatever is checked on load.
    const checked = payForm.querySelector('[name="method"]:checked');
    if (checked && instructions) {
      const block = instructions.querySelector('[data-gateway="' + checked.value + '"]');
      if (block) block.hidden = false;
    }
  }

  // ---------------------------------------------------------------
  // FAQ accordion
  // ---------------------------------------------------------------
  //
  // Open state lives on the `.is-open` CLASS, not a data attribute, because the
  // panel height is driven by CSS (grid-template-rows 0fr -> 1fr). That animates
  // to the answer's natural height; max-height would need a magic number that
  // either clips long answers or snaps too fast on short ones.
  //
  // aria-expanded is set alongside so the state is announced, and the chevron
  // rotation is CSS-driven off the same class -- one source of truth.
  (function () {
    const items = Array.prototype.slice.call(document.querySelectorAll('[data-faq-item]'));
    if (!items.length) return;

    function setOpen(item, open) {
      item.classList.toggle('is-open', open);
      const btn = item.querySelector('[data-faq-question]');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    items.forEach(function (item) {
      const btn = item.querySelector('[data-faq-question]');
      if (!btn) return;

      btn.addEventListener('click', function () {
        const willOpen = !item.classList.contains('is-open');
        // Single-open reads better, especially on mobile.
        items.forEach(function (other) { if (other !== item) setOpen(other, false); });
        setOpen(item, willOpen);
      });

      // Up/Down move between questions, Home/End jump to the ends -- the keyboard
      // behaviour expected of an accordion.
      btn.addEventListener('keydown', function (e) {
        const i = items.indexOf(item);
        let next = -1;
        if (e.key === 'ArrowDown') next = i + 1;
        else if (e.key === 'ArrowUp') next = i - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next < 0 || next >= items.length) return;
        e.preventDefault();
        const target = items[next].querySelector('[data-faq-question]');
        if (target) target.focus();
      });
    });
  })();

  // ---------------------------------------------------------------
  // Carousel (testimonials)
  // ---------------------------------------------------------------
  //
  // The track is a scroll-snap container, so swipe, momentum and keyboard
  // scrolling already work without any script. This only adds the arrows, the
  // dots, and keeps them in sync with the scroll position -- which also means the
  // markup stays usable if this file never loads.
  (function () {
    document.querySelectorAll('[data-carousel]').forEach(function (root) {
      const track = root.querySelector('[data-carousel-track]');
      const slides = Array.prototype.slice.call(root.querySelectorAll('[data-carousel-slide]'));
      const prev = root.querySelector('[data-carousel-prev]');
      const next = root.querySelector('[data-carousel-next]');
      const dotsWrap = root.querySelector('[data-carousel-dots]');
      if (!track || slides.length < 2) return;

      // Arrows are hidden in the markup and revealed only once JS is running,
      // since without script they would do nothing.
      if (prev) prev.hidden = false;
      if (next) next.hidden = false;

      const atStart = () => track.scrollLeft <= 4;
      const atEnd = () => track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;

      function syncArrows() {
        if (prev) prev.disabled = atStart();
        if (next) next.disabled = atEnd();
      }

      /** Which slide is nearest the left edge, for the active dot. */
      function currentIndex() {
        let best = 0;
        let bestGap = Infinity;
        slides.forEach(function (slide, i) {
          const gap = Math.abs(slide.offsetLeft - track.scrollLeft);
          if (gap < bestGap) { bestGap = gap; best = i; }
        });
        return best;
      }

      // ---- dots ----
      const dots = [];
      if (dotsWrap) {
        slides.forEach(function (slide, i) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'carousel-dot';
          dot.setAttribute('role', 'tab');
          dot.setAttribute('aria-label', (i + 1) + ' / ' + slides.length);
          dot.addEventListener('click', function () {
            track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: 'smooth' });
          });
          dotsWrap.appendChild(dot);
          dots.push(dot);
        });
      }

      function syncDots() {
        const active = currentIndex();
        dots.forEach(function (dot, i) {
          dot.classList.toggle('is-active', i === active);
          dot.setAttribute('aria-selected', i === active ? 'true' : 'false');
        });
      }

      /** Move by one slide, in either direction. */
      function step(dir) {
        const slide = slides[0];
        const gap = slides[1] ? slides[1].offsetLeft - slide.offsetLeft : slide.offsetWidth;
        track.scrollBy({ left: dir * gap, behavior: 'smooth' });
      }

      if (prev) prev.addEventListener('click', function () { step(-1); });
      if (next) next.addEventListener('click', function () { step(1); });

      // Arrow keys move between quotes when the track has focus. This is the
      // requested left/right keyboard navigation.
      track.setAttribute('tabindex', '0');
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'Home') { e.preventDefault(); track.scrollTo({ left: 0, behavior: 'smooth' }); }
        else if (e.key === 'End') {
          e.preventDefault();
          track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
        }
      });

      let ticking = false;
      track.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          syncArrows();
          syncDots();
          ticking = false;
        });
      }, { passive: true });

      window.addEventListener('resize', function () { syncArrows(); syncDots(); });
      syncArrows();
      syncDots();
    });
  })();
  // ---------------------------------------------------------------
  // Reveal-on-scroll (respects reduced motion)
  // ---------------------------------------------------------------
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReduced && 'IntersectionObserver' in window) {
    const targets = document.querySelectorAll('[data-reveal]');
    targets.forEach(function (el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(14px)';
      el.style.transition = 'opacity .5s ease, transform .5s ease';
    });

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(function (el) { observer.observe(el); });
  }

  // ---------------------------------------------------------------
  // Smooth-scroll in-page anchors without polluting the URL
  // ---------------------------------------------------------------
  document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach(function (link) {
    link.addEventListener('click', function (e) {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const headerOffset = 84;
      const top = target.getBoundingClientRect().top + window.pageYOffset - headerOffset;
      window.scrollTo({ top: top, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
  });
})();
