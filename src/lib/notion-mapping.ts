/**
 * Notion → cr_* field mapping.
 *
 * TODO(operator): fill these with the real Notion property IDs from the
 * ChittyRental Notion DB (cb6da6660e854792abcb81157920600b). To find an
 * ID, query the database via Notion API and inspect the `properties`
 * object — each property has a stable `id` (e.g. `%3AGhp`).
 *
 * Until filled in, the sync runs in "discovery mode" — it logs the
 * available property names and does not write to cr_*.
 */

export interface NotionPropertyMap {
  /** Notion property **name** (fallback) or **id** (preferred) */
  [cr_field: string]: string;
}

/** Property-level mapping (Notion -> cr_properties). */
export const NOTION_PROPERTY_MAP: NotionPropertyMap = {
  name: "Name",
  portfolio_name: "Portfolio",
  address: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  property_type: "Type",
  status: "Status",
  jurisdiction: "Jurisdiction",
  description: "Description",
  airbnb_id: "Airbnb ID",
  furnished_finder_id: "Furnished Finder ID",
  zillow_id: "Zillow ID",
  booking_id: "Booking.com ID",
  vrbo_id: "VRBO ID",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  sqft: "Sqft",
  amenities: "Amenities",
  rent_amount: "Default rent",
  security_deposit_amount: "Deposit",
  external_id: "External ID",
  gov_asset_id: "ChittyGov Asset",
  cf_property_id: "ChittyFinance Property",
};

/** Unit-level mapping (Notion -> cr_units). */
export const NOTION_UNIT_MAP: NotionPropertyMap = {
  unit_number: "Unit #",
  property_name: "Property",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  sqft: "Sqft",
  floor: "Floor",
  status: "Status",
};

/** Portfolio-level mapping (Notion -> cr_portfolios). */
export const NOTION_PORTFOLIO_MAP: NotionPropertyMap = {
  name: "Name",
  gov_entity_id: "Entity",
  description: "Description",
  status: "Status",
};

/**
 * Returns true once a human has filled in real Notion IDs (replacing the
 * default name-based placeholders). We flip this by convention: real IDs
 * contain `%` or are 4-char shorthand, never a capitalized English word.
 */
export function mappingsConfigured(): boolean {
  return Object.values(NOTION_PROPERTY_MAP).every(
    (v) => v.length <= 8 || v.includes("%")
  );
}
