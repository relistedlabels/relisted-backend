import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SiteFeaturesService } from './site-features.service';
import { OPERATIONS_PAUSE_USER_MESSAGE } from './operations-pause.types';

@Injectable()
export class OperationsPauseGuard implements CanActivate {
  constructor(private readonly siteFeatures: SiteFeaturesService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const pause = await this.siteFeatures.getOperationsPause();
    if (!pause.active) return true;

    throw new ServiceUnavailableException(
      `${OPERATIONS_PAUSE_USER_MESSAGE} We reopen in ${pause.resumeLabel}.`,
    );
  }
}
