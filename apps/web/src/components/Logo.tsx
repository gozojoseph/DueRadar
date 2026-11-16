import { cx } from "./ui";

export function Logo({
  size = 34,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      className={className}
    >
      <rect width="40" height="40" rx="12" fill="currentColor" />
      <circle cx="20" cy="20" r="11.5" stroke="#F6F5F1" strokeOpacity="0.28" strokeWidth="1.4" />
      <circle cx="20" cy="20" r="7" stroke="#F6F5F1" strokeOpacity="0.5" strokeWidth="1.4" />
      <path
        d="M20 20 L28.2 11.8"
        stroke="#F6F5F1"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 9.2 A10.8 10.8 0 0 1 30.8 20"
        stroke="#8FD3C7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="20" cy="20" r="2.5" fill="#F6F5F1" />
      <circle cx="27.4" cy="27.4" r="1.6" fill="#8FD3C7" />
    </svg>
  );
}

export function Wordmark({
  className,
  markSize = 32,
}: {
  className?: string;
  markSize?: number;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <Logo size={markSize} className="text-brand-900" />
      <span className="font-display text-[1.25rem] leading-none font-semibold tracking-[-0.02em] text-ink">
        Due<span className="text-brand-600">Radar</span>
      </span>
    </span>
  );
}
