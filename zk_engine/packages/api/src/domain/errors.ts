/**
 * Domain error model → RFC 9457 problem+json (§5 of the design review).
 * Codes are stable identifiers clients switch on; `status` is the HTTP code.
 */

export interface ProblemDetail {
  type: string;
  status: number;
  title: string;
  detail?: string | undefined;
  code: string;
  errors?: { path: string; message: string }[] | undefined;
}

const TYPES = 'https://api.zkpe.dev/errors';

export const PROBLEM_TITLES: Record<string, { status: number; title: string }> = {
  'MALFORMED-BODY': { status: 400, title: 'Malformed request body' },
  'MALFORMED-CORRELATION': { status: 400, title: 'Malformed X-Request-ID' },
  'AUTH-MISSING': { status: 401, title: 'Missing authentication headers' },
  'AUTH-UNKNOWN-CLIENT': { status: 401, title: 'Unknown API client' },
  'AUTH-BAD-SIGNATURE': { status: 401, title: 'Invalid request signature' },
  'AUTH-EXPIRED': { status: 401, title: 'Request timestamp outside the allowed window' },
  'AUTH-REPLAY': { status: 401, title: 'Nonce already used' },
  'AUTH-FORBIDDEN': { status: 403, title: 'Insufficient role for this resource' },
  'NOT-FOUND': { status: 404, title: 'Resource not found' },
  'STATE-CONFLICT': { status: 409, title: 'Idempotency key reused with a different payload' },
  'PAYLOAD-TOO-LARGE': { status: 413, title: 'Request payload exceeds the limit' },
  'UNSUPPORTED-MEDIA-TYPE': { status: 415, title: 'Unsupported media type' },
  'VALIDATION': { status: 422, title: 'Request failed validation' },
  'UNVERIFIED': { status: 428, title: 'Proof did not verify against the certified key' },
  'RATE-LIMITED': { status: 429, title: 'Rate limit exceeded' },
  'OUT-OF-SERVICE': { status: 503, title: 'Service component unavailable' },
  'INTERNAL': { status: 500, title: 'Internal error' },
  'UPSTREAM-ENGINE': { status: 502, title: 'Proof engine unavailable' },
  'UPSTREAM-REGISTRY': { status: 502, title: 'Registry unavailable' },
};

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string | undefined;
  readonly errors?: { path: string; message: string }[] | undefined;

  constructor(
    code: string,
    opts: { detail?: string | undefined; errors?: { path: string; message: string }[] | undefined; cause?: unknown } = {},
  ) {
    const meta = PROBLEM_TITLES[code] ?? PROBLEM_TITLES['INTERNAL']!;
    super(meta.title + (opts.detail ? `: ${opts.detail}` : ''));
    this.name = 'DomainError';
    this.code = code;
    this.status = meta.status;
    if (opts.detail !== undefined) this.detail = opts.detail;
    if (opts.errors !== undefined) this.errors = opts.errors;
    if (opts.cause !== undefined) this.cause = opts.cause as Error;
  }

  toProblem(instance: string, requestId: string): {
    type: string;
    status: number;
    title: string;
    detail?: string | undefined;
    code: string;
    errors?: { path: string; message: string }[] | undefined;
    instance: string;
    requestId: string;
  } {
    return {
      type: `${TYPES}/${this.code}`,
      status: this.status,
      title: PROBLEM_TITLES[this.code]?.title ?? 'Internal error',
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      code: this.code,
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
      instance,
      requestId,
    };
  }
}

export function validationProblem(
  errors: { path: string; message: string }[],
  detail?: string,
): DomainError {
  return new DomainError('VALIDATION', { errors, detail: detail ?? `${errors.length} constraints violated` });
}