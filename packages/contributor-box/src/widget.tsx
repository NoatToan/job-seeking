"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useContributor } from "./context";
import { FeedbackForm, type CaptureFn } from "./form";
import { WIDGET_ATTR } from "./selector";
import type { FeedbackItem, FeedbackKind } from "./types";
import { Button, ChatIcon, cx, XIcon } from "./ui";

/** Space kept between the open panel and the top of the viewport. */
const PANEL_TOP_MARGIN_PX = 16;

/** Window event the widget listens for; dispatch it with `openFeedbackWidget()`. */
export const OPEN_WIDGET_EVENT = "contributor-box:open";

export interface OpenFeedbackWidgetOptions {
  /** Type preselected in the form. Default "bug" (the widget's usual default). */
  kind?: FeedbackKind;
}

/**
 * Opens the mounted `FeedbackWidget` from anywhere (e.g. a "Suggest an idea" button on a roadmap
 * page), with an optional preselected type. No-op when no widget is mounted.
 */
export function openFeedbackWidget(options: OpenFeedbackWidgetOptions = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenFeedbackWidgetOptions>(OPEN_WIDGET_EVENT, { detail: options }));
}

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
  const { strings: s, signedIn, allowAnonymous, signInHref, boardHref, linkAs: Link } = useContributor();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState<FeedbackItem | null>(null);
  // Bumped by every `openFeedbackWidget()` call: remounts the form with the requested type and
  // re-runs the focus effect even if the panel was already open.
  const [request, setRequest] = useState<{ n: number; kind: FeedbackKind }>({ n: 0, kind: "bug" });
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
  }, [open, sent, request.n]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const kind = (e as CustomEvent<OpenFeedbackWidgetOptions | undefined>).detail?.kind ?? "bug";
      setSent(null);
      setRequest((prev) => ({ n: prev.n + 1, kind }));
      setOpen(true);
    };
    window.addEventListener(OPEN_WIDGET_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_WIDGET_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open || picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, picking]);

  // The panel sits above the button, so its bottom edge is fixed: it may grow up to the top of the
  // viewport (minus a margin). Measured rather than guessed because hosts lift the widget above
  // their own bottom bars. Re-measured on resize and when the on-screen keyboard changes the
  // visual viewport.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || picking || !panel) return;
    const fit = () => {
      const bottom = panel.getBoundingClientRect().bottom;
      panel.style.maxHeight = `${Math.max(240, Math.floor(bottom - PANEL_TOP_MARGIN_PX))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
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
          // Sized to its content; `maxHeight` (set by the layout effect above) only bites when the
          // viewport is too short for the whole form, and then the body scrolls.
          className="flex max-h-[calc(100dvh-2rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-sheet border border-separator bg-grouped-secondary text-label shadow-overlay animate-pop-in"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-separator py-2 pr-2 pl-4">
            <h2 id={titleId} className="text-headline">
              {s.panelTitle}
            </h2>
            <Button size="sm" variant="plain" onClick={close} aria-label={s.close}>
              <XIcon size={18} />
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-3">
            {!signedIn && !allowAnonymous ? (
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
                <p className="text-subheadline text-label-secondary">
                  {signedIn ? s.sentDetail : s.sentDetailAnonymous}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="gray" onClick={() => setSent(null)}>
                    {s.sendAnother}
                  </Button>
                  {/* Guests have no "my feedback" to follow, and the board needs a session. */}
                  {signedIn && boardHref ? (
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
              <>
                {!signedIn ? (
                  <p className="mb-2 text-footnote text-label-secondary">
                    {s.guestHint}
                    {signInHref ? (
                      <>
                        {" "}
                        <Link href={signInHref} className="font-medium text-tint hover:underline focus-ring">
                          {s.guestSignIn}
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <FeedbackForm
                  key={request.n}
                  defaultKind={request.kind}
                  capture={capture}
                  onPickingChange={setPicking}
                  onSubmitted={setSent}
                />
              </>
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
