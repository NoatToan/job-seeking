import type { Metadata } from "next";
import { ListingPage, listingMetadata, listingParams } from "../../listing-page";

/** `/jobs/source/<key>/`: see ListingPage. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listingParams("source");
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return listingMetadata("source", (await params).key);
}

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  return <ListingPage kind="source" listingKey={(await params).key} />;
}
