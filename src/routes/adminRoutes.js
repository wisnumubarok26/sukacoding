const express = require('express');
const router = express.Router();
const admin = require('../controllers/adminController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { csrfMiddleware, sanitizeBody } = require('../middleware/security');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth, requireRole('admin'), csrfMiddleware);

router.get('/', asyncHandler(admin.dashboard));

// Courses
router.get('/courses', asyncHandler(admin.listCoursesAdmin));
router.get('/courses/new', admin.newCourseForm);
router.post('/courses', sanitizeBody(['title', 'short_description', 'description']), asyncHandler(admin.createCourse));
router.get('/courses/:id/edit', asyncHandler(admin.editCourseForm));
router.post('/courses/:id', sanitizeBody(['title', 'short_description', 'description']), asyncHandler(admin.updateCourse));
router.post('/courses/:id/delete', asyncHandler(admin.deleteCourse));

// Lessons (video per course, termasuk setting gratis/berbayar)
router.post('/courses/:id/lessons', sanitizeBody(['title', 'section_title']), asyncHandler(admin.addLesson));
router.post('/courses/:id/lessons/:lessonId', sanitizeBody(['title', 'section_title']), asyncHandler(admin.updateLesson));
router.post('/courses/:id/lessons/:lessonId/delete', asyncHandler(admin.deleteLesson));

// Events
router.get('/events', asyncHandler(admin.listEventsAdmin));
router.get('/events/new', admin.newEventForm);
router.post('/events', sanitizeBody(['title', 'description', 'location']), asyncHandler(admin.createEvent));
router.get('/events/:id/edit', asyncHandler(admin.editEventForm));
router.post('/events/:id', sanitizeBody(['title', 'description', 'location']), asyncHandler(admin.updateEvent));
router.post('/events/:id/delete', asyncHandler(admin.deleteEvent));

// Users & orders
router.get('/users', asyncHandler(admin.listUsers));
router.post('/users/:id/toggle', asyncHandler(admin.toggleUserActive));
router.get('/orders', asyncHandler(admin.listOrders));

module.exports = router;
