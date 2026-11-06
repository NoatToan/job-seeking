"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useContributor } from "./context";
import { FeedbackForm, type CaptureFn } from "./form";
import { WIDGET_ATTR } from "./selector";
import type { FeedbackItem } from "./types";
import { Button, ChatIcon, cx, XIcon } from "./ui";

export interface FeedbackWidgetProps {
  /** Extra classes for the fixed container, e.g. to lift it above a phone tab bar. */
  className?: string;
  capture?: CaptureFn;
}

/**
 * Floating "Send feedback" button on every page. Opens a non-modal panel (the page stays usable,
 * so the user can point at it): type, title, details, "point at the page" (element or area) and
 * an optional annotated screenshot. Page URL, title and viewport are attached automatically.
 */
export function FeedbackWidget({ className, capture }: FeedbackWidgetProps) {
  const { strings: s, signedIn, signInHref, boardHref, linkAs: Link } = useContributor();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState<FeedbackItem | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Focus the first field when the panel opens or switches to the "sent" view. Not when the
  // picker closes: the form returns focus to its "Point at the page" button itself.
  useEffect(() => {
    if (!open) return;
    // A selector list matches in document order, so look for the preferred field first.
    const panel = panelRef.current;
    const first =
      panel?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel?.querySelector<HTMLElement>("[role=status] button, [role=status] a, a, input") ??
      panel?.querySelector<HTMLElement>("button");
    first?.focus();
  }, [open, sent]);

  useEffect(() => {
    if (!open || picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picking]);

  function close() {
    setOpen(false);
    setSent(null);
    fabRef.current?.focus();
  }

  return (
    <div
      {...{ [WIDGET_ATTR]: "" }}
      className={cx("fixed right-4 bottom-4 z-[60] flex flex-col items-end gap-3 print:hidden", className)}
    >
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          // Hidden (not unmounted) while picking, so the form keeps its state.
          hidden={picking}
          className="flex max-h-[min(80dvh,40rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-sheet border border-separator bg-grouped-secondary text-label shadow-overlay animate-pop-in"
        >
          <div className="flex items-center justify-between gap-2 border-b border-separator px-4 py-3">
            <h2 id={titleId} className="text-headline">
              {s.panelTitle}
            </h2>
            <Button size="sm" variant="plain" onClick={close} aria-label={s.close}>
              <XIcon size={18} />
            </Button>
          </div>
          <div className="overflow-y-auto px-4 py-4">
            {!signedIn ? (
              <div className="flex flex-col gap-3">
                <p className="text-subheadline text-label-secondary">{s.signInPrompt}</p>
                {signInHref ? (
                  <Link
                    href={signInHref}
                    className="inline-flex min-h-11 items-center justify-center rounded-control bg-tint px-4 text-subheadline font-semibold text-on-tint focus-ring"
                  >
                    {s.signIn}
                  </Link>
                ) : null}
              </div>
            ) : sent ? (
              <div role="status" className="flex flex-col gap-3">
                <p className="text-title3">{s.sent}</p>
                <p className="text-subheadline text-label-secondary">{s.sentDetail}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="gray" onClick={() => setSent(null)}>
                    {s.sendAnother}
                  </Button>
                  {boardHref ? (
                    <Link
                      href={boardHref}
                      onClick={close}
                      className="inline-flex min-h-11 items-center justify-center rounded-control bg-tint-soft px-4 text-subheadline font-semibold text-tint-ink focus-ring"
                    >
                      {s.seeAll}
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <FeedbackForm capture={capture} onPickingChange={setPicking} onSubmitted={setSent} />
            )}
          </div>
        </div>
      ) : null}
      {!picking ? (
        <button
          ref={fabRef}
          type="button"
          aria-expanded={open}
          aria-label={s.fabLabel}
          title={s.fabLabel}
          onClick={() => (open ? close() : setOpen(true))}
          className="flex size-12 items-center justify-center rounded-full bg-tint text-on-tint shadow-overlay transition-transform duration-150 hover:bg-tint-pressed focus-ring active:scale-[0.95]"
        >
          <ChatIcon size={22} />
        </button>
      ) : null}
    </div>
  );
}
