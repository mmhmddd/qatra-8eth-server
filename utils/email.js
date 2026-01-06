// utils/email.js - محسّن لـ Zoho Mail على Render.com

import nodemailer from 'nodemailer';

const sendEmail = async ({ to, subject, text, html }) => {
  const startTime = Date.now();
  
  console.log('\n═══════════════════════════════════════');
  console.log('📧 بدء إرسال البريد الإلكتروني');
  console.log('الوقت:', new Date().toISOString());
  console.log('إلى:', to);
  console.log('الموضوع:', subject);
  console.log('═══════════════════════════════════════');

  try {
    // التحقق من المدخلات
    if (!to || !subject || (!text && !html)) {
      throw new Error('معلومات البريد الإلكتروني غير مكتملة');
    }

    // التحقق من بيانات SMTP
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ بيانات SMTP غير موجودة');
      throw new Error('إعدادات البريد الإلكتروني غير مكتملة');
    }

    console.log('📋 إعدادات SMTP:');
    console.log('  الخادم:', process.env.SMTP_HOST);
    console.log('  المنفذ:', process.env.SMTP_PORT);
    console.log('  المستخدم:', process.env.SMTP_USER);
    console.log('  البيئة:', process.env.NODE_ENV || 'development');

    // إعدادات Zoho محسّنة لـ Render.com
    const transportConfig = {
      host: process.env.SMTP_HOST || 'smtp.zoho.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false, // false للمنفذ 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      // إعدادات حاسمة لـ Zoho على Render
      requireTLS: true,
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: true, // تغيير إلى true للأمان
        minVersion: 'TLSv1.2'
      },
      // Timeouts محسّنة لـ Render
      connectionTimeout: 60000,
      greetingTimeout: 30000, 
      socketTimeout: 60000,
      // Pool settings
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Debugging
      debug: process.env.NODE_ENV !== 'production',
      logger: process.env.NODE_ENV !== 'production'
    };

    console.log('🔧 إنشاء الاتصال مع Zoho...');
    const transporter = nodemailer.createTransport(transportConfig);
    console.log('✅ تم إنشاء الاتصال');

    // التحقق من الاتصال (مع timeout)
    console.log('🔍 التحقق من الاتصال بخادم Zoho...');
    const verifyStartTime = Date.now();
    
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 30000)
      )
    ]);
    
    const verifyDuration = Date.now() - verifyStartTime;
    console.log(`✅ تم التحقق من الاتصال في ${verifyDuration}ms`);

    // إعداد البريد مع معلومات إضافية
    const mailOptions = {
      from: {
        name: 'قطرة غيث',
        address: process.env.SMTP_USER
      },
      to: to,
      subject: subject,
      text: text || 'هذا البريد يتطلب عميل بريد يدعم HTML',
      html: html,
      // Headers إضافية لتحسين التسليم
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Qatrah Ghaith System',
        'Importance': 'normal'
      },
      // Envelope لضمان صحة المرسل
      envelope: {
        from: process.env.SMTP_USER,
        to: to
      }
    };

    console.log('📝 تم إعداد البريد');
    console.log('  من:', mailOptions.from.address);
    console.log('  إلى:', mailOptions.to);

    // إرسال البريد مع timeout
    console.log('📤 جاري الإرسال...');
    const sendStartTime = Date.now();
    
    const info = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('SEND_TIMEOUT')), 45000)
      )
    ]);
    
    const sendDuration = Date.now() - sendStartTime;
    const totalDuration = Date.now() - startTime;

    // التحقق من نجاح الإرسال
    if (!info.messageId) {
      throw new Error('لم يتم استلام messageId من الخادم');
    }

    if (info.rejected && info.rejected.length > 0) {
      console.warn('⚠️  تم رفض البريد لـ:', info.rejected);
      throw new Error(`تم رفض البريد: ${info.rejected.join(', ')}`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ تم إرسال البريد بنجاح');
    console.log('مدة الإرسال:', sendDuration + 'ms');
    console.log('المدة الإجمالية:', totalDuration + 'ms');
    console.log('معرف الرسالة:', info.messageId);
    console.log('الاستجابة:', info.response);
    console.log('تم القبول:', info.accepted);
    console.log('═══════════════════════════════════════\n');

    // إغلاق الاتصال
    transporter.close();

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted
    };

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    console.error('\n═══════════════════════════════════════');
    console.error('❌ فشل إرسال البريد');
    console.error('المدة الإجمالية:', totalDuration + 'ms');
    console.error('اسم الخطأ:', error.name);
    console.error('رسالة الخطأ:', error.message);
    console.error('كود الخطأ:', error.code);
    console.error('رمز الاستجابة:', error.responseCode);
    console.error('استجابة الخادم:', error.response);
    console.error('═══════════════════════════════════════\n');

    // تفسير الأخطاء الشائعة
    let userMessage = 'فشل في إرسال البريد الإلكتروني';
    
    if (error.code === 'EAUTH' || error.responseCode === 535) {
      userMessage = 'خطأ في المصادقة: تحقق من اسم المستخدم وكلمة المرور';
    } else if (error.code === 'ETIMEDOUT' || error.message === 'VERIFY_TIMEOUT' || error.message === 'SEND_TIMEOUT') {
      userMessage = 'انتهت مهلة الاتصال بخادم البريد';
    } else if (error.code === 'ECONNREFUSED') {
      userMessage = 'تم رفض الاتصال: تحقق من إعدادات الخادم والمنفذ';
    } else if (error.code === 'ESOCKET') {
      userMessage = 'خطأ في الاتصال بالشبكة';
    } else if (error.responseCode === 550) {
      userMessage = 'عنوان البريد الإلكتروني غير صالح أو محظور';
    }

    throw new Error(userMessage + ': ' + error.message);
  }
};

export default sendEmail;