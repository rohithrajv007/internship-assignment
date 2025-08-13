const express = require('express');
const router = express.Router();
const Folder = require('../models/Folder');
const auth = require('../middleware/auth');
const Image = require('../models/Image');
const cloudinary = require('../config/cloudinary');

// Create a folder
router.post('/', auth, async (req, res) => {
    try {
        const { name, parentFolderId } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Folder name is required' });
        }

        let path = name;
        if (parentFolderId) {
            const parentFolder = await Folder.findOne({ _id: parentFolderId, user: req.user.userId });
            if (!parentFolder) {
                return res.status(404).json({ message: 'Parent folder not found' });
            }
            path = `${parentFolder.path}/${name}`;
        }

        const folder = new Folder({
            name,
            parentFolder: parentFolderId || null,
            user: req.user.userId,
            path
        });

        await folder.save();
        res.status(201).json(folder);
    } catch (err) {
        console.error('Create Folder Error:', err);
        res.status(500).json({ message: 'Server error creating folder' });
    }
});

// Get all folders for logged-in user
router.get('/', auth, async (req, res) => {
    try {
        const folders = await Folder.find({ user: req.user.userId }).sort({ path: 1 });
        res.json(folders);
    } catch (err) {
        console.error('Get Folders Error:', err);
        res.status(500).json({ message: 'Server error fetching folders' });
    }
});

// Delete a folder (+ subfolders + images from MongoDB + Cloudinary)
router.delete('/:folderId', auth, async (req, res) => {
    try {
        const folderId = req.params.folderId.trim();

        // 1. Check folder exists and belongs to user
        const folder = await Folder.findOne({ _id: folderId, user: req.user.userId });
        if (!folder) {
            return res.status(404).json({ message: 'Folder not found' });
        }

        // 2. Find all nested folders (by path match)
        const foldersToDelete = await Folder.find({
            user: req.user.userId,
            path: { $regex: `^${folder.path}` }  // folder and its subfolders
        });

        const folderIds = foldersToDelete.map(f => f._id);

        // 3. Find all images linked to these folders
        const imagesToDelete = await Image.find({ folder: { $in: folderIds } });

        // 4. Delete these images from Cloudinary
        for (const img of imagesToDelete) {
            if (img.cloudinaryPublicId) {
                try {
                    await cloudinary.uploader.destroy(img.cloudinaryPublicId);
                } catch (cloudErr) {
                    console.error(`Failed to delete from Cloudinary: ${img.cloudinaryPublicId}`, cloudErr.message);
                }
            }
        }

        // 5. Delete images from MongoDB
        await Image.deleteMany({ folder: { $in: folderIds } });

        // 6. Delete folders from MongoDB
        await Folder.deleteMany({ _id: { $in: folderIds } });

        res.json({ message: 'Folder, subfolders, and all images deleted successfully' });
    } catch (err) {
        console.error('Delete Folder Error:', err);
        res.status(500).json({ message: 'Server error deleting folder' });
    }
});
// Soft delete folder
router.delete('/:folderId', auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    const folder = await Folder.findOne({ _id: folderId, user: req.user.userId });

    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }

    // Find all nested folders
    const foldersToDelete = await Folder.find({
      user: req.user.userId,
      path: { $regex: `^${folder.path}` }
    });

    const folderIds = foldersToDelete.map(f => f._id);

    // Mark folders and images as deleted
    await Folder.updateMany({ _id: { $in: folderIds } }, { isDeleted: true, deletedAt: new Date() });
    await Image.updateMany({ folder: { $in: folderIds } }, { isDeleted: true, deletedAt: new Date() });

    res.json({ message: 'Folder and contents moved to trash' });
  } catch (err) {
    console.error('Soft Delete Folder Error:', err);
    res.status(500).json({ message: 'Server error deleting folder' });
  }
});
// Get all folders for logged-in user (excluding trashed)
router.get('/', auth, async (req, res) => {
    try {
        const folders = await Folder.find({
            user: req.user.userId,
            isDeleted: false  // 🔹 exclude trashed
        }).sort({ path: 1 });
        res.json(folders);
    } catch (err) {
        console.error('Get Folders Error:', err);
        res.status(500).json({ message: 'Server error fetching folders' });
    }
});
// Rename a folder
router.put('/:folderId', auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    const { newName } = req.body;

    if (!newName || !newName.trim()) {
      return res.status(400).json({ message: 'New folder name is required' });
    }

    // Find the folder belonging to the user
    const folder = await Folder.findOne({
      _id: folderId,
      user: req.user.userId,
      isDeleted: false
    });

    if (!folder) {
      return res.status(404).json({ message: 'Folder not found or is in trash' });
    }

    // Prevent name collision in the same parent
    const duplicate = await Folder.findOne({
      _id: { $ne: folderId },
      parentFolder: folder.parentFolder || null,
      user: req.user.userId,
      name: newName.trim(),
      isDeleted: false
    });

    if (duplicate) {
      return res.status(400).json({ message: 'A folder with this name already exists in the same location' });
    }

    // Store old path to update child subfolders
    const oldPath = folder.path;
    folder.name = newName.trim();

    // Update path for this folder
    if (folder.parentFolder) {
      const parent = await Folder.findById(folder.parentFolder);
      folder.path = `${parent.path}/${newName.trim()}`;
    } else {
      folder.path = newName.trim();
    }

    await folder.save();

    // Update paths for all subfolders that contain this folder's old path
    const subfolders = await Folder.find({
      user: req.user.userId,
      path: { $regex: `^${oldPath}/` }
    });

    for (const sub of subfolders) {
      sub.path = sub.path.replace(oldPath, folder.path);
      await sub.save();
    }

    res.json({ message: 'Folder renamed successfully', folder });
  } catch (err) {
    console.error('Rename Folder Error:', err);
    res.status(500).json({ message: 'Server error renaming folder' });
  }
});




module.exports = router;
