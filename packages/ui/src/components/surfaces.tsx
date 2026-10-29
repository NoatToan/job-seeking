import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import { ChevronRightIcon } from "../icons";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Default "div"; use "article" for self-contained items such as a job. */
  as?: ElementType;
  /** Adds hover lift + pressed scale for cards that are themselves a link/button target. */
  interactive?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const pad = { none: "", sm: "p-3", md: "p-4", lg: "p-5 sm:p-6" } as const;

/** Content surface: grouped-secondary fill, 14px radius, card shadow (hairline ring in dark). */
export function Card({ as: As = "div", interactive, padding = "md", className, ...rest }: CardProps) {
  return (
    <As
      className={cx(
        "rounded-card bg-grouped-secondary shadow-card",
        pad[padding],
        interactive &&
          "transition-[box-shadow,transform] duration-300 ease-spring hover:shadow-raised active:scale-[0.99]",
        className,
      )}
      {...rest}
    />
  );
}

export interface GroupedListProps {
  /** Section header (uppercase footnote, like iOS Settings). */
  header?: ReactNode;
  /** Explanatory text under the group. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Accessible name when there is no visible header. */
  label?: string;
}

/** Inset grouped list (iOS Settings style). Children should be ListRow elements. */
export function GroupedList({ header, footer, children, className, label }: GroupedListProps) {
  return (
    <section className={cx("flex flex-col gap-1.5", className)} aria-label={label}>
      {header ? (
        <h3 className="px-4 text-footnote font-normal uppercase tracking-wide text-label-secondary">
          {header}
        </h3>
      ) : null}
      <ul className="overflow-hidden rounded-card bg-grouped-secondary shadow-card">
        {children}
      </ul>
      {footer ? <p className="px-4 text-footnote text-label-secondary">{footer}</p> : null}
    </section>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Leading icon; rendered in a 29px rounded tile coloured with `iconColor`. */
  icon?: ReactNode;
  /** CSS colour for the icon tile (mid-tone; the glyph is white). Default: tint with on-tint glyph. */
  iconColor?: string;
  /** Trailing value text (e.g. "Connected"). */
  detail?: ReactNode;
  /** Trailing control (Toggle, Badge, Button). Replaces the chevron. */
  accessory?: ReactNode;
  /** Makes the row a link; shows a chevron (navigation rows only, like iOS). */
  href?: string;
  onClick?: () => void;
  /** Link component (e.g. Next `Link`). Default "a". */
  linkAs?: ElementType;
  destructive?: boolean;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  detail,
  accessory,
  href,
  onClick,
  linkAs: LinkAs = "a",
  destructive,
}: ListRowProps) {
  const interactive = Boolean(href || onClick);
  const content = (
    <>
      {icon ? (
        <span
          aria-hidden
          className={cx(
            "flex size-[29px] shrink-0 items-center justify-center rounded-icon",
            iconColor ? "text-white" : "bg-tint text-on-tint",
          )}
          style={iconColor ? { backgroundColor: iconColor } : undefined}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col py-0.5 text-left">
        <span className={cx("truncate text-body", destructive ? "text-danger-ink" : "text-label")}>{title}</span>
        {subtitle ? <span className="truncate text-footnote text-label-secondary">{subtitle}</span> : null}
      </span>
      {detail ? <span className="shrink-0 text-body text-label-secondary">{detail}</span> : null}
      {accessory ?? (href && !destructive ? (
        <ChevronRightIcon size={16} strokeWidth={2.25} className="shrink-0 text-label-quaternary" />
      ) : null)}
    </>
  );
  const rowClass = cx(
    "flex min-h-11 w-full items-center gap-3 py-2 pl-4 pr-4",
    interactive && "transition-colors duration-150 hover:bg-fill-tertiary active:bg-fill-secondary focus-ring focus-visible:-outline-offset-2",
  );
  return (
    <li
      className={cx(
        // iOS inset separator: starts at the text, not under the icon.
        "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:content-[''] not-first:before:hairline-t",
        icon ? "not-first:before:left-[57px]" : "not-first:before:left-4",
      )}
    >
      {href ? (
        <LinkAs href={href} className={rowClass}>
          {content}
        </LinkAs>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={rowClass}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </li>
  );
}
