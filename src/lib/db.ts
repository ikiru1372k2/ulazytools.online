import "server-only";
import { PrismaClient } from "@prisma/client";
import { getAppEnv } from "@/lib/env";

const appEnv = getAppEnv();

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: appEnv.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (appEnv.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
