import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center sm:px-10 sm:py-16">
      <span aria-hidden="true" className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-secondary text-primary">
        <Icon className="size-7" strokeWidth={1.5} />
      </span>
      <h1 className="max-w-md text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-4 max-w-sm text-sm leading-7 text-muted-foreground sm:text-base">{description}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}
