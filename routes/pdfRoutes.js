import express from 'express';
import PDF from '../models/pdf.js';
import authMiddleware from '../middleware/auth.js';
import mongoose from 'mongoose';
import multer from 'multer';

// Initialize router
const router = express.Router();

const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  console.log('Multer file filter:', file.originalname, file.mimetype);
  const isValid = file.mimetype === 'application/pdf' && /\.pdf$/.test(file.originalname.toLowerCase());
  if (isValid) {
    return cb(null, true);
  } else {
    cb(new Error('الملفات المسموح بها هي: PDF فقط'), false);
  }
};

const upload = multer({ storage, fileFilter });

// Upload PDF
router.post('/upload', authMiddleware, upload.single('pdfFile'), async (req, res) => {
  console.log('POST /api/pdf/upload called', {
    body: req.body,
    file: req.file ? { originalname: req.file.originalname, mimetype: req.file.mimetype } : null
  });
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار ملف PDF للرفع' });
    }
    const { title, description, creatorName } = req.body;
    if (!title || !description || !creatorName) {
      return res.status(400).json({ message: 'العنوان، الوصف، واسم المنشئ مطلوبة' });
    }

    const pdf = new PDF({
      title,
      description,
      creatorName,
      fileData: req.file.buffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      uploadedBy: req.userId
    });

    await pdf.save();
    res.status(201).json({
      message: 'تم رفع ملف PDF بنجاح',
      pdf: {
        id: pdf._id.toString(),
        title: pdf.title,
        description: pdf.description,
        creatorName: pdf.creatorName,
        fileName: pdf.fileName,
        uploadedBy: pdf.uploadedBy,
        createdAt: pdf.createdAt
      }
    });
  } catch (error) {
    console.error('Upload PDF error:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// List PDFs
router.get('/list', authMiddleware, async (req, res) => {
  console.log('GET /api/pdf/list called', { userId: req.userId });
  try {
    const pdfs = await PDF.find({ uploadedBy: req.userId }).select('-fileData');
    res.status(200).json({
      message: 'تم جلب الملفات بنجاح',
      pdfs: pdfs.map(pdf => ({
        id: pdf._id.toString(),
        title: pdf.title,
        description: pdf.description,
        creatorName: pdf.creatorName,
        fileName: pdf.fileName,
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
  console.log('DELETE /api/pdf/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الملف غير صالح' });
    }
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
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
  console.log('GET /api/pdf/view/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الملف غير صالح' });
    }
    const pdf = await PDF.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!pdf) {
      console.log('PDF not found for ID:', req.params.id);
      return res.status(404).json({ message: 'الملف غير موجود' });
    }

    res.set({
      'Content-Type': pdf.mimeType,
      'Content-Disposition': `inline; filename="${pdf.fileName}"`
    });
    res.send(pdf.fileData);
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