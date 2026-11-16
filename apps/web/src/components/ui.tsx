import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-800 text-white shadow-[0_10px_24px_-14px_rgba(11,59,54,0.9)] hover:bg-brand-900",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-paper-deep",
  ghost: "text-ink-soft hover:bg-ink/5",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  danger: "bg-danger-strong text-white hover:brightness-95",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[0.8125rem]",
  md: "h-11 px-4 text-[0.9375rem]",
  lg: "h-12 px-5 text-base",
  icon: "h-10 w-10 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold tracking-[-0.01em] transition-[background,transform,box-shadow] duration-150 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ----------------------------------- Card ---------------------------------- */

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={cx("card", className)}>{children}</Tag>;
}

/* --------------------------------- Badge ----------------------------------- */

type BadgeTone = "brand" | "amber" | "danger" | "slate" | "sky" | "plain";

const BADGE_TONES: Record<BadgeTone, string> = {
  brand: "bg-brand-50 text-brand-800",
  amber: "bg-amber-soft text-amber-strong",
  danger: "bg-danger-soft text-danger-strong",
  slate: "bg-paper-deep text-ink-soft",
  sky: "bg-sky-soft text-[#1f5d86]",
  plain: "bg-white/70 text-ink-soft border border-line",
};

export function Badge({
  children,
  tone = "slate",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return <span className={cx("pill", BADGE_TONES[tone], className)}>{children}</span>;
}

/* --------------------------------- Fields ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger-strong">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("field", className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("field appearance-none pr-8", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("field min-h-24 resize-y", className)} />;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-brand-700" : "bg-line-strong",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

/* ---------------------------------- Notes ---------------------------------- */

export function Note({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "success" | "error" | "warn";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    info: "bg-sky-soft text-[#1f5d86]",
    success: "bg-brand-50 text-brand-800",
    error: "bg-danger-soft text-danger-strong",
    warn: "bg-amber-soft text-amber-strong",
  } as const;
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div
      className={cx(
        "flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm leading-relaxed",
        styles[tone],
        className,
      )}
      role={tone === "error" ? "alert" : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* --------------------------------- Header ---------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.16em] text-brand-600">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[0.925rem] leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------- Empty state ------------------------------ */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- Loading --------------------------------- */

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin", className)} aria-hidden />;
}

export function LoadingBlock({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Spinner className="text-brand-600" />
      {label}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="card p-5">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton mt-3 h-7 w-2/3" />
      <div className="skeleton mt-3 h-4 w-1/2" />
    </div>
  );
}

/* ---------------------------------- Modal ---------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" }[size];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px] animate-fade"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          "relative w-full animate-rise rounded-t-[1.6rem] border border-line bg-surface p-5 shadow-[0_24px_80px_-24px_rgba(21,33,30,0.5)] outline-none sm:rounded-[1.4rem] sm:p-6",
          width,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-[-0.015em] text-ink">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
        <div className="max-h-[70dvh] overflow-y-auto pr-0.5">{children}</div>
        {footer ? <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-ink-soft" />
    </Modal>
  );
}

/* ------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "no-scrollbar flex gap-1 overflow-x-auto rounded-full border border-line bg-paper-deep/70 p-1",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            "shrink-0 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-semibold transition",
            value === option.value
              ? "bg-surface text-ink shadow-[0_1px_3px_rgba(21,33,30,0.12)]"
              : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Toast ---------------------------------- */

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, tone: ToastTone = "success") => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  const tones: Record<ToastTone, string> = {
    success: "bg-brand-900 text-white",
    error: "bg-danger-strong text-white",
    info: "bg-ink text-white",
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-8">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cx(
              "pointer-events-auto flex max-w-md animate-rise items-start gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lift",
              tones[item.tone],
            )}
          >
            {item.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : item.tone === "error" ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="text-pretty">{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}

/* --------------------------------- Money ---------------------------------- */

export function MoneyDisplay({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return <span className={cx("tabular-nums tracking-[-0.02em]", className)}>{value}</span>;
}

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function useMemoValue<T>(factory: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, deps);
}
