import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationModule } from '../authorization/authorization.module';

import { AVATAR_S3_CLIENT, AvatarStorageService } from './avatar-storage.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { UserProfilesController } from './user-profiles.controller';

@Module({
  imports: [AuthorizationModule],
  controllers: [ProfileController, UserProfilesController],
  providers: [
    {
      provide: AVATAR_S3_CLIENT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) =>
        new S3Client({
          endpoint: environment.OBJECT_STORAGE_ENDPOINT,
          region: environment.OBJECT_STORAGE_REGION,
          forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY,
            secretAccessKey: environment.OBJECT_STORAGE_SECRET_KEY,
          },
        }),
    },
    AvatarStorageService,
    ProfileService,
  ],
})
export class ProfileModule {}
