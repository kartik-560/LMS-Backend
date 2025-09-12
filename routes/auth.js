// routes/auth.js
import express from 'express';
import { body, validationResult } from 'express-validator';
import { protect } from '../middleware/auth.js';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  logoutUser
} from '../controllers/authController.js';

const router = express.Router();

// Validation middleware helper
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }
  next();
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post(
  '/register',
  [
    body('fullName')
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        'Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    // ⚠️ Do NOT restrict role here. Controller enforces:
    // - First user may be SUPER_ADMIN
    // - Afterwards only STUDENT/INSTRUCTOR/ADMIN
    body('role').optional().isString().trim(),
    handleValidationErrors
  ],
  registerUser
);

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required'),
    handleValidationErrors
  ],
  loginUser
);

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, getCurrentUser);

// @desc    Update user profile (fullName and/or email)
// @route   PUT /api/auth/profile
// @access  Private
router.put(
  '/profile',
  protect,
  [
    body('fullName')
      .optional()
      .trim()
      .isLength({ min: 2, max: 100 })
      .withMessage('Full name must be between 2 and 100 characters'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    handleValidationErrors
  ],
  updateProfile
);

// @desc    Change password (requires currentPassword, newPassword)
// @route   PUT /api/auth/change-password
// @access  Private
router.put(
  '/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        'New password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    handleValidationErrors
  ],
  changePassword
);

// @desc    Forgot password (send reset link/token)
// @route   POST /api/auth/forgot-password
// @access  Public
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'), handleValidationErrors],
  forgotPassword
);

// @desc    Reset password using token
// @route   PUT /api/auth/reset-password
// @access  Public
router.put(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage(
        'Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, and one number'
      ),
    handleValidationErrors
  ],
  resetPassword
);

// @desc    Verify email
// @route   GET /api/auth/verify-email/:token
// @access  Public
router.get('/verify-email/:token', verifyEmail);

// @desc    Resend verification email
// @route   POST /api/auth/resend-verification
// @access  Private
router.post('/resend-verification', protect, resendVerificationEmail);

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, logoutUser);

export default router;
