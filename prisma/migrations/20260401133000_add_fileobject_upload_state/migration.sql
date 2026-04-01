CREATE TYPE "FileObjectStatus" AS ENUM ('PENDING_UPLOAD', 'READY', 'FAILED');

ALTER TABLE "FileObject"
ADD COLUMN "guestId" TEXT,
ADD COLUMN "status" "FileObjectStatus" NOT NULL DEFAULT 'PENDING_UPLOAD';

CREATE INDEX "FileObject_guestId_idx" ON "FileObject"("guestId");
CREATE INDEX "FileObject_status_createdAt_idx" ON "FileObject"("status", "createdAt");
