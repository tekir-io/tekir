export class HttpException extends Error {
  public statusCode: number
  public code: string
  public details?: any

  constructor(message: string, statusCode: number, code?: string, details?: any) {
    super(message)
    this.name = 'HttpException'
    this.statusCode = statusCode
    this.code = code || 'HTTP_EXCEPTION'
    this.details = details
  }

  toJSON() {
    return {
      error: {
        message: this.message,
        code: this.code,
        statusCode: this.statusCode,
        ...(this.details ? { details: this.details } : {}),
      },
    }
  }
}

// 4xx Client Errors
export class BadRequestException extends HttpException {
  constructor(message = 'Bad Request', details?: any) {
    super(message, 400, 'BAD_REQUEST', details)
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message = 'Unauthorized', details?: any) {
    super(message, 401, 'UNAUTHORIZED', details)
  }
}

export class PaymentRequiredException extends HttpException {
  constructor(message = 'Payment Required', details?: any) {
    super(message, 402, 'PAYMENT_REQUIRED', details)
  }
}

export class ForbiddenException extends HttpException {
  constructor(message = 'Forbidden', details?: any) {
    super(message, 403, 'FORBIDDEN', details)
  }
}

export class NotFoundException extends HttpException {
  constructor(message = 'Not Found', details?: any) {
    super(message, 404, 'NOT_FOUND', details)
  }
}

export class MethodNotAllowedException extends HttpException {
  constructor(message = 'Method Not Allowed', details?: any) {
    super(message, 405, 'METHOD_NOT_ALLOWED', details)
  }
}

export class NotAcceptableException extends HttpException {
  constructor(message = 'Not Acceptable', details?: any) {
    super(message, 406, 'NOT_ACCEPTABLE', details)
  }
}

export class RequestTimeoutException extends HttpException {
  constructor(message = 'Request Timeout', details?: any) {
    super(message, 408, 'REQUEST_TIMEOUT', details)
  }
}

export class ConflictException extends HttpException {
  constructor(message = 'Conflict', details?: any) {
    super(message, 409, 'CONFLICT', details)
  }
}

export class GoneException extends HttpException {
  constructor(message = 'Gone', details?: any) {
    super(message, 410, 'GONE', details)
  }
}

export class PreconditionFailedException extends HttpException {
  constructor(message = 'Precondition Failed', details?: any) {
    super(message, 412, 'PRECONDITION_FAILED', details)
  }
}

export class PayloadTooLargeException extends HttpException {
  constructor(message = 'Payload Too Large', details?: any) {
    super(message, 413, 'PAYLOAD_TOO_LARGE', details)
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(message = 'Unsupported Media Type', details?: any) {
    super(message, 415, 'UNSUPPORTED_MEDIA_TYPE', details)
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message = 'Unprocessable Entity', details?: any) {
    super(message, 422, 'UNPROCESSABLE_ENTITY', details)
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(message = 'Too Many Requests', retryAfter?: number) {
    super(message, 429, 'TOO_MANY_REQUESTS', retryAfter ? { retryAfter } : undefined)
  }
}

// 5xx Server Errors
export class InternalServerException extends HttpException {
  constructor(message = 'Internal Server Error', details?: any) {
    super(message, 500, 'INTERNAL_SERVER_ERROR', details)
  }
}

export class NotImplementedException extends HttpException {
  constructor(message = 'Not Implemented', details?: any) {
    super(message, 501, 'NOT_IMPLEMENTED', details)
  }
}

export class BadGatewayException extends HttpException {
  constructor(message = 'Bad Gateway', details?: any) {
    super(message, 502, 'BAD_GATEWAY', details)
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(message = 'Service Unavailable', details?: any) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details)
  }
}

export class GatewayTimeoutException extends HttpException {
  constructor(message = 'Gateway Timeout', details?: any) {
    super(message, 504, 'GATEWAY_TIMEOUT', details)
  }
}
