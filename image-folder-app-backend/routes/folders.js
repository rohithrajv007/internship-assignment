const express = require("express");
const router = express.Router();
const Folder = require("../models/Folder");
const auth = require("../middleware/auth");
const Image = require("../models/Image");
const cloudinary = require("../config/cloudinary");

/**
 * Create a folder
 */
router.post("/", auth, async (req, res) => {
  try {
    const { name, parentFolderId } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    let path = name.trim();
    if (parentFolderId) {
      const parentFolder = await Folder.findOne({
        _id: parentFolderId,
        user: req.user.userId,
      });
      if (!parentFolder) {
        return res.status(404).json({ message: "Parent folder not found" });
      }
      path = `${parentFolder.path}/${name.trim()}`;
    }

    const folder = new Folder({
      name: name.trim(),
      parentFolder: parentFolderId || null,
      user: req.user.userId,
      path,
      isDeleted: false,
    });

    await folder.save();
    res.status(201).json(folder);
  } catch (err) {
    console.error("Create Folder Error:", err);
    res.status(500).json({ message: "Server error creating folder" });
  }
});

/**
 * Get all folders for logged-in user (excluding deleted)
 */
router.get("/", auth, async (req, res) => {
  try {
    const folders = await Folder.find({
      user: req.user.userId,
      isDeleted: { $ne: true },
    }).sort({ path: 1 });
    res.json(folders);
  } catch (err) {
    console.error("Get Folders Error:", err);
    res.status(500).json({ message: "Server error fetching folders" });
  }
});

/**
 * Soft Delete Folder (Move to trash)
 */
router.delete("/soft/:folderId", auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    const folder = await Folder.findOne({
      _id: folderId,
      user: req.user.userId,
    });

    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    const foldersToDelete = await Folder.find({
      user: req.user.userId,
      path: { $regex: `^${folder.path}` },
    });
    const folderIds = foldersToDelete.map((f) => f._id);

    await Folder.updateMany(
      { _id: { $in: folderIds } },
      { isDeleted: true, deletedAt: new Date() }
    );
    await Image.updateMany(
      { folder: { $in: folderIds } },
      { isDeleted: true, deletedAt: new Date() }
    );

    res.json({ message: "Folder and contents moved to trash" });
  } catch (err) {
    console.error("Soft Delete Folder Error:", err);
    res.status(500).json({ message: "Server error deleting folder" });
  }
});

/**
 * Hard Delete Folder (Permanently remove from DB & Cloudinary)
 */
router.delete("/hard/:folderId", auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    const folder = await Folder.findOne({
      _id: folderId,
      user: req.user.userId,
    });

    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    const foldersToDelete = await Folder.find({
      user: req.user.userId,
      path: { $regex: `^${folder.path}` },
    });
    const folderIds = foldersToDelete.map((f) => f._id);

    const imagesToDelete = await Image.find({ folder: { $in: folderIds } });
    for (const img of imagesToDelete) {
      if (img.cloudinaryPublicId) {
        try {
          await cloudinary.uploader.destroy(img.cloudinaryPublicId);
        } catch (cloudErr) {
          console.error(
            `Failed to delete from Cloudinary: ${img.cloudinaryPublicId}`,
            cloudErr.message
          );
        }
      }
    }

    await Image.deleteMany({ folder: { $in: folderIds } });
    await Folder.deleteMany({ _id: { $in: folderIds } });

    res.json({
      message: "Folder, subfolders, and all images permanently deleted",
    });
  } catch (err) {
    console.error("Hard Delete Folder Error:", err);
    res.status(500).json({ message: "Server error deleting folder" });
  }
});

/**
 * Rename Folder
 */
router.put("/:folderId", auth, async (req, res) => {
  try {
    const folderId = req.params.folderId.trim();
    // Changed from { newName } to { name } for consistency with frontend
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "New folder name is required" });
    }

    const folder = await Folder.findOne({
      _id: folderId,
      user: req.user.userId,
      isDeleted: { $ne: true },
    });

    if (!folder) {
      return res.status(404).json({ message: "Folder not found or is in trash" });
    }

    const duplicate = await Folder.findOne({
      _id: { $ne: folderId },
      parentFolder: folder.parentFolder || null,
      user: req.user.userId,
      name: name.trim(),
      isDeleted: { $ne: true },
    });

    if (duplicate) {
      return res
        .status(400)
        .json({ message: "A folder with this name already exists in the same location" });
    }

    const oldPath = folder.path;
    folder.name = name.trim();

    if (folder.parentFolder) {
      const parent = await Folder.findById(folder.parentFolder);
      folder.path = `${parent.path}/${name.trim()}`;
    } else {
      folder.path = name.trim();
    }

    await folder.save();

    // Update paths for subfolders
    const subfolders = await Folder.find({
      user: req.user.userId,
      path: { $regex: `^${oldPath}/` },
    });

    for (const sub of subfolders) {
      sub.path = sub.path.replace(oldPath, folder.path);
      await sub.save();
    }

    res.json({ message: "Folder renamed successfully", folder });
  } catch (err) {
    console.error("Rename Folder Error:", err);
    res.status(500).json({ message: "Server error renaming folder" });
  }
});

module.exports = router;
