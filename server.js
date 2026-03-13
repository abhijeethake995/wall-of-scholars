const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./config/db'); 
const upload = require('./config/multer'); 

// NEW: Required for Email Verification
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Middleware
app.use(cors());
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public')); 
app.use('/uploads', express.static('uploads'));

// --- EMAIL TRANSPORTER SETUP ---
// --- BULLETPROOF EMAIL TRANSPORTER SETUP ---
// --- EMAIL CONFIGURATION ---
// --- EMAIL CONFIGURATION ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // false for port 587
    requireTLS: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// --- MIDDLEWARE ---
const verifyToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (!bearerHeader) return res.status(403).json({ error: "No token provided" });
    
    const token = bearerHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey', (err, authData) => {
        if (err) return res.status(403).json({ error: "Invalid token" });
        req.user = authData; 
        next();
    });
};

// --- 1. AUTHENTICATION ROUTES ---

// Student Sign Up (With Password rules & REAL Email Verification - Any Email Allowed)
app.post('/api/auth/signup', async (req, res) => {
    const { username, email, password } = req.body;
    
    // 1. We removed the @mmcoe.edu.in check here! Now any valid email passes.
    if (!email) {
        return res.status(400).json({ error: "Email is required." });
    }
    if (password.length <= 6) {
        return res.status(400).json({ error: "Password must be more than 6 characters long." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Insert user into the database as unverified
        await pool.query(
            'INSERT INTO users (username, email, password, role, is_verified, verification_token) VALUES (?, ?, ?, ?, ?, ?)', 
            [username, email, hashedPassword, 'student', false, verificationToken]
        );

        // 2. ACTIVATE REAL EMAIL SENDING!
        const verifyLink = `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/verify/${verificationToken}`;
        
        await transporter.sendMail({
            from: `"Wall of Scholars" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify your Wall of Scholars Account',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                    <h2>Welcome to Wall of Scholars, ${username}! 🎓</h2>
                    <p>Thank you for signing up. Please click the button below to verify your email and activate your account:</p>
                    <a href="${verifyLink}" style="padding: 12px 24px; background-color: #2563EB; color: white; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; margin-top: 15px;">Verify My Email</a>
                    <br><br>
                    <p style="color: #666; font-size: 12px;">Or paste this link into your browser:<br>${verifyLink}</p>
                </div>
            `
        });

        // 3. Send success response back to the frontend
        res.status(201).json({ message: "Registration successful! Please check your email inbox to verify your account." });
        
    } catch (err) {
        console.error("Signup Error:", err);
        res.status(500).json({ error: "Username or Email might already exist." });
    }
});

// Verify Email Token Route
app.get('/api/auth/verify/:token', async (req, res) => {
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE verification_token = ?', [req.params.token]);
        if (users.length === 0) return res.status(400).send('<h1>Error: Invalid or expired verification link.</h1>');

        await pool.query('UPDATE users SET is_verified = TRUE, verification_token = NULL WHERE id = ?', [users[0].id]);
        res.send('<div style="text-align:center; font-family:sans-serif; margin-top:50px;"><h1>Account Verified Successfully! 🎉</h1><p>You can now close this tab and log in to the Wall of Fame.</p></div>');
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// Login (Blocks unverified students)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    
    if (users.length === 0) return res.status(401).json({ error: "User not found" });

    const user = users[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: "Invalid password" });

    // Enforce Email Verification (Admins bypass this)
    if (!user.is_verified && user.role !== 'admin') {
        return res.status(403).json({ error: "Please check your email and verify your account before logging in." });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'supersecretkey', { expiresIn: '1h' });
    res.json({ token, role: user.role, message: "Logged in successfully" });
});


// --- FORGOT PASSWORD: Send Email ---
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.status(400).json({ error: "If that email exists, a reset link has been sent." }); // Vague message for security

        // Generate a random token that expires in 1 hour
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // Current time + 1 hour

        // Save token to database
        await pool.query('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?', [resetToken, expiry, email]);

        // Send Email
        const resetLink = `${process.env.BASE_URL || 'http://localhost:3000'}/pages/reset-password.html?token=${resetToken}`;
        
        await transporter.sendMail({
            from: `"Wall of Scholars" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px;">
                    <h2>Password Reset</h2>
                    <p>You requested to reset your Wall of Fame password. Click the button below to create a new one:</p>
                    <a href="${resetLink}" style="padding: 12px 24px; background-color: #EF4444; color: white; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; margin-top: 15px;">Reset Password</a>
                    <br><br>
                    <p style="color: #666; font-size: 12px;">This link will expire in 1 hour. If you didn't request this, ignore this email.</p>
                </div>
            `
        });

        res.json({ message: "Password reset link sent to your email!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error." });
    }
});

