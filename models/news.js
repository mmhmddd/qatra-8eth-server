// models/News.js
import { Schema, model } from 'mongoose';

const newsItemSchema = new Schema({
  title: {
    ar: { type: String, required: true, trim: true },
    en: { type: String, required: true, trim: true }
  },
  description: {
    ar: { type: String, required: true, trim: true },
    en: { type: String, required: true, trim: true }
  }
});

const newsSchema = new Schema(
  {
    mainDescription: {
      ar: { type: String, required: true, trim: true },
      en: { type: String, required: true, trim: true }
    },
    items: {
      type: [newsItemSchema],
      validate: {
        validator: (arr) => arr.length === 3,
        message: 'يجب أن يكون هناك 3 أخبار بالضبط / There must be exactly 3 news items'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

export default model('News', newsSchema);