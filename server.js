'use strict';
// Local / VPS launcher. (On Vercel the store runs through api/index.js instead.)
const { server, PORT, DATA_DIR } = require('./lib/app');
server.listen(PORT, '0.0.0.0', () => console.log(`ChaskaTea store running on http://localhost:${PORT}  (data: ${DATA_DIR})`));
