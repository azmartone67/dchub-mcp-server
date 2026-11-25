// port-grabber-server.mjs — a stand-in for server.mjs, used only by test/harness-port-held-during-import.test.mjs.
// Not a test file. While it is being imported it plays "another process": it tries to listen on the port the
// harness picked (process.env.PORT). `grab` records how that went; a successful grab is kept, as a real one would be.
import { createServer } from 'node:http';

const port = Number(process.env.PORT);
const thief = createServer();
export const grab = await new Promise((resolve) => {
  thief.once('error', (e) => resolve({ took: false, code: e.code, port }));
  thief.listen(port, '127.0.0.1', () => resolve({ took: true, code: null, port }));
});
export const releaseGrab = () => new Promise((resolve) => (grab.took ? thief.close(resolve) : resolve()));

export const app = {
  listen(p, host, cb) {
    return createServer((_req, res) => { res.setHeader('content-type', 'text/plain'); res.end('ok'); }).listen(p, host, cb);
  },
};
