import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { GroupsService, type UpdateProfileDto } from './groups.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly groupsService: GroupsService) {}

  /**
   * GET /users/me — returns the authenticated user's full profile.
   * Must be declared before GET /users to avoid :search matching "me".
   */
  @Get('me')
  getCurrentUser(@Request() req: AuthRequest) {
    return this.groupsService.getUserById(req.user.sub);
  }

  /** PATCH /users/me — update display name, dialect, or profile picture URL. */
  @Patch('me')
  updateProfile(@Request() req: AuthRequest, @Body() body: UpdateProfileDto) {
    return this.groupsService.updateUserProfile(req.user.sub, body);
  }

  /**
   * POST /users/me/profile-picture — upload a compressed profile picture.
   * The client (React Native) compresses the image before sending.
   */
  @Post('me/profile-picture')
  @UseInterceptors(
    FileInterceptor('file', { dest: './uploads/profile-pictures' }),
  )
  async uploadProfilePicture(
    @Request() req: AuthRequest,
    @UploadedFile() file: any, // multer file
  ) {
    const ext = path.extname(file.originalname);
    const newFileName = `${crypto.randomUUID()}${ext}`;
    const newPath = path.join('./uploads/profile-pictures', newFileName);

    await fs.promises.rename(file.path, newPath);

    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    const url = `${baseUrl}/uploads/profile-pictures/${newFileName}`;

    // Persist the URL on the user record
    await this.groupsService.updateUserProfile(req.user.sub, {
      profilePictureUrl: url,
    });

    return { url };
  }

  /** GET /users?search=&limit= — search users by display name. */
  @Get()
  searchUsers(
    @Request() req: AuthRequest,
    @Query('search') search = '',
    @Query('limit') limit = '20',
  ) {
    return this.groupsService.searchUsers(
      req.user.sub,
      search,
      parseInt(limit, 10) || 20,
    );
  }
}
