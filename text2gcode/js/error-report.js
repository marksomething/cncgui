/**
 * error-report.js — must be the FIRST script loaded.
 * Captures every uncaught error + unhandled promise rejection and shows them
 * as an on-page overlay with a Copy button, so problems can be reported even
 * without browser dev tools.
 */
(function () {
  'use strict';

  var ERRORS = [];
  var overlay = null;
  var listEl = null;
  var MAX = 6;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.setAttribute('id', 't2g-error-overlay');
    var style = overlay.style;
    style.position = 'fixed';
    style.right = '12px';
    style.bottom = '12px';
    style.zIndex = '99999';
    style.maxWidth = 'min(92vw, 560px)';
    style.background = '#2a1240';
    style.color = '#ffd7f5';
    style.border = '2px solid #f0abfc';
    style.borderRadius = '12px';
    style.padding = '12px 14px';
    style.font = '12px/1.5 -apple-system, "Segoe UI", sans-serif';
    style.boxShadow = '0 10px 40px rgba(0,0,0,.6)';
    style.display = 'none';

    var head = document.createElement('div');
    head.style.marginBottom = '6px';
    head.style.fontWeight = '700';
    head.style.color = '#f0abfc';
    head.textContent = '⚠ Text2GCode error report';

    listEl = document.createElement('div');
    listEl.style.whiteSpace = 'pre-wrap';
    listEl.style.wordBreak = 'break-word';
    listEl.style.maxHeight = '38vh';
    listEl.style.overflow = 'auto';
    listEl.style.fontFamily = 'Menlo, Consolas, monospace';
    listEl.style.fontSize = '11px';

    var btnRow = document.createElement('div');
    btnRow.style.marginTop = '8px';
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';

    var copyBtn = document.createElement('button');
    copyBtn.textContent = '⧉ Copy report';
    styleButton(copyBtn);
    copyBtn.onclick = function () {
      var txt = fullReport();
      copyText(txt, copyBtn);
    };

    var dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    styleButton(dismissBtn);
    dismissBtn.onclick = function () { overlay.style.display = 'none'; };

    btnRow.appendChild(copyBtn);
    btnRow.appendChild(dismissBtn);
    overlay.appendChild(head);
    overlay.appendChild(listEl);
    overlay.appendChild(btnRow);
    (document.body || document.documentElement).appendChild(overlay);
  }

  function styleButton(b) {
    b.style.cursor = 'pointer';
    b.style.border = '1px solid #8b5cf6';
    b.style.background = '#3b2b60';
    b.style.color = '#ece7f8';
    b.style.borderRadius = '8px';
    b.style.padding = '6px 12px';
    b.style.font = '12px -apple-system, "Segoe UI", sans-serif';
  }

  function copyText(txt, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    try {
      // clipboard API (needs https/localhost on some browsers)
      var p = navigator.clipboard && navigator.clipboard.writeText(txt);
      if (p && p.then) { p.then(done, fallback); return; }
    } catch (e) { /* fall through */ }
    fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand('copy'); // works in Safari with user gesture
        document.body.removeChild(ta);
        if (ok) done();
      } catch (e2) { /* give up silently */ }
    }
  }

  function fullReport() {
    var lines = [
      'Text2GCode error report',
      'User agent: ' + navigator.userAgent,
      'URL: ' + location.href,
      'Errors (' + ERRORS.length + '):',
      '----------------------------------------',
    ];
    for (var i = 0; i < ERRORS.length; i++) lines.push('[' + (i + 1) + '] ' + ERRORS[i]);
    return lines.join('\n');
  }

  function report(kind, message) {
    var entry = kind + ': ' + message;
    ERRORS.push(entry);
    if (ERRORS.length > 200) ERRORS.shift();

    // also mirror to console for dev tools users
    try { console.error('[Text2GCode]', entry); } catch (e) { /* noop */ }

    try {
      ensureOverlay();
      var shown = ERRORS.slice(-MAX);
      listEl.textContent = shown.join('\n');
      overlay.style.display = 'block';
    } catch (e) { /* overlay failed — console still has it */ }
  }

  window.addEventListener('error', function (e) {
    var msg = e.message || '';
    if (e.filename) {
      msg += '  @ ' + String(e.filename).split('/').pop() + ':' + (e.lineno || '?') + ':' + (e.colno || '?');
    }
    if (e.error && e.error.stack) msg += '\n' + e.error.stack.split('\n').slice(0, 4).join('\n');
    report('error', msg);
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    var msg = (r && (r.stack || r.message)) ? (r.message || '') + ((r.stack || '').split('\n').slice(0, 4).join('\n')) : String(r);
    report('unhandled promise rejection', msg);
  });

  // public hook for guarded subsystems
  window.__t2g_report = function (source, err) {
    report(source, (err && (err.stack || err.message)) ? String(err.message || err) + '\n' + String(err.stack || '').split('\n').slice(0, 4).join('\n') : String(err));
  };
  window.__t2g_errorlog = ERRORS;
})();