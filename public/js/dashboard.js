/* WooHelperPro — dashboard shell behaviour */
(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Sidebar open/close on mobile
  // ---------------------------------------------------------------
  const sidebar = document.getElementById('appSidebar');
  const toggle = document.querySelector('[data-sidebar-toggle]');
  const backdrop = document.querySelector('.sidebar-backdrop');

  function setSidebar(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (backdrop) backdrop.hidden = !open;
    document.body.style.overflow = open && window.innerWidth <= 900 ? 'hidden' : '';
  }

  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      setSidebar(!sidebar.classList.contains('open'));
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', function () { setSidebar(false); });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setSidebar(false);
  });

  // Reset state when the viewport grows past the mobile breakpoint.
  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (window.innerWidth > 900) setSidebar(false);
    }, 150);
  });

  // ---------------------------------------------------------------
  // Confirm destructive actions
  // ---------------------------------------------------------------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // ---------------------------------------------------------------
  // Auto-submit filter forms when a select changes (fewer clicks)
  // ---------------------------------------------------------------
  document.querySelectorAll('[data-auto-submit] select').forEach(function (select) {
    select.addEventListener('change', function () {
      select.form.submit();
    });
  });

  // ---------------------------------------------------------------
  // Dismissible alerts
  // ---------------------------------------------------------------
  document.querySelectorAll('.alert-close').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const alert = btn.closest('.alert');
      if (alert) alert.remove();
    });
  });

  document.querySelectorAll('.alert-success').forEach(function (alert) {
    setTimeout(function () {
      alert.style.transition = 'opacity .4s';
      alert.style.opacity = '0';
      setTimeout(function () { alert.remove(); }, 400);
    }, 7000);
  });

  // ---------------------------------------------------------------
  // Inline invoice line-item calculator
  // ---------------------------------------------------------------
  const chargeForm = document.getElementById('chargeForm');

  if (chargeForm) {
    const subtotal = chargeForm.querySelector('[name="subtotal"]');
    const discount = chargeForm.querySelector('[name="discount"]');
    const tax = chargeForm.querySelector('[name="tax"]');
    const total = chargeForm.querySelector('[name="total"]');

    function recalc() {
      const s = Number(subtotal && subtotal.value) || 0;
      const d = Number(discount && discount.value) || 0;
      const t = Number(tax && tax.value) || 0;
      if (total) total.value = Math.max(0, s - d + t).toFixed(2);
    }

    [subtotal, discount, tax].forEach(function (input) {
      if (input) input.addEventListener('input', recalc);
    });
  }

  // ---------------------------------------------------------------
  // Invoice manual-payment form: fill the outstanding balance
  // ---------------------------------------------------------------
  document.querySelectorAll('[data-fill-balance]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const target = document.querySelector(btn.getAttribute('data-fill-balance'));
      if (target) {
        target.value = btn.getAttribute('data-balance') || '0';
        target.focus();
      }
    });
  });

  // ---------------------------------------------------------------
  // Inline edit panels (categories, leads, portfolio, FAQs)
  //
  // Each panel is rendered server-side with the `hidden` attribute and opened
  // by a button carrying a matching data attribute. Anything with the same pair
  // toggles it, so the "Close"/"Cancel" buttons work without new JS.
  // ---------------------------------------------------------------
  [
    ['data-toggle-category', 'cat-edit-'],
    ['data-toggle-lead', 'lead-edit-'],
    ['data-toggle-portfolio', 'portfolio-edit-'],
    ['data-toggle-faq', 'faq-edit-'],
  ].forEach(function (pair) {
    const attr = pair[0];
    const prefix = pair[1];

    document.querySelectorAll('[' + attr + ']').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute(attr);
        const panel = document.getElementById(prefix + id);
        if (!panel) return;

        panel.hidden = !panel.hidden;

        // Scroll the panel into view the first time it opens — on long tables
        // the form can otherwise appear far below the fold with no feedback.
        if (!panel.hidden) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  });

  // ---------------------------------------------------------------
  // Package form: fill plan name + amount from the chosen package
  // ---------------------------------------------------------------
  const packageSelect = document.getElementById('packageId');

  if (packageSelect) {
    packageSelect.addEventListener('change', function () {
      const opt = packageSelect.options[packageSelect.selectedIndex];
      if (!opt) return;

      const cycle = document.getElementById('billingCycle');
      const nameField = document.getElementById('planName');
      const amountField = document.getElementById('amount');

      if (nameField && !nameField.value) nameField.value = opt.getAttribute('data-name') || '';

      const yearly = cycle && cycle.value === 'YEARLY';
      const price = yearly ? opt.getAttribute('data-yearly') : opt.getAttribute('data-monthly');

      if (amountField && Number(amountField.value) === 0 && price) amountField.value = price;
    });
  }

  // ---------------------------------------------------------------
  // Tables: sort by clicking a header (client-side, current page only)
  // ---------------------------------------------------------------
  document.querySelectorAll('table.data[data-sortable]').forEach(function (table) {
    const headers = table.querySelectorAll('thead th');
    headers.forEach(function (th, index) {
      if (th.classList.contains('no-sort')) return;
      th.style.cursor = 'pointer';
      th.title = 'Sort by this column';

      let ascending = true;

      th.addEventListener('click', function () {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));

        rows.sort(function (a, b) {
          const cellA = a.children[index] ? a.children[index].textContent.trim() : '';
          const cellB = b.children[index] ? b.children[index].textContent.trim() : '';

          // Numeric compare when both sides parse as numbers.
          const numA = parseFloat(cellA.replace(/[^0-9.\-]/g, ''));
          const numB = parseFloat(cellB.replace(/[^0-9.\-]/g, ''));
          if (!isNaN(numA) && !isNaN(numB)) {
            return ascending ? numA - numB : numB - numA;
          }
          return ascending ? cellA.localeCompare(cellB) : cellB.localeCompare(cellA);
        });

        rows.forEach(function (row) { tbody.appendChild(row); });
        ascending = !ascending;
      });
    });
  });
})();
