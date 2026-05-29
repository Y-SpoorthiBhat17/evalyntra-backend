const mongoose = require("mongoose");
const videoSchema = new mongoose.Schema({
    title: { type: String, required: true },
    link: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    groupKey: String,
    subject: String,
    createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model("Video", videoSchema);
