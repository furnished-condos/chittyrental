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
 * Default placeholder values. `mappingsConfigured()` returns true only when
 * the operator has either (a) changed every map away from these defaults or
 * (b) set `NOTION_MAPPINGS_CONFIGURED=true` as an explicit opt-in.
 */
const DEFAULT_PROPERTY_MAP: NotionPropertyMap = { ...NOTION_PROPERTY_MAP };
const DEFAULT_UNIT_MAP: NotionPropertyMap = { ...NOTION_UNIT_MAP };
const DEFAULT_PORTFOLIO_MAP: NotionPropertyMap = { ...NOTION_PORTFOLIO_MAP };

function differsFromDefault(
  current: NotionPropertyMap,
  defaults: NotionPropertyMap
): boolean {
  return Object.keys(defaults).every((k) => current[k] !== defaults[k]);
}

export function mappingsConfigured(
  env?: { NOTION_MAPPINGS_CONFIGURED?: string }
): boolean {
  if (env?.NOTION_MAPPINGS_CONFIGURED === "true") return true;
  return (
    differsFromDefault(NOTION_PROPERTY_MAP, DEFAULT_PROPERTY_MAP) &&
    differsFromDefault(NOTION_UNIT_MAP, DEFAULT_UNIT_MAP) &&
    differsFromDefault(NOTION_PORTFOLIO_MAP, DEFAULT_PORTFOLIO_MAP)
  );
}
