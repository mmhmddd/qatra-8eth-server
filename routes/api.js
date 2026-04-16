// api.js

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
import fs from 'fs';
import fsPromises from 'fs/promises';
import { existsSync } from 'fs';
import sendEmail from '../utils/email.js';
import validator from 'validator';
import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';
import handlebars from 'handlebars';
import logger from '../utils/logger.js';

const router = express.Router();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ════════════════════════════════════════════════
//  HELPER: purge expired messages from a user doc
//  Call this any time you load a user and may read
//  or display their messages. Saves only if changed.
// ════════════════════════════════════════════════
async function purgeExpiredMessages(user) {
  if (!Array.isArray(user.messages) || user.messages.length === 0) return;
  const now = new Date();
  const before = user.messages.length;
  user.messages = user.messages.filter(m => m.displayUntil > now);
  if (user.messages.length !== before) {
    await user.save();
  }
}

async function getResetEmailTemplate(data) {
  try {
    const templatePath = path.join(__dirname, '../reset-password-email.html');
    if (!existsSync(templatePath)) {
      throw new Error(`ملف القالب غير موجود في المسار: ${templatePath}`);
    }
    const source = await fsPromises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(source);
    const htmlContent = template(data);
    if (!htmlContent) throw new Error('فشل في إنشاء محتوى HTML من القالب');
    return htmlContent;
  } catch (error) {
    console.error('خطأ في قراءة أو تجميع القالب (إعادة تعيين):', error.message);
    throw error;
  }
}

