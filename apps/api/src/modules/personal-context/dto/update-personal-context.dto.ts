import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePersonalContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Meaning must be at most 500 characters.' })
  standardMeaning?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Dialect type must be at most 50 characters.' })
  dialectType?: string | null;
}
