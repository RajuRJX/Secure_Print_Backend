const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { auth } = require('../middleware/auth');
const { BadRequestError } = require('../utils/errors');
const db = require('../db');
const twilio = require('twilio');
const bcrypt = require('bcrypt');

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new BadRequestError('Only PDF and DOCX files are allowed'));
    }
  }
});

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Upload document
router.post('/upload', auth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { cyber_center_id } = req.body;
    if (!cyber_center_id) {
      return res.status(400).json({ message: 'Cyber center ID is required' });
    }

    // Check if cyber center exists
    const cyberCenter = await db('users')
      .where({ id: cyber_center_id, is_cyber_center: true })
      .first();
    
    if (!cyberCenter) {
      return res.status(400).json({ message: 'Invalid cyber center' });
    }

    // Check if user is a cyber center
    if (req.user.is_cyber_center) {
      return res.status(400).json({ message: 'Cyber centers cannot upload documents' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Upload to S3
    const key = `documents/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));

    // Save document info to database
    const [document] = await db('documents').insert({
      user_id: req.user.id,
      cyber_center_id,
      file_name: req.file.originalname,
      s3_key: key,
      otp,
      status: 'pending'
    }).returning('*');

    // Send OTP to the user who uploaded the document
    await twilioClient.messages.create({
      body: `Your OTP for document ${req.file.originalname} is: ${otp}. Please provide this OTP to the cyber center to print your document.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: req.user.phone_number
    });

    res.json({ 
      message: 'Document uploaded successfully',
      document_id: document.id
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's documents
router.get('/my-documents', auth, async (req, res) => {
  try {
    const documents = await db('documents')
      .where({ user_id: req.user.id })
      .select(
        'id',
        'file_name',
        'status',
        'created_at',
        'updated_at'
      )
      .orderBy('created_at', 'desc');
    
    res.json(documents);
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get cyber center's documents
router.get('/center-documents', auth, async (req, res) => {
  try {
    if (!req.user.is_cyber_center) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    console.log('Fetching documents for cyber center:', req.user.id);
    
    const documents = await db('documents')
      .where({ cyber_center_id: req.user.id })
      .select(
        'documents.id',
        'documents.file_name',
        'documents.status',
        'documents.created_at',
        'documents.otp',
        'users.name as uploaded_by'
      )
      .leftJoin('users', 'documents.user_id', 'users.id')
      .orderBy('documents.created_at', 'desc');
    
    console.log('Found documents:', documents);
    res.json(documents);
  } catch (error) {
    console.error('Get center documents error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify OTP and get document
router.post('/verify-otp', auth, async (req, res) => {
  try {
    const { document_id, otp } = req.body;

    if (!req.user.is_cyber_center) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const document = await db('documents')
      .where({ 
        id: document_id,
        cyber_center_id: req.user.id,
        otp
      })
      .first();

    if (!document) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    // Update document status
    await db('documents')
      .where({ id: document_id })
      .update({ status: 'printed' });

    // Get signed URL for document
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.s3_key
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({ 
      message: 'OTP verified successfully',
      document_url: signedUrl
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get signed URL for document
router.get('/:id/url', auth, async (req, res, next) => {
  try {
    const document = await db('documents')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!document) {
      throw new BadRequestError('Document not found');
    }

    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.s3_key
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    res.json({ signedUrl });
  } catch (error) {
    next(error);
  }
});

// Delete document
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const document = await db('documents')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!document) {
      throw new BadRequestError('Document not found');
    }

    // Delete from S3
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.s3_key
    }));

    // Delete from database
    await db('documents').where({ id: document.id }).delete();

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Direct upload via QR code (no auth required)
router.post('/direct-upload/:centerId', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { centerId } = req.params;
    const { name, phone_number } = req.body;

    if (!name || !phone_number) {
      return res.status(400).json({ message: 'Name and phone number are required' });
    }

    // Check if cyber center exists
    const cyberCenter = await db('users')
      .where({ id: centerId, is_cyber_center: true })
      .first();
    
    if (!cyberCenter) {
      return res.status(400).json({ message: 'Invalid cyber center' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Upload to S3
    const key = `documents/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));

    // Save document info to database
    const [document] = await db('documents').insert({
      cyber_center_id: centerId,
      file_name: req.file.originalname,
      s3_key: key,
      otp,
      status: 'pending',
      uploaded_by_name: name,
      uploaded_by_phone: phone_number
    }).returning('*');

    // Send OTP to the user who uploaded the document
    await twilioClient.messages.create({
      body: `Your OTP for document ${req.file.originalname} is: ${otp}. Please provide this OTP to the cyber center to print your document.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone_number
    });

    res.json({ 
      message: 'Document uploaded successfully',
      document_id: document.id
    });
  } catch (error) {
    console.error('Direct upload error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 