import JoinRequest from '../models/JoinRequest.js';
import User from '../models/User.js';
import Leaderboard from '../models/Leaderboard.js';
import validator from 'validator';
import { calculateRankScore } from '../utils/leaderboardUtils.js';

export const addUserToLeaderboard = async (req, res) => {
  try {
    const { email, type, name, rank } = req.body;

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

      leaderboardEntry = new Leaderboard({
        email,
        type,
        name: joinRequest.name,
        image: user.profileImage || null
      });
    } else {
      // For leaders, require name and rank
      if (!name || !rank) {
        return res.status(400).json({ message: 'الاسم والرتبة مطلوبة للقادة' });
      }

      leaderboardEntry = new Leaderboard({
        email,
        type,
        rank,
        name,
        image: null
      });

      // Create or update user
      user = await User.findOne({ email });
      if (!user) {
        user = new User({
          email,
          name,
          role: 'leader'
        });
        await user.save();
      } else {
        user.name = name;
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
      numberOfStudents: user ? user.numberOfStudents || 0 : 0,
      subjects: user ? user.subjects || [] : [],
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

export const getLeaderboard = async (req, res) => {
  try {
    const leaderboardUsers = await Leaderboard.find();
    if (!leaderboardUsers.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين في لوحة الصدارة' });
    }

    const leaderboard = await Promise.all(
      leaderboardUsers.map(async (entry) => {
        const joinRequest = await JoinRequest.findOne({ email: entry.email, status: 'Approved' });
        const user = await User.findOne({ email: entry.email });
        const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

        let imageUrl = entry.image;
        if (entry.type === 'متطوع' && user) {
          imageUrl = user.profileImage || null;
        }

        return {
          id: entry._id,
          name: entry.name,
          email: entry.email,
          type: entry.type,
          rank: entry.rank || null,
          image: imageUrl,
          volunteerHours: joinRequest ? joinRequest.volunteerHours || 0 : 0,
          numberOfStudents: user ? user.numberOfStudents || 0 : 0,
          subjects: user ? user.subjects || [] : [],
          score,
        };
      })
    );

    const validLeaderboard = leaderboard.filter(entry => entry !== null);

    if (!validLeaderboard.length) {
      return res.status(404).json({ message: 'لا يوجد مستخدمين صالحين في لوحة الصدارة' });
    }

    validLeaderboard.sort((a, b) => b.score - a.score);

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

export const editUserInLeaderboard = async (req, res) => {
  try {
    const { email, name, rank, volunteerHours, numberOfStudents, subjects } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    let leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    if (name) leaderboardEntry.name = name;
    if (leaderboardEntry.type === 'قاده' && rank) leaderboardEntry.rank = rank;

    let joinRequest = await JoinRequest.findOne({ email, status: 'Approved' });
    let user = await User.findOne({ email });

    if (volunteerHours !== undefined && joinRequest) {
      joinRequest.volunteerHours = volunteerHours;
    }
    if (subjects) {
      if (!Array.isArray(subjects) || subjects.some(subject => typeof subject !== 'string' || subject.trim() === '')) {
        return res.status(400).json({ message: 'المواد يجب أن تكون قائمة من النصوص غير الفارغة' });
      }
      if (joinRequest) joinRequest.subjects = subjects;
      if (user) user.subjects = subjects;
    }
    if (numberOfStudents !== undefined && user) {
      user.numberOfStudents = numberOfStudents;
    }

    await Promise.all([
      leaderboardEntry.save(),
      joinRequest ? joinRequest.save() : Promise.resolve(),
      user ? user.save() : Promise.resolve(),
    ]);

    const score = joinRequest && user ? calculateRankScore(joinRequest.volunteerHours, user.numberOfStudents) : 0;

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

export const deleteUserFromLeaderboard = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'البريد الإلكتروني مطلوب' });
    }
    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'البريد الإلكتروني غير صالح' });
    }

    const leaderboardEntry = await Leaderboard.findOne({ email });
    if (!leaderboardEntry) {
      return res.status(404).json({ message: 'المستخدم غير موجود في لوحة الصدارة' });
    }

    await Leaderboard.deleteOne({ email });

    res.json({
      message: 'تم حذف المستخدم من لوحة الصدارة بنجاح',
      data: { email }
    });
  } catch (error) {
    console.error('خطأ في حذف المستخدم من لوحة الصدارة:', error);
    res.status(500).json({ message: 'خطأ في الخادم', error: error.message });
  }
};