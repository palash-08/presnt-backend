import { Request, Response, NextFunction } from 'express';

/**
 * Global error handler — catches any unhandled errors in route handlers.
 * Keeps the server from crashing on unexpected errors.
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('❌ Unhandled error:', err.message);
  console.error(err.stack);

  res.status(500).json({
    error: 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
  });
};
