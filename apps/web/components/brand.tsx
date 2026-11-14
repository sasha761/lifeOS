import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" aria-label="LifeOS — на главную" className="inline-flex shrink-0 items-center gap-2.5 rounded-md">
      <span aria-hidden="true" className="grid size-9 grid-cols-2 gap-1 rounded-xl bg-primary p-2">
        <span className="rounded-tl-sm bg-white" />
        <span className="rounded-tr-sm bg-white/50" />
        <span className="rounded-bl-sm bg-white/50" />
        <span className="rounded-br-sm bg-white" />
      </span>
      <span className="text-xl font-semibold tracking-[-0.055em]">LifeOS</span>
    </Link>
  );
}
