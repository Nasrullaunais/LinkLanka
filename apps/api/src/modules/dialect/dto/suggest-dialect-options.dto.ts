import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuggestDialectOptionsDto {
  @IsString()
  @IsNotEmpty({ message: 'text must be a non-empty string' })
  @MaxLength(2000, { message: 'text must not exceed 2000 characters' })
  text!: string;
}