async function getApprovalEmailTemplate(data) {
  try {
    const templatePath = path.join(__dirname, '../accept-email.html');
    if (!existsSync(templatePath)) {
      throw new Error(`ملف القالب غير موجود في المسار: ${templatePath}`);
    }
    const source = await fsPromises.readFile(templatePath, 'utf8');
    const template = handlebars.compile(source);
    const htmlContent = template(data);
    if (!htmlContent) throw new Error('فشل في إنشاء محتوى HTML من القالب');
    return htmlContent;
  } catch (error) {
    console.error('خطأ في قراءة أو تجميع القالب (موافقة):', error.message);
    throw error;
  }
}

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('يجب أن تكون الصورة بصيغة JPEG، PNG، GIF، أو WebP'));
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 1 }
});

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
    res.status(401).json({ message: 'رمز غير صالح' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (req.userRole !== 'admin') {
    logger.error({ action: 'UNAUTHORIZED_ADMIN_ACCESS', error: new Error('Not admin'), context: { userId: req.userId, path: req.path } });
    return res.status(403).json({ message: 'يجب أن تكون مسؤولاً للوصول إلى هذا الطريق' });
  }
  next();
};

// ════════════════════════════════════════════════
//               JOIN REQUESTS
// ════════════════════════════════════════════════
router.post('/join-requests', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, number, academicSpecialization, address, subjects } = req.body;
    if (!name || !email || !number || !academicSpecialization || !address) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، الرقم، التخصص الجامعي، والعنوان مطلوبة' });
    }
    if (!validator.isEmail(email)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingRequest = await JoinRequest.findOne({ email: normalizedEmail }).session(session);
    if (existingRequest) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'البريد الإلكتروني مستخدم بالفعل' });
    }

    const joinRequest = new JoinRequest({ name, email: normalizedEmail, number, academicSpecialization, address, subjects: subjects || [] });
    await joinRequest.save({ session });

    logger.joinRequestCreated({ requestId: joinRequest._id, email: normalizedEmail, name });

    await session.commitTransaction(); session.endSession();
    res.status(201).json({ message: 'تم تسجيل طلب الانضمام بنجاح', id: joinRequest._id });
  } catch (error) {
    logger.error({ action: 'JOIN_REQUEST_CREATE', error, context: { email: req.body?.email } });
    await session.abortTransaction(); session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.get('/join-requests', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const joinRequests = await JoinRequest.find();
    res.json(joinRequests);
  } catch (error) {
    logger.error({ action: 'JOIN_REQUEST_LIST', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               APPROVE JOIN REQUEST
// ════════════════════════════════════════════════
router.post('/join-requests/:id/approve', authMiddleware, adminMiddleware, async (req, res) => {
  req.setTimeout(120000);
  res.setTimeout(120000);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    console.log('🔵 Approval Request Started | ID:', req.params.id, '| admin:', req.userId);

    if (!process.env.RESEND_API_KEY) {
      await session.abortTransaction(); session.endSession();
      return res.status(500).json({ success: false, message: 'خطأ في إعدادات البريد الإلكتروني', error: 'RESEND_CONFIG_MISSING' });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: 'معرف الطلب غير صالح' });
    }

    if (mongoose.connection.readyState !== 1) {
      await session.abortTransaction(); session.endSession();
      return res.status(503).json({ success: false, message: 'قاعدة البيانات غير متاحة' });
    }

    const joinRequest = await Promise.race([
      JoinRequest.findById(req.params.id).session(session),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 30000))
    ]);

    if (!joinRequest) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    if (joinRequest.status !== 'Pending') {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: `الطلب تم معالجته مسبقًا`, currentStatus: joinRequest.status });
    }

    if (!validator.isEmail(joinRequest.email)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني للطلب غير صالح' });
    }

    joinRequest.status = 'Approved';
    joinRequest.volunteerHours = 0;
    await joinRequest.save({ session });

    const normalizedEmail = joinRequest.email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail }).session(session);
    let randomPassword = null;
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      randomPassword = crypto.randomBytes(8).toString('hex');
      const hashedPassword = await hash(randomPassword, 10);

      user = new User({
        email: normalizedEmail,
        password: hashedPassword,
        numberOfStudents: 0,
        subjects: joinRequest.subjects || [],
        students: [],
        meetings: [],
        lectures: [],
        lectureCount: 0,
        role: 'user',
        profileImage: null,
        profileImagePublicId: null,
        messages: []
      });
      await user.save({ session });

      logger.userCreated({
        email: normalizedEmail,
        userId: user._id,
        name: joinRequest.name,
        createdBy: `admin:${req.userId}`,
        requestId: joinRequest._id
      });
    } else {
      user.subjects = [...new Set([...user.subjects, ...(joinRequest.subjects || [])])];
      await user.save({ session });
      logger.userUpdated({ email: normalizedEmail, userId: user._id, changes: { subjects: 'merged' }, updatedBy: `admin:${req.userId}` });
    }

    logger.joinRequestApproved({
      requestId: joinRequest._id,
      email: normalizedEmail,
      name: joinRequest.name,
      approvedBy: req.userId,
      newUserId: user._id,
      isNewUser
    });

    await session.commitTransaction();
    session.endSession();

    const emailPromise = (async () => {
      try {
        const loginUrl = `${process.env.FRONTEND_URL || 'https://www.qatrah-ghaith.com'}/login`;
        const htmlContent = await getApprovalEmailTemplate({ name: joinRequest.name, email: joinRequest.email, password: randomPassword, loginUrl });
        await sendEmail({ to: joinRequest.email, subject: 'تم الموافقة على طلب الانضمام الخاص بك', html: htmlContent });
        console.log('✅ Email sent to:', joinRequest.email);
      } catch (emailError) {
        logger.error({ action: 'APPROVAL_EMAIL_SEND', error: emailError, context: { email: joinRequest.email } });
      }
    })();

    res.status(200).json({
      success: true,
      message: 'تم الموافقة على الطلب بنجاح',
      email: user.email,
      isNewUser,
      data: { userId: user._id, email: user.email, name: joinRequest.name }
    });

    emailPromise.catch(err => logger.error({ action: 'APPROVAL_EMAIL_ASYNC', error: err }));

  } catch (error) {
    logger.error({ action: 'JOIN_REQUEST_APPROVE', error, context: { requestId: req.params.id, adminId: req.userId } });
    try { if (session.inTransaction()) await session.abortTransaction(); session.endSession(); } catch {}

    let statusCode = 500;
    let errorMessage = 'خطأ في الخادم';
    if (error.message === 'Database query timeout') { statusCode = 504; errorMessage = 'انتهت مهلة الاتصال بقاعدة البيانات'; }
    else if (error.name === 'ValidationError') { statusCode = 400; errorMessage = 'بيانات غير صالحة'; }
    else if (error.code === 11000) { statusCode = 409; errorMessage = 'البريد الإلكتروني موجود بالفعل'; }

    return res.status(statusCode).json({ success: false, message: errorMessage });
  }
});

