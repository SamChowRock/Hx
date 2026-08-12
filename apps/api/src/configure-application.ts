import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { loadEnvironment, type Environment } from '../../../libs/platform/src/config';

import { ProblemDetailsFilter } from './http/problem-details.filter';

export function configureApplication(
  app: INestApplication,
  environment: Environment = loadEnvironment(),
): void {
  const deployed = environment.NODE_ENV === 'staging' || environment.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: deployed ? undefined : false,
      strictTransportSecurity: deployed ? undefined : false,
    }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.originalUrl.startsWith('/api/auth')) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }
    next();
  });
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.setGlobalPrefix('api');
}
