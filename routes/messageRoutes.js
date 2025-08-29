import express from 'express';
import Message from '../models/message.js';
import authMiddleware from '../middleware/auth.js';
import mongoose from 'mongoose';

const router = express.Router();

// إنشاء رسالة جديدة
router.post('/create', authMiddleware, async (req, res) => {
  console.log('POST /api/messages/create called', {
    body: req.body,
    userId: req.userId
  });
  try {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ message: 'محتوى الرسالة مطلوب' });
    }

    const message = new Message({
      content,
      createdBy: req.userId,
      isVisible: true
    });

    await message.save();
    res.status(201).json({
      message: 'تم إنشاء الرسالة بنجاح',
      data: {
        id: message._id.toString(),
        content: message.content,
        isVisible: message.isVisible,
        createdBy: message.createdBy.toString(),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      }
    });
  } catch (error) {
    console.error('Create message error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// جلب جميع الرسائل
router.get('/list', async (req, res) => {
  try {
    const messages = await Message.find()
      .select('content isVisible createdBy createdAt updatedAt')
      .populate('createdBy', 'email');

    const messageList = messages.map(msg => ({
      id: msg._id.toString(),
      content: msg.content,
      isVisible: msg.isVisible,
      createdBy: msg.createdBy ? msg.createdBy.email : 'Unknown',
      createdAt: msg.createdAt.toISOString(),
      updatedAt: msg.updatedAt.toISOString()
    }));

    res.json({
      message: 'تم جلب الرسائل بنجاح',
      messages: messageList
    });
  } catch (error) {
    console.error('List messages error:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// تعديل رسالة
router.put('/:id', authMiddleware, async (req, res) => {
  console.log('PUT /api/messages/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الرسالة غير صالح' });
    }
    const { content, isVisible } = req.body;
    if (!content && isVisible === undefined) {
      return res.status(400).json({ message: 'يجب تقديم محتوى الرسالة أو حالة الظهور' });
    }

    const message = await Message.findOne({ _id: req.params.id, createdBy: req.userId });
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة أو لا تملك صلاحية التعديل' });
    }

    if (content) message.content = content;
    if (isVisible !== undefined) message.isVisible = isVisible;

    await message.save();
    res.json({
      message: 'تم تعديل الرسالة بنجاح',
      data: {
        id: message._id.toString(),
        content: message.content,
        isVisible: message.isVisible,
        createdBy: message.createdBy.toString(),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      }
    });
  } catch (error) {
    console.error('Update message error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// حذف رسالة
router.delete('/:id', authMiddleware, async (req, res) => {
  console.log('DELETE /api/messages/:id called', { id: req.params.id, userId: req.userId });
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'معرف الرسالة غير صالح' });
    }
    const message = await Message.findOne({ _id: req.params.id, createdBy: req.userId });
    if (!message) {
      return res.status(404).json({ message: 'الرسالة غير موجودة أو لا تملك صلاحية الحذف' });
    }

    await Message.deleteOne({ _id: req.params.id });
    res.status(200).json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    console.error('Delete message error:', {
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;