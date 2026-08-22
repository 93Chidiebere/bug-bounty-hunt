import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ConvexHttpClient } from "convex/browser";
import dotenv from 'dotenv';

// Load Convex URL from .env.local
dotenv.config({ path: '.env.local' });

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-verifyqa-key-123';

// Initialize Convex Client gracefully
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

// Middleware to verify token
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
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
    if (!convex) {
      return res.status(500).json({ error: 'CRITICAL ERROR: Vercel is missing NEXT_PUBLIC_CONVEX_URL. Please add it and Redeploy.' });
    }

    // 1. Check if user already exists in Convex
    const existingUser = await convex.query("users:getUserByEmail", { email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered.' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 3. Create Company in Convex
    const companyId = await convex.mutation("users:createCompany", { name: companyName });

    // 4. Create User in Convex
    const userId = await convex.mutation("users:createUser", {
      companyId,
      email,
      passwordHash,
      role: 'admin'
    });

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
    if (!convex) {
      return res.status(500).json({ error: 'CRITICAL ERROR: Vercel is missing NEXT_PUBLIC_CONVEX_URL. Please add it and Redeploy.' });
    }

    // 1. Find user in Convex
    const user = await convex.query("users:getUserByEmail", { email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 2. Compare password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 3. Get Company details from Convex
    const company = await convex.query("users:getCompany", { companyId: user.companyId });
    const companyName = company ? company.name : 'Unknown';

    // 4. Generate JWT Token
    const token = jwt.sign(
      { userId: user._id, companyId: user.companyId, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.json({ 
      message: 'Login successful', 
      token, 
      user: { id: user._id, email: user.email, companyId: user.companyId, companyName } 
    });
  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

export default router;
