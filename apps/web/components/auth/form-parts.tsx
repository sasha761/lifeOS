import type { InputHTMLAttributes, ReactNode } from "react";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

export function Field({ id, label, error, hint, ...input }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 w-full rounded-lg border bg-card px-3 py-2 text-base transition-colors aria-invalid:border-destructive sm:text-sm"
        {...input}
      />
      {hint && <p id={hintId} className="text-xs leading-5 text-muted-foreground">{hint}</p>}
      {error && <p id={errorId} className="text-sm leading-5 text-destructive">{error}</p>}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const style = tone === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-primary/30 bg-secondary text-foreground";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm leading-6 ${style}`}>
      {children}
    </div>
  );
}

export function SubmitButton({ pending, children, pendingLabel }: { pending: boolean; children: ReactNode; pendingLabel: string }) {
  return (
    <button type="submit" disabled={pending} className="action-link w-full disabled:cursor-wait disabled:opacity-70">
      {pending ? pendingLabel : children}
    </button>
  );
}

/** Moves keyboard focus to the first invalid field after React has rendered the error state. */
export function focusFirstInvalid(form: HTMLFormElement): void {
  setTimeout(() => form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(), 0);
}

export const textLinkClass = "font-medium text-primary underline underline-offset-4 hover:no-underline";
