import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Highlighted, highlightTerms, matchedTerms } from "./highlight";

describe("highlightTerms", () => {
  it("combines search words, tech labels with aliases, and feed keywords", () => {
    const terms = highlightTerms({ q: "senior and react", tech: ["nextjs"], keywords: ["TypeScript"] });
    expect(terms).toEqual(expect.arrayContaining(["senior", "react", "Next.js", "NextJS", "TypeScript"]));
    expect(terms).not.toContain("and");
  });

  it("de-duplicates case-insensitively, longest first", () => {
    expect(highlightTerms({ q: "React react", tech: ["react"] })[0]).toBe("React.js");
    expect(highlightTerms({ q: "React react" })).toEqual(["React"]);
  });
});

describe("Highlighted", () => {
  it("marks whole-word matches only, case-insensitively", () => {
    const { container } = render(
      <p>
        <Highlighted text="We use Go and Google Cloud; GO fans welcome" terms={["Go"]} />
      </p>,
    );
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["Go", "GO"]);
  });

  it("escapes regex characters in terms", () => {
    const { container } = render(<Highlighted text="C# and .NET (C++)" terms={["C#", ".NET", "C++"]} />);
    expect(container.querySelectorAll("mark")).toHaveLength(3);
  });
});

describe("matchedTerms", () => {
  it("lists which terms appear", () => {
    expect(matchedTerms("React and Node.js", ["Node.js", "Vue", "React"])).toEqual(["Node.js", "React"]);
  });
});
