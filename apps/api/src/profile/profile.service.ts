import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { DatabaseService } from '../../../../libs/platform/src/database';

import { AvatarStorageService } from './avatar-storage.service';

const nicknameChangeLimit = 3;
const nicknameChangeWindowMs = 30 * 24 * 60 * 60 * 1000;
const profileVisibilityFields = ['bio', 'avatar', 'email', 'phone'] as const;

type ProfileFieldVisibility = 'PRIVATE' | 'AUTHENTICATED';
type ProfileVisibility = Record<(typeof profileVisibilityFields)[number], ProfileFieldVisibility>;

const privateProfileVisibility: ProfileVisibility = {
  bio: 'PRIVATE',
  avatar: 'PRIVATE',
  email: 'PRIVATE',
  phone: 'PRIVATE',
};

export type ProfileUpdate = {
  nickname?: string;
  bio?: string | null;
};

export type ProfileVisibilityUpdate = Partial<ProfileVisibility>;

export class NicknameChangeLimitException extends HttpException {
  constructor(retryAt: Date) {
    super(
      {
        message: 'Nickname can only be changed three times in a rolling 30-day period.',
        code: 'NICKNAME_CHANGE_LIMIT',
        retryAt: retryAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly avatarStorage: AvatarStorageService,
  ) {}

  async get(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      include: {
        profileVisibility: true,
        contacts: {
          where: { retiredAt: null },
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
        },
      },
    });
    if (!user) throw new NotFoundException('Profile was not found.');
    return this.present(user, new Date());
  }

  async getReadableBy(actorUserId: string, targetUserId: string) {
    const target = await this.findReadableTarget(actorUserId, targetUserId);
    const visibility = this.visibility(target.profileVisibility);
    return {
      id: target.id,
      nickname: target.displayName,
      bio: visibility.bio === 'AUTHENTICATED' ? target.bio : null,
      avatarUrl:
        visibility.avatar === 'AUTHENTICATED' && target.avatarObjectKey && target.avatarUpdatedAt
          ? `/api/profiles/${target.id}/avatar?v=${target.avatarUpdatedAt.getTime()}`
          : null,
      email: visibility.email === 'AUTHENTICATED' ? this.contact(target.contacts, 'EMAIL') : null,
      phone: visibility.phone === 'AUTHENTICATED' ? this.contact(target.contacts, 'PHONE') : null,
    };
  }

