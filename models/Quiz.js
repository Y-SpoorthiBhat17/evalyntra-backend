const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: {
    options: [{ type: String, required: true }], // array of strings
    correct: { type: Number, required: true }    // index of correct option
  }
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  duration: { type: Number },
  dueDate: { type: Date },
  questions: [questionSchema], // array of questionSchema
  groupKey: { type: String, required: true },
  uploadedBy: { type: String },
  aiGenerated: { type: Boolean, default: false },
  subject: { type: String },
  totalMarks: { type: Number },
  attempts: [{
    studentUSN: String,
    studentName: String,
    studentAnswers: mongoose.Schema.Types.Mixed,
    score: Number,
    attemptedAt: Date,
    autoAssigned: { type: Boolean, default: false } // true = student didn't attempt, given 0
  }]
});

module.exports = mongoose.model("Quiz", quizSchema);
