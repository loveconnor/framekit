export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug.replace(/-/g, " ");
  return (
    <article className="mx-auto max-w-3xl px-6 py-24">
      <p className="text-sm uppercase tracking-wide text-stone-500">Journal</p>
      <h1 className="mt-2 text-4xl font-semibold capitalize">{title}</h1>
      <p className="mt-6 text-stone-600">This is a journal entry. The title above comes from the URL.</p>
    </article>
  );
}
