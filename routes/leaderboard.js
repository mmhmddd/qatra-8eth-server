import express from 'express';
import { addUserToLeaderboard, getLeaderboard, editUserInLeaderboard, deleteUserFromLeaderboard } from '../controllers/leaderboardController.js';
import authMiddleware from '../middleware/auth.js';
import multer from 'multer';

const storage = multer.memoryStorage();

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('الملفات المسموح بها هي: JPEG, JPG, PNG'));
    }
  }
});

const router = express.Router();

// Add a user to the leaderboard by email
router.post('/add', authMiddleware, upload.single('image'), addUserToLeaderboard);

// Get the leaderboard
router.get('/', getLeaderboard);

// Edit a user in the leaderboard
router.put('/edit', authMiddleware, upload.single('image'), editUserInLeaderboard);

// Delete a user from the leaderboard
router.delete('/remove', authMiddleware, deleteUserFromLeaderboard);

export default router;