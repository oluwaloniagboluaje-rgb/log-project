const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { Readable } = require('stream');

cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key:    process.env.CLOUD_KEY,
  api_secret: process.env.CLOUD_SECRET,
});

// Store files in memory, then stream to Cloudinary manually
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp|gif)/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPG, PNG, WEBP, GIF) are allowed.'));
    }
  },
});

// Call this after multer — uploads req.files to Cloudinary
// and attaches results back onto each file as file.path / file.filename
const uploadToCloudinary = async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  try {
    await Promise.all(req.files.map((file, i) => {
      return new Promise((resolve, reject) => {
        const name = file.originalname
          .replace(/\.[^/.]+$/, '')
          .replace(/\s+/g, '_')
          .toLowerCase();

        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'logproject/packages',
            public_id: `pkg_${name}_${Date.now()}_${i}`,
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
            transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }],
          },
          (error, result) => {
            if (error) return reject(error);
            // Mimic multer-storage-cloudinary's shape so Order.controller.js works unchanged
            file.path     = result.secure_url;   // used as image.url in controller
            file.filename = result.public_id;     // used as image.publicId in controller
            resolve();
          }
        );

        Readable.from(file.buffer).pipe(uploadStream);
      });
    }));

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { cloudinary, upload, uploadToCloudinary };