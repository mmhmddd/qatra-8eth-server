// controllers/newsController.js
import News from '../models/news.js';

// ─── GET active news (public) ───────────────────────────────────────────────
export const getNews = async (req, res) => {
  try {
    const news = await News.findOne({ isActive: true }).sort({ createdAt: -1 });
    if (!news) {
      return res.status(404).json({ success: false, message: 'لا توجد أخبار / No news found' });
    }
    res.json({ success: true, data: news });
  } catch (error) {
    console.error('getNews error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};

// ─── GET all news (admin) ────────────────────────────────────────────────────
export const getAllNews = async (req, res) => {
  try {
    const newsList = await News.find().sort({ createdAt: -1 });
    res.json({ success: true, data: newsList });
  } catch (error) {
    console.error('getAllNews error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};

// ─── GET single news by id (admin) ──────────────────────────────────────────
export const getNewsById = async (req, res) => {
  try {
    const news = await News.findById(req.params.id);
    if (!news) {
      return res.status(404).json({ success: false, message: 'الخبر غير موجود / News not found' });
    }
    res.json({ success: true, data: news });
  } catch (error) {
    console.error('getNewsById error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};

// ─── CREATE news (admin) ─────────────────────────────────────────────────────
export const createNews = async (req, res) => {
  try {
    const { mainDescription, items } = req.body;

    if (
      !mainDescription?.ar || !mainDescription?.en ||
      !Array.isArray(items) || items.length !== 3
    ) {
      return res.status(400).json({
        success: false,
        message: 'البيانات غير مكتملة. يجب توفير الوصف الرئيسي و3 أخبار بالعربية والإنجليزية / Incomplete data. Provide main description and exactly 3 news items in both languages.'
      });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.title?.ar || !item.title?.en || !item.description?.ar || !item.description?.en) {
        return res.status(400).json({
          success: false,
          message: `الخبر رقم ${i + 1} يفتقد حقولاً مطلوبة / News item ${i + 1} is missing required fields`
        });
      }
    }

    const news = new News({ mainDescription, items });
    await news.save();

    res.status(201).json({ success: true, message: 'تم إنشاء الخبر بنجاح / News created successfully', data: news });
  } catch (error) {
    console.error('createNews error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};

// ─── UPDATE news (admin) ─────────────────────────────────────────────────────
export const updateNews = async (req, res) => {
  try {
    const { mainDescription, items, isActive } = req.body;

    if (items && (!Array.isArray(items) || items.length !== 3)) {
      return res.status(400).json({
        success: false,
        message: 'يجب أن يكون هناك 3 أخبار بالضبط / There must be exactly 3 news items'
      });
    }

    const news = await News.findByIdAndUpdate(
      req.params.id,
      { mainDescription, items, isActive },
      { new: true, runValidators: true }
    );

    if (!news) {
      return res.status(404).json({ success: false, message: 'الخبر غير موجود / News not found' });
    }

    res.json({ success: true, message: 'تم تحديث الخبر بنجاح / News updated successfully', data: news });
  } catch (error) {
    console.error('updateNews error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};

// ─── DELETE news (admin) ─────────────────────────────────────────────────────
export const deleteNews = async (req, res) => {
  try {
    const news = await News.findByIdAndDelete(req.params.id);
    if (!news) {
      return res.status(404).json({ success: false, message: 'الخبر غير موجود / News not found' });
    }
    res.json({ success: true, message: 'تم حذف الخبر بنجاح / News deleted successfully' });
  } catch (error) {
    console.error('deleteNews error:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم / Server error' });
  }
};