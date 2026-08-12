import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module';

import { AuthorizationService } from './authorization.service';

@Module({
  imports: [IdentityModule],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
