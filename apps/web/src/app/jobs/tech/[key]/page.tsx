import type { Metadata } from "next";
import { ListingPage, listingMetadata, listingParams } from "../../listing-page";

/** `/jobs/tech/<key>/`: see ListingPage. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listingParams("tech");
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return listingMetadata("tech", (await params).key);
}

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  return <ListingPage kind="tech" listingKey={(await params).key} />;
}
