import { Body, Controller, Post } from '@nestjs/common';

import { AuthService, LoginResponse, SafeUser } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

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
    });
  }

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto.email, dto.password);
  }
}
