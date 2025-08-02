import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: false, // Made optional for leaders added via leaderboard
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'leader'], // Added 'leader' to valid roles
    default: 'user',
    required: true,
  },
  name: {
    type: String,
    required: false, // Added to store leader's name
  },
  profileImage: {
    type: String,
    default: null,
  },
  numberOfStudents: {
    type: Number,
    default: 0,
    min: 0
  },
  subjects: [{
    type: String,
    trim: true
  }],
  students: [{
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true }
  }],
  meetings: [{
    _id: { type: Schema.Types.ObjectId, auto: true },
    title: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default model('User', userSchema);