const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JoinRequest = require('../models/JoinRequest').default;
const User = require('../models/User').default;

// Submit a join request
router.post('/join-requests', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'الاسم والبريد الإلكتروني مطلوبان' });
    }

    const existingRequest = await JoinRequest.findOne({ email });
    if (existingRequest) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const joinRequest = new JoinRequest({ name, email });
    await joinRequest.save();
    console.log('Join request created:', joinRequest);
    res.status(201).json({ message: 'تم تسجيل طلب الانضمام بنجاح', id: joinRequest._id });
  } catch (error) {
    console.error('Error in submit join request:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all join requests
router.get('/join-requests', async (req, res) => {
  try {
    const joinRequests = await JoinRequest.find();
    console.log('Join requests fetched:', joinRequests.length);
    res.json(joinRequests);
  } catch (error) {
    console.error('Error in get join requests:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Approve a join request
router.post('/join-requests/:id/approve', async (req, res) => {
  try {
    const joinRequest = await JoinRequest.findById(req.params.id);
    if (!joinRequest) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Approved';
    await joinRequest.save();
    console.log('Join request approved:', joinRequest);

    const randomPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    console.log('Password hashed:', hashedPassword);

    const existingUser = await User.findOne({ email: joinRequest.email });
    if (existingUser) {
      return res.status(400).json({ message: 'حساب المستخدم موجود بالفعل' });
    }

    const user = new User({ email: joinRequest.email, password: hashedPassword });
    await user.save();
    console.log('User created:', user);

    res.json({ message: 'تم الموافقة على الطلب وإنشاء الحساب', email: user.email, password: randomPassword });
  } catch (error) {
    console.error('Error in approve join request:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Reject a join request
router.post('/join-requests/:id/reject', async (req, res) => {
  try {
    const joinRequest = await JoinRequest.findById(req.params.id);
    if (!joinRequest) {
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Rejected';
    await joinRequest.save();
    console.log('Join request rejected:', joinRequest);
    res.json({ message: 'تم رفض الطلب' });
  } catch (error) {
    console.error('Error in reject join request:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log('Login successful for:', email);
    res.json({ token });
  } catch (error) {
    console.error('Error in login:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

module.exports = router;