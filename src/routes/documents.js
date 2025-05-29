const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');
const { auth } = require('../middleware/auth');
const { BadRequestError } = require('../utils/errors');
const db = require('../db');
const twilio = require('twilio');
const bcrypt = require('bcrypt');
const { generateKey, encrypt, decrypt } = require('../utils/encryption');
const fs = require('fs');
const { sendOTPEmail } = require('../services/email');

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

    // Get user info first
    console.log('JWT User data:', req.user);
    
    const user = await db('users')
      .where({ id: req.user.id })
      .select('id', 'name', 'email', 'phone_number')
      .first();
    
    if (!user) {
      console.error('User not found in database for ID:', req.user.id);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User data from database:', {
      id: user.id,
      name: user.name,
      email: user.email,
      phone_number: user.phone_number
    });

    if (!user.name) {
      console.error('User name is missing for user ID:', user.id);
      return res.status(400).json({ error: 'User name is required' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Generate encryption key and encrypt file
    const encryptionKey = generateKey();
    const encryptedFile = encrypt(req.file.buffer, encryptionKey);

    // Upload encrypted file to S3
    const key = `documents/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: encryptedFile,
      ContentType: req.file.mimetype
    }));

    // Save document info to database
    const documentData = {
      cyber_center_id,
      file_name: req.file.originalname,
      s3_key: key,
      otp,
      otp_expires_at: otpExpiresAt,
      status: 'pending',
      encryption_key: encryptionKey,
      uploaded_by_name: user.name,
      uploaded_by_email: user.email,
      uploaded_by_phone: user.phone_number
    };

    console.log('Attempting to save document with data:', {
      ...documentData,
      encryption_key: '[REDACTED]'
    });

    // Log the SQL query that will be executed
    const query = db('documents')
      .insert(documentData)
      .returning('*')
      .toString();
    console.log('SQL Query:', query);

    const [document] = await db('documents')
      .insert(documentData)
      .returning('*');

    console.log('Saved document data:', {
      id: document.id,
      uploaded_by_name: document.uploaded_by_name,
      file_name: document.file_name,
      cyber_center_id: document.cyber_center_id
    });

    // Verify the document was saved correctly
    const savedDocument = await db('documents')
      .where({ id: document.id })
      .first();
    console.log('Verified saved document:', {
      id: savedDocument.id,
      uploaded_by_name: savedDocument.uploaded_by_name,
      file_name: savedDocument.file_name
    });

    // Send OTP via email to the user's email
    await sendOTPEmail(user.email, otp);

    res.status(201).json({
      message: 'Document uploaded successfully. Please check your email for OTP.',
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
        'documents.uploaded_by_name',
        'documents.uploaded_by_email',
        'documents.uploaded_by_phone'
      )
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
  let tempFilePath;
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

    // Get encrypted file from S3
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: document.s3_key
    });

    const response = await s3Client.send(command);
    const encryptedData = await response.Body.transformToByteArray();
    
    // Decrypt the file
    const decryptedData = decrypt(Buffer.from(encryptedData), document.encryption_key);

    // Create a temporary file with decrypted content
    tempFilePath = `/tmp/${document.file_name}`;
    await fs.writeFile(tempFilePath, decryptedData);

    // Generate signed URL for the decrypted file
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    res.json({ 
      message: 'OTP verified successfully',
      document_url: signedUrl
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Server error' });
  } finally {
    // Clean up temporary file if it exists
    if (tempFilePath) {
      try {
        await fs.unlink(tempFilePath);
      } catch (error) {
        console.error('Error cleaning up temporary file:', error);
      }
    }
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
    const { name, phone_number, email } = req.body;

    if (!name || !phone_number || !email) {
      return res.status(400).json({ message: 'Name, phone number, and email are required' });
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

    // Generate encryption key and encrypt file
    const encryptionKey = generateKey();
    const encryptedFile = encrypt(req.file.buffer, encryptionKey);

    // Upload encrypted file to S3
    const key = `documents/${Date.now()}-${req.file.originalname}`;
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: encryptedFile,
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
      uploaded_by_phone: phone_number,
      uploaded_by_email: email,
      encryption_key: encryptionKey
    }).returning('*');

    // Send OTP to both email and phone
    try {
      // Send OTP via email
      await sendOTPEmail(email, otp);
      
      // Send OTP via SMS
      await twilioClient.messages.create({
        body: `Your OTP for document ${req.file.originalname} is: ${otp}. Please provide this OTP to the cyber center to print your document.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone_number
      });
    } catch (error) {
      console.error('Error sending OTP:', error);
      // Continue with the response even if sending OTP fails
    }

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