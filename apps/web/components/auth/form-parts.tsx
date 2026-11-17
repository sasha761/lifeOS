import type { InputHTMLAttributes, ReactNode } from "react";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Goal and settings forms use the mockup caption `field-label`; auth forms keep the default. */
  labelClassName?: string;
};

export function Field({ id, label, error, hint, labelClassName = "text-sm font-medium", ...input }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="field-control"
        {...input}
      />
      {hint && <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      {error && <p id={errorId} className="text-sm leading-5 text-destructive">{error}</p>}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const style = tone === "error" ? "border-destructive/40 bg-destructive/10 text-foreground" : "border-st-green/40 bg-st-green/10 text-foreground";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-[10px] border px-4 py-3 text-sm leading-6 ${style}`}>
      {children}
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel, className = "w-full" }: { pending: boolean; children: ReactNode; pendingLabel: string; className?: string }) {
  return (
    <button type="submit" disabled={pending} className={`action-link ${className} disabled:cursor-wait disabled:opacity-70`}>
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Moves keyboard focus to the first invalid field after React has rendered the error state. */
export function focusFirstInvalid(form: HTMLFormElement): void {
  setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
}

export const textLinkClass = "font-medium text-primary underline underline-offset-4 hover:no-underline";
