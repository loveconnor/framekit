import Image from "next/image";
import { Button } from "@/components/button";

const services = [
  { id: "brand", title: "Brand identity", body: "Names, marks and systems that last." },
  { id: "web", title: "Websites", body: "Fast, accessible sites built on Next.js." },
  { id: "print", title: "Print", body: "Books, posters and packaging." },
];

const showNotice = true;

export default function Home() {
  return (
    <div>
      {showNotice && (
        <div className="bg-amber-50 py-2 text-center text-sm text-amber-900">
          We are booking projects for next spring.
        </div>
      )}
      <section className="mx-auto grid max-w-5xl gap-10 px-6 py-24 md:grid-cols-2 md:items-center">
        <div className="flex flex-col gap-6">
          <h1 className="text-5xl font-semibold tracking-tight text-stone-900">
            Design for companies that make real things.
          </h1>
          <p className="max-w-md text-lg text-stone-600">
            Northwind is a three-person studio working with manufacturers, farms and small
            software teams across the Pacific Northwest.
          </p>
          <div className="flex gap-3">
            <Button href="/contact">Start a project</Button>
            <Button href="/about" variant="outline">
              About the studio
            </Button>
          </div>
        </div>
        <Image src="/hero.svg" alt="A drafting table with paper and tools" width={520} height={400} className="w-full rounded-lg" />
      </section>

      <section className="border-t border-stone-200 bg-stone-50">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-2xl font-semibold text-stone-900">What we do</h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-stone-900">Strategy</h3>
              <p className="text-sm text-stone-600">Positioning and messaging before pixels.</p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-stone-900">Design</h3>
              <p className="text-sm text-stone-600">Identity, interface and print, made together.</p>
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="font-medium text-stone-900">Build</h3>
              <p className="text-sm text-stone-600">We ship the site and hand over the code.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-2xl font-semibold text-stone-900">Services</h2>
        <ul className="mt-8 grid gap-6 md:grid-cols-3">
          {services.map((service) => (
            <li key={service.id} className="rounded-lg border border-stone-200 p-6">
              <h3 className="font-medium">{service.title}</h3>
              <p className="mt-2 text-sm text-stone-600">{service.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
