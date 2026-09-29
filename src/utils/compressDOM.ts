/**
 * compressDOM.ts
 *
 * Returns a self-contained client-side script string that, when injected into
 * a Playwright page via page.evaluate(), scans the live DOM and produces a
 * minimal JSON array of interactive elements.
 *
 * Each element is stamped with a unique `jev-id` attribute so that Playwright
 * can address it with a precise, stable locator:
 *   page.locator('[jev-id="A1"]')
 *
 * Output shape (serialised JSON string):
 *   [
 *     { "id": "A1", "tag": "BUTTON", "role": "button", "text": "Checkout",
 *       "ariaLabel": "Proceed to checkout", "placeholder": null,
 *       "name": null, "type": null },
 *     ...
 *   ]
 */

/** Schema for a single compressed DOM element — mirrored on both sides. */
export interface CompressedElement {
  /** Injected jev-id value, e.g. "A1" */
  id: string;
  /** Upper-cased HTML tag name */
  tag: string;
  /** Resolved ARIA role */
  role: string;
  /** Visible text content (trimmed, max 120 chars) */
  text: string | null;
  /** aria-label attribute value */
  ariaLabel: string | null;
  /** placeholder attribute value (inputs) */
  placeholder: string | null;
  /** name attribute value */
  name: string | null;
  /** type attribute value */
  type: string | null;
  /**
   * Coarse vertical zone of the element's center: 'header' (top 12% of
   * viewport), 'footer' (bottom 10%), or 'main'. Lets the heuristic prefer
   * page content over site chrome without shipping full coordinates.
   */
  zone?: 'header' | 'main' | 'footer';
}

/**
 * Returns a minified, self-executing JavaScript expression (as a string)
 * suitable for use inside page.evaluate().
 *
 * The script:
 *  1. Queries the body for all potentially interactive elements.
 *  2. Filters out hidden / disabled / inert elements.
 *  3. Stamps each surviving element with a unique `jev-id`.
 *  4. Collects the minimal schema-conforming fields.
 *  5. Returns a JSON string (not a parsed object — keeps the page boundary simple).
 */
export function getCompressDOMScript(): string {
  // The function below is serialised as a string and executed in the browser
  // context. Keep it dependency-free and ES5-compatible for maximum
  // compatibility across browser engines.
  const clientScript = `(function compressDOM() {
  var INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[onclick]',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
    '[role="slider"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function visRect(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return null;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return null;
    var rect = el.getBoundingClientRect();
    // Allow elements that are in the DOM but scrolled out of viewport
    return (rect.width > 0 && rect.height > 0) ? rect : null;
  }

  function zoneOf(rect) {
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    // Sticky page headers sit at the top of the viewport even when scrolled.
    if (rect.top + rect.height / 2 < vh * 0.12) return 'header';
    // Footer check must be document-relative: elements simply scrolled out
    // below the fold have a huge viewport-relative top but are main content.
    var ycDoc = rect.top + rect.height / 2 + (window.scrollY || window.pageYOffset || 0);
    var docH = document.documentElement.scrollHeight || document.body.scrollHeight || vh;
    if (ycDoc > docH - vh * 1.2) return 'footer';
    return 'main';
  }

  function resolveRole(el) {
    var explicit = el.getAttribute('role');
    if (explicit) return explicit;
    var tag = el.tagName.toUpperCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A') return 'link';
    if (tag === 'INPUT') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'textbox';
    }
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    return 'generic';
  }

  function safeText(el) {
    var t = (el.innerText || el.textContent || '').trim();
    return t.length > 0 ? t.substring(0, 120) : null;
  }

  function attr(el, name) {
    var v = el.getAttribute(name);
    return v !== null && v.trim().length > 0 ? v.trim() : null;
  }

  // Encode index as base-26 uppercase letters: 0→A, 25→Z, 26→AA …
  function encodeId(n) {
    var result = '';
    n = n + 1; // 1-based
    while (n > 0) {
      n--;
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return result;
  }

  var seen = new Set();
  var elements = Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE_SELECTORS));
  var results = [];
  var counter = 0;

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    // De-duplicate (a single element may match multiple selectors)
    if (seen.has(el)) continue;
    seen.add(el);
    var rect = visRect(el);
    if (!rect) continue;

    var id = encodeId(counter++);
    el.setAttribute('jev-id', id);

    results.push({
      id: id,
      tag: el.tagName.toUpperCase(),
      role: resolveRole(el),
      text: safeText(el),
      ariaLabel: attr(el, 'aria-label'),
      placeholder: attr(el, 'placeholder'),
      name: attr(el, 'name'),
      type: attr(el, 'type'),
      zone: zoneOf(rect)
    });
  }

  return JSON.stringify(results);
})()`;

  // Minify whitespace while preserving string literals
  return clientScript
    .replace(/\/\/[^\n]*/g, '')   // strip line comments
    .replace(/\n\s*/g, ' ')       // collapse newlines + indent
    .replace(/  +/g, ' ')         // collapse repeated spaces
    .trim();
}
