// Express 4 does not catch rejected promises from async route handlers on
// its own -- an unhandled rejection here would either crash the process
// (bad on a long-running server) or leave a serverless invocation hanging
// with no response (worse, on Vercel). Wrapping every async handler with
// this forwards the error to Express's normal error-handling middleware
// instead, so callers always get a clean JSON error response.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
