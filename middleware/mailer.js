const ejs = require('ejs');
const path = require('path');
const nodemailer = require('nodemailer');

// Render an EJS template to HTML string
const mailSender = async (templateName, data) => {
    try {
        const templatePath = path.join(__dirname, '/views', templateName);
        const html = await ejs.renderFile(templatePath, data);
        return html;
    } catch (error) {
        console.error('Error rendering template:', error);
        throw error;const ejs = require('ejs');
const path = require('path');
const nodemailer = require('nodemailer');

// Render an EJS template to HTML string
const mailSender = async (templateName, data) => {
  try {
    const templatePath = path.join(__dirname, '/views', templateName);
    const html = await ejs.renderFile(templatePath, data);
    return html;
  } catch (error) {
    console.error('Error rendering template:', error);
    throw error;
  }
};

// Transporter with timeout settings for Vercel
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NODE_MAIL,
    pass: process.env.NODE_PASS
  },
  connectionTimeout: 10000,  // 10 seconds to connect
  greetingTimeout:   10000,  // 10 seconds to wait for greeting
  socketTimeout:     15000,  // 15 seconds for socket
});

// Send an email — never throws, just logs on failure
const sendMail = async (to, subject, html) => {
  try {
    const mailOptions = {
      from: `"Swift Route" <${process.env.NODE_MAIL}>`,
      to,
      subject,
      html
    };
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return result;
  } catch (error) {
    console.error(`❌ Email failed to ${to}:`, error.message);
    // Never throw — email failure should not crash the request
  }
};

module.exports = { mailSender, sendMail };
    }
};

// Create a reusable nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.NODE_MAIL,
        pass: process.env.NODE_PASS
    }
});

// Send an email
const sendMail = async (to, subject, html) => {
    const mailOptions = {
        from: `"Swift Route" <${process.env.NODE_MAIL}>`,
        to,
        subject,
        html
    };
    return transporter.sendMail(mailOptions);
};

module.exports = { mailSender, sendMail };