  async updateVisibility(userId: string, input: ProfileVisibilityUpdate) {
    await this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundException('Profile was not found.');
      const current = this.visibility(await tx.profileVisibility.findUnique({ where: { userId } }));
      const changed = profileVisibilityFields.some(
        (field) => input[field] !== undefined && input[field] !== current[field],
      );
      if (!changed) return;

      await tx.profileVisibility.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'profile.visibility.changed',
          targetType: 'user_profile',
          targetId: userId,
        },
      });
    });
    return this.get(userId);
  }

  async update(userId: string, input: ProfileUpdate) {
    const now = new Date();
    await this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundException('Profile was not found.');
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const nicknameChanged =
        input.nickname !== undefined && input.nickname !== current.displayName;
      const nextBio = input.bio === undefined ? current.bio : input.bio || null;
      const bioChanged = nextBio !== current.bio;

      if (!nicknameChanged && !bioChanged) return;
      if (nicknameChanged) {
        const recentChanges = await tx.nicknameChange.findMany({
          where: { userId, changedAt: { gt: new Date(now.getTime() - nicknameChangeWindowMs) } },
          select: { changedAt: true },
          orderBy: { changedAt: 'asc' },
          take: nicknameChangeLimit,
        });
        if (recentChanges.length >= nicknameChangeLimit) {
          throw new NicknameChangeLimitException(
            new Date(recentChanges[0].changedAt.getTime() + nicknameChangeWindowMs),
          );
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          ...(nicknameChanged ? { displayName: input.nickname } : {}),
          ...(bioChanged ? { bio: nextBio } : {}),
        },
      });
      if (nicknameChanged) {
        await tx.nicknameChange.create({ data: { userId, changedAt: now } });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: 'profile.nickname.changed',
            targetType: 'user_profile',
            targetId: userId,
          },
        });
      }
      if (bioChanged) {
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: 'profile.bio.changed',
            targetType: 'user_profile',
            targetId: userId,
          },
        });
      }
    });
    return this.get(userId);
  }

  async replaceAvatar(userId: string, input: Buffer) {
    const newKey = await this.avatarStorage.store(userId, input);
    let previousKey: string | null = null;
    try {
      previousKey = await this.database.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
        `;
        if (locked.length !== 1) throw new NotFoundException('Profile was not found.');
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await tx.user.update({
          where: { id: userId },
          data: { avatarObjectKey: newKey, avatarUpdatedAt: new Date() },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: 'profile.avatar.changed',
            targetType: 'user_profile',
            targetId: userId,
          },
        });
        return current.avatarObjectKey;
      });
    } catch (error) {
      await this.avatarStorage.deleteBestEffort(newKey);
      throw error;
    }
    await this.avatarStorage.deleteBestEffort(previousKey);
    return this.get(userId);
  }

  async removeAvatar(userId: string) {
    const previousKey = await this.database.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundException('Profile was not found.');
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!current.avatarObjectKey) return null;
      await tx.user.update({
        where: { id: userId },
        data: { avatarObjectKey: null, avatarUpdatedAt: null },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'profile.avatar.removed',
          targetType: 'user_profile',
          targetId: userId,
        },
      });
      return current.avatarObjectKey;
    });
    await this.avatarStorage.deleteBestEffort(previousKey);
    return this.get(userId);
  }

  async loadAvatar(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { avatarObjectKey: true },
    });
    if (!user?.avatarObjectKey) throw new NotFoundException('Avatar was not found.');
    return this.avatarStorage.load(user.avatarObjectKey);
  }

  async loadReadableAvatar(actorUserId: string, targetUserId: string) {
    const target = await this.findReadableTarget(actorUserId, targetUserId);
    if (
      this.visibility(target.profileVisibility).avatar !== 'AUTHENTICATED' ||
      !target.avatarObjectKey
    ) {
      throw new NotFoundException('Avatar was not found.');
    }
    return this.avatarStorage.load(target.avatarObjectKey);
  }

  private async findReadableTarget(actorUserId: string, targetUserId: string) {
    const users = await this.database.user.findMany({
      where: { id: { in: [...new Set([actorUserId, targetUserId])] }, status: 'ACTIVE' },
      select: {
        id: true,
        displayName: true,
        bio: true,
        avatarObjectKey: true,
        avatarUpdatedAt: true,
        profileVisibility: true,
        contacts: {
          where: { retiredAt: null },
          orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
          select: { type: true, normalizedValue: true },
        },
      },
    });
    if (!users.some((user) => user.id === actorUserId)) throw new UnauthorizedException();
    const target = users.find((user) => user.id === targetUserId);
    if (!target) throw new NotFoundException('Profile was not found.');
    return target;
  }

  private visibility(
    value: {
      bio: ProfileFieldVisibility;
      avatar: ProfileFieldVisibility;
      email: ProfileFieldVisibility;
      phone: ProfileFieldVisibility;
    } | null,
  ): ProfileVisibility {
    return value
      ? { bio: value.bio, avatar: value.avatar, email: value.email, phone: value.phone }
      : { ...privateProfileVisibility };
  }

  private contact(
    contacts: Array<{ type: 'EMAIL' | 'PHONE'; normalizedValue: string }>,
    type: 'EMAIL' | 'PHONE',
  ) {
    return contacts.find((contact) => contact.type === type)?.normalizedValue ?? null;
  }

  private async present(
    user: {
      id: string;
      displayName: string;
      bio: string | null;
      avatarObjectKey: string | null;
      avatarUpdatedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      profileVisibility: {
        bio: ProfileFieldVisibility;
        avatar: ProfileFieldVisibility;
        email: ProfileFieldVisibility;
        phone: ProfileFieldVisibility;
      } | null;
      contacts: Array<{ type: 'EMAIL' | 'PHONE'; normalizedValue: string }>;
    },
    now: Date,
  ) {
    const changes = await this.database.nicknameChange.findMany({
      where: {
        userId: user.id,
        changedAt: { gt: new Date(now.getTime() - nicknameChangeWindowMs) },
      },
      select: { changedAt: true },
      orderBy: { changedAt: 'asc' },
      take: nicknameChangeLimit,
    });
    const exhausted = changes.length >= nicknameChangeLimit;
    return {
      id: user.id,
      nickname: user.displayName,
      bio: user.bio,
      email: this.contact(user.contacts, 'EMAIL'),
      phone: this.contact(user.contacts, 'PHONE'),
      avatarUrl:
        user.avatarObjectKey && user.avatarUpdatedAt
          ? `/api/profile/avatar?v=${user.avatarUpdatedAt.getTime()}`
          : null,
      visibility: this.visibility(user.profileVisibility),
      nicknameChangeQuota: {
        limit: nicknameChangeLimit,
        windowDays: 30,
        used: changes.length,
        remaining: Math.max(0, nicknameChangeLimit - changes.length),
        nextChangeAllowedAt: exhausted
          ? new Date(changes[0].changedAt.getTime() + nicknameChangeWindowMs).toISOString()
          : null,
      },
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
