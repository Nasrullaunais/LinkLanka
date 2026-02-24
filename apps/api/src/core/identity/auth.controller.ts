import { Body, Controller, Post } from '@nestjs/common';

import { AuthService, LoginResponse, SafeUser } from './auth.service';

class RegisterDto {
  email!: string;
  password!: string;
  display_name!: string;
  native_dialect!: string;
  target_language!: string;
}

class LoginDto {
  email!: string;
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<SafeUser> {
    return this.authService.register({
      email: dto.email,
      password: dto.password,
      displayName: dto.display_name,
      nativeDialect: dto.native_dialect,
      targetLanguage: dto.target_language,
    });
  }

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto.email, dto.password);
  }
}