// ════════════════════════════════════════════════
//               REJECT JOIN REQUEST
// ════════════════════════════════════════════════
router.post('/join-requests/:id/reject', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const joinRequest = await JoinRequest.findById(req.params.id);
    if (!joinRequest) return res.status(404).json({ message: 'الطلب غير موجود' });
    if (joinRequest.status !== 'Pending') return res.status(400).json({ message: 'الطلب تم معالجته مسبقًا' });

    joinRequest.status = 'Rejected';
    await joinRequest.save();

    logger.joinRequestRejected({ requestId: joinRequest._id, email: joinRequest.email, name: joinRequest.name, rejectedBy: req.userId });

    res.json({ message: 'تم رفض الطلب' });
  } catch (error) {
    logger.error({ action: 'JOIN_REQUEST_REJECT', error, context: { requestId: req.params.id } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               DELETE MEMBER (+ USER)
// ════════════════════════════════════════════════
router.delete('/members/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const memberId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'معرف العضو غير صالح' });
    }

    const joinRequest = await JoinRequest.findById(memberId).session(session);
    if (!joinRequest) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'العضو غير موجود' }); }
    if (joinRequest.status !== 'Approved') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' }); }

    const user = await User.findOne({ email: joinRequest.email.toLowerCase().trim() }).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'حساب المستخدم غير موجود' }); }

    logger.memberDeleted({ memberId, email: joinRequest.email, name: joinRequest.name, deletedBy: req.userId });
    logger.userDeleted({ email: user.email, userId: user._id, name: joinRequest.name, deletedBy: `admin:${req.userId}`, reason: 'ADMIN_MEMBER_DELETE', requestId: memberId });

    if (user.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profileImagePublicId);
        logger.profileImageDeleted({ email: user.email, userId: user._id, publicId: user.profileImagePublicId, deletedBy: `admin:${req.userId}` });
      } catch (cloudinaryError) {
        logger.error({ action: 'CLOUDINARY_DELETE', error: cloudinaryError, context: { publicId: user.profileImagePublicId } });
      }
    }

    await JoinRequest.deleteOne({ _id: memberId }).session(session);
    await User.deleteOne({ email: joinRequest.email.toLowerCase().trim() }).session(session);

    await session.commitTransaction(); session.endSession();
    res.json({ message: 'تم حذف العضو بنجاح' });
  } catch (error) {
    logger.error({ action: 'MEMBER_DELETE', error, context: { memberId: req.params.id, adminId: req.userId } });
    await session.abortTransaction(); session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               DELETE JOIN REQUEST (standalone)
// ════════════════════════════════════════════════
router.delete('/join-requests/:id', authMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(requestId)) return res.status(400).json({ message: 'معرف الطلب غير صالح' });

    const joinRequest = await JoinRequest.findById(requestId);
    if (!joinRequest) return res.status(404).json({ message: 'الطلب غير موجود' });

    logger.joinRequestDeleted({ requestId: joinRequest._id, email: joinRequest.email, name: joinRequest.name, status: joinRequest.status, deletedBy: req.userId });

    await JoinRequest.deleteOne({ _id: requestId });
    res.json({ message: 'تم حذف طلب الانضمام بنجاح', deletedRequest: { id: joinRequest._id, name: joinRequest.name, email: joinRequest.email, status: joinRequest.status } });
  } catch (error) {
    logger.error({ action: 'JOIN_REQUEST_DELETE', error, context: { requestId: req.params.id } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               GET APPROVED MEMBERS
// ════════════════════════════════════════════════
router.get('/approved-members', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const membersWithDetails = await Promise.all(approvedMembers.map(async (member) => {
      const user = await User.findOne({ email: member.email.toLowerCase().trim() });

      if (!user) {
        logger.dbAnomaly({
          type: 'APPROVED_MEMBER_WITHOUT_USER_ACCOUNT',
          details: { memberId: member._id, email: member.email, name: member.name, approvedAt: member.updatedAt },
          severity: 'CRITICAL'
        });
      }

      // ✅ Purge expired messages without deleting the user
      if (user) await purgeExpiredMessages(user);

      const lecturesWithStudentNames = user?.lectures.map(lecture => ({
        ...lecture.toObject(),
        studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
      })) || [];

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
        meetings: user?.meetings || [],
        lectures: lecturesWithStudentNames,
        lectureCount: user?.lectureCount || 0,
        profileImage: user?.profileImage || null
      };
    }));
    res.json(membersWithDetails);
  } catch (error) {
    logger.error({ action: 'APPROVED_MEMBERS_LIST', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               GET MEMBER DETAILS
// ════════════════════════════════════════════════
router.get('/members/:id', authMiddleware, async (req, res) => {
  try {
    const member = await JoinRequest.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'العضو غير موجود' });

    const user = await User.findOne({ email: member.email.toLowerCase().trim() });

    if (!user && member.status === 'Approved') {
      logger.dbAnomaly({
        type: 'APPROVED_MEMBER_WITHOUT_USER_ACCOUNT',
        details: { memberId: member._id, email: member.email, name: member.name },
        severity: 'CRITICAL'
      });
    }

    // ✅ Purge expired messages without deleting the user
    if (user) await purgeExpiredMessages(user);

    const lecturesWithStudentNames = user?.lectures.map(lecture => ({
      ...lecture.toObject(),
      studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
    })) || [];

    res.json({
      success: true,
      member: {
        id: member._id, name: member.name, email: member.email, phone: member.number,
        address: member.address, academicSpecialization: member.academicSpecialization,
        volunteerHours: member.volunteerHours || 0, numberOfStudents: user?.numberOfStudents || 0,
        subjects: user?.subjects || [], students: user?.students || [], lectures: lecturesWithStudentNames,
        lectureCount: user?.lectureCount || 0, status: member.status, createdAt: member.createdAt,
        profileImage: user?.profileImage || null, messages: user?.messages || []
      }
    });
  } catch (error) {
    logger.error({ action: 'MEMBER_GET', error, context: { memberId: req.params.id } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               UPDATE MEMBER DETAILS
// ════════════════════════════════════════════════
router.put('/members/:id/update-details', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { volunteerHours, numberOfStudents, students, subjects } = req.body;

    if (volunteerHours === undefined || numberOfStudents === undefined || !Array.isArray(students) || !Array.isArray(subjects)) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: 'ساعات التطوع، عدد الطلاب، بيانات الطلاب، والمواد مطلوبة' });
    }

    const member = await JoinRequest.findById(req.params.id).session(session);
    if (!member) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'العضو غير موجود' }); }
    if (member.status !== 'Approved') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' }); }

    const user = await User.findOne({ email: member.email.toLowerCase().trim() }).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'حساب المستخدم غير موجود' }); }

    if (Array.isArray(user.lectures)) {
      const originalLectureCount = user.lectures.length;
      user.lectures = user.lectures.filter(l => l.studentEmail && validator.isEmail(l.studentEmail));
      const removedCount = originalLectureCount - user.lectures.length;
      if (removedCount > 0) {
        user.lectureCount = Math.max(0, user.lectureCount - removedCount);
        logger.dbAnomaly({ type: 'INVALID_LECTURES_CLEANED', details: { userId: user._id, email: user.email, removedCount }, severity: 'MEDIUM' });
      }
    }

    // ✅ Purge expired messages in-memory before saving (no TTL delete risk)
    if (Array.isArray(user.messages)) {
      const now = new Date();
      user.messages = user.messages.filter(m => m.displayUntil > now);
    }

    member.volunteerHours = volunteerHours;
    member.students = students.map(s => ({ ...s, email: s.email.toLowerCase().trim() }));
    member.subjects = subjects;
    user.numberOfStudents = numberOfStudents;
    user.students = students.map(s => ({ ...s, email: s.email.toLowerCase().trim() }));
    user.subjects = subjects;

    await Promise.all([member.save({ session }), user.save({ session })]);
    await session.commitTransaction(); session.endSession();

    logger.memberUpdated({ memberId: member._id, email: member.email, name: member.name, changes: { volunteerHours, numberOfStudents, studentsCount: students.length, subjects }, updatedBy: req.userId });

    res.json({ message: 'تم تحديث التفاصيل بنجاح', volunteerHours: member.volunteerHours, numberOfStudents: user.numberOfStudents, students: user.students, subjects: user.subjects });
  } catch (error) {
    logger.error({ action: 'MEMBER_UPDATE_DETAILS', error, context: { memberId: req.params.id } });
    await session.abortTransaction(); session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               ADD STUDENT
// ════════════════════════════════════════════════
router.post('/members/:id/add-student', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { name, email, phone, grade, subjects } = req.body;
    if (!name || !email || !phone) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'الاسم، البريد الإلكتروني، والهاتف مطلوبة للطالب' }); }
    if (!validator.isEmail(email)) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'البريد الإلكتروني للطالب غير صالح' }); }

    const member = await JoinRequest.findById(req.params.id).session(session);
    if (!member) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'العضو غير موجود' }); }
    if (member.status !== 'Approved') { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'يجب أن يكون العضو قد تمت الموافقة عليه' }); }

    const user = await User.findOne({ email: member.email.toLowerCase().trim() }).session(session);
    if (!user) { await session.abortTransaction(); session.endSession(); return res.status(404).json({ message: 'حساب المستخدم غير موجود' }); }

    if (user.students.length >= 50) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'لا يمكن إضافة المزيد من الطلاب، الحد الأقصى 50' }); }

    const normalizedEmail = email.toLowerCase().trim();
    if (!Array.isArray(user.students)) user.students = [];
    if (!Array.isArray(member.students)) member.students = [];
    if (user.students.some(s => s.email.toLowerCase() === normalizedEmail)) { await session.abortTransaction(); session.endSession(); return res.status(400).json({ message: 'البريد الإلكتروني للطالب مستخدم بالفعل' }); }

    const newStudent = { name, email: normalizedEmail, phone, grade, subjects: subjects ? subjects.map(s => ({ name: s.name.toLowerCase().trim(), minLectures: s.minLectures })) : [] };
    user.students.push(newStudent);
    member.students.push(newStudent);
    user.numberOfStudents = (user.numberOfStudents || 0) + 1;
    if (subjects) {
      const subjectNames = subjects.map(s => s.name.toLowerCase().trim());
      user.subjects = [...new Set([...user.subjects, ...subjectNames])];
      member.subjects = [...new Set([...member.subjects, ...subjectNames])];
    }
    member.volunteerHours = (member.volunteerHours || 0) + 1;

    await Promise.all([member.save({ session }), user.save({ session })]);
    await session.commitTransaction(); session.endSession();

    logger.studentAdded({ memberId: member._id, memberEmail: member.email, studentEmail: normalizedEmail, studentName: name });

    res.json({ message: 'تم إضافة الطالب بنجاح', student: newStudent, numberOfStudents: user.numberOfStudents, subjects: user.subjects });
  } catch (error) {
    logger.error({ action: 'STUDENT_ADD', error, context: { memberId: req.params.id } });
    await session.abortTransaction(); session.endSession();
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               LOGIN
// ════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress;
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'البريد الإلكتروني وكلمة المرور مطلوبان' });

    const normalizedEmail = email.toLowerCase().trim();
    if (!validator.isEmail(normalizedEmail)) return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      logger.loginFailed({ email: normalizedEmail, ip, reason: 'USER_NOT_FOUND' });
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      logger.loginFailed({ email: normalizedEmail, ip, reason: 'WRONG_PASSWORD' });
      return res.status(400).json({ message: 'بيانات تسجيل الدخول غير صحيحة' });
    }

    // ✅ Purge expired messages on login (safe, application-level)
    await purgeExpiredMessages(user);

    const token = sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

    logger.loginSuccess({ email: normalizedEmail, userId: user._id, ip, role: user.role });

    res.json({ token, userId: user._id, role: user.role });
  } catch (error) {
    logger.error({ action: 'LOGIN', error, context: { email: req.body?.email, ip } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               PROFILE
// ════════════════════════════════════════════════
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });

    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() });

    if (!joinRequest) {
      logger.dbAnomaly({ type: 'USER_WITHOUT_JOIN_REQUEST', details: { userId: user._id, email: user.email }, severity: 'HIGH' });
    }

    // ✅ Purge expired messages safely in application code
    await purgeExpiredMessages(user);

    const lecturesWithStudentNames = user.lectures.map(lecture => ({
      ...lecture.toObject(),
      studentName: user.students.find(s => s.email.toLowerCase() === lecture.studentEmail.toLowerCase())?.name || 'Unknown'
    }));

    res.json({
      success: true, message: 'تم جلب الملف الشخصي بنجاح',
      data: {
        user: { id: user._id, email: user.email, profileImage: user.profileImage || null, numberOfStudents: user.numberOfStudents || 0, subjects: user.subjects || [], students: user.students || [], meetings: user.meetings || [], lectures: lecturesWithStudentNames, lectureCount: user.lectureCount || 0, messages: user.messages || [] },
        joinRequest: joinRequest ? { name: joinRequest.name, phone: joinRequest.number, academicSpecialization: joinRequest.academicSpecialization, address: joinRequest.address, volunteerHours: joinRequest.volunteerHours || 0, status: joinRequest.status, students: joinRequest.students || [], subjects: joinRequest.subjects || [], lectures: lecturesWithStudentNames, lectureCount: user.lectureCount || 0 } : null
      }
    });
  } catch (error) {
    logger.error({ action: 'PROFILE_GET', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               CHANGE PASSWORD
// ════════════════════════════════════════════════
router.put('/profile/password', authMiddleware, async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress;
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'كلمة المرور الحالية والجديدة مطلوبة' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });

    const isMatch = await compare(currentPassword, user.password);
    if (!isMatch) {
      logger.loginFailed({ email: user.email, ip, reason: 'WRONG_CURRENT_PASSWORD_ON_CHANGE' });
      return res.status(400).json({ message: 'كلمة المرور الحالية غير صحيحة' });
    }

    user.password = await hash(newPassword, 10);
    await user.save();

    logger.passwordChanged({ email: user.email, userId: user._id, ip });

    res.json({ success: true, message: 'تم تحديث كلمة المرور بنجاح' });
  } catch (error) {
    logger.error({ action: 'PASSWORD_CHANGE', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               PROFILE IMAGE
// ════════════════════════════════════════════════
router.post('/profile/image', authMiddleware, upload.single('profileImage'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'يرجى اختيار صورة للرفع' });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

    if (user.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(user.profileImagePublicId);
        logger.profileImageDeleted({ email: user.email, userId: user._id, publicId: user.profileImagePublicId, deletedBy: `self:${user._id}` });
      } catch (deleteError) {
        logger.error({ action: 'CLOUDINARY_OLD_IMAGE_DELETE', error: deleteError });
      }
    }

    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder: 'profile_images', resource_type: 'image', transformation: [{ width: 500, height: 500, crop: 'limit' }, { quality: 'auto' }, { format: 'auto' }] }, (error, result) => {
        if (error) reject(error); else resolve(result);
      }).end(req.file.buffer);
    });

    user.profileImage = uploadResult.secure_url;
    user.profileImagePublicId = uploadResult.public_id;
    await user.save();

    logger.profileImageUploaded({ email: user.email, userId: user._id, publicId: uploadResult.public_id, url: uploadResult.secure_url });

    res.json({ success: true, message: 'تم رفع الصورة الشخصية بنجاح', data: { profileImage: uploadResult.secure_url, fileName: req.file.originalname, fileSize: req.file.size } });
  } catch (error) {
    logger.error({ action: 'PROFILE_IMAGE_UPLOAD', error, context: { userId: req.userId } });
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء رفع الصورة', error: error.message });
  }
});

