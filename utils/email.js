// utils/email.js - باستخدام SendGrid (أكثر موثوقية من Gmail)

import nodemailer from 'nodemailer';

const sendEmail = async ({ to, subject, text, html }) => {
  const startTime = Date.now();
  
  console.log('\n═══════════════════════════════════════');
  console.log('📧 بدء إرسال البريد الإلكتروني');
  console.log('الوقت:', new Date().toISOString());
  console.log('إلى:', to);
  console.log('الموضوع:', subject);
  console.log('البيئة:', process.env.NODE_ENV);
  console.log('═══════════════════════════════════════');

  try {
    // التحقق من المدخلات
    if (!to || !subject || (!text && !html)) {
      throw new Error('معلومات البريد الإلكتروني غير مكتملة');
    }

    // خيار 1: استخدام Gmail
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      console.log('📋 استخدام Gmail SMTP');
      return await sendViaGmail({ to, subject, text, html, startTime });
    } 
    // خيار 2: استخدام SendGrid (بديل موصى به)
    else if (process.env.SENDGRID_API_KEY) {
      console.log('📋 استخدام SendGrid API');
      return await sendViaSendGrid({ to, subject, text, html, startTime });
    }
    else {
      throw new Error('لم يتم تكوين أي خدمة بريد إلكتروني');
    }

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    console.error('\n═══════════════════════════════════════');
    console.error('❌ فشل إرسال البريد');
    console.error('المدة الإجمالية:', totalDuration + 'ms');
    console.error('الخطأ:', error.message);
    console.error('═══════════════════════════════════════\n');

    throw new Error('فشل في إرسال البريد الإلكتروني: ' + error.message);
  }
};

// دالة إرسال عبر Gmail
async function sendViaGmail({ to, subject, text, html, startTime }) {
  console.log('Gmail User:', process.env.GMAIL_USER);
  console.log('Gmail Password Length:', process.env.GMAIL_APP_PASSWORD?.length);

  const transportConfig = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    },
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    },
    connectionTimeout: 60000,
    greetingTimeout: 30000,
    socketTimeout: 60000,
    pool: true,
    maxConnections: 5,
    debug: true, // تفعيل debug للحصول على معلومات أكثر
    logger: true
  };

  console.log('🔧 إنشاء الاتصال مع Gmail...');
  const transporter = nodemailer.createTransport(transportConfig);

  // التحقق من الاتصال
  console.log('🔍 التحقق من الاتصال...');
  await transporter.verify();
  console.log('✅ تم التحقق من الاتصال');

  const mailOptions = {
    from: {
      name: 'قطرة غيث',
      address: process.env.GMAIL_USER
    },
    to: to,
    subject: subject,
    text: text || 'هذا البريد يتطلب عميل بريد يدعم HTML',
    html: html
  };

  console.log('📤 جاري الإرسال...');
  const info = await transporter.sendMail(mailOptions);
  
  const totalDuration = Date.now() - startTime;
  console.log('\n✅ تم إرسال البريد بنجاح');
  console.log('المدة الإجمالية:', totalDuration + 'ms');
  console.log('معرف الرسالة:', info.messageId);
  
  transporter.close();

  return {
    success: true,
    messageId: info.messageId,
    provider: 'gmail'
  };
}

// دالة إرسال عبر SendGrid (بديل موصى به)
async function sendViaSendGrid({ to, subject, text, html, startTime }) {
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const msg = {
    to: to,
    from: process.env.SENDGRID_FROM_EMAIL || 'noreply@qatrah-ghaith.com',
    subject: subject,
    text: text,
    html: html,
  };

  console.log('📤 جاري الإرسال عبر SendGrid...');
  const response = await sgMail.send(msg);
  
  const totalDuration = Date.now() - startTime;
  console.log('\n✅ تم إرسال البريد بنجاح');
  console.log('المدة الإجمالية:', totalDuration + 'ms');

  return {
    success: true,
    messageId: response[0].headers['x-message-id'],
    provider: 'sendgrid'
  };
}

export default sendEmail;