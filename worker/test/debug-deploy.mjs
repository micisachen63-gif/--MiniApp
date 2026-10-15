process.on('exit', (code) => console.log('>>> PROCESS EXIT CODE:', code));
process.on('uncaughtException', (err) => console.error('>>> UNCAUGHT:', err));
process.on('unhandledRejection', (err) => console.error('>>> UNHANDLED:', err));

const origExit = process.exit;
process.exit = function(code) {
  console.log('>>> process.exit called with:', code, new Error().stack);
  return origExit.call(process, code);
};

process.argv = [process.argv[0], 'wrangler', 'deploy'];
await import('../node_modules/wrangler/wrangler-dist/cli.js');
