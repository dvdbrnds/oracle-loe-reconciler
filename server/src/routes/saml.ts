import { Router } from 'express';
import passport from 'passport';
import { Strategy as SamlStrategy, Profile, VerifiedCallback } from '@node-saml/passport-saml';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getDb } from '../db/database.js';
import { config } from '../config.js';

export const samlRouter = Router();

// Configure SAML Strategy
const samlStrategy = new SamlStrategy(
  {
    entryPoint: config.samlEntryPoint,
    issuer: 'https://loe.moravian.edu',
    callbackUrl: config.samlCallbackUrl,
    idpCert: config.samlCert,
    wantAssertionsSigned: false,
    wantAuthnResponseSigned: false,
  },
  // Verify callback
  (profile: Profile | null | undefined, done: VerifiedCallback) => {
    if (!profile) {
      return done(new Error('No profile returned from SAML'));
    }
    
    // Extract user info from SAML response
    const email = profile.nameID || (profile as any).email;
    const firstName = (profile as any).firstName || (profile as any).givenName || '';
    const lastName = (profile as any).lastName || (profile as any).surname || '';
    const name = firstName && lastName ? `${firstName} ${lastName}` : email?.split('@')[0] || 'User';
    
    if (!email) {
      return done(new Error('No email found in SAML response'));
    }
    
    const user = { email, name, firstName, lastName } as Record<string, unknown>;
    return done(null, user);
  },
  // Logout callback
  (profile: Profile | null | undefined, done: VerifiedCallback) => {
    done(null, undefined);
  }
);

passport.use('saml', samlStrategy);

// Serialize/deserialize user for session
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user: Express.User, done) => {
  done(null, user);
});

// Initiate SAML login
samlRouter.get('/login', (req, res, next) => {
  passport.authenticate('saml', {
    failureRedirect: '/login?error=saml_failed',
  })(req, res, next);
});

// SAML callback (Assertion Consumer Service)
samlRouter.post('/callback',
  passport.authenticate('saml', {
    failureRedirect: '/login?error=saml_failed',
    session: false,
  }),
  async (req, res) => {
    try {
      const samlUser = req.user as { email: string; name: string };
      
      if (!samlUser || !samlUser.email) {
        return res.redirect('/login?error=no_email');
      }
      
      const db = getDb();
      
      // Find or create user
      let user = db.prepare('SELECT * FROM users WHERE email = ?').get(samlUser.email) as {
        id: number;
        email: string;
        name: string;
        role: string;
      } | undefined;
      
      if (!user) {
        // Create new user from SAML data
        // First user becomes admin, others are regular users
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
        const role = userCount.count === 0 ? 'admin' : 'user';
        
        const result = db.prepare(`
          INSERT INTO users (email, password_hash, name, role)
          VALUES (?, ?, ?, ?)
        `).run(samlUser.email, 'SAML_USER_NO_PASSWORD', samlUser.name, role);
        
        user = {
          id: result.lastInsertRowid as number,
          email: samlUser.email,
          name: samlUser.name,
          role,
        };
        
        console.log(`✅ Created new user from SAML: ${samlUser.email}`);
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
      
      // Redirect to frontend with token
      // The frontend will pick this up and store it
      res.redirect(`/?token=${token}`);
    } catch (error) {
      console.error('SAML callback error:', error);
      res.redirect('/login?error=saml_callback_failed');
    }
  }
);

// SAML metadata endpoint (optional, for IdP configuration)
samlRouter.get('/metadata', (req, res) => {
  res.type('application/xml');
  res.send(samlStrategy.generateServiceProviderMetadata(null as any, null as any));
});

// Check if SAML is enabled
samlRouter.get('/enabled', (req, res) => {
  res.json({ enabled: config.samlEnabled });
});
