import express from 'express';
import { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import sendEmail from '../utils/email.js';
import validator from 'validator';
import crypto from 'crypto';

const router = express.Router();

// Multer configuration for file uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../Uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalName));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalName).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('يجب أن تكون الصورة بصيغة JPEG أو PNG'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'الوصول مرفوض، يرجى تسجيل الدخول' });
  }
  try {
    const decoded = verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    console.error('خطأ في التحقق من الرمز:', error);
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

// Serve static files from Uploads directory
router.use('/Uploads', express.static(uploadDir));

// Submit a join request
router.post('/join-requests', async (req, res) => {
  try {
    const { name, email, number, academicSpecialization, address, subjects } = req.body;
    if (!name || !email || !number || !academicSpecialization || !address) {
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، الرقم، التخصص الجامعي، والعنوان مطلوبة' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const existingRequest = await JoinRequest.findOne({ email });
    if (existingRequest) {
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const joinRequest = new JoinRequest({ name, email, number, academicSpecialization, address, subjects });
    await joinRequest.save();
    console.log('تم إنشاء طلب الانضمام:', joinRequest);
    res.status(201).json({ message: 'تم تسجيل طلب الانضمام بنجاح', id: joinRequest._id });
  } catch (error) {
    console.error('خطأ في تقديم طلب الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all join requests
router.get('/join-requests', async (req, res) => {
  try {
    const joinRequests = await JoinRequest.find();
    console.log('تم جلب طلبات الانضمام:', joinRequests.length);
    res.json(joinRequests);
  } catch (error) {
    console.error('خطأ في جلب طلبات الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Approve a join request
router.post('/join-requests/:id/approve', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'خطأ في إعدادات البريد الإلكتروني، تحقق من متغيرات البيئة' });
    }

    const joinRequest = await JoinRequest.findById(req.params.id).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'الطلب غير موجود' });
    }
    if (joinRequest.status !== 'Pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });
    }

    joinRequest.status = 'Approved';
    joinRequest.volunteerHours = 0;
    await joinRequest.save({ session });
    console.log('تمت الموافقة على طلب الانضمام:', joinRequest);

    if (!validator.isEmail(joinRequest.email)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني للطلب غير صالح' });
    }

    const existingUser = await User.findOne({ email: joinRequest.email }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'حساب المستخدم موجود بالفعل' });
    }

    const randomPassword = crypto.randomBytes(8).toString('hex');
    console.log('كلمة المرور المولدة:', randomPassword);

    const hashedPassword = await hash(randomPassword, 10);
    console.log('تم إنشاء كلمة المرور المشفرة');

    const user = new User({
      email: joinRequest.email,
      password: hashedPassword,
      numberOfStudents: 0,
      subjects: joinRequest.subjects || [],
      students: [],
      meetings: [],
      lectures: [],
      lectureCount: 0,
      role: 'user',
    });
    await user.save({ session });
    console.log('تم إنشاء المستخدم:', user.email);

    try {
      await sendEmail({
        to: joinRequest.email,
        subject: 'تم الموافقة على طلب الانضمام الخاص بك',
        text: `مرحبًا ${joinRequest.name},\n\nتم الموافقة على طلب انضمامك!\nبريدك الإلكتروني: ${joinRequest.email}\nكلمة المرور: ${randomPassword}\n\nيرجى تسجيل الدخول وتغيير كلمة المرور لاحقًا.\n\nتحياتنا,\nفريق الإدارة`,
      });
      console.log('تم إرسال البريد الإلكتروني إلى:', joinRequest.email);
    } catch (emailError) {
      console.error('فشل إرسال البريد الإلكتروني:', emailError);
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: 'فشل في إرسال البريد الإلكتروني', error: emailError.message });
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      message: 'تم الموافقة على الطلب وإنشاء الحساب وإرسال كلمة المرور عبر البريد الإلكتروني',
      email: user.email,
    });
  } catch (error) {
    console.error('خطأ في الموافقة على طلب الانضمام:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'فشل في الموافقة على الطلب، تحقق من المعرف أو الاتصال بالخادم', error: error.message });
  }
});

