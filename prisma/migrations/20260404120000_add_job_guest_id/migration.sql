ALTER TABLE "Job"
ADD COLUMN "guestId" TEXT;

CREATE INDEX "Job_guestId_idx" ON "Job"("guestId");
