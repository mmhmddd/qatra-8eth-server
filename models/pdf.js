import mongoose from 'mongoose';

const pdfSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  creatorName: { type: String, required: true },
  subject: { type: String, required: true },
  semester: { type: String, required: true },
  academicLevel: { type: String, required: true },
  fileData: { type: Buffer, required: true },
  fileName: { type: String, required: true },
  mimeType: { type: String, required: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const PDF = mongoose.model('PDF', pdfSchema);

export default PDF;