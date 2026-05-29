const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    role: { type: String, enum: ["student", "lecturer"], required: true },

    // grouping fields
    college: String,
    branch: String,
    year: String,
    section: String,

    // student-only
    usn: { type: String },

    // lecturer-only
    subject: String,
    subjectCode: String,
    password: String,
    email: String,
    groupKey: String,

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
