const express = require('express');
const { body } = require('express-validator');
const { auth, isCyberCenter } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validateRequest');
const { BadRequestError } = require('../utils/errors');
const db = require('../db');
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const execAsync = promisify(exec);

const router = express.Router();

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// Configure multer for file upload
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  })
});

router.post('/print', auth, isCyberCenter, async (req, res, next) => {
    try {
      const { document_id, otp } = req.body;
  
      const document = await db('documents')
        .where({ id: document_id })
        .first();
  
      if (!document) {
        throw new BadRequestError('Document not found');
      }
  
      if (document.otp !== otp) {
        throw new BadRequestError('Invalid OTP');
      }
  
      // Fetch encrypted file from S3
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: document.s3_key
      });

      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes

      // Update document status
      await db('documents')
        .where({ id: document_id })
        .update({
          status: 'printed',
          printed_at: new Date()
        });

      res.json({ signedUrl });
    } catch (error) {
      next(error);
    }
  }
);

// Verify OTP and get print URL
router.post('/verify',
  auth,
  isCyberCenter,
  [
    body('document_id').isInt().withMessage('Invalid document ID'),
    body('otp').notEmpty().withMessage('OTP is required')
  ],
  validateRequest,
  async (req, res, next) => {
    try {
      const { document_id, otp } = req.body;

      console.log('Verifying OTP for document:', document_id, 'OTP:', otp);

      const document = await db('documents')
        .where({ id: document_id })
        .first();

      if (!document) {
        throw new BadRequestError('Document not found');
      }

      if (document.status === 'printed') {
        throw new BadRequestError('Document has already been printed');
      }

      if (document.otp !== otp) {
        throw new BadRequestError('Invalid OTP');
      }

      // Generate signed URL for printing
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: document.s3_key
      });

      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes

      // Update document status
      await db('documents')
        .where({ id: document_id })
        .update({
          status: 'printed'
        });

      // Instead of sending the signed URL directly, send the print service URL
      const printServiceUrl = `${process.env.PRINT_SERVICE_URL}/print?url=${encodeURIComponent(signedUrl)}`;
      res.json({ printServiceUrl });
    } catch (error) {
      console.error('Print verification error:', error);
      next(error);
    }
  }
);

// List available documents for printing
router.get('/available', auth, isCyberCenter, async (req, res, next) => {
  try {
    const documents = await db('documents')
      .where('status', 'pending')
      .select(
        'id',
        'file_name',
        'status',
        'created_at',
        'otp'
      )
      .orderBy('created_at', 'desc');

    res.json(documents);
  } catch (error) {
    next(error);
  }
});

// Delete printed document
router.delete('/:id', auth, isCyberCenter, async (req, res, next) => {
  try {
    const document = await db('documents')
      .where({ id: req.params.id, status: 'printed' })
      .first();

    if (!document) {
      throw new BadRequestError('Document not found or not printed');
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

// Process document endpoint
router.post('/process', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { otp, printMode } = req.body;
    if (!otp) {
      return res.status(400).json({ message: 'OTP is required' });
    }

    // Verify OTP here (implement your OTP verification logic)
    // const isValidOTP = await verifyOTP(otp);
    // if (!isValidOTP) {
    //   return res.status(401).json({ message: 'Invalid OTP' });
    // }

    const inputFile = req.file.path;
    const outputFile = inputFile + '.pdf';

    // Convert DOCX to PDF using LibreOffice
    if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        await execAsync(`soffice --headless --convert-to pdf --outdir "${path.dirname(inputFile)}" "${inputFile}"`);
        
        // Read the converted PDF
        const pdfBuffer = await fs.readFile(outputFile);
        
        // Clean up temporary files
        await fs.unlink(inputFile);
        await fs.unlink(outputFile);
        
        // Send the PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.send(pdfBuffer);
      } catch (error) {
        console.error('Conversion error:', error);
        return res.status(500).json({ message: 'Failed to convert document to PDF' });
      }
    } else if (req.file.mimetype === 'application/pdf') {
      // For PDF files, just send them directly
      const pdfBuffer = await fs.readFile(inputFile);
      
      // Clean up temporary file
      await fs.unlink(inputFile);
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      res.send(pdfBuffer);
    } else {
      return res.status(400).json({ message: 'Unsupported file type' });
    }
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ message: 'Failed to process document' });
  }
});

module.exports = router; 