CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(64) NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "action_url" VARCHAR(500),
    "dedupe_key" VARCHAR(128),
    "read_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key"
ON "notifications"("user_id", "dedupe_key");

CREATE INDEX "notifications_user_id_created_at_id_idx"
ON "notifications"("user_id", "created_at", "id");

CREATE INDEX "notifications_user_id_read_at_created_at_idx"
ON "notifications"("user_id", "read_at", "created_at");

CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

ALTER TABLE "notifications"
ADD CONSTRAINT "notifications_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
