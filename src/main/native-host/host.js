#!/usr/bin/env node
const http = require('http');

// Read standard Chrome/Edge Native Messaging length-prefixed JSON from stdin
function readMessage() {
  const chunks = [];
  let expectedLength = null;

  process.stdin.on('readable', () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      chunks.push(chunk);
      const totalBuffer = Buffer.concat(chunks);

      if (expectedLength === null && totalBuffer.length >= 4) {
        expectedLength = totalBuffer.readUInt32LE(0);
      }

      if (expectedLength !== null && totalBuffer.length >= 4 + expectedLength) {
        const messageBuffer = totalBuffer.subarray(4, 4 + expectedLength);
        try {
          const json = JSON.parse(messageBuffer.toString('utf-8'));
          handleMessage(json);
        } catch (e) {
          sendReply({ error: 'Invalid JSON message' });
        }
        process.exit(0);
      }
    }
  });
}

function sendReply(data) {
  const buffer = Buffer.from(JSON.stringify(data), 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

function handleMessage(msg) {
  // Forward to Panda Downloader desktop app via local loopback port 45731
  const reqData = JSON.stringify(msg);
  const options = {
    hostname: '127.0.0.1',
    port: 45731,
    path: '/api/intercept',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqData)
    }
  };

  const req = http.request(options, (res) => {
    let responseBody = '';
    res.on('data', d => responseBody += d);
    res.on('end', () => {
      sendReply({ success: true, response: responseBody });
    });
  });

  req.on('error', (err) => {
    sendReply({ success: false, error: 'Panda Downloader is not running: ' + err.message });
  });

  req.write(reqData);
  req.end();
}

readMessage();
