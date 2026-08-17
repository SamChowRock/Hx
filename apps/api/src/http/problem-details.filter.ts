import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

type PrismaLikeError = Error & { code?: string };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request & { id?: string }>();

    const { status, title, detail, errors, code, retryAt } = this.describe(exception);
    if (retryAt) {
      response.setHeader(
        'Retry-After',
        Math.max(0, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 1_000)),
      );
    }
    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title,
        status,
        detail,
        instance: request.path,
        ...(request.id ? { requestId: request.id } : {}),
        ...(errors ? { errors } : {}),
        ...(code ? { code } : {}),
        ...(retryAt ? { retryAt } : {}),
      });
  }

  private describe(exception: unknown): {
    status: number;
    title: string;
    detail: string;
    errors?: Array<{ path: string; message: string }>;
    code?: string;
    retryAt?: string;
  } {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        title: 'Invalid request',
        detail: 'One or more request values are invalid.',
        errors: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }

    if (this.isPrismaError(exception, 'P2002')) {
      return {
        status: HttpStatus.CONFLICT,
        title: 'Conflict',
        detail: 'The requested record already exists.',
      };
    }

    if (this.isPrismaError(exception, 'P2025')) {
      return {
        status: HttpStatus.NOT_FOUND,
        title: 'Not found',
        detail: 'The requested record does not exist.',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body && 'message' in body
            ? Array.isArray(body.message)
              ? body.message.join('; ')
              : String(body.message)
            : exception.message;
      const code =
        typeof body === 'object' && body && 'code' in body && typeof body.code === 'string'
          ? body.code
          : undefined;
      const retryAt =
        typeof body === 'object' && body && 'retryAt' in body && typeof body.retryAt === 'string'
          ? body.retryAt
          : undefined;
      return { status, title: HttpStatus[status] ?? 'Request failed', detail, code, retryAt };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred.',
    };
  }

  private isPrismaError(exception: unknown, code: string): exception is PrismaLikeError {
    return exception instanceof Error && 'code' in exception && exception.code === code;
  }
}
