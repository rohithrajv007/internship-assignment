const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    cloudinaryPublicId: { type: String, required: true },
    folder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Image', imageSchema);
