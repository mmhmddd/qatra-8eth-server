import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
// تحميل متغيرات البيئة
dotenv.config();

// الاتصال بقاعدة البيانات
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('تم الاتصال بقاعدة البيانات بنجاح');
  } catch (error) {
    console.error('خطأ في الاتصال بقاعدة البيانات:', error);
    process.exit(1);
  }
};

// دالة لتحديث المستخدم إلى مشرف
const makeUserAdmin = async (email) => {
  try {
    // البحث عن المستخدم بالبريد الإلكتروني
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`لم يتم العثور على مستخدم بالبريد الإلكتروني: ${email}`);
      return;
    }

    // تحديث حقل role إلى 'admin'
    user.role = 'admin';
    await user.save();

    console.log(`تم تحويل المستخدم ${email} إلى مشرف بنجاح!`);
  } catch (error) {
    console.error('خطأ أثناء تحديث المستخدم:', error);
  } finally {
    // إغلاق الاتصال بقاعدة البيانات
    await mongoose.connection.close();
    console.log('تم إغلاق الاتصال بقاعدة البيانات');
  }
};

// تنفيذ السكربت
const run = async () => {
  await connectDB();
  await makeUserAdmin('mohamed123456@example.com'); // استبدل بالبريد الإلكتروني للمستخدم
};

run();