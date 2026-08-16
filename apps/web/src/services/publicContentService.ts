import { api } from "../api/client";

export type DashboardContentPayload = {
  banners: Array<{ id: string; title: string; body?: string; imageUrl?: string; linkUrl?: string }>;
  slides: Array<{ id: string; title: string; subtitle?: string; imageUrl?: string; linkUrl?: string }>;
  promos: Array<{ id: string; title: string; description?: string; imageUrl?: string; ctaLabel?: string; ctaUrl?: string }>;
  comingSoon: { enabled: boolean; title?: string; items?: string[] };
  socialLinks: { telegramUrl?: string; whatsAppUrl?: string };
  notifications: Array<{ id: string; title: string; body: string; severity?: "info" | "warning" }>;
};

export const publicContentService = {
  dashboardContent() {
    return api.get<{ payload: DashboardContentPayload; updatedAt: string }>("/api/public/dashboard-content");
  }
};
