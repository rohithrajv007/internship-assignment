const express = require('express');
const multer = require('multer');
const streamifier = require('streamifier');
const cloudinary = require('../config/cloudinary');
const auth = require('../middleware/auth');
const Image = require('../models/Image');
const Folder = require('../models/Folder');
const mongoose = require('mongoose');

const router = express.Router();

// Multer memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Utility: Validate ObjectId to prevent CastError
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Upload an image to a folder and Cloudinary
 */
router.post('/folder/:folderId', auth, upload.single('image'), async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    if (!isValidObjectId(folderId)) {
      return res.status(400).json({ message: 'Invalid folder ID' });
    }

    // Verify folder ownership and existence
    const folder = await Folder.findOne({ _id: folderId, user: req.user.userId, isDeleted: false });
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded. Use key "image".' });
    }

    // Upload to Cloudinary as stream
    const streamUpload = () =>
      new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'image-app', resource_type: 'image' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });

    const result = await streamUpload();

    // Save image metadata to MongoDB
    const newImage = new Image({
      name: req.file.originalname.split('.')[0],
      originalName: req.file.originalname,
      cloudinaryUrl: result.secure_url,
      cloudinaryPublicId: result.public_id,
      folder: folder._id,
      user: req.user.userId,
      size: req.file.size,
      mimeType: req.file.mimetype,
      isDeleted: false,
    });

    await newImage.save();

    res.status(201).json({ message: 'Image uploaded successfully', image: newImage });
  } catch (error) {
    console.error('Image Upload Error:', error);
    res.status(500).json({ message: 'Server error uploading image', error: error.message });
  }
});

/**
 * Search images in a folder by partial match on name or originalName (case-insensitive)
 * Excludes trashed images.
 */
router.get('/folder/:folderId/search', auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    if (!isValidObjectId(folderId)) {
      return res.status(400).json({ message: 'Invalid folder ID' });
    }

    const searchQuery = req.query.q ? req.query.q.trim() : '';
    const filter = { folder: folderId, user: req.user.userId, isDeleted: false };

    if (searchQuery) {
      const regex = new RegExp(searchQuery, 'i');
      filter.$or = [{ name: { $regex: regex } }, { originalName: { $regex: regex } }];
    }

    const images = await Image.find(filter);
    res.json(images);
  } catch (error) {
    console.error('Search Images Error:', error);
    res.status(500).json({ message: 'Server error searching images' });
  }
});

/**
 * Get all images in a folder, excluding trashed images
 */
router.get('/folder/:folderId', auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    if (!isValidObjectId(folderId)) {
      return res.status(400).json({ message: 'Invalid folder ID' });
    }

    const images = await Image.find({ folder: folderId, user: req.user.userId, isDeleted: false });
    res.json(images);
  } catch (error) {
    console.error('Get Images Error:', error);
    res.status(500).json({ message: 'Server error fetching images' });
  }
});

/**
 * Soft delete image (move to trash) by setting isDeleted: true
 */
router.delete('/id/:imageId/soft', auth, async (req, res) => {
  try {
    const imageId = req.params.imageId.trim();
    if (!isValidObjectId(imageId)) {
      return res.status(400).json({ message: 'Invalid image ID' });
    }

    const image = await Image.findOne({ _id: imageId, user: req.user.userId, isDeleted: false });
    if (!image) {
      return res.status(404).json({ message: 'Image not found' });
    }

    image.isDeleted = true;
    image.deletedAt = new Date();
    await image.save();

    res.json({ message: 'Image moved to trash' });
  } catch (error) {
    console.error('Soft Delete Error:', error);
    res.status(500).json({ message: 'Server error deleting image' });
  }
});

/**
 * Rename image metadata (name field only; does not rename in Cloudinary)
 */
router.put('/id/:imageId', auth, async (req, res) => {
  try {
    const imageId = req.params.imageId.trim();
    if (!isValidObjectId(imageId)) {
      return res.status(400).json({ message: 'Invalid image ID' });
    }

    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ message: 'New image name is required' });
    }

    const image = await Image.findOne({ _id: imageId, user: req.user.userId, isDeleted: false });
    if (!image) {
      return res.status(404).json({ message: 'Image not found or is in trash' });
    }

    image.name = newName.trim();
    await image.save();

    res.json({ message: 'Image renamed successfully', image });
  } catch (error) {
    console.error('Rename Image Error:', error);
    res.status(500).json({ message: 'Server error renaming image' });
  }
});

module.exports = router;
