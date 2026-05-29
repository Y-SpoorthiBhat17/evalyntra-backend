// models/Lecture.js
const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
    subject: String,          // e.g., Physics
    groupKey: String,         // class/group
    lectureNumber: Number,    // Lecture 1, 2, 3…
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Lecture', lectureSchema);
