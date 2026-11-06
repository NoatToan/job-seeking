import { afterEach, describe, expect, it } from "vitest";
import { setSnapshotForTests, type SeoJob } from "@/lib/seo-jobs";
import { relatedJobHref } from "./job-link";

const job = { id: "42", title: "Senior React Engineer", company: "Acme" } as SeoJob;

describe("relatedJobHref", () => {
  afterEach(() => setSnapshotForTests(null));

  it("links the static job page when the build has one", () => {
    setSnapshotForTests({ generatedAt: "2026-11-06T00:00:00Z", jobs: [job] });
    expect(relatedJobHref(42)).toBe("/jobs/senior-react-engineer-acme-42/");
  });

  it("falls back to the live job screen otherwise", () => {
    setSnapshotForTests({ generatedAt: "2026-11-06T00:00:00Z", jobs: [job] });
    expect(relatedJobHref(7)).toBe("/jobs/view/?id=7");
  });
});
