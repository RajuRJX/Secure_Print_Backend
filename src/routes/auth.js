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
router.post('/register', async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone_number,
      is_cyber_center,
      center_name,
      center_address
    } = req.body;

    console.log('Received registration request:', req.body);

    // Check if user already exists
    const existingUser = await db('users').where({ email }).first();
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Prepare user data
    const userData = {
      name,
      email,
      password: hashedPassword,
      phone_number,
      is_cyber_center: is_cyber_center || false,
      center_name: is_cyber_center ? center_name : null,
      center_address: is_cyber_center ? center_address : null
    };

    console.log('Inserting user with data:', { ...userData, password: '[REDACTED]' });

    // Insert user into database
    const [user] = await db('users')
      .insert(userData)
      .returning(['id', 'name', 'email', 'phone_number', 'is_cyber_center', 'center_name', 'center_address']);

    console.log('User created successfully:', user);

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send response
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        is_cyber_center: user.is_cyber_center,
        center_name: user.center_name,
        center_address: user.center_address
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      message: 'Registration failed',
      error: error.message 
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);

    // Find user
    const user = await db('users').where({ email }).first();
    if (!user) {
      console.log('User not found for email:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log('Invalid password for user:', email);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    console.log('Login successful for user:', email);

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        is_cyber_center: user.is_cyber_center 
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Send response
    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        is_cyber_center: user.is_cyber_center,
        center_name: user.center_name,
        center_address: user.center_address
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: 'Login failed',
      error: error.message 
    });
  }
});

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
router.get('/profile', auth, async (req, res) => {
  try {
    console.log('Fetching profile for user ID:', req.user.id);
    
    const user = await db('users')
      .where({ id: req.user.id })
      .select('id', 'name', 'email', 'phone_number', 'is_cyber_center', 'center_name', 'center_address')
      .first();

    if (!user) {
      console.log('User not found for ID:', req.user.id);
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('Profile fetched successfully:', user);
    res.json(user);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch profile',
      error: error.message 
    });
  }
});

// Get cyber center QR code URL
router.get('/cyber-center-qr/:id', async (req, res, next) => {
  try {
    console.log('Fetching cyber center info for ID:', req.params.id);
    
    // Log the database query
    const query = db('users')
      .where({ 
        id: req.params.id,
        is_cyber_center: true 
      })
      .select('id', 'center_name', 'center_address')
      .toString();
    console.log('Database query:', query);
    
    const cyberCenter = await db('users')
      .where({ 
        id: req.params.id,
        is_cyber_center: true 
      })
      .select('id', 'center_name', 'center_address')
      .first();

    if (!cyberCenter) {
      console.log('Cyber center not found for ID:', req.params.id);
      // Log all cyber centers for debugging
      const allCenters = await db('users')
        .where({ is_cyber_center: true })
        .select('id', 'center_name', 'center_address');
      console.log('All cyber centers in database:', allCenters);
      throw new BadRequestError('Cyber center not found');
    }

    console.log('Found cyber center:', cyberCenter);

    // Generate QR code URL using the deployed frontend URL
    const qrCodeUrl = `https://secure-print-frontend.onrender.com/upload/${cyberCenter.id}`;
    console.log('Generated QR code URL:', qrCodeUrl);
    
    res.json({ 
      qrCodeUrl,
      centerName: cyberCenter.center_name,
      centerAddress: cyberCenter.center_address
    });
  } catch (error) {
    console.error('Error in cyber-center-qr route:', error);
    next(error);
  }
});

module.exports = router; 