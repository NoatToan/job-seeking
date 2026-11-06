"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { captureViewport, type CaptureOptions, type CapturedScreenshot } from "./capture";
import { IdentityLine } from "./comments";
import { useContributor } from "./context";
import { ElementPicker, type PickResult } from "./picker";
import { KINDS, type FeedbackIdentity, type FeedbackItem, type FeedbackKind } from "./types";
import { Button, Choice, cx, inputClasses, Label } from "./ui";

export type CaptureFn = (options: CaptureOptions) => Promise<CapturedScreenshot>;

/** The details field grows with its text up to this height (about eight lines), then scrolls. */
const BODY_MAX_PX = 192;

export interface FeedbackFormProps {
  defaultKind?: FeedbackKind;
  /** Show "point at the page" + screenshot and send page URL/viewport. Off for the board's idea form. */
  withPageContext?: boolean;
  onSubmitted?: (item: FeedbackItem) => void;
  /** Called while the picker is open, so a floating panel can get out of the way. */
  onPickingChange?: (picking: boolean) => void;
  /** Injectable for tests. Default: `captureViewport`. */
  capture?: CaptureFn;
}

function errorStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status: unknown }).status)
    : undefined;
}

export function FeedbackForm({
  defaultKind = "bug",
  withPageContext = true,
  onSubmitted,
  onPickingChange,
  capture = captureViewport,
}: FeedbackFormProps) {
  const { api, strings: s, signedIn } = useContributor();
  const uid = useId();
  const [kind, setKind] = useState<FeedbackKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // Signed out: who the visitor will appear as (their pseudonym or chosen name).
  const [identity, setIdentity] = useState<FeedbackIdentity | null>(null);
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<PickResult | null>(null);
  const [withShot, setWithShot] = useState(false);
  const [shot, setShot] = useState<CapturedScreenshot | null>(null);
  const [shotState, setShotState] = useState<"idle" | "capturing" | "failed">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const pointButton = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef(false);
  const alive = useRef(true);
  const captureRun = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A guest's name comes from their visitor identity (the same one their comments use).
  useEffect(() => {
    if (signedIn) return;
    let active = true;
    api.identity().then(
      (v) => active && setIdentity(v),
      // Older servers without identities: the form still works, just without the preview.
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, signedIn]);

  // Auto-grow the details field (layout effect: no flash at the old height).
  useLayoutEffect(() => {
    const el = bodyRef.current;
    // Not laid out (hidden panel, jsdom): keep the natural `rows` height.
    if (!el || el.offsetParent === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, BODY_MAX_PX)}px`;
  }, [body]);

  // After the picker closes (pick or cancel), put focus back on the button that opened it.
  useEffect(() => {
    if (!picking && returnFocus.current) {
      returnFocus.current = false;
      pointButton.current?.focus();
    }
  }, [picking]);

  const takeShot = async (highlight: PickResult | null) => {
    const run = ++captureRun.current;
    setShotState("capturing");
    setShot(null);
    try {
      const result = await capture({ highlight: highlight?.region ?? null });
      // Ignore a capture that finished after unmount or after a newer capture started.
      if (!alive.current || run !== captureRun.current) return;
      setShot(result);
      setShotState("idle");
    } catch {
      if (alive.current && run === captureRun.current) setShotState("failed");
    }
  };

  const startPicking = () => {
    setPicking(true);
    onPickingChange?.(true);
  };

  const finishPicking = (result: PickResult | null) => {
    returnFocus.current = true;
    setPicking(false);
    onPickingChange?.(false);
    if (!result) return;
    setPick(result);
    // Wait a frame so the overlay is gone before the DOM is rendered to an image.
    if (withShot) requestAnimationFrame(() => void takeShot(result));
  };

  const toggleShot = (on: boolean) => {
    setWithShot(on);
    if (on) void takeShot(pick);
    else {
      captureRun.current++;
      setShot(null);
      setShotState("idle");
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      setTitleError(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const item = await api.create({
        kind,
        title: title.trim(),
        body: body.trim(),
        ...(withPageContext
          ? {
              pageUrl: window.location.href,
              pageTitle: document.title.slice(0, 300) || null,
              viewportWidth: window.innerWidth || null,
              viewportHeight: window.innerHeight || null,
              elementSelector: pick?.selector ?? null,
              elementText: pick?.text ? pick.text.slice(0, 300) : null,
              region: pick?.region ?? null,
              screenshot: withShot && shot ? shot.dataUrl : null,
              screenshotWidth: withShot && shot ? shot.width : null,
              screenshotHeight: withShot && shot ? shot.height : null,
            }
          : {}),
      });
      setTitle("");
      setBody("");
      setPick(null);
      setShot(null);
      setWithShot(false);
      onSubmitted?.(item);
    } catch (err) {
      setError(errorStatus(err) === 429 ? s.errorRateLimited : s.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const shotId = `${uid}-shot`;
  const titleErrorId = `${uid}-title-error`;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <Choice
        name={`${uid}-kind`}
        label={s.kindLabel}
        value={kind}
        onChange={setKind}
        options={KINDS.map((k) => ({ value: k, label: s.kind[k] }))}
      />
      <div>
        <Label htmlFor={titleId}>{s.titleLabel}</Label>
        <input
          id={titleId}
          className={inputClasses}
          value={title}
          maxLength={140}
          placeholder={s.titlePlaceholder[kind]}
          aria-invalid={titleError || undefined}
          aria-describedby={titleError ? titleErrorId : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleError(false);
          }}
          data-autofocus
        />
        {titleError ? (
          <p id={titleErrorId} className="mt-1 text-footnote text-danger">
            {s.titleTooShort}
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor={bodyId}>{s.bodyLabel}</Label>
        {/* Starts at two lines and grows with the text up to BODY_MAX_PX, so the panel fits its
            content instead of scrolling; past that the textarea scrolls itself. */}
        <textarea
          id={bodyId}
          ref={bodyRef}
          rows={2}
          className={cx(inputClasses, "block resize-none overflow-y-auto")}
          style={{ maxHeight: BODY_MAX_PX }}
          value={body}
          maxLength={5000}
          placeholder={s.bodyPlaceholder}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {!signedIn && identity ? <IdentityLine identity={identity} onChange={setIdentity} /> : null}

      {withPageContext ? (
        // Compact rows: "point at the page" (+ what was picked) and the screenshot toggle. The
        // screenshot hint and preview only appear once the screenshot is turned on.
        <div className="flex flex-col gap-2 rounded-card bg-fill-tertiary p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button ref={pointButton} size="sm" variant="tinted" onClick={startPicking} className="shrink-0">
              {pick ? s.repointButton : s.pointButton}
            </Button>
            {pick ? (
              <>
                <span className="min-w-0 flex-1 truncate text-footnote text-label-secondary">
                  {pick.selector
                    ? s.pickedElement(pick.text || pick.selector)
                    : s.pickedRegion(pick.region.width, pick.region.height)}
                </span>
                <Button size="sm" variant="plain" onClick={() => setPick(null)} className="shrink-0">
                  {s.clearPoint}
                </Button>
              </>
            ) : null}
          </div>
          <label htmlFor={shotId} className="flex cursor-pointer items-center gap-2 text-subheadline text-label">
            <input
              id={shotId}
              type="checkbox"
              className="size-4 shrink-0 accent-tint"
              checked={withShot}
              onChange={(e) => toggleShot(e.target.checked)}
              aria-describedby={withShot ? `${shotId}-hint` : undefined}
            />
            <span className="min-w-0">{s.screenshotLabel}</span>
          </label>
          {withShot ? (
            <div className="flex items-start gap-2.5">
              {shot ? (
                // A data: URL of the canvas we just drew; allowed by `img-src data:`.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shot.dataUrl}
                  alt={s.screenshotAlt}
                  className="h-16 w-24 shrink-0 rounded-control-sm border border-separator bg-background object-cover object-top"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p id={`${shotId}-hint`} className="text-footnote text-label-tertiary">
                  {s.screenshotHint}
                </p>
                {shotState === "capturing" ? (
                  <p role="status" className="text-footnote text-label-secondary">
                    {s.screenshotCapturing}
                  </p>
                ) : null}
                {shotState === "failed" ? (
                  <p role="status" className="text-footnote text-warning-ink">
                    {s.screenshotFailed}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-footnote text-danger-ink">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="filled" disabled={submitting || shotState === "capturing"}>
        {submitting ? s.submitting : s.submit}
      </Button>

      {picking ? (
        <ElementPicker
          hint={s.pickerHint}
          cancelLabel={s.pickerCancel}
          onPick={(r) => finishPicking(r)}
          onCancel={() => finishPicking(null)}
        />
      ) : null}
    </form>
  );
}
