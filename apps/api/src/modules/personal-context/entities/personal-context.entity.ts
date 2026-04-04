import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import {
  DEFAULT_PERSONAL_CONTEXT_DIALECT,
  type PersonalContextDialect,
} from '../personal-context.constants';

@Entity('personal_context')
@Unique(['userId', 'slangWord', 'dialectType'])
export class PersonalContext {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id', nullable: false })
  userId!: string;

  @Column({ type: 'varchar', length: 100, name: 'slang_word', nullable: false })
  slangWord!: string;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'standard_meaning',
    nullable: false,
  })
  standardMeaning!: string;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'dialect_type',
    nullable: false,
    default: DEFAULT_PERSONAL_CONTEXT_DIALECT,
  })
  dialectType!: PersonalContextDialect;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
