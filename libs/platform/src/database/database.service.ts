import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { ENVIRONMENT, type Environment } from '../config';

import { PrismaClient } from './generated/client';

@Injectable()
export class DatabaseService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    super({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
