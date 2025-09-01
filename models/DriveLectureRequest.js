import { Schema, model } from 'mongoose';

const driveLectureRequestSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  link: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  studentEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  lectureDate: {
    type: Date,
    required: true
  },
  duration: {
    type: Number,
    required: true,
    min: 0.1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  },
  adminActionAt: {
    type: Date
  },
  adminNote: {
    type: String
  }
});

export default model('DriveLectureRequest', driveLectureRequestSchema);