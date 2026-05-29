const mongoose = require("mongoose");
const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  dueDate: Date,
  uploadedBy: { type: String, required: true },
  groupKey: String,
  subject: String,
  fileUrl: String,
  submissions: [{
    studentUSN: String,
    studentName: String,
    fileUrl: String,
    submittedAt: Date
  }],
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model("Assignment", assignmentSchema);
