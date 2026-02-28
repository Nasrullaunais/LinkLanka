import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('personal_context')
@Unique(['userId', 'slangWord'])
export class PersonalContext {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId!: string;

  @Column({ type: 'varchar', length: 100, name: 'slang_word', nullable: false })
  slangWord!: string;

  @Column({ type: 'varchar', length: 500, name: 'standard_meaning', nullable: false })
  standardMeaning!: string;

  @Column({ type: 'varchar', length: 50, name: 'dialect_type', nullable: true })
  dialectType!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
