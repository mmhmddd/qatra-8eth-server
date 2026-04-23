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
import logger from './utils/logger.js';

import leaderboardRoutes from './routes/leaderboard.js';
import apiRoutes from './routes/api.js';
import pdfRoutes from './routes/pdfRoutes.js';
import testimonialsRoutes from './routes/testimonials.js';
import lectureRoutes from './routes/lectureRoutes.js';
import galleryRoutes from './routes/gallery.js';
import lectureRequestRoutes from './routes/lectureRequestRoutes.js';
import forgetPasswordRoutes from './routes/forgotPassword.js';
import messageRoutes from './routes/messageRoutes.js';
import newsRoutes from './routes/news.js';

process.env.TZ = 'Africa/Cairo';
config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════
//     RENDER.COM SPECIFIC CONFIGURATION
// ════════════════════════════════════════════════
app.set('trust proxy', 1);

app.use((req, res, next) => {
  req.setTimeout(120000);
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

app.use(cors({
  origin: function (origin, callback) {
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
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.options('*', cors());

// ════════════════════════════════════════════════
//          BODY PARSING MIDDLEWARES
// ════════════════════════════════════════════════
app.use(json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ════════════════════════════════════════════════
//          REQUEST LOGGING MIDDLEWARE
// ════════════════════════════════════════════════
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log(`Origin: ${req.get('origin') || 'no-origin'}`);
  console.log(`User-Agent: ${req.get('user-agent') || 'unknown'}`);
  console.log(`IP: ${req.ip || req.connection.remoteAddress}`);
  const authHeader = req.get('authorization');
  if (authHeader) {
    console.log(`Authorization: ${authHeader.substring(0, 20)}...`);
  }
  console.log(`${'='.repeat(60)}\n`);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`⏱️  ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});

// ════════════════════════════════════════════════
//               CLOUDINARY CONFIG
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
//               MONGODB CONNECTION
// ════════════════════════════════════════════════
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in .env');
  process.exit(1);
}

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

      // ✅ FIXED: Correctly detect and drop TTL indexes using listIndexes()
      try {
        const rawIndexes = await User.collection.listIndexes().toArray();
        const ttlIndexes = rawIndexes.filter(
          idx => idx.expireAfterSeconds !== undefined
        );

        if (ttlIndexes.length === 0) {
          console.log('✅ No TTL indexes found on users collection');
        } else {
          for (const idx of ttlIndexes) {
            await User.collection.dropIndex(idx.name);
            console.log(`🗑️  Dropped TTL index: "${idx.name}"`);
            logger.info?.({
              action: 'TTL_INDEX_DROPPED',
              context: { indexName: idx.name }
            });
          }
        }
      } catch (err) {
        console.warn('⚠️  Could not clean TTL indexes:', err.message);
      }

      return;

    } catch (err) {
      console.error(`❌ MongoDB connection attempt ${i + 1} failed:`, err.message);
      logger.error({ action: 'MONGODB_CONNECT_ATTEMPT', error: err, context: { attempt: i + 1 } });

      if (i < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error('❌ All MongoDB connection attempts failed');
        logger.error({ action: 'MONGODB_ALL_ATTEMPTS_FAILED', error: err, context: { totalAttempts: retries } });
        process.exit(1);
      }
    }
  }
};

// ════════════════════════════════════════════════
//          MONGOOSE CONNECTION EVENTS
// ════════════════════════════════════════════════
mongoose.connection.on('connected', () => {
  console.log('✅ Mongoose connected to MongoDB');
  logger.mongoConnected();
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err);
  logger.error({ action: 'MONGOOSE_CONNECTION_ERROR', error: err });
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  Mongoose disconnected from MongoDB');
  logger.mongoDisconnected({ reason: 'mongoose_disconnected_event' });
});

// Graceful shutdown on SIGINT
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed through app termination');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error closing MongoDB connection:', err);
    logger.error({ action: 'SIGINT_CLOSE', error: err });
    process.exit(1);
  }
});

// Connect to MongoDB
await connectWithRetry();

// ════════════════════════════════════════════════
//          EMAIL TEMPLATE HELPER
// ════════════════════════════════════════════════
async function getEmailTemplate(data) {
  try {
    const templatePath = path.join(__dirname, 'meeting-reminder.html');
    const source = await fsPromises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(source);
    return template(data);
  } catch (error) {
    console.error('Email template error:', error);
    logger.error({ action: 'EMAIL_TEMPLATE_READ', error });
    throw error;
  }
}

// ════════════════════════════════════════════════
//          HEALTH CHECK ENDPOINTS
// ════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime()
  });
});

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
      resend: {
        status: process.env.RESEND_API_KEY ? 'configured' : 'not configured',
        apiKeyLength: process.env.RESEND_API_KEY?.length || 0,
        fromEmail: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
      }
    }
  };
  res.json(healthcheck);
});

app.get('/api/ping', (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// ════════════════════════════════════════════════
//                   ROUTES
// ════════════════════════════════════════════════
console.log('📝 Registering routes...');

app.use('/api/leaderboard',       leaderboardRoutes);
app.use('/api',                   apiRoutes);
app.use('/api/pdf',               pdfRoutes);
app.use('/api/testimonials',      testimonialsRoutes);
app.use('/api/lectures',          lectureRoutes);
app.use('/api/gallery',           galleryRoutes);
app.use('/api/lecture-requests',  lectureRequestRoutes);
app.use('/api/forgot-password',   forgetPasswordRoutes);
app.use('/api/reset-password',    forgetPasswordRoutes);
app.use('/api/messages',          messageRoutes);
app.use('/api/news',              newsRoutes);

console.log(' All routes registered');

// Deprecated uploads path
app.get('/api/Uploads/*', (req, res) => {
  res.status(410).json({
    message: 'هذا المسار القديم لم يعد مدعومًا. استخدم /api/gallery/images للصور.'
  });
});

// ════════════════════════════════════════════════
//               404 HANDLER
// ════════════════════════════════════════════════
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

// ════════════════════════════════════════════════
//               GLOBAL ERROR HANDLER
// ════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('═══════════════════════════════════════');
  console.error('❌ Global error handler:');
  console.error('Path:', req.path);
  console.error('Method:', req.method);
  console.error('Error:', err);
  console.error('Stack:', err.stack);
  console.error('═══════════════════════════════════════');

  logger.error({
    action: 'GLOBAL_ERROR_HANDLER',
    error: err,
    context: { path: req.path, method: req.method }
  });

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
//          DAILY MEETING REMINDER JOB (00:01 AM)
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
    logger.error({ action: 'CRON_DAILY_REMINDER', error: err });
  }
});


cron.schedule('0 2 * * *', async () => {
  console.log('🧹 Running expired messages cleanup:', new Date().toLocaleString('ar-EG'));
  try {
    const now = new Date();

    const result = await User.updateMany(
      { 'messages.0': { $exists: true } }, 
      {
        $pull: {
          messages: { displayUntil: { $lte: now } }
        }
      }
    );

    console.log(
      `✅ Expired messages cleanup done — modified ${result.modifiedCount} user(s)`
    );

    logger.info?.({
      action: 'CRON_EXPIRED_MESSAGES_CLEANUP',
      context: {
        modifiedCount: result.modifiedCount,
        timestamp: now.toISOString()
      }
    });

  } catch (err) {
    console.error('❌ Expired messages cleanup failed:', err.message);
    logger.error({ action: 'CRON_EXPIRED_MESSAGES_CLEANUP', error: err });
  }
});

// ════════════════════════════════════════════════
//          PERIODIC DB INTEGRITY CHECK (every 6 hours)
// ════════════════════════════════════════════════
cron.schedule('0 */6 * * *', async () => {
  console.log('🔍 Running DB integrity check...');
  try {
    const { default: JoinRequest } = await import('./models/JoinRequest.js');

    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    let missingCount = 0;

    for (const member of approvedMembers) {
      const user = await User.findOne({ email: member.email.toLowerCase().trim() });
      if (!user) {
        missingCount++;
        logger.dbAnomaly({
          type: 'APPROVED_MEMBER_WITHOUT_USER_ACCOUNT',
          details: {
            memberId: member._id,
            email: member.email,
            name: member.name,
            approvedAt: member.updatedAt
          },
          severity: 'CRITICAL'
        });
      }
    }

    if (missingCount === 0) {
      console.log('✅ DB integrity check passed — all approved members have accounts');
    } else {
      console.error(`🚨 DB integrity check: ${missingCount} approved members WITHOUT user accounts!`);
    }
  } catch (err) {
    console.error('❌ DB integrity check failed:', err.message);
    logger.error({ action: 'CRON_DB_INTEGRITY_CHECK', error: err });
  }
});

// ════════════════════════════════════════════════
//               START SERVER
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

  logger.serverStarted({
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    mongoState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// Set server timeouts for Render.com
server.timeout = 120000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  logger.error({ action: 'SERVER_ERROR', error });
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

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