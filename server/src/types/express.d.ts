declare global {
  namespace Express {
    interface Request {
      /** Set by requestId middleware; echoed as X-Request-Id and included in error responses. */
      id: string;
    }
  }
}

export {};
