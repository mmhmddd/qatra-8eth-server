// test-smtp.js - Test your SMTP configuration before deploying
// Run with: node test-smtp.js

import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

async function testSMTP() {
  console.log('═══════════════════════════════════════');
  console.log('🧪 SMTP Configuration Test');
  console.log('═══════════════════════════════════════\n');

  // Check environment variables
  console.log('📋 Checking environment variables...');
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing environment variables:', missingVars.join(', '));
    console.log('\n💡 Make sure your .env file contains:');
    console.log('   SMTP_HOST=smtp.gmail.com');
    console.log('   SMTP_PORT=587');
    console.log('   SMTP_SECURE=false');
    console.log('   SMTP_USER=your-email@gmail.com');
    console.log('   SMTP_PASS=your-app-password');
    process.exit(1);
  }

  console.log('✅ All required environment variables found\n');

  // Display configuration
  console.log('⚙️  SMTP Configuration:');
  console.log(`   Host: ${process.env.SMTP_HOST}`);
  console.log(`   Port: ${process.env.SMTP_PORT}`);
  console.log(`   Secure: ${process.env.SMTP_SECURE === 'true' ? 'Yes (465)' : 'No (587)'}`);
  console.log(`   User: ${process.env.SMTP_USER}`);
  console.log(`   Pass: ${'*'.repeat(process.env.SMTP_PASS?.length || 0)}\n`);

  try {
    // Create transporter
    console.log('🔧 Creating SMTP transporter...');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 30000,
      debug: true,
      logger: true,
    });

    console.log('✅ Transporter created\n');

    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified successfully!\n');

    // Send test email
    console.log('📧 Sending test email...');
    const testEmail = process.env.SMTP_USER; // Send to yourself
    
    const info = await transporter.sendMail({
      from: {
        name: 'قطرة غيث - اختبار',
        address: process.env.SMTP_USER
      },
      to: testEmail,
      subject: 'اختبار SMTP - قطرة غيث',
      text: 'هذا بريد اختبار للتحقق من إعدادات SMTP.',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; direction: rtl;">
          <h2 style="color: #007bff;">✅ نجح الاختبار!</h2>
          <p>إذا تلقيت هذا البريد، فإن إعدادات SMTP الخاصة بك تعمل بشكل صحيح.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="color: #666; font-size: 14px;">
            <strong>المعلومات التقنية:</strong><br>
            الوقت: ${new Date().toISOString()}<br>
            الخادم: ${process.env.SMTP_HOST}<br>
            المنفذ: ${process.env.SMTP_PORT}
          </p>
        </div>
      `
    });

    console.log('✅ Test email sent successfully!\n');
    console.log('📨 Email Details:');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);
    console.log(`   Accepted: ${info.accepted.join(', ')}`);
    if (info.rejected.length > 0) {
      console.log(`   Rejected: ${info.rejected.join(', ')}`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ SMTP TEST PASSED');
    console.log('═══════════════════════════════════════');
    console.log('\n✅ Your SMTP configuration is working correctly!');
    console.log(`📬 Check your inbox at: ${testEmail}\n`);

    transporter.close();
    process.exit(0);

  } catch (error) {
    console.error('\n═══════════════════════════════════════');
    console.error('❌ SMTP TEST FAILED');
    console.error('═══════════════════════════════════════\n');
    console.error('Error Details:');
    console.error(`   Type: ${error.name}`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Code: ${error.code || 'N/A'}`);
    console.error(`   Response: ${error.response || 'N/A'}\n`);

    // Common error solutions
    console.log('💡 Common Solutions:\n');
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      console.log('❌ Authentication Failed:');
      console.log('   1. For Gmail: Use App Password, not regular password');
      console.log('   2. Generate App Password: https://myaccount.google.com/apppasswords');
      console.log('   3. Enable 2-Step Verification first');
      console.log('   4. Copy the 16-character password without spaces\n');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      console.log('❌ Connection Failed:');
      console.log('   1. Check your internet connection');
      console.log('   2. Verify SMTP_HOST and SMTP_PORT are correct');
      console.log('   3. Check firewall settings');
      console.log('   4. Try using port 465 with SMTP_SECURE=true\n');
    } else if (error.code === 'ESOCKET') {
      console.log('❌ Socket Error:');
      console.log('   1. Your IP might be blocked temporarily');
      console.log('   2. Try a different network');
      console.log('   3. Wait a few minutes and try again\n');
    } else {
      console.log('❌ Unknown Error:');
      console.log('   1. Double-check all environment variables');
      console.log('   2. Ensure SMTP service is enabled');
      console.log('   3. Try using a different SMTP provider (SendGrid, AWS SES)\n');
    }

    console.log('📚 For Gmail App Password setup:');
    console.log('   https://support.google.com/accounts/answer/185833\n');

    process.exit(1);
  }
}

// Run test
testSMTP();