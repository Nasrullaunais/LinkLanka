import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { DialectTargetLanguage, DialectTargetTone } from '../dialect.service';

export class RefineTextV2Dto {
  @IsString()
  @IsNotEmpty({ message: 'text must be a non-empty string' })
  @MaxLength(2000, { message: 'text must not exceed 2000 characters' })
  text!: string;

  @IsIn(['english', 'singlish', 'tanglish'], {
    message: 'targetLanguage must be one of: english, singlish, tanglish',
  })
  targetLanguage!: DialectTargetLanguage;

  @IsIn(['professional', 'casual'], {
    message: 'targetTone must be one of: professional, casual',
  })
  targetTone!: DialectTargetTone;
}
