import Link from "next/link";

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "solid" | "outline";
};

export function Button({ href, children, variant = "solid" }: ButtonProps) {
  const base = "inline-flex h-10 items-center rounded-md px-4 text-sm font-medium";
  const styles =
    variant === "solid"
      ? "bg-[var(--brand)] text-white"
      : "border border-stone-300 text-stone-800";
  return (
    <Link href={href} className={`${base} ${styles}`}>
      {children}
    </Link>
  );
}
