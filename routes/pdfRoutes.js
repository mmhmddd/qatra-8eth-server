import express from 'express';
import PDF from '../models/pdf.js';
import authMiddleware from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../Uploads');

// Ensure Uploads directory exists
fs.mkdir(uploadDir, { recursive: true }).catch(err => console.error('Error creating Uploads directory:', err));

// Multer configuration for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /pdf/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('الملفات المسموح بها هي: PDF فقط'), false);
  }
};

const upload = multer({ storage, fileFilter });

// Upload PDF
router.post('/upload', authMiddleware, upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار ملف PDF للرفع' });
    }
    const { title, description, creatorName } = req.body;
    if (!title || !description || !creatorName) {
      await fs.unlink(path.join(uploadDir, req.file.filename)).catch(err => console.error('Error deleting file:', err));
      return res.status(400).json({ message: 'العنوان، الوصف، واسم المنشئ مطلوبة' });
    }
    const pdf = new PDF({
      title,
      description,
      creatorName,
      filePath: `/Uploads/${req.file.filename}`,
      uploadedBy: req.userId
    });
    await pdf.save();
    res.status(201).json({
      message: 'تم رفع ملف PDF بنجاح',
      pdf: {
        id: pdf._id.toString(), // Ensure ID is a string
        title: pdf.title,
        description: pdf.description,
        creatorName: pdf.creatorName,
        filePath: pdf.filePath,
        uploadedBy: pdf.uploadedBy,
        createdAt: pdf.createdAt
      }
    });
  } catch (error) {
    if (req.file) {
      await fs.unlink(path.join(uploadDir, req.file.filename)).catch(err => console.error('Error deleting file:', err));
    }
    console.error('Upload PDF error:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// List PDFs
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const pdfs = await PDF.find({ uploadedBy: req.userId });
    res.status(200).json({
      message: 'تم جلب الملفات بنجاح',
      pdfs: pdfs.map(pdf => ({
        id: pdf._id.toString(),
        title: pdf.title,
        description: pdf.description,
        creatorName: pdf.creatorName,
        filePath: pdf.filePath,
        uploadedBy: pdf.uploadedBy,
        createdAt: pdf.createdAt
      }))
    });
  } catch (error) {
    console.error('List PDFs error:', error);
    res.status(500).json({ message: 'خطأ في جلب الملفات', error: error.message });
  }
});

// Delete PDF
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    console.log('Delete PDF request:', { id: req.params.id, userId: req.userId });
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
    }
    const filePath = path.join(__dirname, '..', pdf.filePath);
    console.log('Attempting to delete file:', filePath);
    try {
      await fs.access(filePath, fs.constants.F_OK); // Check if file exists
      await fs.unlink(filePath);
      console.log('File deleted successfully:', filePath);
    } catch (fileError) {
      console.warn('File deletion skipped (file may not exist):', fileError.message);
      // Continue with database deletion
    }
    await PDF.deleteOne({ _id: req.params.id });
    console.log('PDF deleted from database:', req.params.id);
    res.status(200).json({ message: 'تم حذف الملف بنجاح' });
  } catch (error) {
    console.error('Delete PDF error:', {
      message: error.message,
      stack: error.stack,
      id: req.params.id,
      userId: req.userId
    });
    res.status(500).json({ message: 'خطأ في حذف الملف', error: error.message });
  }
});

// View PDF
router.get('/view/:id', authMiddleware, async (req, res) => {
  try {
    console.log('View PDF request:', { id: req.params.id, userId: req.userId });
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
    }
    res.status(200).json({
      id: pdf._id.toString(),
      title: pdf.title,
      description: pdf.description,
      creatorName: pdf.creatorName,
      filePath: pdf.filePath,
      uploadedBy: pdf.uploadedBy,
      createdAt: pdf.createdAt
    });
  } catch (error) {
    console.error('View PDF error:', {
      message: error.message,
      stack: error.stack,
      id: req.params.id,
      userId: req.userId
    });
    res.status(500).json({ message: 'خطأ في عرض الملف', error: error.message });
  }
});

export default router;