import express from 'express';
import { addUserToLeaderboard, getLeaderboard, editUserInLeaderboard, deleteUserFromLeaderboard } from '../controllers/leaderboardController.js';
import authMiddleware from '../middleware/auth.js';

const router = express.Router();

// Add a user to the leaderboard by email
router.post('/add', authMiddleware, addUserToLeaderboard);

// Get the leaderboard
router.get('/', getLeaderboard);

// Edit a user in the leaderboard
router.put('/edit', authMiddleware, editUserInLeaderboard);

// Delete a user from the leaderboard
router.delete('/remove', authMiddleware, deleteUserFromLeaderboard);

export default router;