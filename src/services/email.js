const nodemailer = require('nodemailer');

// Create a transporter using Gmail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Function to send OTP via email
const sendOTPEmail = async (email, otp) => {
    try {
        const mailOptions = {
            from: `"Secure Print Service" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your Document Printing OTP',
            text: `Your OTP for document printing is: ${otp}. This OTP will expire in 5 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Document Printing OTP</h2>
                    <p>Your OTP for document printing is:</p>
                    <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
                    <p>This OTP will expire in 5 minutes.</p>
                    <p>If you didn't request this OTP, please ignore this email.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`OTP sent successfully to ${email}`);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        throw new Error('Failed to send OTP email');
    }
};

module.exports = {
    sendOTPEmail
}; 