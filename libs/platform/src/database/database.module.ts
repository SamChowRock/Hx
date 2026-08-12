import { Global, Module } from '@nestjs/common';

import { EnvironmentModule } from '../config';

import { DatabaseService } from './database.service';

@Global()
@Module({
  imports: [EnvironmentModule],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
