import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Patch,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';
import { AuthorizationService } from '../authorization/authorization.service';
import { assertAllowedOrigin, readAuthCookie } from '../http/auth-http';

import { maximumAvatarInputBytes } from './avatar-storage.service';
import { ProfileService } from './profile.service';

type AvatarUpload = { buffer: Buffer; size: number };

const nicknameSchema = z
  .string()
  .max(200)
  .transform((value) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim())
  .superRefine((value, context) => {
    const length = Array.from(value).length;
    if (length < 1 || length > 16) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Nickname must contain between 1 and 16 characters.',
      });
    }
    if (/\p{Cc}/u.test(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Nickname is invalid.' });
    }
  });

const bioSchema = z
  .string()
  .max(2_000)
  .transform((value) => value.normalize('NFC').replace(/\r\n?/gu, '\n').trim())
  .superRefine((value, context) => {
    if (Array.from(value).length > 500) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bio cannot exceed 500 characters.',
      });
    }
    if (/\p{Cc}/u.test(value.replace(/[\n\t]/gu, ''))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Bio is invalid.' });
    }
  });

const updateProfileSchema = z
  .object({
    nickname: nicknameSchema.optional(),
    bio: z.union([bioSchema, z.null()]).optional(),
  })
  .strict()
  .refine((value) => value.nickname !== undefined || value.bio !== undefined, {
    message: 'At least one profile field is required.',
  });

const fieldVisibilitySchema = z.enum(['PRIVATE', 'AUTHENTICATED']);
const updateVisibilitySchema = z
  .object({
    bio: fieldVisibilitySchema.optional(),
    avatar: fieldVisibilitySchema.optional(),
    email: fieldVisibilitySchema.optional(),
    phone: fieldVisibilitySchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((setting) => setting !== undefined), {
    message: 'At least one visibility field is required.',
  });

@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  private async actor(request: Request) {
    const secret = readAuthCookie(request, this.environment, 'session');
    return this.authorization.actorFromSession(secret ?? '', this.environment.AUTH_SECRET);
  }

  private async mutationActor(
    request: Request,
    providedCsrf: string | undefined,
  ): Promise<{ userId: string }> {
    assertAllowedOrigin(request, this.environment);
    const actor = await this.actor(request);
    this.authorization.assertCsrf(actor, providedCsrf, this.environment.AUTH_SECRET);
    return actor;
  }

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async get(@Req() request: Request) {
    return this.profiles.get((await this.actor(request)).userId);
  }

  @Patch()
  @Header('Cache-Control', 'private, no-store')
  async update(
    @Req() request: Request,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = await this.mutationActor(request, csrf);
    return this.profiles.update(actor.userId, updateProfileSchema.parse(body));
  }

  @Patch('visibility')
  @Header('Cache-Control', 'private, no-store')
  async updateVisibility(
    @Req() request: Request,
    @Headers('x-csrf-token') csrf: string | undefined,
    @Body() body: unknown,
  ) {
    const actor = await this.mutationActor(request, csrf);
    return this.profiles.updateVisibility(actor.userId, updateVisibilitySchema.parse(body));
  }

  @Put('avatar')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: maximumAvatarInputBytes, files: 1, fields: 0 },
    }),
  )
  async replaceAvatar(
    @Req() request: Request,
    @Headers('x-csrf-token') csrf: string | undefined,
    @UploadedFile() file: AvatarUpload | undefined,
  ) {
    const actor = await this.mutationActor(request, csrf);
    if (!file?.buffer) throw new BadRequestException('An avatar image is required.');
    return this.profiles.replaceAvatar(actor.userId, file.buffer);
  }

  @Get('avatar')
  async avatar(@Req() request: Request, @Res() response: Response) {
    const avatar = await this.profiles.loadAvatar((await this.actor(request)).userId);
    if (avatar.etag && request.get('if-none-match') === avatar.etag) {
      return response.status(304).end();
    }
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Length', avatar.bytes.length);
    response.setHeader('Content-Disposition', 'inline; filename="avatar.webp"');
    response.setHeader('Cache-Control', 'private, max-age=300');
    if (avatar.etag) response.setHeader('ETag', avatar.etag);
    return response.send(avatar.bytes);
  }

  @Delete('avatar')
  @Header('Cache-Control', 'private, no-store')
  async removeAvatar(@Req() request: Request, @Headers('x-csrf-token') csrf: string | undefined) {
    return this.profiles.removeAvatar((await this.mutationActor(request, csrf)).userId);
  }
}
