// Rebuilds the web app and restarts the server whenever the code changes.
// Anything after `--` goes to the server: npm run watch -- --host 0.0.0.0
import process from 'node:process';

const run = (cmd: string[]) => Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit' });

const build = run(['bunx', 'vite', 'build', '--watch']);
const server = run(['bun', '--watch', 'src/server/main.ts', ...Bun.argv.slice(2)]);

const stopAll = () => {
  build.kill();
  server.kill();
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
await Promise.race([build.exited, server.exited]);
stopAll();
