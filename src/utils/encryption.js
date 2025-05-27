const crypto = require('crypto');

// Generate a random encryption key
const generateKey = () => {
  return crypto.randomBytes(32); // 256 bits
};

// Encrypt data using AES-256-GCM
const encrypt = (data, key) => {
  try {
    if (!Buffer.isBuffer(data)) {
      throw new Error('Data must be a Buffer');
    }
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error('Key must be a 32-byte Buffer');
    }

    const iv = crypto.randomBytes(12); // 96 bits for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV, encrypted data, and auth tag
    return Buffer.concat([iv, encrypted, authTag]);
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
};

// Decrypt data using AES-256-GCM
const decrypt = (encryptedData, key) => {
  try {
    if (!Buffer.isBuffer(encryptedData)) {
      throw new Error('Encrypted data must be a Buffer');
    }
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error('Key must be a 32-byte Buffer');
    }

    // Extract IV, encrypted data, and auth tag
    const iv = encryptedData.slice(0, 12);
    const authTag = encryptedData.slice(-16);
    const encrypted = encryptedData.slice(12, -16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted;
  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

module.exports = {
  generateKey,
  encrypt,
  decrypt
}; 