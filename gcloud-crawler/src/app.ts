'use strict';

import express from 'express';
import cors from 'cors';
import { setupCrawler } from './crawler';

import * as admin from 'firebase-admin';
const serviceAccount = require('../cert/auto-shark-firebase-adminsdk-wfxle-31eb7a6ea3.json');

async function startServer() {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://auto-shark-default-rtdb.firebaseio.com/',
  });

  const app = express();
  app.use(cors());

  app.get('/_ah/warmup', (req, res) => {
    // Handle your warmup logic. Initiate db connection, etc.
  });

  app.get('/', (req, res) => {
    res.status(200).send('crawler').end();
  });

  // error handler
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }
    res
      .status(500)
      .send('<pre>error: ' + err.message + '\n' + err.stack + '</pre>');
  });

  // Start the server
  const PORT = process.env.PORT || 8081;
  app.listen(PORT, () => {
    console.info(`Crawler listening on port ${PORT}`);
    console.info('Press Ctrl+C to quit.');

    setupCrawler();
  });

  return app;
}

module.exports = startServer;

startServer();
