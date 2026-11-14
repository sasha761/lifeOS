import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div role="status">
      <span className="sr-only">Загружаем страницу LifeOS…</span>
      <div aria-hidden="true">
        <Skeleton className="mb-5 h-5 w-24" />
        <Skeleton className="h-80 w-full rounded-3xl" />
        <Skeleton className="mt-10 mb-5 h-7 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-52 rounded-2xl" />)}
        </div>
      </div>
    </div>
  );
}
