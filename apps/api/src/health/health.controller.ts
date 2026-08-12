import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { DatabaseService } from '../../../../libs/platform/src/database';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    private readonly database: DatabaseService,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: this.environment.SERVICE_NAME,
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }

    return {
      status: 'ok',
      service: this.environment.SERVICE_NAME,
    };
  }
}
