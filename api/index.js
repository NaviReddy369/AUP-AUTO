// Vercel entry point: every /api/*, /connect, /callback and /disconnect request is routed here
// (see vercel.json) and handled by the same Express app used locally.
module.exports = require('../server');
