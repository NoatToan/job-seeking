"use client";

import { useEffect } from "react";
import type { JobDetail } from "@ujc/core";
import { SITE_NAME } from "@/lib/site";
import { jobMetaDescription } from "@/lib/job-posting";

function setMeta(selector: string, attr: "name" | "property", key: string, value: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  const created = !el;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  const previous = el.content;
  el.content = value;
  return () => {
    if (created) el.remove();
    else el.content = previous;
  };
}

/**
 * `/jobs/view/?id=` renders in the browser, so its title and description are set here once the
 * job loads, and restored on leaving. That page is `noindex` (the indexable copy is the static
 * `/jobs/<slug>/` page, which carries the canonical URL and the `JobPosting` JSON-LD), so no
 * canonical or structured data is added here.
 */
export function JobSeo({ job }: { job: JobDetail }) {
  useEffect(() => {
    const title = `${job.title} at ${job.company} · ${SITE_NAME}`;
    const description = jobMetaDescription(job);
    const previousTitle = document.title;
    document.title = title;
    const restore = [
      setMeta('meta[name="description"]', "name", "description", description),
      setMeta('meta[property="og:title"]', "property", "og:title", title),
      setMeta('meta[property="og:description"]', "property", "og:description", description),
    ];
    return () => {
      document.title = previousTitle;
      restore.forEach((r) => r());
    };
  }, [job]);
  return null;
}
