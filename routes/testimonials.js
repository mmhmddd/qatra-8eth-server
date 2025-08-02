import express from 'express';
import authMiddleware from '../middleware/auth.js';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import Testimonial from '../models/testimonials.js';

const router = express.Router();

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join('Uploads', 'testimonials'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('الملفات المسموح بها هي: JPEG, JPG, PNG'));
  }
};

const upload = multer({ storage, fileFilter });

// Create Testimonial
router.post('/create', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار صورة للرفع' });
    }
    const { rating, name, major, reviewText } = req.body;
    if (!rating || !name || !major || !reviewText) {
      return res.status(400).json({ message: 'التقييم، الاسم، التخصص، ونص التعليق مطلوبة' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'التقييم يجب أن يكون بين 1 و5 نجوم' });
    }

    const testimonial = new Testimonial({
      image: `/Uploads/testimonials/${req.file.filename}`,
      rating: Number(rating),
      name,
      major,
      reviewText,
      uploadedBy: req.userId
    });

    await testimonial.save();
    res.status(201).json({
      message: 'تم إضافة الشهادة بنجاح',
      testimonial: {
        id: testimonial._id.toString(),
        image: testimonial.image,
        rating: testimonial.rating,
        name: testimonial.name,
        major: testimonial.major,
        reviewText: testimonial.reviewText,
        uploadedBy: testimonial.uploadedBy,
        createdAt: testimonial.createdAt
      }
    });
  } catch (error) {
    console.error('Create Testimonial error:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get All Testimonials (Public Access)
router.get('/list', async (req, res) => {
  try {
    const testimonials = await Testimonial.find(); // Fetch all testimonials, no user filter
    res.status(200).json({
      message: 'تم جلب الشهادات بنجاح',
      testimonials: testimonials.map(testimonial => ({
        id: testimonial._id.toString(),
        image: testimonial.image,
        rating: testimonial.rating,
        name: testimonial.name,
        major: testimonial.major,
        reviewText: testimonial.reviewText,
        uploadedBy: testimonial.uploadedBy,
        createdAt: testimonial.createdAt
      }))
    });
  } catch (error) {
    console.error('List Testimonials error:', error);
    res.status(500).json({ message: 'خطأ في جلب الشهادات', error: error.message });
  }
});

// Update Testimonial
router.put('/edit/:id', authMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الشهادة غير صالح' });
    }
    const { rating, name, major, reviewText } = req.body;
    if (!rating || !name || !major || !reviewText) {
      return res.status(400).json({ message: 'التقييم، الاسم، التخصص، ونص التعليق مطلوبة' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'التقييم يجب أن يكون بين 1 و5 نجوم' });
    }

    const updateData = {
      rating: Number(rating),
      name,
      major,
      reviewText
    };
    if (req.file) {
      updateData.image = `/Uploads/testimonials/${req.file.filename}`;
    }

    const testimonial = await Testimonial.findOneAndUpdate(
      { _id: req.params.id, uploadedBy: req.userId },
      updateData,
      { new: true, runValidators: true }
    );
    if (!testimonial) {
      return res.status(404).json({ message: 'الشهادة غير موجودة' });
    }

    res.status(200).json({
      message: 'تم تعديل الشهادة بنجاح',
      testimonial: {
        id: testimonial._id.toString(),
        image: testimonial.image,
        rating: testimonial.rating,
        name: testimonial.name,
        major: testimonial.major,
        reviewText: testimonial.reviewText,
        uploadedBy: testimonial.uploadedBy,
        createdAt: testimonial.createdAt
      }
    });
  } catch (error) {
    console.error('Edit Testimonial error:', error);
    res.status(500).json({ message: 'خطأ في تعديل الشهادة', error: error.message });
  }
});

// Delete Testimonial
router.delete('/delete/:id', authMiddleware, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الشهادة غير صالح' });
    }
    const testimonial = await Testimonial.findOne({ _id: req.params.id, uploadedBy: req.userId });
    if (!testimonial) {
      return res.status(404).json({ message: 'الشهادة غير موجودة' });
    }
    if (testimonial.image) {
      const imagePath = path.join('Uploads', 'testimonials', path.basename(testimonial.image));
      await fs.unlink(imagePath).catch(err => console.error('Error deleting image:', err));
    }
    await Testimonial.deleteOne({ _id: req.params.id });
    res.status(200).json({ message: 'تم حذف الشهادة بنجاح' });
  } catch (error) {
    console.error('Delete Testimonial error:', error);
    res.status(500).json({ message: 'خطأ في حذف الشهادة', error: error.message });
  }
});

export default router;