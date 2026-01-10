// utils/email.js - Gmail Port 465 (SSL) للتغلب على حظر Render

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

    // التحقق من بيانات Gmail
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      console.error('❌ بيانات Gmail غير موجودة');
      throw new Error('إعدادات البريد الإلكتروني غير مكتملة');
    }

    console.log('📋 إعدادات Gmail:');
    console.log('  المستخدم:', process.env.GMAIL_USER);
    console.log('  المنفذ: 465 (SSL)');
    console.log('  البيئة:', process.env.NODE_ENV || 'development');

    // إعدادات Gmail مع Port 465 (SSL مباشر)
    const transportConfig = {
      host: 'smtp.gmail.com',
      port: 465, // ✅ تغيير من 587 إلى 465
      secure: true, // ✅ تغيير من false إلى true (استخدام SSL مباشرة)
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      },
      // إعدادات SSL
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2'
      },
      // Timeouts
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

    console.log('🔧 إنشاء الاتصال مع Gmail (Port 465)...');
    const transporter = nodemailer.createTransport(transportConfig);
    console.log('✅ تم إنشاء الاتصال');

    // التحقق من الاتصال مع timeout أقصر
    console.log('🔍 التحقق من الاتصال بخادم Gmail...');
    const verifyStartTime = Date.now();
    
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), 20000) // 20 ثانية بدلاً من 30
      )
    ]);
    
    const verifyDuration = Date.now() - verifyStartTime;
    console.log(`✅ تم التحقق من الاتصال في ${verifyDuration}ms`);

    // إعداد البريد
    const mailOptions = {
      from: {
        name: 'قطرة غيث',
        address: process.env.GMAIL_USER
      },
      to: to,
      subject: subject,
      text: text || 'هذا البريد يتطلب عميل بريد يدعم HTML',
      html: html,
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Qatrah Ghaith System',
        'Importance': 'normal'
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
        setTimeout(() => reject(new Error('SEND_TIMEOUT')), 30000) // 30 ثانية
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
      userMessage = 'خطأ في المصادقة: تحقق من بريد Gmail وكلمة المرور';
    } else if (error.message?.includes('Invalid login')) {
      userMessage = 'بيانات تسجيل الدخول غير صحيحة: تأكد من استخدام App Password';
    } else if (error.code === 'ETIMEDOUT' || error.message === 'VERIFY_TIMEOUT' || error.message === 'SEND_TIMEOUT') {
      userMessage = 'انتهت مهلة الاتصال - قد يكون Port 465 محظور على Render';
    } else if (error.code === 'ECONNREFUSED') {
      userMessage = 'تم رفض الاتصال: المنفذ محظور على Render';
    } else if (error.code === 'ESOCKET') {
      userMessage = 'خطأ في الاتصال بالشبكة';
    } else if (error.responseCode === 550) {
      userMessage = 'عنوان البريد الإلكتروني غير صالح أو محظور';
    }

    throw new Error(userMessage + ': ' + error.message);
  }
};

export default sendEmail;