import type { Metadata } from "next";
import { ListingPage, listingMetadata, listingParams } from "../../listing-page";

/** `/jobs/country/<key>/`: see ListingPage. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listingParams("country");
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  return listingMetadata("country", (await params).key);
}

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  return <ListingPage kind="country" listingKey={(await params).key} />;
}
