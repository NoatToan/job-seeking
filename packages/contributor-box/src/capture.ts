import type { Region } from "./types";
import { EXCLUDE_ATTR, WIDGET_ATTR } from "./selector";

export interface CapturedScreenshot {
  /** `data:image/jpeg;base64,...` */
  dataUrl: string;
  width: number;
  height: number;
}

export interface CaptureOptions {
  /** Highlight drawn on the screenshot (viewport CSS pixels). */
  highlight?: Region | null;
  /** Highlight colour; default a sunrise orange. */
  highlightColor?: string;
  /** Longest edge of the output image, in pixels. Default 1600. */
  maxEdge?: number;
  /** Upper bound for the data URL length (server limit is ~2 MB). Default 1.9M characters. */
  maxDataUrlChars?: number;
  timeoutMs?: number;
}

const DEFAULTS = { maxEdge: 1600, maxDataUrlChars: 1_900_000, timeoutMs: 8000 };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("screenshot timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Nodes kept out of the screenshot: the widget, host-marked areas, and password fields. */
export function includeInScreenshot(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  if (node.hasAttribute(WIDGET_ATTR) || node.hasAttribute(EXCLUDE_ATTR)) return false;
  if (node instanceof HTMLInputElement && node.type === "password") return false;
  return true;
}

/**
 * Scales `source` so its longest edge is at most `maxEdge`, draws `highlight` (given in source
 * CSS pixels × `ratio`), and encodes JPEG, lowering quality until it fits `maxChars`.
 */
export function encodeAnnotated(
  source: HTMLCanvasElement,
  ratio: number,
  options: CaptureOptions = {},
): CapturedScreenshot {
  const maxEdge = options.maxEdge ?? DEFAULTS.maxEdge;
  const maxChars = options.maxDataUrlChars ?? DEFAULTS.maxDataUrlChars;
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d is not available");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const h = options.highlight;
  if (h) {
    const k = ratio * scale;
    ctx.lineWidth = Math.max(2, Math.round(3 * scale));
    ctx.strokeStyle = options.highlightColor ?? "#F76B1C";
    ctx.fillStyle = "rgba(247, 107, 28, 0.12)";
    ctx.fillRect(h.x * k, h.y * k, h.width * k, h.height * k);
    ctx.strokeRect(h.x * k, h.y * k, h.width * k, h.height * k);
  }
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= maxChars) return { dataUrl, width: canvas.width, height: canvas.height };
  }
  throw new Error("screenshot is too large");
}

/**
 * Screenshot of the visible viewport, rendered from the DOM (no screen-share prompt). html-to-image
 * is loaded on first use only, so pages that never open the widget don't pay for it. Rejects on
 * failure or timeout; callers treat that as "no screenshot", never as a blocking error.
 */
export async function captureViewport(options: CaptureOptions = {}): Promise<CapturedScreenshot> {
  const { toCanvas } = await import("html-to-image");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = 1;
  const canvas = await withTimeout(
    toCanvas(document.body, {
      width,
      height,
      pixelRatio: ratio,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      filter: includeInScreenshot,
      // System fonts only: skip fetching/embedding web fonts (and their cross-origin CSS).
      skipFonts: true,
      // An image the CSP or CORS blocks renders as an empty area instead of failing the capture.
      imagePlaceholder:
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: "top left",
      },
    }),
    options.timeoutMs ?? DEFAULTS.timeoutMs,
  );
  return encodeAnnotated(canvas, ratio, options);
}
