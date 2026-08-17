import { Module, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { EnvironmentModule } from '../../../libs/platform/src/config';
import { DatabaseModule } from '../../../libs/platform/src/database';

import { HealthController } from './health/health.controller';
import { AuthorizationModule } from './authorization/authorization.module';
import { IdentityModule } from './identity/identity.module';
import { ProjectsModule } from './projects/projects.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    EnvironmentModule,
    DatabaseModule,
    IdentityModule,
    AuthorizationModule,
    ProjectsModule,
    OrganizationsModule,
    ProfileModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-csrf-token"]',
            'req.url',
            'req.query',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.code',
            'req.body.token',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
