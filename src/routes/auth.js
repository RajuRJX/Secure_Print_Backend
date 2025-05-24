const express = require('express');
const { body } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validateRequest } = require('../middleware/validateRequest');
const { BadRequestError, UnauthorizedError } = require('../utils/errors');
const db = require('../db');
const { sendOTP } = require('../services/sms');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Register user
router.post('/register',
  [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('phone_number').notEmpty().withMessage('Phone number is required'),
    body('is_cyber_center').isBoolean().withMessage('Invalid cyber center status'),
    body('center_name').if(body('is_cyber_center').equals(true)).notEmpty().withMessage('Center name is required for cyber centers'),
    body('center_address').if(body('is_cyber_center').equals(true)).notEmpty().withMessage('Center address is required for cyber centers')
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { name, email, password, phone_number, is_cyber_center, center_name, center_address } = req.body;
      console.log('Registration request:', { name, email, phone_number, is_cyber_center, center_name, center_address });

      // Check if user already exists
      const existingUser = await db('users').where({ email }).first();
      if (existingUser) {
        throw new BadRequestError('Email already registered');
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const [user] = await db('users').insert({
        name,
        email,
        password: hashedPassword,
        phone_number,
        is_cyber_center,
        center_name: is_cyber_center ? center_name : null,
        center_address: is_cyber_center ? center_address : null
      }).returning(['id', 'email', 'name', 'phone_number', 'is_cyber_center', 'center_name', 'center_address']);

      console.log('Created user:', user);

      // Generate JWT
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          is_cyber_center: user.is_cyber_center,
          phone_number: user.phone_number,
          center_name: user.center_name,
          center_address: user.center_address
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.status(201).json({ user, token });
    } catch (error) {
      console.error('Registration error:', error);
      next(error);
    }
  }
);

// Login user
router.post('/login',
  [
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await db('users').where({ email }).first();
      if (!user) {
        throw new BadRequestError('Invalid credentials');
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        throw new BadRequestError('Invalid credentials');
      }

      // Generate JWT
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          is_cyber_center: user.is_cyber_center,
          phone_number: user.phone_number,
          center_name: user.center_name,
          center_address: user.center_address
        },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      const { password: _, ...userWithoutPassword } = user;
      res.json({ user: userWithoutPassword, token });
    } catch (error) {
      next(error);
    }
  }
);

// Get cyber centers
router.get('/cyber-centers', async (req, res, next) => {
  try {
    console.log('Fetching cyber centers...');
    const centers = await db('users')
      .where({ is_cyber_center: true })
      .select('id', 'name', 'center_name', 'center_address', 'phone_number');
    
    console.log('Found cyber centers:', centers);
    
    if (!centers || centers.length === 0) {
      console.log('No cyber centers found');
      return res.json([]);
    }

    res.json(centers);
  } catch (error) {
    console.error('Get cyber centers error:', error);
    next(error);
  }
});

// Get user profile
router.get('/profile', auth, async (req, res, next) => {
  try {
    const user = await db('users')
      .where({ id: req.user.id })
      .select('id', 'name', 'email', 'phone_number', 'is_cyber_center', 'center_name', 'center_address')
      .first();
    
    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    res.json(user);
  } catch (error) {
    next(error);
  }
});

// Get cyber center QR code URL
router.get('/cyber-center-qr/:id', auth, async (req, res, next) => {
  try {
    const cyberCenter = await db('users')
      .where({ 
        id: req.params.id,
        is_cyber_center: true 
      })
      .select('id', 'center_name', 'center_address')
      .first();

    if (!cyberCenter) {
      throw new BadRequestError('Cyber center not found');
    }

    // Generate QR code URL
    const qrCodeUrl = `${process.env.FRONTEND_URL}/upload/${cyberCenter.id}`;
    
    res.json({ 
      qrCodeUrl,
      centerName: cyberCenter.center_name,
      centerAddress: cyberCenter.center_address
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router; 