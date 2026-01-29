import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import { getDb } from '../db/database.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

// Login
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const db = getDb();

    // Find user
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as {
      id: number;
      email: string;
      password_hash: string;
      name: string;
      role: string;
    } | undefined;

    if (!user) {
      throw new AppError(401, 'Invalid email or password');
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password');
    }

    // Create session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + config.sessionDurationHours * 60 * 60 * 1000);

    db.prepare(`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(sessionId, user.id, expiresAt.toISOString());

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, sessionId },
      config.jwtSecret,
      { expiresIn: `${config.sessionDurationHours}h` }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Register (admin only in production, open in dev)
authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = registerSchema.parse(req.body);
    const db = getDb();

    // Check if user exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      throw new AppError(400, 'Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user (first user becomes admin)
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    const role = userCount.count === 0 ? 'admin' : 'user';

    const result = db.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (?, ?, ?, ?)
    `).run(email, passwordHash, name, role);

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: result.lastInsertRowid,
        email,
        name,
        role,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Logout
authRouter.post('/logout', authenticate, (req: AuthRequest, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, config.jwtSecret) as { sessionId: string };
        const db = getDb();
        db.prepare('DELETE FROM sessions WHERE id = ?').run(decoded.sessionId);
      } catch {
        // Token invalid, session probably already gone
      }
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    next(error);
  }
});

// Get current user
authRouter.get('/me', authenticate, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});
