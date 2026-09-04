const express = require('express');
const router = express.Router();
const pageController = require('../controllers/pageController');
const courseController = require('../controllers/courseController');
const eventController = require('../controllers/eventController');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');

router.get('/', asyncHandler(pageController.home));
router.get('/dashboard', requireAuth, asyncHandler(pageController.dashboard));

router.get('/courses', asyncHandler(courseController.listCourses));
router.get('/courses/:slug', asyncHandler(courseController.courseDetail));
router.get('/courses/:slug/watch/:lessonId', requireAuth, asyncHandler(courseController.watchLesson));
router.post('/courses/:slug/watch/:lessonId/complete', requireAuth, asyncHandler(courseController.completeLesson));
router.get('/courses/:slug/certificate', requireAuth, asyncHandler(courseController.certificate));

router.get('/events', asyncHandler(eventController.listEvents));
router.get('/events/:slug', asyncHandler(eventController.eventDetail));

module.exports = router;
