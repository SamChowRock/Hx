import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';

import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
