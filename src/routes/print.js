const express = require('express');
const { body } = require('express-validator');
const { auth, isCyberCenter } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validateRequest');
const { BadRequestError } = require('../utils/errors');
const db = require('../db');
const { S3Client, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { decrypt } = require('../utils/encryption');

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

// Get system temp directory
const getTempDir = () => {
  return os.tmpdir();
};

// Ensure temp directory exists
const ensureTempDir = async () => {
  const tempDir = getTempDir();
  try {
    await fs.access(tempDir);
  } catch {
    await fs.mkdir(tempDir, { recursive: true });
  }
  return tempDir;
};

// Clean up old temporary files
const cleanupTempFiles = async () => {
  const tempDir = getTempDir();
  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith('secure-print-')) {
        const filePath = path.join(tempDir, file);
        try {
          const stats = await fs.stat(filePath);
          // Delete files older than 5 minutes
          if (now - stats.mtimeMs > 300000) {
            await fs.unlink(filePath);
          }
        } catch (error) {
          console.error(`Error cleaning up file ${file}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up temp directory:', error);
  }
};

// Run cleanup every 5 minutes
setInterval(cleanupTempFiles, 300000);

router.post('/print', auth, isCyberCenter, async (req, res, next) => {
  let tempFilePath;
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

    const response = await s3Client.send(command);
    const encryptedData = await response.Body.transformToByteArray();
    
    // Decrypt the file
    const decryptedData = decrypt(Buffer.from(encryptedData), document.encryption_key);

    // Create a temporary file with decrypted content
    const tempDir = await ensureTempDir();
    tempFilePath = path.join(tempDir, `secure-print-${Date.now()}-${document.file_name}`);
    await fs.writeFile(tempFilePath, decryptedData);

    // Update document status
    await db('documents')
      .where({ id: document_id })
      .update({
        status: 'printed',
        printed_at: new Date()
      });

    // Generate signed URL for the decrypted file
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 }); // 5 minutes

    res.json({ signedUrl });
  } catch (error) {
    next(error);
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
    let tempFilePath;
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

      // Fetch encrypted file from S3
      const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: document.s3_key
      });

      const response = await s3Client.send(command);
      const encryptedData = await response.Body.transformToByteArray();
      
      // Decrypt the file
      const decryptedData = decrypt(Buffer.from(encryptedData), document.encryption_key);

      // Create a temporary file with decrypted content
      const tempDir = await ensureTempDir();
      tempFilePath = path.join(tempDir, `secure-print-${Date.now()}-${document.file_name}`);
      await fs.writeFile(tempFilePath, decryptedData);

      // Upload decrypted file to S3 with a temporary key
      const tempKey = `temp/${Date.now()}-${document.file_name}`;
      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: tempKey,
        Body: decryptedData,
        ContentType: document.file_name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }));

      // Generate signed URL for the decrypted file
      const tempCommand = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: tempKey
      });

      const signedUrl = await getSignedUrl(s3Client, tempCommand, { expiresIn: 300 }); // 5 minutes

      // Update document status
      await db('documents')
        .where({ id: document_id })
        .update({
          status: 'printed'
        });

      // Construct print service URL with proper encoding
      const printServiceUrl = new URL('/print', process.env.PRINT_SERVICE_URL);
      printServiceUrl.searchParams.set('url', signedUrl);
      
      console.log('Generated print service URL:', printServiceUrl.toString());
      res.json({ printServiceUrl: printServiceUrl.toString() });

      // Schedule cleanup of temporary file and S3 object
      setTimeout(async () => {
        try {
          // Delete temporary file
          if (tempFilePath) {
            await fs.unlink(tempFilePath);
          }
          // Delete temporary S3 object
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: tempKey
          }));
        } catch (error) {
          console.error('Error cleaning up temporary files:', error);
        }
      }, 300000); // 5 minutes
    } catch (error) {
      console.error('Print verification error:', error);
      next(error);
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