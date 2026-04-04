import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

import { PERSONAL_CONTEXT_DIALECTS } from '../personal-context.constants';

export class CreatePersonalContextDto {
  @IsString()
  @IsNotEmpty({ message: 'Slang word cannot be empty.' })
  @MaxLength(100, { message: 'Slang word must be at most 100 characters.' })
  slangWord!: string;

  @IsString()
  @IsNotEmpty({ message: 'Meaning cannot be empty.' })
  @MaxLength(500, { message: 'Meaning must be at most 500 characters.' })
  standardMeaning!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(PERSONAL_CONTEXT_DIALECTS, {
    message: 'Dialect type must be one of: singlish, english, tanglish.',
  })
  dialectType!: string;
}
