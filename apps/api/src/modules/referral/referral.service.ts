import { PrismaClient } from "@prisma/client";

const DEFAULT_LEVEL_RULES = [
  /** Depth-1 network slice pays without a direct-recruit gate; deeper slots still follow rules below. */
  { minDirect: 0, maxLevels: 1 },
  { minDirect: 1, maxLevels: 2 },
  { minDirect: 10, maxLevels: 20 }
];

type LevelRule = { minDirect: number; maxLevels: number };

export class ReferralService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Ordered upline from immediate sponsor up to depth 20 (excludes `userId`). */
  async getUplineUserIds(userId: string): Promise<string[]> {
    const chain: string[] = [];
    let cur = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { sponsorId: true }
    });
    let nextId = cur?.sponsorId ?? null;
    while (nextId && chain.length < 20) {
      chain.push(nextId);
      const parent = await this.prisma.user.findUnique({
        where: { id: nextId },
        select: { sponsorId: true }
      });
      nextId = parent?.sponsorId ?? null;
    }
    return chain;
  }

  async getLevelUnlockRules(): Promise<LevelRule[]> {
    const row = await this.prisma.rewardSetting.findUnique({ where: { key: "referral.levelUnlock" } });
    if (!row?.value) return DEFAULT_LEVEL_RULES;
    try {
      const parsed = JSON.parse(row.value) as LevelRule[];
      if (Array.isArray(parsed) && parsed.length) return parsed.sort((a, b) => a.minDirect - b.minDirect);
    } catch {
      /* use default */
    }
    return DEFAULT_LEVEL_RULES;
  }

  /** Max referral payout depth for a sponsor based on their direct referral count. */
  async maxPayoutLevelsForDirectCount(directReferralCount: number): Promise<number> {
    const rules = await this.getLevelUnlockRules();
    let max = 0;
    for (const r of rules) {
      if (directReferralCount >= r.minDirect) max = Math.max(max, r.maxLevels);
    }
    return max;
  }

  async maxPayoutLevelsForUserId(sponsorUserId: string): Promise<number> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: sponsorUserId },
      select: { directReferralCount: true }
    });
    return this.maxPayoutLevelsForDirectCount(u.directReferralCount);
  }

  /**
   * Call after a new user is created with optional sponsor.
   * Increments direct count, team counts along upline, and inserts ReferralEdge rows.
   */
  async attachNewUserToTree(newUserId: string, sponsorId: string | null): Promise<void> {
    if (!sponsorId) return;

    const maxDepth = 20;

    await this.prisma.user.update({
      where: { id: sponsorId },
      data: { directReferralCount: { increment: 1 } }
    });

    let currentId: string | null = sponsorId;
    let level = 1;
    while (currentId && level <= maxDepth) {
      const sponsorAtLevel: string = currentId;
      await this.prisma.referralEdge.create({
        data: { sponsorId: sponsorAtLevel, referralId: newUserId, level }
      });
      await this.prisma.user.update({
        where: { id: sponsorAtLevel },
        data: { teamCount: { increment: 1 } }
      });
      const parent: { sponsorId: string | null } | null = await this.prisma.user.findUnique({
        where: { id: sponsorAtLevel },
        select: { sponsorId: true }
      });
      currentId = parent?.sponsorId ?? null;
      level += 1;
    }
  }

  /** Recompute `directReferralCount` and `teamCount` for every user from graph truth. */
  async recountAllUserStats(): Promise<{ usersUpdated: number }> {
    const users = await this.prisma.user.findMany({ select: { id: true } });
    for (const u of users) {
      const directs = await this.prisma.user.count({ where: { sponsorId: u.id } });
      const teamEdges = await this.prisma.referralEdge.count({ where: { sponsorId: u.id } });
      await this.prisma.user.update({
        where: { id: u.id },
        data: { directReferralCount: directs, teamCount: teamEdges }
      });
    }
    return { usersUpdated: users.length };
  }

  private async wouldCreateCycle(userId: string, newSponsorId: string): Promise<boolean> {
    let cur: string | null = newSponsorId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === userId) return true;
      if (seen.has(cur)) return true;
      seen.add(cur);
      const node: { sponsorId: string | null } | null = await this.prisma.user.findUnique({
        where: { id: cur },
        select: { sponsorId: true }
      });
      cur = node?.sponsorId ?? null;
    }
    return false;
  }

  /**
   * Rewire DB sponsor + referral edges when the user has **no direct referrals**.
   * Full recount runs after to normalize counters.
   */
  async rewireSponsorForLeafUser(
    userId: string,
    newSponsorId: string | null
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (newSponsorId === userId) {
      return { ok: false, reason: "Cannot sponsor self." };
    }
    const directs = await this.prisma.user.count({ where: { sponsorId: userId } });
    if (directs > 0) {
      return { ok: false, reason: "User has direct referrals; rewire not supported." };
    }
    if (newSponsorId && (await this.wouldCreateCycle(userId, newSponsorId))) {
      return { ok: false, reason: "Sponsor would create a referral cycle." };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.referralEdge.deleteMany({ where: { referralId: userId } });
      await tx.user.update({
        where: { id: userId },
        data: { sponsorId: newSponsorId }
      });
      const rs = new ReferralService(tx as unknown as PrismaClient);
      await rs.attachNewUserToTree(userId, newSponsorId);
    });

    await this.recountAllUserStats();
    return { ok: true };
  }
}
