const { DownloadTask } = require('../src/main/downloader/engine');
const path = require('path');
const fs = require('fs');

async function runTest() {
  console.log('Testing Panda Downloader Multi-Segment Engine...');

  // Use a public test file with Range support (e.g. 10MB test file from speedtest / cloudflare / httpbin)
  const testUrl = 'https://proof.ovh.net/files/10Mb.dat';
  const saveDir = path.join(__dirname, 'temp_downloads');

  const task = new DownloadTask({
    url: testUrl,
    saveDirectory: saveDir,
    connectionsCount: 8
  });

  task.on('status-changed', data => {
    console.log(`[Status] ${data.status}`);
  });

  task.on('progress', prog => {
    process.stdout.write(`\r[Progress] ${prog.percent}% | Speed: ${(prog.speed / (1024 * 1024)).toFixed(2)} MB/s | Segments: ${prog.segments.length}`);
  });

  task.on('completed', data => {
    console.log('\n[Completed] File downloaded successfully!');
    console.log(`Path: ${data.filePath}`);
    console.log(`Size: ${(data.totalBytes / (1024 * 1024)).toFixed(2)} MB`);

    if (fs.existsSync(data.filePath)) {
      const stats = fs.statSync(data.filePath);
      console.log(`Verified disk file size: ${stats.size} bytes`);
      // Clean up test file
      fs.unlinkSync(data.filePath);
      fs.rmdirSync(saveDir);
      console.log('Cleanup complete. Engine test passed!');
      process.exit(0);
    } else {
      console.error('Downloaded file missing on disk!');
      process.exit(1);
    }
  });

  task.on('error', err => {
    console.error('\n[Error]', err.message);
    process.exit(1);
  });

  await task.start();
}

runTest();
