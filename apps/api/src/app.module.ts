import { Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { environmentProvider } from '../../../libs/platform/src/config';

import { HealthController } from './health/health.controller';

@Module({
  imports: [
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
  ],
  controllers: [HealthController],
  providers: [environmentProvider],
})
export class AppModule {}
