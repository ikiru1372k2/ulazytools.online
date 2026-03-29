import { prisma } from "@/lib/db";

export async function runPrismaSmokeQuery() {
  return prisma.$queryRaw`SELECT 1`;
}
