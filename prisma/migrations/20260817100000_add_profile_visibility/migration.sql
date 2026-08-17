CREATE TYPE "ProfileFieldVisibility" AS ENUM ('PRIVATE', 'AUTHENTICATED');

CREATE TABLE "profile_visibility" (
    "user_id" UUID NOT NULL,
    "bio" "ProfileFieldVisibility" NOT NULL DEFAULT 'PRIVATE',
    "avatar" "ProfileFieldVisibility" NOT NULL DEFAULT 'PRIVATE',
    "email" "ProfileFieldVisibility" NOT NULL DEFAULT 'PRIVATE',
    "phone" "ProfileFieldVisibility" NOT NULL DEFAULT 'PRIVATE',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profile_visibility_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "profile_visibility"
ADD CONSTRAINT "profile_visibility_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
