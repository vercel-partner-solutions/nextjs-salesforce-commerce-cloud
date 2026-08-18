import OpengraphImage from "components/opengraph-image";
import { getPage } from "lib/sfcc/content";

export default async function Image({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page: handle } = await params;
  const page = getPage(handle);

  if (!page) return;

  const title = page.seo?.title || page.title;

  return await OpengraphImage({ title });
}