// Reject a join request
router.post('/join-requests/:id/reject', authMiddleware, async (req, res) => {
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
    console.log('تم رفض طلب الانضمام:', joinRequest);
    res.json({ message: 'تم رفض الطلب' });
  } catch (error) {
    console.error('خطأ في رفض طلب الانضمام:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete an approved member
router.delete('/members/:id', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const memberId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'معرف العضو غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(memberId).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'العضو غير موجود' });
    }

    if (joinRequest.status !== 'Approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: joinRequest.email }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    await JoinRequest.deleteOne({ _id: memberId }).session(session);
    await User.deleteOne({ email: joinRequest.email }).session(session);

    await session.commitTransaction();
    session.endSession();

    console.log('تم حذف العضو:', { memberId, email: joinRequest.email });
    res.json({ message: 'تم حذف العضو بنجاح' });
  } catch (error) {
    console.error('خطأ في حذف العضو:', error);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get all approved members with details
router.get('/approved-members', async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const membersWithDetails = await Promise.all(approvedMembers.map(async (member) => {
      const user = await User.findOne({ email: member.email });
      return {
        id: member._id,
        name: member.name,
        email: member.email,
        phone: member.number,
        address: member.address,
        academicSpecialization: member.academicSpecialization,
        volunteerHours: member.volunteerHours || 0,
        numberOfStudents: user?.numberOfStudents || 0,
        subjects: user?.subjects || [],
        students: user?.students || [],
        lectures: user?.lectures || [],
        lectureCount: user?.lectureCount || 0
      };
    }));
    console.log('تم جلب الأعضاء المعتمدين:', membersWithDetails.length);
    res.json(membersWithDetails);
  } catch (error) {
    console.error('خطأ في جلب الأعضاء المعتمدين:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get member details by ID
router.get('/members/:id', async (req, res) => {
  try {
    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    const user = await User.findOne({ email: member.email });
    res.json({
      id: member._id,
      name: member.name,
      email: member.email,
      phone: member.number,
      address: member.address,
      academicSpecialization: member.academicSpecialization,
      volunteerHours: member.volunteerHours || 0,
      numberOfStudents: user?.numberOfStudents || 0,
      subjects: user?.subjects || [],
      students: user?.students || [],
      lectures: user?.lectures || [],
      lectureCount: user?.lectureCount || 0,
      status: member.status,
      createdAt: member.createdAt,
    });
  } catch (error) {
    console.error('خطأ في جلب تفاصيل العضو:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update member details
router.put('/members/:id/update-details', async (req, res) => {
  try {
    const { volunteerHours, numberOfStudents, students, subjects } = req.body;
    if (volunteerHours === undefined || numberOfStudents === undefined || !Array.isArray(students) || !Array.isArray(subjects)) {
      return res.status(400).json({ message: 'ساعات التطوع، عدد الطلاب، بيانات الطلاب، والمواد مطلوبة' });
    }
    if (volunteerHours < 0 || numberOfStudents < 0) {
      return res.status(400).json({ message: 'ساعات التطوع وعدد الطلاب يجب أن يكونا صفر أو أكثر' });
    }
    if (students.some(student => !student.name || !student.email || !student.phone)) {
      return res.status(400).json({ message: 'بيانات الطلاب يجب أن تحتوي على الاسم، البريد الإلكتروني، والهاتف' });
    }

    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    if (member.status !== 'Approved') {
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email });
    if (!user) {
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    member.volunteerHours = volunteerHours;
    member.students = students;
    member.subjects = subjects;
    user.numberOfStudents = numberOfStudents;
    user.students = students;
    user.subjects = subjects;
    await Promise.all([member.save(), user.save()]);
    
    console.log('تم تحديث تفاصيل العضو:', { 
      memberId: member._id,
      volunteerHours, 
      numberOfStudents, 
      students, 
      subjects 
    });
    res.json({ 
      message: 'تم تحديث التفاصيل بنجاح',
      volunteerHours: member.volunteerHours,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects
    });
  } catch (error) {
    console.error('خطأ في تحديث تفاصيل العضو:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add a single student to a member
router.post('/members/:id/add-student', async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، والهاتف مطلوبة للطالب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب غير صالح' });
    }

    const member = await JoinRequest.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'العضو غير موجود' });
    }
    if (member.status !== 'Approved') {
      return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' });
    }

    const user = await User.findOne({ email: member.email });
    if (!user) {
      return res.status(404).json({ message: 'حساب المستخدم غير موجود' });
    }

    if (!Array.isArray(user.students)) {
      user.students = [];
    }
    if (!Array.isArray(member.students)) {
      member.students = [];
    }

    if (user.students.some(student => student.email === email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني للطالب مستخدم بالفعل' });
    }

    const newStudent = { name, email, phone };
    user.students.push(newStudent);
    member.students.push(newStudent);
    user.numberOfStudents = (user.numberOfStudents || 0) + 1;

    await Promise.all([member.save(), user.save()]);
    console.log('تم إضافة الطالب:', { 
      memberId: member._id, 
      student: newStudent, 
      numberOfStudents: user.numberOfStudents 
    });

    res.json({
      message: 'تم إضافة الطالب بنجاح',
      student: newStudent,
      numberOfStudents: user.numberOfStudents,
      students: user.students
    });
  } catch (error) {
    console.error('خطأ في إضافة الطالب:', error);
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
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const token = sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    console.log('تسجيل الدخول ناجح لـ:', email);
    res.json({ token });
  } catch (error) {
    console.error('خطأ في تسجيل الدخول:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Get user profile
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }
    const joinRequest = await JoinRequest.findOne({ email: user.email });
    console.log('تم جلب الملف الشخصي:', {
      userId: req.userId,
      numberOfStudents: user.numberOfStudents,
      students: user.students,
      subjects: user.subjects,
      meetings: user.meetings,
      lectures: user.lectures,
      lectureCount: user.lectureCount
    });
    res.json({
      success: true,
      message: 'تم جلب الملف الشخصي بنجاح',
      data: {
        user: {
          id: user._id,
          email: user.email,
          profileImage: user.profileImage || null,
          numberOfStudents: user.numberOfStudents || 0,
          subjects: user.subjects || [],
          students: user.students || [],
          meetings: user.meetings || [],
          lectures: user.lectures || [],
          lectureCount: user.lectureCount || 0
        },
        joinRequest: joinRequest ? {
          name: joinRequest.name,
          phone: joinRequest.number,
          academicSpecialization: joinRequest.academicSpecialization,
          address: joinRequest.address,
          volunteerHours: joinRequest.volunteerHours || 0,
          status: joinRequest.status,
          students: user.students || [],
          subjects: user.subjects || [],
          lectures: user.lectures || [],
          lectureCount: user.lectureCount || 0
        } : null
      }
    });
  } catch (error) {
    console.error('خطأ في جلب الملف الشخصي:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update password
router.put('/profile/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'كلمة المرور الحالية والجديدة مطلوبة' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const isMatch = await compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password = await hash(newPassword, 10);
    await user.save();
    res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (error) {
    console.error('خطأ في تحديث كلمة المرور:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Upload profile image
router.post('/profile/image', authMiddleware, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'يرجى اختيار صورة للرفع' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const imagePath = `/Uploads/${req.file.filename}`;
    user.profileImage = imagePath;
    await user.save();

    console.log('تم رفع الصورة الشخصية:', imagePath);
    res.json({
      success: true,
      message: 'تم رفع الصورة الشخصية بنجاح',
      data: { profileImage: imagePath }
    });
  } catch (error) {
    console.error('خطأ في رفع الصورة الشخصية:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Add a meeting to calendar
router.post('/profile/meetings', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    if (!Array.isArray(user.meetings)) {
      user.meetings = [];
      console.log('تم تهيئة مصفوفة المواعيد كمصفوفة فارغة');
    }

    user.meetings.push({ title, date: parsedDate, startTime, endTime });
    await user.save();
    console.log('تم إضافة الموعد:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime
    }));

    res.json({ message: 'تم إضافة الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في إضافة الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Update a meeting
router.put('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    const meetingId = req.params.meetingId;

    if (!title || !date || !startTime || !endTime) {
      return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    }

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: 'صيغة التاريخ غير صالحة، يجب أن تكون YYYY-MM-DD' });
    }

    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    meeting.title = title;
    meeting.date = parsedDate;
    meeting.startTime = startTime;
    meeting.endTime = endTime;

    await user.save();
    console.log('تم تحديث الموعد:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime
    }));

    res.json({ message: 'تم تحديث الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في تحديث الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// Delete a meeting
router.delete('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    console.log('تلقي طلب حذف موعد مع المعرف:', meetingId);

    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'المستخدم غير موجود' });
    }

    const meeting = user.meetings.id(meetingId);
    if (!meeting) {
      console.log('الموعد غير موجود للمعرف:', meetingId);
      return res.status(404).json({ message: 'الموعد غير موجود' });
    }

    user.meetings.pull(meetingId);
    await user.save();
    console.log('تم حذف الموعد، المواعيد المحدثة:', user.meetings);

    const formattedMeetings = user.meetings.map(meeting => ({
      _id: meeting._id,
      title: meeting.title,
      date: meeting.date.toISOString().split('T')[0],
      startTime: meeting.startTime,
      endTime: meeting.endTime
    }));

    res.json({ message: 'تم حذف الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    console.error('خطأ في حذف الموعد:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;