// --- RESET PASSWORD: Save New Password ---
app.post('/api/auth/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        // Find user by token AND ensure it hasn't expired
        const [users] = await pool.query('SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()', [token]);
        if (users.length === 0) return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });

        if (newPassword.length <= 6) return res.status(400).json({ error: "Password must be more than 6 characters." });

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Update password and erase the temporary token
        await pool.query('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', [hashedPassword, users[0].id]);
        
        res.json({ message: "Password has been successfully reset! You can now log in." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error." });
    }
});

// --- 2. STUDENT ROUTES ---

// Get specific student's requests
app.get('/api/student/my-requests', verifyToken, async (req, res) => {
    try {
        const [requests] = await pool.query('SELECT * FROM achievements WHERE user_id = ? ORDER BY submission_date DESC', [req.user.id]);
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// Get Current Student Profile
app.get('/api/student/profile', verifyToken, async (req, res) => {
    try {
        const [user] = await pool.query('SELECT username, email, domain, profile_pic FROM users WHERE id = ?', [req.user.id]);
        res.json(user[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload/Update Profile Picture
app.post('/api/student/profile-pic', verifyToken, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Please select an image." });
        const picPath = `/uploads/${req.file.filename}`;
        
        await pool.query('UPDATE users SET profile_pic = ? WHERE id = ?', [picPath, req.user.id]);
        res.json({ message: "Profile picture updated successfully!", profile_pic: picPath });
    } catch (err) { 
        res.status(500).json({ error: "Failed to update profile picture." }); 
    }
});
// Submit New Achievement
const uploadFields = upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'document', maxCount: 1 }
]);


// Get a list of all achievements the logged-in student has liked
app.get('/api/student/my-likes', verifyToken, async (req, res) => {
    try {
        const [likes] = await pool.query('SELECT achievement_id FROM achievement_likes WHERE user_id = ?', [req.user.id]);
        // Send back an array of just the IDs (e.g., [1, 4, 7])
        res.json(likes.map(l => l.achievement_id));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit New Achievement (Upgraded with Debugging & Safety Checks)
app.post('/api/achievements', verifyToken, uploadFields, async (req, res) => {
    try {
        const { student_name, department, category, title, description } = req.body;
        const userId = req.user.id; 
        
        // Bulletproof file checks (prevents crashes if Multer acts up)
        const student_photo = (req.files && req.files['photo']) ? `/uploads/${req.files['photo'][0].filename}` : null;
        const document_path = (req.files && req.files['document']) ? `/uploads/${req.files['document'][0].filename}` : null;

        await pool.query(
            `INSERT INTO achievements (student_name, department, category, title, description, student_photo, document_path, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [student_name, department, category, title, description, student_photo, document_path, 'Pending', userId]
        );
        res.status(201).json({ message: "Achievement submitted for review!" });
    } catch (err) {
        // TURN THE LIGHTS ON: This forces the server to print the exact error to your terminal!
        console.log("\n=================================");
        console.log("❌ UPLOAD ERROR DETECTED:");
        console.log(err);
        console.log("=================================\n");
        res.status(500).json({ error: "Failed to submit achievement." });
    }
});

// --- UPDATE & RESUBMIT REJECTED ACHIEVEMENT ---
app.put('/api/achievements/:id', verifyToken, uploadFields, async (req, res) => {
    try {
        const { department, category, title, description } = req.body;
        const achievementId = req.params.id;
        const userId = req.user.id; 

        // 1. Verify this achievement actually belongs to the logged-in student
        const [existing] = await pool.query('SELECT * FROM achievements WHERE id = ? AND user_id = ?', [achievementId, userId]);
        if (existing.length === 0) return res.status(403).json({ error: "Unauthorized or achievement not found" });

        // 2. Keep the old files if they didn't upload new ones
        let photoPath = existing[0].student_photo;
        let docPath = existing[0].document_path;

        if (req.files && req.files['photo']) {
            photoPath = `/uploads/${req.files['photo'][0].filename}`;
        }
        if (req.files && req.files['document']) {
            docPath = `/uploads/${req.files['document'][0].filename}`;
        }

        // 3. Update the database, reset status to 'Pending', and clear old admin feedback
        await pool.query(
            `UPDATE achievements 
             SET department = ?, category = ?, title = ?, description = ?, student_photo = ?, document_path = ?, status = 'Pending', admin_feedback = NULL 
             WHERE id = ?`,
            [department, category, title, description, photoPath, docPath, achievementId]
        );

        res.json({ message: "Achievement updated and resubmitted successfully!" });
    } catch (err) {
        console.error("\n❌ UPDATE ERROR:\n", err);
        res.status(500).json({ error: "Failed to update achievement." });
    }
});

// Update Existing Achievement (For when a student fixes a rejected request based on feedback)
app.put('/api/achievements/:id', verifyToken, uploadFields, async (req, res) => {
    try {
        const { student_name, department, category, title, description } = req.body;
        
        // We set status back to 'Pending' and clear old feedback so the admin checks it again
        await pool.query(
            `UPDATE achievements SET student_name=?, department=?, category=?, title=?, description=?, status='Pending', admin_feedback=NULL WHERE id=? AND user_id=?`,
            [student_name, department, category, title, description, req.params.id, req.user.id]
        );
        res.json({ message: "Achievement resubmitted for review!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to resubmit achievement." });
    }
});


// --- 3. PUBLIC ROUTES ---
app.get('/api/achievements/public', async (req, res) => {
    try {
        const [verified] = await pool.query('SELECT * FROM achievements WHERE status = "Verified" ORDER BY submission_date DESC');
        res.json(verified);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- GENERATE REPORT DATA (DATE FILTERED) ---
app.get('/api/admin/report-data', verifyToken, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        // Format dates for MySQL to cover the whole day
        const start = startDate + ' 00:00:00';
        const end = endDate + ' 23:59:59';

        // 1. Top 3 Achievers (Verified only, in this date range)
        const [topAchievers] = await pool.query(`
            SELECT u.username, u.domain, SUM(a.points) as total_points 
            FROM users u
            JOIN achievements a ON u.id = a.user_id
            WHERE a.status = 'Verified' AND a.submission_date BETWEEN ? AND ?
            GROUP BY u.id
            ORDER BY total_points DESC
            LIMIT 3
        `, [start, end]);

        // 2. Department-wise Uploads (All statuses)
        const [deptStats] = await pool.query(`
            SELECT department, COUNT(*) as count 
            FROM achievements 
            WHERE submission_date BETWEEN ? AND ?
            GROUP BY department
        `, [start, end]);

        // 3. Category-wise Uploads
        const [catStats] = await pool.query(`
            SELECT category, COUNT(*) as count 
            FROM achievements 
            WHERE submission_date BETWEEN ? AND ?
            GROUP BY category
        `, [start, end]);

        // 4. All Uploaded Achievements List
        const [allAchievements] = await pool.query(`
            SELECT student_name, department, category, title, status, DATE(submission_date) as date
            FROM achievements 
            WHERE submission_date BETWEEN ? AND ?
            ORDER BY submission_date DESC
        `, [start, end]);

        res.json({ topAchievers, deptStats, catStats, allAchievements });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// --- 4. ADMIN ROUTES ---

// Get ALL requests so the Admin Sidebar can filter them
app.get('/api/admin/all-requests', verifyToken, async (req, res) => {
    try {
        // Includes an inner join to get the student's email from the users table!
        const [requests] = await pool.query(`
            SELECT a.*, u.email as student_email 
            FROM achievements a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.submission_date DESC
        `);
        res.json(requests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve/Reject with Feedback
// --- UPDATED: Approve/Reject with Rule-Based Points & Feedback ---
app.put('/api/admin/verify/:id', verifyToken, async (req, res) => {
    const { status, feedback, category, adminOverridePoints } = req.body; 
    let points = 0;

    // THE RULE-BASED MODEL (Only gives points if Verified)
    if (status === 'Verified') {
        if (adminOverridePoints !== undefined) {
            points = adminOverridePoints; // Admin changed the ranking manually!
        } else {
            // Default Rule-Based System
            switch(category) {
                case 'Hackathon': points = 50; break;
                case 'Academics': points = 40; break;
                case 'Sports': points = 30; break;
                case 'Cultural': points = 20; break;
                default: points = 10; break;
            }
        }
    }

    try {
        await pool.query(
            'UPDATE achievements SET status = ?, admin_feedback = ?, points = ? WHERE id = ?', 
            [status, feedback, points, req.params.id]
        );
        res.json({ message: `Achievement ${status} successfully with ${points} points!` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete verified/rejected achievements permanently
// SOFT DELETE Achievement (Move to 'Deleted' tab)
app.put('/api/admin/delete/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE achievements SET status = "Deleted" WHERE id = ?', [req.params.id]);
        res.json({ message: "Achievement moved to Deleted tab." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- PERMANENT HARD DELETE ---
app.delete('/api/admin/achievements/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM achievements WHERE id = ?', [req.params.id]);
        res.json({ message: "Achievement deleted permanently." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// RESTORE Deleted Achievement
app.put('/api/admin/restore/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE achievements SET status = "Verified" WHERE id = ?', [req.params.id]);
        res.json({ message: "Achievement restored to Verified status!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Analytics Stats
app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        const [statusData] = await pool.query('SELECT status, COUNT(*) as count FROM achievements GROUP BY status');
        const [categoryData] = await pool.query('SELECT category, COUNT(*) as count FROM achievements GROUP BY category');
        res.json({ statuses: statusData, categories: categoryData });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- 5. GAMIFICATION & LEADERBOARD ROUTES (NEW) ---

// Get the Top 10 Leaderboard
// Get the Top 10 Leaderboard
// Get the Top 10 Leaderboard
app.get('/api/leaderboard', async (req, res) => {
    try {
        const [leaderboard] = await pool.query(`
            SELECT u.id, u.username, u.domain, u.profile_pic, SUM(a.points) as total_points, COUNT(a.id) as total_certificates
            FROM users u
            JOIN achievements a ON u.id = a.user_id
            WHERE a.status = 'Verified'
            GROUP BY u.id
            ORDER BY total_points DESC
            LIMIT 10
        `);
        res.json(leaderboard);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Platform Stats (Total Certs & Papers)
app.get('/api/stats', async (req, res) => {
    try {
        const [totalCerts] = await pool.query(`SELECT COUNT(*) as count FROM achievements WHERE status = 'Verified'`);
        const [totalPapers] = await pool.query(`SELECT COUNT(*) as count FROM achievements WHERE status = 'Verified' AND category = 'Academics'`); // Assuming papers fall under Academics
        
        res.json({ 
            certificates: totalCerts[0].count, 
            research_papers: totalPapers[0].count 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Certificate Recommendations based on Student Domain
app.get('/api/recommendations', verifyToken, async (req, res) => {
    try {
        // Fetch the logged-in student's department/domain
        const [user] = await pool.query('SELECT domain FROM users WHERE id = ?', [req.user.id]);
        const userDomain = user.length > 0 ? user[0].domain : 'General';

        // Recommend highly-rated certificates from other students in the same domain
        const [recommendations] = await pool.query(`
            SELECT a.title, a.category, a.points 
            FROM achievements a
            JOIN users u ON a.user_id = u.id
            WHERE u.domain = ? AND a.status = 'Verified'
            ORDER BY a.points DESC
            LIMIT 5
        `, [userDomain]);
        
        res.json({ domain: userDomain, suggestions: recommendations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Pin Status for Wall of Fame
app.put('/api/admin/pin/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE achievements SET is_pinned = NOT is_pinned WHERE id = ?', [req.params.id]);
        res.json({ message: "Pin status toggled!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});// Toggle Pin Status (With Strict 6-Pin Limit)
app.put('/api/admin/pin/:id', verifyToken, async (req, res) => {
    try {
        const [target] = await pool.query('SELECT is_pinned FROM achievements WHERE id = ?', [req.params.id]);
        // Bulletproof boolean check for MySQL
        const currentlyPinned = target[0].is_pinned === 1 || target[0].is_pinned === true;

        if (!currentlyPinned) { 
            // Check for the number 1 instead of TRUE for maximum MySQL compatibility
            const [countResult] = await pool.query('SELECT COUNT(*) as count FROM achievements WHERE is_pinned = 1');
            if (countResult[0].count >= 6) {
                return res.status(400).json({ error: "Maximum of 6 achievements can be pinned. Please unpin an older one first!" });
            }
        }

        await pool.query('UPDATE achievements SET is_pinned = NOT is_pinned WHERE id = ?', [req.params.id]);
        res.json({ message: "Pin status toggled!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});