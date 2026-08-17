import { Module } from '@nestjs/common';

import { AuthorizationModule } from '../authorization/authorization.module';

import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [AuthorizationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationRealtimeService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
