/**
 * Public, indexable URL of one job: `/jobs/<title>-<company>-<id>/` (docs/product/ARCHITECTURE.md
 * D12). The slug words are for people and search engines; only the trailing id identifies the job,
 * so a renamed job keeps working (the 404 page sends an unknown slug on to `/jobs/view/?id=`).
 * Shared by the build (static pages, sitemap) and the browser (home panel "Open job page").
 */

const MAX_PART_LENGTH = 60;

/** Lowercase ASCII words joined by "-": "Kỹ sư Front-end (React)" → "ky-su-front-end-react". */
export function slugify(text: string, maxLength = MAX_PART_LENGTH): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\+\+/g, "pp")
    .replace(/#/g, "sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length <= maxLength) return ascii;
  // Cut on a word boundary when there is one in the second half.
  const cut = ascii.slice(0, maxLength);
  const dash = cut.lastIndexOf("-");
  return (dash > maxLength / 2 ? cut.slice(0, dash) : cut).replace(/-+$/g, "");
}

export interface SluggableJob {
  id: string;
  title: string;
  company: string;
}

/** "senior-react-engineer-acme-12345" (title words, company words, id). */
export function jobSlug(job: SluggableJob): string {
  const title = slugify(job.title);
  const company = slugify(job.company, 40);
  // Don't repeat the company when the title already ends with it ("… at Acme").
  const words = [title || "job", company && !title.endsWith(company) ? company : ""].filter(Boolean);
  return `${words.join("-")}-${job.id}`;
}

/** `/jobs/<slug>/` (trailing slash, like every exported route). */
export function jobPagePath(job: SluggableJob): string {
  return `/jobs/${jobSlug(job)}/`;
}

/** The job id of a job page path (`/jobs/<words>-<id>/`), or null for any other path. */
export function jobIdFromPath(pathname: string): string | null {
  const match = /^\/jobs\/(?:[a-z0-9-]*-)?(\d+)\/?$/i.exec(pathname);
  return match ? match[1] : null;
}
