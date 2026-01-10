// utils/email.js - Resend (الحل النهائي لـ Render.com)

import { Resend } from 'resend';

const sendEmail = async ({ to, subject, text, html }) => {
  const startTime = Date.now();
  
  console.log('\n═══════════════════════════════════════');
  console.log('📧 بدء إرسال البريد الإلكتروني');
  console.log('الوقت:', new Date().toISOString());
  console.log('إلى:', to);
  console.log('الموضوع:', subject);
  console.log('البيئة:', process.env.NODE_ENV || 'development');
  console.log('═══════════════════════════════════════');

  try {
    // التحقق من المدخلات
    if (!to || !subject || (!text && !html)) {
      throw new Error('معلومات البريد الإلكتروني غير مكتملة');
    }

    // التحقق من إعدادات Resend
    if (!process.env.RESEND_API_KEY) {
      console.error('❌ RESEND_API_KEY غير موجود');
      throw new Error('إعدادات البريد الإلكتروني غير مكتملة');
    }

    console.log('✅ Resend API Key موجود');
    console.log('📋 From Email:', process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev');

    // إنشاء Resend client
    const resend = new Resend(process.env.RESEND_API_KEY);

    // إعداد البريد
    const emailData = {
      from: process.env.RESEND_FROM_EMAIL || 'Qatrah Ghaith <onboarding@resend.dev>',
      to: to,
      subject: subject,
      html: html || text,
      text: text
    };

    console.log('📤 جاري الإرسال عبر Resend...');
    const sendStartTime = Date.now();
    
    const { data, error } = await resend.emails.send(emailData);
    
    if (error) {
      throw new Error(`Resend Error: ${error.message}`);
    }

    const sendDuration = Date.now() - sendStartTime;
    const totalDuration = Date.now() - startTime;

    console.log('\n═══════════════════════════════════════');
    console.log('✅ تم إرسال البريد بنجاح عبر Resend');
    console.log('مدة الإرسال:', sendDuration + 'ms');
    console.log('المدة الإجمالية:', totalDuration + 'ms');
    console.log('Message ID:', data.id);
    console.log('═══════════════════════════════════════\n');

    return {
      success: true,
      messageId: data.id,
      provider: 'resend'
    };

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    
    console.error('\n═══════════════════════════════════════');
    console.error('❌ فشل إرسال البريد');
    console.error('المدة الإجمالية:', totalDuration + 'ms');
    console.error('اسم الخطأ:', error.name);
    console.error('رسالة الخطأ:', error.message);
    console.error('═══════════════════════════════════════\n');

    // تفسير الأخطاء الشائعة
    let userMessage = 'فشل في إرسال البريد الإلكتروني';
    
    if (error.message?.includes('API key')) {
      userMessage = 'خطأ في API Key: تحقق من إعدادات Resend';
    } else if (error.message?.includes('rate limit')) {
      userMessage = 'تم تجاوز الحد اليومي للرسائل (100 رسالة/يوم)';
    } else if (error.message?.includes('invalid')) {
      userMessage = 'بيانات البريد غير صالحة';
    }

    throw new Error(userMessage + ': ' + error.message);
  }
};

export default sendEmail;