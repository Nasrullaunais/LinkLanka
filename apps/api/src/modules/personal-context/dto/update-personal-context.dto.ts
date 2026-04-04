import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

import { PERSONAL_CONTEXT_DIALECTS } from '../personal-context.constants';

export class UpdatePersonalContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Meaning must be at most 500 characters.' })
  standardMeaning?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsIn(PERSONAL_CONTEXT_DIALECTS, {
    message: 'Dialect type must be one of: singlish, english, tanglish.',
  })
  dialectType?: string;
}
