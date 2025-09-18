// delete-pdfs.js
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';
import PDF from './models/pdf.js'; // 👈 عدل المسار حسب مكان الموديل عندك

// تحميل .env
dotenv.config();

// 1. إعداد MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// 2. إعداد Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 3. دالة لحذف كل الـ PDFs
const deleteAllPdfs = async () => {
  try {
    // --- 3.1 احذف من MongoDB ---
    const pdfs = await PDF.find();
    console.log(`📂 Found ${pdfs.length} PDFs in MongoDB`);

    for (const pdf of pdfs) {
      // --- 3.2 لو موجود في Cloudinary ---
      if (pdf.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(pdf.cloudinaryId, { resource_type: 'raw' });
          console.log(`🗑️ Deleted from Cloudinary: ${pdf.cloudinaryId}`);
        } catch (err) {
          console.error('⚠️ Cloudinary delete error:', err.message);
        }
      }
    }

    // --- 3.3 احذف من uploads folder ---
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      files.forEach(file => {
        if (file.endsWith('.pdf')) {
          fs.unlinkSync(path.join(uploadDir, file));
          console.log(`🗑️ Deleted from uploads folder: ${file}`);
        }
      });
    }

    // --- 3.4 امسح كل الـ docs من MongoDB ---
    await PDF.deleteMany({});
    console.log('🗑️ Deleted all PDFs from MongoDB');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error while deleting PDFs:', err.message);
    process.exit(1);
  }
};

// 4. شغّل الدالة
deleteAllPdfs();
