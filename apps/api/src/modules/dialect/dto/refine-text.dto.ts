import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { RefineMode } from '../dialect.service';

export class RefineTextDto {
  @IsString()
  @IsNotEmpty({ message: 'text must be a non-empty string' })
  @MaxLength(2000, { message: 'text must not exceed 2000 characters' })
  text!: string;

  @IsIn(['professional', 'singlish', 'tanglish'], {
    message: 'mode must be one of: professional, singlish, tanglish',
  })
  mode!: RefineMode;
}
