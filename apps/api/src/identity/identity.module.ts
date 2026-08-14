import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { OidcService } from './oidc.service';
import { WeChatOAuthService } from './wechat-oauth.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService, OidcService, WeChatOAuthService],
  exports: [IdentityService],
})
export class IdentityModule {}
