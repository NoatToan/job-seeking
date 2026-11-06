/** Attribute that marks contributor-box's own DOM: never picked, never in screenshots. */
export const WIDGET_ATTR = "data-contrib-widget";
/** Hosts mark sensitive DOM with this attribute to keep it out of screenshots. */
export const EXCLUDE_ATTR = "data-contrib-exclude";

const SIMPLE_IDENT = /^[A-Za-z][A-Za-z0-9_-]*$/;
// Ids such as `:r1:`, `radix-12`, `ember1234` or hashes change between renders; skip them.
const GENERATED_ID = /\d{3,}|^:|^(?:radix|headlessui|react|mui|ember)-/i;
const MAX_DEPTH = 6;

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

function stableId(el: Element): string | null {
  const id = el.getAttribute("id");
  return id && SIMPLE_IDENT.test(id) && !GENERATED_ID.test(id) ? id : null;
}

/**
 * A short, readable CSS selector for `el`: stops at the nearest stable id or `data-testid`,
 * otherwise a `tag:nth-of-type()` path up to MAX_DEPTH levels. Meant for humans reading the
 * report (and `document.querySelector` on the same page), not for guaranteed uniqueness.
 */
export function cssSelectorFor(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < MAX_DEPTH) {
    const tag = node.tagName.toLowerCase();
    if (tag === "html" || tag === "body") break;
    const id = stableId(node);
    if (id) {
      parts.unshift(`#${id}`);
      break;
    }
    const testId = node.getAttribute("data-testid");
    if (testId) {
      parts.unshift(`[data-testid=${quote(testId)}]`);
      break;
    }
    let part = tag;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ").slice(0, 1000);
}

/** Visible text of the element (or its accessible label), collapsed and clipped. Never an input's value. */
export function describeElement(el: Element, max = 120): string {
  const label =
    el.getAttribute("aria-label") ||
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.placeholder : "") ||
    el.textContent ||
    "";
  const text = label.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** True for nodes that belong to the widget itself (or are inside it). */
export function isWidgetNode(el: Element | null): boolean {
  return Boolean(el?.closest(`[${WIDGET_ATTR}]`));
}
