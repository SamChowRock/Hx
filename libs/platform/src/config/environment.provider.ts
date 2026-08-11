import { loadEnvironment } from './environment';

export const ENVIRONMENT = Symbol('ENVIRONMENT');

export const environmentProvider = {
  provide: ENVIRONMENT,
  useFactory: loadEnvironment,
};
