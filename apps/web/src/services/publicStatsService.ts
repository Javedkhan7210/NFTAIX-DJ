import { api } from "../api/client";

export const publicStatsService = {
  stats() {
    return api.get<{ totalUsers: number }>("/api/public/stats");
  }
};

