// utils/email.js - PRODUCTION-READY VERSION WITH COMPREHENSIVE LOGGING

import nodemailer from 'nodemailer';

const sendEmail = async ({ to, subject, text, html }) => {
  const startTime = Date.now();
  
  console.log('\n═══════════════════════════════════════');
  console.log('📧 EMAIL SEND ATTEMPT STARTED');
  console.log('Time:', new Date().toISOString());
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('Has HTML:', !!html);
  console.log('Has Text:', !!text);
  console.log('═══════════════════════════════════════');

  try {
    // Step 1: Validate inputs
    if (!to || !subject || (!text && !html)) {
      throw new Error('Missing required email parameters');
    }

    // Step 2: Validate environment variables
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Missing SMTP credentials in environment');
      throw new Error('SMTP credentials not configured');
    }

    console.log('📋 SMTP Configuration:');
    console.log('  Host:', process.env.SMTP_HOST || 'smtp.gmail.com');
    console.log('  Port:', process.env.SMTP_PORT || 587);
    console.log('  User:', process.env.SMTP_USER);
    console.log('  Pass:', '***' + process.env.SMTP_PASS.slice(-4));
    console.log('  Secure:', (process.env.SMTP_PORT || '587') === '465');

    // Step 3: Create transporter with detailed config
    const transportConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: (process.env.SMTP_PORT || '587') === '465', // true for 465, false for 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // Critical timeouts
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 20000,   // 20 seconds
      socketTimeout: 45000,      // 45 seconds
      // Enable detailed logging
      debug: true,
      logger: true,
      // TLS configuration
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      },
      // Disable connection pooling for reliability
      pool: false,
      maxConnections: 1,
      maxMessages: 1
    };

    console.log('🔧 Creating transporter...');
    const transporter = nodemailer.createTransport(transportConfig);
    console.log('✅ Transporter created');

    // Step 4: Verify SMTP connection (CRITICAL)
    console.log('🔍 Verifying SMTP connection...');
    const verifyStartTime = Date.now();
    
    try {
      const verifyResult = await Promise.race([
        transporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('SMTP verification timeout (20s)')), 20000)
        )
      ]);
      
      const verifyDuration = Date.now() - verifyStartTime;
      console.log(`✅ SMTP verified in ${verifyDuration}ms:`, verifyResult);
      
    } catch (verifyError) {
      const verifyDuration = Date.now() - verifyStartTime;
      console.error(`❌ SMTP verification FAILED after ${verifyDuration}ms`);
      console.error('Verify error name:', verifyError.name);
      console.error('Verify error message:', verifyError.message);
      console.error('Verify error code:', verifyError.code);
      console.error('Verify error command:', verifyError.command);
      console.error('Verify error response:', verifyError.response);
      console.error('Verify error responseCode:', verifyError.responseCode);
      
      // Provide specific error messages
      if (verifyError.code === 'EAUTH') {
        throw new Error('Gmail authentication failed - check App Password');
      } else if (verifyError.code === 'ETIMEDOUT' || verifyError.message.includes('timeout')) {
        throw new Error('Gmail connection timeout - may be blocked by firewall');
      } else if (verifyError.code === 'ECONNECTION' || verifyError.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Gmail SMTP server');
      } else if (verifyError.code === 'ESOCKET') {
        throw new Error('Socket connection error - network issue');
      } else {
        throw new Error(`SMTP verification failed: ${verifyError.message}`);
      }
    }

    // Step 5: Prepare mail options
    const mailOptions = {
      from: `"قطرة غيث" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      text: text,
      html: html,
      // Add headers for better deliverability
      headers: {
        'X-Mailer': 'Qatrah Ghaith System',
        'X-Priority': '3',
        'Importance': 'normal'
      }
    };

    console.log('📝 Mail options prepared:');
    console.log('  From:', mailOptions.from);
    console.log('  To:', mailOptions.to);
    console.log('  Subject:', mailOptions.subject);
    console.log('  HTML length:', html?.length || 0);
    console.log('  Text length:', text?.length || 0);

    // Step 6: Send email with timeout protection
    console.log('📤 Sending email via SMTP...');
    const sendStartTime = Date.now();
    
    const info = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email send timeout (30s)')), 30000)
      )
    ]);

    const sendDuration = Date.now() - sendStartTime;
    const totalDuration = Date.now() - startTime;

    console.log('\n═══════════════════════════════════════');
    console.log('✅ EMAIL SENT SUCCESSFULLY');
    console.log('Send duration:', sendDuration + 'ms');
    console.log('Total duration:', totalDuration + 'ms');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
    console.log('═══════════════════════════════════════\n');

    // Check if email was rejected
    if (info.rejected && info.rejected.length > 0) {
      console.warn('⚠️  Email was rejected for:', info.rejected);
      throw new Error(`Email rejected by server for: ${info.rejected.join(', ')}`);
    }

    return info;

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    console.error('\n═══════════════════════════════════════');
    console.error('❌ EMAIL SEND FAILED');
    console.error('Total duration:', totalDuration + 'ms');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error command:', error.command);
    console.error('Error response:', error.response);
    console.error('Error responseCode:', error.responseCode);
    console.error('Error syscall:', error.syscall);
    console.error('Error errno:', error.errno);
    console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error('Stack trace:', error.stack);
    console.error('═══════════════════════════════════════\n');

    // Re-throw with more context
    const enhancedError = new Error(`Email failed: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.code = error.code;
    enhancedError.to = to;
    enhancedError.duration = totalDuration;
    
    throw enhancedError;
  }
};

export default sendEmail;