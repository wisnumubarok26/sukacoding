const db = require('../db');

exports.listEvents = async (req, res) => {
  const events = await db.all(`SELECT * FROM events WHERE is_published = 1 ORDER BY event_date ASC`);

  const now = new Date();
  const upcoming = events.filter((e) => new Date(e.event_date) >= now);
  const past = events.filter((e) => new Date(e.event_date) < now);

  res.render('events', { title: 'Event SukaCoding', upcoming, past });
};

exports.eventDetail = async (req, res) => {
  const event = await db.one('SELECT * FROM events WHERE slug = $1 AND is_published = 1', [req.params.slug]);
  if (!event) return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Event tidak ditemukan.' });
  res.render('event-detail', { title: event.title, event });
};
