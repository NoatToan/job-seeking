"""GraphQL query text for the Upwork API (M3-03).

Field and enum names here follow the publicly documented shape of
`marketplaceJobPostingsSearch` as described in Upwork's developer docs at the time this was
written. **Unverified**: we don't have an approved API key yet (see
`docs/product/ARCHITECTURE.md` §7), so exact field/enum names must be confirmed against the
official schema (e.g. with a GraphQL introspection query) before this goes live. Keeping the
query text in its own module makes that a one-file diff.
"""

MARKETPLACE_JOB_POSTINGS_SEARCH = """
query MarketplaceJobPostingsSearch(
  $marketPlaceJobFilter: MarketplaceJobFilter!
  $searchType: MarketplaceJobPostingSearchType
) {
  marketplaceJobPostingsSearch(
    marketPlaceJobFilter: $marketPlaceJobFilter
    searchType: $searchType
  ) {
    totalCount
    edges {
      node {
        id
        ciphertext
        title
        description
        createdDateTime
        jobType
        hourlyBudgetMin { rawValue currency }
        hourlyBudgetMax { rawValue currency }
        fixedPriceAmount { rawValue currency }
        skills { name }
        client {
          paymentVerified
          totalHires
          location { country }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""
