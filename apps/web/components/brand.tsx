import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" aria-label="LifeOS — на главную" className="inline-flex shrink-0 items-center gap-2.5 rounded-[10px]">
      <span aria-hidden="true" className="flex size-[26px] items-center justify-center rounded-lg bg-primary text-[13px] font-extrabold text-primary-foreground">L</span>
      <span className="text-sm font-bold">LifeOS</span>
    </Link>
  );
}
