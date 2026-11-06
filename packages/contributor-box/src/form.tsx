"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { captureViewport, type CaptureOptions, type CapturedScreenshot } from "./capture";
import { useContributor } from "./context";
import { ElementPicker, type PickResult } from "./picker";
import { KINDS, type FeedbackItem, type FeedbackKind } from "./types";
import { Button, Choice, cx, inputClasses, Label } from "./ui";

export type CaptureFn = (options: CaptureOptions) => Promise<CapturedScreenshot>;

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
  const { api, strings: s } = useContributor();
  const uid = useId();
  const [kind, setKind] = useState<FeedbackKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState<PickResult | null>(null);
  const [withShot, setWithShot] = useState(false);
  const [shot, setShot] = useState<CapturedScreenshot | null>(null);
  const [shotState, setShotState] = useState<"idle" | "capturing" | "failed">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const pointButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const alive = useRef(true);
  const captureRun = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
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
        <textarea
          id={bodyId}
          className={cx(inputClasses, "min-h-24 resize-y")}
          value={body}
          maxLength={5000}
          placeholder={s.bodyPlaceholder}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      {withPageContext ? (
        <div className="flex flex-col gap-3 rounded-card bg-fill-tertiary p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={pointButton} size="sm" variant="tinted" onClick={startPicking}>
              {pick ? s.repointButton : s.pointButton}
            </Button>
            {pick ? (
              <>
                <span className="min-w-0 flex-1 truncate text-footnote text-label-secondary">
                  {pick.selector
                    ? s.pickedElement(pick.text || pick.selector)
                    : s.pickedRegion(pick.region.width, pick.region.height)}
                </span>
                <Button size="sm" variant="plain" onClick={() => setPick(null)}>
                  {s.clearPoint}
                </Button>
              </>
            ) : null}
          </div>
          <label htmlFor={shotId} className="flex cursor-pointer items-start gap-2 text-subheadline text-label">
            <input
              id={shotId}
              type="checkbox"
              className="mt-1 size-4 accent-tint"
              checked={withShot}
              onChange={(e) => toggleShot(e.target.checked)}
            />
            <span>
              {s.screenshotLabel}
              <span className="block text-footnote text-label-tertiary">{s.screenshotHint}</span>
            </span>
          </label>
          {withShot && shotState === "capturing" ? (
            <p role="status" className="text-footnote text-label-secondary">
              {s.screenshotCapturing}
            </p>
          ) : null}
          {withShot && shotState === "failed" ? (
            <p role="status" className="text-footnote text-warning-ink">
              {s.screenshotFailed}
            </p>
          ) : null}
          {withShot && shot ? (
            // A data: URL of the canvas we just drew; allowed by `img-src data:`.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shot.dataUrl}
              alt={s.screenshotAlt}
              className="max-h-40 w-full rounded-control border border-separator object-contain object-top"
            />
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
