/**
 * Multi-channel availability catalog.
 *
 * Per-property channel IDs / URLs are stored in
 * `cr_properties.metadata.channels` as `{ [channel]: { id?, ical_url? } }`.
 * Column-backed fields (`airbnb_id`, `furnished_finder_id`, `booking_id`,
 * `zillow_id`, `apartments_id`) are still read for back-compat.
 *
 * Only channels with a deterministic public iCal URL get a `baseUrl` here;
 * everything else requires a full URL in metadata.
 */

export type ChannelId =
  | "airbnb"
  | "vrbo"
  | "booking"
  | "furnished_finder"
  | "turbotenant"
  | "furnished_condos"
  | "chico"
  | "zillow"
  | "apartments";

export interface ChannelDef {
  id: ChannelId;
  label: string;
  /**
   * Template the Worker can use to build an iCal pull URL from a listing id.
   * If absent, the full URL must be supplied in
   * `cr_properties.metadata.channels.{id}.ical_url`.
   */
  icalTemplate?: (listingId: string) => string;
  /** Legacy column on cr_properties, if any. */
  column?:
    | "airbnb_id"
    | "furnished_finder_id"
    | "booking_id"
    | "zillow_id"
    | "apartments_id";
}

export const CHANNEL_CATALOG: Record<ChannelId, ChannelDef> = {
  airbnb: {
    id: "airbnb",
    label: "Airbnb",
    icalTemplate: (id) => `https://www.airbnb.com/calendar/ical/${id}.ics`,
    column: "airbnb_id",
  },
  vrbo: {
    id: "vrbo",
    label: "VRBO",
    icalTemplate: (id) => `https://www.vrbo.com/icalendar/${id}.ics`,
  },
  booking: {
    id: "booking",
    label: "Booking.com",
    // Booking.com exposes a per-property iCal at this path once enabled.
    icalTemplate: (id) => `https://admin.booking.com/hotel/hoteladmin/ical.html?hotel_id=${id}`,
    column: "booking_id",
  },
  furnished_finder: {
    id: "furnished_finder",
    label: "Furnished Finder",
    // Furnished Finder uses per-account tokenized URLs; no template.
    column: "furnished_finder_id",
  },
  turbotenant: {
    id: "turbotenant",
    label: "TurboTenant",
    // TurboTenant availability sync is account-scoped; URL lives in metadata.
  },
  furnished_condos: {
    id: "furnished_condos",
    label: "furnished-condos.com",
    // First-party surface — URL is supplied by the CMS per listing.
  },
  chico: {
    id: "chico",
    label: "Chico KB",
    // Chico consumes availability via the public API/MCP surface rather
    // than via an iCal pull, so no template.
  },
  zillow: {
    id: "zillow",
    label: "Zillow",
    column: "zillow_id",
  },
  apartments: {
    id: "apartments",
    label: "Apartments.com",
    column: "apartments_id",
  },
};

export interface PropertyChannelRow {
  id: string;
  airbnb_id: string | null;
  furnished_finder_id: string | null;
  booking_id: string | null;
  zillow_id: string | null;
  apartments_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ResolvedChannelFeed {
  channel: ChannelId;
  label: string;
  listingId: string | null;
  icalUrl: string | null;
}

/**
 * Compute the set of resolvable channel feeds for a property. Callers that
 * want to pull iCal filter on `icalUrl !== null`.
 */
export function resolvePropertyChannels(prop: PropertyChannelRow): ResolvedChannelFeed[] {
  const meta = (prop.metadata ?? {}) as Record<string, unknown>;
  const rawChannels =
    meta.channels && typeof meta.channels === "object"
      ? (meta.channels as Record<string, { id?: string; ical_url?: string }>)
      : {};
  const feeds: ResolvedChannelFeed[] = [];

  for (const def of Object.values(CHANNEL_CATALOG)) {
    const override = rawChannels[def.id];
    const columnVal = def.column ? (prop[def.column] ?? null) : null;
    const listingId = override?.id ?? columnVal ?? null;
    const explicitUrl = override?.ical_url ?? null;
    let icalUrl: string | null = null;
    if (explicitUrl) icalUrl = explicitUrl;
    else if (listingId && def.icalTemplate) icalUrl = def.icalTemplate(listingId);
    if (listingId || icalUrl) {
      feeds.push({ channel: def.id, label: def.label, listingId, icalUrl });
    }
  }
  return feeds;
}
