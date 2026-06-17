import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { UsersService } from '../users/users.service';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../users/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;       // User ID
  email: string;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly BCRYPT_ROUNDS = 12;
  // Access token lifetime in seconds (15 minutes default).
  private readonly ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  /**
   * Register a new user.
   * Throws ConflictException if email or username is already taken.
   */
  async register(dto: RegisterDto): Promise<{ user: User; tokens: AuthTokens }> {
    // Check for existing email.
    const existingByEmail = await this.usersService.findByEmail(dto.email);
    if (existingByEmail) {
      throw new ConflictException('Email is already registered');
    }

    // Check for existing username.
    const existingByUsername = await this.usersService.findByUsername(dto.username);
    if (existingByUsername) {
      throw new ConflictException('Username is already taken');
    }

    // Hash the password.
    const passwordHash = await bcrypt.hash(dto.password, this.BCRYPT_ROUNDS);

    // Create the user.
    const user = await this.usersService.create({
      email: dto.email.toLowerCase().trim(),
      username: dto.username.trim(),
      passwordHash,
    });

    const tokens = await this.generateAndStoreTokens(user);
    return { user, tokens };
  }

  /**
   * Validate user credentials for local (email/password) authentication.
   * Used by the LocalStrategy.
   */
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  /**
   * Generate access + refresh tokens after successful login/registration.
   */
  async login(user: User): Promise<AuthTokens> {
    return this.generateAndStoreTokens(user);
  }

  /**
   * Refresh access token using a valid refresh token.
   */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    if (!stored || !stored.isValid()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    // Rotate refresh token (revoke old, issue new).
    stored.isRevoked = true;
    await this.refreshTokenRepo.save(stored);

    return this.generateAndStoreTokens(stored.user);
  }

  /**
   * Revoke a specific refresh token (logout from this device).
   */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.refreshTokenRepo.update({ tokenHash }, { isRevoked: true });
  }

  /**
   * Revoke all refresh tokens for a user (logout from all devices).
   */
  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenRepo.update(
      { userId, isRevoked: false },
      { isRevoked: true },
    );
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  private async generateAndStoreTokens(user: User): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    };

    // Sign access token.
    const accessToken = this.jwtService.sign(payload);

    // Sign refresh token with separate secret and longer expiry.
    const refreshSecret = this.config.get<string>('app.jwt.refreshSecret');
    const refreshExpiresIn = this.config.get<string>('app.jwt.refreshExpiresIn', '7d');
    const rawRefreshToken = this.jwtService.sign(
      { sub: user.id },
      { secret: refreshSecret, expiresIn: refreshExpiresIn },
    );

    // Store hashed refresh token.
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days from now.

    const refreshToken = this.refreshTokenRepo.create({
      userId: user.id,
      tokenHash,
      expiresAt,
      isRevoked: false,
    });
    await this.refreshTokenRepo.save(refreshToken);

    // Clean up old revoked tokens for this user (background cleanup).
    this.cleanupExpiredTokens(user.id).catch(() => {});

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.ACCESS_TOKEN_EXPIRY_SECONDS,
    };
  }

  /** SHA-256 hash of raw token for secure storage. */
  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /** Remove expired/revoked tokens for a user to keep the table clean. */
  private async cleanupExpiredTokens(userId: string): Promise<void> {
    await this.refreshTokenRepo
      .createQueryBuilder()
      .delete()
      .where('user_id = :userId', { userId })
      .andWhere('(is_revoked = true OR expires_at < NOW())')
      .execute();
  }
}
