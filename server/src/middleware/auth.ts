import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError } from './errorHandler.js';
import { getDb } from '../db/database.js';

export interface AuthUser {
  id: number;
  email: string;
  name?: string;
  role: 'admin' | 'user';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'Authentication required');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: number; sessionId: string };
    
    // Verify session is still valid
    const db = getDb();
    const session = db.prepare(`
      SELECT s.*, u.email, u.role 
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND s.expires_at > datetime('now')
    `).get(decoded.sessionId, decoded.userId) as { user_id: number; email: string; role: string } | undefined;

    if (!session) {
      throw new AppError(401, 'Session expired or invalid');
    }

    req.user = {
      id: session.user_id,
      email: session.email,
      role: session.role as 'admin' | 'user',
    };

    next();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(401, 'Invalid token');
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    throw new AppError(403, 'Admin access required');
  }
  next();
}
