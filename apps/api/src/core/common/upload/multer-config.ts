/**
 * Reusable multer configuration factories for file upload endpoints.
 *
 * Usage:
 *   @UseInterceptors(FileInterceptor('file', mediaUploadOptions('./uploads')))
 */
import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

import {
  ALLOWED_MEDIA_MIMES,
  ALLOWED_PROFILE_PICTURE_MIMES,
  MAX_MEDIA_FILE_SIZE,
  MAX_PROFILE_PICTURE_SIZE,
} from './upload.constants';

/**
 * Build a multer fileFilter that rejects files whose mimetype is not
 * in the given allowlist. Rejection happens *before* the temp file is
 * written to disk (multer calls fileFilter before storage).
 */
function buildFileFilter(allowedMimes: Set<string>) {
  return (
    _req: any,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (allowedMimes.has(file.mimetype)) {
      callback(null, true);
    } else {
      callback(
        new BadRequestException(
          `File type "${file.mimetype}" is not allowed. Accepted types: ${[...allowedMimes].join(', ')}`,
        ),
        false,
      );
    }
  };
}

/** Multer options for the general media upload endpoint. */
export function mediaUploadOptions(dest: string): MulterOptions {
  return {
    dest,
    limits: { fileSize: MAX_MEDIA_FILE_SIZE },
    fileFilter: buildFileFilter(ALLOWED_MEDIA_MIMES),
  };
}

/** Multer options for the profile-picture upload endpoint. */
export function profilePictureUploadOptions(dest: string): MulterOptions {
  return {
    dest,
    limits: { fileSize: MAX_PROFILE_PICTURE_SIZE },
    fileFilter: buildFileFilter(ALLOWED_PROFILE_PICTURE_MIMES),
  };
}
