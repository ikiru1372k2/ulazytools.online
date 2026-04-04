ALTER TABLE "FileObject"
ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "FileObject_expiresAt_idx" ON "FileObject"("expiresAt");
