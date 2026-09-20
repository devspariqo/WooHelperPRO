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
  document.querySelectorAll('[data-faq-item]').forEach(function (item) {
    const button = item.querySelector('[data-faq-question]');
    if (!button) return;
    button.addEventListener('click', function () {
      const expanded = item.getAttribute('data-open') === 'true';
      // Single-open behaviour reads better on mobile.
      document.querySelectorAll('[data-faq-item]').forEach(function (other) {
        if (other !== item) {
          other.setAttribute('data-open', 'false');
          const b = other.querySelector('[data-faq-question]');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
      item.setAttribute('data-open', String(!expanded));
      button.setAttribute('aria-expanded', String(!expanded));
    });
  });

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
