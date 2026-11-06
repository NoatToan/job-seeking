import { describe, expect, it } from "vitest";
import { jobIdFromPath, jobPagePath, jobSlug, slugify } from "./job-url";

describe("slugify", () => {
  it("makes lowercase ASCII words joined by dashes", () => {
    expect(slugify("Senior Front-End Engineer (React/Next.js)")).toBe("senior-front-end-engineer-react-next-js");
  });

  it("drops Vietnamese diacritics, including đ", () => {
    expect(slugify("Kỹ sư phần mềm Đà Nẵng")).toBe("ky-su-phan-mem-da-nang");
  });

  it("keeps C++ and C# readable", () => {
    expect(slugify("C++ / C# Developer")).toBe("cpp-csharp-developer");
  });

  it("cuts long text on a word boundary", () => {
    const slug = slugify("word ".repeat(40), 30);
    expect(slug.length).toBeLessThanOrEqual(30);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.endsWith("word")).toBe(true);
  });

  it("returns an empty string when nothing is left", () => {
    expect(slugify("日本語 !!!")).toBe("");
  });
});

describe("jobSlug / jobPagePath", () => {
  it("is title, company, id", () => {
    expect(jobPagePath({ id: "123", title: "Backend Engineer", company: "Acme Inc." })).toBe(
      "/jobs/backend-engineer-acme-inc-123/",
    );
  });

  it("does not repeat a company the title already ends with", () => {
    expect(jobSlug({ id: "9", title: "Engineer at Acme", company: "Acme" })).toBe("engineer-at-acme-9");
  });

  it("falls back to 'job' for a title with no ASCII words", () => {
    expect(jobSlug({ id: "7", title: "エンジニア", company: "" })).toBe("job-7");
  });
});

describe("jobIdFromPath", () => {
  it("reads the id at the end of a job page path", () => {
    expect(jobIdFromPath("/jobs/backend-engineer-acme-123/")).toBe("123");
    expect(jobIdFromPath("/jobs/backend-engineer-acme-123")).toBe("123");
    expect(jobIdFromPath("/jobs/job-7/")).toBe("7");
  });

  it("ignores every other path", () => {
    expect(jobIdFromPath("/jobs/view/")).toBeNull();
    expect(jobIdFromPath("/jobs/")).toBeNull();
    expect(jobIdFromPath("/jobs/tech/react/")).toBeNull();
    expect(jobIdFromPath("/")).toBeNull();
    expect(jobIdFromPath("/tracker/123/")).toBeNull();
  });

  it("round-trips jobPagePath", () => {
    const job = { id: "98765", title: "Data Engineer 2", company: "Foo 42" };
    expect(jobIdFromPath(jobPagePath(job))).toBe("98765");
  });
});
