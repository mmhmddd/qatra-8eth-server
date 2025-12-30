import express, { json } from 'express';
import mongoose from 'mongoose';
import { config } from 'dotenv';
import cors from 'cors';
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

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════
//          UNIFIED CORS CONFIGURATION
// ════════════════════════════════════════════════
const allowedOrigins = [
  'http://localhost:4200',
  'http://127.0.0.1:4200',
  'http://localhost:3000',
  'https://www.qatrah-ghaith.com',
  'https://qatrah-ghaith.com'
];

// SINGLE CORS configuration - place BEFORE all routes
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400 // 24 hours
}));

// Handle preflight for all routes
app.options('*', cors());

// Body parsing middlewares
app.use(json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (helpful for debugging)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Origin:', req.get('origin') || 'no-origin');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

// ════════════════════════════════════════════════
//               Cloudinary Config
// ════════════════════════════════════════════════
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
  console.error('❌ Cloudinary credentials missing in .env');
  process.exit(1);
}

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ════════════════════════════════════════════════
//               MongoDB Connection
// ════════════════════════════════════════════════
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    try {
      const indexes = await User.collection.indexInformation();
      for (const [name, index] of Object.entries(indexes)) {
        if ('expireAfterSeconds' in index) {
          await User.collection.dropIndex(name);
          console.log(`Dropped old TTL index: ${name}`);
        }
      }
    } catch (err) {
      console.warn('Could not clean TTL indexes:', err.message);
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
    process.exit(1);
  });

// ════════════════════════════════════════════════
//               Email Template Helper
// ════════════════════════════════════════════════
async function getEmailTemplate(data) {
  try {
    const templatePath = path.join(__dirname, 'meeting-reminder.html');
    const source = await fsPromises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(source);
    return template(data);
  } catch (error) {
    console.error('Email template error:', error);
    throw error;
  }
}

// ════════════════════════════════════════════════
//                   ROUTES
// ════════════════════════════════════════════════
console.log('Registering routes...');

app.use('/api/leaderboard',        leaderboardRoutes);
app.use('/api',                     apiRoutes);
app.use('/api/pdf',                 pdfRoutes);
app.use('/api/testimonials',        testimonialsRoutes);
app.use('/api/lectures',            lectureRoutes);
app.use('/api/gallery',             galleryRoutes);
app.use('/api/lecture-requests',    lectureRequestRoutes);
app.use('/api/forgot-password',     forgetPasswordRoutes);
app.use('/api/reset-password',      forgetPasswordRoutes);
app.use('/api/messages',            messageRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Deprecated uploads path
app.get('/api/Uploads/*', (req, res) => {
  res.status(410).json({ 
    message: 'هذا المسار القديم لم يعد مدعومًا. استخدم /api/gallery/images للصور.' 
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`❌ 404 → ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      '/api/join-requests',
      '/api/login',
      '/api/profile',
      '/health'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'خطأ في الخادم',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ════════════════════════════════════════════════
//             DAILY MEETING REMINDER JOB
// ════════════════════════════════════════════════
cron.schedule('1 0 * * *', async () => {
  console.log('⏰ Daily meeting reminder check:', new Date().toLocaleString('ar-EG'));
  try {
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const endOfDay = new Date(now.setHours(23, 59, 59, 999));

    const users = await User.find({
      'meetings.reminded': false,
      'meetings.date': { $gte: startOfDay, $lte: endOfDay }
    }).lean();

    for (const user of users) {
      const meetingsToday = user.meetings.filter(m => 
        !m.reminded && m.date >= startOfDay && m.date <= endOfDay
      );

      if (meetingsToday.length === 0) continue;

      const meetingList = meetingsToday.map(m => `
        <li>
          <strong>العنوان:</strong> ${m.title}<br>
          <strong>التاريخ:</strong> ${m.date.toISOString().split('T')[0]}<br>
          <strong>الوقت:</strong> ${m.startTime} - ${m.endTime}
        </li>
      `).join('');

      const html = await getEmailTemplate({
        name: user.name || 'المستخدم',
        meetingsCount: meetingsToday.length,
        plural: meetingsToday.length > 1,
        meetingList
      });

      await sendEmail({
        to: user.email,
        subject: 'تذكير بمواعيد اليوم',
        html
      });

      for (const meeting of meetingsToday) {
        await User.updateOne(
          { _id: user._id, 'meetings._id': meeting._id },
          { $set: { 'meetings.$.reminded': true } }
        );
      }
    }
  } catch (err) {
    console.error('Daily reminder job failed:', err);
  }
});

// ════════════════════════════════════════════════
//                    START SERVER
// ════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📅 Timezone: ${process.env.TZ}`);
  console.log(`🌍 Allowed CORS origins:`);
  allowedOrigins.forEach(o => console.log(`   ✓ ${o}`));
  console.log('\n');
});