import nodemailer from 'nodemailer';
import { config } from 'dotenv';

config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const mailOptions = {
  from: process.env.GMAIL_USER,
  to: 'testrecipient@example.com', // استبدل بعنوان بريدك للاختبار
  subject: 'اختبار إرسال بريد إلكتروني',
  text: 'هذا بريد اختباري من nodemailer!',
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('خطأ في إرسال البريد:', error);
  } else {
    console.log('تم إرسال البريد بنجاح:', info.response);
  }
});