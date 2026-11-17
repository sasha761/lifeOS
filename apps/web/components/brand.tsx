import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" aria-label="LifeOS — на главную" className="inline-flex shrink-0 items-center gap-2.5 rounded-[10px]">
      <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-sm font-bold text-primary-foreground">L</span>
      <span className="text-base font-semibold tracking-[-0.02em]">LifeOS</span>
    </Link>
  );
}
