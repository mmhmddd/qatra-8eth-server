import express, { json } from 'express';
import { connect } from 'mongoose';
import { config } from 'dotenv';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Load environment variables
config();

// Validate environment variables
if (!process.env.MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined in .env file');
  process.exit(1);
}
if (!process.env.PORT) {
  console.warn('Warning: PORT is not defined in .env file, defaulting to 5000');
}
if (!process.env.FRONTEND_URL) {
  console.warn('Warning: FRONTEND_URL is not defined in .env file, defaulting to http://localhost:4200');
}

// Connect to MongoDB
connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

const app = express();

// Ensure Uploads directory exists
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'Uploads');

// Create Uploads directory if it doesn't exist
fs.mkdir(uploadDir, { recursive: true })
  .then(() => console.log('Uploads directory ready'))
  .catch(err => console.error('Error creating Uploads directory:', err));

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true
}));

app.use(json());

// Configure multer for file uploads (for non-PDF routes, e.g., images)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('الملفات المسموح بها هي: JPEG, JPG, PNG'));
    }
  }
});

// Serve static files for uploaded files (for non-PDF routes)
app.use('/Uploads', express.static(uploadDir));

// Import and use routes
import apiRoutes from './routes/api.js';
import pdfRoutes from './routes/pdfRoutes.js';

// Debugging logs for route registration
console.log('Registering API routes at /api');
app.use('/api', apiRoutes);
console.log('Registering PDF routes at /api/pdf');
app.use('/api/pdf', pdfRoutes);

// Handle unmatched routes
app.use((req, res) => {
  console.log(`Unmatched route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: `Cannot ${req.method} ${req.originalUrl}` });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));