import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";
import { randomUUID } from "node:crypto";

type CliArgs = {
  email: string;
  password: string;
  role: Role;
};

function readFlag(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function parseArgs(): CliArgs {
  const email = (readFlag("email") ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = (readFlag("password") ?? process.env.ADMIN_PASSWORD ?? "").trim();
  const roleRaw = (readFlag("role") ?? process.env.ADMIN_ROLE ?? "admin").trim().toLowerCase();
  const role: Role = roleRaw === "superadmin" ? "superadmin" : "admin";

  if (!email || !email.includes("@")) {
    throw new Error("Missing valid email. Pass --email admin@example.com");
  }
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters. Pass --password <value>");
  }

  return { email, password, role };
}

function randomReferralCode(): string {
  return `ADM${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(args.password, 12);
    const existing = await prisma.user.findUnique({
      where: { email: args.email }
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: args.role,
          isActive: true,
          blockedReason: null
        }
      });
      console.log(`Updated admin user: ${args.email} (${args.role})`);
      return;
    }

    let referralCode = randomReferralCode();
    for (let i = 0; i < 10; i++) {
      const clash = await prisma.user.findUnique({ where: { referralCode } });
      if (!clash) break;
      referralCode = randomReferralCode();
    }

    await prisma.user.create({
      data: {
        email: args.email,
        passwordHash,
        role: args.role,
        referralCode,
        sponsorId: null,
        custodialUsdtBalance: 0
      }
    });
    console.log(`Created admin user: ${args.email} (${args.role})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
