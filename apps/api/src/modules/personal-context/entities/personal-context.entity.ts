import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('personal_context')
export class PersonalContext {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId!: string;

  @Column({ type: 'varchar', name: 'slang_word', nullable: false })
  slangWord!: string;

  @Column({ type: 'text', name: 'standard_meaning', nullable: false })
  standardMeaning!: string;

  @Column({ type: 'varchar', name: 'dialect_type', nullable: true })
  dialectType!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
