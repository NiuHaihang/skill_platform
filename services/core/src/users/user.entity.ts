import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export type UserRole = 'user' | 'creator' | 'admin';

@Entity('users')
export class User {
  @ApiProperty({ description: 'User UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'User email address' })
  @Column({ type: 'varchar', length: 255, unique: true })
  @Index()
  email: string;

  @ApiProperty({ description: 'Username (URL-friendly)' })
  @Column({ type: 'varchar', length: 50, unique: true })
  @Index()
  username: string;

  @Exclude()
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @ApiProperty({ enum: ['user', 'creator', 'admin'] })
  @Column({
    type: 'varchar',
    length: 20,
    default: 'user',
  })
  role: UserRole;

  @ApiProperty({ description: 'Avatar URL', nullable: true })
  @Column({ name: 'avatar_url', type: 'varchar', length: 500, nullable: true })
  avatarUrl?: string;

  @ApiProperty({ description: 'User bio', nullable: true })
  @Column({ type: 'text', nullable: true })
  bio?: string;

  @ApiProperty({ description: 'Email verification status' })
  @Column({ name: 'is_email_verified', type: 'boolean', default: false })
  isEmailVerified: boolean;

  @ApiProperty({ description: 'Account active status' })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
