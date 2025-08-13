const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Folder = require('../models/Folder');
const Image = require('../models/Image');
const cloudinary = require('../config/cloudinary');

const router = express.Router();
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * GET: All trashed folders and images
 */
router.get('/', auth, async (req, res) => {
  try {
    const trashedFolders = await Folder.find({ user: req.user.userId, isDeleted: true });
    const trashedImages = await Image.find({ user: req.user.userId, isDeleted: true });
    res.json({ folders: trashedFolders, images: trashedImages });
  } catch (err) {
    console.error('Get Trash Error:', err);
    res.status(500).json({ message: 'Error fetching trash' });
  }
});

/**
 * POST: Restore folder or image
 */
router.post('/restore/:type/:id', auth, async (req, res) => {
  try {
    const type = req.params.type.trim().toLowerCase();
    const id = req.params.id.trim();
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    if (type === 'folder') {
      const folder = await Folder.findOneAndUpdate(
        { _id: id, user: req.user.userId, isDeleted: true },
        { isDeleted: false, deletedAt: null },
        { new: true }
      );
      if (!folder) return res.status(404).json({ message: 'Folder not found or not in trash' });

      await Image.updateMany(
        { folder: id, user: req.user.userId, isDeleted: true },
        { isDeleted: false, deletedAt: null }
      );
      res.json({ message: 'folder restored successfully', folder });
    } else if (type === 'image') {
      const image = await Image.findOneAndUpdate(
        { _id: id, user: req.user.userId, isDeleted: true },
        { isDeleted: false, deletedAt: null },
        { new: true }
      );
      if (!image) return res.status(404).json({ message: 'Image not found or not in trash' });
      res.json({ message: 'image restored successfully', image });
    } else {
      res.status(400).json({ message: 'Invalid type parameter' });
    }
  } catch (err) {
    console.error('Restore Trash Error:', err);
    res.status(500).json({ message: 'Error restoring item' });
  }
});

/**
 * DELETE: Permanently delete folder or image
 */
router.delete('/permanent/:type/:id', auth, async (req, res) => {
  try {
    const type = req.params.type.trim().toLowerCase();
    const id = req.params.id.trim();
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid ID' });

    if (type === 'image') {
      const image = await Image.findOne({ _id: id, user: req.user.userId, isDeleted: true });
      if (!image) return res.status(404).json({ message: 'Image not found or not in trash' });

      if (image.cloudinaryPublicId) {
        await cloudinary.uploader.destroy(image.cloudinaryPublicId);
      }
      await Image.deleteOne({ _id: id });
    } else if (type === 'folder') {
      const folder = await Folder.findOne({ _id: id, user: req.user.userId, isDeleted: true });
      if (!folder) return res.status(404).json({ message: 'Folder not found or not in trash' });

      const images = await Image.find({ folder: id, user: req.user.userId });
      for (const img of images) {
        if (img.cloudinaryPublicId) {
          await cloudinary.uploader.destroy(img.cloudinaryPublicId);
        }
      }
      await Image.deleteMany({ folder: id, user: req.user.userId });
      await Folder.deleteOne({ _id: id });
    } else {
      return res.status(400).json({ message: 'Invalid type parameter' });
    }

    res.json({ message: `${type} permanently deleted` });
  } catch (err) {
    console.error('Permanent Delete Trash Error:', err);
    res.status(500).json({ message: 'Error permanently deleting item' });
  }
});

/**
 * Auto-cleanup trashed items older than 30 days
 */
async function cleanupOldTrash() {
  try {
    const DAYS_TO_KEEP = 30;
    const cutoffDate = new Date(Date.now() - DAYS_TO_KEEP * 86400000);

    const oldImages = await Image.find({ isDeleted: true, deletedAt: { $lt: cutoffDate } });
    const oldFolders = await Folder.find({ isDeleted: true, deletedAt: { $lt: cutoffDate } });

    for (const img of oldImages) {
      if (img.cloudinaryPublicId) {
        await cloudinary.uploader.destroy(img.cloudinaryPublicId);
      }
    }

    await Image.deleteMany({ _id: { $in: oldImages.map(img => img._id) } });
    await Folder.deleteMany({ _id: { $in: oldFolders.map(f => f._id) } });

    console.log(`🗑 Auto-cleanup — removed ${oldImages.length} images & ${oldFolders.length} folders`);
  } catch (err) {
    console.error('Auto Cleanup Error:', err);
  }
}

module.exports = router;
