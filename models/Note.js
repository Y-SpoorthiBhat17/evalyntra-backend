const mongoose = require("mongoose");
const noteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    groupKey: String,
    subject: String,
    createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model("Note", noteSchema);
