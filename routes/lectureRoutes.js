import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import validator from 'validator';
import mongoose from 'mongoose';

const router = express.Router();

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Add a lecture link
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { link } = req.body;
    if (!link) {
      return res.status(400).json({ message: 'رابط المحاضرة مطلوب' });
    }
    if (!validator.isURL(link)) {
      return res.status(400).json({ message: 'رابط المحاضرة غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (!Array.isArray(user.lectures)) {
      user.lectures = [];
    }

    user.lectures.push({ link, createdAt: new Date() });
    user.lectureCount = (user.lectureCount || 0) + 1;
    await user.save();

    // Create notification for admin
    const notification = new Notification({
      userId: req.userId,
      message: `تمت إضافة محاضرة جديدة بواسطة ${user.email}: ${link}`,
      type: 'lecture_added'
    });
    await notification.save();

    // Check monthly lecture count
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const lectureCountThisMonth = user.lectures.filter(lecture => new Date(lecture.createdAt) >= startOfMonth).length;
    if (lectureCountThisMonth < 2) {
      const warningNotification = new Notification({
        userId: req.userId,
        message: `تحذير: المستخدم ${user.email} قام برفع ${lectureCountThisMonth} محاضرة فقط هذا الشهر`,
        type: 'low_lecture_count'
      });
      await warningNotification.save();
    }

    console.log('تم إضافة رابط المحاضرة:', { userId: req.userId, link, lectureCount: user.lectureCount });
    res.json({
      message: 'تم إضافة رابط المحاضرة بنجاح',
      lecture: { link, createdAt: new Date() },
      lectureCount: user.lectureCount
    });
  } catch (error) {
    console.error('خطأ في إضافة رابط المحاضرة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a lecture link (Admin only)
router.delete('/:lectureId', authMiddleware, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ message: 'يجب أن تكون أدمن لتتمكن من حذف المحاضرة' });
    }

    const lectureId = req.params.lectureId;
    if (!mongoose.Types.ObjectId.isValid(lectureId)) {
      return res.status(400).json({ message: 'معرف المحاضرة غير صالح' });
    }

    const user = await User.findOne({ 'lectures._id': lectureId });
    if (!user) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    const lecture = user.lectures.id(lectureId);
    if (!lecture) {
      return res.status(404).json({ message: 'المحاضرة غير موجودة' });
    }

    user.lectures.pull(lectureId);
    user.lectureCount = (user.lectureCount || 1) - 1;
    await user.save();

    console.log('تم حذف المحاضرة:', { lectureId, userId: user._id });
    res.json({ message: 'تم حذف المحاضرة بنجاح', lectureCount: user.lectureCount });
  } catch (error) {
    console.error('خطأ في حذف المحاضرة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// GET /api/lectures/notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      message: 'تم جلب الإشعارات بنجاح',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read
      }))
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في جلب الإشعارات',
      error: error.message
    });
  }
});

// POST /api/lectures/notifications/mark-read
router.post('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.userId, read: false },
      { $set: { read: true } }
    );
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 });
    res.json({
      success: true,
      message: 'تم تحديد الإشعارات كمقروءة',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: notification.createdAt.toISOString(),
        read: notification.read
      }))
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({
      success: false,
      message: 'خطأ في تحديد الإشعارات كمقروءة',
      error: error.message
    });
  }
});

export default router;