router.delete('/profile/image', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    if (!user.profileImagePublicId) return res.status(400).json({ success: false, message: 'لا توجد صورة شخصية لحذفها' });

    try {
      await cloudinary.uploader.destroy(user.profileImagePublicId);
      logger.profileImageDeleted({ email: user.email, userId: user._id, publicId: user.profileImagePublicId, deletedBy: `self:${user._id}` });
    } catch (cloudinaryError) {
      logger.error({ action: 'CLOUDINARY_DELETE', error: cloudinaryError });
    }

    user.profileImage = null;
    user.profileImagePublicId = null;
    await user.save();
    res.json({ success: true, message: 'تم حذف الصورة الشخصية بنجاح' });
  } catch (error) {
    logger.error({ action: 'PROFILE_IMAGE_DELETE', error, context: { userId: req.userId } });
    res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء حذف الصورة', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               MEETINGS
// ════════════════════════════════════════════════
router.post('/profile/meetings', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime || !endTime) return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) return res.status(400).json({ message: 'صيغة التاريخ غير صالحة' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    if (!Array.isArray(user.meetings)) user.meetings = [];
    user.meetings.push({ title, date: parsedDate, startTime, endTime, reminded: false });
    await user.save();
    const formattedMeetings = user.meetings.map(m => ({ _id: m._id, title: m.title, date: m.date.toISOString().split('T')[0], startTime: m.startTime, endTime: m.endTime, reminded: m.reminded }));
    res.json({ message: 'تم إضافة الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    logger.error({ action: 'MEETING_ADD', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.put('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const { title, date, startTime, endTime } = req.body;
    const meetingId = req.params.meetingId;
    if (!title || !date || !startTime || !endTime) return res.status(400).json({ message: 'العنوان، التاريخ، وقت البدء، ووقت الانتهاء مطلوبة' });
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) return res.status(400).json({ message: 'صيغة التاريخ غير صالحة' });
    if (!mongoose.Types.ObjectId.isValid(meetingId)) return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const meeting = user.meetings.id(meetingId);
    if (!meeting) return res.status(404).json({ message: 'الموعد غير موجود' });
    meeting.title = title; meeting.date = parsedDate; meeting.startTime = startTime; meeting.endTime = endTime; meeting.reminded = false;
    await user.save();
    const formattedMeetings = user.meetings.map(m => ({ _id: m._id, title: m.title, date: m.date.toISOString().split('T')[0], startTime: m.startTime, endTime: m.endTime, reminded: m.reminded }));
    res.json({ message: 'تم تحديث الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    logger.error({ action: 'MEETING_UPDATE', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.delete('/profile/meetings/:meetingId', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const meeting = user.meetings.id(meetingId);
    if (!meeting) return res.status(404).json({ message: 'الموعد غير موجود' });
    user.meetings.pull(meetingId);
    await user.save();
    const formattedMeetings = user.meetings.map(m => ({ _id: m._id, title: m.title, date: m.date.toISOString().split('T')[0], startTime: m.startTime, endTime: m.endTime, reminded: m.reminded }));
    res.json({ message: 'تم حذف الموعد بنجاح', meetings: formattedMeetings });
  } catch (error) {
    logger.error({ action: 'MEETING_DELETE', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.post('/profile/meetings/:meetingId/remind', authMiddleware, async (req, res) => {
  try {
    const meetingId = req.params.meetingId;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) return res.status(400).json({ message: 'معرف الموعد غير صالح' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const meeting = user.meetings.id(meetingId);
    if (!meeting) return res.status(404).json({ message: 'الموعد غير موجود' });
    await sendEmail({ to: user.email, subject: 'تذكير يدوي بموعد اجتماع', text: `مرحبًا،\n\nهذا تذكير يدوي بموعدك "${meeting.title}" في ${meeting.date.toISOString().split('T')[0]} الساعة ${meeting.startTime}.\n\nتحياتنا,\nفريق قطرة غيث` });
    meeting.reminded = true;
    await user.save();
    const formattedMeetings = user.meetings.map(m => ({ _id: m._id, title: m.title, date: m.date.toISOString().split('T')[0], startTime: m.startTime, endTime: m.endTime, reminded: m.reminded }));
    res.json({ message: 'تم إرسال التذكير اليدوي بنجاح', meetings: formattedMeetings });
  } catch (error) {
    logger.error({ action: 'MEETING_REMIND', error, context: { userId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               FORGOT PASSWORD
// ════════════════════════════════════════════════
router.post('/forgot-password', async (req, res) => {
  req.setTimeout(60000); res.setTimeout(60000);
  const ip = req.ip || req.connection?.remoteAddress;
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'البريد الإلكتروني مطلوب' });
    if (!validator.isEmail(email)) return res.status(400).json({ success: false, message: 'البريد الإلكتروني غير صالح' });
    if (!process.env.RESEND_API_KEY) return res.status(500).json({ success: false, message: 'خطأ في إعدادات البريد الإلكتروني' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await Promise.race([
      User.findOne({ email: normalizedEmail }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 10000))
    ]);

    if (!user) return res.status(200).json({ success: true, message: 'إذا كان البريد الإلكتروني مسجلاً، سيتم إرسال رابط إعادة التعيين' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetToken = resetToken;
    user.tokenExpire = Date.now() + 3600000;
    await user.save();

    logger.passwordResetRequested({ email: normalizedEmail, ip });

    const frontendUrl = process.env.FRONTEND_URL || 'https://www.qatrah-ghaith.com';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    res.status(200).json({ success: true, message: 'تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' });

    (async () => {
      try {
        let htmlContent;
        try {
          htmlContent = await getResetEmailTemplate({ name: user.name || 'المستخدم', resetUrl });
        } catch {
          htmlContent = `<p>رابط إعادة التعيين: <a href="${resetUrl}">${resetUrl}</a></p>`;
        }
        await sendEmail({ to: normalizedEmail, subject: 'إعادة تعيين كلمة المرور - قطرة غيث', html: htmlContent });
      } catch (asyncEmailError) {
        logger.error({ action: 'FORGOT_PASSWORD_EMAIL', error: asyncEmailError, context: { email: normalizedEmail } });
        user.resetToken = null; user.tokenExpire = null;
        await user.save().catch(() => {});
      }
    })();

  } catch (error) {
    logger.error({ action: 'FORGOT_PASSWORD', error, context: { email: req.body?.email, ip } });
    const isTimeout = error.message?.includes('timeout');
    res.status(isTimeout ? 504 : 500).json({ success: false, message: isTimeout ? 'انتهت مهلة العملية' : 'خطأ في الخادم' });
  }
});

// ════════════════════════════════════════════════
//               ADMIN MESSAGES
// ════════════════════════════════════════════════
router.post('/admin/send-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, content, displayDays } = req.body;
    if (!userId || !content || !displayDays) return res.status(400).json({ message: 'معرف المستخدم، الرسالة، وعدد الأيام للعرض مطلوبة' });
    if (!mongoose.Types.ObjectId.isValid(userId)) return res.status(400).json({ message: 'معرف المستخدم غير صالح' });
    if (!validator.isLength(content, { min: 1, max: 1000 })) return res.status(400).json({ message: 'الرسالة يجب أن تكون بين 1 و1000 حرف' });
    if (!Number.isInteger(displayDays) || displayDays < 1 || displayDays > 30) return res.status(400).json({ message: 'عدد الأيام يجب أن يكون عددًا صحيحًا بين 1 و30' });

    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) return res.status(404).json({ message: 'المستخدم غير موجود' });

    // ✅ Purge expired messages before checking for active ones
    await purgeExpiredMessages(targetUser);

    const now = new Date();
    if (targetUser.messages?.length > 0) {
      const activeMessage = targetUser.messages.find(m => new Date(m.displayUntil) > now);
      if (activeMessage) return res.status(400).json({ message: 'يوجد رسالة نشطة بالفعل', activeMessage: { _id: activeMessage._id, content: activeMessage.content, displayUntil: activeMessage.displayUntil } });
    }

    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);
    const newMessage = { _id: new mongoose.Types.ObjectId(), content, displayUntil, createdAt: new Date() };
    targetUser.messages = [newMessage];
    await targetUser.save();
    res.json({ success: true, message: 'تم إرسال الرسالة بنجاح', data: { _id: newMessage._id, content: newMessage.content, displayUntil: newMessage.displayUntil } });
  } catch (error) {
    logger.error({ action: 'ADMIN_SEND_MESSAGE', error, context: { adminId: req.userId } });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.put('/admin/edit-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId, content, displayDays } = req.body;
    if (!userId || !messageId || !content || !displayDays) return res.status(400).json({ message: 'جميع الحقول مطلوبة' });
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({ message: 'معرف غير صالح' });
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const message = targetUser.messages.id(messageId);
    if (!message) return res.status(404).json({ message: 'الرسالة غير موجودة' });
    const displayUntil = new Date();
    displayUntil.setDate(displayUntil.getDate() + displayDays);
    message.content = content; message.displayUntil = displayUntil;
    await targetUser.save();
    res.json({ message: 'تم تعديل الرسالة بنجاح', displayUntil });
  } catch (error) {
    logger.error({ action: 'ADMIN_EDIT_MESSAGE', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.delete('/admin/delete-message', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId } = req.body;
    if (!userId || !messageId) return res.status(400).json({ message: 'معرف المستخدم ومعرف الرسالة مطلوبان' });
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({ message: 'معرف غير صالح' });
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const message = targetUser.messages.id(messageId);
    if (!message) return res.status(404).json({ message: 'الرسالة غير موجودة' });
    targetUser.messages.pull(messageId);
    await targetUser.save();
    res.json({ message: 'تم حذف الرسالة بنجاح' });
  } catch (error) {
    logger.error({ action: 'ADMIN_DELETE_MESSAGE', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.get('/admin/get-message/:userId/:messageId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId, messageId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId) || !mongoose.Types.ObjectId.isValid(messageId)) return res.status(400).json({ message: 'معرف غير صالح' });
    const joinRequest = await JoinRequest.findById(userId);
    if (!joinRequest) return res.status(404).json({ message: 'طلب الانضمام غير موجود' });
    const targetUser = await User.findOne({ email: joinRequest.email.toLowerCase().trim() });
    if (!targetUser) return res.status(404).json({ message: 'المستخدم غير موجود' });
    const message = targetUser.messages.id(messageId);
    if (!message) return res.status(404).json({ message: 'الرسالة غير موجودة' });
    if (new Date(message.displayUntil) < new Date()) return res.status(410).json({ message: 'الرسالة منتهية الصلاحية' });
    res.json({ success: true, message: { _id: message._id, content: message.content, displayUntil: message.displayUntil } });
  } catch (error) {
    logger.error({ action: 'ADMIN_GET_MESSAGE', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

router.get('/low-lecture-members', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const approvedMembers = await JoinRequest.find({ status: 'Approved' });
    const lowLectureMembers = [];
    for (const member of approvedMembers) {
      const user = await User.findOne({ email: member.email.toLowerCase().trim() });
      if (!user) continue;
      const lowLectureStudents = [];
      for (const student of user.students) {
        const lowLectureSubjects = [];
        for (const subject of student.subjects) {
          const lectureCount = user.lectures.filter(l => l.studentEmail.toLowerCase() === student.email.toLowerCase() && l.subject.toLowerCase() === subject.name.toLowerCase()).length;
          if (lectureCount < subject.minLectures) lowLectureSubjects.push({ name: subject.name, currentLectures: lectureCount, minLectures: subject.minLectures });
        }
        if (lowLectureSubjects.length > 0) lowLectureStudents.push({ studentEmail: student.email, studentName: student.name, subjects: lowLectureSubjects });
      }
      if (lowLectureStudents.length > 0) lowLectureMembers.push({ id: member._id, name: member.name, email: member.email, lowLectureStudents });
    }
    res.json(lowLectureMembers);
  } catch (error) {
    logger.error({ action: 'LOW_LECTURE_MEMBERS', error });
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

// ════════════════════════════════════════════════
//               ADMIN: VIEW LOGS ENDPOINT
// ════════════════════════════════════════════════
router.get('/admin/logs', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { type = 'all', lines = 200 } = req.query;
    const validTypes = ['all', 'users', 'deletes', 'errors', 'security'];
    if (!validTypes.includes(type)) return res.status(400).json({ message: 'نوع السجل غير صالح', validTypes });
    const recentLogs = logger.getRecentLogs(type, parseInt(lines));
    res.json({ success: true, type, count: recentLogs.length, logs: recentLogs });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
});

export default router;