'use strict';
// recap_get -> recap_data (night recap overlay). Parse, authorise, call the recorder's build(); the access rule lives there.
// Errors are the fixed sentence 'No such night' (no digits, no '$'), code 'recap'.

function register(ctx, socket, on) {
  on('recap_get', d => {
    const key = ctx.auth.requireAuth(socket); if (!key) return;
    if (!ctx.recap) return;
    const out = ctx.recap.build({ viewerKey: key, tableId: typeof d.tableId === 'string' ? d.tableId : null, nightId: typeof d.nightId === 'string' ? d.nightId : null, start: d.start });
    if (out.error) socket.emit('error', { message: out.error, code: 'recap' }); else socket.emit('recap_data', out);
  });
}

module.exports = { register };
