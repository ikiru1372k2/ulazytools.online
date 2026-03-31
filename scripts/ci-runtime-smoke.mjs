import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const redis = new IORedis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });

  try {
    await prisma.$queryRaw`SELECT 1`;

    await redis.connect();
    const pong = await redis.ping();

    if (pong !== "PONG") {
      throw new Error(`Unexpected Redis ping response: ${pong}`);
    }

    console.log("Runtime smoke checks passed.");
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
