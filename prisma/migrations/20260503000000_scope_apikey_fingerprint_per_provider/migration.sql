-- DropIndex
DROP INDEX "api_keys_fingerprint_key";

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_provider_fingerprint_key" ON "api_keys"("provider", "fingerprint");
