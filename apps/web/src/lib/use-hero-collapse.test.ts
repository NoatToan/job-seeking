import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHeroCollapse } from "./use-hero-collapse";

function setup(extra?: (root: HTMLElement) => void) {
  const root = document.createElement("section");
  extra?.(root);
  document.body.appendChild(root);
  const list = document.createElement("div");
  list.setAttribute("data-collapses-hero", "");
  document.body.appendChild(list);
  const hook = renderHook(() => useHeroCollapse({ current: root }));
  const scrollTo = (top: number) =>
    act(() => {
      list.scrollTop = top;
      list.dispatchEvent(new Event("scroll"));
    });
  return { hook, list, scrollTo, root };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useHeroCollapse", () => {
  it("folds when a marked list scrolls down past the headline and unfolds back at the top", () => {
    const { hook, scrollTo } = setup();
    expect(hook.result.current.collapsed).toBe(false);
    scrollTo(100);
    expect(hook.result.current.collapsed).toBe(false);
    scrollTo(400);
    expect(hook.result.current.collapsed).toBe(true);
    scrollTo(0);
    expect(hook.result.current.collapsed).toBe(false);
  });

  it("ignores scrollers that are not marked", () => {
    const { hook } = setup();
    const other = document.createElement("div");
    document.body.appendChild(other);
    act(() => {
      other.scrollTop = 500;
      other.dispatchEvent(new Event("scroll"));
    });
    expect(hook.result.current.collapsed).toBe(false);
  });

  it("peeks open on a resting mouse and folds again after the pointer leaves", () => {
    const { hook, scrollTo } = setup();
    scrollTo(400);
    act(() => hook.result.current.onPointerEnter({ pointerType: "mouse" } as never));
    act(() => vi.advanceTimersByTime(300));
    expect(hook.result.current.collapsed).toBe(false);
    act(() => hook.result.current.onPointerLeave());
    act(() => vi.advanceTimersByTime(350));
    expect(hook.result.current.collapsed).toBe(true);
  });

  it("does not peek on touch", () => {
    const { hook, scrollTo } = setup();
    scrollTo(400);
    act(() => hook.result.current.onPointerEnter({ pointerType: "touch" } as never));
    act(() => vi.advanceTimersByTime(1000));
    expect(hook.result.current.collapsed).toBe(true);
  });

  it("pins the folded state from the toggle, remembers it, and wins over hover", () => {
    const { hook } = setup();
    act(() => hook.result.current.toggle());
    expect(hook.result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("ujc:hero-collapsed")).toBe("1");
    act(() => hook.result.current.onPointerEnter({ pointerType: "mouse" } as never));
    act(() => vi.advanceTimersByTime(300));
    expect(hook.result.current.collapsed).toBe(true);
    act(() => hook.result.current.toggle());
    expect(hook.result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem("ujc:hero-collapsed")).toBeNull();
  });

  it("still folds while the hero's own toggle reports aria-expanded=true (regression)", () => {
    const { hook, scrollTo } = setup((root) => {
      const toggle = document.createElement("button");
      toggle.setAttribute("data-hero-toggle", "");
      toggle.setAttribute("aria-expanded", "true");
      root.appendChild(toggle);
      toggle.focus();
    });
    scrollTo(400);
    expect(hook.result.current.collapsed).toBe(true);
  });

  it("does not fold while a picker opened from the hero is open", () => {
    const { hook, scrollTo } = setup((root) => {
      const picker = document.createElement("button");
      picker.setAttribute("aria-expanded", "true");
      root.appendChild(picker);
    });
    scrollTo(400);
    expect(hook.result.current.collapsed).toBe(false);
  });
});
