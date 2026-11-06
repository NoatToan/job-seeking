import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEEP_LINK_SITES, SOURCE_IDS, sourceMeta } from "@ujc/core";
import { SOURCE_ICONS, SourceBadge, SourceDot, SourceIcon, sourceIconId, sourceSelectOption } from "../index";
import type { SourceIconId } from "../index";

afterEach(cleanup);

const css = readFileSync(join(__dirname, "../source-icons.css"), "utf8");
const ruleIds = [...css.matchAll(/\.ujc-source-icon\[data-source="([a-z]+)"\]/g)].map((m) => m[1]);

describe("SourceIcon", () => {
  it("has an icon for every crawled source, with the same name as the source registry", () => {
    for (const id of SOURCE_IDS) {
      expect(sourceIconId(id), id).toBe(id);
      expect(SOURCE_ICONS[id as SourceIconId].label).toBe(sourceMeta(id).label);
    }
  });

  it("has an icon for every deep-link site and every live-search platform id", () => {
    for (const site of DEEP_LINK_SITES) expect(sourceIconId(site.label), site.label).not.toBeNull();
    for (const id of ["seek", "himalayas", "remotive", "wwr", "arc"]) expect(sourceIconId(id), id).not.toBeNull();
  });

  it("every icon has exactly one image rule in the generated stylesheet, and no rule is orphaned", () => {
    expect([...ruleIds].sort()).toEqual(Object.keys(SOURCE_ICONS).sort());
    for (const id of ruleIds) {
      const rule = css.split(`[data-source="${id}"]`)[1].split("}")[0];
      expect(rule, id).toMatch(/background-image: url\("data:image\/(png;base64|svg\+xml),/);
    }
  });

  it("never points the browser at another host (CSP img-src: self + data:)", () => {
    expect(css).not.toMatch(/url\("?https?:/);
  });

  it.each(Object.keys(SOURCE_ICONS) as SourceIconId[])("%s: role img with the source's accessible name", (id) => {
    render(<SourceIcon source={id} size={20} />);
    const img = screen.getByRole("img", { name: SOURCE_ICONS[id].label });
    expect(img.getAttribute("data-source")).toBe(id);
    expect(img.getAttribute("title")).toBe(SOURCE_ICONS[id].label);
    expect(img.style.width).toBe("20px");
    expect(img.style.height).toBe("20px");
  });

  it("resolves aliases and labels", () => {
    expect(sourceIconId("wwr")).toBe("weworkremotely");
    expect(sourceIconId("We Work Remotely")).toBe("weworkremotely");
    expect(sourceIconId("YC Work at a Startup")).toBe("ycombinator");
    expect(sourceIconId("nowhere")).toBeNull();
  });

  it("decorative icons are hidden from assistive tech; a custom label overrides the name", () => {
    const { container } = render(
      <>
        <SourceIcon source="linkedin" decorative />
        <SourceIcon source="seek" label="Seek (Australia)" />
      </>,
    );
    expect(container.querySelector('[data-source="linkedin"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("img", { name: "LinkedIn" })).toBeNull();
    expect(screen.getByRole("img", { name: "Seek (Australia)" })).toBeTruthy();
  });

  it("marks without their own background get the white tile", () => {
    const { container } = render(
      <>
        <SourceIcon source="himalayas" />
        <SourceIcon source="linkedin" />
      </>,
    );
    expect(container.querySelector('[data-source="himalayas"]')?.hasAttribute("data-tile")).toBe(true);
    expect(container.querySelector('[data-source="linkedin"]')?.hasAttribute("data-tile")).toBe(false);
  });

  it("renders nothing for an unknown source", () => {
    const { container } = render(<SourceIcon source="nowhere" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("source labels keep the name as text next to the mark", () => {
  it("SourceDot: icon + 'via Himalayas', the name read once", () => {
    const { container } = render(<SourceDot source="himalayas" />);
    expect(screen.getByTitle("Crawled from Himalayas").textContent).toBe("via Himalayas");
    expect(container.querySelector('[data-source="himalayas"]')?.getAttribute("aria-hidden")).toBe("true");
  });

  it("SourceBadge: icon + name; an unknown source falls back to the colour dot", () => {
    const { container } = render(
      <>
        <SourceBadge source="linkedin" />
        <SourceBadge source="nowhere" />
      </>,
    );
    expect(screen.getByTitle("Crawled from LinkedIn").textContent).toBe("LinkedIn");
    expect(container.querySelector('[data-source="linkedin"]')).not.toBeNull();
    expect(screen.getByTitle("Crawled from nowhere").querySelector(".rounded-full")).not.toBeNull();
  });

  it("sourceSelectOption carries the icon for FuzzySelect", () => {
    const opt = sourceSelectOption("lever");
    expect(opt).toMatchObject({ value: "lever", label: "Lever", keywords: "lever" });
    const { container } = render(<>{opt.icon}</>);
    expect(container.querySelector('[data-source="lever"]')).not.toBeNull();
  });
});
