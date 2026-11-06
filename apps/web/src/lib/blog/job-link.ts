import { jobPagePath } from "@/lib/job-url";
import { jobById } from "@/lib/seo-jobs";
import { jobPath } from "./model";

/**
 * Link target for a job a blog post recommends. Build-time only (reads the SEO job snapshot):
 * the job's static, indexable page (`/jobs/<slug>/`, ARCHITECTURE.md D12) when this build has one,
 * else the live job screen `/jobs/view/?id=` (noindex, follow), which covers jobs that are older
 * than the SEO window or have no description. Linking a static URL that was not built would 404.
 */
export function relatedJobHref(id: number): string {
  const job = jobById(String(id));
  return job ? jobPagePath(job) : jobPath(id);
}
