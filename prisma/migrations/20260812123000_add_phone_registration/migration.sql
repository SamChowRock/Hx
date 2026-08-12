-- CreateTable
CREATE TABLE "phone_registration_intents" (
    "id" UUID NOT NULL,
    "normalized_phone" TEXT NOT NULL,
    "status" "RegistrationIntentStatus" NOT NULL DEFAULT 'PENDING',
    "challenge_id_hash" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "completion_token_hash" TEXT,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 1,
    "send_window_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_registration_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "phone_registration_intents_normalized_phone_key" ON "phone_registration_intents"("normalized_phone");

-- CreateIndex
CREATE UNIQUE INDEX "phone_registration_intents_challenge_id_hash_key" ON "phone_registration_intents"("challenge_id_hash");

-- CreateIndex
CREATE UNIQUE INDEX "phone_registration_intents_completion_token_hash_key" ON "phone_registration_intents"("completion_token_hash");

-- CreateIndex
CREATE INDEX "phone_registration_intents_status_expires_at_idx" ON "phone_registration_intents"("status", "expires_at");
