import { Global, Module } from '@nestjs/common';

import { environmentProvider } from './environment.provider';

@Global()
@Module({ providers: [environmentProvider], exports: [environmentProvider] })
export class EnvironmentModule {}
