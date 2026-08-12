import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OidcService } from './oidc.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, OidcService],
  exports: [IdentityService],
})
export class IdentityModule {}
