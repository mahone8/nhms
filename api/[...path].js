/**
 * Vercel serverless entrypoint. The filename `[...path]` is Vercel's
 * catch-all convention -- every request under /api/* that isn't matched
 * by a more specific file is routed to this one function.
 *
 * Vercel's Node.js runtime invokes the default export as a standard
 * (req, res) handler -- exactly the shape an Express app already is -- so
 * no Lambda-style adapter (e.g. serverless-http, built for AWS API
 * Gateway's event format) is needed or wanted here.
 */
module.exports = require("../app");
