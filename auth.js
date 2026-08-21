import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-verifyqa-key-123';

// Middleware to verify token
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, companyId, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { companyName, email, password } = req.body;
  if (!companyName || !email || !password) {
    return res.status(400).json({ error: 'Company name, email, and password are required.' });
  }

  try {
    // 1. Check if user already exists
    const userCheck = await pool.query('SELECT * FROM users WHERE email = ', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create Company
    const companyRes = await pool.query(
      'INSERT INTO companies (name) VALUES () RETURNING id',
      [companyName]
    );
    const companyId = companyRes.rows[0].id;

    // 4. Create User
    const userRes = await pool.query(
      'INSERT INTO users (company_id, email, password_hash, role) VALUES (, , , ) RETURNING id',
      [companyId, email, passwordHash, 'admin']
    );
    const userId = userRes.rows[0].id;

    // 5. Generate JWT Token
    const token = jwt.sign({ userId, companyId, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({ 
      message: 'Registration successful', 
      token, 
      user: { id: userId, email, companyId, companyName } 
    });
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    // 1. Find user
    const userRes = await pool.query('SELECT * FROM users WHERE email = ', [email]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const user = userRes.rows[0];

    // 2. Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 3. Get Company details
    const companyRes = await pool.query('SELECT name FROM companies WHERE id = ', [user.company_id]);
    const companyName = companyRes.rows[0]?.name || 'Unknown';

    // 4. Generate JWT Token
    const token = jwt.sign(
      { userId: user.id, companyId: user.company_id, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({ 
      message: 'Login successful', 
      token, 
      user: { id: user.id, email: user.email, companyId: user.company_id, companyName } 
    });
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

export default router;
