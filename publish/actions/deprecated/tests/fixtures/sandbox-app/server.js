// prj-e2e sandbox service — a deliberately trivial HTTP app used to prove the
// real deploy path end-to-end. Pure application code: NO deploy/CI files live
// here (gov content is centralized — see jenkins-job-organization.md). Stdlib
// only, so the image needs no npm install.
const http = require('http');
const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); return res.end('{"status":"ok"}'); }
  res.writeHead(200, {'content-type':'text/plain'});
  res.end(`prj-e2e sandbox: ok (env=${process.env.DEPLOY_ENV||'?'}, host=${require('os').hostname()})\n`);
});
server.listen(PORT, () => console.log(`sandbox listening on :${PORT}`));
