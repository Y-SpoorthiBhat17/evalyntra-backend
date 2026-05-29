const mongoose = require("mongoose");
const lessonSchema = new mongoose.Schema({
  title: String,
  duration: Number,
  videoUrl: String
});
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  isPaid: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  thumbnail: String,
  lessons: [lessonSchema],
  enrolledStudents: [String],
  progress: [{
    studentUSN: String,
    completedLessons: [Number]
  }]
}, { timestamps: true });
module.exports = mongoose.model("Course", courseSchema);
