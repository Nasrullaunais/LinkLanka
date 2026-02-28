import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Message } from '../../../modules/chat/entities/message.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', name: 'email', unique: true, nullable: false })
  email!: string;

  @Column({ type: 'varchar', name: 'password_hash', nullable: false })
  passwordHash!: string;

  @Column({ type: 'varchar', name: 'display_name', nullable: false })
  displayName!: string;

  @Column({ type: 'varchar', name: 'native_dialect', nullable: false })
  nativeDialect!: string;

  @Column({ type: 'varchar', name: 'profile_picture_url', nullable: true, default: null })
  profilePictureUrl!: string | null;

  @Column({ type: 'varchar', name: 'expo_push_token', nullable: true, default: null })
  expoPushToken!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => Message, (message) => message.sender)
  messages: Message[];
}
