/**
 * Media picker.
 *
 * Turns any `[data-media-picker]` block into an image field with a library
 * browser, an inline uploader and a live preview. Used by the service, package,
 * project, portfolio, blog and settings forms so they cannot drift apart.
 *
 * The text input is the source of truth: everything here only helps FILL it, so
 * the form still submits correctly if this script fails to load.
 *
 * Endpoints reused from the existing media library:
 *   GET  /admin/media/list.json   -> { ok, items: [{ id, url, ... }] }
 *   POST /admin/media/upload      -> { ok, asset: { url, ... } }
 */
(function () {
  'use strict';

  /**
   * Read the CSRF token from the <meta name="csrf-token"> tag the dashboard
   * layout renders.
   *
   * There is deliberately NO csrf cookie in this app -- the token lives in the
   * session and is echoed into the page. It must also be sent as an
   * `X-CSRF-Token` HEADER rather than a form field, because multer parses the
   * multipart body AFTER the csrf middleware runs, so at check time a multipart
   * form's `_csrf` field is not yet parsed and looks absent. The middleware reads
   * the header for exactly this case.
   */
  function csrfToken() {
    var m = document.querySelector('meta[name="csrf-token"]');
    return m ? m.getAttribute('content') : '';
  }

  /** Render the preview for a URL, or the empty state when there is none. */
  function paint(picker, url) {
    var preview = picker.querySelector('[data-media-preview]');
    if (!preview) return;
    if (!url) {
      preview.innerHTML = '<span class="media-picker-empty">No image</span>';
      return;
    }
    preview.innerHTML = '';
    var img = document.createElement('img');
    img.src = url;
    img.alt = '';
    // Keep the frame's aspect ratio whatever the caller asked for.
    var existing = picker.querySelector('[data-media-preview] img');
    if (existing) img.style.aspectRatio = existing.style.aspectRatio;
    preview.appendChild(img);

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'media-picker-clear';
    clear.setAttribute('data-media-clear', '');
    clear.setAttribute('aria-label', 'Remove');
    clear.title = 'Remove';
    clear.innerHTML = '&times;';
    preview.appendChild(clear);
  }

  function setValue(picker, url) {
    var input = picker.querySelector('[data-media-input]');
    if (!input) return;
    input.value = url || '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    paint(picker, url);
  }

  /** Build the library modal once, then reuse it for every picker. */
  var modal = null;
  function getModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'media-modal';
    modal.hidden = true;
    modal.innerHTML = [
      '<div class="media-modal-backdrop" data-media-close></div>',
      '<div class="media-modal-panel" role="dialog" aria-modal="true" aria-label="Media library">',
      '  <div class="media-modal-head">',
      '    <strong>Media library</strong>',
      '    <button type="button" class="media-modal-x" data-media-close aria-label="Close">&times;</button>',
      '  </div>',
      '  <div class="media-modal-body"><div class="media-grid" data-media-grid></div></div>',
      '</div>',
    ].join('');
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-media-close]')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });
    return modal;
  }

  var onPick = null;
  function openModal(cb) {
    var m = getModal();
    onPick = cb;
    m.hidden = false;
    document.body.classList.add('media-modal-open');

    var grid = m.querySelector('[data-media-grid]');
    grid.innerHTML = '<p class="muted">Loading…</p>';

    fetch('/admin/media/list.json', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.items || !data.items.length) {
          grid.innerHTML = '<p class="muted">No files yet. Use Upload to add one.</p>';
          return;
        }
        grid.innerHTML = '';
        data.items.forEach(function (item) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'media-tile';
          btn.title = item.originalName || item.url;
          var img = document.createElement('img');
          img.src = item.url;
          img.alt = item.altText || '';
          img.loading = 'lazy';
          btn.appendChild(img);
          btn.addEventListener('click', function () {
            if (onPick) onPick(item.url);
            closeModal();
          });
          grid.appendChild(btn);
        });
      })
      .catch(function () {
        grid.innerHTML = '<p class="muted">Could not load the library.</p>';
      });
  }

  function closeModal() {
    if (modal) modal.hidden = true;
    document.body.classList.remove('media-modal-open');
  }

  /** Upload a File and resolve with its URL. */
  function upload(picker, file, cb) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('folder', picker.getAttribute('data-folder') || 'general');

    var input = picker.querySelector('[data-media-input]');
    if (input) input.setAttribute('data-busy', '1');

    fetch('/admin/media/upload', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      // Header, not a form field -- see csrfToken() for why.
      headers: { 'X-CSRF-Token': csrfToken() },
    })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
      .then(function (res) {
        if (input) input.removeAttribute('data-busy');
        if (res.body && res.body.ok && res.body.asset) {
          cb(res.body.asset.url);
        } else {
          alert('Upload failed: ' + ((res.body && res.body.error) || res.status));
        }
      })
      .catch(function (err) {
        if (input) input.removeAttribute('data-busy');
        alert('Upload failed: ' + err.message);
      });
  }

  // ---- wire every picker on the page ----
  document.querySelectorAll('[data-media-picker]').forEach(function (picker) {
    var input = picker.querySelector('[data-media-input]');
    var file = picker.querySelector('[data-media-file]');

    var browse = picker.querySelector('[data-media-browse]');
    if (browse) browse.addEventListener('click', function () {
      openModal(function (url) { setValue(picker, url); });
    });

    var up = picker.querySelector('[data-media-upload]');
    if (up && file) up.addEventListener('click', function () { file.click(); });

    if (file) file.addEventListener('change', function () {
      if (file.files && file.files[0]) {
        upload(picker, file.files[0], function (url) { setValue(picker, url); });
      }
      file.value = '';
    });

    // Manual edits to the URL update the preview, so pasting a path shows it.
    if (input) input.addEventListener('change', function () { paint(picker, input.value.trim()); });

    picker.addEventListener('click', function (e) {
      if (e.target.closest('[data-media-clear]')) setValue(picker, '');
    });
  });
})();
