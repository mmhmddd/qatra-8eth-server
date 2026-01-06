// test-email.js
import sendEmail from './utils/email.js';

sendEmail({
  to: 'mohamed.m.mahmoud29@gmail.com',
  subject: 'اختبار Zoho',
  text: 'هذا اختبار من Zoho Mail',
  html: '<h1>اختبار Zoho Mail</h1>'
}).then(() => {
  console.log('✅ تم الإرسال');
}).catch(err => {
  console.error('❌ خطأ:', err.message);
});