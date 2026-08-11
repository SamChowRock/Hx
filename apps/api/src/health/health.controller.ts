import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';

@Controller('health')
export class HealthController {
  constructor(@Inject(ENVIRONMENT) private readonly environment: Environment) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: this.environment.SERVICE_NAME,
    };
  }

  @Get('ready')
  ready() {
    const isReady = Boolean(this.environment.SERVICE_NAME);

    if (!isReady) {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }

    return {
      status: 'ok',
      service: this.environment.SERVICE_NAME,
    };
  }
}
