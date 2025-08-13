// --- 1. IMPORTS ---
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cors = require('cors');
require('dotenv').config();

// Models
const User = require('./models/User');
const Otp = require('./models/Otp');

// Routes
const folderRoutes = require('./routes/folders');
const imageRoutes = require('./routes/images');

// --- 2. INITIALIZATION ---
const app = express();
const PORT = process.env.PORT || 5000;

// --- Nodemailer Transporter ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

// --- 3. MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// ✅ Trim URLs and route params to remove trailing spaces/newlines
app.use((req, res, next) => {
    if (req.params) {
        for (let key in req.params) {
            if (typeof req.params[key] === 'string') {
                req.params[key] = req.params[key].trim();
            }
        }
    }
    if (req.url) req.url = req.url.trim();
    console.log(`${req.method} ${req.url}`);
    next();
});

// --- 4. DATABASE CONNECTION ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// --- 5. ROUTES ---
// Health check
app.get('/', (req, res) => {
    res.send('Hello from the OTP Auth + Folder/Image Backend!');
});

// ----------- SIGNUP -----------
app.post('/api/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'All fields are required.' });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User with this email already exists.' });
        }

        const password_hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
        const newUser = new User({ name, email, password_hash });
        await newUser.save();

        res.status(201).json({
            message: 'User created successfully!',
            user: { id: newUser._id, name: newUser.name, email: newUser.email },
        });
    } catch (error) {
        console.error('Signup Error:', error);
        res.status(500).json({ message: 'Server error during signup.' });
    }
});

// ----------- LOGIN -----------
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({
            message: 'Logged in successfully!',
            token,
            user: { id: user._id, name: user.name, email: user.email },
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// ----------- FORGOT PASSWORD (SEND OTP) -----------
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        // Always return success for security
        if (!user) {
            return res.status(200).json({ message: 'If that email exists, an OTP has been sent.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires_at = new Date(Date.now() + 10 * 60 * 1000);

        await new Otp({ email, otp, expires_at }).save();

        await transporter.sendMail({
            from: process.env.GMAIL_USER,
            to: email,
            subject: 'Your Password Reset OTP',
            html: `<p>Your OTP is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
        });

        res.status(200).json({ message: 'OTP sent to email successfully.' });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        res.status(500).json({ message: 'Server error while sending OTP.' });
    }
});

// ----------- VERIFY OTP & RESET PASSWORD -----------
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const otpRecord = await Otp.findOne({
            email,
            otp,
            expires_at: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        if (!otpRecord) {
            return res.status(400).json({ message: 'Invalid or expired OTP.' });
        }

        const password_hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
        await User.findOneAndUpdate({ email }, { password_hash });
        await Otp.findByIdAndDelete(otpRecord._id);

        res.status(200).json({ message: 'Password reset successfully.' });
    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ message: 'Server error during password reset.' });
    }
});

// ----------- PROTECTED ROUTES -----------
app.use('/api/folders', folderRoutes);
app.use('/api/images', imageRoutes);
const trashRoutes = require('./routes/trash');
app.use('/api/trash', trashRoutes);


// --- 6. SERVER START ---
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
