import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackWidget } from "../widget";
import { fakeApi, wrap } from "./helpers";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const SHOT = { dataUrl: "data:image/jpeg;base64,/9j/AA==", width: 800, height: 600 };

describe("FeedbackWidget", () => {
  it("asks signed-out visitors to sign in", () => {
    render(<FeedbackWidget />, { wrapper: wrap(fakeApi(), false) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(screen.getByText(/Sign in to send feedback/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login/");
  });

  it("validates the title before calling the API", async () => {
    const api = fakeApi();
    render(<FeedbackWidget />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    // Opening the panel focuses the title field, not the Close button.
    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ab" } });
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(await screen.findByText("Please write at least 3 characters.")).toBeTruthy();
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBe("true");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("points at an element, attaches an annotated screenshot and sends the page context", async () => {
    document.body.insertAdjacentHTML("afterbegin", `<main id="app"><button id="save-btn">Save job</button></main>`);
    const target = document.getElementById("save-btn")!;
    target.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 30, right: 110, bottom: 50, x: 10, y: 20, toJSON: () => ({}) });
    document.elementsFromPoint = vi.fn(() => [target]);
    const capture = vi.fn(async () => SHOT);
    const api = fakeApi();
    render(<FeedbackWidget capture={capture} />, { wrapper: wrap(api) });

    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByLabelText("Bug"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Save does nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Point at the page" }));

    const overlay = screen.getByTestId("contrib-picker");
    expect(screen.queryByRole("dialog")).toBeNull(); // panel hides while picking
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 30, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: 20, clientY: 30, button: 0 });
    expect(screen.queryByTestId("contrib-picker")).toBeNull();
    expect(await screen.findByText("Selected: Save job")).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Attach a screenshot/));
    await waitFor(() => expect(capture).toHaveBeenCalledWith({ highlight: { x: 10, y: 20, width: 100, height: 30 } }));
    expect(await screen.findByAltText(/Screenshot of the page/)).toBeTruthy();

    const submit = screen.getAllByRole("button", { name: "Send feedback" }).find((b) => b.getAttribute("type") === "submit")!;
    fireEvent.click(submit);
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const input = vi.mocked(api.create).mock.calls[0][0];
    expect(input).toMatchObject({
      kind: "bug",
      title: "Save does nothing",
      pageUrl: window.location.href,
      elementSelector: "#save-btn",
      elementText: "Save job",
      region: { x: 10, y: 20, width: 100, height: 30 },
      screenshot: SHOT.dataUrl,
      screenshotWidth: 800,
    });
    expect(await screen.findByText("Thank you!")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See all ideas" }).getAttribute("href")).toBe("/contribute/");
  });

  it("drags to select an area and keeps working when the screenshot fails", async () => {
    document.elementsFromPoint = vi.fn(() => []);
    const api = fakeApi();
    render(<FeedbackWidget capture={vi.fn(async () => Promise.reject(new Error("boom")))} />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Layout broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Point at the page" }));
    const overlay = screen.getByTestId("contrib-picker");
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: 60, clientY: 90 });
    fireEvent.pointerUp(overlay, { clientX: 60, clientY: 90, button: 0 });
    expect(await screen.findByText("Selected area: 50 × 80")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Attach a screenshot/));
    expect(await screen.findByText(/couldn't take a screenshot/)).toBeTruthy();
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const input = vi.mocked(api.create).mock.calls[0][0];
    expect(input.elementSelector).toBeNull();
    expect(input.region).toEqual({ x: 10, y: 10, width: 50, height: 80 });
    expect(input.screenshot).toBeNull();
  });

  it("Esc cancels the picker and then closes the panel", async () => {
    render(<FeedbackWidget />, { wrapper: wrap(fakeApi()) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Point at the page" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("contrib-picker")).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("picks with the keyboard (Tab, Arrow Up, Enter) and returns focus to the point button", async () => {
    document.body.insertAdjacentHTML("afterbegin", `<nav id="top"><a href="/a">Jobs</a><a href="/b">Tracker</a></nav>`);
    for (const el of Array.from(document.querySelectorAll("#top, #top a"))) {
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 50, height: 20, right: 50, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    }
    render(<FeedbackWidget />, { wrapper: wrap(fakeApi()) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.click(screen.getByRole("button", { name: "Point at the page" }));
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByTestId("contrib-picker").textContent).toContain("Tracker");
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByTestId("contrib-picker")).toBeNull();
    // Arrow Up widened the selection from the "Tracker" link to the whole <nav>.
    expect(await screen.findByText(/^Selected: Jobs ?Tracker$/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Point again"));
  });

  it("shows a friendly message when rate limited", async () => {
    const err = Object.assign(new Error("rate"), { status: 429 });
    const api = fakeApi({ create: vi.fn(async () => Promise.reject(err)) });
    render(<FeedbackWidget />, { wrapper: wrap(api) });
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Another one" } });
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(/a lot this hour/);
  });
});
