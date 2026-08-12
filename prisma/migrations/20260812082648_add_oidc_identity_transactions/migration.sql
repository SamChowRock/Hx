-- CreateTable
CREATE TABLE "external_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_transactions" (
    "id" UUID NOT NULL,
    "provider_key" TEXT NOT NULL,
    "state_hash" TEXT NOT NULL,
    "browser_binding_hash" TEXT NOT NULL,
    "code_verifier_ciphertext" TEXT NOT NULL,
    "nonce_ciphertext" TEXT NOT NULL,
    "return_to" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_identities_issuer_provider_subject_key" ON "external_identities"("issuer", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "oidc_transactions_state_hash_key" ON "oidc_transactions"("state_hash");

-- CreateIndex
CREATE INDEX "oidc_transactions_expires_at_idx" ON "oidc_transactions"("expires_at");

-- AddForeignKey
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
