-- AlterTable
ALTER TABLE "users"
ADD COLUMN "bio" TEXT,
ADD COLUMN "avatar_object_key" TEXT,
ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "nickname_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nickname_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nickname_changes_user_id_changed_at_idx" ON "nickname_changes"("user_id", "changed_at");

-- AddForeignKey
ALTER TABLE "nickname_changes"
ADD CONSTRAINT "nickname_changes_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
