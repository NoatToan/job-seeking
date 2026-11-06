// Shape of apps/web/src/content/release-notes.json and of the entry Claude writes for it.
// Plain ESM with no dependencies: the GitHub Actions generator (generate.mjs) and the web app's
// tests both import it, so the committed file and the AI output are checked by the same rules.

/** Highlight categories, in display order. */
export const CATEGORIES = /** @type {const} */ (["new", "improved", "fixed", "under-the-hood"]);

/** Most highlights one entry may carry (keeps a day readable). */
export const MAX_HIGHLIGHTS = 8;
/** Longest highlight line, in characters (one line on a phone, roughly). */
export const MAX_HIGHLIGHT_LENGTH = 160;
/** Longest entry title, in characters. */
export const MAX_TITLE_LENGTH = 80;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const SCREENSHOT_RE = /^\/[A-Za-z0-9/_.-]+\.(png|jpe?g|webp|avif)$/;

const localized = {
  type: "object",
  properties: { en: { type: "string" }, vi: { type: "string" } },
  required: ["en", "vi"],
  additionalProperties: false,
};

/**
 * JSON Schema for Claude's structured output (`output_config.format`). Only the parts the model
 * writes: the date, slug and commit range come from git, not from the model. Length limits are not
 * expressible in structured-output schemas, so `validateAiOutput` checks them afterwards.
 */
export const AI_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    skip: {
      type: "boolean",
      description: "true when none of the commits changes anything a visitor of the site would notice.",
    },
    title: localized,
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          en: { type: "string" },
          vi: { type: "string" },
        },
        required: ["category", "en", "vi"],
        additionalProperties: false,
      },
    },
  },
  required: ["skip", "title", "highlights"],
  additionalProperties: false,
};

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkText(errors, path, value, max) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${path} must be a non-empty string`);
  else if (value.length > max) errors.push(`${path} is longer than ${max} characters`);
  else if (/[\r\n]/.test(value)) errors.push(`${path} must be one line`);
}

function checkLocalized(errors, path, value, max) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object with en and vi`);
    return;
  }
  checkText(errors, `${path}.en`, value.en, max);
  checkText(errors, `${path}.vi`, value.vi, max);
}

function checkHighlights(errors, path, value) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  if (value.length > MAX_HIGHLIGHTS) errors.push(`${path} has more than ${MAX_HIGHLIGHTS} items`);
  value.forEach((h, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(h)) {
      errors.push(`${p} must be an object`);
      return;
    }
    if (!CATEGORIES.includes(h.category)) errors.push(`${p}.category must be one of ${CATEGORIES.join(", ")}`);
    checkText(errors, `${p}.en`, h.en, MAX_HIGHLIGHT_LENGTH);
    checkText(errors, `${p}.vi`, h.vi, MAX_HIGHLIGHT_LENGTH);
  });
}

/** Errors in one stored entry (empty = valid). */
export function validateEntry(entry, path = "entry") {
  const errors = [];
  if (!isObject(entry)) return [`${path} must be an object`];
  if (typeof entry.date !== "string" || !DATE_RE.test(entry.date) || Number.isNaN(Date.parse(entry.date))) {
    errors.push(`${path}.date must be YYYY-MM-DD`);
  }
  if (typeof entry.slug !== "string" || !SLUG_RE.test(entry.slug)) errors.push(`${path}.slug must look like 2026-11-07`);
  checkLocalized(errors, `${path}.title`, entry.title, MAX_TITLE_LENGTH);
  checkHighlights(errors, `${path}.highlights`, entry.highlights);
  if (entry.screenshot !== undefined && (typeof entry.screenshot !== "string" || !SCREENSHOT_RE.test(entry.screenshot))) {
    errors.push(`${path}.screenshot must be an absolute image path under public/`);
  }
  const c = entry.commits;
  if (!isObject(c)) errors.push(`${path}.commits must be an object`);
  else {
    if (typeof c.from !== "string" || !SHA_RE.test(c.from)) errors.push(`${path}.commits.from must be a commit sha`);
    if (typeof c.to !== "string" || !SHA_RE.test(c.to)) errors.push(`${path}.commits.to must be a commit sha`);
    if (!Number.isInteger(c.count) || c.count < 1) errors.push(`${path}.commits.count must be a positive integer`);
  }
  const known = new Set(["date", "slug", "title", "highlights", "screenshot", "commits"]);
  for (const key of Object.keys(entry)) if (!known.has(key)) errors.push(`${path}.${key} is not a known field`);
  return errors;
}

/** Errors in the whole file (empty = valid): newest entry first, unique slugs. */
export function validateReleaseNotes(data) {
  if (!isObject(data)) return ["release notes must be an object"];
  const errors = [];
  if (data.version !== 1) errors.push("version must be 1");
  if (!Array.isArray(data.entries)) return [...errors, "entries must be an array"];
  const slugs = new Set();
  data.entries.forEach((entry, i) => {
    errors.push(...validateEntry(entry, `entries[${i}]`));
    if (isObject(entry)) {
      if (slugs.has(entry.slug)) errors.push(`entries[${i}].slug ${entry.slug} is used twice`);
      slugs.add(entry.slug);
      const prev = data.entries[i - 1];
      if (i > 0 && isObject(prev) && typeof prev.date === "string" && typeof entry.date === "string" && entry.date > prev.date) {
        errors.push(`entries[${i}] is newer than entries[${i - 1}] (keep newest first)`);
      }
    }
  });
  return errors;
}

/** Errors in Claude's structured output (empty = valid). A skip needs no title or highlights. */
export function validateAiOutput(out) {
  if (!isObject(out)) return ["output must be an object"];
  if (typeof out.skip !== "boolean") return ["skip must be a boolean"];
  if (out.skip) return [];
  const errors = [];
  checkLocalized(errors, "title", out.title, MAX_TITLE_LENGTH);
  checkHighlights(errors, "highlights", out.highlights);
  return errors;
}
