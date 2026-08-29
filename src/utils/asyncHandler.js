// Express 4 tidak otomatis menangkap Promise yang reject di dalam route handler.
// Tanpa wrapper ini, error di controller async (misal query database gagal)
// akan membuat request "menggantung" atau proses crash tak tertangani.
// Semua controller async WAJIB dibungkus dengan asyncHandler di file routes.
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
