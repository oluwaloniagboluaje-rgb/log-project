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
        throw error;
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