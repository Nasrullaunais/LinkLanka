import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';

export interface RegisterDto {
  email: string;
  password: string;
  displayName: string;
  nativeDialect: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface LoginResponse {
  access_token: string;
  user: SafeUser;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<SafeUser> {
    const existingUser: User | null = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already in use');
    }

    const hashedPassword: string = await bcrypt.hash(dto.password, 10);

    const userToCreate: Partial<User> = {
      email: dto.email,
      passwordHash: hashedPassword,
      displayName: dto.displayName,
      nativeDialect: dto.nativeDialect,
    };

    const savedUser: User = await this.userRepository.save(userToCreate);
    return this.toSafeUser(savedUser);
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user: User | null = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid: boolean = await bcrypt.compare(
      password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken: string = await this.jwtService.signAsync(payload);

    return {
      access_token: accessToken,
      user: this.toSafeUser(user),
    };
  }

  private toSafeUser(user: User): SafeUser {
    const safeUser: Partial<User> = { ...user };
    delete safeUser.passwordHash;
    return safeUser as SafeUser;
  }
}
