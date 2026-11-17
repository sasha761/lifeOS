import type { ReactNode } from "react";

export function AuthCard({ title, description, children, footer }: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section aria-labelledby="auth-title" className="rounded-2xl border bg-card p-6 sm:p-8">
      <h1 id="auth-title" className="page-title">{title}</h1>
      {description && <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 grid gap-2 border-t pt-5 text-sm">{footer}</div>}
    </section>
  );
}
