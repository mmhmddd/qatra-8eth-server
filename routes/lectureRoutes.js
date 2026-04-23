// routes/lectureRoutes.js

import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import JoinRequest from '../models/JoinRequest.js';
import Notification from '../models/Notification.js';
import LowLectureReport from '../models/LowLectureReport.js';
import DriveLectureRequest from '../models/DriveLectureRequest.js';
import validator from 'validator';
import mongoose from 'mongoose';
import cron from 'node-cron';
import sendEmail from '../utils/email.js';

const router = express.Router();

// Middleware to verify JWT token
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    console.error('No authentication token provided');
    return res.status(401).json({ message: 'Access denied, please log in' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    console.log('Token verified:', { userId: req.userId, role: req.userRole });
    next();
  } catch (error) {
    console.error('Token verification error:', error.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (req.userRole !== 'admin') {
    console.error('Unauthorized access attempt:', req.userId);
    return res.status(403).json({ message: 'You must be an admin to access this route' });
  }
  next();
};

// Helper to safely convert a value to ISO string
const toISOStringSafe = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toISOString();
};

// Submit a lecture request
router.post('/', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { link, name, subject, studentEmail, lectureDate, duration } = req.body;

    // Validate input
    if (!link || !name || !subject || !studentEmail || !lectureDate || !duration) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Lecture link, name, subject, student email, date, and duration are required' });
    }
    if (!validator.isURL(link, { require_protocol: true })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid lecture link' });
    }
    if (!validator.isLength(name, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Lecture name must be between 1 and 100 characters' });
    }
    if (!validator.isLength(subject, { min: 1, max: 100 })) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Subject name must be between 1 and 100 characters' });
    }
    if (!validator.isEmail(studentEmail)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid student email' });
    }
    const parsedDate = new Date(lectureDate);
    if (isNaN(parsedDate.getTime())) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid lecture date' });
    }
    const parsedDuration = parseFloat(duration);
    if (isNaN(parsedDuration) || parsedDuration <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Duration must be a positive number' });
    }

    const normalizedStudentEmail = studentEmail.toLowerCase().trim();
    const user = await User.findById(req.userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      console.error('User not found:', req.userId);
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if student exists (case-insensitive)
    if (!Array.isArray(user.students) || !user.students.some(s => s.email.toLowerCase().trim() === normalizedStudentEmail)) {
      await session.abortTransaction();
      session.endSession();
      console.error('Student not found in user\'s students list:', normalizedStudentEmail);
      return res.status(400).json({ message: 'Student not found' });
    }

    // Create lecture request
    const lectureRequest = new DriveLectureRequest({
      userId: req.userId,
      link,
      name,
      subject,
      studentEmail: normalizedStudentEmail,
      lectureDate: parsedDate,
      duration: parsedDuration,
      createdAt: new Date()
    });
    await lectureRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log('Lecture request submitted successfully:', {
      userId: req.userId,
      link,
      name,
      subject,
      studentEmail: normalizedStudentEmail,
      lectureDate,
      duration
    });

    res.json({
      success: true,
      message: 'Lecture request submitted successfully',
      request: lectureRequest
    });
  } catch (error) {
    console.error('Error submitting lecture request:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Get all pending lecture requests (admin only)
router.get('/requests', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requests = await DriveLectureRequest.find({ status: 'pending' })
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    // Build the response array safely
    const requestsWithUserNames = await Promise.all(
      requests.map(async (item) => {
        try {
          // userId might be null if the user was deleted
          if (!item.userId) {
            return {
              _id: item._id ? item._id.toString() : '',
              link: item.link || '',
              name: item.name || '',
              subject: item.subject || '',
              studentEmail: item.studentEmail || '',
              lectureDate: toISOStringSafe(item.lectureDate),
              duration: item.duration || 0,
              createdAt: toISOStringSafe(item.createdAt),
              status: item.status || 'pending',
              adminNote: item.adminNote || '',
              user: {
                _id: '',
                name: 'Unknown',
                email: 'Unknown'
              }
            };
          }

          let userName = item.userId.name;

          // If user.name is missing, try fetching from JoinRequest
          if (!userName) {
            try {
              const joinRequest = await JoinRequest.findOne({
                email: item.userId.email ? item.userId.email.toLowerCase().trim() : ''
              }).lean();
              userName = joinRequest?.name || 'Unknown';
            } catch (joinErr) {
              console.warn('Could not fetch JoinRequest for user:', item.userId._id, joinErr.message);
              userName = 'Unknown';
            }
          }

          return {
            _id: item._id ? item._id.toString() : '',
            link: item.link || '',
            name: item.name || '',
            subject: item.subject || '',
            studentEmail: item.studentEmail || '',
            lectureDate: toISOStringSafe(item.lectureDate),
            duration: item.duration || 0,
            createdAt: toISOStringSafe(item.createdAt),
            status: item.status || 'pending',
            adminNote: item.adminNote || '',
            user: {
              _id: item.userId._id ? item.userId._id.toString() : '',
              name: userName,
              email: item.userId.email || ''
            }
          };
        } catch (itemErr) {
          console.error('Error processing request item:', item._id, itemErr.message);
          // Return a safe fallback instead of crashing the whole request
          return {
            _id: item._id ? item._id.toString() : '',
            link: item.link || '',
            name: item.name || '',
            subject: item.subject || '',
            studentEmail: item.studentEmail || '',
            lectureDate: toISOStringSafe(item.lectureDate),
            duration: item.duration || 0,
            createdAt: toISOStringSafe(item.createdAt),
            status: item.status || 'pending',
            adminNote: item.adminNote || '',
            user: {
              _id: '',
              name: 'Unknown',
              email: 'Unknown'
            }
          };
        }
      })
    );

    res.json({
      success: true,
      message: 'Pending lecture requests fetched successfully',
      requests: requestsWithUserNames
    });
  } catch (error) {
    console.error('Error fetching lecture requests:', error.message, error.stack);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Accept a lecture request (admin only)
router.post('/requests/accept/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const requestId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid request ID' });
    }

    const lectureRequest = await DriveLectureRequest.findById(requestId).populate('userId', 'email').session(session);
    if (!lectureRequest || lectureRequest.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pending lecture request not found' });
    }

    const user = await User.findById(lectureRequest.userId._id).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'User not found' });
    }

    const normalizedStudentEmail = lectureRequest.studentEmail;
    if (!Array.isArray(user.students) || !user.students.some(s => s.email.toLowerCase().trim() === normalizedStudentEmail)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Student not found' });
    }

    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() }).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Join request not found' });
    }

    // Initialize lectures array if undefined
    if (!Array.isArray(user.lectures)) user.lectures = [];

    // Create lecture
    const lecture = {
      link: lectureRequest.link,
      name: lectureRequest.name,
      subject: lectureRequest.subject,
      studentEmail: normalizedStudentEmail,
      createdAt: lectureRequest.createdAt,
      lectureDate: lectureRequest.lectureDate,
      duration: lectureRequest.duration
    };
    user.lectures.push(lecture);
    user.lectureCount = (user.lectureCount || 0) + 1;
    joinRequest.volunteerHours = (joinRequest.volunteerHours || 0) + 1;

    // Delete related low lecture count notifications
    await Notification.deleteMany(
      {
        userId: user._id,
        type: 'low_lecture_count_per_subject',
        'lectureDetails.subject': lectureRequest.subject,
        'lectureDetails.studentEmail': normalizedStudentEmail
      },
      { session }
    );

    // Create notification
    const notification = new Notification({
      userId: user._id,
      message: `New lecture added by ${user.email}: ${lectureRequest.name} (${lectureRequest.subject}) - ${lectureRequest.link}`,
      type: 'lecture_added',
      lectureDetails: { link: lectureRequest.link, name: lectureRequest.name, subject: lectureRequest.subject, studentEmail: normalizedStudentEmail }
    });
    await notification.save({ session });

    // Update request status
    lectureRequest.status = 'accepted';
    lectureRequest.adminActionAt = new Date();
    await lectureRequest.save({ session });

    // Save changes
    await Promise.all([user.save({ session }), joinRequest.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    // Send email to user (non-blocking)
    sendEmail({
      to: user.email,
      subject: 'Lecture Request Accepted',
      html: `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; direction: rtl; text-align: right; }
    .content { padding: 24px; background-color: #ffffff; border-radius: 16px; margin: 16px; border: 2px solid #000000; }
    h2 { color: #333; font-size: 24px; margin: 0 0 16px; }
    p { color: #555; font-size: 16px; line-height: 1.6; }
    ul { list-style: none; padding: 0; margin: 16px 0; }
    li { margin-bottom: 12px; font-size: 14px; }
    .footer { background-color: #f4f4f4; padding: 12px 16px; font-size: 11px; text-align: center; color: #555; }
  </style>
</head>
<body dir="rtl">
  <div class="content">
    <h2>تم قبول طلب المحاضرة</h2>
    <p>تم قبول محاضرتك "${lectureRequest.name}" من قبل الإدارة.</p>
    <p>التفاصيل:</p>
    <ul>
      <li><strong>المادة:</strong> ${lectureRequest.subject}</li>
      <li><strong>بريد الطالب:</strong> ${lectureRequest.studentEmail}</li>
      <li><strong>التاريخ:</strong> ${toISOStringSafe(lectureRequest.lectureDate)?.split('T')[0] || ''}</li>
      <li><strong>المدة:</strong> ${lectureRequest.duration} ساعات</li>
    </ul>
    <p>شكراً لمساهمتك!</p>
  </div>
  <div class="footer"><p>© 2025 جميع الحقوق محفوظة: قطرة غيث</p></div>
</body>
</html>`
    }).catch(err => console.error('Email send error (accept):', err.message));

    console.log('Lecture request accepted successfully:', { requestId, userId: user._id });

    res.json({
      success: true,
      message: 'Lecture request accepted successfully',
      lecture,
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
  } catch (error) {
    console.error('Error accepting lecture request:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Reject a lecture request (admin only)
router.post('/requests/reject/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const requestId = req.params.id;
    const { note } = req.body;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid request ID' });
    }

    const lectureRequest = await DriveLectureRequest.findById(requestId).populate('userId', 'email').session(session);
    if (!lectureRequest || lectureRequest.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Pending lecture request not found' });
    }

    // Update request status
    lectureRequest.status = 'rejected';
    lectureRequest.adminActionAt = new Date();
    lectureRequest.adminNote = note || '';
    await lectureRequest.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Send email to user (non-blocking)
    const userEmail = lectureRequest.userId?.email;
    if (userEmail) {
      sendEmail({
        to: userEmail,
        subject: 'Lecture Request Rejected',
        html: `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; direction: rtl; text-align: right; }
    .content { padding: 24px; background-color: #ffffff; border-radius: 16px; margin: 16px; border: 2px solid #000000; }
    h2 { color: #333; font-size: 24px; margin: 0 0 16px; }
    p { color: #555; font-size: 16px; line-height: 1.6; }
    ul { list-style: none; padding: 0; margin: 16px 0; }
    li { margin-bottom: 12px; font-size: 14px; }
    .footer { background-color: #f4f4f4; padding: 12px 16px; font-size: 11px; text-align: center; color: #555; }
  </style>
</head>
<body dir="rtl">
  <div class="content">
    <h2>تم رفض طلب المحاضرة</h2>
    <p>تم رفض محاضرتك "${lectureRequest.name}" من قبل الإدارة.</p>
    ${note ? `<p>السبب: ${note}</p>` : ''}
    <p>التفاصيل:</p>
    <ul>
      <li><strong>المادة:</strong> ${lectureRequest.subject}</li>
      <li><strong>بريد الطالب:</strong> ${lectureRequest.studentEmail}</li>
      <li><strong>التاريخ:</strong> ${toISOStringSafe(lectureRequest.lectureDate)?.split('T')[0] || ''}</li>
      <li><strong>المدة:</strong> ${lectureRequest.duration} ساعات</li>
    </ul>
    <p>يرجى الاتصال بالإدارة لمزيد من التفاصيل.</p>
  </div>
  <div class="footer"><p>© 2025 جميع الحقوق محفوظة: قطرة غيث</p></div>
</body>
</html>`
      }).catch(err => console.error('Email send error (reject):', err.message));
    }

    console.log('Lecture request rejected successfully:', { requestId });

    res.json({
      success: true,
      message: 'Lecture request rejected successfully'
    });
  } catch (error) {
    console.error('Error rejecting lecture request:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Delete a lecture request (admin only)
router.delete('/requests/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const requestId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
      return res.status(400).json({ message: 'Invalid request ID' });
    }

    const lectureRequest = await DriveLectureRequest.findByIdAndDelete(requestId);
    if (!lectureRequest) {
      return res.status(404).json({ message: 'Lecture request not found' });
    }

    console.log('Lecture request deleted successfully:', { requestId });

    res.json({
      success: true,
      message: 'Lecture request deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting lecture request:', error.message);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Delete a lecture (admin only)
router.delete('/:lectureId', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const lectureId = req.params.lectureId;
    if (!mongoose.Types.ObjectId.isValid(lectureId)) {
      await session.abortTransaction();
      session.endSession();
      console.error('Invalid lecture ID:', lectureId);
      return res.status(400).json({
        success: false,
        message: 'Invalid lecture ID'
      });
    }

    const user = await User.findOne({ 'lectures._id': lectureId }).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      console.error('Lecture not found:', lectureId);
      return res.status(404).json({ message: 'Lecture not found' });
    }

    const lecture = user.lectures.id(lectureId);
    if (!lecture) {
      await session.abortTransaction();
      session.endSession();
      console.error('Lecture not found:', lectureId);
      return res.status(404).json({ message: 'Lecture not found' });
    }

    const joinRequest = await JoinRequest.findOne({ email: user.email.toLowerCase().trim() }).session(session);
    if (!joinRequest) {
      await session.abortTransaction();
      session.endSession();
      console.error('Join request not found for user:', user.email);
      return res.status(404).json({ message: 'Join request not found' });
    }

    user.lectures.pull(lectureId);
    user.lectureCount = Math.max(0, (user.lectureCount || 1) - 1);
    joinRequest.volunteerHours = Math.max(0, (joinRequest.volunteerHours || 2) - 2);

    await Promise.all([user.save({ session }), joinRequest.save({ session })]);

    await session.commitTransaction();
    session.endSession();

    console.log('Lecture deleted successfully:', { lectureId, userId: user._id, lectureCount: user.lectureCount });
    res.json({
      success: true,
      message: 'Lecture deleted successfully',
      lectureCount: user.lectureCount,
      volunteerHours: joinRequest.volunteerHours
    });
  } catch (error) {
    console.error('Error deleting lecture:', error.message);
    await session.abortTransaction();
    session.endSession();
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Delete low lecture member
router.delete('/low-lecture-members/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      session.endSession();
      console.error('Invalid member ID:', id);
      return res.status(400).json({
        success: false,
        message: 'Invalid member ID'
      });
    }

    const now = new Date();
    const dayOfWeek = now.getDay();
    let daysToPreviousSaturday = (dayOfWeek + 1) % 7;
    if (daysToPreviousSaturday === 0) daysToPreviousSaturday = 7;

    const previousSaturday = new Date(now);
    previousSaturday.setDate(now.getDate() - daysToPreviousSaturday);

    const weekStart = new Date(previousSaturday);
    weekStart.setDate(previousSaturday.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(previousSaturday);
    weekEnd.setDate(previousSaturday.getDate() - 1);
    weekEnd.setHours(23, 59, 59, 999);

    console.log('Attempting to find report for week:', { weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() });

    let report = await LowLectureReport.findOne({ weekStart }).session(session);

    if (!report) {
      console.log('No report found for previous week, generating new report:', { weekStart: weekStart.toISOString() });
      const result = await checkLowLectureMembers(false, session);
      console.log('Generated report result:', {
        success: result.success,
        message: result.message,
        memberCount: result.members.length
      });

      report = await LowLectureReport.findOne({ weekStart }).session(session);
      if (!report || report.members.length === 0) {
        await session.abortTransaction();
        session.endSession();
        console.warn('No members with low lectures found for week:', { weekStart, weekEnd });
        return res.status(404).json({
          success: false,
          message: 'No members with low lecture counts found for the specified week'
        });
      }
    }

    const initialLength = report.members.length;
    report.members = report.members.filter(member => member._id.toString() !== id);

    if (report.members.length === initialLength) {
      await session.abortTransaction();
      session.endSession();
      console.error('Member not found in low lecture report:', { memberId: id });
      return res.status(404).json({
        success: false,
        message: 'Member not found in low lecture report'
      });
    }

    report.membersWithLowLectures = report.members.length;
    await report.save({ session });

    await session.commitTransaction();
    session.endSession();

    console.log(`Member ${id} successfully removed from LowLectureReport`);
    return res.status(200).json({
      success: true,
      message: 'Member successfully removed from this week\'s low lecture report'
    });
  } catch (error) {
    console.error('Error removing member from LowLectureReport:', {
      memberId: req.params.id,
      error: error.message
    });
    try {
      await session.abortTransaction();
    } catch (_) {}
    session.endSession();
    return res.status(500).json({
      success: false,
      message: 'Internal server error. Please try again later.',
      error: error.message
    });
  }
});

// Get low lecture members
router.get('/low-lecture-members', authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    let daysToPreviousSaturday = (dayOfWeek + 1) % 7;
    if (daysToPreviousSaturday === 0) daysToPreviousSaturday = 7;

    const previousSaturday = new Date(now);
    previousSaturday.setDate(now.getDate() - daysToPreviousSaturday);

    const weekStart = new Date(previousSaturday);
    weekStart.setDate(previousSaturday.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(previousSaturday);
    weekEnd.setDate(previousSaturday.getDate() - 1);
    weekEnd.setHours(23, 59, 59, 999);

    console.log('Fetching report for week:', { weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString() });

    let report = await LowLectureReport.findOne({ weekStart })
      .sort({ createdAt: -1 })
      .session(session);

    if (!report) {
      console.log('No report found, generating new report:', { weekStart: weekStart.toISOString() });
      const result = await checkLowLectureMembers(false, session);
      console.log('Generated report result:', {
        success: result.success,
        message: result.message,
        memberCount: result.members.length
      });

      report = await LowLectureReport.findOne({ weekStart }).session(session);
      if (!report) {
        await session.commitTransaction();
        session.endSession();
        return res.json({
          success: true,
          message: 'All members meet the minimum weekly lecture requirements',
          members: [],
          debug: {
            totalUsersProcessed: result.debug.totalUsersProcessed,
            weekStart: weekStart.toISOString(),
            weekEnd: weekEnd.toISOString(),
            membersWithLowLectures: 0
          }
        });
      }
    }

    await session.commitTransaction();
    session.endSession();
    console.log('Returning low lecture report:', { weekStart: weekStart.toISOString(), memberCount: report.members.length });

    return res.json({
      success: true,
      message: report.members.length > 0
        ? `Found ${report.members.length} members with low lecture counts`
        : 'All members meet the minimum weekly lecture requirements',
      members: report.members,
      debug: {
        totalUsersProcessed: report.totalUsersProcessed,
        weekStart: report.weekStart.toISOString(),
        weekEnd: report.weekEnd.toISOString(),
        membersWithLowLectures: report.membersWithLowLectures
      }
    });
  } catch (error) {
    console.error('Error in low-lecture-members:', error.message, error.stack);
    try {
      await session.abortTransaction();
    } catch (_) {}
    session.endSession();
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Function to check low lecture members
async function checkLowLectureMembers(isCronJob = false, session = null) {
  const localSession = session || await mongoose.startSession();
  if (!session) localSession.startTransaction();
  try {
    const users = await User.find({ role: 'user' }).session(localSession);
    console.log('📊 Found users with role "user":', users.length);

    const lowLectureMembers = [];

    const now = new Date();
    const dayOfWeek = now.getDay();
    let daysToPreviousSaturday = (dayOfWeek + 1) % 7;
    if (daysToPreviousSaturday === 0) daysToPreviousSaturday = 7;

    const previousSaturday = new Date(now);
    previousSaturday.setDate(now.getDate() - daysToPreviousSaturday);

    const weekStart = new Date(previousSaturday);
    weekStart.setDate(previousSaturday.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(previousSaturday);
    weekEnd.setDate(previousSaturday.getDate() - 1);
    weekEnd.setHours(23, 59, 59, 999);

    console.log('📅 Checking lectures from:', weekStart.toISOString(), 'to', weekEnd.toISOString());

    for (const user of users) {
      console.log('👤 Processing user:', { userId: user._id.toString(), email: user.email });

      const joinRequest = await JoinRequest.findOne({
        email: user.email.toLowerCase().trim(),
        status: 'Approved'
      }).session(localSession);
      if (!joinRequest) {
        console.log('⏩ Skipping user - No approved join request:', { userId: user._id.toString(), email: user.email });
        if (isCronJob && user.lowLectureWeekCount > 0) {
          user.lowLectureWeekCount = 0;
          user.lastLowLectureWeek = null;
          await user.save({ session: localSession });
        }
        continue;
      }

      if (!Array.isArray(user.students) || user.students.length === 0) {
        console.log('⏩ Skipping user - No students:', { userId: user._id.toString(), email: user.email });
        if (isCronJob && user.lowLectureWeekCount > 0) {
          user.lowLectureWeekCount = 0;
          user.lastLowLectureWeek = null;
          await user.save({ session: localSession });
        }
        continue;
      }

      console.log('👥 User has students:', user.students.length);
      const userUnderTargetStudents = [];

      for (const student of user.students) {
        if (!Array.isArray(student.subjects) || student.subjects.length === 0) {
          console.log('⚠️ Student has no subjects:', { studentEmail: student.email });
          continue;
        }

        const studentUnderTargetSubjects = [];

        for (const subject of student.subjects) {
          if (!Array.isArray(user.lectures)) user.lectures = [];

          const lectureCount = user.lectures.filter(lecture => {
            const lectureTime = lecture.lectureDate || lecture.createdAt;
            const matchesTimeFrame = lectureTime >= weekStart && lectureTime <= weekEnd;
            const matchesStudent = lecture.studentEmail?.toLowerCase().trim() === student.email.toLowerCase().trim();
            const matchesSubject = lecture.subject === subject.name;
            return matchesTimeFrame && matchesStudent && matchesSubject;
          }).length;

          if (lectureCount < subject.minLectures) {
            studentUnderTargetSubjects.push({
              name: subject.name,
              minLectures: subject.minLectures,
              deliveredLectures: lectureCount
            });

            if (isCronJob) {
              const notificationExists = await Notification.findOne({
                userId: user._id,
                type: 'low_lecture_count_per_subject',
                'lectureDetails.subject': subject.name,
                'lectureDetails.studentEmail': student.email.toLowerCase().trim()
              }).session(localSession);

              if (!notificationExists) {
                const notification = new Notification({
                  userId: user._id,
                  message: `Weekly lectures for student ${student.name} in subject ${subject.name} are below the minimum (${lectureCount}/${subject.minLectures})`,
                  type: 'low_lecture_count_per_subject',
                  lectureDetails: {
                    studentEmail: student.email.toLowerCase().trim(),
                    subject: subject.name,
                    minLectures: subject.minLectures,
                    currentLectures: lectureCount
                  }
                });
                await notification.save({ session: localSession });
              }
            }
          }
        }

        if (studentUnderTargetSubjects.length > 0) {
          userUnderTargetStudents.push({
            studentName: student.name || 'Name not available',
            studentEmail: student.email.toLowerCase().trim(),
            academicLevel: student.academicLevel || 'غير محدد',
            underTargetSubjects: studentUnderTargetSubjects
          });
        }
      }

      if (userUnderTargetStudents.length > 0) {
        console.log(`Adding user ${user.email} to low lecture members with ${userUnderTargetStudents.length} students`);

        if (isCronJob && (!user.lastLowLectureWeek || user.lastLowLectureWeek < weekStart)) {
          user.lowLectureWeekCount = (user.lowLectureWeekCount || 0) + 1;
          user.lastLowLectureWeek = weekStart;
          await user.save({ session: localSession });
        }

        lowLectureMembers.push({
          _id: user._id.toString(),
          name: joinRequest.name || user.email,
          email: user.email,
          lowLectureWeekCount: user.lowLectureWeekCount,
          underTargetStudents: userUnderTargetStudents,
          lectures: user.lectures.map(lecture => ({
            _id: lecture._id ? lecture._id.toString() : '',
            name: lecture.name,
            subject: lecture.subject,
            studentEmail: lecture.studentEmail,
            link: lecture.link,
            createdAt: toISOStringSafe(lecture.createdAt),
            lectureDate: toISOStringSafe(lecture.lectureDate || lecture.createdAt),
            duration: lecture.duration || 1
          }))
        });
      } else {
        console.log(`User ${user.email} meets all requirements`);
        if (isCronJob && user.lowLectureWeekCount > 0) {
          user.lowLectureWeekCount = 0;
          user.lastLowLectureWeek = null;
          await user.save({ session: localSession });
        }
      }
    }

    const report = new LowLectureReport({
      weekStart,
      weekEnd,
      members: lowLectureMembers,
      totalUsersProcessed: users.length,
      membersWithLowLectures: lowLectureMembers.length,
      createdAt: new Date()
    });
    try {
      await report.save({ session: localSession });
      console.log('Saved low lecture report:', { weekStart: weekStart.toISOString(), members: lowLectureMembers.length });
    } catch (error) {
      if (error.code === 11000 && error.keyPattern && error.keyPattern.weekStart) {
        console.warn('Duplicate key error in checkLowLectureMembers, updating existing report');
        await LowLectureReport.updateOne(
          { weekStart },
          {
            $set: {
              weekEnd,
              members: lowLectureMembers,
              totalUsersProcessed: users.length,
              membersWithLowLectures: lowLectureMembers.length,
              createdAt: new Date()
            }
          },
          { session: localSession }
        );
      } else {
        throw error;
      }
    }

    if (!session) {
      await localSession.commitTransaction();
      localSession.endSession();
    }

    console.log(`Final results: ${lowLectureMembers.length} members with low lecture counts`);

    return {
      success: true,
      message: lowLectureMembers.length > 0
        ? `Found ${lowLectureMembers.length} members with low lecture counts`
        : 'All members meet the minimum weekly lecture requirements',
      members: lowLectureMembers,
      debug: {
        totalUsersProcessed: users.length,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        membersWithLowLectures: lowLectureMembers.length
      }
    };
  } catch (error) {
    console.error('Error in checkLowLectureMembers:', error.message, error.stack);
    if (!session) {
      try {
        await localSession.abortTransaction();
      } catch (_) {}
      localSession.endSession();
    }
    throw error;
  }
}

// Get notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 })
      .lean();

    console.log('Notifications fetched for user:', { userId: req.userId, count: notifications.length });

    res.json({
      success: true,
      message: 'Notifications fetched successfully',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: toISOStringSafe(notification.createdAt),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('Error fetching notifications:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
});

// Mark notifications as read
router.post('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.userId, read: false },
      { $set: { read: true } }
    );

    const notifications = await Notification.find({ userId: req.userId })
      .populate('userId', 'email')
      .sort({ createdAt: -1 })
      .lean();

    console.log('Notifications marked as read:', { userId: req.userId, modifiedCount: result.modifiedCount });

    res.json({
      success: true,
      message: 'Notifications marked as read',
      notifications: notifications.map(notification => ({
        _id: notification._id.toString(),
        userId: {
          _id: notification.userId._id.toString(),
          email: notification.userId.email
        },
        message: notification.message,
        type: notification.type,
        createdAt: toISOStringSafe(notification.createdAt),
        read: notification.read,
        lectureDetails: notification.lectureDetails
      }))
    });
  } catch (error) {
    console.error('Error marking notifications as read:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error marking notifications as read',
      error: error.message
    });
  }
});

// Delete a specific notification
router.delete('/notifications/:id', authMiddleware, async (req, res) => {
  try {
    const notificationId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      console.error('Invalid notification ID:', notificationId);
      return res.status(400).json({ success: false, message: 'Invalid notification ID' });
    }

    const notification = await Notification.findOne({ _id: notificationId, userId: req.userId });
    if (!notification) {
      console.error('Notification not found or does not belong to user:', { notificationId, userId: req.userId });
      return res.status(404).json({ success: false, message: 'Notification not found or does not belong to user' });
    }

    await Notification.deleteOne({ _id: notificationId });

    console.log('Notification deleted successfully:', { notificationId, userId: req.userId });

    res.json({ success: true, message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Error deleting notification:', error.message);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Schedule the weekly check
cron.schedule('0 0 * * 6', async () => {
  console.log('Starting weekly low lecture check...');
  try {
    await checkLowLectureMembers(true);
    console.log('Weekly check completed successfully.');
  } catch (error) {
    console.error('Error in weekly cron job:', error);
  }
}, {
  timezone: 'Asia/Riyadh'
});

export default router;