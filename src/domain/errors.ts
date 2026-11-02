export type ErrorStatus = 400 | 403 | 404 | 409;

export class DomainError extends Error {
  readonly code: string;
  readonly status: ErrorStatus;

  constructor(code: string, messageTh: string, status: ErrorStatus = 400) {
    super(messageTh);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}
