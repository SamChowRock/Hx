-- CreateTable
CREATE TABLE "oauth_profile_transactions" (
    "id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "browser_binding_hash" TEXT NOT NULL,
    "return_to" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_profile_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_profile_transactions_state_hash_key" ON "oauth_profile_transactions"("state_hash");

-- CreateIndex
CREATE INDEX "oauth_profile_transactions_expires_at_idx" ON "oauth_profile_transactions"("expires_at");
