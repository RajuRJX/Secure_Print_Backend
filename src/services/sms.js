const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendOTP = async (phoneNumber, otp) => {
  try {
    await client.messages.create({
      body: `Your OTP for document printing is: ${otp}. This OTP will expire in 30 minutes.`,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER
    });
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw new Error('Failed to send OTP SMS');
  }
};

module.exports = {
  sendOTP
}; 