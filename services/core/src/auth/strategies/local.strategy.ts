import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email', // Use 'email' as the username field.
      passwordField: 'password',
    });
  }

  /**
   * Called by LocalAuthGuard.
   * Returns the user if credentials are valid, throws UnauthorizedException otherwise.
   */
  async validate(email: string, password: string) {
    return this.authService.validateUser(email, password);
  }
}
