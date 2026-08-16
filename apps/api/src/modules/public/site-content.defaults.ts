import type { Prisma } from "@prisma/client";

/** Default dashboard CMS payload shape (stored in SiteContent.payload JSON). */
export type DashboardContentPayload = {
  banners: Array<{
    id: string;
    title: string;
    body?: string;
    imageUrl?: string;
    linkUrl?: string;
  }>;
  slides: Array<{
    id: string;
    title: string;
    subtitle?: string;
    imageUrl?: string;
    linkUrl?: string;
  }>;
  promos: Array<{
    id: string;
    title: string;
    description?: string;
    imageUrl?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  }>;
  comingSoon: {
    enabled: boolean;
    title?: string;
    items?: string[];
  };
  socialLinks: {
    telegramUrl?: string;
    whatsAppUrl?: string;
  };
  notifications: Array<{
    id: string;
    title: string;
    body: string;
    severity?: "info" | "warning";
  }>;
};

export const DEFAULT_DASHBOARD_CONTENT: DashboardContentPayload = {
  banners: [],
  slides: [],
  promos: [],
  comingSoon: { enabled: false, title: "", items: [] },
  socialLinks: { telegramUrl: "", whatsAppUrl: "" },
  notifications: []
};

export function mergeDashboardPayload(raw: unknown): DashboardContentPayload {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_DASHBOARD_CONTENT, comingSoon: { ...DEFAULT_DASHBOARD_CONTENT.comingSoon } };
  }
  const o = raw as Record<string, unknown>;
  const cs = o.comingSoon;
  const sl = o.socialLinks;
  return {
    banners: Array.isArray(o.banners) ? (o.banners as DashboardContentPayload["banners"]) : [],
    slides: Array.isArray(o.slides) ? (o.slides as DashboardContentPayload["slides"]) : [],
    promos: Array.isArray(o.promos) ? (o.promos as DashboardContentPayload["promos"]) : [],
    comingSoon:
      cs && typeof cs === "object"
        ? {
            enabled: Boolean((cs as { enabled?: boolean }).enabled),
            title: typeof (cs as { title?: string }).title === "string" ? (cs as { title: string }).title : "",
            items: Array.isArray((cs as { items?: unknown }).items)
              ? ((cs as { items: string[] }).items.filter((x) => typeof x === "string") as string[])
              : []
          }
        : { ...DEFAULT_DASHBOARD_CONTENT.comingSoon },
    socialLinks:
      sl && typeof sl === "object"
        ? {
            telegramUrl: String((sl as { telegramUrl?: string }).telegramUrl ?? ""),
            whatsAppUrl: String((sl as { whatsAppUrl?: string }).whatsAppUrl ?? "")
          }
        : { ...DEFAULT_DASHBOARD_CONTENT.socialLinks },
    notifications: Array.isArray(o.notifications)
      ? (o.notifications as DashboardContentPayload["notifications"])
      : []
  };
}

export function payloadToJsonValue(p: DashboardContentPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(p)) as Prisma.InputJsonValue;
}
