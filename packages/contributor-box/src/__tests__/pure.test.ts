import { afterEach, describe, expect, it, vi } from "vitest";
import { createFeedbackApi, type Request } from "../api";
import { includeInScreenshot } from "../capture";
import { safeHref } from "../safe-url";
import { cssSelectorFor, describeElement, isWidgetNode, WIDGET_ATTR } from "../selector";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("cssSelectorFor", () => {
  it("stops at a stable id", () => {
    document.body.innerHTML = `<main id="app"><div><button>A</button><button>B</button></div></main>`;
    const b = document.querySelectorAll("button")[1];
    expect(cssSelectorFor(b)).toBe("#app > div > button:nth-of-type(2)");
    expect(document.querySelector(cssSelectorFor(b))).toBe(b);
  });

  it("skips generated ids and prefers data-testid", () => {
    document.body.innerHTML = `<section data-testid='job "list"'><p id=":r12:">x</p></section>`;
    const p = document.querySelector("p")!;
    const sel = cssSelectorFor(p);
    expect(sel).toBe('[data-testid="job \\"list\\""] > p');
    expect(document.querySelector(sel)).toBe(p);
  });

  it("is bounded in depth and never includes html/body", () => {
    document.body.innerHTML = "<div><div><div><div><div><div><div><div><span>x</span></div></div></div></div></div></div></div></div>";
    const sel = cssSelectorFor(document.querySelector("span")!);
    expect(sel.split(" > ")).toHaveLength(6);
    expect(sel).not.toMatch(/body|html/);
  });
});

describe("describeElement", () => {
  it("collapses whitespace, clips, and never reads input values", () => {
    document.body.innerHTML = `<button>  Save
      job  </button><input type="password" value="hunter2" placeholder="Password">`;
    expect(describeElement(document.querySelector("button")!)).toBe("Save job");
    expect(describeElement(document.querySelector("input")!)).toBe("Password");
    expect(describeElement(document.querySelector("button")!, 4)).toBe("Sav…");
  });
});

describe("isWidgetNode / includeInScreenshot", () => {
  it("excludes the widget, host-marked areas and password inputs", () => {
    document.body.innerHTML = `<div ${WIDGET_ATTR}><b>w</b></div><div data-contrib-exclude>s</div><input type="password"><input type="text"><p>ok</p>`;
    expect(isWidgetNode(document.querySelector("b"))).toBe(true);
    expect(includeInScreenshot(document.querySelector(`[${WIDGET_ATTR}]`)!)).toBe(false);
    expect(includeInScreenshot(document.querySelector("[data-contrib-exclude]")!)).toBe(false);
    expect(includeInScreenshot(document.querySelector("input[type=password]")!)).toBe(false);
    expect(includeInScreenshot(document.querySelector("input[type=text]")!)).toBe(true);
    expect(includeInScreenshot(document.querySelector("p")!)).toBe(true);
    expect(includeInScreenshot(document.createTextNode("t"))).toBe(true);
  });
});

describe("safeHref", () => {
  it.each([
    ["https://example.com/a?b=1", "https://example.com/a?b=1"],
    ["http://localhost:3000/", "http://localhost:3000/"],
    ["/tracker/", "/tracker/"],
  ])("allows %s", (input, out) => expect(safeHref(input)).toBe(out));

  it.each(["javascript:alert(1)", " javascript:alert(1)", "data:text/html,x", "//evil.com", "/\\evil.com", "vbscript:x", "", null, undefined, "not a url"])(
    "rejects %s",
    (input) => expect(safeHref(input as string)).toBeNull(),
  );
});

describe("createFeedbackApi", () => {
  it("maps calls to paths, methods and bodies", async () => {
    const request = vi.fn(async () => ({}) as never);
    const api = createFeedbackApi(request as unknown as Request, { baseUrl: "http://api.test" });
    await api.list({ scope: "mine", kind: "bug", q: "", offset: 0 });
    await api.create({ kind: "idea", title: "abc" });
    await api.vote("7", true);
    await api.vote("7", false);
    await api.update("7", { status: "done" });
    await api.addNote("7", "hi", "public");
    await api.deleteNote("7", "3");
    await api.remove("a/b");
    expect(request.mock.calls).toEqual([
      ["/api/feedback?scope=mine&kind=bug&offset=0"],
      ["/api/feedback", { method: "POST", body: { kind: "idea", title: "abc" } }],
      ["/api/feedback/7/vote", { method: "PUT" }],
      ["/api/feedback/7/vote", { method: "DELETE" }],
      ["/api/feedback/7", { method: "PATCH", body: { status: "done" } }],
      ["/api/feedback/7/notes", { method: "POST", body: { body: "hi", visibility: "public" } }],
      ["/api/feedback/7/notes/3", { method: "DELETE" }],
      ["/api/feedback/a%2Fb", { method: "DELETE" }],
    ]);
    expect(api.screenshotUrl("7")).toBe("http://api.test/api/feedback/7/screenshot");
  });
});

describe("authorLabel", () => {
  it("shows the email, a guest's name, or Anonymous", async () => {
    const { authorLabel } = await import("../admin");
    const { makeItem } = await import("./helpers");
    expect(authorLabel(makeItem({ author: { id: "2", email: "b@x.test", name: null, anonymous: false } }), "Anonymous")).toBe("b@x.test");
    expect(authorLabel(makeItem({ author: { id: null, email: null, name: "Minh", anonymous: true } }), "Anonymous")).toBe("Minh (Anonymous)");
    expect(authorLabel(makeItem({ author: { id: null, email: null, name: null, anonymous: true } }), "Anonymous")).toBe("Anonymous");
    expect(authorLabel(makeItem({ author: null }), "Anonymous")).toBe("—");
  });
});
