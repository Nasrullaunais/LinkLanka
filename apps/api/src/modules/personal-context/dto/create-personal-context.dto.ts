import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePersonalContextDto {
  @IsString()
  @IsNotEmpty({ message: 'Slang word cannot be empty.' })
  @MaxLength(100, { message: 'Slang word must be at most 100 characters.' })
  slangWord!: string;

  @IsString()
  @IsNotEmpty({ message: 'Meaning cannot be empty.' })
  @MaxLength(500, { message: 'Meaning must be at most 500 characters.' })
  standardMeaning!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'Dialect type must be at most 50 characters.' })
  dialectType?: string;
}
