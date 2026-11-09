import Link from "next/link";
import { Button } from "./button";

export function Header() {
  return (
    <header className="border-b border-stone-200">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Northwind
        </Link>
        <div className="flex items-center gap-6 text-sm text-stone-600">
          <Link href="/about">About</Link>
          <Link href="/blog/launch">Journal</Link>
          <Button href="/contact">Start a project</Button>
        </div>
      </nav>
    </header>
  );
}
