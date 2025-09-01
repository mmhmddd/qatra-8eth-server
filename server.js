import express, { json } from 'express';
import mongoose from 'mongoose';
import { config } from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fsPromises from 'fs/promises';
import { fileURLToPath } from 'url';
import cloudinary from 'cloudinary';
import cron from 'node-cron';
import handlebars from 'handlebars';
import User from './models/User.js';
import sendEmail from './utils/email.js';

import leaderboardRoutes from './routes/leaderboard.js';
import apiRoutes from './routes/api.js';
import pdfRoutes from './routes/pdfRoutes.js';
import testimonialsRoutes from './routes/testimonials.js';
import lectureRoutes from './routes/lectureRoutes.js';
import galleryRoutes from './routes/gallery.js';
import lectureRequestRoutes from './routes/lectureRequestRoutes.js';
import forgetPasswordRoutes from './routes/forgotPassword.js';
import messageRoutes from './routes/messageRoutes.js';

process.env.TZ = 'Africa/Cairo';

config();

if (!process.env.MONGODB_URI) {
  console.error('❌ Error: MONGODB_URI is not defined in .env file');
  process.exit(1);
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Error: Cloudinary credentials are missing in .env file');
  process.exit(1);
}

if (!process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.SMTP_HOST || !process.env.SMTP_PORT) {
  console.error('Error: SMTP credentials are missing in .env file');
  process.exit(1);
}

if (!process.env.PORT) {
  console.warn('⚠️ Warning: PORT is not defined in .env file, defaulting to 5000');
}

if (!process.env.FRONTEND_URL) {
  console.warn('⚠️ Warning: FRONTEND_URL is not defined in .env file, defaulting to https://www.qatrah-ghaith.com');
}

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

User.schema.pre('deleteOne', { document: false, query: true }, function() {
  console.log('Attempted deleteOne on User:', this.getQuery());
});

