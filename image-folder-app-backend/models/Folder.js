const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    path: { type: String, required: true },

    // 🔹 Trash / Recycle Bin Support
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null }

}, { timestamps: true });

// Prevent duplicate folder names under the same parent
folderSchema.index({ user: 1, parentFolder: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Folder', folderSchema);
