// middleware/multerConfig.js
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../Uploads');

// التأكد من وجود مجلد Uploads
const ensureUploadDir = async () => {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    console.log('تم إنشاء أو التحقق من مجلد Uploads');
  } catch (err) {
    console.error('خطأ في إنشاء مجلد Uploads:', err);
    throw new Error('فشل في إعداد مجلد التحميل');
  }
};

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalName));
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalName).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('يجب أن تكون الصورة بصيغة JPEG أو PNG'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

export default upload;