import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const developmentAuthSecret = 'development-only-auth-secret-change-before-production';

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .url()
      .default('postgresql://scaffold:scaffold@localhost:5432/scaffold'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    API_CORS_ORIGINS: z.string().default(''),
    SERVICE_NAME: z.string().min(1).default('nestjs-production-scaffold'),
    TRUST_PROXY: booleanFromString.default('false'),
    AUTH_SECRET: z.string().min(32).default(developmentAuthSecret),
    SMTP_URL: z.string().url().default('smtp://localhost:1025'),
    EMAIL_FROM: z.string().email().default('no-reply@example.test'),
    SMS_PROVIDER: z.enum(['disabled', 'twilio']).default('disabled'),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM: z.string().min(1).optional(),
    WEB_APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    API_PUBLIC_ORIGIN: z.string().url().default('http://localhost:3000'),
    OIDC_PROVIDER_KEY: z.string().min(1).optional(),
    OIDC_ISSUER: z.string().url().optional(),
    OIDC_CLIENT_ID: z.string().min(1).optional(),
    OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .superRefine((environment, context) => {
    const deployed = environment.NODE_ENV === 'staging' || environment.NODE_ENV === 'production';
    if (deployed && environment.AUTH_SECRET === developmentAuthSecret) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_SECRET'],
        message: 'must be explicitly configured outside development and test',
      });
    }

    if (deployed) {
      for (const [name, value] of [
        ['WEB_APP_ORIGIN', environment.WEB_APP_ORIGIN],
        ['API_PUBLIC_ORIGIN', environment.API_PUBLIC_ORIGIN],
      ] as const) {
        if (new URL(value).protocol !== 'https:') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: 'must use HTTPS outside development and test',
          });
        }
      }

      const allowedOrigins = environment.API_CORS_ORIGINS.split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (!allowedOrigins.includes(new URL(environment.WEB_APP_ORIGIN).origin)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['API_CORS_ORIGINS'],
          message: 'must include WEB_APP_ORIGIN outside development and test',
        });
      }
    }

    const oidcValues = [
      environment.OIDC_PROVIDER_KEY,
      environment.OIDC_ISSUER,
      environment.OIDC_CLIENT_ID,
    ];
    const configuredOidcValues = oidcValues.filter(Boolean).length;
    if (configuredOidcValues > 0 && configuredOidcValues !== oidcValues.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OIDC_PROVIDER_KEY'],
        message: 'OIDC provider key, issuer, and client ID must be configured together',
      });
    }

    if (environment.SMS_PROVIDER === 'twilio') {
      for (const [name, value] of [
        ['TWILIO_ACCOUNT_SID', environment.TWILIO_ACCOUNT_SID],
        ['TWILIO_AUTH_TOKEN', environment.TWILIO_AUTH_TOKEN],
        ['TWILIO_FROM', environment.TWILIO_FROM],
      ] as const) {
        if (!value) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [name],
            message: 'is required when SMS_PROVIDER=twilio',
          });
        }
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}

export function corsOrigins(config: Environment): string[] {
  return config.API_CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
