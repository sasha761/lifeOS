import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status">
      <span className="sr-only">Загружаем страницу LifeOS…</span>
      <div aria-hidden="true">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="mt-10 mb-4 h-6 w-48" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-52 rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
