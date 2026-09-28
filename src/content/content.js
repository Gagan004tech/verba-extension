// src/content/content.js
// P3 - Web Interactions & Execution (Module C/D)
//   W2/W3: field scanner + weighted label generator (Module C)
//   W4:    native-value injector, green highlight, MutationObserver (Module D)

(function () {
  'use strict';

  const MESSAGE_TYPES = { PING: 'PING', SCAN_FIELDS: 'SCAN_FIELDS', FILL_FIELD: 'FILL_FIELD' };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    switch (message.type) {
      case MESSAGE_TYPES.PING:
        sendResponse({ ok: true, from: 'content-script', url: location.href }); return false;
      case MESSAGE_TYPES.SCAN_FIELDS:
        try {
          const fields = scanFields();
          sendResponse({ ok: true, url: location.href, count: fields.length, fields });
        } catch (e) {
          sendResponse({ ok: false, error: String(e && e.message || e) });
        }
        return false;
      case MESSAGE_TYPES.FILL_FIELD:
        sendResponse(fillField(message.payload)); return false;
      default: return false;
    }
  });

  // ---------------------------------------------------------------------------
  // Field scanner (W2) + weighted label generator (W3)
  // ---------------------------------------------------------------------------

  const SKIP_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const ID_ATTR = 'data-verba-id';
  const CONTROL_SELECTOR = 'input, select, textarea, button';
  const MAX_LABEL_LEN = 100;
  let idCounter = 0;

  // Weight per label source (0..1). Higher = more trustworthy description of the field.
  const WEIGHTS = {
    'aria-labelledby': 1.0,
    'aria-label': 1.0,
    'label-for': 0.95,
    'label-wrap': 0.9,
    'placeholder': 0.7,
    'title': 0.6,
    'autocomplete': 0.5,
    'table-header': 0.5,
    'sibling': 0.5,          // minus 0.1 per level walked up the DOM
    'name': 0.4,
    'id': 0.35,
    'placeholder-example': 0.25 // "e.g. 9876543210" style hints
  };

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function ensureVerbaId(el) {
    let id = el.getAttribute(ID_ATTR);
    if (!id) {
      id = 'verba-' + (++idCounter);
      el.setAttribute(ID_ATTR, id);
    }
    return id;
  }

  // --- text helpers ----------------------------------------------------------

  function cleanText(s) {
    if (!s) return '';
    return s
      .replace(/\s+/g, ' ')
      .replace(/\(\s*(required|optional|mandatory)\s*\)/ig, '')
      .replace(/^[\s*:•]+/, '')
      .replace(/[\s*:：•]+$/, '')
      .trim();
  }

  // Text of a node with any form controls / scripts removed (so a wrapping
  // <label> doesn't pick up <option> text or the input's own value).
  function textWithoutControls(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll(CONTROL_SELECTOR + ', script, style, noscript').forEach((n) => n.remove());
    return cleanText(clone.textContent);
  }

  // "firstName" / "first_name" / "first-name" -> "first name"
  function humanize(s) {
    return cleanText(
      String(s)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_\-.[\]]+/g, ' ')
        .replace(/\d+/g, ' ')
        .toLowerCase()
    );
  }

  // Skip machine-generated ids/names such as ":r1:", "input_8f3a91c2d4e5", "a1b2c3d4e5f6a7b8".
  function looksGenerated(s) {
    if (!s) return true;
    if (s.length > 40 || s.startsWith(':')) return true;
    if (/^[a-f0-9-]{12,}$/i.test(s)) return true;
    if (!/[a-z]{3,}/i.test(s.replace(/([a-z])([A-Z])/g, '$1 $2'))) return true;
    return false;
  }

  function looksLikeExample(s) {
    return /^(e\.?g\.?|eg|ex\.?|example|for example)\b/i.test(s) ||
      /^[\d\s+\-()./]{5,}$/.test(s) ||       // pure number/phone-like hint
      /^\S+@\S+\.\S+$/.test(s);               // email-like hint
  }

  // --- nearby text (previous siblings, then walk up) -------------------------

  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 3; depth++) {
      let sib = node.previousSibling;
      let steps = 0;
      while (sib && steps < 4) {
        if (sib.nodeType === Node.ELEMENT_NODE) {
          const tag = sib.tagName;
          if (/^(INPUT|SELECT|TEXTAREA|BUTTON|SCRIPT|STYLE|FORM)$/.test(tag)) break;
          if (sib.querySelector && sib.querySelector(CONTROL_SELECTOR)) break;
        }
        if (sib.nodeType === Node.ELEMENT_NODE || sib.nodeType === Node.TEXT_NODE) {
          const t = cleanText(sib.textContent);
          if (t && t.length <= MAX_LABEL_LEN) return { text: t, depth };
        }
        sib = sib.previousSibling;
        steps++;
      }
      node = node.parentElement;
      if (!node || node === document.body || node.tagName === 'FORM') break;
    }
    return null;
  }

  // Table layouts: <td>Label</td><td><input></td> or a <th> column header.
  function tableHeaderText(el) {
    const cell = el.closest('td, th');
    if (!cell) return null;
    const prev = cell.previousElementSibling;
    if (prev && !prev.querySelector(CONTROL_SELECTOR)) {
      const t = cleanText(prev.textContent);
      if (t && t.length <= MAX_LABEL_LEN) return t;
    }
    const table = cell.closest('table');
    if (table) {
      const idx = cell.cellIndex;
      const headRow = table.querySelector('thead tr');
      if (headRow && headRow.cells[idx]) {
        const t = cleanText(headRow.cells[idx].textContent);
        if (t && t.length <= MAX_LABEL_LEN) return t;
      }
    }
    return null;
  }

  // --- the label generator ---------------------------------------------------

  function generateLabels(el) {
    const raw = []; // {text, source, weight}
    const add = (text, source, weight) => {
      const t = cleanText(text);
      if (t && t.length <= MAX_LABEL_LEN) raw.push({ text: t, source, weight: Math.round(weight * 100) / 100 });
    };

    // aria-labelledby (ids may point to several elements)
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const text = labelledby.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => textWithoutControls(n))
        .join(' ');
      add(text, 'aria-labelledby', WEIGHTS['aria-labelledby']);
    }

    // aria-label
    add(el.getAttribute('aria-label'), 'aria-label', WEIGHTS['aria-label']);

    // <label for=...> and wrapping <label>
    if (el.labels) {
      Array.from(el.labels).forEach((lab) => {
        const wraps = lab.contains(el);
        add(textWithoutControls(lab), wraps ? 'label-wrap' : 'label-for',
          wraps ? WEIGHTS['label-wrap'] : WEIGHTS['label-for']);
      });
    }

    // placeholder (example-style hints get a much lower weight)
    const ph = cleanText(el.getAttribute('placeholder'));
    if (ph) {
      if (looksLikeExample(ph)) add(ph, 'placeholder-example', WEIGHTS['placeholder-example']);
      else add(ph, 'placeholder', WEIGHTS.placeholder);
    }

    add(el.getAttribute('title'), 'title', WEIGHTS.title);

    // autocomplete token, e.g. "given-name", "street-address", "tel"
    const ac = (el.getAttribute('autocomplete') || '').trim().toLowerCase();
    if (ac && ac !== 'on' && ac !== 'off') {
      const token = ac.split(/\s+/).pop();
      add(humanize(token), 'autocomplete', WEIGHTS.autocomplete);
    }

    // table cell / column header
    const th = tableHeaderText(el);
    if (th) add(th, 'table-header', WEIGHTS['table-header']);

    // nearby sibling text
    const near = nearbyText(el);
    if (near) add(near.text, 'sibling', Math.max(0.2, WEIGHTS.sibling - 0.1 * near.depth));

    // name / id (humanized) as last-resort hints
    const name = el.getAttribute('name');
    if (name && !looksGenerated(name)) add(humanize(name), 'name', WEIGHTS.name);
    if (el.id && !looksGenerated(el.id)) add(humanize(el.id), 'id', WEIGHTS.id);

    // Dedupe by lowercase text, keep the highest-weighted source.
    const best = new Map();
    raw.forEach((l) => {
      const key = l.text.toLowerCase();
      const cur = best.get(key);
      if (!cur || l.weight > cur.weight) best.set(key, l);
    });

    const labels = Array.from(best.values()).sort((a, b) => b.weight - a.weight);
    return {
      labels,                                        // full detail, sorted by weight
      label: labels.length ? labels[0].text : null,  // single best label
      candidates: labels.filter((l) => l.source !== 'placeholder-example').map((l) => l.text.toLowerCase()) // flat set for P2's matcher (example hints excluded)
    };
  }

  // Nearest fieldset legend, useful context for radio/checkbox groups.
  function groupLabel(el) {
    const fs = el.closest('fieldset');
    const legend = fs && fs.querySelector('legend');
    return legend ? cleanText(legend.textContent) || null : null;
  }

  function selectOptions(el) {
    return Array.from(el.options).slice(0, 50).map((o) => ({
      value: o.value,
      text: cleanText(o.textContent)
    }));
  }

  function scanFields() {
    const candidates = document.querySelectorAll('input, select, textarea');
    const fields = [];

    candidates.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;

      if (tag === 'input' && SKIP_INPUT_TYPES.has(type)) return;
      if (el.disabled) return;

      const verbaId = ensureVerbaId(el);
      const lab = generateLabels(el);

      const field = {
        verbaId,
        selector: `[${ID_ATTR}="${verbaId}"]`,
        id: el.id || null,
        name: el.getAttribute('name') || null,
        tag,
        type,
        placeholder: el.getAttribute('placeholder') || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        autocomplete: el.getAttribute('autocomplete') || null,
        required: !!el.required,
        readOnly: !!el.readOnly,
        visible: isVisible(el),
        group: groupLabel(el),
        label: lab.label,
        labels: lab.labels,
        candidates: lab.candidates
      };

      if (tag === 'select') field.options = selectOptions(el);
      if (type === 'radio' || type === 'checkbox') {
        field.checked = !!el.checked;
        field.value = el.value;
      }

      fields.push(field);
    });

    return fields;
  }

  // ---------------------------------------------------------------------------
  // W4: native-value injector (Module D execution)
  // ---------------------------------------------------------------------------

  // React/Angular track an input's value on the element instance. Assigning
  // `el.value = x` goes through that instance setter, so the framework thinks
  // nothing changed and drops the following `input` event. Calling the setter
  // from the prototype bypasses the tracker, so the event is seen as a real edit.
  function nativeSet(el, prop, value) {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (desc && desc.set) desc.set.call(el, value);
    else el[prop] = value;
  }

  function fireEvents(el) {
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(el.value) }));
    } catch (e) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function buildIsoDate(y, mo, d) {
    const yy = +y, mm = +mo, dd = +d;
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${String(yy).padStart(4, '0')}-${p(mm)}-${p(dd)}`;
  }

  function monthIndex(name) {
    if (name.length < 3) return -1;
    return MONTHS.findIndex((m) => name.startsWith(m));
  }

  // <input type="date"> only accepts yyyy-mm-dd. Numeric dates are read as
  // dd/mm/yyyy (Indian convention); month names work in either order.
  function toIsoDate(input) {
    const s = String(input).trim().toLowerCase()
      .replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ').replace(/\s+/g, ' ');
    let m, mi;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return buildIsoDate(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return buildIsoDate(m[3], m[2], m[1]);
    if ((m = s.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/)) && (mi = monthIndex(m[2])) >= 0) return buildIsoDate(m[3], mi + 1, m[1]);
    if ((m = s.match(/^([a-z]+) (\d{1,2}) (\d{4})$/)) && (mi = monthIndex(m[1])) >= 0) return buildIsoDate(m[3], mi + 1, m[2]);
    return null;
  }

  // "alex at gmail dot com" -> "alex@gmail.com" (speech-to-text output)
  function spokenEmailToText(v) {
    const s = String(v).trim();
    if (s.includes('@')) return s.replace(/\s+/g, '');
    return s.replace(/\s+at\s+/i, '@').replace(/\s+dot\s+/gi, '.').replace(/\s+/g, '');
  }

  function findOption(select, wanted) {
    const w = String(wanted).trim().toLowerCase();
    const opts = Array.from(select.options);
    return opts.find((o) => o.value.toLowerCase() === w)
      || opts.find((o) => cleanText(o.textContent).toLowerCase() === w)
      || opts.find((o) => o.value !== '' && cleanText(o.textContent).toLowerCase().startsWith(w))
      || opts.find((o) => o.value !== '' && cleanText(o.textContent).toLowerCase().includes(w))
      || null;
  }

  function fillField(payload) {
    if (!payload || !payload.selector || payload.value === undefined || payload.value === null) {
      return { ok: false, error: 'missing selector or value' };
    }
    let el;
    try { el = document.querySelector(payload.selector); }
    catch (e) { return { ok: false, error: 'invalid selector' }; }
    if (!el) return { ok: false, error: 'element not found' };

    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (!isField) return { ok: false, error: 'not a fillable element' };
    if (el.disabled) return { ok: false, error: 'field is disabled' };
    if (el.readOnly) return { ok: false, error: 'field is read-only' };

    const type = el instanceof HTMLInputElement ? (el.getAttribute('type') || 'text').toLowerCase() : el.tagName.toLowerCase();
    const raw = String(payload.value);
    const previous = (type === 'checkbox' || type === 'radio') ? el.checked : el.value;

    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    if (type === 'checkbox' || type === 'radio') {
      const yes = /^(yes|true|on|checked?|tick(ed)?|select(ed)?|1)$/i.test(raw.trim());
      const no = /^(no|false|off|unchecked?|untick(ed)?|deselect(ed)?|0)$/i.test(raw.trim());
      if (!yes && !no) return { ok: false, error: `cannot read "${raw}" as yes/no` };
      if (type === 'radio' && no) return { ok: false, error: 'a radio button cannot be unchecked' };
      if (el.checked !== yes) el.click(); // click fires the events frameworks listen for
      if (el.checked !== yes) return { ok: false, error: 'checked state did not change' };
      if (payload.highlight !== false) highlight(el);
      return { ok: true, selector: payload.selector, previous, value: el.checked };
    }

    if (type === 'select') {
      const opt = findOption(el, raw);
      if (!opt) {
        return { ok: false, error: `no option matching "${raw}"`, options: Array.from(el.options).map((o) => cleanText(o.textContent)) };
      }
      nativeSet(el, 'value', opt.value);
      fireEvents(el);
      if (payload.highlight !== false) highlight(el);
      return { ok: true, selector: payload.selector, previous, value: el.value, text: cleanText(opt.textContent) };
    }

    let next = raw;
    if (type === 'date') {
      next = toIsoDate(raw);
      if (!next) return { ok: false, error: `could not read "${raw}" as a date` };
    } else if (type === 'email') {
      next = spokenEmailToText(raw);
    } else if (type === 'number') {
      next = raw.replace(/[,\s]/g, '');
    }

    nativeSet(el, 'value', next);
    fireEvents(el);

    if (el.value !== next) {
      return { ok: false, error: 'the page rejected or changed the value', previous, value: el.value };
    }
    if (payload.highlight !== false) highlight(el);
    return { ok: true, selector: payload.selector, previous, value: el.value };
  }

  // ---------------------------------------------------------------------------
  // W4: green highlight on filled fields
  // ---------------------------------------------------------------------------

  const HL_ATTR = 'data-verba-filled';
  const HL_PROPS = ['box-shadow', 'background-color', 'outline', 'outline-offset'];
  const savedStyles = new WeakMap();

  function highlight(el) {
    if (!savedStyles.has(el)) {
      const saved = {};
      HL_PROPS.forEach((p) => { saved[p] = [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]; });
      savedStyles.set(el, saved);
    }
    el.style.setProperty('box-shadow', '0 0 0 3px rgba(22, 163, 74, 0.45)', 'important');
    el.style.setProperty('background-color', '#dcfce7', 'important');
    el.style.setProperty('outline', '2px solid #16a34a', 'important');
    el.style.setProperty('outline-offset', '1px', 'important');
    el.setAttribute(HL_ATTR, 'true');
  }

  function clearHighlight(el) {
    const saved = savedStyles.get(el);
    if (saved) {
      HL_PROPS.forEach((p) => {
        const [v, pri] = saved[p];
        if (v) el.style.setProperty(p, v, pri); else el.style.removeProperty(p);
      });
      savedStyles.delete(el);
    }
    el.removeAttribute(HL_ATTR);
  }

  // The user typing in a filled field means it is theirs now: drop the highlight.
  // Our own synthetic events have isTrusted === false, so they never trigger this.
  ['input', 'change'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      const t = e.target;
      if (e.isTrusted && t && t.hasAttribute && t.hasAttribute(HL_ATTR)) clearHighlight(t);
    }, true);
  });

  // ---------------------------------------------------------------------------
  // W4: MutationObserver - tell the background when the page's fields change
  // (multi-step forms, fields injected after load, panels shown/hidden)
  // ---------------------------------------------------------------------------

  const FIELD_SELECTOR = 'input, select, textarea';
  let lastSignature = null;
  let debounceTimer = null;
  let observer = null;

  function signature(fields) {
    return fields.map((f) => f.verbaId + (f.visible ? '1' : '0')).join(',');
  }

  function touchesFields(node) {
    return node.nodeType === Node.ELEMENT_NODE &&
      ((node.matches && node.matches(FIELD_SELECTOR)) || (node.querySelector && node.querySelector(FIELD_SELECTOR)));
  }

  function isRelevantMutation(m) {
    if (m.type === 'childList') {
      return Array.from(m.addedNodes).some(touchesFields) || Array.from(m.removedNodes).some(touchesFields);
    }
    if (m.type === 'attributes') {
      // our own highlight edits the style attribute - ignore those
      if (m.attributeName === 'style' && m.target.hasAttribute && m.target.hasAttribute(HL_ATTR)) return false;
      return touchesFields(m.target);
    }
    return false;
  }

  function onFieldsMaybeChanged() {
    const fields = scanFields();
    const sig = signature(fields);
    if (sig === lastSignature) return;
    lastSignature = sig;
    try {
      chrome.runtime.sendMessage(
        { type: 'FIELDS_CHANGED', payload: { url: location.href, count: fields.length } },
        () => { if (chrome.runtime.lastError) { /* safe to ignore */ } }
      );
    } catch (e) {
      // extension was reloaded; this script is orphaned
      if (observer) observer.disconnect();
    }
  }

  function startFieldObserver() {
    if (!document.body || observer) return;
    lastSignature = signature(scanFields());
    observer = new MutationObserver((mutations) => {
      if (!mutations.some(isRelevantMutation)) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(onFieldsMaybeChanged, 400);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'class', 'style']
    });
  }

  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY', url: location.href }, () => {
    if (chrome.runtime.lastError) { /* safe to ignore */ }
  });

  startFieldObserver();
})();
