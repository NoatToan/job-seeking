import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/site";

// Rendered once at build time (static export) and used as the link preview for every page.
// `ImageResponse` (Satori) only draws plain elements with inline styles: no Tailwind, CSS variables
// or @ujc/ui components, so the theme colours (theme.css --ujc-grouped / --ujc-label, the logo
// gradient from icon.svg) are written out here.
export const dynamic = "force-static";
export const alt = `${SITE_NAME}: remote and relocation tech jobs from every board`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#f4f2ef",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: 24,
              background: "linear-gradient(135deg, #fb923c, #f43f5e 55%, #a855f7)",
            }}
          />
          <div style={{ fontSize: 56, fontWeight: 700, color: "#1c1b1a" }}>{SITE_NAME}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", marginTop: 48, fontSize: 72, fontWeight: 800, color: "#1c1b1a", lineHeight: 1.1 }}>
          Find a tech job you&apos;ll&nbsp;
          <span style={{ backgroundImage: "linear-gradient(90deg, #ea580c, #e11d48 55%, #9333ea)", backgroundClip: "text", color: "transparent" }}>
            love
          </span>
        </div>
        <div style={{ marginTop: 32, fontSize: 32, color: "#57534e" }}>
          Remote &amp; relocation roles from LinkedIn, Seek, Himalayas, We Work Remotely, Arc and more.
        </div>
      </div>
    ),
    size,
  );
}
