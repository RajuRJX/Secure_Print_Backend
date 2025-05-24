const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendOTP = async (email, otp) => {
  const msg = {
    to: email,
    from: process.env.SENDER_EMAIL,
    subject: 'Your Document Printing OTP',
    text: `Your OTP for document printing is: ${otp}. This OTP will expire in 30 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Document Printing OTP</h2>
        <p>Your OTP for document printing is:</p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This OTP will expire in 30 minutes.</p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
          If you didn't request this OTP, please ignore this email.
        </p>
      </div>
    `
  };

  try {
    await sgMail.send(msg);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send OTP email');
  }
};

module.exports = {
  sendOTP
}; 