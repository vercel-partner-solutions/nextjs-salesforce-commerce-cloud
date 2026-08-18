import OpengraphImage from "components/opengraph-image";
import { getCollection } from "lib/sfcc";

export default async function Image({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection: handle } = await params;
  const collection = await getCollection(handle);
  const title = collection?.seo?.title || collection?.title;

  return await OpengraphImage({ title });
}
