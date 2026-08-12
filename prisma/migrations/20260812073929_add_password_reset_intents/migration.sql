-- CreateTable
CREATE TABLE "password_reset_intents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_intents_user_id_key" ON "password_reset_intents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_intents_token_hash_key" ON "password_reset_intents"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_intents_expires_at_idx" ON "password_reset_intents"("expires_at");
