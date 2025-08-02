import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import Leaderboard from '../models/Leaderboard.js';
import validator from 'validator';
import { calculateRankScore } from '../utils/leaderboardUtils.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../Uploads');

// Add a user to the leaderboard
export const addUserToLeaderboard = async (req, res) => {
  try {
    const { email, type, name, rank } = req.body;
    const image = req.file;

    // Validate input
    if (!email || !type) {
      return res.status(400).json({ message: 'البريد الإلكتروني والنوع مطلوبان' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }
    if (!['متطوع', 'قاده'].includes(type)) {
      return res.status(400).json({ message: 'النوع يجب أن يكون متطوع أو قاده' });
    }

    // Check if the user is already in the leaderboard
    const existingEntry = await Leaderboard.findOne({ email });
    if (existingEntry) {
      return res.status(400).json({ message: 'المستخدم موجود بالفعل في لوحة الصدارة' });
    }

    let leaderboardEntry;
    let user;
    let joinRequest;

    if (type === 'متطوع') {
      // For volunteers, fetch existing user details
      joinRequest = await JoinRequest.findOne({ email, status: 'Approved' });
      if (!joinRequest) {
        return res.status(404).json({ message: 'المتطوع غير موجود أو لم يتم الموافقة عليه' });
      }
      user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: 'حساب المتطوع غير موجود' });
      }

      // Use uploaded image if provided, otherwise fall back to User.profileImage
      const imagePath = image ? `/Uploads/${image.filename}` : user.profileImage || null;

      leaderboardEntry = new Leaderboard({
        email,
        type,
        name: joinRequest.name,
        image: imagePath,
      });

      // Update User.profileImage if a new image was uploaded
      if (image) {
        user.profileImage = imagePath;
        await user.save();
      }
    } else {
      // For leaders, require name, rank, and image
      if (!name || !rank || !image) {
        return res.status(400).json({ message: 'الاسم، الرتبة، والصورة مطلوبة للقادة' });
      }

      // Save image
      const imagePath = `/Uploads/${image.filename}`;
      leaderboardEntry = new Leaderboard({
        email,
        type,
        rank,
        name,
        image: imagePath,
      });

      // Create new user if not exists
      user = await User.findOne({ email });
      if (!user) {
        user = new User({
          email,
          name,
          role: 'leader',
          profileImage: imagePath,
        });
        await user.save();
      } else {
        // Update user with new image and name if exists
        user.name = name;
        user.profileImage = imagePath;
        user.role = 'leader';
        await user.save();
      }
    }

    await leaderboardEntry.save();

    // Calculate rank score
    const score = joinRequest ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

    // Prepare response
    const response = {
      id: leaderboardEntry._id,
      name: leaderboardEntry.name,
      email: leaderboardEntry.email,
      type: leaderboardEntry.type,
      rank: leaderboardEntry.rank || null,
      image: leaderboardEntry.image || null,
      volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
      numberOfStudents: user.numberOfStudents || 0,
      subjects: user.subjects || [],
      score,
    };

    res.status(201).json({
      message: 'تم إضافة المستخدم إلى لوحة الصدارة بنجاح',
      data: response,
    });
  } catch (error) {
    console.error('خطأ في إضافة المستخدم إلى لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Get the leaderboard
export const getLeaderboard = async (req, res) => {
  try {
    // Fetch all users in the Leaderboard collection
    const leaderboardUsers = await Leaderboard.find();
    if (!leaderboardUsers.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين في لوحة الصدارة' });
    }

    // Fetch user details and calculate ranks
    const leaderboard = await Promise.all(
      leaderboardUsers.map(async (entry) => {
        const joinRequest = await JoinRequest.findOne({ email: entry.email, status: 'Approved' });
        const user = await User.findOne({ email: entry.email });
        const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

        // Ensure image is fetched from the appropriate source
        let imagePath = entry.image;
        if (entry.type === 'متطوع' && user) {
          imagePath = user.profileImage || null; // Prefer User.profileImage for volunteers
        }

        return {
          id: entry._id,
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rank: entry.rank || null,
          image: imagePath,
          volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
          numberOfStudents: user ? user.numberOfStudents || 0 : 0,
          subjects: user ? user.subjects || [] : [],
          score,
        };
      })
    );

    // Filter out null entries
    const validLeaderboard = leaderboard.filter(entry => entry !== null);

    if (!validLeaderboard.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين صالحين في لوحة الصدارة' });
    }

    // Sort by score in descending order
    validLeaderboard.sort((a, b) => b.score - a.score);

    // Assign ranks
    const rankedLeaderboard = validLeaderboard.map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

    res.json({
      message: 'تم جلب لوحة الصدارة بنجاح',
      data: rankedLeaderboard,
    });
  } catch (error) {
    console.error('خطأ في جلب لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Edit a user in the leaderboard
export const editUserInLeaderboard = async (req, res) => {
  try {
    const { email, name, rank, volunteerHours, numberOfStudents, subjects } = req.body;
    const image = req.file;

    // Validate input
    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    // Check if the user exists in the Leaderboard
    let leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    // Update fields
    if (name) leaderboardEntry.name = name;
    if (leaderboardEntry.type === 'قاده' && rank) leaderboardEntry.rank = rank;

    // Handle image update
    if (image) {
      // Delete old image if exists
      if (leaderboardEntry.image) {
        const oldImagePath = path.join(__dirname, '..', leaderboardEntry.image);
        await fs.unlink(oldImagePath).catch(() => {});
      }
      leaderboardEntry.image = `/Uploads/${image.filename}`;

      // Update user image
      let user = await User.findOne({ email });
      if (user) {
        user.profileImage = `/Uploads/${image.filename}`;
        user.name = name || user.name;
        await user.save();
      }
    }

    // Update JoinRequest and User if provided
    let joinRequest = await JoinRequest.findOne({ email, status: 'Approved' });
    let user = await User.findOne({ email });

    if (volunteerHours !== undefined && joinRequest) {
      joinRequest.volunteerHours = volunteerHours;
    }
    if (subjects && Array.isArray(subjects)) {
      if (subjects.some(subject => typeof subject !== 'string' || subject.trim() === '')) {
        return res.status(400).json({ message: 'المواد يجب أن تكون قائمة من النصوص غير الفارغة' });
      }
      if (joinRequest) joinRequest.subjects = subjects;
      if (user) user.subjects = subjects;
    }
    if (numberOfStudents !== undefined && user) {
      user.numberOfStudents = numberOfStudents;
    }

    // Save changes
    await Promise.all([
      leaderboardEntry.save(),
      joinRequest ? joinRequest.save() : Promise.resolve(),
      user ? user.save() : Promise.resolve(),
    ]);

    // Calculate updated rank score
    const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

    // Prepare response
    const response = {
      id: leaderboardEntry._id,
      name: leaderboardEntry.name,
      email: leaderboardEntry.email,
      type: leaderboardEntry.type,
      rank: leaderboardEntry.rank || null,
      image: leaderboardEntry.image || null,
      volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
      numberOfStudents: user ? user.numberOfStudents || 0 : 0,
      subjects: user ? user.subjects || [] : [],
      score,
    };

    res.json({
      message: 'تم تحديث بيانات المستخدم في لوحة الصدارة بنجاح',
      data: response,
    });
  } catch (error) {
    console.error('خطأ في تحديث المستخدم في لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};

// Delete a user from the leaderboard
export const deleteUserFromLeaderboard = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    // Check if the user exists in the Leaderboard
    const leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    // Delete image if exists
    if (leaderboardEntry.image) {
      const imagePath = path.join(__dirname, '..', leaderboardEntry.image);
      await fs.unlink(imagePath).catch(() => {});
    }

    // Delete the user from the Leaderboard
    await Leaderboard.deleteOne({ email });

    res.json({
      message: 'تم حذف المستخدم من لوحة الصدارة بنجاح',
      email,
    });
  } catch (error) {
    console.error('خطأ في حذف المستخدم من لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};