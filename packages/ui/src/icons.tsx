// Inline SVG icon set (24px grid, 1.75 stroke, round caps), drawn to sit next to SF Pro text.
// Kept in-house instead of adding lucide-react: we need ~30 glyphs, and a dependency would add
// version churn for no visual gain. Add new glyphs here, in the same style.
import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Pixel size (width = height). Default 20. */
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  title?: string;
}

function createIcon(displayName: string, body: ReactNode) {
  function Icon({ size = 20, title, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        focusable="false"
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {body}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const SearchIcon = createIcon(
  "SearchIcon",
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4.35-4.35" />
  </>,
);
export const XIcon = createIcon("XIcon", <path d="M18 6 6 18M6 6l12 12" />);
export const XCircleFillIcon = createIcon(
  "XCircleFillIcon",
  <>
    <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
    <path d="m15 9-6 6M9 9l6 6" stroke="var(--ujc-background)" strokeWidth="2" />
  </>,
);
export const ChevronRightIcon = createIcon("ChevronRightIcon", <path d="m9 18 6-6-6-6" />);
export const ChevronLeftIcon = createIcon("ChevronLeftIcon", <path d="m15 18-6-6 6-6" />);
export const ChevronDownIcon = createIcon("ChevronDownIcon", <path d="m6 9 6 6 6-6" />);
export const BriefcaseIcon = createIcon(
  "BriefcaseIcon",
  <>
    <rect x="2.5" y="7" width="19" height="13.5" rx="2.5" />
    <path d="M16 7V5.5A2.5 2.5 0 0 0 13.5 3h-3A2.5 2.5 0 0 0 8 5.5V7M2.5 13h19" />
  </>,
);
export const TargetIcon = createIcon(
  "TargetIcon",
  <>
    <circle cx="12" cy="12" r="9.5" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="1.5" />
  </>,
);
export const KanbanIcon = createIcon(
  "KanbanIcon",
  <>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 7.5v8M12 7.5v4M16 7.5v6" />
  </>,
);
export const LinkIcon = createIcon(
  "LinkIcon",
  <>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </>,
);
export const DocumentIcon = createIcon(
  "DocumentIcon",
  <>
    <path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" />
    <path d="M14 2.5V8h5.5M15.5 13h-7M15.5 17h-7M10.5 9h-2" />
  </>,
);
export const SlidersIcon = createIcon(
  "SlidersIcon",
  <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5" />,
);
export const CheckIcon = createIcon("CheckIcon", <path d="M20 6 9 17l-5-5" />);
export const PlusIcon = createIcon("PlusIcon", <path d="M12 5v14M5 12h14" />);
export const SparklesIcon = createIcon(
  "SparklesIcon",
  <>
    <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </>,
);
export const BellIcon = createIcon(
  "BellIcon",
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>,
);
export const UserIcon = createIcon(
  "UserIcon",
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M20 21a8 8 0 0 0-16 0" />
  </>,
);
export const SunIcon = createIcon(
  "SunIcon",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </>,
);
export const MoonIcon = createIcon("MoonIcon", <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />);
export const ExternalLinkIcon = createIcon(
  "ExternalLinkIcon",
  <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
);
export const BookmarkIcon = createIcon(
  "BookmarkIcon",
  <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
);
export const InfoIcon = createIcon(
  "InfoIcon",
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);
export const AlertTriangleIcon = createIcon(
  "AlertTriangleIcon",
  <>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);
export const CheckCircleIcon = createIcon(
  "CheckCircleIcon",
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </>,
);
export const MapPinIcon = createIcon(
  "MapPinIcon",
  <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </>,
);
export const GlobeIcon = createIcon(
  "GlobeIcon",
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </>,
);
export const ClockIcon = createIcon(
  "ClockIcon",
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
);
export const UploadIcon = createIcon(
  "UploadIcon",
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
);
export const RefreshIcon = createIcon(
  "RefreshIcon",
  <>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </>,
);
export const MoreIcon = createIcon(
  "MoreIcon",
  <>
    <circle cx="5" cy="12" r="1.25" fill="currentColor" />
    <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    <circle cx="19" cy="12" r="1.25" fill="currentColor" />
  </>,
);
export const TrashIcon = createIcon(
  "TrashIcon",
  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />,
);
