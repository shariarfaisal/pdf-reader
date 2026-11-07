/**
 * Find/replace rules for narration text.
 *
 * Each rule is one "replace this with that" pair, scoped either to a whole
 * project (`page_number` NULL) or to a single page. Rules are applied to the
 * refined narration script — the text that is displayed and narrated — never to
 * the raw OCR layer, so the page's source text stays recoverable.
 */

/** Rules that apply to one page: project-wide first, then page-specific. */
export function rulesForPage(rules, pageNumber) {
  const projectWide = [];
  const pageScoped = [];
  for (const rule of rules || []) {
    if (!rule.enabled) continue;
    if (rule.page_number === null || rule.page_number === undefined) projectWide.push(rule);
    else if (rule.page_number === pageNumber) pageScoped.push(rule);
  }
  return [...projectWide, ...pageScoped];
}

/**
 * Version of the applied rules: the newest `updated_at` among them, or 0 when
 * there are none. Stored per page so cached scripts are not re-processed.
 */
export function rulesStamp(rules) {
  let stamp = 0;
  for (const rule of rules || []) {
    stamp = Math.max(stamp, Number(rule.updated_at) || 0);
  }
  return stamp;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply rules in order, replacing every occurrence.
 *
 * A literal rule replaces its exact text. A regex rule is compiled with the
 * global flag; an invalid pattern falls back to a literal replacement instead of
 * throwing away the whole page.
 */
export function applyTextRules(text, rules) {
  let output = typeof text === 'string' ? text : '';
  const applied = [];

  for (const rule of rules || []) {
    const find = rule.find;
    if (!find) continue;

    let count = 0;
    if (rule.is_regex) {
      try {
        const pattern = new RegExp(find, 'g');
        const matches = output.match(pattern);
        count = matches ? matches.length : 0;
        // Native replacement, so $1..$9 backreferences work as typed.
        if (count > 0) output = output.replace(pattern, rule.replace ?? '');
      } catch {
        count = 0;
      }
    } else {
      const parts = output.split(find);
      count = parts.length - 1;
      if (count > 0) output = parts.join(rule.replace ?? '');
    }

    if (count > 0) applied.push({ id: rule.id, find, count });
  }

  return { text: output, applied };
}
