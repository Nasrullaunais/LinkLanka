import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('chat_groups')
export class ChatGroup {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'varchar', name: 'name', nullable: true })
  name!: string | null;

  @Column({ type: 'boolean', name: 'is_group', default: false })
  isGroup!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
