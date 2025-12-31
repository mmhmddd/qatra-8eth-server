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
//     RENDER.COM SPECIFIC CONFIGURATION
// ════════════════════════════════════════════════

// Trust proxy - CRITICAL for Render.com
app.set('trust proxy', 1);

// Increase timeouts for Render.com cold starts
app.use((req, res, next) => {
  req.setTimeout(120000); // 2 minutes
  res.setTimeout(120000);
  next();
});

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

// CORS configuration - MUST be before routes
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) {
      console.log('✅ Request with no origin allowed');
      return callback(null, true);
    }
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log('✅ CORS allowed for origin:', origin);
      callback(null, true);
    } else {
      console.warn('❌ CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight for all routes
app.options('*', cors());

// Body parsing middlewares
app.use(json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log(`Origin: ${req.get('origin') || 'no-origin'}`);
  console.log(`User-Agent: ${req.get('user-agent') || 'unknown'}`);
  console.log(`IP: ${req.ip || req.connection.remoteAddress}`);
  
  // Log authorization header (without exposing token)
  const authHeader = req.get('authorization');
  if (authHeader) {
    console.log(`Authorization: ${authHeader.substring(0, 20)}...`);
  }
  console.log(`${'='.repeat(60)}\n`);
  
  next();
});

// Response time logging
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`⏱️  ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  
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

console.log('✅ Cloudinary configured');

// ════════════════════════════════════════════════
//               MongoDB Connection
// ════════════════════════════════════════════════
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

// MongoDB connection with retry logic for Render.com
const connectWithRetry = async (retries = 5) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔄 Attempting MongoDB connection (attempt ${i + 1}/${retries})...`);
      
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2,
      });
      
      console.log('✅ Connected to MongoDB');
      
      // Clean up old TTL indexes
      try {
        const indexes = await User.collection.indexInformation();
        for (const [name, index] of Object.entries(indexes)) {
          if ('expireAfterSeconds' in index) {
            await User.collection.dropIndex(name);
            console.log(`🗑️  Dropped old TTL index: ${name}`);
          }
        }
      } catch (err) {
        console.warn('⚠️  Could not clean TTL indexes:', err.message);
      }
      
      return; // Success
      
    } catch (err) {
      console.error(`❌ MongoDB connection attempt ${i + 1} failed:`, err.message);
      
      if (i < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000); // Exponential backoff
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ All MongoDB connection attempts failed');
        process.exit(1);
      }
    }
  }
};

// Handle MongoDB connection events
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed through app termination');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error closing MongoDB connection:', err);
    process.exit(1);
  }
});

// Connect to MongoDB
await connectWithRetry();

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
//            HEALTH CHECK ENDPOINTS
// ════════════════════════════════════════════════

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

// Detailed health check
app.get('/api/health', (req, res) => {
  const healthcheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    services: {
      mongodb: {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        readyState: mongoose.connection.readyState
      },
      cloudinary: {
        status: process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'not configured'
      },
      smtp: {
        status: process.env.SMTP_USER && process.env.SMTP_PASS ? 'configured' : 'not configured'
      }
    }
  };
  
  res.json(healthcheck);
});

// Keep-alive endpoint for preventing cold starts
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// ════════════════════════════════════════════════
//                   ROUTES
// ════════════════════════════════════════════════
console.log('📝 Registering routes...');

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

console.log('✅ All routes registered');

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
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl}`,
    availableRoutes: [
      '/health',
      '/api/health',
      '/api/ping',
      '/api/join-requests',
      '/api/login',
      '/api/profile'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('═══════════════════════════════════════');
  console.error('❌ Global error handler:');
  console.error('Path:', req.path);
  console.error('Method:', req.method);
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('═══════════════════════════════════════');
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'خطأ في الخادم',
    error: process.env.NODE_ENV === 'development' ? {
      message: err.message,
      stack: err.stack
    } : undefined
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

    console.log(`📧 Found ${users.length} users with meetings today`);

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
      
      console.log(`✅ Sent reminder to ${user.email}`);
    }
  } catch (err) {
    console.error('❌ Daily reminder job failed:', err);
  }
});

// ════════════════════════════════════════════════
//                    START SERVER
// ════════════════════════════════════════════════
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 SERVER STARTED SUCCESSFULLY');
  console.log('═'.repeat(60));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📅 Timezone: ${process.env.TZ}`);
  console.log(`🔗 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Disconnected ❌'}`);
  console.log('\n🌐 Allowed CORS origins:');
  allowedOrigins.forEach(o => console.log(`   ✓ ${o}`));
  console.log('═'.repeat(60) + '\n');
});

// Set server timeouts for Render.com
server.timeout = 120000; // 2 minutes
server.keepAliveTimeout = 65000; // 65 seconds
server.headersTimeout = 66000; // 66 seconds

// Handle server errors
server.on('error', (error) => {
  console.error('❌ Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});