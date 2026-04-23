// routes/news.js
import { Router } from 'express';
import {
  getNews,
  getAllNews,
  getNewsById,
  createNews,
  updateNews,
  deleteNews
} from '../controllers/newsController.js';
import authMiddleware from '../middleware/auth.js'

const router = Router();

// ── Public ──────────────────────────────────────────────────────────────────
// GET /api/news  →  latest active news (used by the frontend section)
router.get('/', getNews);

// ── Admin (protected) ────────────────────────────────────────────────────────
// GET  /api/news/all      → list all records
router.get('/all', authMiddleware, getAllNews);

// GET  /api/news/:id      → single record
router.get('/:id', authMiddleware, getNewsById);

// POST /api/news          → create
router.post('/', authMiddleware, createNews);

// PUT  /api/news/:id      → update
router.put('/:id', authMiddleware, updateNews);

// DELETE /api/news/:id    → delete
router.delete('/:id', authMiddleware, deleteNews);

export default router;