import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
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
    _id: { type: Schema.Types.ObjectId, auto: true }, // التأكد من وجود _id
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