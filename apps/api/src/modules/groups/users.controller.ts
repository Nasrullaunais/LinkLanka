import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
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
import * as path from 'path';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import {
  profilePictureUploadOptions,
  MIME_TO_EXT,
} from '../../core/common/upload';
import { S3StorageService } from '../../core/common/storage/s3-storage.service';
import { GroupsService, type UpdateProfileDto } from './groups.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly s3StorageService: S3StorageService,
  ) {}

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
  @UseInterceptors(FileInterceptor('file', profilePictureUploadOptions()))
  async uploadProfilePicture(
    @Request() req: AuthRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Uploaded file buffer is missing');
    }

    // Derive extension from the validated MIME type — never trust originalname.
    const ext = MIME_TO_EXT[file.mimetype] ?? path.extname(file.originalname);
    const newFileName = `${crypto.randomUUID()}${ext}`;

    const uploaded = await this.s3StorageService.uploadBuffer({
      buffer: file.buffer,
      fileName: newFileName,
      mimeType: file.mimetype,
      folder: 'profile-pictures',
    });
    const url = uploaded.url;

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

  /** GET /users/:id — fetch any user's public profile. */
  @Get(':id')
  getUserById(@Param('id') userId: string) {
    return this.groupsService.getUserById(userId);
  }
}