User.schema.pre('deleteMany', { document: false, query: true }, function() {
  console.log('Attempted deleteMany on User:', this.getQuery());
});

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    try {
      const indexes = await User.collection.indexInformation();
      for (const [name, index] of Object.entries(indexes)) {
        if ('expireAfterSeconds' in index) {
          await User.collection.dropIndex(name);
          console.log(`Dropped TTL index: ${name}`);
        }
      }
    } catch (err) {
      console.error('Error checking/dropping TTL indexes:', err);
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// قراءة قالب البريد الإلكتروني لتذكير الاجتماعات
async function getEmailTemplate(data) {
  try {
    const templatePath = path.join(__dirname, 'meeting-reminder.html');
    console.log('مسار قالب تذكير الاجتماعات:', templatePath);
    const source = await fsPromises.readFile(templatePath, 'utf8');
    console.log('تم قراءة قالب تذكير الاجتماعات بنجاح:', source.slice(0, 100));
    const template = handlebars.compile(source);
    const htmlContent = template(data);
    console.log('تم إنشاء محتوى HTML لتذكير الاجتماعات:', htmlContent.slice(0, 100));
    return htmlContent;
  } catch (error) {
    console.error('خطأ في قراءة أو تجميع قالب تذكير الاجتماعات:', error.message, error.stack);
    throw error;
  }
}

app.use(cors({
  origin: process.env.FRONTEND_URL || 'https://www.qatrah-ghaith.com',
  credentials: true
}));
app.use(json());

app.get('/api/Uploads/*', (req, res) => {
  console.log(`Old upload route requested: ${req.originalUrl}`);
  res.status(410).json({ message: 'هذا المسار القديم لم يعد مدعومًا. استخدم /api/gallery/images للصور.' });
});

console.log('Registering Leaderboard routes at /api/leaderboard');
app.use('/api/leaderboard', leaderboardRoutes);

console.log('Registering API routes at /api');
app.use('/api', apiRoutes);

console.log('Registering PDF routes at /api/pdf');
app.use('/api/pdf', pdfRoutes);

console.log('Registering Testimonials routes at /api/testimonials');
app.use('/api/testimonials', testimonialsRoutes);

console.log('Registering Lecture routes at /api/lectures');
app.use('/api/lectures', lectureRoutes);

console.log('Registering Gallery routes at /api/gallery');
app.use('/api/gallery', galleryRoutes);

console.log('Registering Lecture Request routes at /api/lecture-requests');
app.use('/api/lecture-requests', lectureRequestRoutes);

console.log('Registering Forget Password routes at /api/forgot-password');
app.use('/api/forgot-password', forgetPasswordRoutes);

console.log('Registering Forget Password routes at /api/reset-password');
app.use('/api/reset-password', forgetPasswordRoutes);

console.log('Registering Message routes at /api/messages');
app.use('/api/messages', messageRoutes);

cron.schedule('1 0 * * *', async () => {
  console.log('⏰ Checking daily meeting reminders at:', new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }));
  try {
    const now = new Date();
    const nowUTC = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const startOfDayUTC = new Date(nowUTC);
    startOfDayUTC.setUTCHours(0, 0, 0, 0);
    const endOfDayUTC = new Date(nowUTC);
    endOfDayUTC.setUTCHours(23, 59, 59, 999);

    console.log(`Querying meetings for today UTC: ${startOfDayUTC.toISOString()} to ${endOfDayUTC.toISOString()}`);

    const users = await User.find({
      'meetings.reminded': false,
      'meetings.date': { $gte: startOfDayUTC, $lte: endOfDayUTC }
    }).lean();

    console.log(`Found ${users.length} users with potential meetings to remind today`);

    const emailPromises = [];
    for (const user of users) {
      console.log(`Processing user: ${user.email}, Meetings count: ${user.meetings.length}`);
      
      const meetingsToRemind = user.meetings.filter(meeting => {
        if (meeting.reminded) {
          console.log(`Meeting ${meeting._id} already reminded, skipping`);
          return false;
        }
        const meetingDate = new Date(meeting.date);
        return meetingDate >= startOfDayUTC && meetingDate <= endOfDayUTC;
      });

      if (meetingsToRemind.length === 0) {
        console.log(`No meetings to remind for user ${user.email}`);
        continue;
      }

      const meetingList = meetingsToRemind.map(meeting => `
        <li>
          <strong>العنوان:</strong> ${meeting.title}<br>
          <strong>التاريخ:</strong> ${meeting.date.toISOString().split('T')[0]}<br>
          <strong>الوقت:</strong> ${meeting.startTime}<br>
          <strong>المدة:</strong> ${meeting.startTime} - ${meeting.endTime}
        </li>
      `).join('');

      console.log(`Sending daily reminder to ${user.email} for ${meetingsToRemind.length} meetings`);
      const htmlContent = await getEmailTemplate({
        name: user.name || 'المستخدم',
        meetingsCount: meetingsToRemind.length,
        plural: meetingsToRemind.length > 1,
        meetingList
      });

      emailPromises.push(
        sendEmail({
          to: user.email,
          subject: 'تذكير بمواعيد اليوم',
          html: htmlContent
        }).then(() => {
          console.log(`✅ Successfully sent daily reminder to ${user.email} for ${meetingsToRemind.length} meetings`);
          const updatePromises = meetingsToRemind.map(meeting =>
            User.updateOne(
              { _id: user._id, 'meetings._id': meeting._id },
              { $set: { 'meetings.$.reminded': true } }
            )
          );
          return Promise.all(updatePromises);
        }).catch((error) => {
          console.error(`Failed to send daily reminder to ${user.email}:`, error.message);
          throw error;
        })
      );
    }

    await Promise.all(emailPromises);
    console.log(`Processed ${emailPromises.length} daily meeting reminders`);
  } catch (error) {
    console.error('Error in daily meeting reminder cron job:', error.message, error.stack);
  }
});

app.use((req, res) => {
  console.log(`Unmatched route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));