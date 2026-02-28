import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { NotificationService } from './notification.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Register or update the authenticated user's Expo push token.
   * Called by the mobile client after requesting notification permissions.
   */
  @Put('token')
  async registerToken(
    @Request() req: AuthRequest,
    @Body() body: { token: string },
  ) {
    await this.notificationService.registerToken(req.user.sub, body.token);
    return { ok: true };
  }

  /**
   * Clear the authenticated user's Expo push token.
   * Called on logout to stop receiving notifications on this device.
   */
  @Delete('token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearToken(@Request() req: AuthRequest) {
    await this.notificationService.clearToken(req.user.sub);
  }
}
