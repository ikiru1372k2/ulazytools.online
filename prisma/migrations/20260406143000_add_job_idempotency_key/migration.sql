ALTER TABLE "Job"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Job_userId_idempotencyKey_key"
ON "Job"("userId", "idempotencyKey");

CREATE UNIQUE INDEX "Job_guestId_idempotencyKey_key"
ON "Job"("guestId", "idempotencyKey");
