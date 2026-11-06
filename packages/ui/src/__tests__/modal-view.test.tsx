import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalView } from "../index";
import type { ModalViewHandle } from "../index";

afterEach(cleanup);

function Harness({ onApply = vi.fn(), onDismiss = vi.fn(), onOpen = vi.fn() }) {
  const ref = useRef<ModalViewHandle>(null);
  const [step, setStep] = useState<"list" | "sub">("list");
  return (
    <>
      <button type="button" onClick={() => ref.current?.open()}>
        Filters
      </button>
      <ModalView
        ref={ref}
        title={step === "list" ? "Filters" : "Country"}
        onOpen={onOpen}
        onDismiss={onDismiss}
        onBack={step === "sub" ? () => setStep("list") : undefined}
        footer={
          <button type="button" onClick={() => ref.current?.close(onApply)}>
            Apply
          </button>
        }
      >
        {step === "list" ? (
          <button type="button" onClick={() => setStep("sub")}>
            Country
          </button>
        ) : (
          <input aria-label="Search countries" />
        )}
      </ModalView>
    </>
  );
}

describe("ModalView (imperative handle)", () => {
  it("opens through the handle, moves focus inside, and Esc closes it back to the opener", async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<Harness onOpen={onOpen} onDismiss={onDismiss} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    const opener = screen.getByRole("button", { name: "Filters" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("Esc in a sub-step goes back one step instead of closing", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    expect(screen.getByRole("dialog", { name: "Country" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeTruthy();
  });

  it("pushes one history entry while open; close(then) pops it and runs `then` afterwards", async () => {
    const onApply = vi.fn();
    render(<Harness onApply={onApply} />);
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(window.history.length).toBe(before + 1);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // Not yet: the entry is popped first, so writing URL state can't be undone by the pop.
    expect(onApply).not.toHaveBeenCalled();
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the system Back gesture dismisses it", async () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
