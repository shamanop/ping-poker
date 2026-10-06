'use strict';
// get_bank_summary (server.js:1349 at 9440541). Only for a socket that is in the room.
function register(ctx, socket, on) {
  on('get_bank_summary', ({ roomId, view } = {}) => {
    if (!ctx.auth.requireAuth(socket)) return;
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return;
    socket.emit('bank_summary', ctx.views.bankSummary(roomId, view === 'play' || view === 'chips' ? view : undefined));
  });
}
module.exports = { register };
